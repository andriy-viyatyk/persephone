import { randomUUID } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import { app as electronApp, ipcMain } from "electron";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { openWindows } from "./open-windows";
import { windowStates } from "./window-states";
import { MCP_EXECUTE, MCP_RESULT } from "../shared/constants";
import { EventEndpoint } from "../ipc/api-types";
import { getAssetPath } from "./utils";

const DEFAULT_PORT = 7865;
const REQUEST_TIMEOUT_MS = 30_000;

// ── State ───────────────────────────────────────────────────────────

let httpServer: http.Server | undefined;
let ipcInitialized = false;
let requestIdGen = 0;
let currentPort = DEFAULT_PORT;
const pendingRequests = new Map<string, (response: { result?: any; error?: any }) => void>();
const sessions = new Map<string, { server: McpServer; transport: StreamableHTTPServerTransport }>();

// ── IPC Bridge (main ↔ renderer) ───────────────────────────────────
// Reuses the same MCP_EXECUTE/MCP_RESULT channels as the old pipe server.

function initMcpIpc(): void {
    if (ipcInitialized) return;
    ipcInitialized = true;

    ipcMain.on(MCP_RESULT, (_event, requestId: string, response: any) => {
        const resolve = pendingRequests.get(requestId);
        if (resolve) {
            pendingRequests.delete(requestId);
            resolve(response);
        }
    });
}

async function sendToRenderer(method: string, params: any, windowIndex?: number): Promise<{ result?: any; error?: any }> {
    const windowData = windowIndex !== undefined
        ? openWindows.windows.find(w => w.index === windowIndex)
        : openWindows.windows.find(w => w.window);

    if (!windowData) {
        return { error: { code: -32603, message: windowIndex !== undefined
            ? `Window ${windowIndex} does not exist`
            : "No renderer window available",
        } };
    }

    // Closed windows must be opened first via open_window tool
    if (!windowData.window) {
        return { error: { code: -32603, message: `Window ${windowIndex} is closed. Use the open_window tool to reopen it first.` } };
    }

    // Wait for renderer to be fully initialized
    if (windowData.whenReady) {
        await windowData.whenReady;
    }

    const requestId = `mcp_${++requestIdGen}_${Date.now()}`;

    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            pendingRequests.delete(requestId);
            resolve({ error: { code: -32603, message: "Request timeout" } });
        }, REQUEST_TIMEOUT_MS);

        pendingRequests.set(requestId, (response) => {
            clearTimeout(timeout);
            resolve(response);
        });

        windowData.window!.window.webContents.send(MCP_EXECUTE, requestId, method, params);
    });
}

// ── MCP Tool Result Helper ─────────────────────────────────────────

function toToolResult(response: { result?: any; error?: any }) {
    if (response.error) {
        return {
            content: [{ type: "text" as const, text: `Error: ${response.error.message}` }],
            isError: true,
        };
    }
    const text = response.result != null ? JSON.stringify(response.result, null, 2) : "OK";
    return { content: [{ type: "text" as const, text }] };
}

// ── Status Broadcast ────────────────────────────────────────────────

function broadcastMcpStatus(): void {
    openWindows.send(EventEndpoint.eMcpStatusChanged, {
        running: isMcpHttpServerRunning(),
        url: getMcpUrl(),
        clientCount: getMcpClientCount(),
    });
}

// ── MCP Server Factory ─────────────────────────────────────────────
// Creates a new McpServer per session (SDK requires one transport per server).

