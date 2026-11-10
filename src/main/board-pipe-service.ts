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
import { onWebContentsGone } from "./webcontents-lifetime";
import { PendingRequests } from "../shared/pending-requests";
import { boardTrustService } from "./board-trust-service";
import { boardFileAccess } from "./board-file-access";

interface PipeOwner {
    webContents: WebContents;
    host: string | undefined;
    boardRoot?: string;
    filePath?: string;
    hostedDocument: boolean;
}

interface PendingReadMeta {
    pipeKind: BoardPipeKind;
    pipeId: string;
    webContents: WebContents;
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
    private readonly pending = new PendingRequests<BoardPipeReadReply, PendingReadMeta, string>({
        nextId: () => `board-pipe-${Date.now()}-${++this.requestSequence}`,
    });
    private readonly wiredWebContents = new Map<number, WebContents>();
    private requestSequence = 0;

    registerPage(pageId: string, webContents: WebContents, host?: string, boardRoot?: string, hostedDocument = false): void {
        this.registerOwner("page", pageId, webContents, host, boardRoot, undefined, hostedDocument);
    }

    registerResource(resourceId: string, webContents: WebContents, host?: string, boardRoot?: string, filePath?: string): void {
        this.registerOwner("resource", resourceId, webContents, host, boardRoot, filePath, false);
    }

    registerResourceIfUnowned(resourceId: string, webContents: WebContents): void {
        const key = this.ownerKey("resource", resourceId);
        if (this.owners.has(key)) {
            throw new BoardPipeError(404, "Board pipe resource id is already owned.");
        }
        this.registerOwner("resource", resourceId, webContents);
    }

    private registerOwner(pipeKind: BoardPipeKind, pipeId: string, webContents: WebContents, host?: string, boardRoot?: string, filePath?: string, hostedDocument = false): void {
        const key = this.ownerKey(pipeKind, pipeId);
        const previous = this.owners.get(key);
        if (previous && previous.webContents !== webContents) {
            this.removeOwner(key, new BoardPipeError(404, "Board pipe is no longer available."));
        }

        this.owners.set(key, { webContents, host, boardRoot, filePath, hostedDocument });
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
        const { boardRoot, filePath, hostedDocument } = owner;
        if (boardRoot && filePath !== undefined && !hostedDocument) {
            return (async () => {
                const permissions = await boardTrustService.getGrant(boardRoot);
                if (!permissions) throw new BoardPipeError(404, "Board pipe resource not found.");
                await boardFileAccess.authorize(boardRoot, filePath, "read");
                return this.requestRead(owner, host, pipeKind, pipeId, rangeHeader, range, signal);
            })();
        }
        return this.requestRead(owner, host, pipeKind, pipeId, rangeHeader, range, signal);
    }

    private requestRead(
        owner: PipeOwner,
        host: string | undefined,
        pipeKind: BoardPipeKind,
        pipeId: string,
        rangeHeader?: string,
        range?: ByteRange,
        signal?: AbortSignal,
    ): Promise<BoardPipeReadReply> {
        if (signal?.aborted) {
            return Promise.reject(new BoardPipeError(503, "Board pipe read was cancelled."));
        }

        const { id: requestId, promise } = this.pending.create(undefined, undefined, { meta: { pipeKind, pipeId, webContents: owner.webContents } });
        const request: BoardPipeReadRequest = {
            requestId,
            pipeKind,
            pipeId,
            ...(rangeHeader !== undefined ? { rangeHeader } : {}),
            ...(range !== undefined ? { range } : {}),
        };
        const onAbort = (): void => {
            if (!this.pending.fail(requestId, new BoardPipeError(503, "Board pipe read was cancelled."))) return;
            try { owner.webContents.send(BOARD_PIPE_CANCEL_CHANNEL, { requestId } satisfies BoardPipeCancelMessage); }
            catch { /* The renderer may already be gone; nothing left to cancel. */ }
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        try { owner.webContents.send(BOARD_PIPE_READ_CHANNEL, request); }
        catch { this.pending.fail(requestId, new BoardPipeError(503, "The board renderer is unavailable.")); }
        return promise.finally(() => signal?.removeEventListener("abort", onAbort));
    }

    handleReply(webContents: WebContents, reply: BoardPipeReadReply): void {
        if (!reply || typeof reply.requestId !== "string") return;
        this.pending.settle(reply.requestId, reply, (meta) => meta.webContents === webContents);
    }

    dispose(): void {
        const error = new BoardPipeError(503, "Board pipe service is shutting down.");
        this.pending.failAll(error);
        this.owners.clear();
        this.ownersByWebContents.clear();
        this.wiredWebContents.clear();
    }

    private wireWebContents(webContents: WebContents): void {
        if (this.wiredWebContents.has(webContents.id)) return;
        this.wiredWebContents.set(webContents.id, webContents);
        const cleanup = () => this.removeWebContents(webContents);
        onWebContentsGone(webContents, cleanup, { events: ["destroyed", "render-process-gone"] });
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
        this.pending.failWhere((meta) => meta.webContents === webContents, new BoardPipeError(404, "Board pipe page is no longer available."));
    }

    private removeOwner(pipeKey: string, error: Error): void {
        const owner = this.owners.get(pipeKey);
        if (!owner) return;
        this.owners.delete(pipeKey);
        this.ownersByWebContents.get(owner.webContents.id)?.delete(pipeKey);
        const separator = pipeKey.indexOf(":");
        const pipeKind = pipeKey.slice(0, separator) as BoardPipeKind;
        const pipeId = pipeKey.slice(separator + 1);
        this.pending.failWhere((meta) => meta.pipeKind === pipeKind && meta.pipeId === pipeId, error,
            pipeKind === "resource" ? (requestId) => {
                try { owner.webContents.send(BOARD_PIPE_CANCEL_CHANNEL, { requestId } satisfies BoardPipeCancelMessage); }
                catch { /* The renderer may already be gone; rejection still releases the HTTP read. */ }
            } : undefined);
    }

    private ownerKey(pipeKind: BoardPipeKind, pipeId: string): string {
        return `${pipeKind}:${pipeId}`;
    }
}

export const boardPipeService = new BoardPipeService();
