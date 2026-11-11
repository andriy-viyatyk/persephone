import {
    BOARD_TO_HOST_EVENTS_AFTER_LOAD, NO_REPLY, frameEvent, frameRequest, frameResponse, isBoardPortInit, readFrameEnvelope,
    type BoardPortInitMsg, type BoardToHostEvents, type BoardToHostRequests, type HostToBoardEvents, type HostToBoardRequests,
    type RequestParams, type RequestResult, type FrameResponseEnvelope,
} from "./ipc/board-bridge/frame-protocol";
import { PendingRequests, type RequestId } from "./shared/pending-requests";
import { fromWireError, toWireError } from "./shared/wire-error";

export interface HostFrameChannelOptions {
    readonly targetOrigin: string;
    readonly acceptOrigin: string | undefined;
    readonly nextId?: () => number;
}
export interface HostFrameContext { readonly id?: RequestId; readonly ports: readonly MessagePort[] }
export interface HostRequestOptions { readonly postError?: (error: unknown) => Error }
type RequestHandler = (params: unknown, context: HostFrameContext) => unknown | Promise<unknown>;
type EventHandler = (payload: unknown, context: HostFrameContext) => void;
type PendingMeta = { method: keyof BoardToHostRequests };

function ownKey(value: object, key: string): boolean { return Object.prototype.hasOwnProperty.call(value, key); }
function objectPayload(value: unknown): Record<string, unknown> {
    return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

/** Owns the shim's host-frame boundary, request correlation, and deferred outbound policy. */
export class HostFrameChannel {
    private readonly pending: PendingRequests<FrameResponseEnvelope, PendingMeta, number>;
    private readonly requestHandlers: Partial<Record<keyof HostToBoardRequests, RequestHandler>> = {};
    private readonly eventHandlers: Partial<Record<keyof HostToBoardEvents, EventHandler>> = {};
    private initHandler: ((init: BoardPortInitMsg, ports: readonly MessagePort[]) => void) | undefined;
    private toolbarDocumentLoaded = typeof document !== "undefined" && document.readyState === "complete";
    private readonly pendingDocumentMessages: Array<() => void> = [];
    private listening = false;

    constructor(private readonly options: HostFrameChannelOptions) {
        this.pending = new PendingRequests({ nextId: options.nextId });
    }

    listen(): void {
        if (this.listening) return;
        this.listening = true;
        // event.source is the load-bearing boundary: host messages must come from the embedding window.
        window.addEventListener("message", this.handleMessage);
        if (!this.toolbarDocumentLoaded) window.addEventListener("load", this.handleDocumentLoad, { once: true });
    }

    request<M extends keyof BoardToHostRequests>(
        method: M,
        params: RequestParams<BoardToHostRequests, M>,
        options?: HostRequestOptions,
    ): Promise<RequestResult<BoardToHostRequests, M>> {
        return this.requestWithId(method, params, options).promise;
    }

    requestWithId<M extends keyof BoardToHostRequests>(
        method: M,
        params: RequestParams<BoardToHostRequests, M>,
        options?: HostRequestOptions,
    ): { id: number; promise: Promise<RequestResult<BoardToHostRequests, M>> } {
        const { id, promise } = this.pending.create(undefined, undefined, { meta: { method } });
        this.afterLoad(() => {
            if (!this.pending.has(id)) return;
            try {
                this.send(frameRequest(id, method, params));
            } catch (error) {
                this.pending.fail(id, options?.postError?.(error) ?? new Error("Persephone host is unavailable."));
            }
        });
        return {
            id,
            promise: promise.then((response) => {
                if (response.ok === true) return response.value as RequestResult<BoardToHostRequests, M>;
                throw fromWireError(response.error);
            }),
        };
    }

    cancel(id: number, error: unknown): boolean {
        return this.pending.fail(id, error);
    }

    failPending(method: keyof BoardToHostRequests, error: unknown): number {
        return this.pending.failWhere((meta) => meta.method === method, error);
    }

    failAllPending(error: unknown): void {
        this.pending.failAll(error);
    }

    handle<M extends keyof HostToBoardRequests>(
        method: M,
        fn: (
            params: RequestParams<HostToBoardRequests, M>,
            context: HostFrameContext,
        ) => RequestResult<HostToBoardRequests, M> | Promise<RequestResult<HostToBoardRequests, M> | typeof NO_REPLY> | typeof NO_REPLY,
    ): void {
        this.requestHandlers[method] = fn as RequestHandler;
    }
    answer<M extends keyof HostToBoardRequests>(id: RequestId, work: Promise<RequestResult<HostToBoardRequests, M>>): void {
        void work.then(
            (value) => this.respond(id, { ok: true, value }),
            (error: unknown) => this.respond(id, { ok: false, error: toWireError(error) }),
        );
    }
    on<E extends keyof HostToBoardEvents>(name: E, fn: (payload: HostToBoardEvents[E], context: HostFrameContext) => void): void {
        this.eventHandlers[name] = fn as EventHandler;
    }
    onInit(fn: (init: BoardPortInitMsg, ports: readonly MessagePort[]) => void): void { this.initHandler = fn; }
    emit<E extends keyof BoardToHostEvents>(name: E, payload: BoardToHostEvents[E]): void {
        this.afterLoad(() => {
            try {
                this.send(frameEvent(name, payload));
            } catch {
                /* parent gone */
            }
        }, BOARD_TO_HOST_EVENTS_AFTER_LOAD.has(name));
    }

    private readonly handleDocumentLoad = (): void => {
        this.toolbarDocumentLoaded = true;
        for (const send of this.pendingDocumentMessages.splice(0)) send();
    };
    private afterLoad(send: () => void, deferred = true): void {
        if (!deferred || this.toolbarDocumentLoaded || document.readyState === "complete") {
            this.toolbarDocumentLoaded = true;
            send();
            return;
        }
        this.pendingDocumentMessages.push(send);
    }
    private send(message: unknown): void { window.parent.postMessage(message, this.options.targetOrigin); }
    private respond(id: RequestId, result: { ok: true; value: unknown } | { ok: false; error: ReturnType<typeof toWireError> }): void {
        try {
            this.send(frameResponse(id, result));
        } catch {
            /* parent gone */
        }
    }
    private readonly handleMessage = (event: MessageEvent): void => {
        if (event.source !== window.parent) return;
        if (this.options.acceptOrigin !== undefined && event.origin !== this.options.acceptOrigin) return;
        this.dispatch(event);
    };
    private dispatch(event: MessageEvent): void {
        if (isBoardPortInit(event.data)) {
            this.initHandler?.(event.data, event.ports);
            return;
        }
        const envelope = readFrameEnvelope(event.data);
        if (!envelope) return;
        if (envelope.__persephone === "res") {
            if (typeof envelope.id === "number") this.pending.settle(envelope.id, envelope);
            return;
        }
        if (envelope.__persephone === "req") {
            const handlers = this.requestHandlers as Record<string, RequestHandler | undefined>;
            const handler = handlers[envelope.method];
            if (!ownKey(handlers, envelope.method) || !handler) {
                this.respond(envelope.id, { ok: false, error: toWireError(new Error("Unknown host request.")) });
                return;
            }
            const context: HostFrameContext = { id: envelope.id, ports: event.ports };
            void Promise.resolve()
                .then(() => handler(objectPayload(envelope.params), context))
                .then(
                    (value) => {
                        if (value !== NO_REPLY) this.respond(envelope.id, { ok: true, value });
                    },
                    (error: unknown) => this.respond(envelope.id, { ok: false, error: toWireError(error) }),
                );
            return;
        }
        const handlers = this.eventHandlers as Record<string, EventHandler | undefined>;
        const handler = handlers[envelope.name];
        if (!ownKey(handlers, envelope.name) || !handler) return;
        try {
            handler(objectPayload(envelope.payload), { ports: event.ports });
        } catch (error) {
            console.error("Board frame event handler failed:", error);
        }
    }
}