function createMcpServer(): McpServer {
    const server = new McpServer({
        name: "js-notepad",
        version: electronApp.getVersion(),
    });

    // ── Window parameter (shared across tools) ────────────────────────
    const windowIndexParam = z.number().int().optional().describe(
        "Target window index (from list_windows). If omitted, uses the first open window. Use open_window to reopen closed windows first.",
    );

    // ── Multi-window tools ───────────────────────────────────────────
    server.tool(
        "list_windows",
        "List all windows (open and closed) with their status and pages. Closed windows have persisted pages and can be reopened with open_window. Returns array of { windowIndex, status, pageCount, activePageId, pages: [{ id, title, type, editor, language, filePath, modified, pinned }] }.",
        async () => {
            const result = openWindows.windows.map(w => {
                const wState = windowStates.getState(w.index);
                return {
                    windowIndex: w.index,
                    status: w.window ? "open" : "closed",
                    pageCount: wState?.pages?.length ?? 0,
                    activePageId: wState?.activePageId,
                    pages: (wState?.pages || []).map(p => ({
                        id: p.id,
                        title: p.title,
                        type: p.type,
                        editor: p.editor,
                        language: p.language,
                        filePath: p.filePath,
                        modified: p.modified,
                        pinned: p.pinned,
                    })),
                };
            });
            const text = JSON.stringify(result, null, 2);
            return { content: [{ type: "text" as const, text }] };
        },
    );

    server.tool(
        "open_window",
        "Open (or reopen) a window by index. If the window is closed, it will be recreated with its persisted pages. If already open, it will be focused. Returns { windowIndex, status }.",
        {
            windowIndex: z.number().int().describe("The window index to open (from list_windows)."),
        },
        async ({ windowIndex }) => {
            const windowData = openWindows.windows.find(w => w.index === windowIndex);
            if (!windowData) {
                return {
                    content: [{ type: "text" as const, text: `Error: Window ${windowIndex} does not exist` }],
                    isError: true,
                };
            }

            if (windowData.window) {
                windowData.window.focus();
                return { content: [{ type: "text" as const, text: JSON.stringify({ windowIndex, status: "open", message: "Window is already open and focused" }) }] };
            }

            try {
                openWindows.createWindow(windowIndex);
                if (windowData.whenReady) {
                    await windowData.whenReady;
                }
                return { content: [{ type: "text" as const, text: JSON.stringify({ windowIndex, status: "open", message: "Window reopened successfully" }) }] };
            } catch (err) {
                return {
                    content: [{ type: "text" as const, text: `Error: Failed to open window ${windowIndex}: ${err}` }],
                    isError: true,
                };
            }
        },
    );

    // ── Page & script tools ──────────────────────────────────────────
    server.tool(
        "execute_script",
        "Execute JavaScript in js-notepad. The script has access to `page` (active page — content, language, editor, grouped) and `app` (pages, fs, settings, ui, shell, window). Returns { text, language, isError, consoleLogs }. Use for complex operations, transformations, and accessing structured editors via page facades (asGrid, asNotebook, asTodo, etc.).",
        {
            script: z.string().describe("JavaScript code to execute. Supports async/await. Last expression is returned as result."),
            pageId: z.string().optional().describe("Target page ID. If omitted, uses the active page."),
            windowIndex: windowIndexParam,
        },
        async ({ script, pageId, windowIndex }) => toToolResult(await sendToRenderer("execute_script", { script, pageId }, windowIndex)),
    );

    server.tool(
        "list_pages",
        "List all open pages (tabs) in a window. Returns array of { id, title, type, editor, language, filePath, modified, pinned, active }.",
        {
            windowIndex: windowIndexParam,
        },
        async ({ windowIndex }) => toToolResult(await sendToRenderer("get_pages", {}, windowIndex)),
    );

    server.tool(
        "get_page_content",
        "Get the text content of a page by ID. Works for text-based pages (monaco, markdown, JSON, CSV, etc.). Returns { id, title, content }.",
        {
            pageId: z.string().describe("The page ID (from list_pages)."),
            windowIndex: windowIndexParam,
        },
        async ({ pageId, windowIndex }) => toToolResult(await sendToRenderer("get_page_content", { pageId }, windowIndex)),
    );

    server.tool(
        "get_active_page",
        "Get the currently active (focused) page with its content and metadata. Returns { id, title, type, editor, language, filePath, modified, content }.",
        {
            windowIndex: windowIndexParam,
        },
        async ({ windowIndex }) => toToolResult(await sendToRenderer("get_active_page", {}, windowIndex)),
    );

    server.tool(
        "create_page",
        "Create a new page (tab) with optional content. Returns { id, title, editor, language }. Common editors: 'monaco' (text), 'grid-json' (JSON grid), 'grid-csv' (CSV grid), 'md-view' (markdown preview). Common languages: 'javascript', 'typescript', 'json', 'html', 'css', 'markdown', 'python', 'plaintext'.",
        {
            title: z.string().optional().describe("Page title. Defaults to 'Untitled'."),
            content: z.string().optional().describe("Initial text content."),
            language: z.string().optional().describe("Monaco language ID (e.g. 'javascript', 'json', 'markdown'). Defaults to 'plaintext'."),
            editor: z.string().optional().describe("Editor type (e.g. 'monaco', 'grid-json', 'md-view'). Defaults to 'monaco'."),
            windowIndex: windowIndexParam,
        },
        async ({ title, content, language, editor, windowIndex }) =>
            toToolResult(await sendToRenderer("create_page", { title, content, language, editor }, windowIndex)),
    );

    server.tool(
        "set_page_content",
        "Update the text content of a page by ID. Works for text-based pages only. For structured editors (grid, notebook, todo), use execute_script with page facades instead.",
        {
            pageId: z.string().describe("The page ID (from list_pages)."),
            content: z.string().describe("The new text content to set."),
            windowIndex: windowIndexParam,
        },
        async ({ pageId, content, windowIndex }) => toToolResult(await sendToRenderer("set_page_content", { pageId, content }, windowIndex)),
    );

    server.tool(
        "get_app_info",
        "Get application info: { version, pageCount, activePageId }.",
        {
            windowIndex: windowIndexParam,
        },
        async ({ windowIndex }) => toToolResult(await sendToRenderer("get_app_info", {}, windowIndex)),
    );

    // ── MCP Resource: API Guide ───────────────────────────────────────
    server.registerResource(
        "api-guide",
        "notepad://docs/api-guide",
        {
            description: "js-notepad scripting API guide — covers the page object, app services, editor facades, and practical examples. Read this to understand how to write scripts and use MCP tools effectively.",
            mimeType: "text/markdown",
        },
        async (uri) => {
            const content = fs.readFileSync(getAssetPath("mcp-api-guide.md"), "utf-8");
            return {
                contents: [{
                    uri: uri.href,
                    mimeType: "text/markdown",
                    text: content,
                }],
            };
        },
    );

    return server;
}

