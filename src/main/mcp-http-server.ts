import { randomUUID } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import { app as electronApp, ipcMain } from "electron";
import { openWindows } from "./open-windows";
import { windowStates } from "./window-states";
import { MCP_EXECUTE, MCP_RESULT } from "../shared/constants";
import { EventEndpoint } from "../ipc/api-types";
import { getAssetPath } from "./utils";

// Lazy-loaded SDK modules (loaded on first startMcpHttpServer call)
let McpServer: typeof import("@modelcontextprotocol/sdk/server/mcp.js").McpServer;
let StreamableHTTPServerTransport: typeof import("@modelcontextprotocol/sdk/server/streamableHttp.js").StreamableHTTPServerTransport;
let isInitializeRequest: typeof import("@modelcontextprotocol/sdk/types.js").isInitializeRequest;
let z: typeof import("zod").z;

async function loadSdk(): Promise<void> {
    if (McpServer) return;
    const [mcpMod, transportMod, typesMod, zodMod] = await Promise.all([
        import("@modelcontextprotocol/sdk/server/mcp.js"),
        import("@modelcontextprotocol/sdk/server/streamableHttp.js"),
        import("@modelcontextprotocol/sdk/types.js"),
        import("zod"),
    ]);
    McpServer = mcpMod.McpServer;
    StreamableHTTPServerTransport = transportMod.StreamableHTTPServerTransport;
    isInitializeRequest = typesMod.isInitializeRequest;
    z = zodMod.z;
}

const DEFAULT_PORT = 7865;
const REQUEST_TIMEOUT_MS = 30_000;

// ── State ───────────────────────────────────────────────────────────

let httpServer: http.Server | undefined;
let ipcInitialized = false;
let requestIdGen = 0;
let currentPort = DEFAULT_PORT;
const pendingRequests = new Map<string, (response: { result?: any; error?: any }) => void>();
const sessions = new Map<string, { server: InstanceType<typeof McpServer>; transport: InstanceType<typeof StreamableHTTPServerTransport> }>();

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

