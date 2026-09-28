import type { WebContents } from "electron";
import {
    BOARD_PIPE_CANCEL_CHANNEL,
    BOARD_PIPE_READ_CHANNEL,
    type BoardPipeCancelMessage,
    type BoardPipeReadReply,
    type BoardPipeReadRequest,
    type BoardPipeKind,
} from "../ipc/board-pipe-channels";
import type { ByteRange } from "../shared/range-utils";

interface PipeOwner {
    webContents: WebContents;
    host: string | undefined;
}

interface PendingRead {
    pipeKind: BoardPipeKind;
    pipeId: string;
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
    private readonly owners = new Map<string, PipeOwner>();
    private readonly ownersByWebContents = new Map<number, Set<string>>();
    private readonly pending = new Map<string, PendingRead>();
    private readonly wiredWebContents = new Map<number, WebContents>();
    private requestSequence = 0;

    registerPage(pageId: string, webContents: WebContents, host?: string): void {
        this.registerOwner("page", pageId, webContents, host);
    }

    registerResource(resourceId: string, webContents: WebContents, host?: string): void {
        this.registerOwner("resource", resourceId, webContents, host);
    }

    registerResourceIfUnowned(resourceId: string, webContents: WebContents): void {
        const key = this.ownerKey("resource", resourceId);
        if (this.owners.has(key)) {
            throw new BoardPipeError(404, "Board pipe resource id is already owned.");
        }
        this.registerOwner("resource", resourceId, webContents);
    }

    private registerOwner(pipeKind: BoardPipeKind, pipeId: string, webContents: WebContents, host?: string): void {
        const key = this.ownerKey(pipeKind, pipeId);
        const previous = this.owners.get(key);
        if (previous && previous.webContents !== webContents) {
            this.removeOwner(key, new BoardPipeError(404, "Board pipe is no longer available."));
        }

        this.owners.set(key, { webContents, host });
        let pageIds = this.ownersByWebContents.get(webContents.id);
        if (!pageIds) {
            pageIds = new Set<string>();
            this.ownersByWebContents.set(webContents.id, pageIds);
        }
        pageIds.add(key);
        this.wireWebContents(webContents);
    }

    unregisterPage(pageId: string, webContents: WebContents): void {
        const owner = this.owners.get(this.ownerKey("page", pageId));
        if (!owner || owner.webContents !== webContents) return;
        this.removeOwner(this.ownerKey("page", pageId), new BoardPipeError(404, "Board pipe page is no longer available."));
    }

    unregisterResource(resourceId: string, webContents: WebContents): void {
        const key = this.ownerKey("resource", resourceId);
        const owner = this.owners.get(key);
        if (!owner || owner.webContents !== webContents) return;
        this.removeOwner(key, new BoardPipeError(404, "Board pipe resource is no longer available."));
    }

    read(
        host: string | undefined,
        pipeKind: BoardPipeKind,
        pipeId: string,
        rangeHeader?: string,
        range?: ByteRange,
        signal?: AbortSignal,
    ): Promise<BoardPipeReadReply> {
        const owner = this.owners.get(this.ownerKey(pipeKind, pipeId));
        if (!owner || owner.host !== host || owner.webContents.isDestroyed()) {
            return Promise.reject(new BoardPipeError(404, "Board pipe resource not found."));
        }
        if (signal?.aborted) {
            return Promise.reject(new BoardPipeError(503, "Board pipe read was cancelled."));
        }

        const requestId = `board-pipe-${Date.now()}-${++this.requestSequence}`;
        const request: BoardPipeReadRequest = {
            requestId,
            pipeKind,
            pipeId,
            ...(rangeHeader !== undefined ? { rangeHeader } : {}),
            ...(range !== undefined ? { range } : {}),
        };
        return new Promise<BoardPipeReadReply>((resolve, reject) => {
            let settled = false;
            const onAbort = (): void => {
                if (settled || !this.pending.delete(requestId)) return;
                settled = true;
                reject(new BoardPipeError(503, "Board pipe read was cancelled."));
                try {
                    owner.webContents.send(
                        BOARD_PIPE_CANCEL_CHANNEL,
                        { requestId } satisfies BoardPipeCancelMessage,
                    );
                } catch {
                    // The renderer may already be gone; nothing left to cancel.
                }
            };
            signal?.addEventListener("abort", onAbort, { once: true });
            this.pending.set(requestId, {
                pipeKind,
                pipeId,
                webContents: owner.webContents,
                resolve: (value) => {
                    if (settled) return;
                    settled = true;
                    signal?.removeEventListener("abort", onAbort);
                    resolve(value);
                },
                reject: (error) => {
                    if (settled) return;
                    settled = true;
                    signal?.removeEventListener("abort", onAbort);
                    reject(error);
                },
            });
            try {
                owner.webContents.send(BOARD_PIPE_READ_CHANNEL, request);
            } catch (error) {
                this.pending.delete(requestId);
                settled = true;
                signal?.removeEventListener("abort", onAbort);
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
        const pipeKeys = this.ownersByWebContents.get(webContents.id);
        if (pipeKeys) {
            for (const pipeKey of pipeKeys) {
                this.removeOwner(pipeKey, new BoardPipeError(404, "Board pipe is no longer available."));
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

    private removeOwner(pipeKey: string, error: Error): void {
        const owner = this.owners.get(pipeKey);
        if (!owner) return;
        this.owners.delete(pipeKey);
        this.ownersByWebContents.get(owner.webContents.id)?.delete(pipeKey);
        const separator = pipeKey.indexOf(":");
        const pipeKind = pipeKey.slice(0, separator) as BoardPipeKind;
        const pipeId = pipeKey.slice(separator + 1);
        for (const [requestId, request] of this.pending) {
            if (request.pipeKind !== pipeKind || request.pipeId !== pipeId) continue;
            this.pending.delete(requestId);
            if (pipeKind === "resource") {
                try {
                    owner.webContents.send(BOARD_PIPE_CANCEL_CHANNEL, { requestId } satisfies BoardPipeCancelMessage);
                } catch {
                    // The renderer may already be gone; rejection still releases the HTTP read.
                }
            }
            request.reject(error);
        }
    }

    private ownerKey(pipeKind: BoardPipeKind, pipeId: string): string {
        return `${pipeKind}:${pipeId}`;
    }
}

export const boardPipeService = new BoardPipeService();
