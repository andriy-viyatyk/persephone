import { randomUUID } from "node:crypto";
import http from "node:http";
import { AgentTipsRegistry } from "./agent-tips";
import { requireSdk, type McpServerInstance, type McpTransportInstance } from "./sdk";

export interface McpSessionRecord<Owner> {
    owner: Owner;
    tips: AgentTipsRegistry;
    server: McpServerInstance;
    transport: McpTransportInstance;
    lastActivity: number;
}

export interface McpSessionHostOptions {
    /** Injected rather than imported: `server-factory` reaches back into both MCP wrappers through the ai-vision
     *  main services, and each wrapper constructs its host at module load. */
    createServer: (tips: AgentTipsRegistry) => McpServerInstance;
    allowedSdkHosts: () => string[];
    onChange: () => void;
    idle?: { sweepMs: number; maxIdleMs: number };
}

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
export class McpSessionHost<Owner> {
    private readonly sessions = new Map<string, McpSessionRecord<Owner>>();
    private idleSweepTimer: ReturnType<typeof setInterval> | undefined;

    constructor(private readonly options: McpSessionHostOptions) {}

    get size(): number { return this.sessions.size; }

    has(sessionId: string): boolean { return this.sessions.has(sessionId); }

    get(sessionId: string): McpSessionRecord<Owner> | undefined { return this.sessions.get(sessionId); }

    entries(): IterableIterator<[string, McpSessionRecord<Owner>]> { return this.sessions.entries(); }

    touch(sessionId: string | undefined): void {
        if (!sessionId) return;
        const record = this.sessions.get(sessionId);
        if (record) record.lastActivity = Date.now();
    }

    async handleExisting(sessionId: string, req: http.IncomingMessage,
        res: http.ServerResponse, body?: unknown): Promise<void> {
        const transport = this.sessions.get(sessionId)?.transport;
        if (arguments.length >= 4) await transport?.handleRequest(req, res, body);
        else await transport?.handleRequest(req, res);
    }

    async startSession(owner: Owner, req: http.IncomingMessage,
        res: http.ServerResponse, body: unknown): Promise<void> {
        const { StreamableHTTPServerTransport } = requireSdk();
        const tips = new AgentTipsRegistry();
        const server = this.options.createServer(tips);
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            enableDnsRebindingProtection: true,
            allowedHosts: this.options.allowedSdkHosts(),
            onsessioninitialized: (sessionId: string) => {
                this.sessions.set(sessionId, { owner, tips, server, transport, lastActivity: Date.now() });
                this.options.onChange();
            },
        });

        transport.onclose = () => {
            tips.dispose();
            const sessionId = transport.sessionId;
            if (sessionId) this.sessions.delete(sessionId);
            this.options.onChange();
        };

        await server.connect(transport);
        await transport.handleRequest(req, res, body);
    }

    closeSession(sessionId: string | undefined, mode: "awaited"): Promise<void>;
    closeSession(sessionId: string | undefined, mode: "fire-and-forget"): void;
    closeSession(sessionId: string | undefined, mode: "awaited" | "fire-and-forget"): Promise<void> | void {
        if (!sessionId) return mode === "awaited" ? Promise.resolve() : undefined;
        const record = this.sessions.get(sessionId);
        if (!record) return mode === "awaited" ? Promise.resolve() : undefined;
        record.tips.dispose();
        const closing = Promise.resolve(record.transport.close()).catch(() => {
            this.sessions.delete(sessionId);
            this.options.onChange();
        });
        if (mode === "fire-and-forget") return;
        return closing;
    }

    oldest(predicate: (record: McpSessionRecord<Owner>) => boolean,
        tieRule: "strict-less" | "less-or-equal"): [string, McpSessionRecord<Owner>] | undefined {
        let oldest: [string, McpSessionRecord<Owner>] | undefined;
        for (const entry of this.sessions) {
            if (!predicate(entry[1])) continue;
            if (!oldest) {
                oldest = entry;
                continue;
            }
            if (tieRule === "strict-less" && entry[1].lastActivity < oldest[1].lastActivity) oldest = entry;
            if (tieRule === "less-or-equal" && oldest[1].lastActivity > entry[1].lastActivity) oldest = entry;
        }
        return oldest;
    }

    async closeAll(): Promise<void> {
        for (const [, record] of this.sessions) {
            record.tips.dispose();
            try { await record.transport.close(); } catch { /* ignore cleanup errors */ }
        }
        this.sessions.clear();
    }

    startIdleSweep(): void {
        const idle = this.options.idle;
        if (!idle) return;
        // Check for idle sessions once a minute; the caller starts this only after listen.
        this.idleSweepTimer = setInterval(() => {
            const now = Date.now();
            for (const [sessionId, record] of this.sessions) {
                if (now - record.lastActivity > idle.maxIdleMs) {
                    // close() is async and rejects pending streams; if it throws, drop the
                    // entry directly so a wedged transport can't pin the session forever.
                    this.closeSession(sessionId, "fire-and-forget");
                }
            }
        }, this.options.idle.sweepMs);
        this.idleSweepTimer.unref?.();
    }

    stopIdleSweep(): void {
        if (this.idleSweepTimer) {
            clearInterval(this.idleSweepTimer);
            this.idleSweepTimer = undefined;
        }
    }
}

/** Loopback authorities a legitimate client addresses its server by. A DNS-rebinding page
 *  arrives with its own hostname in `Host`, so anything else is refused. */
export function isAllowedLoopbackHost(host: string | undefined,
    allowedHosts: readonly string[], caseMode: "lowercase" | "exact"): boolean {
    if (!host) return false;
    const value = caseMode === "lowercase" ? host.toLowerCase() : host;
    return allowedHosts.includes(value);
}

/** Read the full request stream, treating an empty body as undefined. */
export function parseJsonBody(req: http.IncomingMessage): Promise<unknown> {
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
