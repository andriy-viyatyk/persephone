import { pathToFileURL } from "node:url";
import { serialize } from "node:v8";

const parentPort = process.parentPort;
const [serviceEntry] = process.argv.slice(-1);

if (!parentPort || !serviceEntry) {
    console.error("Persephone module service host received invalid startup arguments.");
    process.exit(1);
}

// Tail-ack delay (mirrors SERVICE_CHANNEL_ACK_DELAY_MS): each port message is its own task, so a microtask would ack every message.
const SERVICE_CHANNEL_ACK_DELAY_MS = 10;
const storagePending = new Map();
const mcpEndpointPending = new Map();
const boardSettingsPending = new Map();
const boardSettingsCallbacks = new Set();
const activeMcpEndpoints = new Set();
let boardSettingsSubscriptionId;
let requestNumber = 0;
let hostConfig;
let resolveConfig;
const configReady = new Promise((resolve) => { resolveConfig = resolve; });

function eventData(event) {
    return event && typeof event === "object" && "data" in event ? event.data : event;
}

function errorMessage(error, fallback) {
    if (typeof error === "string" && error.length > 0) return error;
    if (error && typeof error.message === "string" && error.message.length > 0) {
        return error.message;
    }
    return fallback;
}

function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isBoardSettingValue(value) {
    return typeof value === "string" || typeof value === "boolean"
        || (typeof value === "number" && Number.isFinite(value));
}

function isUint8Array(value) {
    return value instanceof Uint8Array
        && Number.isInteger(value.byteLength)
        && value.byteLength >= 0
        && value.byteLength === value.length;
}

function copyBytes(value) {
    const result = new Uint8Array(value.byteLength);
    result.set(value);
    return result;
}

const PROVIDER_STATUS_STATES = new Set(["idle", "connecting", "active", "done", "error"]);
const PROVIDER_STATUS_INTERVAL_MS = 250;

function copyProviderStatus(value) {
    if (!isRecord(value) || !PROVIDER_STATUS_STATES.has(value.state)) return undefined;
    const status = { state: value.state };
    if (value.text !== undefined) {
        if (typeof value.text !== "string") return undefined;
        status.text = value.text.slice(0, 120);
    }
    if (value.detail !== undefined) {
        if (typeof value.detail !== "string") return undefined;
        status.detail = value.detail.slice(0, 512);
    }
    if (value.progress !== undefined) {
        if (!isRecord(value.progress)
            || typeof value.progress.loaded !== "number"
            || !Number.isFinite(value.progress.loaded) || value.progress.loaded < 0
            || (value.progress.total !== undefined
                && (typeof value.progress.total !== "number"
                    || !Number.isFinite(value.progress.total) || value.progress.total < 0))) return undefined;
        status.progress = { loaded: value.progress.loaded };
        if (value.progress.total !== undefined) status.progress.total = value.progress.total;
    }
    if (value.rate !== undefined) {
        if (typeof value.rate !== "number" || !Number.isFinite(value.rate) || value.rate < 0) return undefined;
        status.rate = value.rate;
    }
    return status;
}

async function storageRequest(operation, args) {
    await configReady;
    if (storagePending.size >= hostConfig.maxOutstandingRequestsPerService) {
        return Promise.reject(Object.assign(new Error("Service is busy."), { code: "service-busy" }));
    }
    const requestId = `storage-${process.pid}-${Date.now()}-${++requestNumber}`;
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            storagePending.delete(requestId);
            reject(new Error("service-timeout"));
        }, hostConfig.serviceRequestDeadlineMs);
        storagePending.set(requestId, { resolve, reject, timer });
        try {
            parentPort.postMessage({ kind: "storage-request", requestId, operation, args });
        } catch {
            clearTimeout(timer);
            storagePending.delete(requestId);
            reject(new Error("service-exited"));
        }
    });
}

async function mcpEndpointRequest(operation, token) {
    await configReady;
    if (mcpEndpointPending.size >= hostConfig.maxOutstandingRequestsPerService) {
        throw Object.assign(new Error("Service is busy."), { code: "service-busy" });
    }
    const requestId = `mcp-${process.pid}-${Date.now()}-${++requestNumber}`;
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            mcpEndpointPending.delete(requestId);
            reject(Object.assign(new Error("Service request timed out."), { code: "service-timeout" }));
        }, hostConfig.serviceRequestDeadlineMs);
        mcpEndpointPending.set(requestId, { resolve, reject, timer });
        try { parentPort.postMessage({ kind: "mcp-endpoint-request", requestId, operation, ...(token ? { token } : {}) }); }
        catch {
            clearTimeout(timer);
            mcpEndpointPending.delete(requestId);
            reject(Object.assign(new Error("The service has exited."), { code: "service-exited" }));
        }
    });
}

async function boardSettingsRequest(kind, fields = {}) {
    await configReady;
    if (boardSettingsPending.size >= hostConfig.maxOutstandingRequestsPerService) {
        throw Object.assign(new Error("Service is busy."), { code: "service-busy" });
    }
    const requestId = `board-settings-${process.pid}-${Date.now()}-${++requestNumber}`;
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            boardSettingsPending.delete(requestId);
            reject(Object.assign(new Error("Service request timed out."), { code: "service-timeout" }));
        }, hostConfig.serviceRequestDeadlineMs);
        boardSettingsPending.set(requestId, { resolve, reject, timer });
        try { parentPort.postMessage({ kind, requestId, ...fields }); }
        catch {
            clearTimeout(timer);
            boardSettingsPending.delete(requestId);
            reject(Object.assign(new Error("The service has exited."), { code: "service-exited" }));
        }
    });
}

