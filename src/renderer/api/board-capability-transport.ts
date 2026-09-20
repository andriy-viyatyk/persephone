import type {
    CapabilityErrorCode,
    CapabilityRegistration,
    CapabilityTransport,
    IntentRequest,
} from "../../ipc/capability-bus-channels";
import { boardTrust } from "./board-trust";
import { boards } from "./boards";
import { pagesModel } from "./pages";
import { boardPagesForRoot } from "./board-updates";
import type { PageModel } from "./pages/PageModel";
import type { IBoardIntent } from "./types/io.link-data";
import { fpNormalizeForCompare } from "../core/utils/file-path";
import { errMessage } from "../../shared/utils";

export class BoardCapabilityTransportError extends Error {
    readonly code: CapabilityErrorCode;

    constructor(code: CapabilityErrorCode, message: string) {
        super(message);
        this.name = "BoardCapabilityTransportError";
        this.code = code;
    }
}

export interface BoardCapabilityFrame {
    readonly boardRoot: string;
    readonly pageId: string;
    readonly generation: number;
    readonly iframe: HTMLIFrameElement;
    readonly contentWindow: Window;
    dispatch(request: IntentRequest): Promise<unknown>;
    cancel(requestId: string): void;
}

const frames = new Map<string, BoardCapabilityFrame>();
const frameListeners = new Set<(frame: BoardCapabilityFrame) => void>();

export function registerBoardCapabilityFrame(frame: BoardCapabilityFrame): void {
    frames.set(frame.pageId, frame);
    for (const listener of frameListeners) listener(frame);
}

export function unregisterBoardCapabilityFrame(
    pageId: string,
    frame?: BoardCapabilityFrame,
): void {
    if (!frame || frames.get(pageId) === frame) frames.delete(pageId);
}

export function boardCapabilityFrameForPage(pageId: string): BoardCapabilityFrame | undefined {
    return frames.get(pageId);
}

export function subscribeBoardCapabilityFrames(
    listener: (frame: BoardCapabilityFrame) => void,
): () => void {
    frameListeners.add(listener);
    return () => frameListeners.delete(listener);
}

interface PendingDispatch {
    readonly registration: CapabilityRegistration;
    readonly request: IntentRequest;
    readonly resolve: (value: unknown) => void;
    readonly reject: (error: BoardCapabilityTransportError) => void;
    page?: PageModel;
    pageUnsubscribe?: () => void;
    frame?: BoardCapabilityFrame;
    settled: boolean;
}

function boardRootOf(registration: CapabilityRegistration): string | undefined {
    return registration.origin === "board" ? registration.boardRoot : undefined;
}

function clearInitialIntent(page: PageModel | undefined, requestId: string): void {
    const editor = page?.mainEditorInstance as unknown as {
        clearInitialIntent?: (id: string) => void;
    } | null;
    editor?.clearInitialIntent?.(requestId);
}

function clearInitialIntentOnRoot(root: string, requestId: string): void {
    for (const page of boardPagesForRoot(root)) clearInitialIntent(page, requestId);
}

function normalizeTransportError(error: unknown): BoardCapabilityTransportError {
    if (error instanceof BoardCapabilityTransportError) return error;
    if (error && typeof error === "object") {
        const value = error as { code?: unknown; message?: unknown };
        const codes: readonly CapabilityErrorCode[] = [
            "no-handler", "untrusted", "handler-closed", "crashed", "cancelled",
            "timeout", "cycle", "payload-too-large", "busy", "rejected",
        ];
        if (typeof value.code === "string" && codes.includes(value.code as CapabilityErrorCode)) {
            return new BoardCapabilityTransportError(
                value.code as CapabilityErrorCode,
                typeof value.message === "string" ? value.message : "The board request failed.",
            );
        }
    }
    return new BoardCapabilityTransportError("rejected", errMessage(error, "The board request failed."));
}

class BoardCapabilityTransport implements CapabilityTransport {
    private readonly pending = new Map<string, PendingDispatch>();
    private readonly pageChains = new Map<string, { requestId: string; chain: string[]; depth: number }>();
    private readonly unsubscribeTrust: () => void;
    private readonly unsubscribeFrames: () => void;

    constructor() {
        this.unsubscribeTrust = boardTrust.subscribePaths(() => this.settleUntrusted());
        this.unsubscribeFrames = subscribeBoardCapabilityFrames((frame) => this.onFrame(frame));
    }

    dispatch(registration: CapabilityRegistration, request: IntentRequest): Promise<unknown> {
        const root = boardRootOf(registration);
        if (!root || !boardTrust.isTrusted(root)) {
            return Promise.reject(new BoardCapabilityTransportError(
                "untrusted",
                "The capability handler board is not trusted.",
            ));
        }
        if (this.pending.has(request.requestId)) {
            return Promise.reject(new BoardCapabilityTransportError(
                "rejected",
                `Capability request ${request.requestId} was dispatched twice.`,
            ));
        }

        return new Promise<unknown>((resolve, reject) => {
            const pending: PendingDispatch = {
                registration,
                request,
                resolve,
                reject,
                settled: false,
            };
            this.pending.set(request.requestId, pending);
            void this.resolveHandler(pending, root);
        });
    }

    cancel(registration: CapabilityRegistration, requestId: string): void {
        const pending = this.pending.get(requestId);
        if (!pending || pending.registration !== registration) return;
        this.settle(pending, new BoardCapabilityTransportError(
            "cancelled",
            "The capability request was cancelled.",
        ), true);
    }

