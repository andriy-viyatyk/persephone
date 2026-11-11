import type { WebContents } from "electron";
import { isCapabilityErrorCode } from "../shared/capability-constants";
import { CAPABILITY_MAX_TIMEOUT_MS } from "../shared/capability-limits";
import { codedError, isCoded } from "../shared/coded-error";
import { errMessage } from "../shared/utils";
import type {
    CapabilityClientInvoke,
    CapabilityClientOptions,
    CapabilityClientResult,
    CapabilityInvokeContext,
    CapabilityProvider,
} from "../ipc/capability-bus-channels";
import type { CapabilityErrorCode, CapabilityJson } from "../shared/capability-contract";
import { capabilityRouter, publicCapabilityProvider, type CapabilityCaller } from "./capability-router";
import type { ChannelDelivery } from "./channel-delivery";
import { onWebContentsGone } from "./webcontents-lifetime";

export const MAX_CAPABILITY_REQUEST_ID_LENGTH = 256;

export interface OpenedChannel { channelId: string }

export interface CapabilityClientProfile {
    /** The caller identity for this owner. Evaluated per call, so a throw becomes an `ok: false` result. */
    caller(asAgent?: boolean): CapabilityCaller;
    /** Becomes `owner` and `target` of every invocation context. Omitted for a service owner. */
    owner?: WebContents;
    /** Abort every active request when `owner` is destroyed, crashes or navigates. Window clients only. */
    watchOwnerLifetime?: boolean;
    /** Keep a channel request in the active map until its channel closes (board page only). */
    retainChannelRequests?: boolean;
}

export type CapabilityInvokeRoute =
    | { methods: "value"; context?: CapabilityInvokeContext }
    | {
        methods: "channel" | "any";
        delivery: (requestId: string) => ChannelDelivery;
        channelReply?: "none";
        agentCallers?: boolean;
        parent?: { requestId: string; isActive?: () => boolean };
    };

type ChannelOnlyRoute = Omit<Extract<CapabilityInvokeRoute, { methods: "channel" | "any" }>, "methods"> & { methods: "channel" };

export function toCapabilityError(error: unknown): { code: CapabilityErrorCode; message: string } {
    const code = isCoded(error) ? error.code : undefined;
    return { code: isCapabilityErrorCode(code) ? code : "rejected", message: errMessage(error) };
}

/** The only place a thrown value becomes a `CapabilityClientResult`. */
export async function capabilityResult<T>(operation: () => T | Promise<T>): Promise<CapabilityClientResult<T>> {
    try { return { ok: true, value: await operation() }; }
    catch (error) { return { ok: false, error: toCapabilityError(error) }; }
}

export class CapabilityClient {
    private readonly active = new Map<string, AbortController>();
    private stopLifetime?: () => void;

    constructor(private readonly profile: CapabilityClientProfile) {
        if (profile.watchOwnerLifetime && profile.owner) {
            this.stopLifetime = onWebContentsGone(profile.owner, () => this.abortAll(codedError("cancelled")), { repeat: true });
        }
    }

    list(asAgent?: boolean): Promise<CapabilityClientResult<CapabilityProvider[]>> {
        return capabilityResult(() => this.listProviders(asAgent));
    }

    providers(id: unknown, asAgent?: boolean): Promise<CapabilityClientResult<CapabilityProvider[]>> {
        return capabilityResult(() => {
            if (typeof id !== "string") throw codedError("rejected");
            return capabilityRouter.providers(this.profile.caller(asAgent), id).map(publicCapabilityProvider);
        });
    }

    get(id: unknown, options?: CapabilityClientOptions): Promise<CapabilityClientResult<CapabilityProvider | null>> {
        return capabilityResult(() => {
            if (typeof id !== "string") throw codedError("rejected");
            const bound = capabilityRouter.resolve(this.profile.caller(options?.asAgent), id, options);
            return bound ? publicCapabilityProvider(bound.registration) : null;
        });
    }

