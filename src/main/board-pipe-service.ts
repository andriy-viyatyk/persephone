import type { WebContents } from "electron";
import {
    BOARD_PIPE_READ_CHANNEL,
    type BoardPipeReadReply,
    type BoardPipeReadRequest,
} from "../ipc/board-pipe-channels";
import type { ByteRange } from "../shared/range-utils";

interface PageOwner {
    webContents: WebContents;
    host?: string;
}

interface PendingRead {
    pageId: string;
    webContents: WebContents;
    resolve: (reply: BoardPipeReadReply) => void;
    reject: (error: Error) => void;
}

export class BoardPipeError extends Error {
    constructor(
        readonly status: 404 | 503,
        message: string,
    ) {
        super(message);
        this.name = "BoardPipeError";
    }
}

class BoardPipeService {
    private readonly owners = new Map<string, PageOwner>();
    private readonly ownersByWebContents = new Map<number, Set<string>>();
    private readonly pending = new Map<string, PendingRead>();
    private readonly wiredWebContents = new Map<number, WebContents>();
    private requestSequence = 0;

    registerPage(pageId: string, webContents: WebContents, host?: string): void {
        const previous = this.owners.get(pageId);
        if (previous && previous.webContents !== webContents) {
            this.removeOwner(pageId, new BoardPipeError(404, "Board pipe page is no longer available."));
        }

        this.owners.set(pageId, { webContents, host });
        let pageIds = this.ownersByWebContents.get(webContents.id);
        if (!pageIds) {
            pageIds = new Set<string>();
            this.ownersByWebContents.set(webContents.id, pageIds);
        }
        pageIds.add(pageId);
        this.wireWebContents(webContents);
    }

    unregisterPage(pageId: string, webContents: WebContents): void {
        const owner = this.owners.get(pageId);
        if (!owner || owner.webContents !== webContents) return;
        this.removeOwner(pageId, new BoardPipeError(404, "Board pipe page is no longer available."));
    }

    read(
        host: string,
        pageId: string,
        rangeHeader?: string,
        range?: ByteRange,
    ): Promise<BoardPipeReadReply> {
        const owner = this.owners.get(pageId);
        if (!owner || owner.host !== host || owner.webContents.isDestroyed()) {
            return Promise.reject(new BoardPipeError(404, "Board pipe resource not found."));
        }

        const requestId = `board-pipe-${Date.now()}-${++this.requestSequence}`;
        const request: BoardPipeReadRequest = {
            requestId,
            pageId,
            ...(rangeHeader !== undefined ? { rangeHeader } : {}),
            ...(range !== undefined ? { range } : {}),
        };
        return new Promise<BoardPipeReadReply>((resolve, reject) => {
            this.pending.set(requestId, {
                pageId,
                webContents: owner.webContents,
                resolve,
                reject,
            });
            try {
                owner.webContents.send(BOARD_PIPE_READ_CHANNEL, request);
            } catch (error) {
                this.pending.delete(requestId);
                reject(new BoardPipeError(503, "The board renderer is unavailable."));
            }
        });
    }

    handleReply(webContents: WebContents, reply: BoardPipeReadReply): void {
        if (!reply || typeof reply.requestId !== "string") return;
        const pending = this.pending.get(reply.requestId);
        if (!pending || pending.webContents !== webContents) return;
        this.pending.delete(reply.requestId);
        pending.resolve(reply);
    }

    dispose(): void {
        const error = new BoardPipeError(503, "Board pipe service is shutting down.");
        for (const request of this.pending.values()) request.reject(error);
        this.pending.clear();
        this.owners.clear();
        this.ownersByWebContents.clear();
        this.wiredWebContents.clear();
    }

    private wireWebContents(webContents: WebContents): void {
        if (this.wiredWebContents.has(webContents.id)) return;
        this.wiredWebContents.set(webContents.id, webContents);
        const cleanup = () => this.removeWebContents(webContents);
        webContents.once("destroyed", cleanup);
        webContents.once("render-process-gone", cleanup);
    }

    private removeWebContents(webContents: WebContents): void {
        const pageIds = this.ownersByWebContents.get(webContents.id);
        if (pageIds) {
            for (const pageId of pageIds) {
                this.removeOwner(pageId, new BoardPipeError(404, "Board pipe page is no longer available."));
            }
        }
        this.ownersByWebContents.delete(webContents.id);
        this.wiredWebContents.delete(webContents.id);
        for (const [requestId, request] of this.pending) {
            if (request.webContents !== webContents) continue;
            this.pending.delete(requestId);
            request.reject(new BoardPipeError(404, "Board pipe page is no longer available."));
        }
    }

    private removeOwner(pageId: string, error: Error): void {
        const owner = this.owners.get(pageId);
        if (!owner) return;
        this.owners.delete(pageId);
        this.ownersByWebContents.get(owner.webContents.id)?.delete(pageId);
        for (const [requestId, request] of this.pending) {
            if (request.pageId !== pageId) continue;
            this.pending.delete(requestId);
            request.reject(error);
        }
    }
}

export const boardPipeService = new BoardPipeService();
