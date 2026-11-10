import {
    BOARD_PIPE_CANCEL_CHANNEL,
    BOARD_PIPE_READ_CHANNEL,
    BOARD_PIPE_REPLY_CHANNEL,
    type BoardPipeCancelMessage,
    type BoardPipeReadReply,
    type BoardPipeReadRequest,
    type BoardPipeReadSuccess,
    type BoardPipeKind,
} from "../../ipc/board-pipe-channels";
import { MAX_BOARD_PIPE_CHUNK_BYTES, MAX_BUFFERED_PIPE_BYTES } from "../../shared/board-pipe-constants";
import { errMessage } from "../../shared/utils";
import { parseRangeHeader, type ByteRange } from "../../shared/range-utils";
import type { IContentPipe } from "../api/types/io.pipe";
import { contentTypeForPipe } from "./board-pipe-utils";
import { api } from "../../ipc/renderer/api";

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
    /** Aborted on page close (`invalidatePagePipe()`) or on an explicit
     *  {requestId}-scoped cancel from main (`handleCancel()`, section 7a). Threaded into
     *  `createReadStream()`/`readBinary()` so the underlying module-service request is released
     *  even though a board's implementation is not obliged to observe the signal. */
    controller: AbortController;
}

const pipeMemos = new Map<string, PipeMemo>();
/** Board content and video session resources, keyed by opaque resource id. Separate from
 *  `pipeMemos`, which caches read state rather than owning a pipe. */
interface ContentResourceOwner {
    readonly pipe: IContentPipe;
    readonly kind: "board" | "video-session";
    readonly boardRoot?: string;
    readonly hostedDocument?: boolean;
}
type PipeResourceRegistration =
    | { kind: "board"; boardRoot: string; hostedDocument: boolean }
    | { kind: "video-session" };
const contentResources = new Map<string, ContentResourceOwner>();
const pendingReads = new Map<string, PendingRead>();
let initialized = false;
let resolvePagePipe: ((pageId: string) => Promise<IContentPipe | undefined>) | undefined;

function abortPendingRead(requestId: string, pending: PendingRead): void {
    if (pendingReads.get(requestId) !== pending) return;
    pending.controller.abort();
    pendingReads.delete(requestId);
}

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
            const canStreamBeforeStat = hasDirectStream(pipe);
            if (pipe.transformers.length > 0) return (await readBuffered(pipe, memo, signal)).length;
            if (typeof pipe.provider.stat !== "function") return (await readBuffered(pipe, memo, signal)).length;
            const stat = await pipe.stat({ signal });
            const sizeIsValid = stat.exists && stat.size !== undefined
                && Number.isSafeInteger(stat.size) && stat.size >= 0;
            if (!sizeIsValid) {
                if (canStreamBeforeStat) {
                    throw new Error("The board pipe provider did not report a usable resource size.");
                }
                return (await readBuffered(pipe, memo, signal)).length;
            }

            // Provider capabilities can arrive while stat crosses the service bridge, so read
            // createReadStream again after the await instead of trusting the earlier snapshot.
            if (typeof pipe.provider.createReadStream === "function") {
                memo.totalSize = stat.size;
                return stat.size;
            }
            if (stat.size > MAX_BUFFERED_PIPE_BYTES) {
                throw new Error("The board pipe has no bounded streaming provider.");
            }
            return (await readBuffered(pipe, memo, signal)).length;
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
        const resource = contentResources.get(request.pipeId);
        pipe = resource?.pipe;
        if (resource?.boardRoot && !resource.hostedDocument) {
            const descriptor = resource.pipe.toDescriptor();
            if (descriptor.provider.type === "file") {
                const filePath = descriptor.provider.config.path;
                if (typeof filePath !== "string") throw new Error("The content pipe file path is unavailable.");
                await api.authorizeBoardFilePath(resource.boardRoot, filePath, "read");
            }
        }
    } else {
        pipe = await resolvePagePipe?.(request.pipeId);
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
        controller: new AbortController(),
    };
    pendingReads.set(request.requestId, pending);
    void readChunk(request, pending.controller.signal)
        .then((result) => {
            if (!pending.controller.signal.aborted && pendingReads.get(request.requestId) === pending) reply(result);
        })
        .catch((error: unknown) => {
            if (!pending.controller.signal.aborted && pendingReads.get(request.requestId) === pending) {
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
    abortPendingRead(message.requestId, pending);
}

export function initPipeResourceServer(options: {
    resolvePagePipe(pageId: string): Promise<IContentPipe | undefined>;
}): void {
    if (initialized) return;
    initialized = true;
    resolvePagePipe = options.resolvePagePipe;
    window.electron.ipcRenderer.on(BOARD_PIPE_READ_CHANNEL, handleRequest);
    window.electron.ipcRenderer.on(BOARD_PIPE_CANCEL_CHANNEL, handleCancel);
}

export function invalidatePagePipe(pageId: string): void {
    pipeMemos.delete(`page:${pageId}`);
    for (const [requestId, pending] of pendingReads) {
        if (pending.pipeKind !== "page" || pending.pipeId !== pageId) continue;
        abortPendingRead(requestId, pending);
    }
}

/** Publish a board or video-session pipe for resource reads. */
export function registerPipeResource(
    resourceId: string,
    pipe: IContentPipe,
    registration: PipeResourceRegistration,
): void {
    if (registration.kind === "video-session" && contentResources.has(resourceId)) {
        throw new Error("The video pipe resource id is already registered.");
    }
    contentResources.set(resourceId, { pipe, ...registration });
}

export function unregisterPipeResource(resourceId: string): void {
    contentResources.delete(resourceId);
    pipeMemos.delete(`resource:${resourceId}`);
    for (const [requestId, pending] of pendingReads) {
        if (pending.pipeKind !== "resource" || pending.pipeId !== resourceId) continue;
        abortPendingRead(requestId, pending);
    }
}
