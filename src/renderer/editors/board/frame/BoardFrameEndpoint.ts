import {
    NO_REPLY, frameEvent, frameRequest, frameResponse, readFrameEnvelope,
    type BoardToHostEvents, type BoardToHostRequests, type HostToBoardEnvelope, type HostToBoardEvents, type HostToBoardRequests,
    type RequestParams, type RequestResult, type FrameResponseEnvelope,
} from "../../../../ipc/board-bridge/frame-protocol";
import { PendingRequests, type RequestId } from "../../../../shared/pending-requests";
import { fromWireError, toWireError } from "../../../../shared/wire-error";
import { BoardFrameSession, type BoardFrameOrigin, type BoardFrameRetireReason, type BoardFrameStamp } from "./BoardFrameSession";

export interface BoardFrameEndpointOptions {
    readonly retireError: (method: keyof HostToBoardRequests, reason: BoardFrameRetireReason) => unknown;
}
export interface HostRequestOptions {
    readonly timeoutMs?: number;
    readonly timeoutError?: () => unknown;
    readonly transfer?: Transferable[];
    readonly unavailableError?: (stage: "no-frame" | "post-failed") => unknown;
}
export type BoardFrameRequestContext = BoardFrameStamp & { readonly id: RequestId };
export interface HandleOptions<R> { readonly undelivered?: (value: R, context: BoardFrameRequestContext) => void }
type RequestHandler = (params: unknown, context: BoardFrameRequestContext) => unknown | Promise<unknown>;
type EventHandler = (payload: unknown, stamp: BoardFrameStamp) => void;
type PendingMeta = {
    method: keyof HostToBoardRequests;
    generation: number;
    frame: HTMLIFrameElement
};
function ownKey(value: object, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(value, key);

}
function objectPayload(value: unknown): Record<string, unknown> {
    return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};

}

/** Renderer endpoint for the private board-frame protocol. Session remains the sole liveness owner. */
export class BoardFrameEndpoint {
    private readonly pending = new PendingRequests<FrameResponseEnvelope, PendingMeta, RequestId>();
    private readonly requestHandlers: Partial<Record<keyof BoardToHostRequests, {
        fn: RequestHandler;
        undelivered?: (value: unknown, context: BoardFrameRequestContext) => void
    }>> = {};
    private readonly eventHandlers: Partial<Record<keyof BoardToHostEvents, EventHandler>> = {};

    constructor(private readonly session: BoardFrameSession, private readonly options: BoardFrameEndpointOptions) {
        this.session.onRetire((retirement) => {
            const methods: (keyof HostToBoardRequests)[] = ["save", "aiVision.request", "capabilities.intent"];
            for (const method of methods) this.pending.failWhere(
                (meta) => meta.generation === retirement.generation && meta.method === method,
                this.options.retireError(method, retirement.reason),
            );
        });
    }

    listen(): () => void {
        window.addEventListener("message", this.handleMessage);
        return () => window.removeEventListener("message", this.handleMessage);

    }
    handle<M extends keyof BoardToHostRequests>(
        method: M,
        fn: (
            params: RequestParams<BoardToHostRequests, M>,
            context: BoardFrameRequestContext,
        ) =>
            | RequestResult<BoardToHostRequests, M>
            | Promise<RequestResult<BoardToHostRequests, M> | typeof NO_REPLY>
            | typeof NO_REPLY,
        options?: HandleOptions<RequestResult<BoardToHostRequests, M>>,
    ): void {
        this.requestHandlers[method] = {
            fn: fn as RequestHandler,
            undelivered: options?.undelivered as (
                (value: unknown, context: BoardFrameRequestContext) => void
            ) | undefined,
        };
    }
    on<E extends keyof BoardToHostEvents>(name: E, fn: (payload: BoardToHostEvents[E], stamp: BoardFrameStamp) => void): void {
        this.eventHandlers[name] = fn as EventHandler;

    }
    request<M extends keyof HostToBoardRequests>(
        method: M,
        params: RequestParams<HostToBoardRequests, M>,
        options?: HostRequestOptions,
    ): Promise<RequestResult<HostToBoardRequests, M>> {
        const id = method === "capabilities.intent" && typeof params === "object" && params !== null
            && typeof (params as { requestId?: unknown }).requestId === "string"
            ? (params as unknown as { requestId: string }).requestId : undefined;
        return this.createRequest(method, options, id, params, true) as Promise<RequestResult<HostToBoardRequests, M>>;
    }
    expect<M extends keyof HostToBoardRequests>(
        method: M,
        id: RequestId,
        options?: Omit<HostRequestOptions, "transfer">,
    ): Promise<RequestResult<HostToBoardRequests, M>> {
        return this.createRequest(method, options, id, undefined, false) as Promise<RequestResult<HostToBoardRequests, M>>;
    }
    emit<E extends keyof HostToBoardEvents>(name: E, payload: HostToBoardEvents[E], options?: {
        transfer?: Transferable[];
        from?: BoardFrameOrigin
    }): boolean {
        return this.session.post(frameEvent(name, payload) as HostToBoardEnvelope, options?.transfer, options?.from);
    }
    hasPending(id: RequestId): boolean {
        return this.pending.has(id);

    }
    cancel(id: RequestId, error: unknown): boolean {
        return this.pending.fail(id, error);

    }
    failPending(method: keyof HostToBoardRequests, error: unknown): number {
        return this.pending.failWhere((meta) => meta.method === method, error);

    }

