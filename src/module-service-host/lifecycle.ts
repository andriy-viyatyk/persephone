import type { ServiceHostConfig, ServiceMainMessage, ServiceParentMessage } from "../ipc/module-service-channels";
import { codedError } from "../shared/coded-error";
import { errMessage } from "../shared/utils";
import { validateHostConfig } from "./validation";

type LifecycleMessage = Extract<ServiceParentMessage, { kind: "init" | "probe" | "request" | "shutdown" }>;
type ServiceRequestHandler = (message: unknown) => unknown | Promise<unknown>;
type ShutdownHandler = (context: { reason: string }) => unknown | Promise<unknown>;

export interface HostLifecycle {
    readonly configReady: Promise<ServiceHostConfig>;
    get config(): ServiceHostConfig;
    get nonce(): number | undefined;
    get entryLoaded(): boolean;
    get hasRequestHandler(): boolean;
    acceptInit(nonce: number, config: unknown): void;
    handleLifecycle(message: LifecycleMessage): void;
    completeEntryImport(): void;
    registerRequestHandler(handler: ServiceRequestHandler): void;
    registerShutdownHandler(handler: ShutdownHandler): void;
}

export function createHostLifecycle(dependencies: {
    post(message: ServiceMainMessage): void;
    exit(code: number): never;
    serviceError(error: unknown): { code: string; message: string };
    closeSettings(): void;
    failSettings(error: Error): void;
    closeChannels(): void;
    revokeEndpoints(): Promise<boolean>;
}): HostLifecycle {
    let hostConfig: ServiceHostConfig | undefined;
    let resolveConfig: ((config: ServiceHostConfig) => void) | undefined;
    const configReady = new Promise<ServiceHostConfig>((resolve): void => { resolveConfig = resolve; });
    let initNonce: number | undefined;
    let entryLoaded = false;
    let readySent = false;
    let shutdownStarted = false;
    let serviceRequestHandler: ServiceRequestHandler | undefined;
    const shutdownHandlers: ShutdownHandler[] = [];

    async function runServiceRequest(message: Extract<ServiceParentMessage, { kind: "request" }>): Promise<void> {
        if (typeof message.requestId !== "string") return;
        if (typeof serviceRequestHandler !== "function") {
            postError(message.requestId, { code: "service-handler-not-registered", message: "The service entry did not register an onRequest handler." });
            return;
        }
        try {
            postResult(message.requestId, await serviceRequestHandler(message.message));
        } catch (error: unknown) {
            postError(message.requestId, dependencies.serviceError(error));
        }
    }

    function postResult(requestId: string, result: unknown): void {
        try { dependencies.post({ kind: "response", requestId, result }); }
        catch (error: unknown) { console.error("Failed to post module service response:", errMessage(error, "service-exited")); }
    }

    function postError(requestId: string, error: { code: string; message: string } | string): void {
        try { dependencies.post({ kind: "response", requestId, error }); }
        catch (postErrorValue: unknown) {
            console.error("Failed to post module service error:", errMessage(postErrorValue, "service-exited"));
        }
    }

    async function runShutdown(message: Extract<ServiceParentMessage, { kind: "shutdown" }>): Promise<void> {
        if (shutdownStarted) return;
        shutdownStarted = true;
        dependencies.closeSettings();
        dependencies.failSettings(codedError("service-exited", "The service has exited."));
        dependencies.closeChannels();
        let failed = await dependencies.revokeEndpoints();
        for (const handler of shutdownHandlers) {
            try {
                await handler({ reason: message.reason });
            } catch (error: unknown) {
                failed = true;
                console.error("Module service shutdown callback failed:", errMessage(error, "service-error"));
            }
        }
        dependencies.exit(failed ? 1 : 0);
    }

    return {
        configReady,
        get config(): ServiceHostConfig {
            if (!hostConfig) throw new Error("Module service host has not received init configuration.");
            return hostConfig;
        },
        get nonce(): number | undefined {
            return initNonce;
        },
        get entryLoaded(): boolean {
            return entryLoaded;
        },
        get hasRequestHandler(): boolean {
            return serviceRequestHandler !== undefined;
        },
        acceptInit(nonce, config): void {
            if (!validateHostConfig(config)) {
                console.error("Persephone module service host received invalid init configuration.");
                dependencies.exit(1);
                return;
            }
            hostConfig = config;
            initNonce = nonce;
            resolveConfig?.(hostConfig);
        },
        handleLifecycle(message): void {
            if (message.kind === "init" && message.nonce === initNonce && entryLoaded && !readySent) {
                readySent = true;
                dependencies.post({ kind: "ready", nonce: initNonce });
            } else if (message.kind === "probe" && message.nonce === initNonce) {
                dependencies.post({ kind: "probe-ack", nonce: initNonce });
            } else if (message.kind === "request") {
                void runServiceRequest(message);
            } else if (message.kind === "shutdown" && message.nonce === initNonce) {
                void runShutdown(message);
            }
        },
        completeEntryImport(): void {
            entryLoaded = true;
        },
        registerRequestHandler(handler): void {
            if (typeof serviceRequestHandler !== "undefined") throw new Error("A service request handler is already registered.");
            serviceRequestHandler = handler;
        },
        registerShutdownHandler(handler): void {
            shutdownHandlers.push(handler);
        },
    };
}
