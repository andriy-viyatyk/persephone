import {
    EventEndpoint,
    type ModuleServicePortPayload,
} from "../../ipc/api-types";
import {
    MAX_OUTSTANDING_REQUESTS_PER_SERVICE,
    PROVIDER_OPERATION_POLICY,
    SERVICE_REQUEST_DEADLINE_MS,
    type BoardServiceStatus,
    type ProviderRequest,
    type RendererLeaseLostReason,
    type RendererServiceMessage,
} from "../../ipc/module-service-channels";
import { api } from "../../ipc/renderer/api";
import rendererEvents from "../../ipc/renderer/renderer-events";
import { errMessage } from "../../shared/utils";
import { fpNormalizeForCompare } from "../core/utils/file-path";

interface PendingRequest {
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
    timer?: ReturnType<typeof setTimeout>;
    removeAbortListener?: () => void;
    /** `readBinary`/`readRange` are excluded from the shared control-request cap. */
    requestClass: "content-read" | "control";
}

interface Acquisition {
    resolve: () => void;
    reject: (reason: Error) => void;
    timer?: ReturnType<typeof setTimeout>;
}

interface ProviderWatchIntent {
    request: ProviderRequest;
    callback: (event: string) => void;
    acknowledged: boolean;
}

interface ServiceLeaseClient {
    boardRoot: string;
    state: "idle" | "attaching" | "attached" | "lost";
    port?: MessagePort;
    generation?: number;
    leaseNonce?: string;
    acquisition?: Promise<void>;
    acquisitionState?: Acquisition;
    pending: Map<string, PendingRequest>;
    capabilities: Map<string, boolean>;
    rangeCapabilities: Map<string, boolean>;
    watchIntents: Map<string, ProviderWatchIntent>;
    requestNumber: number;
    disposed: boolean;
    /** Live count of outstanding `readBinary`/`readRange` requests, pushed by the host via
     *  `content-read-count` (US-1518 decision 10). */
    activeContentReads: number;
}

const clients = new Map<string, ServiceLeaseClient>();
let portSubscription: (() => void) | undefined;
let statusSubscription: (() => void) | undefined;

function normalizeRoot(boardRoot: string): string {
    return fpNormalizeForCompare(boardRoot);
}

function watchKey(subscriptionId: string): string {
    return subscriptionId;
}

function errorForCode(code: string, message = code): Error & { code: string } {
    const error = new Error(message) as Error & { code: string };
    error.code = code || "service-error";
    return error;
}

function serviceError(error: unknown): Error & { code: string } {
    if (typeof error === "string") return errorForCode("service-error", error);
    if (error !== null && typeof error === "object") {
        const value = error as { code?: unknown; message?: unknown };
        if (typeof value.code === "string" && typeof value.message === "string") {
            return errorForCode(value.code, value.message);
        }
        if (typeof value.code === "string") return errorForCode(value.code, errMessage(error, "Service request failed"));
    }
    return errorForCode("service-error", errMessage(error, "Service request failed"));
}

function leaseLossCode(reason: RendererLeaseLostReason): string {
    if (reason === "superseded") return "renderer-reloaded";
    if (reason === "untrusted") return "untrusted";
    if (reason === "quit") return "quit";
    if (reason === "renderer-port-attach-failed") return "service-exited";
    return "service-exited";
}

function statusFailureCode(status: BoardServiceStatus): string | undefined {
    if (status.state === "failed") return "service-failed";
    if (status.state !== "stopping" && status.state !== "stopped") return undefined;
    if (status.reason === "untrusted") return "untrusted";
    if (status.reason === "quit") return "quit";
    if (status.reason === "not-started") return undefined;
    if (status.reason === "permission-denied") return "permission-denied";
    return "service-exited";
}

function ensureInitialized(): void {
    if (!portSubscription) {
        portSubscription = api.onModuleServicePort((payload, port) => receivePort(payload, port));
    }
    if (!statusSubscription) {
        statusSubscription = rendererEvents[EventEndpoint.eModuleServiceStatusChanged].subscribe((status) => {
            const client = clients.get(normalizeRoot(status.boardRoot));
            if (!client) return;
            const code = statusFailureCode(status);
            if (code) loseLease(client, code);
        });
    }
}