async function sendToRenderer(method: string, params: any, windowIndex?: number, timeoutMs?: number): Promise<{ result?: any; error?: any }> {
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
    const effectiveTimeout = timeoutMs ?? REQUEST_TIMEOUT_MS;

    return new Promise((resolve) => {
        let timer: ReturnType<typeof setTimeout> | undefined;

        if (effectiveTimeout > 0) {
            timer = setTimeout(() => {
                pendingRequests.delete(requestId);
                resolve({ error: { code: -32603, message: "Request timeout" } });
            }, effectiveTimeout);
        }

        pendingRequests.set(requestId, (response) => {
            if (timer) clearTimeout(timer);
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

function createMcpServer(): InstanceType<typeof McpServer> {
    const server = new McpServer(
        {
            name: "js-notepad",
            version: electronApp.getVersion(),
        },
        {
            instructions: [
                "js-notepad is a developer notepad with tabbed pages, specialized editors (text, JSON/CSV grid, markdown, notebook, todo, links, PDF, browser), JavaScript/TypeScript scripting, and full Node.js access.",
                "",
                "## Main workflows",
                "",
                "1. **Show output to user** — use `ui_push` (default). Pushes log messages and interactive dialogs to a managed Log View page. Read resource `notepad://guides/ui-push` for entry types and examples.",
                "2. **Read/create/edit pages** — use `list_pages`, `get_active_page`, `get_page_content`, `create_page`, `set_page_content`. Read resource `notepad://guides/pages` for page properties, editor types, and multi-window support.",
                "3. **Open URLs in the built-in browser** — use `open_url`. js-notepad has a full browser with tabs, profiles, and incognito mode. It can be the default Windows browser.",
                "4. **Advanced operations** — use `execute_script` to run JS/TS with access to `page` (current tab) and `app` (services: pages, fs, settings, ui, shell, window, editors). Read resource `notepad://guides/scripting` for the full API reference.",
                "",
                "## When to use `ui_push` vs `create_page`",
                "",
                "**Use `ui_push` (preferred)** for: showing results, analysis, status, logs, asking questions, displaying tables/charts/diagrams. It auto-manages a Log View page and supports rich output (`output.markdown`, `output.grid`, `output.text`, `output.mermaid`).",
                "",
                "**Use `create_page`** only when the user needs an **editable document** — a text file they will modify, a grid they will sort/filter, a notebook they will add notes to. If the content is read-only output, use `ui_push` instead.",
                "",
                "## Quick tips",
                "",
                "- String entries in `ui_push` are shorthand for `log.info`",
                "- Dialog entries (`input.*`) block until the user responds",
                "- All tools accept optional `windowIndex` (default: first open window)",
                "- Read only the resource you need — each guide is self-contained",
                "",
                "## IMPORTANT: `create_page` editor + language pairing",
                "",
                "Non-monaco editors REQUIRE a matching `language` parameter. Wrong language = broken rendering.",
                "",
                "| editor | language (required) | title suffix (recommended) |",
                "|--------|-------------------|--------------------------|",
                "| `monaco` (default) | any (`plaintext`, `javascript`, `json`, etc.) | — |",
                "| `md-view` | `markdown` | — |",
                "| `grid-json` | `json` | `.grid.json` |",
                "| `grid-csv` | `csv` | — |",
                "| `notebook-view` | `json` | `.note.json` |",
                "| `todo-view` | `json` | `.todo.json` |",
                "| `link-view` | `json` | `.link.json` |",
                "| `graph-view` | `json` | `.fg.json` |",
                "| `svg-view` | `xml` | `.svg` |",
                "| `html-view` | `html` | — |",
                "| `mermaid-view` | `mermaid` | — |",
                "",
                "Page-editors (browser-view, pdf-view, image-view) are NOT supported by `create_page` — use `open_url` for browser, `execute_script` with `app.pages.openFile()` for PDF/image.",
                "",
                "Before using non-monaco editors with structured content (notebook, todo, link, grid, graph), read `notepad://guides/pages` for the required JSON format.",
            ].join("\n"),
        },
    );

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
        "Execute JavaScript or TypeScript in js-notepad. The script has access to `page` (active page — content, language, editor, grouped) and `app` (pages, fs, settings, ui, shell, window). Returns { text, language, isError, consoleLogs }. Use for complex operations, transformations, and accessing structured editors via page facades (asGrid, asNotebook, asTodo, etc.). TypeScript is transpiled via sucrase before execution.",
        {
            script: z.string().describe("JavaScript or TypeScript code to execute. Supports async/await. Last expression is returned as result."),
            pageId: z.string().optional().describe("Target page ID. If omitted, uses the active page."),
            language: z.enum(["javascript", "typescript"]).optional().describe("Script language. Defaults to 'javascript'. Use 'typescript' to write scripts with type annotations."),
            windowIndex: windowIndexParam,
        },
        async ({ script, pageId, language, windowIndex }) => toToolResult(await sendToRenderer("execute_script", { script, pageId, language }, windowIndex)),
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
        "Create a new page (tab) with optional content. Use this only for editable documents — for showing results/analysis to the user, prefer ui_push instead. Returns { id, title, editor, language }. CRITICAL: non-monaco editors require a matching language parameter or rendering will break. Key pairings: md-view requires language='markdown', grid-json requires language='json', grid-csv requires language='csv'. For structured editors (notebook, todo, link), read notepad://guides/pages for required JSON content format. Page-editors (browser-view, pdf-view, image-view) are not supported — use open_url or execute_script.",
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
        "Update the text content of a page by ID. Works for text-based pages only. IMPORTANT: For non-monaco editors, read resource `notepad://guides/pages` first to learn the required content format. For structured editors (grid, notebook, todo), use execute_script with page facades instead.",
        {
            pageId: z.string().describe("The page ID (from list_pages)."),
            content: z.string().describe("The new text content to set."),
            windowIndex: windowIndexParam,
        },
        async ({ pageId, content, windowIndex }) => toToolResult(await sendToRenderer("set_page_content", { pageId, content }, windowIndex)),
    );

    server.tool(
        "ui_push",
        "Push entries to the Log View page — the AI agent's default output channel. Entries can be log messages (display-only), dialogs (interactive, blocks until user responds), or output items (rich display). String entries are treated as log.info. The tool manages an active Log View page automatically (creates on first call, reuses on subsequent calls). If entries contain dialogs, the tool blocks until ALL dialogs are resolved.",
        {
            entries: z.array(z.union([
                z.string(),
                z.object({
                    type: z.string(),
                }).passthrough(),
            ])).describe("Array of flat entries. Strings are shorthand for log.info. Objects: { type, ...fields } — type-specific fields at top level.\n\nLog types: log.text/info/warn/error/success — fields: text.\nDialog types: input.confirm/text/buttons/checkboxes/radioboxes/select — read resource for fields.\nOutput types:\n  output.text — fields: text, language?, title?, wordWrap?, lineNumbers?, minimap?\n  output.markdown — fields: text, title?\n  output.mermaid — fields: text, title?\n  output.grid — fields: content (JSON array or CSV string), contentType? ('json'|'csv'), title?\n  output.progress — fields: label?, value?, max?, completed?"),
            windowIndex: windowIndexParam,
        },
        async ({ entries, windowIndex }) => {
            // Detect if any entries contain dialogs → use no timeout (0) for infinite wait
            const hasDialogs = entries.some(
                (e) => typeof e === "object" && typeof e.type === "string" && e.type.startsWith("input."),
            );
            return toToolResult(
                await sendToRenderer("ui_push", { entries }, windowIndex, hasDialogs ? 0 : undefined),
            );
        },
    );

    server.tool(
        "get_app_info",
        "Get application info: { version, pageCount, activePageId }.",
        {
            windowIndex: windowIndexParam,
        },
        async ({ windowIndex }) => toToolResult(await sendToRenderer("get_app_info", {}, windowIndex)),
    );

    server.tool(
        "open_url",
        "Open a URL in the built-in browser. js-notepad has a full browser with tabs, profiles, and incognito mode. Reuses an existing browser page if one is open (adds a new tab), or creates a new browser page. Returns { opened: url }.",
        {
            url: z.string().describe("The URL to open."),
            profileName: z.string().optional().describe("Browser profile name. Uses the default profile if omitted."),
            incognito: z.boolean().optional().describe("Open in incognito mode (no cookies, no history)."),
            windowIndex: windowIndexParam,
        },
        async ({ url, profileName, incognito, windowIndex }) =>
            toToolResult(await sendToRenderer("open_url", { url, profileName, incognito }, windowIndex)),
    );

    // ── MCP Resources (focused guides) ─────────────────────────────────

    const resourceFiles = [
        {
            name: "ui-push-guide",
            uri: "notepad://guides/ui-push",
            file: "mcp-res-ui-push.md",
            description: "ui_push tool guide — log messages, dialogs, entry types, and examples. Read this first when the user asks to show, display, or present something.",
        },
        {
            name: "pages-guide",
            uri: "notepad://guides/pages",
            file: "mcp-res-pages.md",
            description: "Pages & windows guide — page properties, editor types, creating pages, multi-window support. Read when working with tabs, reading content, or creating documents.",
        },
        {
            name: "scripting-guide",
            uri: "notepad://guides/scripting",
            file: "mcp-res-scripting.md",
            description: "Scripting API reference — app object (pages, fs, settings, ui, shell, window), editor facades (grid, notebook, todo, links, browser), TypeScript, Node.js access. Read when using execute_script.",
        },
    ];

    for (const res of resourceFiles) {
        server.registerResource(
            res.name,
            res.uri,
            { description: res.description, mimeType: "text/markdown" },
            async (uri) => ({
                contents: [{
                    uri: uri.href,
                    mimeType: "text/markdown",
                    text: fs.readFileSync(getAssetPath(res.file), "utf-8"),
                }],
            }),
        );
    }

    // Full API guide — concatenation of all resource files (for agents that want everything)
    server.registerResource(
        "full-api-guide",
        "notepad://guides/full",
        {
            description: "Complete API guide — all resources combined. Only read this if you need the full reference; prefer the focused guides above for specific tasks.",
            mimeType: "text/markdown",
        },
        async (uri) => ({
            contents: [{
                uri: uri.href,
                mimeType: "text/markdown",
                text: resourceFiles
                    .map((r) => fs.readFileSync(getAssetPath(r.file), "utf-8"))
                    .join("\n\n---\n\n"),
            }],
        }),
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

export async function startMcpHttpServer(port?: number): Promise<void> {
    if (httpServer) return;

    await loadSdk();
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
