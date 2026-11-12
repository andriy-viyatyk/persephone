import { AsyncLocalStorage } from "node:async_hooks";
import type { MessagePortMain } from "electron";
import type { CapabilityClientInvoke, CapabilityClientOptions, CapabilityClientResult, CapabilityKey, CapabilityProvider } from "../ipc/capability-bus-channels";
import type { ServiceHostConfig, ServiceMainMessage, ServiceParentMessage } from "../ipc/module-service-channels";
import { createCapabilityProxy, type CapabilityProxy } from "../shared/capability-client";
import { isCapabilityErrorCode } from "../shared/capability-constants";
import type { CapabilityErrorCode, CapabilityJson } from "../shared/capability-contract";
import { errMessage } from "../shared/utils";
import { isRecord } from "./validation";
import type { CapabilityHandler } from "./service-api";
import type { ServiceChannelManager } from "./service-channels";

type CapabilityClientRequest =
    | { kind: "capability-client-discover"; id?: string }
    | { kind: "capability-client-resolve"; id: string; options?: CapabilityClientOptions }
    | { kind: "capability-client-invoke"; request: Omit<CapabilityClientInvoke, "requestId"> };

interface CapabilityClientPending {
    resolve(value: unknown): void;
    reject(error: unknown): void;
    channel: boolean;
    result: CapabilityClientResult<unknown> | undefined;
    port: MessagePortMain | undefined;
    cleanup(): void;
}

export interface CapabilityHost {
    list(): Promise<unknown>;
    providers(id: string): Promise<unknown>;
    getCapability(id: string, options?: CapabilityClientOptions): Promise<CapabilityProxy | null>;
    registerHandler(id: string, method: string, handler: CapabilityHandler): () => void;
    handleResult(requestId: string, result: unknown): boolean;
    handlePort(requestId: string, port: MessagePortMain | undefined): boolean;
    handleCall(message: Extract<ServiceParentMessage, { kind: "capability-call" }>): void;
    handleCancel(requestId: string, reason: unknown): void;
    finishStartup(): void;
    cleanup(): void;
    isCallMessage(value: Record<string, unknown>): value is Extract<ServiceParentMessage, { kind: "capability-call" }>;
}

