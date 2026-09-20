import { pathToFileURL } from "node:url";

const parentPort = process.parentPort;
const [serviceEntry, deadlineText, capText] = process.argv.slice(-3);
const deadlineMs = Number(deadlineText);
const requestCap = Number(capText);

if (!parentPort || !serviceEntry || !Number.isFinite(deadlineMs) || deadlineMs <= 0
    || !Number.isInteger(requestCap) || requestCap <= 0) {
    console.error("Persephone module service host received invalid startup arguments.");
    process.exit(1);
}

// This is the shared MAX_BUFFERED_PIPE_BYTES ceiling. The utility-process host is deliberately
// dependency-free, so it cannot import the TypeScript constant from src/shared.
const MAX_BUFFERED_PIPE_BYTES = 256 * 1024 * 1024;

const storagePending = new Map();
let requestNumber = 0;

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

function storageRequest(operation, args) {
    if (storagePending.size >= requestCap) return Promise.reject(new Error("service-busy"));
    const requestId = `storage-${process.pid}-${Date.now()}-${++requestNumber}`;
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            storagePending.delete(requestId);
            reject(new Error("service-timeout"));
        }, deadlineMs);
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

parentPort.on("message", (event) => {
    const message = eventData(event);
    if (!message || message.kind !== "storage-response" || typeof message.requestId !== "string") return;
    const request = storagePending.get(message.requestId);
    if (!request) return;
    clearTimeout(request.timer);
    storagePending.delete(message.requestId);
    if ("error" in message) {
        request.reject(new Error(errorMessage(message.error, "service-error")));
    } else {
        request.resolve(message.result);
    }
});

const providers = new Map();
const subscriptions = new Map();
let rendererLease;
let serviceEntryLoaded = false;

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

function announceCapabilities() {
    if (!rendererLease?.attached || !serviceEntryLoaded) return;
    for (const [type, implementation] of providers) {
        postRenderer(rendererLease.port, {
            kind: "provider-capabilities",
            type,
            writable: implementation.writable === true && typeof implementation.writeBinary === "function",
        });
    }
}

function disposeSubscriptions() {
    for (const subscription of subscriptions.values()) {
        try {
            subscription.dispose();
        } catch {
            // Process teardown is best effort; the utility process owns the resources.
        }
    }
    subscriptions.clear();
}

function settleLeasePending(lease) {
    for (const [requestId, pending] of lease.pending) {
        clearTimeout(pending.timer);
        postRenderer(lease.port, {
            kind: "response",
            requestId,
            error: "service-exited",
        });
        lease.pending.delete(requestId);
    }
}

function closeRendererLease(lease) {
    if (!lease) return;
    if (rendererLease === lease) rendererLease = undefined;
    clearTimeout(lease.timer);
    settleLeasePending(lease);
    disposeSubscriptions();
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
    for (const method of ["writeBinary", "stat", "watch"]) {
        if (implementation[method] !== undefined && typeof implementation[method] !== "function") {
            throw new Error(`provider-registration-invalid-implementation:${type}`);
        }
    }
    if (providers.has(type)) throw new Error(`provider-registration-duplicate:${type}`);
    providers.set(type, implementation);
    announceCapabilities();
}

const persephone = globalThis.persephone ?? {};
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
    if (!["readBinary", "writeBinary", "stat", "watchSubscribe", "watchUnsubscribe"].includes(message.operation)) {
        return "Unknown provider operation.";
    }
    if (typeof message.type !== "string" || message.type.length === 0 || !isRecord(message.config)) {
        return "Malformed provider request.";
    }
    if ((message.operation === "watchSubscribe" || message.operation === "watchUnsubscribe")
        && (typeof message.subscriptionId !== "string" || message.subscriptionId.length === 0)) {
        return "Malformed provider subscription request.";
    }
    if (message.operation === "writeBinary"
        && (!isUint8Array(message.data) || message.data.byteLength > MAX_BUFFERED_PIPE_BYTES)) {
        return "Malformed or oversized provider payload.";
    }
    return undefined;
}

function providerFailure(code, message) {
    return { kind: "provider-result", ok: false, error: { kind: "provider-error", code, message } };
}

function withDeadline(promise) {
    let timer;
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error("provider-timeout")), deadlineMs);
        }),
    ]).finally(() => {
        if (timer) clearTimeout(timer);
    });
}

function validStat(stat) {
    return isRecord(stat)
        && typeof stat.exists === "boolean"
        && (stat.size === undefined || (typeof stat.size === "number"
            && Number.isFinite(stat.size) && stat.size >= 0))
        && (stat.mtime === undefined || typeof stat.mtime === "string");
}