function assertHostSettingsApi() {
    if (protocolMode === "raw") throw new Error("Board settings require the host-managed service API.");
}

function subscribeBoardSettings(callback) {
    assertHostSettingsApi();
    if (typeof callback !== "function") throw new TypeError("settings.onChange(callback) requires a function.");
    boardSettingsCallbacks.add(callback);
    if (boardSettingsCallbacks.size === 1) {
        const subscriptionId = `board-settings-${process.pid}-${Date.now()}-${++requestNumber}`;
        boardSettingsSubscriptionId = subscriptionId;
        void boardSettingsRequest("board-settings-subscribe", { subscriptionId }).catch((error) => {
            if (boardSettingsSubscriptionId !== subscriptionId) return;
            boardSettingsSubscriptionId = undefined;
            console.error("Board settings subscription failed:", errorMessage(error, "service-error"));
        });
    }
    let disposed = false;
    return () => {
        if (disposed) return;
        disposed = true;
        boardSettingsCallbacks.delete(callback);
        if (boardSettingsCallbacks.size !== 0 || !boardSettingsSubscriptionId) return;
        const subscriptionId = boardSettingsSubscriptionId;
        boardSettingsSubscriptionId = undefined;
        void boardSettingsRequest("board-settings-unsubscribe", { subscriptionId }).catch(() => undefined);
    };
}

async function issueSessionEndpoint() {
    if (protocolMode === "raw") throw new Error("MCP session endpoints require the host service API.");
    const grant = await mcpEndpointRequest("issue");
    let token = grant.token;
    const headers = { ...grant.headers };
    let revoked = false;
    const handle = {
        url: grant.url,
        headers,
        get token() { return token; },
        set token(value) { token = value; if (!value) headers.Authorization = ""; },
        async revoke() {
            if (revoked) return;
            revoked = true;
            const currentToken = token;
            handle.token = "";
            activeMcpEndpoints.delete(handle);
            if (currentToken) await mcpEndpointRequest("revoke", currentToken);
        },
    };
    activeMcpEndpoints.add(handle);
    return handle;
}

const providers = new Map();
const rendererLeases = new Map();
let serviceEntryLoaded = false;
let serviceRequestHandler;
let serviceChannelHandler;
const serviceChannels = new Map();
const shutdownHandlers = [];
let initNonce;
let readySent = false;
let shutdownStarted = false;

function providerKey(type, subscriptionId) {
    return `${type}\u0000${subscriptionId}`;
}

function postRenderer(port, message) {
    try {
        port.postMessage(message);
        return true;
    } catch {
        return false;
    }
}

function announceCapabilities(lease) {
    if (!lease?.attached || !serviceEntryLoaded || rendererLeases.get(lease.leaseNonce) !== lease) return;
    for (const [type, implementation] of providers) {
        postRenderer(lease.port, {
            kind: "provider-capabilities",
            type,
            writable: implementation.writable === true && typeof implementation.writeBinary === "function",
            rangeReadable: typeof implementation.readRange === "function",
        });
    }
}

function disposeLeaseSubscriptions(lease) {
    for (const subscription of lease.subscriptions.values()) {
        try {
            subscription.dispose();
        } catch {
            // Process teardown is best effort; the utility process owns the resources.
        }
    }
    lease.subscriptions.clear();
}

function settleLeasePending(lease, reason) {
    for (const [requestId, pending] of lease.pending) {
        pending.controller?.abort();
        postRenderer(lease.port, {
            kind: "response",
            requestId,
            error: { code: reason, message: `The service renderer lease was lost: ${reason}.` },
        });
        lease.pending.delete(requestId);
    }
}

function closeRendererLease(lease, reason) {
    if (!lease || rendererLeases.get(lease.leaseNonce) !== lease) return;
    clearTimeout(lease.timer);
    postRenderer(lease.port, { kind: "lease-lost", reason });
    settleLeasePending(lease, reason);
    disposeLeaseSubscriptions(lease);
    lease.activeContentReads = 0;
    rendererLeases.delete(lease.leaseNonce);
    try {
        lease.port.close();
    } catch {
        // The other endpoint may already have closed.
    }
}

function registerProvider(type, implementation) {
    if (typeof type !== "string" || type.length === 0 || type.trim() !== type || !type.includes("/")) {
        throw new Error("provider-registration-invalid-type");
    }
    if (!isRecord(implementation) || typeof implementation.readBinary !== "function") {
        throw new Error(`provider-registration-invalid-implementation:${type}`);
    }
    for (const method of ["writeBinary", "stat", "watch", "readRange"]) {
        if (implementation[method] !== undefined && typeof implementation[method] !== "function") {
            throw new Error(`provider-registration-invalid-implementation:${type}`);
        }
    }
    if (implementation.status !== undefined && typeof implementation.status !== "function") {
        throw new Error(`provider-registration-invalid-implementation:${type}`);
    }
    if (providers.has(type)) throw new Error(`provider-registration-duplicate:${type}`);
    providers.set(type, implementation);
    for (const lease of rendererLeases.values()) announceCapabilities(lease);
}

