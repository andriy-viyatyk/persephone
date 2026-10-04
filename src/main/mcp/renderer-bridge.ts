import { BrowserWindow, WebContents } from "electron";
import { openWindows } from "../open-windows";
import { MCP_EXECUTE, MCP_RESULT } from "../../shared/constants";
import { McpResponse } from "./types";
import { guardedIpcOn } from "../ipc-sender-guard";

// ── IPC Bridge (main ↔ renderer) ───────────────────────────────────
// Reuses the same MCP_EXECUTE/MCP_RESULT channels as the old pipe server.

const REQUEST_TIMEOUT_MS = 30_000;
export const RENDERER_REQUEST_TIMEOUT_MESSAGE = "Request timeout";

let ipcInitialized = false;
let requestIdGen = 0;
const pendingRequests = new Map<string, { resolve: (response: McpResponse) => void; startedAt: number }>();

export function hasRecentRendererRequest(windowMs = 5000): boolean {
    const now = Date.now();
    return Array.from(pendingRequests.values()).some(request => now - request.startedAt <= windowMs);
}

export function initMcpIpc(): void {
    if (ipcInitialized) return;
    ipcInitialized = true;

    guardedIpcOn(MCP_RESULT, (_event, requestId: string, response: McpResponse) => {
        const request = pendingRequests.get(requestId);
        if (request) {
            pendingRequests.delete(requestId);
            request.resolve(response);
        }
    });
}

export async function sendToRenderer(method: string, params: unknown, windowIndex?: number, timeoutMs?: number): Promise<McpResponse> {
    const windowData = windowIndex !== undefined
        ? openWindows.windows.find(w => w.index === windowIndex)
        : openWindows.windows.find(w => w.window);

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

    const requestId = `mcp_${++requestIdGen}_${Date.now()}`;
    const effectiveTimeout = timeoutMs ?? REQUEST_TIMEOUT_MS;

    return new Promise((resolve) => {
        let timer: ReturnType<typeof setTimeout> | undefined;

        if (effectiveTimeout > 0) {
            timer = setTimeout(() => {
                pendingRequests.delete(requestId);
                resolve({ error: { code: -32603, message: RENDERER_REQUEST_TIMEOUT_MESSAGE } });
            }, effectiveTimeout);
        }

        pendingRequests.set(requestId, { startedAt: Date.now(), resolve: (response) => {
            if (timer) clearTimeout(timer);
            resolve(response);
        } });

        windowData.window.window.webContents.send(MCP_EXECUTE, requestId, method, params);
    });
}

/** Send through the existing correlated renderer transport to a specific host WebContents. */
export function sendToRendererForWebContents(
    method: string,
    params: unknown,
    hostWebContents: WebContents,
    timeoutMs?: number,
): Promise<McpResponse> {
    const hostWindow = BrowserWindow.fromWebContents(hostWebContents);
    const windowData = openWindows.windows.find((entry) => entry.window?.window === hostWindow);
    if (!windowData) {
        return Promise.resolve({ error: { code: -32603, message: "The Board host renderer is unavailable." } });
    }
    return sendToRenderer(method, params, windowData.index, timeoutMs);
}

/** Resolve every in-flight renderer request with an error (server shutdown). */
export function cancelPendingRequests(message: string): void {
    for (const [, request] of pendingRequests) {
        request.resolve({ error: { code: -32603, message } });
    }
    pendingRequests.clear();
}