// ── HTTP Body Parser ───────────────────────────────────────────────

function parseJsonBody(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
        let data = "";
        req.on("data", (chunk: Buffer) => { data += chunk.toString(); });
        req.on("end", () => {
            try {
                resolve(data ? JSON.parse(data) : undefined);
            } catch {
                reject(new Error("Invalid JSON"));
            }
        });
        req.on("error", reject);
    });
}

// ── HTTP Request Handler ───────────────────────────────────────────

async function handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://localhost:${currentPort}`);
    if (url.pathname !== "/mcp") {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not found" }));
        return;
    }

    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    try {
        if (req.method === "POST") {
            const body = await parseJsonBody(req);

            if (sessionId && sessions.has(sessionId)) {
                await sessions.get(sessionId)!.transport.handleRequest(req, res, body);
            } else if (!sessionId && isInitializeRequest(body)) {
                const mcpServer = createMcpServer();
                const transport = new StreamableHTTPServerTransport({
                    sessionIdGenerator: () => randomUUID(),
                    onsessioninitialized: (sid: string) => {
                        sessions.set(sid, { server: mcpServer, transport });
                        broadcastMcpStatus();
                    },
                });

                transport.onclose = () => {
                    const sid = transport.sessionId;
                    if (sid) sessions.delete(sid);
                    broadcastMcpStatus();
                };

                await mcpServer.connect(transport);
                await transport.handleRequest(req, res, body);
            } else {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({
                    jsonrpc: "2.0",
                    error: { code: -32000, message: "Bad request: no valid session ID" },
                    id: null,
                }));
            }
        } else if (req.method === "GET") {
            if (!sessionId || !sessions.has(sessionId)) {
                res.writeHead(400, { "Content-Type": "text/plain" });
                res.end("Invalid or missing session ID");
                return;
            }
            await sessions.get(sessionId)!.transport.handleRequest(req, res);
        } else if (req.method === "DELETE") {
            if (!sessionId || !sessions.has(sessionId)) {
                res.writeHead(400, { "Content-Type": "text/plain" });
                res.end("Invalid or missing session ID");
                return;
            }
            await sessions.get(sessionId)!.transport.handleRequest(req, res);
        } else {
            res.writeHead(405, { "Content-Type": "text/plain" });
            res.end("Method not allowed");
        }
    } catch (error) {
        console.error("MCP HTTP handler error:", error);
        if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
                jsonrpc: "2.0",
                error: { code: -32603, message: "Internal server error" },
                id: null,
            }));
        }
    }
}

// ── Server Lifecycle ───────────────────────────────────────────────

export function startMcpHttpServer(port?: number): Promise<void> {
    if (httpServer) return Promise.resolve();

    currentPort = port ?? DEFAULT_PORT;
    initMcpIpc();

    return new Promise<void>((resolve, reject) => {
        const server = http.createServer(handleHttpRequest);

        server.on("error", (err: NodeJS.ErrnoException) => {
            if (!httpServer) {
                // Startup error
                reject(err);
            }
            console.error(`MCP HTTP server error on port ${currentPort}:`, err.message);
        });

        server.listen(currentPort, "127.0.0.1", () => {
            httpServer = server;
            console.log(`MCP HTTP server started: http://localhost:${currentPort}/mcp`);
            broadcastMcpStatus();
            resolve();
        });
    });
}

export async function stopMcpHttpServer(): Promise<void> {
    if (!httpServer) return;

    // Close all active sessions
    for (const [, session] of sessions) {
        try { await session.transport.close(); } catch { /* ignore cleanup errors */ }
    }
    sessions.clear();

    // Cancel pending IPC requests
    for (const [, resolve] of pendingRequests) {
        resolve({ error: { code: -32603, message: "Server shutting down" } });
    }
    pendingRequests.clear();

    return new Promise<void>((resolve) => {
        httpServer!.close(() => {
            httpServer = undefined;
            console.log("MCP HTTP server stopped");
            broadcastMcpStatus();
            resolve();
        });
    });
}

export function isMcpHttpServerRunning(): boolean {
    return !!httpServer;
}

export function getMcpUrl(): string {
    return `http://localhost:${currentPort}/mcp`;
}

export function getMcpClientCount(): number {
    return sessions.size;
}