function getClient(boardRoot: string): ServiceLeaseClient {
    const key = normalizeRoot(boardRoot);
    let client = clients.get(key);
    if (!client) {
        client = {
            boardRoot,
            state: "idle",
            pending: new Map(),
            capabilities: new Map(),
            rangeCapabilities: new Map(),
            watchIntents: new Map(),
            requestNumber: 0,
            disposed: false,
            activeContentReads: 0,
        };
        clients.set(key, client);
    }
    return client;
}

function receivePort(payload: ModuleServicePortPayload, port: MessagePort): void {
    const client = clients.get(normalizeRoot(payload.boardRoot));
    if (!client || client.disposed || !client.acquisitionState) {
        port.close();
        return;
    }
    if (client.port) loseLease(client, "renderer-reloaded");
    client.port = port;
    client.generation = payload.generation;
    client.leaseNonce = payload.leaseNonce;
    client.state = "attaching";
    port.onmessage = (event: MessageEvent<RendererServiceMessage>) => handleMessage(client, event.data);
    port.onmessageerror = () => loseLease(client, "service-exited");
    port.addEventListener("close", () => {
        if (client.port === port) loseLease(client, "service-exited");
    });
    try {
        port.start();
    } catch {
        loseLease(client, "service-exited");
    }
}

function handleMessage(client: ServiceLeaseClient, message: RendererServiceMessage): void {
    if (!message || typeof message !== "object") return;
    if (message.kind === "hello") {
        if (client.state !== "attaching"
            || message.generation !== client.generation
            || message.leaseNonce !== client.leaseNonce
            || !client.port) {
            loseLease(client, "renderer-reloaded");
            return;
        }
        try {
            client.port.postMessage({
                kind: "hello-ack",
                generation: message.generation,
                leaseNonce: message.leaseNonce,
            } satisfies RendererServiceMessage);
        } catch {
            loseLease(client, "service-exited");
            return;
        }
        client.state = "attached";
        const acquisition = client.acquisitionState;
        if (acquisition) {
            if (acquisition.timer) clearTimeout(acquisition.timer);
            client.acquisitionState = undefined;
            acquisition.resolve();
        }
        void replayWatchIntents(client);
        return;
    }
    if (message.kind === "provider-capabilities") {
        if (client.state === "attached" && typeof message.type === "string") {
            client.capabilities.set(message.type, message.writable === true);
            client.rangeCapabilities.set(message.type, message.rangeReadable === true);
        }
        return;
    }
    if (message.kind === "provider-event") {
        if (client.state !== "attached" || typeof message.subscriptionId !== "string") return;
        const intent = client.watchIntents.get(watchKey(message.subscriptionId));
        if (!intent || !intent.acknowledged) return;
        try {
            intent.callback(message.event);
        } catch (error: unknown) {
            console.error(`Provider watch callback failed: ${errMessage(error)}`);
        }
        return;
    }
    if (message.kind === "lease-lost") {
        loseLease(client, leaseLossCode(message.reason));
        return;
    }
    if (message.kind === "content-read-count") {
        client.activeContentReads = typeof message.count === "number" && message.count >= 0
            ? message.count
            : client.activeContentReads;
        return;
    }
    if (message.kind !== "response") return;
    const pending = client.pending.get(message.requestId);
    if (!pending) return;
    dropPending(client, message.requestId);
    if ("error" in message) {
        pending.reject(serviceError(message.error));
    } else {
        pending.resolve(message.result);
    }
}