const persephone = globalThis.persephone ?? {};
persephone.settings = {
    get(id) {
        assertHostSettingsApi();
        if (typeof id !== "string" || id.trim().length === 0) {
            return Promise.reject(Object.assign(new Error("Board setting id must be a non-empty string."), { code: "service-error" }));
        }
        return boardSettingsRequest("board-settings-get", { id: id.trim() }).then((value) => {
            if (!isBoardSettingValue(value)) {
                throw Object.assign(new Error("Board setting result must be a finite scalar."), { code: "service-error" });
            }
            return value;
        });
    },
    onChange: subscribeBoardSettings,
};
persephone.storage = {
    get: (key) => storageRequest("get", [key]),
    set: (key, value) => storageRequest("set", [key, value]),
    delete: (key) => storageRequest("delete", [key]),
    keys: () => storageRequest("keys", []),
};
persephone.providers = { register: registerProvider };
globalThis.persephone = persephone;

function validProviderRequest(message) {
    if (!isRecord(message) || message.kind !== "provider") return "Expected a provider request.";
    if (typeof message.operation !== "string" || !Object.hasOwn(hostConfig.providerRequestClasses, message.operation)) {
        return "Unknown provider operation.";
    }
    if (typeof message.type !== "string" || message.type.length === 0 || !isRecord(message.config)) {
        return "Malformed provider request.";
    }
    if (["watchSubscribe", "watchUnsubscribe", "statusSubscribe", "statusUnsubscribe"].includes(message.operation)
        && (typeof message.subscriptionId !== "string" || message.subscriptionId.length === 0)) {
        return "Malformed provider subscription request.";
    }
    if (message.operation === "writeBinary"
        && (!isUint8Array(message.data) || message.data.byteLength > hostConfig.maxBufferedPipeBytes)) {
        return "Malformed or oversized provider payload.";
    }
    if (message.operation === "readRange") {
        const range = message.range;
        if (!isRecord(range)
            || !Number.isInteger(range.start) || range.start < 0
            || !Number.isInteger(range.end) || range.end < range.start
            || (range.end - range.start + 1) > hostConfig.maxBoardPipeChunkBytes) {
            return "Malformed or oversized provider range.";
        }
    }
    return undefined;
}

function providerFailure(code, message) {
    return { kind: "provider-result", ok: false, error: { kind: "provider-error", code, message } };
}

function isContentReadOperation(operation) {
    return hostConfig.providerRequestClasses[operation] === "content-read";
}

/** US-1518 decision 10: pushes the live outstanding-content-read count to the renderer over the
 *  existing announcement transport, whenever it changes. */
function pushActiveContentReads(lease) {
    if (!lease.attached) return;
    postRenderer(lease.port, { kind: "content-read-count", count: lease.activeContentReads });
}

function incrementActiveContentReads(lease) {
    lease.activeContentReads += 1;
    pushActiveContentReads(lease);
}

function decrementActiveContentReads(lease) {
    lease.activeContentReads = Math.max(0, lease.activeContentReads - 1);
    pushActiveContentReads(lease);
}

function validStat(stat) {
    return isRecord(stat)
        && typeof stat.exists === "boolean"
        && (stat.size === undefined || (typeof stat.size === "number"
            && Number.isFinite(stat.size) && stat.size >= 0))
        && (stat.mtime === undefined || typeof stat.mtime === "string");
}

