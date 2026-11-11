import type { BoardFetchHead, BoardFetchInit } from "../ipc/board-bridge/frame-protocol";
import type { HostFrameChannel } from "./board-host-frame-channel";
import type { MainPortChannel } from "./main-port-channel";

interface BoardFetchInitInput extends Omit<BoardFetchInit, "body"> {
    body?: string | ArrayBuffer | ArrayBufferView | Blob;
    signal?: AbortSignal;
}
interface PendingBoardFetch {
    fail: (error: Error) => void;
    controller?: ReadableStreamDefaultController<Uint8Array>;
    pullResolve?: (chunk: { id: number; chunk?: ArrayBuffer; done: boolean }) => void;
    signal?: AbortSignal;
    abortListener?: () => void;
}

export function createFetchApi(deps: { hostFrame: HostFrameChannel; mainPort: MainPortChannel }) {
    const { hostFrame, mainPort } = deps;
    const fetchStreams = new Map<number, PendingBoardFetch>();

    function abortError(): DOMException { return new DOMException("The fetch was aborted.", "AbortError"); }
    function removeAbortListener(pending: PendingBoardFetch): void {
        if (pending.signal && pending.abortListener) pending.signal.removeEventListener("abort", pending.abortListener);
    }
    function failPending(error: Error): void {
        hostFrame.failPending("fetch", error);
        for (const [id, pending] of fetchStreams) {
            fetchStreams.delete(id);
            removeAbortListener(pending);
            try { pending.controller?.error(error); } catch { /* stream already closed */ }
            pending.pullResolve?.({ id, done: true });
        }
    }

    async function boardFetch(url: string, init: BoardFetchInitInput = {}): Promise<Response> {
        if (typeof url !== "string") return Promise.reject(new TypeError("persephone.fetch() requires a URL string."));
        const { signal, body, ...options } = init;
        if (signal?.aborted) return Promise.reject(abortError());
        let wireBody: string | ArrayBuffer | undefined;
        if (typeof body === "string") wireBody = body;
        else if (body instanceof Blob) wireBody = await body.arrayBuffer();
        else if (body instanceof ArrayBuffer) wireBody = body;
        else if (ArrayBuffer.isView(body)) wireBody = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer;
        if (signal?.aborted) throw abortError();
        const { id, promise } = hostFrame.requestWithId("fetch", { url, init: { ...options, ...(wireBody === undefined ? {} : { body: wireBody }) } });
        const abort = (): void => {
            hostFrame.emit("fetch.abort", { id });
            hostFrame.cancel(id, abortError());
            fetchStreams.get(id)?.fail(abortError());
        };
        signal?.addEventListener("abort", abort, { once: true });
        let head: BoardFetchHead;
        try { head = await promise; }
        catch (error: unknown) { signal?.removeEventListener("abort", abort); throw error; }
        if (!head.hasBody) {
            signal?.removeEventListener("abort", abort);
            return new Response(null, { status: head.status, statusText: head.statusText, headers: head.headers });
        }
        const pending: PendingBoardFetch = {
            fail: (error) => {
                try { pending.controller?.error(error); } catch { /* stream already closed */ }
                fetchStreams.delete(id);
                removeAbortListener(pending);
                pending.pullResolve?.({ id, done: true });
            },
            signal,
            abortListener: abort,
        };
        fetchStreams.set(id, pending);
        const stream = new ReadableStream<Uint8Array>({
            start(controller) { pending.controller = controller; },
            async pull() {
                if (!fetchStreams.has(id)) return;
                const chunk = await new Promise<{ id: number; chunk?: ArrayBuffer; done: boolean }>((resolve) => {
                    pending.pullResolve = resolve;
                    hostFrame.emit("fetch.pull", { id });
                });
                pending.pullResolve = undefined;
                if (chunk.done) { fetchStreams.delete(id); removeAbortListener(pending); pending.controller?.close(); }
                else if (chunk.chunk) pending.controller?.enqueue(new Uint8Array(chunk.chunk));
            },
            cancel() { hostFrame.emit("fetch.abort", { id }); fetchStreams.delete(id); removeAbortListener(pending); },
        });
        return new Response(stream, { status: head.status, statusText: head.statusText, headers: head.headers });
    }

    hostFrame.on("fetch.chunk", (payload) => fetchStreams.get(payload.id)?.pullResolve?.(payload));
    hostFrame.on("fetch.error", (payload) => {
        const pending = fetchStreams.get(payload.id);
        if (!pending) return;
        pending.fail(new Error(payload.message));
    });
    mainPort.onReplace(() => failPending(new Error("Persephone bridge was replaced.")));
    mainPort.onMessageError(() => failPending(new Error("Persephone bridge is unavailable.")));

    return { api: { fetch: boardFetch } };
}
