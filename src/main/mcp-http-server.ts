import http from "node:http";
import { cancelRendererRequests } from "./renderer-rpc";
import { loadSdk, requireSdk } from "./mcp/sdk";
import { McpSessionHost, isAllowedLoopbackHost, parseJsonBody } from "./mcp/mcp-session-host";
import { createMcpServer } from "./mcp/server-factory";
import { initializePrivateMcpEndpoints, type PrivateMcpEndpointStartDependencies } from "./mcp/private-session-endpoints";
import { getSessionSnapshots, type McpSessionSnapshot } from "./mcp/session-snapshots";
import { coalescePendingCall } from "./coalesce-pending-call";
import { mcpEndpointUrl } from "../shared/mcp-endpoint";

export type { McpSessionSnapshot } from "./mcp/session-snapshots";

// The Streamable HTTP transport for Persephone's MCP server: sessions, HTTP plumbing
// and lifecycle. What the server OFFERS — instructions, tools, guides — is defined as
// data under `mcp/` and assembled by `createMcpServer`.

const DEFAULT_PORT = 7865;

// ── Session lifecycle ───────────────────────────────────────────────
// The MCP SDK only evicts a session when the client sends an explicit HTTP
// DELETE (or we call transport.close()). Clients that just terminate — Claude
// Code restarting, a one-shot client, a reconnect after sleep — never send
// DELETE, so their sessions would accumulate forever (we observed 178 in a day).
// Each leaked session holds a full McpServer + transport in memory.
//
// Fix: track per-session activity and periodically close sessions idle past a
// TTL. transport.close() fires onclose, which funnels through the same
// sessions.delete path as DELETE — eviction stays in one place. We do NOT evict
// on SSE-stream disconnect: the session is meant to outlive a single connection
// so reconnecting clients keep working (see typescript-sdk issue #1852).
const MAX_SESSIONS = 500;            // backstop cap against burst leaks

// ── State ───────────────────────────────────────────────────────────

let httpServer: http.Server | undefined;
let currentPort = DEFAULT_PORT;
let statusChanged: () => void = () => {};
const host = new McpSessionHost<undefined>({
    createServer: createMcpServer,
    allowedSdkHosts: () => [`127.0.0.1:${currentPort}`, `localhost:${currentPort}`],
    onChange: () => statusChanged(),
    // Close sessions with no traffic for 30 min; check for idle sessions once a minute.
    idle: { sweepMs: 60_000, maxIdleMs: 30 * 60_000 },
});

// ── Status Broadcast ────────────────────────────────────────────────

export function startMcpHttpServerService(dependencies: PrivateMcpEndpointStartDependencies): void {
    statusChanged = dependencies.statusChanged;
    initializePrivateMcpEndpoints(dependencies);
}

// ── HTTP Request Handler ───────────────────────────────────────────

/** Refuse requests a web page could make: a foreign Host (DNS rebinding) or any Origin.
 *  Agent clients are Node HTTP clients and send no Origin. Returns true when refused. */
function refuseUntrustedRequest(req: http.IncomingMessage, res: http.ServerResponse): boolean {
    // Loopback authorities a legitimate client addresses this server by. A DNS-rebinding page
    // arrives with its own hostname in `Host`, so anything else is refused.
    const reason = !isAllowedLoopbackHost(req.headers.host,
        [`127.0.0.1:${currentPort}`, `localhost:${currentPort}`], "lowercase")
        ? "Invalid Host header"
        : req.headers.origin !== undefined
            ? "Browser requests are not accepted"
            : undefined;
    if (!reason) return false;
    console.warn(`MCP HTTP request refused: ${reason}; Host=${JSON.stringify(req.headers.host)} Origin=${JSON.stringify(req.headers.origin)}`);
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: reason }, id: null }));
    return true;
}