export function createCapabilityHost(dependencies: {
    config(): ServiceHostConfig;
    post(message: ServiceMainMessage): void;
    nextSequence(): number;
    channels: ServiceChannelManager;
}): CapabilityHost {
    const handlers = new Map<string, CapabilityHandler>();
    const requests = new Map<string, AbortController>();
    const clientRequests = new Map<string, CapabilityClientPending>();
    const context = new AsyncLocalStorage<{ parentRequestId: string; signal: AbortSignal }>();
    let startupComplete = false;

    function request(request: CapabilityClientRequest, channel: boolean = false): Promise<unknown> {
        const requestId = `capability-client-${dependencies.nextSequence()}`;
        const currentContext = context.getStore();
        return new Promise((resolve: (value: unknown) => void, reject: (reason: unknown) => void): void => {
            const pending: CapabilityClientPending = { resolve, reject, channel, result: undefined, port: undefined, cleanup: (): void => undefined };
            const cancel = (): void => {
                if (!clientRequests.delete(requestId)) return;
                try { dependencies.post({ kind: "capability-client-cancel", requestId }); } catch { /* Parent exited. */ }
                pending.port?.close();
                reject(Object.assign(new Error("Capability request cancelled."), { code: "cancelled" }));
            };
            pending.cleanup = (): void => currentContext?.signal.removeEventListener("abort", cancel);
            clientRequests.set(requestId, pending);
            currentContext?.signal.addEventListener("abort", cancel, { once: true });
            if (currentContext?.signal.aborted) { cancel(); return; }
            try {
                if (request.kind === "capability-client-invoke") {
                    dependencies.post({ kind: request.kind, request: { ...request.request, requestId }, ...(currentContext ? { parentRequestId: currentContext.parentRequestId } : {}) });
                } else {
                    dependencies.post({ ...request, requestId });
                }
            } catch (error: unknown) {
                clientRequests.delete(requestId);
                pending.cleanup();
                reject(error);
            }
        });
    }

    function settleClient(requestId: string): void {
        const pending = clientRequests.get(requestId);
        if (!pending || !pending.result || (pending.result.ok && pending.channel && !pending.port)) return;
        clientRequests.delete(requestId);
        pending.cleanup();
        if (pending.result.ok === false) {
            pending.port?.close();
            pending.reject(Object.assign(new Error(pending.result.error.message), { code: pending.result.error.code }));
        } else if (pending.channel) {
            const port = pending.port;
            if (!port) return;
            pending.resolve(dependencies.channels.make(`client:${requestId}`, port, "capability"));
        } else {
            pending.resolve(pending.result.value);
        }
    }

    function isCapabilityProvider(value: unknown): value is CapabilityProvider {
        return isRecord(value)
            && typeof value.id === "string"
            && typeof value.version === "number"
            && typeof value.provider === "string"
            && typeof value.handlerKey === "string"
            && isRecord(value.methods)
            && Object.values(value.methods).every((method: unknown): boolean => isRecord(method)
                && (method.kind === "call" || method.kind === "channel"));
    }

    function handleResult(requestId: string, result: unknown): boolean {
        if (!isRecord(result) || typeof result.ok !== "boolean"
            || (result.ok && !("value" in result))
            || (!result.ok && (!isRecord(result.error) || !isCapabilityErrorCode(result.error.code) || typeof result.error.message !== "string"))) return false;
        const pending = clientRequests.get(requestId);
        if (!pending) return true;
        // Runtime validation above establishes the wire result shape.
        pending.result = result as unknown as CapabilityClientResult<unknown>;
        settleClient(requestId);
        return true;
    }

    function handlePort(requestId: string, port: MessagePortMain | undefined): boolean {
        const pending = clientRequests.get(requestId);
        if (pending && pending.channel && port) {
            pending.port = port;
            settleClient(requestId);
        } else {
            port?.close();
        }
        return true;
    }

    function isCallMessage(value: Record<string, unknown>): value is Extract<ServiceParentMessage, { kind: "capability-call" }> {
        return value.kind === "capability-call" && typeof value.requestId === "string"
            && typeof value.id === "string" && typeof value.version === "number" && typeof value.method === "string"
            && Array.isArray(value.args) && isRecord(value.caller)
            && typeof value.caller.id === "string" && typeof value.caller.name === "string"
            && ["board-page", "board-service", "platform", "agent"].includes(String(value.caller.kind))
            && typeof value.deadlineAt === "number" && isRecord(value.context)
            && typeof value.context.requestId === "string" && Array.isArray(value.context.chain)
            && typeof value.context.depth === "number";
    }

    async function runCall(message: Extract<ServiceParentMessage, { kind: "capability-call" }>): Promise<void> {
        const { requestId, id, version, method } = message;
        if (requests.has(requestId)) return;
        const declared = dependencies.config().capabilityCalls.some((entry): boolean => entry.id === id && entry.version === version && entry.method === method);
        const handler = declared && handlers.get(JSON.stringify([id, method]));
        if (!handler) {
            dependencies.post({ kind: "capability-result", requestId, error: { code: "no-handler", message: "Capability handler is not registered." } });
            return;
        }
        const controller = new AbortController();
        requests.set(requestId, controller);
        try {
            const result = await context.run({ parentRequestId: requestId, signal: controller.signal }, (): unknown => handler(message.args, {
                signal: controller.signal,
                caller: message.caller,
                requestId: message.context.requestId,
                chain: message.context.chain,
                depth: message.context.depth,
                originatingWindowId: message.context.originatingWindowId,
            }));
            if (requests.get(requestId) === controller) {
                // Preserve the existing serializable capability result pass-through at this wire boundary.
                dependencies.post({ kind: "capability-result", requestId, result: result as CapabilityJson });
            }
        } catch (error: unknown) {
            if (requests.get(requestId) === controller) {
                const errorCode = isRecord(error) ? error.code : undefined;
                const coded = isCapabilityErrorCode(errorCode);
                const code: CapabilityErrorCode = coded ? errorCode : "rejected";
                try { dependencies.post({ kind: "capability-result", requestId, error: { code, message: coded ? errMessage(error, code) : "Capability handler rejected the request." } }); } catch { /* Parent exited. */ }
            }
        } finally {
            if (requests.get(requestId) === controller) requests.delete(requestId);
        }
    }

    return {
        list: (): Promise<unknown> => request({ kind: "capability-client-discover" }),
        providers: (id: string): Promise<unknown> => request({ kind: "capability-client-discover", id }),
        async getCapability(id, options): Promise<CapabilityProxy | null> {
            const result = await request({ kind: "capability-client-resolve", id, options });
            if (result === null || result === undefined) return null;
            if (!isCapabilityProvider(result)) throw Object.assign(new Error("Capability provider response was malformed."), { code: "service-error" });
            const provider = result;
            const key: CapabilityKey = { id: provider.id, version: provider.version, provider: provider.provider, handlerKey: provider.handlerKey };
            const filter = options?.filter && { ...options.filter };
            return createCapabilityProxy(provider, (method: string, args: unknown[]): Promise<unknown> => request({
                kind: "capability-client-invoke",
                request: { key, filter, method, args },
            }, provider.methods[method].kind === "channel"));
        },
        registerHandler(id, method, handler): () => void {
            if (startupComplete) throw new Error("Capability handlers must be registered before the service entry module finishes startup.");
            if (typeof handler !== "function") throw new TypeError("Capability handler must be a function.");
            if (!dependencies.config().capabilityCalls.some((entry): boolean => entry.id === id && entry.method === method)) throw new Error("Capability call method is not declared.");
            const key = JSON.stringify([id, method]);
            if (handlers.has(key)) throw new Error("Capability handler is already registered.");
            handlers.set(key, handler);
            return (): void => { if (handlers.get(key) === handler) handlers.delete(key); };
        },
        handleResult,
        handlePort,
        handleCall(message): void { void runCall(message); },
        handleCancel(requestId, reason): void {
            const controller = requests.get(requestId);
            if (controller) { requests.delete(requestId); controller.abort(reason); }
        },
        finishStartup(): void { startupComplete = true; },
        cleanup(): void {
            for (const pending of clientRequests.values()) {
                pending.cleanup();
                pending.port?.close();
                pending.reject(Object.assign(new Error("The service has exited."), { code: "handler-closed" }));
            }
            clientRequests.clear();
            for (const controller of requests.values()) controller.abort();
            requests.clear();
        },
        isCallMessage,
    };
}
