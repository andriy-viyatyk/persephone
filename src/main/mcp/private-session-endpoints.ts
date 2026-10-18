import { randomBytes, timingSafeEqual, randomUUID } from "node:crypto";
import http from "node:http";
import path from "node:path";
import { loadSdk, requireSdk, type McpServerInstance, type McpTransportInstance } from "./sdk";
import { createMcpServer } from "./server-factory";

const MAX_ENDPOINTS = 64;
const MAX_TRANSPORTS = 64;
const MAX_TRANSPORTS_PER_TOKEN = 4;
const SESSION_IDLE_MS = 30 * 60_000;
const SESSION_SWEEP_MS = 60_000;

interface PrivateSession {
    owner: string;
    server: McpServerInstance;
    transport: McpTransportInstance;
    lastActivity: number;
}
interface EndpointGrant { boardRoot: string; tokenBytes: Buffer }

const grants = new Map<string, EndpointGrant>();
const sessions = new Map<string, PrivateSession>();
const pendingTransports = new Map<string, number>();
let server: http.Server | undefined;
let startPromise: Promise<string> | undefined;
let endpointUrl: string | undefined;
let sweepTimer: ReturnType<typeof setInterval> | undefined;
let statusChanged: (() => void) | undefined;
let shuttingDown = false;

function broadcast(): void { statusChanged?.(); }

function normalizeBoardRoot(boardRoot: string): string {
    const normalized = path.resolve(boardRoot).replace(/\\/g, "/").replace(/\/+$/, "");
    return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function authorizedToken(req: http.IncomingMessage): string | undefined {
    const header = req.headers.authorization;
    if (typeof header !== "string") return undefined;
    const match = /^Bearer ([0-9a-f]{64})$/.exec(header);
    if (!match) return undefined;
    const token = match[1].toLowerCase();
    const candidate = Buffer.from(token, "hex");
    for (const [key, grant] of grants) {
        if (timingSafeEqual(candidate, grant.tokenBytes)) return key;
    }
    return undefined;
}

function unauthorized(res: http.ServerResponse): void {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized" }));
}

function allowedHost(host: string | undefined, port: number): boolean {
    return host === `127.0.0.1:${port}`;
}

async function parseBody(req: http.IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
        let data = "";
        req.on("data", (chunk: Buffer) => { data += chunk.toString(); });
        req.on("end", () => {
            try { resolve(data ? JSON.parse(data) : undefined); }
            catch { reject(new Error("Invalid JSON")); }
        });
        req.on("error", reject);
    });
}

async function startTransport(token: string, req: http.IncomingMessage, res: http.ServerResponse, body: unknown): Promise<void> {
    const owned = [...sessions.entries()].filter(([, session]) => session.owner === token);
    const pendingForToken = pendingTransports.get(token) ?? 0;
    if (owned.length + pendingForToken >= MAX_TRANSPORTS_PER_TOKEN) {
        if (owned.length === 0) {
            res.writeHead(503, { "Content-Type": "application/json", "Retry-After": "1" });
            res.end(JSON.stringify({ error: "MCP endpoint busy" }));
            return;
        }
        const [, oldest] = owned.reduce((a, b) => a[1].lastActivity <= b[1].lastActivity ? a : b);
        await closeSession(oldest.transport.sessionId);
    }
    const pendingTotal = [...pendingTransports.values()].reduce((sum, count) => sum + count, 0);
    if (sessions.size + pendingTotal >= MAX_TRANSPORTS) {
        res.writeHead(503, { "Content-Type": "application/json", "Retry-After": "1" });
        res.end(JSON.stringify({ error: "MCP endpoint busy" }));
        return;
    }
    pendingTransports.set(token, (pendingTransports.get(token) ?? 0) + 1);

    try {
        const { StreamableHTTPServerTransport } = requireSdk();
        const mcpServer = createMcpServer();
        const address = server?.address();
        const port = address && typeof address !== "string" ? address.port : 0;
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            enableDnsRebindingProtection: true,
            allowedHosts: [`127.0.0.1:${port}`],
            onsessioninitialized: (sid: string) => {
                sessions.set(sid, { owner: token, server: mcpServer, transport, lastActivity: Date.now() });
                broadcast();
            },
        });
        transport.onclose = () => {
            if (transport.sessionId) sessions.delete(transport.sessionId);
            broadcast();
        };
        await mcpServer.connect(transport);
        await transport.handleRequest(req, res, body);
    } finally {
        const remaining = (pendingTransports.get(token) ?? 1) - 1;
        if (remaining > 0) pendingTransports.set(token, remaining);
        else pendingTransports.delete(token);
    }
}

