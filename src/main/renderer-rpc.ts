import { BrowserWindow } from "electron";
import type { WebContents } from "electron";
import { RendererRpcChannel, type RendererRpcMethod, type RendererRpcMethods, type RendererRpcReply } from "../ipc/renderer-rpc";
import { PendingRequests } from "../shared/pending-requests";
import { codedError } from "../shared/coded-error";
import { fromWireError } from "../shared/wire-error";
import { errMessage } from "../shared/utils";
import { openWindows } from "./open-windows";
import { guardedIpcOn } from "./ipc-sender-guard";
import { onWebContentsGone } from "./webcontents-lifetime";

const REQUEST_TIMEOUT_MS = 30_000;
/** Pass when the caller owns the deadline and supplies a signal; undefined keeps the 30 s default. */
export const RENDERER_REQUEST_NO_TIMEOUT = 0;
export const RENDERER_REQUEST_TIMEOUT_MESSAGE = "Request timeout";

export type RendererRpcTarget = { windowIndex?: number } | { webContents: WebContents };

interface PendingMeta {
    startedAt: number;
    method: RendererRpcMethod;
    webContentsId: number;
}

let ipcInitialized = false;
let requestIdGen = 0;
const pendingRequests = new PendingRequests<RendererRpcReply, PendingMeta, string>({
    nextId: () => `rpc_${++requestIdGen}`,
    timeoutError: () => codedError("timeout", RENDERER_REQUEST_TIMEOUT_MESSAGE),
    abortError: (reason) => reason ?? codedError("cancelled"),
});
const webContentsDisposers = new Map<number, () => void>();

function ensureReplyListener(): void {
    if (ipcInitialized) return;
    ipcInitialized = true;
    guardedIpcOn(RendererRpcChannel.reply, (event, requestId: string, reply: RendererRpcReply) => {
        pendingRequests.settle(requestId, reply, (meta) => meta.webContentsId === event.sender.id);
    });
}

function sendCancel(webContents: WebContents, id: string): void {
    try {
        if (!webContents.isDestroyed()) webContents.send(RendererRpcChannel.cancel, id);
    } catch { /* Renderer exited. */ }
}

function trackWebContents(webContents: WebContents): void {
    const id = webContents.id;
    if (webContentsDisposers.has(id)) return;
    const dispose = onWebContentsGone(webContents, () => {
        webContentsDisposers.get(id)?.();
        webContentsDisposers.delete(id);
        pendingRequests.failWhere(
            (meta) => meta.webContentsId === id,
            codedError("window-unavailable", "The renderer window closed before it replied."),
        );
    }, { events: ["destroyed", "render-process-gone"] });
    webContentsDisposers.set(id, dispose);
}

export function hasRecentRendererRequest(windowMs = 5000): boolean {
    const now = Date.now();
    return pendingRequests.some((meta) => meta.method !== "capabilityOpen" && now - meta.startedAt <= windowMs);
}

/**
 * `signal` aborts the request locally and tells the renderer handler to stop.
 * `timeoutMs` defaults to 30 seconds; pass RENDERER_REQUEST_NO_TIMEOUT when the caller owns the
 * deadline and supplies a signal.
 */
export async function requestRenderer<M extends RendererRpcMethod>(
    method: M,
    params: RendererRpcMethods[M]["params"],
    target?: RendererRpcTarget,
    timeoutMs?: number,
    signal?: AbortSignal,
): Promise<RendererRpcMethods[M]["result"]> {
    if (signal?.aborted) throw signal.reason ?? codedError("cancelled");
    ensureReplyListener();

    const targetWebContents = target && "webContents" in target ? target.webContents : undefined;
    const windowIndex = targetWebContents ? undefined : target && "windowIndex" in target ? target.windowIndex : undefined;
    const windowData = targetWebContents
        ? openWindows.allWindowData().find((entry) => entry.window?.window === BrowserWindow.fromWebContents(targetWebContents))
        : windowIndex !== undefined
            ? openWindows.findWindowDataByIndex(windowIndex)
            : openWindows.allWindowData().find((entry) => !entry.boardRoot && entry.window);

    if (!windowData) {
        throw codedError("window-unavailable", target && "webContents" in target
            ? "The Board host renderer is unavailable."
            : windowIndex !== undefined ? `Window ${windowIndex} does not exist` : "No renderer window available");
    }
    if (!windowData.window) {
        throw codedError("window-unavailable", `Window ${windowIndex} is closed. Use windows[${windowIndex}].open() to reopen it first.`);
    }
    if (windowData.whenReady) await windowData.whenReady;
    if (signal?.aborted) throw signal.reason ?? codedError("cancelled");

    const webContents = windowData.window.window.webContents;
    trackWebContents(webContents);
    const { id, promise } = pendingRequests.create(timeoutMs ?? REQUEST_TIMEOUT_MS, signal, {
        meta: { startedAt: Date.now(), method, webContentsId: webContents.id },
    });
    void promise.catch((): void => undefined);
    try {
        webContents.send(RendererRpcChannel.request, id, method, params);
    } catch (error: unknown) {
        const sendError = codedError("window-unavailable", errMessage(error, "Renderer is unavailable."));
        pendingRequests.fail(id, sendError);
        throw sendError;
    }
    let reply: RendererRpcReply;
    try { reply = await promise; }
    catch (error: unknown) { sendCancel(webContents, id); throw error; }
    if (reply.ok === false) throw fromWireError(reply.error);
    return reply.result as RendererRpcMethods[M]["result"];
}

export function cancelRendererRequests(message: string): void {
    pendingRequests.failWhere((meta) => meta.method === "mcpCall", codedError("cancelled", message));
}
