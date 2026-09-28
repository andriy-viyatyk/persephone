import type { BoardPipeKind, BoardPipeReadReply } from "../ipc/board-pipe-channels";
import { contentLength, contentRangeHeader, parseRangeHeader, unsatisfiableContentRangeHeader, type ByteRange } from "../shared/range-utils";
import { MAX_BOARD_PIPE_CHUNK_BYTES } from "../shared/board-pipe-constants";
import { BoardPipeError, boardPipeService } from "./board-pipe-service";
import { errMessage } from "../shared/utils";

export class BoardPipeRangeError extends BoardPipeError {
    constructor(status: 404 | 503, message: string, readonly source: "reply" | "read") {
        super(status, message);
        this.name = "BoardPipeRangeError";
    }
}

export interface BoardPipeRangeResult {
    status: 200 | 206 | 416;
    headers: Record<string, string>;
    chunks: AsyncIterable<Uint8Array>;
}

const EMPTY_CHUNKS: AsyncIterable<Uint8Array> = { async *[Symbol.asyncIterator]() {} };
const INVALID_RANGE_MESSAGE = "The board pipe returned an invalid byte range.";

export async function readPipeRange(
    kind: BoardPipeKind,
    id: string,
    host: string | undefined,
    rangeHeader: string | undefined,
    signal: AbortSignal,
): Promise<BoardPipeRangeResult> {
    let first: BoardPipeReadReply;
    try {
        first = await boardPipeService.read(host, kind, id, rangeHeader, undefined, signal);
    } catch (error: unknown) {
        const status = error instanceof BoardPipeError ? error.status : 503;
        throw new BoardPipeRangeError(status, errMessage(error, "Board pipe unavailable."), "read");
    }
    if (first.ok === false) throw new BoardPipeRangeError(first.status, first.error, "reply");
    const firstSuccess = first as Extract<BoardPipeReadReply, { ok: true }>;
    const totalSize = firstSuccess.totalSize;
    if (!Number.isSafeInteger(totalSize) || totalSize < 0) throw new BoardPipeRangeError(503, INVALID_RANGE_MESSAGE, "reply");

    const requestedRange = rangeHeader === undefined
        ? totalSize > 0 ? { start: 0, end: totalSize - 1 } : null
        : parseRangeHeader(rangeHeader, totalSize);
    if (!requestedRange) {
        if (firstSuccess.range !== null || firstSuccess.data.length !== 0) {
            throw new BoardPipeRangeError(503, INVALID_RANGE_MESSAGE, "reply");
        }
        if (rangeHeader !== undefined) {
            return { status: 416, headers: { "Content-Range": unsatisfiableContentRangeHeader(totalSize), "Accept-Ranges": "bytes" }, chunks: EMPTY_CHUNKS };
        }
        return {
            status: 200,
            headers: { "Content-Type": firstSuccess.contentType || "application/octet-stream", "Accept-Ranges": "bytes", "Content-Length": "0" },
            chunks: EMPTY_CHUNKS,
        };
    }
    validateReply(firstSuccess, requestedRange, totalSize, requestedRange.start);
    const status = rangeHeader === undefined ? 200 : 206;
    const headers: Record<string, string> = {
        "Content-Type": firstSuccess.contentType || "application/octet-stream",
        "Accept-Ranges": "bytes",
        "Content-Length": String(contentLength(requestedRange)),
    };
    if (status === 206) headers["Content-Range"] = contentRangeHeader(requestedRange, totalSize);

    async function* readChunks(): AsyncGenerator<Uint8Array> {
        yield firstSuccess.data;
        let nextStart = firstSuccess.range.end + 1;
        while (nextStart <= requestedRange.end && !signal.aborted) {
            const nextEnd = Math.min(requestedRange.end, nextStart + MAX_BOARD_PIPE_CHUNK_BYTES - 1);
            let reply;
            try {
                reply = await boardPipeService.read(host, kind, id, undefined, { start: nextStart, end: nextEnd }, signal);
            } catch (error: unknown) {
                const readStatus = error instanceof BoardPipeError ? error.status : 503;
                throw new BoardPipeRangeError(readStatus, errMessage(error, "Board pipe unavailable."), "read");
            }
            if (reply.ok === false) throw new BoardPipeRangeError(reply.status, reply.error, "reply");
            validateReply(reply, { start: nextStart, end: nextEnd }, totalSize, nextStart);
            yield reply.data;
            nextStart = reply.range.end + 1;
        }
    }

    return { status, headers, chunks: readChunks() };
}

function validateReply(
    reply: { totalSize: number; range: ByteRange | null; data: Uint8Array },
    requested: ByteRange,
    totalSize: number,
    expectedStart: number,
): asserts reply is { totalSize: number; range: ByteRange; data: Uint8Array } {
    if (reply.totalSize !== totalSize || !reply.range || reply.range.start !== expectedStart
        || reply.range.end < reply.range.start || reply.range.end > requested.end
        || reply.range.end !== reply.range.start + reply.data.length - 1
        || reply.data.length > MAX_BOARD_PIPE_CHUNK_BYTES) {
        throw new BoardPipeRangeError(503, INVALID_RANGE_MESSAGE, "reply");
    }
}