async function executeProviderRequest(lease, request, controller) {
    const implementation = providers.get(request.type);
    if (!implementation) return providerFailure("provider-not-registered", `Provider "${request.type}" is not registered.`);

    if (request.operation === "readBinary") {
        // The renderer owns provider-operation deadlines. `controller.signal` is
        // offered so a cooperative implementation can stop real work early; nothing on the
        // release path depends on it being honored (see handleRendererRequest()/the cancel branch).
        const data = await Promise.resolve(implementation.readBinary(request.config, { signal: controller.signal }));
        if (!isUint8Array(data)) return providerFailure("provider-invalid-result", "readBinary() must return a Uint8Array.");
        if (data.byteLength > hostConfig.maxBufferedPipeBytes) {
            return providerFailure("provider-payload-too-large", "readBinary() exceeded the buffered payload limit.");
        }
        return { kind: "provider-result", operation: "readBinary", ok: true, data: copyBytes(data) };
    }

    if (request.operation === "readRange") {
        if (typeof implementation.readRange !== "function") {
            return providerFailure(
                "provider-range-unsupported",
                `Provider "${request.type}" does not support ranged reads.`,
            );
        }
        const data = await Promise.resolve(
            implementation.readRange(request.config, request.range, { signal: controller.signal }),
        );
        if (!isUint8Array(data)) {
            return providerFailure("provider-invalid-result", "readRange() must return a Uint8Array.");
        }
        const requestedLength = request.range.end - request.range.start + 1;
        if (data.byteLength > requestedLength) {
            return providerFailure("provider-payload-too-large", "readRange() exceeded the requested range.");
        }
        return { kind: "provider-result", operation: "readRange", ok: true, data: copyBytes(data) };
    }

    if (request.operation === "writeBinary") {
        if (typeof implementation.writeBinary !== "function" || implementation.writable !== true) {
            return providerFailure("provider-read-only", `Provider "${request.type}" is read-only.`);
        }
        await Promise.resolve(implementation.writeBinary(request.config, copyBytes(request.data)));
        return { kind: "provider-result", operation: "writeBinary", ok: true };
    }

    if (request.operation === "stat") {
        if (typeof implementation.stat !== "function") {
            return { kind: "provider-result", operation: "stat", ok: true, stat: { exists: true } };
        }
        // The renderer owns provider-operation deadlines; stat has no deadline by policy.
        const stat = await Promise.resolve(
            implementation.stat(request.config, { signal: controller.signal }),
        );
        if (!validStat(stat)) return providerFailure("provider-invalid-result", "stat() returned malformed metadata.");
        return { kind: "provider-result", operation: "stat", ok: true, stat };
    }

    const key = providerKey(request.type, request.subscriptionId);
    if (request.operation === "statusUnsubscribe") {
        const subscription = lease.subscriptions.get(key);
        if (subscription) {
            lease.subscriptions.delete(key);
            try {
                subscription.dispose();
            } catch (error) {
                return providerFailure("provider-failed", errorMessage(error, "status disposer failed."));
            }
        }
        return { kind: "provider-result", operation: "statusUnsubscribe", ok: true };
    }

    if (request.operation === "statusSubscribe") {
        if (typeof implementation.status !== "function") {
            return { kind: "provider-result", operation: "statusSubscribe", ok: true };
        }
        const previous = lease.subscriptions.get(key);
        if (previous) {
            lease.subscriptions.delete(key);
            previous.dispose();
        }
        const subscription = { dispose: () => undefined, clear: undefined, timer: undefined, pending: undefined, lastSentAt: 0 };
        const isCurrent = () => rendererLeases.get(lease.leaseNonce) === lease
            && lease.attached && lease.subscriptions.get(key) === subscription;
        const send = (status) => {
            if (!isCurrent()) return;
            postRenderer(lease.port, {
                kind: "provider-status-event",
                subscriptionId: request.subscriptionId,
                status,
            });
            subscription.lastSentAt = Date.now();
        };
        subscription.clear = () => {
            if (lease.attached && rendererLeases.get(lease.leaseNonce) === lease) {
                postRenderer(lease.port, {
                    kind: "provider-status-event",
                    subscriptionId: request.subscriptionId,
                    status: null,
                });
            }
        };
        const flush = () => {
            subscription.timer = undefined;
            const status = subscription.pending;
            subscription.pending = undefined;
            if (status !== undefined) send(status);
        };
        const emit = (value) => {
            const status = copyProviderStatus(value);
            if (!status || !isCurrent()) return;
            const delay = Math.max(0, PROVIDER_STATUS_INTERVAL_MS - (Date.now() - subscription.lastSentAt));
            if (delay === 0 && !subscription.settingUp) {
                send(status);
                return;
            }
            subscription.pending = status;
            if (!subscription.timer) subscription.timer = setTimeout(flush, Math.max(delay, subscription.settingUp ? 0 : 1));
        };
        subscription.settingUp = true;
        lease.subscriptions.set(key, subscription);
        let disposer;
        try {
            disposer = implementation.status(request.config, emit);
        } catch (error) {
            lease.subscriptions.delete(key);
            return providerFailure("provider-failed", errorMessage(error, "status() failed."));
        }
        if (typeof disposer !== "function") {
            lease.subscriptions.delete(key);
            clearTimeout(subscription.timer);
            return providerFailure("provider-invalid-result", "status() must return a disposer.");
        }
        subscription.dispose = () => {
            subscription.clear();
            clearTimeout(subscription.timer);
            subscription.timer = undefined;
            subscription.pending = undefined;
            try { disposer(); } catch { /* Lease teardown is best effort. */ }
        };
        subscription.settingUp = false;
        if (subscription.pending !== undefined && !subscription.timer) {
            subscription.timer = setTimeout(flush, 0);
        }
        return { kind: "provider-result", operation: "statusSubscribe", ok: true };
    }

    if (request.operation === "watchUnsubscribe") {
        const subscription = lease.subscriptions.get(key);
        if (subscription) {
            lease.subscriptions.delete(key);
            try {
                subscription.dispose();
            } catch (error) {
                return providerFailure("provider-failed", errorMessage(error, "watch disposer failed."));
            }
        }
        return { kind: "provider-result", operation: "watchUnsubscribe", ok: true };
    }

    if (typeof implementation.watch !== "function") {
        return providerFailure("provider-failed", `Provider "${request.type}" does not support watch().`);
    }
    let disposer;
    try {
        disposer = implementation.watch(request.config, (event) => {
            if (rendererLeases.get(lease.leaseNonce) !== lease || !lease.attached || !lease.subscriptions.has(key)) return;
            postRenderer(lease.port, {
                kind: "provider-event",
                subscriptionId: request.subscriptionId,
                event: typeof event === "string" ? event : String(event),
            });
        });
    } catch (error) {
        return providerFailure("provider-failed", errorMessage(error, "watch() failed."));
    }
    if (typeof disposer !== "function") {
        return providerFailure("provider-invalid-result", "watch() must return a disposer.");
    }
    lease.subscriptions.set(key, { dispose: disposer });
    return { kind: "provider-result", operation: "watchSubscribe", ok: true };
}

function finishProviderRequest(lease, requestId, result) {
    const pending = lease.pending.get(requestId);
    if (!pending || rendererLeases.get(lease.leaseNonce) !== lease) return;
    lease.pending.delete(requestId);
    if (pending.isContentRead) decrementActiveContentReads(lease);
    postRenderer(lease.port, { kind: "response", requestId, result });
}

