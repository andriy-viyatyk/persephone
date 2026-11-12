import { MAX_BUFFERED_PIPE_BYTES, MAX_BOARD_PIPE_CHUNK_BYTES } from "../shared/board-pipe-constants";
import { MAX_OUTSTANDING_REQUESTS_PER_SERVICE } from "../shared/capability-limits";
import { PROVIDER_OPERATION_POLICY } from "../shared/provider-operation-policy";
import { errMessage } from "../shared/utils";
import type { ProviderOperation, ProviderRequest, ProviderResult, ProviderWireErrorCode, ProviderWireStat, ProviderWireStatus } from "../ipc/module-service-channels";
import type { RendererLease, RendererLeaseManager, ProviderSubscription } from "./renderer-lease";
import { isRecord } from "./validation";

export interface ProviderImplementation {
    readBinary(config: Record<string, unknown>, context: { signal: AbortSignal }): Promise<unknown> | unknown;
    readRange?(config: Record<string, unknown>, range: { start: number; end: number } | undefined, context: { signal: AbortSignal }): Promise<unknown> | unknown;
    writeBinary?(config: Record<string, unknown>, data: Uint8Array): Promise<unknown> | unknown;
    stat?(config: Record<string, unknown>, context: { signal: AbortSignal }): Promise<unknown> | unknown;
    watch?(config: Record<string, unknown>, listener: (event: unknown) => void): (() => void) | { dispose(): void };
    status?(config: Record<string, unknown>, listener: (status: unknown) => void): (() => void) | { dispose(): void };
    writable?: boolean;
}

export interface ProviderStatusSnapshot {
    state: ProviderWireStatus["state"];
    text?: string;
    detail?: string;
    progress?: { loaded: number; total?: number };
    rate?: number;
}

export interface ProviderDispatch {
    register(type: string, implementation: unknown): void;
    announceCapabilities(lease: RendererLease): void;
    handleRendererRequest(lease: RendererLease, message: unknown): void;
}