    chainForPage(pageId: string | undefined): { chain: readonly string[]; depth: number } {
        const current = pageId === undefined ? undefined : this.pageChains.get(pageId);
        return current
            ? { chain: [...current.chain], depth: current.depth }
            : { chain: [], depth: 0 };
    }

    private async resolveHandler(pending: PendingDispatch, root: string): Promise<void> {
        const pages = boardPagesForRoot(root);
        const page = pages[0];
        if (page) {
            this.attachPage(pending, page);
            pagesModel.navigation.showPage(page.id);
            const frame = boardCapabilityFrameForPage(page.id);
            if (frame) this.dispatchToFrame(pending, frame);
            return;
        }
        if (pending.registration.headless) {
            this.settle(pending, new BoardCapabilityTransportError(
                "no-handler",
                `The winning handler for "${pending.request.id}" is headless and has no board frame.`,
            ), false);
            return;
        }

        const intent: IBoardIntent = {
            id: pending.request.id,
            ...(pending.request.version === undefined ? {} : { version: pending.request.version }),
            requestId: pending.request.requestId,
            payload: pending.request.payload,
        };
        try {
            // Keep the pending map populated before this call: opening a board can synchronously
            // mount its first frame and deliver the handshake before the promise resolves.
            await boards.openBoard(root, { intent });
            const openedPage = boardPagesForRoot(root)[0];
            if (openedPage) {
                this.attachPage(pending, openedPage);
                const frame = boardCapabilityFrameForPage(openedPage.id);
                if (frame) this.dispatchToFrame(pending, frame);
            } else if (!pending.settled) {
                this.settle(pending, new BoardCapabilityTransportError(
                    "handler-closed",
                    "The capability handler page did not open.",
                ), false);
            }
        } catch (error: unknown) {
            this.settle(pending, new BoardCapabilityTransportError(
                "rejected",
                errMessage(error, "The capability handler page could not be opened."),
            ), false);
        }
    }

    private attachPage(pending: PendingDispatch, page: PageModel): void {
        if (pending.page === page) return;
        pending.pageUnsubscribe?.();
        pending.page = page;
        pending.pageUnsubscribe = page.disposed.subscribe(() => {
            if (!pending.settled) {
                this.settle(pending, new BoardCapabilityTransportError(
                    "handler-closed",
                    "The capability handler page was closed.",
                ), false);
            }
        });
    }

    private onFrame(frame: BoardCapabilityFrame): void {
        for (const pending of this.pending.values()) {
            if (pending.settled || pending.frame || fpNormalizeForCompare(frame.boardRoot)
                !== fpNormalizeForCompare(pending.registration.boardRoot ?? "")) continue;
            if (pending.page && pending.page.id !== frame.pageId) continue;
            this.dispatchToFrame(pending, frame);
        }
    }

    private dispatchToFrame(pending: PendingDispatch, frame: BoardCapabilityFrame): void {
        if (pending.settled || pending.frame) return;
        if (!boardTrust.isTrusted(frame.boardRoot)) {
            this.settle(pending, new BoardCapabilityTransportError(
                "untrusted",
                "The capability handler board is not trusted.",
            ), false);
            return;
        }
        pending.frame = frame;
        this.pageChains.set(frame.pageId, {
            requestId: pending.request.requestId,
            chain: [...pending.request.chain, pending.registration.handlerKey],
            depth: pending.request.depth + 1,
        });
        void frame.dispatch(pending.request).then(
            (result) => this.settle(pending, undefined, false, { pageId: frame.pageId, result }),
            (error: unknown) => this.settle(pending, normalizeTransportError(error), false),
        );
    }

    private settle(
        pending: PendingDispatch,
        error?: BoardCapabilityTransportError,
        sendCancel = false,
        result?: unknown,
    ): void {
        if (pending.settled) return;
        pending.settled = true;
        this.pending.delete(pending.request.requestId);
        pending.pageUnsubscribe?.();
        pending.pageUnsubscribe = undefined;
        if (sendCancel) {
            try { pending.frame?.cancel(pending.request.requestId); } catch { /* best effort */ }
        }
        if (pending.frame) {
            const chain = this.pageChains.get(pending.frame.pageId);
            if (chain?.requestId === pending.request.requestId) this.pageChains.delete(pending.frame.pageId);
        }
        clearInitialIntent(pending.page, pending.request.requestId);
        if (pending.registration.boardRoot) {
            clearInitialIntentOnRoot(pending.registration.boardRoot, pending.request.requestId);
        }
        if (error) pending.reject(error);
        else pending.resolve(result);
    }

    private settleUntrusted(): void {
        for (const pending of [...this.pending.values()]) {
            const root = pending.registration.boardRoot;
            if (root && !boardTrust.isTrusted(root)) {
                this.settle(pending, new BoardCapabilityTransportError(
                    "untrusted",
                    "The capability handler board is no longer trusted.",
                ), true);
            }
        }
    }

    dispose(): void {
        this.unsubscribeTrust();
        this.unsubscribeFrames();
        for (const pending of [...this.pending.values()]) {
            this.settle(pending, new BoardCapabilityTransportError(
                "handler-closed",
                "The capability transport was disposed.",
            ), true);
        }
        this.pageChains.clear();
    }
}

export const boardCapabilityTransport = new BoardCapabilityTransport();