function handleRendererRequest(lease, message) {
    if (!lease.attached || rendererLeases.get(lease.leaseNonce) !== lease || !message || message.kind !== "request") return;
    if (typeof message.requestId !== "string") return;
    const request = message.message;
    const validationError = validProviderRequest(request);
    if (validationError) {
        postRenderer(lease.port, {
            kind: "response",
            requestId: message.requestId,
            result: providerFailure("provider-invalid-result", validationError),
        });
        return;
    }
    const isContentRead = isContentReadOperation(request.operation);
    if (!isContentRead) {
        let controlCount = 0;
        for (const pending of lease.pending.values()) {
            if (!pending.isContentRead) controlCount++;
        }
        if (controlCount >= hostConfig.maxOutstandingRequestsPerService) {
            postRenderer(lease.port, {
                kind: "response",
                requestId: message.requestId,
                error: { code: "service-busy", message: "The service has too many outstanding requests." },
            });
            return;
        }
    }
    const controller = new AbortController();
    lease.pending.set(message.requestId, {
        controller,
        operation: request.operation,
        isContentRead,
    });
    if (isContentRead) incrementActiveContentReads(lease);
    void executeProviderRequest(lease, request, controller).then(
        (result) => finishProviderRequest(lease, message.requestId, result),
        (error) => finishProviderRequest(
            lease,
            message.requestId,
            providerFailure("provider-failed", errorMessage(error, "Provider operation failed.")),
        ),
    );
}

function attachRenderer(message, port) {
    if (!port || typeof port.postMessage !== "function" || typeof port.close !== "function"
        || typeof port.on !== "function") return;
    if (!Number.isInteger(message.generation) || typeof message.leaseNonce !== "string") return;
    const lease = {
        generation: message.generation,
        leaseNonce: message.leaseNonce,
        port,
        attached: false,
        pending: new Map(),
        subscriptions: new Map(),
        timer: undefined,
        activeContentReads: 0,
    };
    rendererLeases.set(lease.leaseNonce, lease);
    lease.timer = setTimeout(() => closeRendererLease(lease, "renderer-port-attach-failed"), hostConfig.serviceRequestDeadlineMs);
    try {
        port.on("message", (event) => {
            const nested = eventData(event);
            if (!nested || typeof nested !== "object") return;
            if (nested.kind === "hello-ack") {
                if (rendererLeases.get(lease.leaseNonce) !== lease || lease.attached
                    || nested.generation !== lease.generation || nested.leaseNonce !== lease.leaseNonce) {
                    return;
                }
                lease.attached = true;
                clearTimeout(lease.timer);
                parentPort.postMessage({
                    kind: "renderer-attached",
                    generation: lease.generation,
                    leaseNonce: lease.leaseNonce,
                });
                announceCapabilities(lease);
                return;
            }
            if (nested.kind === "cancel" && typeof nested.requestId === "string") {
                const pending = lease.pending.get(nested.requestId);
                if (pending) {
                    lease.pending.delete(nested.requestId);
                    if (pending.isContentRead) decrementActiveContentReads(lease);
                    pending.controller?.abort();
                }
                return;
            }
            handleRendererRequest(lease, nested);
        });
        port.on("messageerror", () => closeRendererLease(lease, "service-exited"));
        port.start();
        postRenderer(port, { kind: "hello", generation: lease.generation, leaseNonce: lease.leaseNonce });
    } catch {
        closeRendererLease(lease, "service-exited");
    }
}

function dropRenderer(message) {
    const lease = rendererLeases.get(message.leaseNonce);
    if (!lease || message.generation !== lease.generation) return;
    closeRendererLease(lease, message.reason);
}

function serviceError(error) {
    const candidate = error && typeof error === "object" ? error : undefined;
    const code = typeof candidate?.code === "string" && candidate.code.length > 0
        ? candidate.code
        : "service-error";
    return { code, message: errorMessage(error, "Service request failed.") };
}

function postResult(requestId, result) {
    try {
        parentPort.postMessage({ kind: "response", requestId, result });
    } catch (error) {
        console.error("Failed to post module service response:", errorMessage(error, "service-exited"));
    }
}

function postError(requestId, error) {
    try {
        parentPort.postMessage({ kind: "response", requestId, error });
    } catch (postErrorValue) {
        console.error("Failed to post module service error:", errorMessage(postErrorValue, "service-exited"));
    }
}

async function runServiceRequest(message) {
    if (typeof message.requestId !== "string") return;
    if (typeof serviceRequestHandler !== "function") {
        postError(message.requestId, {
            code: "service-handler-not-registered",
            message: "The service entry did not register an onRequest handler.",
        });
        return;
    }
    try {
        postResult(message.requestId, await serviceRequestHandler(message.message));
    } catch (error) {
        postError(message.requestId, serviceError(error));
    }
}

async function runShutdown(message) {
    if (shutdownStarted) return;
    shutdownStarted = true;
    boardSettingsCallbacks.clear();
    boardSettingsSubscriptionId = undefined;
    for (const [requestId, pending] of boardSettingsPending) {
        clearTimeout(pending.timer);
        pending.reject(Object.assign(new Error("The service has exited."), { code: "service-exited" }));
        boardSettingsPending.delete(requestId);
    }
    for (const channel of [...serviceChannels.values()]) channel.close({ code: "service-exited", message: "The board service is shutting down." });
    let failed = false;
    for (const endpoint of [...activeMcpEndpoints]) {
        try { await endpoint.revoke(); }
        catch (error) { failed = true; console.error("MCP endpoint revocation failed:", errorMessage(error, "service-error")); }
    }
    for (const handler of shutdownHandlers) {
        try {
            await handler({ reason: message.reason });
        } catch (error) {
            failed = true;
            console.error("Module service shutdown callback failed:", errorMessage(error, "service-error"));
        }
    }
    process.exit(failed ? 1 : 0);
}

