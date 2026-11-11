import { isCapabilityErrorCode, type CapabilityErrorCode, PLATFORM_AUDIO_CAPABILITY_ID } from "../shared/capability-constants";
import { createCapabilityProxy } from "../shared/capability-client";
import type { CapabilityClientInvoke, CapabilityClientOptions, CapabilityClientResult, CapabilityProvider, IntentEnvelope } from "../ipc/capability-bus-channels";
import { NO_REPLY, type BoardPortInitMsg } from "../ipc/board-bridge/frame-protocol";
import type { BoardPortParams, BoardPortResult } from "../ipc/board-bridge/port-protocol";
import type { ServiceChannel, ServiceChannelKind } from "../shared/service-channel";
import type { MainPortChannel } from "./main-port-channel";
import type { HostFrameChannel } from "./board-host-frame-channel";
import { Listeners } from "./primitives";
import { errMessage } from "../shared/utils";

interface BoardIntentContext extends IntentEnvelope {
    cancelled: boolean;
    settled: boolean;
    delivered: boolean;
    outcome: Promise<{ result?: unknown; discardPage?: boolean }>;
    finish(value: { result?: unknown; discardPage?: boolean }): void;
    fail(error: unknown): void;
    resolve(value: unknown, options?: { discardPage?: boolean }): void;
    reject(reason?: unknown): void;
}

class BoardCapabilityError extends Error {
    readonly code: CapabilityErrorCode;
    constructor(code: CapabilityErrorCode, message: string) {
        super(message);
        this.name = "BoardCapabilityError";
        this.code = code;
    }
}

type CapabilityMethod = (channel: ServiceChannel) => unknown;