async function closeSession(sessionId: string | undefined): Promise<void> {
    if (!sessionId) return;
    const session = sessions.get(sessionId);
    if (!session) return;
    try { await session.transport.close(); }
    catch { sessions.delete(sessionId); broadcast(); }
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const address = server?.address();
    const port = address && typeof address !== "string" ? address.port : 0;
    if (!allowedHost(req.headers.host, port) || req.headers.origin !== undefined) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Forbidden" }));
        return;
    }
    const token = authorizedToken(req);
    if (!token) { unauthorized(res); return; }
    if (new URL(req.url ?? "/", endpointUrl).pathname !== "/mcp") {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not found" }));
        return;
    }
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    try {
        if (req.method === "POST") {
            const body = await parseBody(req);
            if (sessionId && sessions.get(sessionId)?.owner === token) {
                const session = sessions.get(sessionId)!;
                session.lastActivity = Date.now();
                await session.transport.handleRequest(req, res, body);
            } else if (!sessionId && requireSdk().isInitializeRequest(body)) {
                await startTransport(token, req, res, body);
            } else {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Invalid session" }));
            }
        } else if (req.method === "GET" || req.method === "DELETE") {
            const session = sessionId ? sessions.get(sessionId) : undefined;
            if (!session || session.owner !== token) {
                res.writeHead(400, { "Content-Type": "text/plain" });
                res.end("Invalid or missing session ID");
                return;
            }
            session.lastActivity = Date.now();
            await session.transport.handleRequest(req, res);
        } else {
            res.writeHead(405, { "Content-Type": "text/plain" });
            res.end("Method not allowed");
        }
    } catch (error) {
        console.error("Private MCP HTTP handler error:", error);
        if (!res.headersSent) { res.writeHead(500); res.end(JSON.stringify({ error: "Internal server error" })); }
    }
}

async function ensureServer(): Promise<string> {
    if (endpointUrl && server) return endpointUrl;
    if (startPromise) return startPromise;
    await loadSdk();
    startPromise = new Promise<string>((resolve, reject) => {
        const nextServer = http.createServer((req, res) => { void handleRequest(req, res); });
        const onStartupError = (error: Error): void => reject(error);
        nextServer.once("error", onStartupError);
        nextServer.listen(0, "127.0.0.1", () => {
            nextServer.removeListener("error", onStartupError);
            nextServer.on("error", (error: Error) => console.error("Private MCP HTTP server error:", error.message));
            server = nextServer;
            const address = nextServer.address();
            if (!address || typeof address === "string") { reject(new Error("Private MCP listener did not bind an IP port")); return; }
            endpointUrl = `http://127.0.0.1:${address.port}/mcp`;
            sweepTimer = setInterval(() => {
                const now = Date.now();
                for (const [id, session] of sessions) if (now - session.lastActivity > SESSION_IDLE_MS) void closeSession(id);
            }, SESSION_SWEEP_MS);
            sweepTimer.unref?.();
            broadcast();
            resolve(endpointUrl);
        });
    }).finally(() => { startPromise = undefined; });
    return startPromise;
}

export function setPrivateMcpStatusChanged(callback: () => void): void { statusChanged = callback; }

export async function issuePrivateMcpEndpoint(boardRoot: string): Promise<{ url: string; headers: { Authorization: string }; token: string }> {
    if (shuttingDown) throw Object.assign(new Error("Private MCP endpoint is shutting down"), { code: "service-exited" });
    if (grants.size >= MAX_ENDPOINTS) throw Object.assign(new Error("Private MCP endpoint busy"), { code: "service-busy" });
    const token = randomBytes(32).toString("hex");
    const url = await ensureServer();
    if (shuttingDown) throw Object.assign(new Error("Private MCP endpoint is shutting down"), { code: "service-exited" });
    if (grants.size >= MAX_ENDPOINTS) throw Object.assign(new Error("Private MCP endpoint busy"), { code: "service-busy" });
    grants.set(token, { boardRoot, tokenBytes: Buffer.from(token, "hex") });
    broadcast();
    return { url, headers: { Authorization: `Bearer ${token}` }, token };
}

export async function revokePrivateMcpEndpoint(token: string): Promise<void> {
    const grant = grants.get(token);
    if (!grant) return;
    grants.delete(token);
    for (const [id, session] of [...sessions]) if (session.owner === token) await closeSession(id);
    grant.tokenBytes.fill(0);
    broadcast();
}

export async function revokePrivateMcpEndpointForBoard(boardRoot: string, token: string): Promise<void> {
    const grant = grants.get(token);
    if (!grant || normalizeBoardRoot(grant.boardRoot) !== normalizeBoardRoot(boardRoot)) return;
    await revokePrivateMcpEndpoint(token);
}

export async function revokePrivateMcpEndpointsForBoard(boardRoot: string): Promise<void> {
    const key = normalizeBoardRoot(boardRoot);
    const tokens = [...grants].filter(([, grant]) => normalizeBoardRoot(grant.boardRoot) === key).map(([token]) => token);
    for (const token of tokens) {
        const grant = grants.get(token);
        grant?.tokenBytes.fill(0);
        grants.delete(token);
    }
    for (const [sessionId, session] of [...sessions]) if (tokens.includes(session.owner)) await closeSession(sessionId);
    if (tokens.length > 0) broadcast();
}

export async function shutdownPrivateMcpEndpoint(): Promise<void> {
    shuttingDown = true;
    for (const grant of grants.values()) grant.tokenBytes.fill(0);
    grants.clear();
    const pendingStart = startPromise;
    if (pendingStart) {
        try { await pendingStart; }
        catch { /* Listener startup failed; continue shutdown cleanup. */ }
    }
    for (const id of [...sessions.keys()]) await closeSession(id);
    if (sweepTimer) clearInterval(sweepTimer);
    sweepTimer = undefined;
    const current = server;
    server = undefined;
    endpointUrl = undefined;
    broadcast();
    if (current) await new Promise<void>((resolve) => current.close((): void => { resolve(); }));
}

export function getPrivateMcpClientCount(): number { return sessions.size; }