function makeServiceChannel(channelId, port) {
    const messageHandlers = new Set();
    const closeHandlers = new Set();
    const writableWaiters = new Set();
    let closed = false;
    let closeReason;
    let outgoingSequence = 0;
    let acknowledgedSequence = 0;
    let incomingSequence = 0;
    let lastAck = 0;
    let ackQueued = false;
    const notifyClose = (reason) => {
        if (closed) return;
        closed = true;
        closeReason = reason;
        serviceChannels.delete(channelId);
        try { port.close(); } catch { /* closed */ }
        for (const waiter of writableWaiters) waiter.reject(Object.assign(new Error(reason.message), { code: reason.code }));
        writableWaiters.clear();
        for (const handler of closeHandlers) { try { handler(reason); } catch (error) { console.error(error); } }
        closeHandlers.clear();
        messageHandlers.clear();
        try { parentPort.postMessage({ kind: "channel-ended", channelId }); } catch { /* exiting */ }
    };
    const channel = {
        send(value) {
            if (closed) throw Object.assign(new Error(closeReason?.message ?? "Channel is closed."), { code: closeReason?.code ?? "service-exited" });
            if (outgoingSequence - acknowledgedSequence >= hostConfig.maxServiceChannelInFlight) throw Object.assign(new Error("Channel send window is full."), { code: "channel-backpressure" });
            let bytes;
            try { bytes = serialize(value).byteLength; }
            catch { throw Object.assign(new Error("Channel message is not structured-cloneable."), { code: "service-error" }); }
            if (bytes > hostConfig.maxServiceChannelMessageBytes) throw Object.assign(new Error("Service channel message exceeds 1 MiB."), { code: "channel-message-too-large" });
            const sequence = ++outgoingSequence;
            try { port.postMessage({ kind: "data", sequence, value }); }
            catch (error) { throw Object.assign(new Error(errorMessage(error, "Channel send failed.")), { code: "service-error" }); }
        },
        onMessage(handler) { messageHandlers.add(handler); return () => messageHandlers.delete(handler); },
        onClose(handler) { if (closed) handler(closeReason); else closeHandlers.add(handler); return () => closeHandlers.delete(handler); },
        close(reason = { code: "channel-closed", message: "The service closed the channel." }) {
            if (closed) return;
            try { port.postMessage({ kind: "close", reason }); } catch { /* peer may be gone */ }
            notifyClose(reason);
        },
        get writable() { return !closed && outgoingSequence - acknowledgedSequence < hostConfig.maxServiceChannelInFlight; },
        whenWritable() {
            if (closed) return Promise.reject(Object.assign(new Error(closeReason.message), { code: closeReason.code }));
            if (outgoingSequence - acknowledgedSequence < hostConfig.maxServiceChannelInFlight) return Promise.resolve();
            return new Promise((resolve, reject) => writableWaiters.add({ resolve, reject }));
        },
    };
    port.on("message", (event) => {
        const message = eventData(event);
        if (!isRecord(message)) return;
        if (message.kind === "ack" && Number.isSafeInteger(message.sequence) && message.sequence > acknowledgedSequence) {
            acknowledgedSequence = Math.min(message.sequence, outgoingSequence);
            for (const waiter of writableWaiters) waiter.resolve();
            writableWaiters.clear();
        } else if (message.kind === "data" && Number.isSafeInteger(message.sequence)) {
            if (message.sequence !== incomingSequence + 1) return;
            incomingSequence = message.sequence;
            for (const handler of messageHandlers) { try { handler(message.value); } catch (error) { console.error(error); } }
            if (incomingSequence - lastAck >= hostConfig.serviceChannelAckBatch) { lastAck = incomingSequence; port.postMessage({ kind: "ack", sequence: lastAck }); }
            else if (!ackQueued) { ackQueued = true; setTimeout(() => { ackQueued = false; if (!closed && incomingSequence > lastAck) { lastAck = incomingSequence; port.postMessage({ kind: "ack", sequence: lastAck }); } }, SERVICE_CHANNEL_ACK_DELAY_MS); }
        } else if (message.kind === "close") notifyClose(message.reason ?? { code: "service-exited", message: "The channel peer closed." });
    });
    port.on("close", () => notifyClose({ code: "service-exited", message: "The channel peer disconnected." }));
    port.start();
    serviceChannels.set(channelId, channel);
    return channel;
}

function openServiceChannel(message, port) {
    if (!port || typeof message.channelId !== "string") return;
    const channel = makeServiceChannel(message.channelId, port);
    if (typeof serviceChannelHandler !== "function") {
        channel.close({ code: "service-handler-not-registered", message: "The service entry did not register onChannel()." });
        return;
    }
    Promise.resolve().then(() => serviceChannelHandler(channel, message.openMessage, message.info))
        .catch((error) => channel.close(serviceError(error)));
}

function handleHostLifecycle(message) {
    if (message.kind === "init" && message.nonce === initNonce && serviceEntryLoaded && !readySent) {
        readySent = true;
        parentPort.postMessage({ kind: "ready", nonce: initNonce });
    } else if (message.kind === "probe" && message.nonce === initNonce) {
        parentPort.postMessage({ kind: "probe-ack", nonce: initNonce });
    } else if (message.kind === "request") {
        void runServiceRequest(message);
    } else if (message.kind === "channel-open") {
        openServiceChannel(message, message.eventPort);
    } else if (message.kind === "channel-close") {
        serviceChannels.get(message.channelId)?.close(message.reason);
    } else if (message.kind === "shutdown" && message.nonce === initNonce) {
        void runShutdown(message);
    }
}