function dropPending(
    client: ServiceLeaseClient,
    requestId: string,
    notifyHost = false,
): PendingRequest | undefined {
    const pending = client.pending.get(requestId);
    if (!pending) return undefined;
    client.pending.delete(requestId);
    if (pending.timer) clearTimeout(pending.timer);
    pending.removeAbortListener?.();
    if (notifyHost && client.port && client.state === "attached") {
        try {
            client.port.postMessage({ kind: "cancel", requestId } satisfies RendererServiceMessage);
        } catch {
            // The port may already be gone; lease cleanup will settle any remaining requests.
        }
    }
    return pending;
}

function rejectPending(client: ServiceLeaseClient, code: string): void {
    for (const requestId of client.pending.keys()) {
        const pending = dropPending(client, requestId);
        pending?.reject(errorForCode(code));
    }
}

function loseLease(client: ServiceLeaseClient, code: string): void {
    if (client.state === "lost" && !client.acquisitionState && !client.port) return;
    const port = client.port;
    client.port = undefined;
    client.state = "lost";
    client.capabilities.clear();
    client.rangeCapabilities.clear();
    client.activeContentReads = 0;
    for (const intent of client.watchIntents.values()) intent.acknowledged = false;
    if (port) {
        port.onmessage = null;
        port.onmessageerror = null;
        try {
            port.close();
        } catch {
            // The browser may already have closed the endpoint.
        }
    }
    const acquisition = client.acquisitionState;
    if (acquisition) {
        if (acquisition.timer) clearTimeout(acquisition.timer);
        client.acquisitionState = undefined;
        acquisition.reject(errorForCode(code));
    }
    rejectPending(client, code);
}

function acquire(boardRoot: string): Promise<void> {
    ensureInitialized();
    const client = getClient(boardRoot);
    if (client.state === "attached" && client.port) return Promise.resolve();
    if (client.acquisition) return client.acquisition;

    const acquisition = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
            loseLease(client, "service-timeout");
        }, SERVICE_REQUEST_DEADLINE_MS);
        client.acquisitionState = { resolve, reject, timer };
    });
    client.acquisition = acquisition;
    acquisition.then(
        () => {
            if (client.acquisition === acquisition) client.acquisition = undefined;
        },
        () => {
            if (client.acquisition === acquisition) client.acquisition = undefined;
        },
    );
    void api.requestModuleServicePort(boardRoot).then((result) => {
        if (result.ok === false) loseLease(client, result.error.code);
    }, (error: unknown) => {
        loseLease(client, serviceError(error).code);
    });
    return acquisition;
}

function request(
    boardRoot: string,
    message: ProviderRequest,
    signal?: AbortSignal,
): Promise<unknown> {
    if (typeof boardRoot !== "string" || boardRoot.length === 0) {
        return Promise.reject(errorForCode("service-not-declared"));
    }
    ensureInitialized();
    const client = getClient(boardRoot);
    const policy = PROVIDER_OPERATION_POLICY[message.operation];
    if (policy.requestClass === "control") {
        let controlCount = 0;
        for (const pending of client.pending.values()) {
            if (pending.requestClass === "control") controlCount++;
        }
        if (controlCount >= MAX_OUTSTANDING_REQUESTS_PER_SERVICE) {
            return Promise.reject(errorForCode("service-busy"));
        }
    }
    const requestId = `renderer-${++client.requestNumber}`;
    return new Promise<unknown>((resolve, reject) => {
        const timer = policy.deadlineMs === undefined ? undefined : setTimeout(() => {
            const pending = dropPending(client, requestId, true);
            pending?.reject(errorForCode("service-timeout"));
        }, policy.deadlineMs);
        const onAbort = (): void => {
            const pending = dropPending(client, requestId, true);
            pending?.reject(errorForCode("provider-cancelled"));
        };
        if (signal) signal.addEventListener("abort", onAbort, { once: true });
        client.pending.set(requestId, {
            resolve,
            reject,
            timer,
            requestClass: policy.requestClass,
            removeAbortListener: signal ? () => signal.removeEventListener("abort", onAbort) : undefined,
        });
        if (signal?.aborted) {
            onAbort();
            return;
        }
        void acquire(boardRoot).then(() => {
            const pending = client.pending.get(requestId);
            if (!pending || !client.port || client.state !== "attached") return;
            try {
                client.port.postMessage({ kind: "request", requestId, message } satisfies RendererServiceMessage);
            } catch {
                loseLease(client, "service-exited");
            }
        }, (error: unknown) => {
            const pending = client.pending.get(requestId);
            if (!pending) return;
            const dropped = dropPending(client, requestId);
            dropped?.reject(serviceError(error));
        });
    });
}

