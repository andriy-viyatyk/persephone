import { randomUUID } from "node:crypto";
import http from "node:http";
import { app as electronApp, ipcMain } from "electron";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { openWindows } from "./open-windows";
import { MCP_EXECUTE, MCP_RESULT } from "../shared/constants";

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

async function sendToRenderer(method: string, params: any): Promise<{ result?: any; error?: any }> {
    const windowData = openWindows.windows.find(w => w.window);
    if (!windowData?.window) {
        return { error: { code: -32603, message: "No renderer window available" } };
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

// ── MCP Server Factory ─────────────────────────────────────────────
// Creates a new McpServer per session (SDK requires one transport per server).

function createMcpServer(): McpServer {
    const server = new McpServer({
        name: "js-notepad",
        version: electronApp.getVersion(),
    });

    // Tools use existing renderer commands via IPC bridge.
    // Descriptions refined in Phase 3 (EPIC-001).

    server.tool(
        "execute_script",
        "Execute JavaScript in js-notepad with access to `page` and `app` objects. Returns the result value and any console output captured during execution.",
        { script: z.string().describe("JavaScript code to execute") },
        async ({ script }) => toToolResult(await sendToRenderer("execute_script", { script })),
    );

    server.tool(
        "list_pages",
        "List all open pages (tabs) with their IDs, titles, editors, and metadata.",
        async () => toToolResult(await sendToRenderer("get_pages", {})),
    );

    server.tool(
        "get_page_content",
        "Get the text content of a specific page by its ID.",
        { pageId: z.string().describe("The page ID to read content from") },
        async ({ pageId }) => toToolResult(await sendToRenderer("get_page_content", { pageId })),
    );

    server.tool(
        "get_active_page",
        "Get the currently active (focused) page with its content and full metadata.",
        async () => toToolResult(await sendToRenderer("get_active_page", {})),
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
                    },
                });

                transport.onclose = () => {
                    const sid = transport.sessionId;
                    if (sid) sessions.delete(sid);
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
