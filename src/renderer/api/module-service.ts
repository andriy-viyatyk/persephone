import { BoardRoot } from "../../shared/board/board-root";
import type { ModuleServicePortPayload } from "../../ipc/api-types";
import {
    MAX_OUTSTANDING_REQUESTS_PER_SERVICE,
    LEASE_LOST_CODE,
    PROVIDER_OPERATION_POLICY,
    SERVICE_REQUEST_DEADLINE_MS,
    STOP_REASON_CODE,
    type BoardServiceStatus,
    type ProviderRequest,
    type ProviderWireStatus,
    type RendererServiceMessage,
} from "../../ipc/module-service-channels";
import { api } from "../../ipc/renderer/api";
import { errMessage } from "../../shared/utils";
import { codedError, toCodedError } from "../../shared/coded-error";
import { moduleServiceStatus } from "./module-service-status";

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

interface ProviderStatusIntent {
    request: ProviderRequest;
    callback: (status: ProviderWireStatus | null) => void;
    acknowledged: boolean;
}

interface ServiceLeaseClient {
    boardRoot: string;
    unsubscribeStatus: () => void;
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
    statusIntents: Map<string, ProviderStatusIntent>;
    requestNumber: number;
    disposed: boolean;
    /** Live count of outstanding `readBinary`/`readRange` requests, pushed by the host via
     *  `content-read-count` event. */
    activeContentReads: number;
}

const clients = new Map<string, ServiceLeaseClient>();
let portSubscription: (() => void) | undefined;

function serviceError(error: unknown): Error & { code: string } {
    if (typeof error === "string") return codedError("service-error", error);
    const coded = toCodedError(error, "service-error", { fallbackMessage: "Service request failed" });
    return codedError(coded.code || "service-error", coded.message);
}

function statusFailureCode(status: BoardServiceStatus): string | undefined {
    if (status.state === "failed") return "service-failed";
    if (status.state !== "stopping" && status.state !== "stopped") return undefined;
    if (status.reason === "untrusted" || status.reason === "quit" || status.reason === "explicit") {
        return STOP_REASON_CODE[status.reason];
    }
    if (status.reason === "not-started") return undefined;
    if (status.reason === "permission-denied") return "permission-denied";
    return "service-exited";
}

function ensureInitialized(): void {
    if (!portSubscription) {
        portSubscription = api.onModuleServicePort((payload, port) => receivePort(payload, port));
    }
}

function getClient(boardRoot: string): ServiceLeaseClient {
    const key = BoardRoot.from(boardRoot).key;
    let client = clients.get(key);
    if (!client) {
        const createdClient: ServiceLeaseClient = {
            boardRoot,
            unsubscribeStatus: () => undefined,
            state: "idle",
            pending: new Map(),
            capabilities: new Map(),
            rangeCapabilities: new Map(),
            watchIntents: new Map(),
            statusIntents: new Map(),
            requestNumber: 0,
            disposed: false,
            activeContentReads: 0,
        };
        createdClient.unsubscribeStatus = moduleServiceStatus.subscribe(boardRoot, (status) => {
            const code = statusFailureCode(status);
            if (code) loseLease(createdClient, code);
        });
        clients.set(key, createdClient);
        client = createdClient;
    }
    return client;
}