function isWatchAcknowledgement(result: unknown): boolean {
    if (!result || typeof result !== "object") return false;
    const candidate = result as { kind?: unknown; operation?: unknown; ok?: unknown };
    return candidate.kind === "provider-result"
        && candidate.operation === "watchSubscribe"
        && candidate.ok === true;
}

function replayWatchIntents(client: ServiceLeaseClient): void {
    for (const [subscriptionId, intent] of client.watchIntents) {
        intent.acknowledged = false;
        void request(client.boardRoot, intent.request).then(
            (result) => {
                const current = client.watchIntents.get(subscriptionId);
                if (!current) {
                    if (isWatchAcknowledgement(result)) {
                        void request(client.boardRoot, {
                            ...intent.request,
                            operation: "watchUnsubscribe",
                        }).catch((): undefined => undefined);
                    }
                    return;
                }
                current.acknowledged = isWatchAcknowledgement(result);
            },
            () => {
                // Keep the caller-owned intent for a later lease. This attempt has settled.
            },
        );
    }
}

function subscribeProvider(
    boardRoot: string,
    requestMessage: ProviderRequest,
    callback: (event: string) => void,
): () => void {
    ensureInitialized();
    const client = getClient(boardRoot);
    const subscriptionId = requestMessage.subscriptionId;
    if (!subscriptionId) return (): void => undefined;
    const key = watchKey(subscriptionId);
    const intent: ProviderWatchIntent = {
        request: requestMessage,
        callback,
        acknowledged: false,
    };
    client.watchIntents.set(key, intent);
    void request(boardRoot, requestMessage).then(
        (result) => {
            const current = client.watchIntents.get(key);
            if (!current) {
                if (isWatchAcknowledgement(result)) {
                    void request(boardRoot, {
                        ...requestMessage,
                        operation: "watchUnsubscribe",
                    }).catch((): undefined => undefined);
                }
                return;
            }
            current.acknowledged = isWatchAcknowledgement(result);
        },
        () => {
            // A missing service or port is a settled subscribe attempt, not a retained Promise.
        },
    );

    let disposed = false;
    return () => {
        if (disposed) return;
        disposed = true;
        const current = client.watchIntents.get(key);
        if (!current) return;
        client.watchIntents.delete(key);
        if (current.acknowledged) {
            void request(boardRoot, {
                ...requestMessage,
                operation: "watchUnsubscribe",
            }).catch((): undefined => undefined);
        }
    };
}

function providerWritable(boardRoot: string, type: string): boolean | undefined {
    const client = clients.get(normalizeRoot(boardRoot));
    return client?.capabilities.get(type);
}

function providerRangeReadable(boardRoot: string, type: string): boolean | undefined {
    const client = clients.get(normalizeRoot(boardRoot));
    return client?.rangeCapabilities.get(type);
}

/** Live count of `readBinary`/`readRange` requests currently outstanding against this board's
 *  service (US-1518 decision 10). Mirrors `providerWritable()`/`providerRangeReadable()`'s shape —
 *  a plain getter, no new subscription primitive. */
function activeContentReads(boardRoot: string): number {
    return clients.get(normalizeRoot(boardRoot))?.activeContentReads ?? 0;
}

function dispose(): void {
    portSubscription?.();
    statusSubscription?.();
    portSubscription = undefined;
    statusSubscription = undefined;
    for (const client of clients.values()) {
        client.disposed = true;
        loseLease(client, "quit");
    }
    clients.clear();
}

export const moduleService = {
    acquire,
    request,
    subscribeProvider,
    providerWritable,
    providerRangeReadable,
    activeContentReads,
    dispose,
};