export function createCapabilityApi(deps: {
    mainPort: MainPortChannel;
    hostFrame: HostFrameChannel;
    waitForServiceChannel: (channelId: string, kind: ServiceChannelKind) => Promise<ServiceChannel>;
}) {
    const { mainPort, hostFrame, waitForServiceChannel } = deps;
    let activeIntent: BoardIntentContext | undefined;
    const intentListeners = new Listeners<[BoardIntentContext]>("persephone.intent.onRequest callback error:");

    const clientAdapters: Readonly<Record<string, Readonly<Record<string, CapabilityMethod>>>> = Object.freeze({
        [PLATFORM_AUDIO_CAPABILITY_ID]: Object.freeze({ muteApp: createAudioMuteAppAdapter }),
    });

    function settleIntent(intent: BoardIntentContext | undefined, error?: { code: CapabilityErrorCode; message: string }, result?: unknown, discardPage?: boolean): void {
        if (!intent || intent.cancelled || intent.settled) return;
        intent.settled = true;
        if (error) intent.fail(Object.assign(new Error(error.message), { code: error.code }));
        else intent.finish({ result, ...(discardPage === undefined ? {} : { discardPage }) });
    }

    function makeIntentContext(init: { id: string; version?: number; requestId: string; payload: unknown }): BoardIntentContext {
        let finishOutcome: (value: { result?: unknown; discardPage?: boolean }) => void = () => {};
        let failOutcome: (error: unknown) => void = () => {};
        const outcome = new Promise<{ result?: unknown; discardPage?: boolean }>((resolve, reject) => { finishOutcome = resolve; failOutcome = reject; });
        const context: BoardIntentContext = {
            id: init.id,
            ...(typeof init.version === "number" ? { version: init.version } : {}),
            requestId: init.requestId,
            payload: init.payload,
            cancelled: false,
            settled: false,
            delivered: false,
            outcome,
            finish: finishOutcome,
            fail: failOutcome,
            resolve: (value, options) => { if (!context.cancelled) settleIntent(context, undefined, value, options?.discardPage); },
            reject: (reason) => {
                if (!context.cancelled) settleIntent(context, {
                    code: "rejected",
                    message: errMessage(reason, "The board rejected the request."),
                });
            },
        };
        return context;
    }

    function deliverIntent(): void {
        const intent = activeIntent;
        if (!intent || intent.delivered || intentListeners.size === 0) return;
        intent.delivered = true;
        intentListeners.emit(intent);
    }

    function capabilityErrorFromReply(error: { code?: unknown; message?: unknown } | string | undefined): BoardCapabilityError {
        const code = typeof error === "object" && error && isCapabilityErrorCode(error.code) ? error.code : "rejected";
        const message = typeof error === "string" ? error : typeof error?.message === "string" ? error.message : "The capability request failed.";
        return new BoardCapabilityError(code, message);
    }

    function capabilityInvokeRpc(id: string, payload: unknown, options?: { version?: number; deadlineMs?: number }): Promise<unknown> {
        return hostFrame.request("capabilities.invoke", {
            id, ...(options?.version === undefined ? {} : { version: options.version }), payload,
            ...(options?.deadlineMs === undefined ? {} : { deadlineMs: options.deadlineMs }),
        }, { postError: (error) => new BoardCapabilityError("rejected", errMessage(error, "Persephone host is unavailable.")) })
            .catch((error: unknown) => { throw capabilityErrorFromReply(error as { code?: unknown; message?: unknown }); });
    }

    type CapabilityRpcMethod = "capabilityList" | "capabilityProviders" | "capabilityGet" | "capabilityInvoke" | "capabilityCancel";
    type CapabilityRpcValue<M extends CapabilityRpcMethod> = BoardPortResult<M> extends CapabilityClientResult<infer Value> ? Value : never;
    async function capabilityRpc<M extends CapabilityRpcMethod>(method: M, ...args: BoardPortParams<M>): Promise<CapabilityRpcValue<M>> {
        const result = await mainPort.rpc(method, ...args) as CapabilityClientResult<unknown>;
        if (result.ok === false) throw Object.assign(new Error(result.error.message), { code: result.error.code });
        return result.value as CapabilityRpcValue<M>;
    }

    async function getCapability(id: string, options?: CapabilityClientOptions) {
        const provider = await capabilityRpc("capabilityGet", id, options);
        if (!provider) return null;
        return createCapabilityProxy(provider, async (method, args) => {
            const request: CapabilityClientInvoke = {
                requestId: crypto.randomUUID(),
                key: { id: provider.id, version: provider.version, provider: provider.provider, handlerKey: provider.handlerKey },
                method, args, filter: options?.filter,
            };
            const result = await capabilityRpc("capabilityInvoke", request);
            if (provider.methods[method].kind === "channel") {
                let channel: ServiceChannel;
                try { channel = await waitForServiceChannel((result as { channelId: string }).channelId, "capability"); }
                catch (error) { void capabilityRpc("capabilityCancel", request.requestId).catch((): void => undefined); throw error; }
                const adapter = clientAdapters[id]?.[method];
                return adapter ? adapter(channel) : channel;
            }
            return result;
        });
    }

    hostFrame.handle("capabilities.intent", (params, context) => {
        if (typeof context.id !== "string" || typeof params.id !== "string") throw new Error("Malformed capability intent request.");
        if (activeIntent && !activeIntent.settled && !activeIntent.cancelled && activeIntent.requestId !== context.id) {
            return Promise.reject(Object.assign(new Error("The board is already serving a capability request."), { code: "rejected" }));
        }
        if (activeIntent?.requestId === context.id && activeIntent.delivered) return NO_REPLY;
        activeIntent = makeIntentContext({
            id: params.id,
            ...(typeof params.version === "number" ? { version: params.version } : {}),
            requestId: context.id,
            payload: params.payload,
        });
        deliverIntent();
        return activeIntent.outcome;
    });
    hostFrame.on("capabilities.cancel", (data) => {
        if (typeof data.requestId !== "string") return;
        if (activeIntent?.requestId === data.requestId) activeIntent.cancelled = true;
    });
    mainPort.onReplace(() => hostFrame.failPending("capabilities.invoke", new BoardCapabilityError("handler-closed", "Persephone bridge was replaced.")));

    function init(data: BoardPortInitMsg): void {
        if (!activeIntent && data.intent && typeof data.intent.id === "string" && typeof data.intent.requestId === "string") {
            activeIntent = makeIntentContext({
                id: data.intent.id,
                ...(typeof data.intent.version === "number" ? { version: data.intent.version } : {}),
                requestId: data.intent.requestId,
                payload: data.intent.payload,
            });
            hostFrame.answer(data.intent.requestId, activeIntent.outcome);
            deliverIntent();
        }
    }

    const api = {
        intent: {
            get(): BoardIntentContext | undefined { return activeIntent; },
            onRequest(callback: (request: BoardIntentContext) => void): () => void {
                const unsubscribe = intentListeners.add(callback);
                deliverIntent();
                return unsubscribe;
            },
            resolve(value: unknown, options?: { discardPage?: boolean }): void { activeIntent?.resolve(value, options); },
            reject(reason?: unknown): void { activeIntent?.reject(reason); },
        },
        getCapability,
        capabilities: {
            list(): Promise<unknown> { return capabilityRpc("capabilityList"); },
            providers(id: string): Promise<CapabilityProvider[]> { return capabilityRpc("capabilityProviders", id); },
            invoke(id: string, payload: unknown, options?: { version?: number; deadlineMs?: number }): Promise<unknown> {
                if (typeof id !== "string" || !id) return Promise.reject(new BoardCapabilityError("rejected", "Capability id must not be empty."));
                return capabilityInvokeRpc(id, payload, options);
            },
        },
    };
    return { api, init };
}

function createAudioMuteAppAdapter(channel: ServiceChannel): unknown {
    let released = false;
    let pending: Promise<void> | undefined;
    channel.onClose(() => { released = true; });
    return { release: (): Promise<void> => {
        if (released) return Promise.resolve();
        return pending ??= new Promise<void>((resolve) => {
            const done = (): void => { released = true; removeMessage(); removeClose(); resolve(); };
            let removeClose = (): void => undefined;
            const removeMessage = channel.onMessage((message) => { if ((message as { type?: string })?.type === "released") done(); });
            removeClose = channel.onClose(done);
            try { channel.send({ type: "release" }); } catch { done(); }
        });
    } };
}
