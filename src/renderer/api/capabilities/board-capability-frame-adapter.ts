import type { BoardToHostRequests, RequestParams } from "../../../ipc/board-bridge/frame-protocol";
import type { IntentEnvelope, IntentRequest } from "../../../ipc/capability-bus-channels";
import { CapabilityError, toCapabilityError } from "../capability-error";
import { capabilities } from "./CapabilitiesClient";
import { boardCapabilityDispatcher, type BoardCapabilityFrame } from "./BoardCapabilityDispatcher";

export type FrameRetireReason = "reload" | "grant-change" | "load-error" | "permission-lost" | "dispose";
type IntentResult = {
    result?: unknown;
    discardPage?: boolean
};
export interface CapabilityFrameStamp {
    host: string;
    generation: number;
    frame: HTMLIFrameElement;
    contentWindow: Window
}
export interface CapabilityFramePort {
    current(): CapabilityFrameStamp | undefined;
    requestIntent(params: IntentEnvelope, unavailable: () => Error): Promise<IntentResult>;
    expectIntent(id: string, unavailable: () => Error): Promise<IntentResult>;
    hasPending(id: string): boolean;
    cancelPending(id: string, error: Error): boolean;
    failIntents(error: Error): number;
    postCancel(target: Window, origin: string, requestId: string): void;
    onRetire(listener: (reason: FrameRetireReason, generation: number) => void): () => void;
    onFrameLoaded(listener: (generation: number, frame: HTMLIFrameElement) => void): () => void;
    onPortDelivered(listener: (generation: number) => void): () => void;
    onRegistrationFailed(listener: (generation: number, message: string) => void): () => void;
}

function projectInvoke(outcome: {
    pageId?: string;
    result?: unknown
}) {
    return {
        ...(typeof outcome.pageId === "string" ? { pageId: outcome.pageId } : {}),
        ...(Object.prototype.hasOwnProperty.call(outcome, "result") ? { result: outcome.result } : {})
    };
}
function projectIntent(outcome: IntentResult): IntentResult {
    return {
        ...(Object.prototype.hasOwnProperty.call(outcome, "result") ? { result: outcome.result } : {}),
        ...(outcome.discardPage === undefined ? {} : { discardPage: outcome.discardPage })
    };
}

export class BoardCapabilityFrameAdapter {
    private frame: BoardCapabilityFrame | undefined;
    private frameOrigin = "*";
    private readonly subscriptions: (() => void)[];
    constructor(
        private readonly boardRoot: string,
        private readonly pageId: () => string | undefined,
        private readonly isMain: boolean,
        private readonly port: CapabilityFramePort,
        private readonly retirementError: (reason: FrameRetireReason) => CapabilityError,
    ) {
        this.subscriptions = [
            port.onRetire((reason, generation) => {
                const pageId = this.pageId();
                if (reason === "load-error" && pageId) {
                    boardCapabilityDispatcher.failFrame(pageId, generation, this.retirementError(reason));
                }
                this.unregister();
            }),
            port.onRegistrationFailed((generation, message) => {
                const error = new CapabilityError("crashed", message);
                this.port.failIntents(error);
                const pageId = this.pageId();
                if (pageId) boardCapabilityDispatcher.failFrame(pageId, generation, error);
                this.unregister();
            }),
            port.onFrameLoaded((generation, frame) => {
                const pageId = this.pageId();
                if (!this.isMain || !pageId || !frame.contentWindow) return;
                const stamp = this.port.current();
                this.frameOrigin = stamp ? `board://${stamp.host}` : "*";
                this.frame = {
                    boardRoot: this.boardRoot,
                    pageId,
                    generation,
                    iframe: frame,
                    contentWindow: frame.contentWindow,
                    ready: false,
                    dispatch: this.dispatch,
                    cancel: this.cancel,
                };
                boardCapabilityDispatcher.registerFrame(this.frame);
            }),
            port.onPortDelivered((generation) => {
                if (this.frame?.generation === generation) {
                    this.frame.ready = true;
                    boardCapabilityDispatcher.markFrameReady(this.frame.pageId, generation);
                }
            }),
        ];
    }

    async invoke(message: RequestParams<BoardToHostRequests, "capabilities.invoke">) {
        try {
            const outcome = await capabilities.invokeOutcome(message.id, message.payload, {
                ...(message.version === undefined ? {} : { version: message.version }),
                pageId: this.pageId(),
                deadlineMs: message.deadlineMs,
            });
            return projectInvoke(outcome);
        } catch (error: unknown) {
            throw toCapabilityError(error, "The capability request failed.");
        }
    }

    private readonly dispatch = (request: IntentRequest, initial = false): Promise<unknown> => {
        if (!this.port.current() || !this.isMain) {
            return Promise.reject(new CapabilityError("handler-closed", "The board frame is unavailable or untrusted."));
        }
        const unavailable = () => new CapabilityError("crashed", "The board frame is unavailable.");
        const result = initial ? this.port.expectIntent(request.requestId, unavailable) : this.port.requestIntent({
            requestId: request.requestId,
            id: request.id,
            ...(request.version === undefined ? {} : { version: request.version }),
            payload: request.payload,
        }, unavailable);
        return result.then(projectIntent);
    };
    private readonly cancel = (requestId: string): void => {
        if (this.frame && this.port.hasPending(requestId)) {
            try {
                this.port.postCancel(this.frame.contentWindow, this.frameOrigin, requestId);
            }
            catch { /* best-effort during teardown */ }
        }
        this.port.cancelPending(requestId, new CapabilityError("handler-closed", "The capability request was cancelled."));
    };
    private unregister(): void {
        if (!this.frame) return;
        boardCapabilityDispatcher.unregisterFrame(this.frame.pageId, this.frame);
        this.frame = undefined;
    }
    dispose(): void {
        for (const unsubscribe of this.subscriptions) unsubscribe();
    }
}