function validateHostConfig(config) {
    if (!isRecord(config)
        || !Number.isFinite(config.serviceRequestDeadlineMs) || config.serviceRequestDeadlineMs <= 0
        || !Number.isInteger(config.maxOutstandingRequestsPerService) || config.maxOutstandingRequestsPerService <= 0
        || !Number.isInteger(config.maxBufferedPipeBytes) || config.maxBufferedPipeBytes <= 0
        || !Number.isInteger(config.maxBoardPipeChunkBytes) || config.maxBoardPipeChunkBytes <= 0
        || !Number.isInteger(config.maxServiceChannelInFlight) || config.maxServiceChannelInFlight <= 0
        || !Number.isInteger(config.maxServiceChannelMessageBytes) || config.maxServiceChannelMessageBytes <= 0
        || !Number.isInteger(config.serviceChannelAckBatch) || config.serviceChannelAckBatch <= 0
        || !isRecord(config.providerRequestClasses)) return false;
    const entries = Object.entries(config.providerRequestClasses);
    return entries.length > 0 && entries.every(([, requestClass]) =>
        requestClass === "content-read" || requestClass === "control",
    );
}

function isLifecycleMessage(message) {
    return message.kind === "init" || message.kind === "probe"
        || message.kind === "request" || message.kind === "shutdown";
}

const entryListeners = [];
const queuedLifecycleEvents = [];
let importSettled = false;
let protocolMode;
let rawProtocolDetected = false;

function activeEntryListeners() {
    return entryListeners.filter((entry) => entry.active);
}

function dispatchToEntry(event) {
    for (const entry of activeEntryListeners()) {
        if (!entry.active) continue;
        if (entry.once) {
            entry.active = false;
            entryListeners.splice(entryListeners.indexOf(entry), 1);
        }
        try {
            entry.listener.call(parentPort, event);
        } catch (error) {
            console.error("Raw module service message listener failed:", errorMessage(error, "service-error"));
        }
    }
}

function addEntryListener(listener, once = false) {
    if (typeof listener !== "function") throw new TypeError("The listener must be a function.");
    if (importSettled && protocolMode === "host") {
        console.warn("Ignoring late raw module service message listener; host lifecycle mode is sealed.");
        return parentPort;
    }
    const entry = { listener, once, active: true };
    rawProtocolDetected = true;
    entryListeners.push(entry);
    if (queuedLifecycleEvents.length > 0) {
        for (const event of queuedLifecycleEvents.splice(0)) dispatchToEntry(event);
    }
    return parentPort;
}

function removeEntryListener(listener) {
    const index = entryListeners.map((entry) => entry.listener).lastIndexOf(listener);
    if (index >= 0) entryListeners.splice(index, 1)[0].active = false;
    return parentPort;
}

function removeAllEntryListeners() {
    for (const entry of entryListeners) entry.active = false;
    entryListeners.length = 0;
    return parentPort;
}

const originalPortMethods = Object.fromEntries(
    ["on", "addListener", "once", "off", "removeListener", "removeAllListeners"].map((name) => [name, parentPort[name].bind(parentPort)]),
);
const originalPortEventNames = parentPort.eventNames.bind(parentPort);
const interceptMessageMethod = (name, callback) => function (eventName, ...args) {
    if (eventName !== "message") return originalPortMethods[name](eventName, ...args);
    return callback(...args);
};
Object.defineProperties(parentPort, {
    on: { configurable: false, value: interceptMessageMethod("on", (listener) => addEntryListener(listener)) },
    addListener: { configurable: false, value: interceptMessageMethod("addListener", (listener) => addEntryListener(listener)) },
    once: { configurable: false, value: interceptMessageMethod("once", (listener) => addEntryListener(listener, true)) },
    off: { configurable: false, value: interceptMessageMethod("off", (listener) => removeEntryListener(listener)) },
    removeListener: { configurable: false, value: interceptMessageMethod("removeListener", (listener) => removeEntryListener(listener)) },
    removeAllListeners: { configurable: false, value: function (eventName) {
        if (eventName === undefined) {
            removeAllEntryListeners();
            for (const name of originalPortEventNames()) {
                if (name !== "message") originalPortMethods.removeAllListeners(name);
            }
            return parentPort;
        }
        if (eventName === "message") return removeAllEntryListeners();
        return originalPortMethods.removeAllListeners(eventName);
    } },
});

function forwardEntryEvent(event, message) {
    if (activeEntryListeners().length > 0) {
        dispatchToEntry(event);
    } else if (isLifecycleMessage(message) && !importSettled) {
        queuedLifecycleEvents.push(event);
    } else if (isLifecycleMessage(message) && protocolMode === "host") {
        handleHostLifecycle(message);
    }
}