async function handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (refuseUntrustedRequest(req, res)) return;
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

            if (sessionId && host.has(sessionId)) {
                host.touch(sessionId);
                await host.handleExisting(sessionId, req, res, body);
            } else if (!sessionId && requireSdk().isInitializeRequest(body)) {
                await startSession(req, res, body);
            } else {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({
                    jsonrpc: "2.0",
                    error: { code: -32000, message: "Bad request: no valid session ID" },
                    id: null,
                }));
            }
        } else if (req.method === "GET" || req.method === "DELETE") {
            // GET opens the SSE stream, DELETE ends the session; the transport handles
            // both, and both require an established session.
            if (!sessionId || !host.has(sessionId)) {
                res.writeHead(400, { "Content-Type": "text/plain" });
                res.end("Invalid or missing session ID");
                return;
            }
            host.touch(sessionId);
            await host.handleExisting(sessionId, req, res);
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

/** Admit a new client: build a server + transport for it and let the transport
 *  answer the initialize request that brought us here. */
async function startSession(req: http.IncomingMessage, res: http.ServerResponse, body: unknown): Promise<void> {
    // Backstop against a burst of leaked sessions: if we're at the cap,
    // evict the least-recently-active one before admitting a new client.
    if (host.size >= MAX_SESSIONS) {
        const oldest = host.oldest(() => true, "strict-less");
        host.closeSession(oldest?.[0], "fire-and-forget");
    }
    await host.startSession(undefined, req, res, body);
}

// ── Server Lifecycle ───────────────────────────────────────────────

/**
 * Guards against a concurrent second start. `httpServer` is only assigned in the `listen`
 * callback, so the `if (httpServer)` check alone leaves an in-flight window in which a second
 * caller passes the guard and calls `listen()` on the same port — EADDRINUSE.
 *
 * Two callers is the normal case, not an exotic one: every renderer window actuates
 * `mcp.enabled` (at startup, and on a settings-file change picked up by each window's watcher),
 * so opening two windows or editing appSettings.json fires this from every one of them at once.
 * Mirrors the same guard in `startMneme`.
 */
let startPromise: Promise<void> | null = null;

export async function startMcpHttpServer(port?: number): Promise<void> {
    if (httpServer) return;
    if (startPromise) return startPromise;

    await loadSdk();
    currentPort = port ?? DEFAULT_PORT;

    startPromise = new Promise<void>((resolve, reject) => {
        const server = http.createServer(handleHttpRequest);

        server.on("error", (err: NodeJS.ErrnoException) => {
            if (!httpServer) {
                // Startup error
                startPromise = null;
                reject(err);
            }
            console.error(`MCP HTTP server error on port ${currentPort}:`, err.message);
        });

        server.listen(currentPort, "127.0.0.1", () => {
            httpServer = server;
            startPromise = null;
            // Reap idle sessions abandoned by clients that never sent DELETE. unref()
            // so this timer never keeps the process alive on its own.
            host.startIdleSweep();
            console.log(`MCP HTTP server started: ${mcpEndpointUrl(currentPort)}`);
            statusChanged();
            resolve();
        });
    });

    return startPromise;
}

async function stopMcpHttpServerInternal(): Promise<void> {
    const pending = startPromise;
    if (pending) await pending.catch((): undefined => undefined);
    if (!httpServer) return;

    host.stopIdleSweep();

    // Close all active sessions
    await host.closeAll();

    cancelRendererRequests("Server shutting down");

    return new Promise<void>((resolve) => {
        httpServer.close(() => {
            httpServer = undefined;
            console.log("MCP HTTP server stopped");
            statusChanged();
            resolve();
        });
    });
}

export const stopMcpHttpServer = coalescePendingCall(stopMcpHttpServerInternal);

export async function setMcpEnabled(enabled: boolean, port?: number): Promise<void> {
    if (enabled) await startMcpHttpServer(port);
    else await stopMcpHttpServer();
}

export function isMcpHttpServerRunning(): boolean {
    return !!httpServer;
}

export function getMcpUrl(): string {
    return mcpEndpointUrl(currentPort);
}

export function getMcpClientCount(): number {
    return host.size;
}

/** Return bounded metadata for the active MCP sessions without exposing SDK objects or full ids. */
export function getMcpSessionSnapshots(): McpSessionSnapshot[] {
    return getSessionSnapshots(new Map(host.entries()));
}
