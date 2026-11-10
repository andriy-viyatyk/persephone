import { BrowserWindow, WebContents } from "electron";
import { openWindows } from "../open-windows";
import { MCP_EXECUTE, MCP_RESULT } from "../../shared/constants";
import { McpResponse } from "./types";
import { guardedIpcOn } from "../ipc-sender-guard";
import { PendingRequestError, PendingRequests } from "../../shared/pending-requests";
import { errMessage } from "../../shared/utils";

// ── IPC Bridge (main ↔ renderer) ───────────────────────────────────
// Reuses the same MCP_EXECUTE/MCP_RESULT channels as the old pipe server.

const REQUEST_TIMEOUT_MS = 30_000;
export const RENDERER_REQUEST_TIMEOUT_MESSAGE = "Request timeout";

let ipcInitialized = false;
let requestIdGen = 0;
const pendingRequests = new PendingRequests<McpResponse, { startedAt: number }, string>({
    nextId: () => `mcp_${++requestIdGen}_${Date.now()}`,
    timeoutError: () => new PendingRequestError("timeout", RENDERER_REQUEST_TIMEOUT_MESSAGE),
});

export function hasRecentRendererRequest(windowMs = 5000): boolean {
    const now = Date.now();
    return pendingRequests.some((meta) => now - meta.startedAt <= windowMs);
}

export function initMcpIpc(): void {
    if (ipcInitialized) return;
    ipcInitialized = true;

    guardedIpcOn(MCP_RESULT, (_event, requestId: string, response: McpResponse) => {
        pendingRequests.settle(requestId, response);
    });
}

export async function sendToRenderer(method: string, params: unknown, windowIndex?: number, timeoutMs?: number): Promise<McpResponse> {
    // The reply listener must exist before any request goes out. Board bridge calls use this
    // transport too, and can arrive before (or without) the MCP HTTP server starting — a restored
    // board calls at once — so their replies were dropped and the call timed out.
    initMcpIpc();
    const windowData = windowIndex !== undefined
        ? openWindows.findWindowDataByIndex(windowIndex)
        : openWindows.allWindowData().find(w => !w.boardRoot && w.window);

    if (!windowData) {
        return { error: { code: -32603, message: windowIndex !== undefined
            ? `Window ${windowIndex} does not exist`
            : "No renderer window available",
        } };
    }

    // Closed windows must be opened first via windows[i].open().
    if (!windowData.window) {
        return { error: { code: -32603, message: `Window ${windowIndex} is closed. Use windows[${windowIndex}].open() to reopen it first.` } };
    }

    // Wait for renderer to be fully initialized
    if (windowData.whenReady) {
        await windowData.whenReady;
    }

    const effectiveTimeout = timeoutMs ?? REQUEST_TIMEOUT_MS;
    const { id: requestId, promise } = pendingRequests.create(effectiveTimeout, undefined, { meta: { startedAt: Date.now() } });
    const response = promise.catch((error: unknown): McpResponse => ({ error: { code: -32603, message: errMessage(error) } }));
    try {
        windowData.window.window.webContents.send(MCP_EXECUTE, requestId, method, params);
    } catch (error) {
        pendingRequests.fail(requestId, error);
        throw error;
    }
    return response;
}

/** Send through the existing correlated renderer transport to a specific host WebContents. */
export function sendToRendererForWebContents(
    method: string,
    params: unknown,
    hostWebContents: WebContents,
    timeoutMs?: number,
): Promise<McpResponse> {
    const hostWindow = BrowserWindow.fromWebContents(hostWebContents);
    const windowData = openWindows.allWindowData().find((entry) => entry.window?.window === hostWindow);
    if (!windowData) {
        return Promise.resolve({ error: { code: -32603, message: "The Board host renderer is unavailable." } });
    }
    return sendToRenderer(method, params, windowData.index, timeoutMs);
}

/** Resolve every in-flight renderer request with an error (server shutdown). */
export function cancelPendingRequests(message: string): void {
    pendingRequests.failAll(new Error(message));
}