originalPortMethods.on("message", (event) => {
    const message = eventData(event);
    if (!isRecord(message)) return;
    if (message.kind === "locale-changed") {
        if (typeof message.locale === "string") process.env.PERSEPHONE_LOCALE = message.locale;
        return;
    }
    if (message.kind === "storage-response" && typeof message.requestId === "string") {
        const request = storagePending.get(message.requestId);
        if (request) {
            clearTimeout(request.timer);
            storagePending.delete(message.requestId);
            if ("error" in message) request.reject(Object.assign(
                new Error(errorMessage(message.error, "Service storage request failed.")),
                { code: typeof message.error === "string" ? "service-error" : message.error?.code ?? "service-error" },
            ));
            else request.resolve(message.result);
        }
        forwardEntryEvent(event, message);
        return;
    }
    if (message.kind === "mcp-endpoint-response" && typeof message.requestId === "string") {
        const request = mcpEndpointPending.get(message.requestId);
        if (request) {
            clearTimeout(request.timer);
            mcpEndpointPending.delete(message.requestId);
            if (message.error) request.reject(Object.assign(
                new Error(errorMessage(message.error, "MCP endpoint request failed.")),
                { code: message.error.code ?? "service-error" },
            ));
            else request.resolve(message.result);
        }
        forwardEntryEvent(event, message);
        return;
    }
    if (message.kind === "board-settings-response" && typeof message.requestId === "string") {
        const request = boardSettingsPending.get(message.requestId);
        if (request) {
            clearTimeout(request.timer);
            boardSettingsPending.delete(message.requestId);
            if (message.error) request.reject(Object.assign(
                new Error(errorMessage(message.error, "Board settings request failed.")),
                { code: message.error.code ?? "service-error" },
            ));
            else request.resolve(message.result);
        }
        forwardEntryEvent(event, message);
        return;
    }
    if (message.kind === "board-settings-subscribe-response" || message.kind === "board-settings-unsubscribe-response") {
        const request = typeof message.requestId === "string" ? boardSettingsPending.get(message.requestId) : undefined;
        if (request) {
            clearTimeout(request.timer);
            boardSettingsPending.delete(message.requestId);
            if (message.error) request.reject(Object.assign(
                new Error(errorMessage(message.error, "Board settings subscription failed.")),
                { code: message.error.code ?? "service-error" },
            ));
            else request.resolve();
        }
        forwardEntryEvent(event, message);
        return;
    }
    if (message.kind === "board-settings-changed") {
        if (message.subscriptionId === boardSettingsSubscriptionId
            && typeof message.id === "string"
            && (typeof message.value === "string" || typeof message.value === "boolean"
                || (typeof message.value === "number" && Number.isFinite(message.value)))) {
            const change = { id: message.id, value: message.value };
            for (const callback of [...boardSettingsCallbacks]) {
                try { callback(change); }
                catch (error) { console.error("Board settings callback failed:", errorMessage(error, "service-error")); }
            }
        }
        forwardEntryEvent(event, message);
        return;
    }
    if (message.kind === "attach-renderer") {
        attachRenderer(message, event?.ports?.[0]);
        forwardEntryEvent(event, message);
        return;
    }
    if (message.kind === "drop-renderer") {
        dropRenderer(message);
        forwardEntryEvent(event, message);
        return;
    }
    if (message.kind === "channel-open") {
        openServiceChannel(message, event?.ports?.[0]);
        return;
    }
    if (message.kind === "channel-close") {
        serviceChannels.get(message.channelId)?.close(message.reason);
        return;
    }
    if (message.kind === "init") {
        if (!validateHostConfig(message.config)) {
            console.error("Persephone module service host received invalid init configuration.");
            process.exit(1);
            return;
        }
        hostConfig = message.config;
        initNonce = message.nonce;
        resolveConfig(hostConfig);
    }
    forwardEntryEvent(event, message);
});

persephone.service = {
    onRequest(handler) {
        if (typeof handler !== "function") throw new TypeError("onRequest(handler) requires a function.");
        if (serviceRequestHandler) throw new Error("A service request handler is already registered.");
        serviceRequestHandler = handler;
    },
    onChannel(handler) {
        if (typeof handler !== "function") throw new TypeError("onChannel(handler) requires a function.");
        if (serviceChannelHandler) throw new Error("A service channel handler is already registered.");
        serviceChannelHandler = handler;
    },
    onShutdown(handler) {
        if (typeof handler !== "function") throw new TypeError("onShutdown(fn) requires a function.");
        shutdownHandlers.push(handler);
    },
};
persephone.mcp = { issueSessionEndpoint };

process.on("exit", () => {
    for (const lease of [...rendererLeases.values()]) closeRendererLease(lease, "service-exited");
    for (const request of storagePending.values()) clearTimeout(request.timer);
    storagePending.clear();
    for (const request of mcpEndpointPending.values()) clearTimeout(request.timer);
    mcpEndpointPending.clear();
    for (const request of boardSettingsPending.values()) clearTimeout(request.timer);
    boardSettingsPending.clear();
    boardSettingsCallbacks.clear();
    boardSettingsSubscriptionId = undefined;
    for (const endpoint of activeMcpEndpoints) endpoint.token = "";
    activeMcpEndpoints.clear();
});

try {
    await import(pathToFileURL(serviceEntry).href);
    serviceEntryLoaded = true;
    importSettled = true;
    protocolMode = rawProtocolDetected ? "raw" : "host";
    if (protocolMode === "raw" && serviceRequestHandler) {
        console.warn("Raw module service protocol detected; persephone.service.onRequest is ignored.");
    }
    if (protocolMode === "host") {
        for (const event of queuedLifecycleEvents.splice(0)) handleHostLifecycle(eventData(event));
    }
    for (const lease of rendererLeases.values()) announceCapabilities(lease);
} catch (error) {
    console.error(`Failed to load module service entry ${serviceEntry}:`, errorMessage(error, "service-entry-failed"));
    for (const lease of [...rendererLeases.values()]) closeRendererLease(lease, "service-exited");
    process.exit(1);
}