function receivePort(payload: ModuleServicePortPayload, port: MessagePort): void {
    const client = clients.get(BoardRoot.from(payload.boardRoot).key);
    if (!client || client.disposed || !client.acquisitionState) {
        port.close();
        return;
    }
    if (client.port) loseLease(client, "renderer-reloaded");
    client.port = port;
    client.generation = payload.generation;
    client.leaseNonce = payload.leaseNonce;
    client.state = "attaching";
    port.onmessage = (event: MessageEvent<RendererServiceMessage>) => {
        if (client.port === port && client.generation === payload.generation) handleMessage(client, event.data);
    };
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
        const intent = client.watchIntents.get(message.subscriptionId);
        if (!intent || !intent.acknowledged) return;
        try {
            intent.callback(message.event);
        } catch (error: unknown) {
            console.error(`Provider watch callback failed: ${errMessage(error)}`);
        }
        return;
    }
    if (message.kind === "provider-status-event") {
        if (client.state !== "attached" || typeof message.subscriptionId !== "string") return;
        const intent = client.statusIntents.get(message.subscriptionId);
        if (!intent || !intent.acknowledged) return;
        try {
            intent.callback(message.status);
        } catch (error: unknown) {
            console.error(`Provider status callback failed: ${errMessage(error)}`);
        }
        return;
    }
    if (message.kind === "lease-lost") {
        loseLease(client, LEASE_LOST_CODE[message.reason]);
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
        pending?.reject(codedError(code || "service-error"));
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
    for (const intent of client.statusIntents.values()) {
        intent.acknowledged = false;
        try {
            intent.callback(null);
        } catch (error: unknown) {
            console.error(`Provider status clear callback failed: ${errMessage(error)}`);
        }
    }
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
        acquisition.reject(codedError(code || "service-error"));
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
            return Promise.reject(codedError("service-not-declared"));
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
            return Promise.reject(codedError("service-busy"));
        }
    }
    const requestId = `renderer-${++client.requestNumber}`;
    return new Promise<unknown>((resolve, reject) => {
        const timer = policy.deadlineMs === undefined ? undefined : setTimeout(() => {
            const pending = dropPending(client, requestId, true);
            pending?.reject(codedError("service-timeout"));
        }, policy.deadlineMs);
        const onAbort = (): void => {
            const pending = dropPending(client, requestId, true);
            pending?.reject(codedError("provider-cancelled"));
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

function isStatusAcknowledgement(result: unknown, operation: "statusSubscribe" | "statusUnsubscribe"): boolean {
    if (!result || typeof result !== "object") return false;
    const candidate = result as { kind?: unknown; operation?: unknown; ok?: unknown };
    return candidate.kind === "provider-result" && candidate.operation === operation && candidate.ok === true;
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
    for (const [subscriptionId, intent] of client.statusIntents) {
        intent.acknowledged = false;
        void request(client.boardRoot, intent.request).then(
            (result) => {
                const current = client.statusIntents.get(subscriptionId);
                if (!current) {
                    if (isStatusAcknowledgement(result, "statusSubscribe")) {
                        void request(client.boardRoot, { ...intent.request, operation: "statusUnsubscribe" })
                            .catch((): undefined => undefined);
                    }
                    return;
                }
                current.acknowledged = isStatusAcknowledgement(result, "statusSubscribe");
            },
            (): undefined => undefined,
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
    const key = subscriptionId;
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

function subscribeProviderStatus(
    boardRoot: string,
    requestMessage: ProviderRequest,
    callback: (status: ProviderWireStatus | null) => void,
): () => void {
    ensureInitialized();
    const client = getClient(boardRoot);
    const subscriptionId = requestMessage.subscriptionId;
    if (!subscriptionId) return (): void => undefined;
    const intent: ProviderStatusIntent = { request: requestMessage, callback, acknowledged: false };
    client.statusIntents.set(subscriptionId, intent);
    // Status only observes: it must not start a board service on its own (a badge mounts on a
    // restored page before anything reads it). Without a live lease the intent waits and is
    // sent by `replayWatchIntents` once a read attaches one.
    if (client.state === "attached" && client.port) {
        void request(boardRoot, requestMessage).then(
            (result) => {
                const current = client.statusIntents.get(subscriptionId);
                if (!current) {
                    if (isStatusAcknowledgement(result, "statusSubscribe")) {
                        void request(boardRoot, { ...requestMessage, operation: "statusUnsubscribe" })
                            .catch((): undefined => undefined);
                    }
                    return;
                }
                current.acknowledged = isStatusAcknowledgement(result, "statusSubscribe");
            },
            (): undefined => undefined,
        );
    }
    let disposed = false;
    return () => {
        if (disposed) return;
        disposed = true;
        const current = client.statusIntents.get(subscriptionId);
        if (!current) return;
        client.statusIntents.delete(subscriptionId);
        if (current.acknowledged) {
            void request(boardRoot, { ...requestMessage, operation: "statusUnsubscribe" })
                .catch((): undefined => undefined);
        }
    };
}

function providerWritable(boardRoot: string, type: string): boolean | undefined {
    const client = clients.get(BoardRoot.from(boardRoot).key);
    return client?.capabilities.get(type);
}

function providerRangeReadable(boardRoot: string, type: string): boolean | undefined {
    const client = clients.get(BoardRoot.from(boardRoot).key);
    return client?.rangeCapabilities.get(type);
}

/** Live count of `readBinary`/`readRange` requests currently outstanding against this board's
 *  service. Mirrors `providerWritable`/`providerRangeReadable`'s shape —
 *  a plain getter, no new subscription primitive. */
function activeContentReads(boardRoot: string): number {
    return clients.get(BoardRoot.from(boardRoot).key)?.activeContentReads ?? 0;
}

function dispose(): void {
    portSubscription?.();
    portSubscription = undefined;
    for (const client of clients.values()) {
        client.unsubscribeStatus();
        client.disposed = true;
        loseLease(client, "quit");
    }
    clients.clear();
}

export const moduleService = {
    acquire,
    request,
    subscribeProvider,
    subscribeProviderStatus,
    providerWritable,
    providerRangeReadable,
    activeContentReads,
    dispose,
};
