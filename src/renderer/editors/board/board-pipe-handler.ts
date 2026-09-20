import {
    BOARD_PIPE_READ_CHANNEL,
    BOARD_PIPE_REPLY_CHANNEL,
    type BoardPipeReadReply,
    type BoardPipeReadRequest,
    type BoardPipeReadSuccess,
} from "../../../ipc/board-pipe-channels";
import { MAX_BOARD_PIPE_CHUNK_BYTES, MAX_BUFFERED_PIPE_BYTES } from "../../../shared/board-pipe-constants";
import { errMessage } from "../../../shared/utils";
import { parseRangeHeader, type ByteRange } from "../../../shared/range-utils";
import { pages } from "../../api/pages";
import type { IContentPipe } from "../../api/types/io.pipe";
import type { BoardEditorModel } from "./BoardEditorModel";

interface PipeMemo {
    pipe: IContentPipe;
    buffer?: Buffer;
    bufferPromise?: Promise<Buffer>;
    totalSize?: number;
    totalSizePromise?: Promise<number>;
}

interface PendingRead {
    pageId: string;
    cancelled: boolean;
}

const pipeMemos = new Map<string, PipeMemo>();
const pendingReads = new Map<string, PendingRead>();
let initialized = false;

function contentTypeForPipe(pipe: IContentPipe): string {
    const name = pipe.displayName || pipe.provider.sourceUrl;
    const extension = name.split(/[?#]/, 1)[0].split(".").pop()?.toLowerCase();
    switch (extension) {
        case "aac": return "audio/aac";
        case "flac": return "audio/flac";
        case "m4a": return "audio/mp4";
        case "mp3": return "audio/mpeg";
        case "oga":
        case "ogg": return "audio/ogg";
        case "opus": return "audio/opus";
        case "wav": return "audio/wav";
        case "avi": return "video/x-msvideo";
        case "mkv": return "video/x-matroska";
        case "mov": return "video/quicktime";
        case "mp4": return "video/mp4";
        case "m3u8": return "application/vnd.apple.mpegurl";
        case "ts": return "video/mp2t";
        case "webm": return "video/webm";
        case "ogv": return "video/ogg";
        case "avif": return "image/avif";
        case "gif": return "image/gif";
        case "ico": return "image/x-icon";
        case "jpeg":
        case "jpg": return "image/jpeg";
        case "png": return "image/png";
        case "svg": return "image/svg+xml";
        case "webp": return "image/webp";
        default: return "application/octet-stream";
    }
}

async function readBuffered(pipe: IContentPipe, memo: PipeMemo): Promise<Buffer> {
    if (memo.buffer) return memo.buffer;
    if (!memo.bufferPromise) {
        memo.bufferPromise = pipe.readBinary().then(
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

async function resolveTotalSize(pipe: IContentPipe, memo: PipeMemo): Promise<number> {
    if (memo.totalSize !== undefined) return memo.totalSize;
    if (!memo.totalSizePromise) {
        memo.totalSizePromise = (async () => {
            if (!hasDirectStream(pipe)) {
                if (pipe.transformers.length > 0) return (await readBuffered(pipe, memo)).length;
                if (typeof pipe.provider.stat !== "function") return (await readBuffered(pipe, memo)).length;
                const stat = await pipe.stat();
                if (stat.exists && stat.size !== undefined) {
                    if (typeof pipe.provider.createReadStream !== "function"
                        && stat.size > MAX_BUFFERED_PIPE_BYTES) {
                        throw new Error("The board pipe has no bounded streaming provider.");
                    }
                    if (typeof pipe.provider.createReadStream === "function") {
                        memo.totalSize = stat.size;
                        return stat.size;
                    }
                }
                return (await readBuffered(pipe, memo)).length;
            }

            const stat = await pipe.stat();
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

async function readChunk(request: BoardPipeReadRequest): Promise<BoardPipeReadSuccess> {
    const page = pages.findPage(request.pageId);
    const board = page?.mainEditorInstance as BoardEditorModel | null;
    if (!board || !board.pipeUrlEnabled) throw new Error("The board pipe page is unavailable.");

    const pipe = await board.resolveStreamPipe();
    let memo = pipeMemos.get(request.pageId);
    if (!memo || memo.pipe !== pipe) {
        memo = { pipe };
        pipeMemos.set(request.pageId, memo);
    }

    const totalSize = await resolveTotalSize(pipe, memo);
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
        ? await collectChunk(pipe.createReadStream(boundedRange))
        : (await readBuffered(pipe, memo)).subarray(
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
    if (!request || typeof request.requestId !== "string" || typeof request.pageId !== "string") return;
    const pending: PendingRead = { pageId: request.pageId, cancelled: false };
    pendingReads.set(request.requestId, pending);
    void readChunk(request)
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

export function initBoardPipeHandler(): void {
    if (initialized) return;
    initialized = true;
    window.electron.ipcRenderer.on(BOARD_PIPE_READ_CHANNEL, handleRequest);
}

export function invalidateBoardPipePage(pageId: string): void {
    pipeMemos.delete(pageId);
    for (const [requestId, pending] of pendingReads) {
        if (pending.pageId !== pageId) continue;
        pending.cancelled = true;
        pendingReads.delete(requestId);
    }
}
