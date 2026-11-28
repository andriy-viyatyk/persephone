import type { CapabilityClientOptions } from "../ipc/capability-bus-channels";
import type { ServiceMainMessage } from "../ipc/module-service-channels";
import { codedError } from "../shared/coded-error";
import type { CapabilityProxy } from "../shared/capability-client";
import { errMessage } from "../shared/utils";
import type { MainRequestClients } from "./main-requests";
import type { CapabilityHost } from "./capabilities";
import type { HostLifecycle } from "./lifecycle";
import type { ProtocolMode } from "./raw-protocol-compat";
import type { ServiceChannelManager } from "./service-channels";
import type { ProviderDispatch } from "./provider-dispatch";
import type { TreeProviderDispatch } from "./tree-provider-dispatch";
import { isRecord } from "./validation";

export interface McpSessionEndpoint {
    url: string;
    headers: Record<string, string>;
    token: string;
    revoke(): Promise<void>;
}

interface McpSessionGrant {
    url: string;
    token: string;
    headers: Record<string, string>;
}

export interface CapabilityHandlerContext {
    signal: AbortSignal;
    caller: import("../shared/capability-contract").CapabilityCallerIdentity;
    requestId?: string;
    chain?: string[];
    depth?: number;
    originatingWindowId?: number;
}

export type CapabilityHandler = (args: unknown[], context: CapabilityHandlerContext) => unknown | Promise<unknown>;
export type ServiceRequestHandler = (message: unknown) => unknown | Promise<unknown>;
export type ServiceChannelHandler = (channel: import("../shared/service-channel").ServiceChannel, openMessage: unknown, info: unknown) => unknown | Promise<unknown>;
export type ServiceShutdownHandler = (context: { reason: string }) => unknown | Promise<unknown>;

export interface TreeProviderStatResult {
    exists: boolean;
    isDirectory: boolean;
    size?: number;
    mtime?: string;
    /** Required on existing entries for transfer; file and directory symlinks are distinguished. */
    linkKind?: "file" | "directory" | "file-symlink" | "directory-symlink";
    /** Content link for this path; also returned for a not-yet-created destination. */
    href?: string;
    /** Required to move directories; omitted metadata keeps browsing and copying available. */
    deleteMode?: "recursive" | "empty-only";
}

export interface TreeProviderListResult {
    items: unknown;
    truncated: boolean;
    readOnly?: boolean;
}

export interface TreeProviderImplementationDeclaration {
    list(config: Record<string, unknown>, path: string, context: { signal: AbortSignal }): TreeProviderListResult | Promise<TreeProviderListResult>;
    stat(config: Record<string, unknown>, path: string, context: { signal: AbortSignal }): TreeProviderStatResult | Promise<TreeProviderStatResult>;
    mkdir?(config: Record<string, unknown>, path: string): unknown | Promise<unknown>;
    rename?(config: Record<string, unknown>, oldPath: string, newPath: string): unknown | Promise<unknown>;
    delete?(config: Record<string, unknown>, path: string): unknown | Promise<unknown>;
}

export interface PersephoneHostApi {
    settings?: { get(id: string): Promise<string | boolean | number>; onChange(callback: (change: { id: string; value: string | boolean | number }) => void): () => void };
    var?: {
        get(name: string, env?: string): Promise<string | undefined>;
        set(name: string, value: string, env?: string): Promise<void>;
        delete(name: string, env?: string): Promise<void>;
        keys(env?: string): Promise<string[]>;
    };
    storage?: { get(key: unknown): Promise<unknown>; set(key: unknown, value: unknown): Promise<unknown>; delete(key: unknown): Promise<unknown>; keys(): Promise<unknown> };
    providers?: { register(type: string, implementation: unknown): void };
    treeProviders?: { register(type: string, implementation: TreeProviderImplementationDeclaration): void };
    getCapability?: (id: string, options?: CapabilityClientOptions) => Promise<CapabilityProxy | null>;
    capabilities?: { list(): Promise<unknown>; providers(id: string): Promise<unknown>; handle(id: string, method: string, handler: CapabilityHandler): () => void };
    service?: { onRequest(handler: ServiceRequestHandler): void; onChannel(handler: ServiceChannelHandler): void; onShutdown(handler: ServiceShutdownHandler): void };
    mcp?: { issueSessionEndpoint(): Promise<McpSessionEndpoint> };
    [key: string]: unknown;
}

export interface ServiceApi {
    readonly persephone: PersephoneHostApi;
    closeSettings(): void;
    handleSettingsChanged(subscriptionId: unknown, id: unknown, value: unknown): void;
    revokeEndpoints(): Promise<boolean>;
    cleanup(): void;
}

