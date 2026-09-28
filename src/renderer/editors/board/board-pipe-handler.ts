import {
    BOARD_PIPE_CANCEL_CHANNEL,
    BOARD_PIPE_READ_CHANNEL,
    BOARD_PIPE_REPLY_CHANNEL,
    type BoardPipeCancelMessage,
    type BoardPipeReadReply,
    type BoardPipeReadRequest,
    type BoardPipeReadSuccess,
    type BoardPipeKind,
} from "../../../ipc/board-pipe-channels";
import { MAX_BOARD_PIPE_CHUNK_BYTES, MAX_BUFFERED_PIPE_BYTES } from "../../../shared/board-pipe-constants";
import { errMessage } from "../../../shared/utils";
import { parseRangeHeader, type ByteRange } from "../../../shared/range-utils";
import { pages } from "../../api/pages";
import type { IContentPipe } from "../../api/types/io.pipe";
import { contentTypeForPipe } from "../../content/board-pipe-utils";

interface PipeMemo {
    pipe: IContentPipe;
    buffer?: Buffer;
    bufferPromise?: Promise<Buffer>;
    totalSize?: number;
    totalSizePromise?: Promise<number>;
}

interface PendingRead {
    pipeKind: BoardPipeKind;
    pipeId: string;
    cancelled: boolean;
    /** US-1518: aborted on page close (`invalidateBoardPipePage()`) or on an explicit
     *  {requestId}-scoped cancel from main (`handleCancel()`, section 7a). Threaded into
     *  `createReadStream()`/`readBinary()` so the underlying module-service request is released
     *  even though a board's implementation is not obliged to observe the signal. */
    controller: AbortController;
}

const pipeMemos = new Map<string, PipeMemo>();
/** Board content and video session resources, keyed by opaque resource id. Separate from
 *  `pipeMemos`, which caches read state rather than owning a pipe. */
const contentResources = new Map<string, IContentPipe>();
const pendingReads = new Map<string, PendingRead>();
let initialized = false;

async function readBuffered(pipe: IContentPipe, memo: PipeMemo, signal?: AbortSignal): Promise<Buffer> {
    if (memo.buffer) return memo.buffer;
    if (!memo.bufferPromise) {
        memo.bufferPromise = pipe.readBinary({ signal }).then(
            (buffer) => {
                if (buffer.length > MAX_BUFFERED_PIPE_BYTES) {
                    throw new Error("The transformed board pipe exceeds the in-memory streaming limit.");
                }
                memo.buffer = buffer;
                memo.totalSize = buffer.length;
                return buffer;
            },
            (error: unknown) => {
                memo.bufferPromise = undefined;
                throw error;
            },
        );
    }
    return memo.bufferPromise;
}

function hasDirectStream(pipe: IContentPipe): boolean {
    return pipe.transformers.length === 0
        && typeof pipe.provider.createReadStream === "function"
        && typeof pipe.provider.stat === "function";
}

async function resolveTotalSize(pipe: IContentPipe, memo: PipeMemo, signal?: AbortSignal): Promise<number> {
    if (memo.totalSize !== undefined) return memo.totalSize;
    if (!memo.totalSizePromise) {
        memo.totalSizePromise = (async () => {
            if (!hasDirectStream(pipe)) {
                if (pipe.transformers.length > 0) return (await readBuffered(pipe, memo, signal)).length;
                if (typeof pipe.provider.stat !== "function") return (await readBuffered(pipe, memo, signal)).length;
                const stat = await pipe.stat({ signal });
                if (stat.exists && stat.size !== undefined) {
                    if (typeof pipe.provider.createReadStream !== "function"
                        && stat.size > MAX_BUFFERED_PIPE_BYTES) {
                        throw new Error("The board pipe has no bounded streaming provider.");
                    }
                    if (typeof pipe.provider.createReadStream === "function") {
                        // Deliberate re-read, not a redundant duplicate of the hasDirectStream()
                        // check above: this runs AFTER pipe.stat() has round-tripped, by which
                        // point the provider-capabilities announcement is guaranteed to have
                        // arrived (see US-1474's task doc, "Timing was checked"). Reusing the
                        // earlier hasDirectStream() result here would silently downgrade every
                        // ranged-capable board provider to the buffered path on a cold start.
                        memo.totalSize = stat.size;
                        return stat.size;
                    }
                }
                return (await readBuffered(pipe, memo, signal)).length;
            }

            const stat = await pipe.stat({ signal });
            if (!stat.exists || stat.size === undefined || !Number.isSafeInteger(stat.size) || stat.size < 0) {
                throw new Error("The board pipe provider did not report a usable resource size.");
            }
            memo.totalSize = stat.size;
            return stat.size;
        })().catch((error: unknown) => {
            memo.totalSizePromise = undefined;
            throw error;
        });
    }
    return memo.totalSizePromise;
}

async function collectChunk(stream: NodeJS.ReadableStream): Promise<Uint8Array> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const value of stream as AsyncIterable<Uint8Array | string>) {
        const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
        size += chunk.length;
        if (size > MAX_BOARD_PIPE_CHUNK_BYTES) {
            (stream as NodeJS.ReadableStream & { destroy?: () => void }).destroy?.();
            throw new Error("The board pipe provider exceeded the IPC chunk limit.");
        }
        chunks.push(chunk);
    }
    return Buffer.concat(chunks, size);
}

function validContinuationRange(range: ByteRange | undefined, totalSize: number): ByteRange | null {
    if (!range || !Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end)) return null;
    if (range.start < 0 || range.end < range.start || range.end >= totalSize) return null;
    return range;
}