    invoke(request: CapabilityClientInvoke | undefined, route: { methods: "value" }): Promise<CapabilityClientResult<CapabilityJson>>;
    invoke(request: CapabilityClientInvoke | undefined, route: ChannelOnlyRoute): Promise<CapabilityClientResult<OpenedChannel>>;
    invoke(request: CapabilityClientInvoke | undefined, route: CapabilityInvokeRoute): Promise<CapabilityClientResult<CapabilityJson | OpenedChannel | null>>;
    invoke(request: CapabilityClientInvoke | undefined, route: CapabilityInvokeRoute): Promise<CapabilityClientResult<CapabilityJson | OpenedChannel | null>> {
        return capabilityResult(async () => {
            if (!request || typeof request.requestId !== "string" || !request.requestId
                || request.requestId.length > MAX_CAPABILITY_REQUEST_ID_LENGTH
                || typeof request.method !== "string" || !Array.isArray(request.args)) throw codedError("rejected", "Invalid capability request.");
            const invokeContext = route.methods === "value" ? route.context : undefined;
            if (route.methods === "value" && invokeContext !== undefined
                && (!invokeContext || typeof invokeContext !== "object" || Array.isArray(invokeContext))) {
                throw codedError("rejected", "Invalid capability invocation context.");
            }
            const parentRequestId = invokeContext?.parentRequestId;
            if (parentRequestId !== undefined && (typeof parentRequestId !== "string" || parentRequestId.length > MAX_CAPABILITY_REQUEST_ID_LENGTH)) {
                throw codedError("rejected", "Invalid parent capability request id.");
            }
            const requestedDeadline = invokeContext?.deadlineMs;
            if (requestedDeadline !== undefined && (typeof requestedDeadline !== "number" || !Number.isFinite(requestedDeadline) || requestedDeadline <= 0)) {
                throw codedError("rejected", "Capability deadlineMs must be a positive finite number.");
            }
            const deadlineMs = requestedDeadline === undefined ? undefined : Math.min(requestedDeadline, CAPABILITY_MAX_TIMEOUT_MS);
            const parent = route.methods !== "value" ? route.parent : undefined;
            if (parent?.isActive && !parent.isActive()) throw codedError("cancelled");
            if (this.active.has(request.requestId)) throw codedError("rejected", "Duplicate capability request id.");
            const agentCallers = route.methods === "value" || route.agentCallers !== false;
            const bound = capabilityRouter.bindKey(this.profile.caller(agentCallers ? request.asAgent : false), request.key, request.filter);
            const kind = bound?.registration.methods[request.method]?.kind;
            const allowed = route.methods === "any" ? kind !== undefined : route.methods === "channel" ? kind === "channel" : kind !== undefined && kind !== "channel";
            if (!bound || !allowed) throw codedError("no-handler", "Capability handler unavailable.");
            const isChannel = kind === "channel";
            const controller = new AbortController();
            this.active.set(request.requestId, controller);
            const owner = this.profile.owner;
            let channelOpen = false;
            try {
                const invocationParentRequestId = parent?.requestId ?? parentRequestId;
                const invocation = capabilityRouter.createInvocationContext(bound, { signal: controller.signal,
                    ...(owner ? { owner, target: owner } : {}),
                    ...(invocationParentRequestId ? { parentRequestId: invocationParentRequestId } : {}) });
                try {
                    const value = await capabilityRouter.invoke(bound, request.method, request.args, { invocation,
                        ...(owner ? { target: owner } : {}),
                        ...(deadlineMs !== undefined ? { deadlineMs } : {}),
                        ...(isChannel && route.methods !== "value" ? { channelDelivery: route.delivery(request.requestId) } : {}) });
                    if (!isChannel) return value as CapabilityJson;
                    const channelId = (value as { channelId?: unknown } | null)?.channelId;
                    if (typeof channelId !== "string") throw codedError("no-handler", "Capability channel unavailable.");
                    channelOpen = true;
                    if (this.profile.retainChannelRequests) (value as { onClose(listener: () => void): unknown }).onClose(() => this.release(request.requestId, controller));
                    return route.methods !== "value" && route.channelReply === "none" ? null : { channelId };
                } finally { if (!channelOpen) invocation.dispose(); }
            } finally { if (!(channelOpen && this.profile.retainChannelRequests)) this.release(request.requestId, controller); }
        });
    }

    isActive(requestId: string): boolean { return this.active.has(requestId); }

    cancel(requestId: unknown): CapabilityClientResult<void> {
        if (typeof requestId === "string") this.active.get(requestId)?.abort(codedError("cancelled"));
        return { ok: true, value: undefined };
    }

    dispose(reason: unknown = codedError("cancelled")): void {
        this.abortAll(reason);
        this.stopLifetime?.();
        this.stopLifetime = undefined;
    }

    private listProviders(asAgent?: boolean): CapabilityProvider[] {
        return capabilityRouter.list(this.profile.caller(asAgent)).map(publicCapabilityProvider);
    }

    private abortAll(reason: unknown): void {
        for (const controller of this.active.values()) controller.abort(reason);
        this.active.clear();
    }

    private release(requestId: string, controller: AbortController): void {
        if (this.active.get(requestId) === controller) this.active.delete(requestId);
    }
}

const windowClients = new WeakMap<WebContents, CapabilityClient>();

/** One client per window webContents; a window's IPC and host-channel requests share one duplicate-id map, as today. */
export function capabilityClientForWindow(webContents: WebContents): CapabilityClient {
    let client = windowClients.get(webContents);
    if (!client) {
        client = new CapabilityClient({
            owner: webContents,
            watchOwnerLifetime: true,
            caller: (asAgent) => asAgent ? { kind: "agent" } : { kind: "platform" },
        });
        windowClients.set(webContents, client);
    }
    return client;
}