export function createServiceApi(dependencies: {
    requests: MainRequestClients;
    nextSequence(): number;
    protocolMode(): ProtocolMode;
    providers: ProviderDispatch;
    treeProviders: TreeProviderDispatch;
    capabilities: CapabilityHost;
    lifecycle: HostLifecycle;
    channels: ServiceChannelManager;
}): ServiceApi {
    const settingsCallbacks = new Set<(change: { id: string; value: string | boolean | number }) => void>();
    const activeEndpoints = new Set<McpSessionEndpoint>();
    let settingsSubscriptionId: string | undefined;

    function settingsRequest(kind: "board-settings-get", fields: { id: string }): Promise<unknown>;
    function settingsRequest(kind: "board-settings-subscribe" | "board-settings-unsubscribe", fields: { subscriptionId: string }): Promise<unknown>;
    function settingsRequest(kind: "board-settings-get" | "board-settings-subscribe" | "board-settings-unsubscribe", fields: { id: string } | { subscriptionId: string }): Promise<unknown> {
        return dependencies.requests.settings.request((requestId: string): Extract<ServiceMainMessage, { kind: "board-settings-get" | "board-settings-subscribe" | "board-settings-unsubscribe" }> => {
            if (kind === "board-settings-get" && "id" in fields) return { kind, requestId, id: fields.id };
            if (kind !== "board-settings-get" && "subscriptionId" in fields) return { kind, requestId, subscriptionId: fields.subscriptionId };
            throw new TypeError("Invalid board settings request.");
        });
    }

    function boardVarRequest(operation: "get" | "set" | "delete" | "keys", args: unknown[]): Promise<unknown> {
        if (dependencies.protocolMode() === "raw") throw new Error("Board environment variables require the host-managed service API.");
        return dependencies.requests.settings.request((requestId): Extract<ServiceMainMessage, { kind: "board-vars-request" }> => ({
            kind: "board-vars-request", requestId, operation, args,
        }), { noDeadline: true });
    }

    function isStringArray(value: unknown): value is string[] {
        return Array.isArray(value) && value.every((entry: unknown) => typeof entry === "string");
    }

    function subscribeBoardSettings(callback: (change: { id: string; value: string | boolean | number }) => void): () => void {
        if (dependencies.protocolMode() === "raw") throw new Error("Board settings require the host-managed service API.");
        if (typeof callback !== "function") throw new TypeError("settings.onChange(callback) requires a function.");
        settingsCallbacks.add(callback);
        if (settingsCallbacks.size === 1) {
            const subscriptionId = `board-settings-${process.pid}-${Date.now()}-${dependencies.nextSequence()}`;
            settingsSubscriptionId = subscriptionId;
            void settingsRequest("board-settings-subscribe", { subscriptionId }).catch((error: unknown): void => {
                if (settingsSubscriptionId !== subscriptionId) return;
                settingsSubscriptionId = undefined;
                console.error("Board settings subscription failed:", errMessage(error, "service-error"));
            });
        }
        let disposed = false;
        return (): void => {
            if (disposed) return;
            disposed = true;
            settingsCallbacks.delete(callback);
            if (settingsCallbacks.size !== 0 || !settingsSubscriptionId) return;
            const subscriptionId = settingsSubscriptionId;
            settingsSubscriptionId = undefined;
            void settingsRequest("board-settings-unsubscribe", { subscriptionId }).catch((_error: unknown): void => undefined);
        };
    }

    function isBoardSettingValue(value: unknown): value is string | boolean | number {
        return typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));
    }

    function isMcpSessionGrant(value: unknown): value is McpSessionGrant {
        return isRecord(value) && typeof value.url === "string" && typeof value.token === "string"
            && isRecord(value.headers) && Object.values(value.headers).every((header: unknown): boolean => typeof header === "string");
    }

    async function issueSessionEndpoint(): Promise<McpSessionEndpoint> {
        if (dependencies.protocolMode() === "raw") throw new Error("MCP session endpoints require the host service API.");
        const result = await dependencies.requests.mcp.request((requestId: string): Extract<ServiceMainMessage, { kind: "mcp-endpoint-request" }> => ({ kind: "mcp-endpoint-request", requestId, operation: "issue" }));
        if (!isMcpSessionGrant(result)) throw codedError("service-error", "MCP endpoint response was malformed.");
        const grant = result;
        let token = grant.token;
        const headers = { ...grant.headers };
        let revoked = false;
        const handle: McpSessionEndpoint = {
            url: grant.url,
            headers,
            get token(): string { return token; },
            set token(value: string) { token = value; if (!value) headers.Authorization = ""; },
            async revoke(): Promise<void> {
                if (revoked) return;
                revoked = true;
                const currentToken = token;
                handle.token = "";
                activeEndpoints.delete(handle);
                if (currentToken) {
                    await dependencies.requests.mcp.request((requestId: string): Extract<ServiceMainMessage, { kind: "mcp-endpoint-request" }> => ({ kind: "mcp-endpoint-request", requestId, operation: "revoke", token: currentToken }));
                }
            },
        };
        activeEndpoints.add(handle);
        return handle;
    }

    const api = installServiceApi({
        settings: {
            get(id: string): Promise<string | boolean | number> {
                if (dependencies.protocolMode() === "raw") throw new Error("Board settings require the host-managed service API.");
                if (typeof id !== "string" || id.trim().length === 0) return Promise.reject(Object.assign(new Error("Board setting id must be a non-empty string."), { code: "service-error" }));
                return settingsRequest("board-settings-get", { id: id.trim() }).then((value: unknown): string | boolean | number => {
                    if (!isBoardSettingValue(value)) throw Object.assign(new Error("Board setting result must be a finite scalar."), { code: "service-error" });
                    return value;
                });
            },
            onChange: subscribeBoardSettings,
        },
        var: {
            get(name: string, env?: string): Promise<string | undefined> {
                return boardVarRequest("get", [String(name ?? ""), env]).then((value: unknown): string | undefined => {
                    if (value === undefined) return undefined;
                    if (typeof value !== "string") throw codedError("service-error", "Board variable result must be a string or undefined.");
                    return value;
                });
            },
            async set(name: string, value: string, env?: string): Promise<void> {
                const result = await boardVarRequest("set", [String(name ?? ""), String(value ?? ""), env]);
                if (result !== undefined) throw codedError("service-error", "Board variable set result must be void.");
            },
            async delete(name: string, env?: string): Promise<void> {
                const result = await boardVarRequest("delete", [String(name ?? ""), env]);
                if (result !== undefined) throw codedError("service-error", "Board variable delete result must be void.");
            },
            keys(env?: string): Promise<string[]> {
                return boardVarRequest("keys", [env]).then((value: unknown) => {
                    if (!isStringArray(value)) throw codedError("service-error", "Board variable keys result must be a string array.");
                    return value;
                });
            },
        },
        storage: {
            get: (key: unknown): Promise<unknown> => dependencies.requests.storage.request((requestId): Extract<ServiceMainMessage, { kind: "storage-request" }> => ({ kind: "storage-request", requestId, operation: "get", args: [key] })),
            set: (key: unknown, value: unknown): Promise<unknown> => dependencies.requests.storage.request((requestId): Extract<ServiceMainMessage, { kind: "storage-request" }> => ({ kind: "storage-request", requestId, operation: "set", args: [key, value] })),
            delete: (key: unknown): Promise<unknown> => dependencies.requests.storage.request((requestId): Extract<ServiceMainMessage, { kind: "storage-request" }> => ({ kind: "storage-request", requestId, operation: "delete", args: [key] })),
            keys: (): Promise<unknown> => dependencies.requests.storage.request((requestId): Extract<ServiceMainMessage, { kind: "storage-request" }> => ({ kind: "storage-request", requestId, operation: "keys", args: [] })),
        },
        providers: { register: dependencies.providers.register },
        treeProviders: { register: dependencies.treeProviders.register },
        getCapability: dependencies.capabilities.getCapability,
        capabilities: {
            list: dependencies.capabilities.list,
            providers: dependencies.capabilities.providers,
            handle: dependencies.capabilities.registerHandler,
        },
        service: {
            onRequest(handler): void {
                if (typeof handler !== "function") throw new TypeError("onRequest(handler) requires a function.");
                dependencies.lifecycle.registerRequestHandler(handler);
            },
            onChannel(handler): void {
                if (typeof handler !== "function") throw new TypeError("onChannel(handler) requires a function.");
                dependencies.channels.setHandler(handler);
            },
            onShutdown(handler): void {
                if (typeof handler !== "function") throw new TypeError("onShutdown(fn) requires a function.");
                dependencies.lifecycle.registerShutdownHandler(handler);
            },
        },
        mcp: { issueSessionEndpoint },
    });

    return {
        persephone: api,
        closeSettings(): void {
            settingsCallbacks.clear();
            settingsSubscriptionId = undefined;
        },
        handleSettingsChanged(subscriptionId, id, value): void {
            if (subscriptionId !== settingsSubscriptionId || typeof id !== "string" || !isBoardSettingValue(value)) return;
            const change = { id, value };
            for (const callback of [...settingsCallbacks]) {
                try { callback(change); }
                catch (error: unknown) { console.error("Board settings callback failed:", errMessage(error, "service-error")); }
            }
        },
        async revokeEndpoints(): Promise<boolean> {
            let failed = false;
            for (const endpoint of [...activeEndpoints]) {
                try { await endpoint.revoke(); }
                catch (error: unknown) { failed = true; console.error("MCP endpoint revocation failed:", errMessage(error, "service-error")); }
            }
            return failed;
        },
        cleanup(): void {
            this.closeSettings();
            for (const endpoint of activeEndpoints) endpoint.token = "";
            activeEndpoints.clear();
        },
    };
}

function installServiceApi(api: PersephoneHostApi): PersephoneHostApi {
    // Read and preserve pre-existing board globals at the user-script boundary.
    const globalWithPersephone = globalThis as typeof globalThis & { persephone?: PersephoneHostApi };
    const persephone = globalWithPersephone.persephone ?? {};
    persephone.settings = api.settings;
    persephone.var = api.var;
    persephone.storage = api.storage;
    persephone.providers = api.providers;
    persephone.treeProviders = api.treeProviders;
    persephone.getCapability = api.getCapability;
    persephone.capabilities = api.capabilities;
    persephone.service = api.service;
    persephone.mcp = api.mcp;
    globalWithPersephone.persephone = persephone;
    return persephone;
}