    private createRequest<M extends keyof HostToBoardRequests>(
        method: M,
        options: HostRequestOptions | undefined,
        id: RequestId | undefined,
        params: unknown,
        post: boolean,
    ): Promise<unknown> {
        const stamp = this.session.current();
        if (!stamp) return Promise.reject(options?.unavailableError?.("no-frame") ?? new Error("The board frame is unavailable."));
        const { id: requestId, promise } = this.pending.create(options?.timeoutMs, undefined, {
            id, meta: { method, generation: stamp.generation, frame: stamp.frame }, timeoutError: options?.timeoutError,
        });
        if (post && !this.session.post(
            frameRequest(requestId, method as string, params) as HostToBoardEnvelope,
            options?.transfer,
            stamp,
        )) {
            this.pending.fail(requestId, options?.unavailableError?.("post-failed") ?? new Error("The board frame is unavailable."));
        }
        return promise.then((response) => {
            if (response.ok === true) return response.value;
            throw fromWireError(response.error);
        });
    }

    private readonly handleMessage = (event: MessageEvent): void => {
        const stamp = this.session.identify(event);
        if (!stamp) return;
        const envelope = readFrameEnvelope(event.data);
        if (!envelope) return;
        if (envelope.__persephone === "res") {
            this.pending.settle(envelope.id, envelope, (meta) => meta.generation === stamp.generation && meta.frame === stamp.frame);
            return;
        }
        if (envelope.__persephone === "req") {
            const handlers = this.requestHandlers as Record<string, {
                fn: RequestHandler;
                undelivered?: (value: unknown, context: BoardFrameRequestContext) => void
            } | undefined>;
            const handler = handlers[envelope.method];
            if (!ownKey(handlers, envelope.method) || !handler) {
                this.session.post(
                    frameResponse(envelope.id, {
                        ok: false,
                        error: toWireError(new Error("Unknown board request.")),
                    }) as HostToBoardEnvelope,
                    undefined,
                    stamp,
                );
                return;
            }
            const context: BoardFrameRequestContext = { ...stamp, id: envelope.id };
            void Promise.resolve().then(() => handler.fn(objectPayload(envelope.params), context)).then((value) => {
                if (value === NO_REPLY) return;
                if (!this.session.post(
                    frameResponse(envelope.id, { ok: true, value }) as HostToBoardEnvelope,
                    undefined,
                    stamp,
                )) {
                    handler.undelivered?.(value, context);
                }
            }, (error: unknown) => this.session.post(
                frameResponse(envelope.id, {
                    ok: false,
                    error: toWireError(error, "The board request failed."),
                }) as HostToBoardEnvelope,
                undefined,
                stamp,
            ));
            return;
        }
        const handlers = this.eventHandlers as Record<string, EventHandler | undefined>;
        const handler = handlers[envelope.name];
        if (!ownKey(handlers, envelope.name) || !handler) return;
        try {
            handler(objectPayload(envelope.payload) as never, stamp);
        } catch (error) {
            console.error("Board frame event handler failed:", error);
        }
    };
}

/** Typed post to a captured frame window for best-effort teardown and navigation events. */
export function postBoardFrameEvent<E extends keyof HostToBoardEvents>(
    target: Window,
    targetOrigin: string,
    name: E,
    payload: HostToBoardEvents[E],
): void {
    target.postMessage(frameEvent(name, payload), targetOrigin);
}