async function executeProviderRequest(lease, request) {
    const implementation = providers.get(request.type);
    if (!implementation) return providerFailure("provider-not-registered", `Provider "${request.type}" is not registered.`);

    if (request.operation === "readBinary") {
        const data = await withDeadline(Promise.resolve(implementation.readBinary(request.config)));
        if (!isUint8Array(data)) return providerFailure("provider-invalid-result", "readBinary() must return a Uint8Array.");
        if (data.byteLength > MAX_BUFFERED_PIPE_BYTES) {
            return providerFailure("provider-payload-too-large", "readBinary() exceeded the buffered payload limit.");
        }
        return { kind: "provider-result", operation: "readBinary", ok: true, data: copyBytes(data) };
    }

    if (request.operation === "writeBinary") {
        if (typeof implementation.writeBinary !== "function" || implementation.writable !== true) {
            return providerFailure("provider-read-only", `Provider "${request.type}" is read-only.`);
        }
        await withDeadline(Promise.resolve(implementation.writeBinary(request.config, copyBytes(request.data))));
        return { kind: "provider-result", operation: "writeBinary", ok: true };
    }

    if (request.operation === "stat") {
        if (typeof implementation.stat !== "function") {
            return { kind: "provider-result", operation: "stat", ok: true, stat: { exists: true } };
        }
        const stat = await withDeadline(Promise.resolve(implementation.stat(request.config)));
        if (!validStat(stat)) return providerFailure("provider-invalid-result", "stat() returned malformed metadata.");
        return { kind: "provider-result", operation: "stat", ok: true, stat };
    }

    const key = providerKey(request.type, request.subscriptionId);
    if (request.operation === "watchUnsubscribe") {
        const subscription = subscriptions.get(key);
        if (subscription) {
            subscriptions.delete(key);
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
            if (rendererLease !== lease || !lease.attached || !subscriptions.has(key)) return;
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
    subscriptions.set(key, { dispose: disposer });
    return { kind: "provider-result", operation: "watchSubscribe", ok: true };
}

function finishProviderRequest(lease, requestId, result) {
    const pending = lease.pending.get(requestId);
    if (!pending || rendererLease !== lease) return;
    clearTimeout(pending.timer);
    lease.pending.delete(requestId);
    postRenderer(lease.port, { kind: "response", requestId, result });
}

function handleRendererRequest(lease, message) {
    if (!lease.attached || rendererLease !== lease || !message || message.kind !== "request") return;
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
    if (lease.pending.size >= requestCap) {
        postRenderer(lease.port, { kind: "response", requestId: message.requestId, error: "service-busy" });
        return;
    }
    const timer = setTimeout(() => {
        if (!lease.pending.delete(message.requestId)) return;
        postRenderer(lease.port, {
            kind: "response",
            requestId: message.requestId,
            result: providerFailure("provider-failed", "Provider operation timed out."),
        });
    }, deadlineMs);
    lease.pending.set(message.requestId, { timer });
    void executeProviderRequest(lease, request).then(
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
    closeRendererLease(rendererLease);
    const lease = {
        generation: message.generation,
        leaseNonce: message.leaseNonce,
        port,
        attached: false,
        pending: new Map(),
        timer: undefined,
    };
    rendererLease = lease;
    lease.timer = setTimeout(() => closeRendererLease(lease), deadlineMs);
    try {
        port.on("message", (event) => {
            const nested = eventData(event);
            if (!nested || typeof nested !== "object") return;
            if (nested.kind === "hello-ack") {
                if (rendererLease !== lease || lease.attached
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
                announceCapabilities();
                return;
            }
            handleRendererRequest(lease, nested);
        });
        port.on("messageerror", () => closeRendererLease(lease));
        port.start();
        postRenderer(port, { kind: "hello", generation: lease.generation, leaseNonce: lease.leaseNonce });
    } catch {
        closeRendererLease(lease);
    }
}

function dropRenderer(message) {
    if (!rendererLease || message.generation !== rendererLease.generation
        || message.leaseNonce !== rendererLease.leaseNonce) return;
    closeRendererLease(rendererLease);
}

parentPort.on("message", (event) => {
    const message = eventData(event);
    if (!message || typeof message !== "object") return;
    if (message.kind === "attach-renderer") {
        // The port is transferred, so it arrives on the event rather than in the message body.
        attachRenderer(message, event?.ports?.[0]);
    } else if (message.kind === "drop-renderer") {
        dropRenderer(message);
    }
});

process.on("exit", () => {
    closeRendererLease(rendererLease);
    for (const request of storagePending.values()) clearTimeout(request.timer);
    storagePending.clear();
});

try {
    await import(pathToFileURL(serviceEntry).href);
    serviceEntryLoaded = true;
    announceCapabilities();
} catch (error) {
    console.error(`Failed to load module service entry ${serviceEntry}:`, errorMessage(error, "service-entry-failed"));
    closeRendererLease(rendererLease);
    process.exit(1);
}