export function createProviderDispatch(dependencies: { rendererLeases(): RendererLeaseManager; entryLoaded(): boolean }): ProviderDispatch {
    const providers = new Map<string, ProviderImplementation>();
    const PROVIDER_STATUS_STATES: ReadonlySet<string> = new Set(["idle", "connecting", "active", "done", "error"]);
    const PROVIDER_STATUS_INTERVAL_MS = 250;

function providerKey(type: string, subscriptionId: string): string {
    return `${type}\u0000${subscriptionId}`;
}

function announceCapabilities(lease: RendererLease): void {
    if (!lease?.attached || !dependencies.entryLoaded() || !dependencies.rendererLeases().isCurrent(lease)) return;
    for (const [type, implementation] of providers) {
        dependencies.rendererLeases().post(lease, {
            kind: "provider-capabilities",
            type,
            writable: implementation.writable === true && typeof implementation.writeBinary === "function",
            rangeReadable: typeof implementation.readRange === "function",
        });
    }
}

function isProviderImplementation(value: unknown): value is ProviderImplementation {
    if (!isRecord(value) || typeof value.readBinary !== "function") return false;
    for (const method of ["writeBinary", "stat", "watch", "readRange", "status"] as const) {
        if (value[method] !== undefined && typeof value[method] !== "function") return false;
    }
    return true;
}

function registerProvider(type: string, implementation: unknown): void {
    if (typeof type !== "string" || type.length === 0 || type.trim() !== type || !type.includes("/")) {
        throw new Error("provider-registration-invalid-type");
    }
    if (!isProviderImplementation(implementation)) {
        throw new Error(`provider-registration-invalid-implementation:${type}`);
    }
    if (providers.has(type)) throw new Error(`provider-registration-duplicate:${type}`);
    providers.set(type, implementation);
    for (const lease of dependencies.rendererLeases().values()) announceCapabilities(lease);
}

function isProviderOperation(value: unknown): value is ProviderOperation {
    return typeof value === "string" && Object.hasOwn(PROVIDER_OPERATION_POLICY, value);
}

function isProviderRequest(message: unknown, validation: { message?: string }): message is ProviderRequest {
    if (!isRecord(message) || message.kind !== "provider") { validation.message = "Expected a provider request."; return false; }
    if (!isProviderOperation(message.operation)) { validation.message = "Unknown provider operation."; return false; }
    if (typeof message.type !== "string" || message.type.length === 0 || !isRecord(message.config)) {
        validation.message = "Malformed provider request."; return false;
    }
    if (["watchSubscribe", "watchUnsubscribe", "statusSubscribe", "statusUnsubscribe"].includes(message.operation)
        && (typeof message.subscriptionId !== "string" || message.subscriptionId.length === 0)) {
        validation.message = "Malformed provider subscription request."; return false;
    }
    if (message.operation === "writeBinary"
        && (!isUint8Array(message.data) || message.data.byteLength > MAX_BUFFERED_PIPE_BYTES)) {
        validation.message = "Malformed or oversized provider payload."; return false;
    }
    if (message.operation === "readRange") {
        const range = message.range;
        if (!isRecord(range)
            || typeof range.start !== "number" || !Number.isInteger(range.start) || range.start < 0
            || typeof range.end !== "number" || !Number.isInteger(range.end) || range.end < range.start
            || (range.end - range.start + 1) > MAX_BOARD_PIPE_CHUNK_BYTES) {
            validation.message = "Malformed or oversized provider range."; return false;
        }
    }
    return true;
}

function providerFailure(code: ProviderWireErrorCode, message: string): Extract<ProviderResult, { ok: false }> {
    return { kind: "provider-result", ok: false, error: { kind: "provider-error", code, message } };
}

function isContentReadOperation(operation: ProviderOperation): boolean {
    return PROVIDER_OPERATION_POLICY[operation].requestClass === "content-read";
}

function validStat(stat: unknown): stat is ProviderWireStat {
    return isRecord(stat)
        && typeof stat.exists === "boolean"
        && (stat.size === undefined || (typeof stat.size === "number"
            && Number.isFinite(stat.size) && stat.size >= 0))
        && (stat.mtime === undefined || typeof stat.mtime === "string");
}

async function executeProviderRequest(lease: RendererLease, request: ProviderRequest, controller: AbortController): Promise<ProviderResult> {
    const implementation = providers.get(request.type);
    if (!implementation) return providerFailure("provider-not-registered", `Provider "${request.type}" is not registered.`);

    if (request.operation === "readBinary") {
        // The renderer owns provider-operation deadlines. `controller.signal` is
        // offered so a cooperative implementation can stop real work early; nothing on the
        // release path depends on it being honored (see handleRendererRequest()/the cancel branch).
        const data = await Promise.resolve(implementation.readBinary(request.config, { signal: controller.signal }));
        if (!isUint8Array(data)) return providerFailure("provider-invalid-result", "readBinary() must return a Uint8Array.");
        if (data.byteLength > MAX_BUFFERED_PIPE_BYTES) {
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
            } catch (error: unknown) {
                return providerFailure("provider-failed", errMessage(error, "status disposer failed."));
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
        const subscription: ProviderSubscription = { dispose: (): void => undefined, clear: (): void => undefined, timer: undefined, pending: undefined, lastSentAt: 0 };
        const isCurrent = (): boolean => dependencies.rendererLeases().isCurrent(lease)
            && lease.attached && lease.subscriptions.get(key) === subscription;
        const send = (status: ProviderStatusSnapshot): void => {
            if (!isCurrent()) return;
            dependencies.rendererLeases().post(lease, {
                kind: "provider-status-event",
                subscriptionId: request.subscriptionId,
                status,
            });
            subscription.lastSentAt = Date.now();
        };
        subscription.clear = (): void => {
            if (lease.attached && dependencies.rendererLeases().isCurrent(lease)) {
                dependencies.rendererLeases().post(lease, {
                    kind: "provider-status-event",
                    subscriptionId: request.subscriptionId,
                    status: null,
                });
            }
        };
        const flush = (): void => {
            subscription.timer = undefined;
            const status = subscription.pending;
            subscription.pending = undefined;
            if (status !== undefined) send(status);
        };
        const emit = (value: unknown): void => {
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
        let disposer: (() => void) | { dispose(): void };
        try {
            disposer = implementation.status(request.config, emit);
        } catch (error: unknown) {
            lease.subscriptions.delete(key);
            return providerFailure("provider-failed", errMessage(error, "status() failed."));
        }
        if (typeof disposer !== "function") {
            lease.subscriptions.delete(key);
            clearTimeout(subscription.timer);
            return providerFailure("provider-invalid-result", "status() must return a disposer.");
        }
        subscription.dispose = (): void => {
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
            } catch (error: unknown) {
                return providerFailure("provider-failed", errMessage(error, "watch disposer failed."));
            }
        }
        return { kind: "provider-result", operation: "watchUnsubscribe", ok: true };
    }

    if (typeof implementation.watch !== "function") {
        return providerFailure("provider-failed", `Provider "${request.type}" does not support watch().`);
    }
    let disposer: (() => void) | { dispose(): void };
    try {
        disposer = implementation.watch(request.config, (event: unknown): void => {
            if (!dependencies.rendererLeases().isCurrent(lease) || !lease.attached || !lease.subscriptions.has(key)) return;
            dependencies.rendererLeases().post(lease, {
                kind: "provider-event",
                subscriptionId: request.subscriptionId,
                event: typeof event === "string" ? event : String(event),
            });
        });
    } catch (error: unknown) {
        return providerFailure("provider-failed", errMessage(error, "watch() failed."));
    }
    if (typeof disposer !== "function") {
        return providerFailure("provider-invalid-result", "watch() must return a disposer.");
    }
    lease.subscriptions.set(key, { dispose: disposer, clear: (): void => undefined, lastSentAt: 0 });
    return { kind: "provider-result", operation: "watchSubscribe", ok: true };
}

function finishProviderRequest(lease: RendererLease, requestId: string, result: ProviderResult): void {
    const pending = lease.pending.get(requestId);
    if (!pending || !dependencies.rendererLeases().isCurrent(lease)) return;
    lease.pending.delete(requestId);
    if (pending.isContentRead) dependencies.rendererLeases().adjustContentReads(lease, -1);
    dependencies.rendererLeases().post(lease, { kind: "response", requestId, result });
}

function handleRendererRequest(lease: RendererLease, message: unknown): void {
    if (!lease.attached || !dependencies.rendererLeases().isCurrent(lease) || !isRecord(message) || message.kind !== "request") return;
    if (typeof message.requestId !== "string") return;
    const requestId = message.requestId;
    const request = message.message;
    const validation: { message?: string } = {};
    if (!isProviderRequest(request, validation)) {
        dependencies.rendererLeases().post(lease, {
            kind: "response",
            requestId,
            result: providerFailure("provider-invalid-result", validation.message ?? "Malformed provider request."),
        });
        return;
    }
    const isContentRead = isContentReadOperation(request.operation);
    if (!isContentRead) {
        let controlCount = 0;
        for (const pending of lease.pending.values()) {
            if (!pending.isContentRead) controlCount++;
        }
        if (controlCount >= MAX_OUTSTANDING_REQUESTS_PER_SERVICE) {
            dependencies.rendererLeases().post(lease, {
                kind: "response",
                requestId,
                error: { code: "service-busy", message: "The service has too many outstanding requests." },
            });
            return;
        }
    }
    const controller = new AbortController();
    lease.pending.set(requestId, {
        controller,
        operation: request.operation,
        isContentRead,
    });
    if (isContentRead) dependencies.rendererLeases().adjustContentReads(lease, 1);
    void executeProviderRequest(lease, request, controller).then(
        (result: ProviderResult): void => finishProviderRequest(lease, requestId, result),
        (error: unknown): void => finishProviderRequest(
            lease,
            requestId,
            providerFailure("provider-failed", errMessage(error, "Provider operation failed.")),
        ),
    );
}

function isUint8Array(value: unknown): value is Uint8Array {
    return value instanceof Uint8Array
        && Number.isInteger(value.byteLength)
        && value.byteLength >= 0
        && value.byteLength === value.length;
}

function copyBytes(value: Uint8Array): Uint8Array {
    const result = new Uint8Array(value.byteLength);
    result.set(value);
    return result;
}


function isProviderStatusState(value: unknown): value is ProviderWireStatus["state"] {
    return typeof value === "string" && PROVIDER_STATUS_STATES.has(value);
}

function copyProviderStatus(value: unknown): ProviderStatusSnapshot | undefined {
    if (!isRecord(value) || !isProviderStatusState(value.state)) return undefined;
    const status: ProviderStatusSnapshot = { state: value.state };
    if (value.text !== undefined) {
        if (typeof value.text !== "string") return undefined;
        status.text = value.text.slice(0, 120);
    }
    if (value.detail !== undefined) {
        if (typeof value.detail !== "string") return undefined;
        status.detail = value.detail.slice(0, 512);
    }
    if (value.progress !== undefined) {
        const progress = value.progress;
        if (!isRecord(progress)
            || typeof progress.loaded !== "number"
            || !Number.isFinite(progress.loaded) || progress.loaded < 0
            || (progress.total !== undefined
                && (typeof progress.total !== "number"
                    || !Number.isFinite(progress.total) || progress.total < 0))) return undefined;
        status.progress = { loaded: progress.loaded };
        if (typeof progress.total === "number") status.progress.total = progress.total;
    }
    if (value.rate !== undefined) {
        if (typeof value.rate !== "number" || !Number.isFinite(value.rate) || value.rate < 0) return undefined;
        status.rate = value.rate;
    }
    return status;
}


return { register: registerProvider, announceCapabilities, handleRendererRequest };
}