async function readChunk(request: BoardPipeReadRequest, signal: AbortSignal): Promise<BoardPipeReadSuccess> {
    let pipe: IContentPipe | undefined;
    if (request.pipeKind === "resource") {
        // BoardEditorModel publishes board resources and VideoEditor publishes session resources.
        pipe = contentResources.get(request.pipeId);
    } else {
        const page = pages.findPage(request.pipeId);
        const editor = page?.mainEditorInstance as {
            pipeUrlEnabled?: boolean;
            resolveStreamPipe?: () => Promise<IContentPipe>;
        } | null;
        // A capability check keeps the lazy board editor graph out of this handler's chunk.
        // Page ids resolve board page pipes only; video sessions use opaque resource ids.
        if (typeof editor?.resolveStreamPipe === "function") {
            if (editor.pipeUrlEnabled !== true) throw new Error("The board pipe page is unavailable.");
            pipe = await editor.resolveStreamPipe();
        }
    }
    if (!pipe) throw new Error("The page content pipe is unavailable.");

    const memoKey = `${request.pipeKind}:${request.pipeId}`;
    let memo = pipeMemos.get(memoKey);
    if (!memo || memo.pipe !== pipe) {
        memo = { pipe };
        pipeMemos.set(memoKey, memo);
    }

    const totalSize = await resolveTotalSize(pipe, memo, signal);
    const selected = request.range
        ? validContinuationRange(request.range, totalSize)
        : request.rangeHeader !== undefined
            ? parseRangeHeader(request.rangeHeader, totalSize)
            : totalSize > 0 ? { start: 0, end: totalSize - 1 } : null;
    if (!selected) {
        return {
            requestId: request.requestId,
            ok: true,
            totalSize,
            range: null,
            data: new Uint8Array(),
            contentType: contentTypeForPipe(pipe),
        };
    }

    const boundedRange = {
        start: selected.start,
        end: Math.min(selected.end, selected.start + MAX_BOARD_PIPE_CHUNK_BYTES - 1),
    };
    const data = hasDirectStream(pipe)
        ? await collectChunk(pipe.createReadStream(boundedRange, { signal }))
        : (await readBuffered(pipe, memo, signal)).subarray(
            boundedRange.start,
            boundedRange.end + 1,
        );
    if (data.length === 0) throw new Error("The board pipe provider returned no bytes for a non-empty range.");

    return {
        requestId: request.requestId,
        ok: true,
        totalSize,
        range: { start: boundedRange.start, end: boundedRange.start + data.length - 1 },
        data,
        contentType: contentTypeForPipe(pipe),
    };
}

function reply(reply: BoardPipeReadReply): void {
    window.electron.ipcRenderer.sendMessage(BOARD_PIPE_REPLY_CHANNEL, reply);
}

function handleRequest(rawRequest: unknown): void {
    const request = rawRequest as BoardPipeReadRequest | undefined;
    if (!request || typeof request.requestId !== "string"
        || (request.pipeKind !== "page" && request.pipeKind !== "resource")
        || typeof request.pipeId !== "string") return;
    const pending: PendingRead = {
        pipeKind: request.pipeKind,
        pipeId: request.pipeId,
        cancelled: false,
        controller: new AbortController(),
    };
    pendingReads.set(request.requestId, pending);
    void readChunk(request, pending.controller.signal)
        .then((result) => {
            if (!pending.cancelled && pendingReads.get(request.requestId) === pending) reply(result);
        })
        .catch((error: unknown) => {
            if (!pending.cancelled && pendingReads.get(request.requestId) === pending) {
                reply({
                    requestId: request.requestId,
                    ok: false,
                    status: 503,
                    error: errMessage(error, "The board pipe provider is unavailable."),
                });
            }
        })
        .finally(() => {
            if (pendingReads.get(request.requestId) === pending) pendingReads.delete(request.requestId);
        });
}

function handleCancel(rawMessage: unknown): void {
    const message = rawMessage as BoardPipeCancelMessage | undefined;
    if (!message || typeof message.requestId !== "string") return;
    const pending = pendingReads.get(message.requestId);
    if (!pending) return;
    pending.cancelled = true;
    pending.controller.abort();
    pendingReads.delete(message.requestId);
}

export function initBoardPipeHandler(): void {
    if (initialized) return;
    initialized = true;
    window.electron.ipcRenderer.on(BOARD_PIPE_READ_CHANNEL, handleRequest);
    window.electron.ipcRenderer.on(BOARD_PIPE_CANCEL_CHANNEL, handleCancel);
}

export function invalidateBoardPipePage(pageId: string): void {
    pipeMemos.delete(`page:${pageId}`);
    for (const [requestId, pending] of pendingReads) {
        if (pending.pipeKind !== "page" || pending.pipeId !== pageId) continue;
        pending.cancelled = true;
        pending.controller.abort();
        pendingReads.delete(requestId);
    }
}

/** Publish a BoardEditorModel content pipe or VideoEditor's session pipe for resource reads. */
export function registerBoardContentResource(resourceId: string, pipe: IContentPipe): void {
    contentResources.set(resourceId, pipe);
}

/** Publish a VideoEditor's session pipe without replacing an existing resource. */
export function registerVideoSessionResource(resourceId: string, pipe: IContentPipe): void {
    if (contentResources.has(resourceId)) {
        throw new Error("The video pipe resource id is already registered.");
    }
    contentResources.set(resourceId, pipe);
}

export function invalidateBoardPipeResource(resourceId: string): void {
    contentResources.delete(resourceId);
    pipeMemos.delete(`resource:${resourceId}`);
    for (const [requestId, pending] of pendingReads) {
        if (pending.pipeKind !== "resource" || pending.pipeId !== resourceId) continue;
        pending.cancelled = true;
        pending.controller.abort();
        pendingReads.delete(requestId);
    }
}
