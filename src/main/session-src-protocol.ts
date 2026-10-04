/**
 * `session-src://` is a short-lived, main-issued capability for fetching one
 * HTTP(S) source through a private browser session.
 *
 * The handle is deliberately the only session identity the renderer sees. The
 * target URL is carried as encoded data, and the protocol never accepts a
 * caller-supplied partition or falls back to the default session.
 */
import { randomBytes } from "node:crypto";
import dns from "node:dns/promises";
import http from "node:http";
import net from "node:net";
import https from "node:https";
import { Readable } from "node:stream";
import { session } from "electron";
import type { Session } from "electron";
import { torService } from "./tor-service";
import { errMessage } from "../shared/utils";
import type { NormalizedBoardPermissions } from "../shared/board-manifest-utils";
import { isPrivateAddress, pinnedLookup, type BoardNetworkAddress } from "../shared/board-network-guard";


const SESSION_HANDLE_TTL_MS = 5 * 60 * 1000;
const SESSION_HANDLE_RE = /^[a-f0-9]{64}$/;
const FORWARDED_RESPONSE_HEADERS = [
    "accept-ranges",
    "cache-control",
    "content-length",
    "content-range",
    "content-type",
    "etag",
    "last-modified",
] as const;
const REQUEST_HEADERS_TO_DROP = new Set([
    "connection",
    "content-length",
    "host",
    "transfer-encoding",
]);

interface SessionSourceEntry {
    readonly session: Session;
    /** The one URL this handle may fetch, normalized. */
    readonly targetUrl: string;
    readonly torPartition?: string;
    readonly routed: boolean;
    readonly expiresAt: number;
    readonly expiryTimer: ReturnType<typeof setTimeout>;
    readonly boardPolicy?: {
        readonly boardRoot: string;
        readonly permissions: NormalizedBoardPermissions;
        readonly mcpUrl: string;
    };
}

const sessionSources = new Map<string, SessionSourceEntry>();

/** Register a private browser session and return its opaque hand-off handle. */
export function registerSessionSource(
    session: Session,
    targetUrl: string,
    torPartition?: string,
    routed = false,
): string {
    const handle = randomBytes(32).toString("hex");
    const expiresAt = Date.now() + SESSION_HANDLE_TTL_MS;
    const expiryTimer = setTimeout(() => {
        const entry = sessionSources.get(handle);
        if (entry?.expiresAt === expiresAt) sessionSources.delete(handle);
    }, SESSION_HANDLE_TTL_MS);
    expiryTimer.unref?.();
    sessionSources.set(handle, {
        session,
        targetUrl: normalizedUrl(targetUrl),
        torPartition,
        routed,
        expiresAt,
        expiryTimer,
    });
    return handle;
}

/** Derive a session-src capability bound to a trusted board and its stored grant. */
export function bindSessionSourceToBoard(
    sourceHandle: string,
    boardRoot: string,
    permissions: NormalizedBoardPermissions,
    mcpUrl: string,
): string {
    const source = sessionSources.get(sourceHandle);
    if (!source || source.expiresAt <= Date.now()) throw new Error("Expired session handle.");
    const handle = randomBytes(32).toString("hex");
    const expiresAt = Math.min(source.expiresAt, Date.now() + SESSION_HANDLE_TTL_MS);
    const expiryTimer = setTimeout(() => {
        const entry = sessionSources.get(handle);
        if (entry?.expiresAt === expiresAt) sessionSources.delete(handle);
    }, expiresAt - Date.now());
    expiryTimer.unref?.();
    sessionSources.set(handle, {
        session: source.session,
        targetUrl: source.targetUrl,
        torPartition: source.torPartition,
        routed: source.routed,
        expiresAt,
        expiryTimer,
        boardPolicy: { boardRoot, permissions, mcpUrl },
    });
    return handle;
}

/** Register the handler on the app renderer's session. Call once at startup. */
export function registerSessionSrcProtocol(partition: string): void {
    const appSession = session.fromPartition(partition);
    appSession.protocol.handle("session-src", handleSessionSrc);
}

// The renderer fetches this scheme cross-origin. The handle, not the origin, is the capability.
const CORS_HEADERS: Record<string, string> = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, HEAD, POST, OPTIONS",
    "access-control-allow-headers": "*",
    "access-control-expose-headers": "Content-Range, Content-Length, Accept-Ranges, Content-Type",
};

async function handleSessionSrc(request: Request): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
    const response = await serveSessionSrc(request);
    for (const [name, value] of Object.entries(CORS_HEADERS)) response.headers.set(name, value);
    return response;
}

async function serveSessionSrc(request: Request): Promise<Response> {
    let handle: string;
    let target: string | null;
    try {
        const parsed = new URL(request.url);
        handle = parsed.host;
        target = parsed.searchParams.get("u");
        if (parsed.pathname !== "/" || parsed.hash || parsed.searchParams.getAll("u").length !== 1) {
            return new Response("Malformed session-src URL", { status: 400 });
        }
    } catch {
        return new Response("Malformed session-src URL", { status: 400 });
    }

    if (!SESSION_HANDLE_RE.test(handle)) {
        return new Response("Unknown session handle", { status: 403 });
    }
    if (!target || !/^https?:$/.test(safeProtocol(target))) {
        return new Response("Only http(s) targets are allowed", { status: 403 });
    }

    const entry = sessionSources.get(handle);
    if (!entry || entry.expiresAt <= Date.now()) {
        if (entry) {
            clearTimeout(entry.expiryTimer);
            sessionSources.delete(handle);
        }
        return new Response("Expired session handle", { status: 403 });
    }
    // A handle is a capability for the claimed URL only, not a proxy for anything else.
    if (normalizedUrl(target) !== entry.targetUrl) {
        return new Response("This handle does not cover that URL", { status: 403 });
    }
    if (entry.torPartition && !torService.isActiveTorPartition(entry.torPartition)) {
        return new Response("No live Tor session for this handle", { status: 403 });
    }

    let upstream: Response;
    try {
        let currentUrl = target;
        let method = request.method;
        const headers = filteredRequestHeaders(request.headers);
        let body: ArrayBuffer | undefined;
        if (method !== "GET" && method !== "HEAD") body = await request.arrayBuffer();
        for (let redirects = 0; ; redirects++) {
            if (!/^https?:$/.test(safeProtocol(currentUrl))) throw new Error("Only http(s) redirect targets are allowed.");
            const addresses = entry.boardPolicy
                ? await assertBoardNetworkAllowed(currentUrl, entry.boardPolicy)
                : undefined;
            upstream = entry.boardPolicy && !entry.routed
                ? await pinnedSessionFetch(currentUrl, {
                    method,
                    headers,
                    body,
                    addresses: addresses ?? [],
                    session: entry.session,
                })
                : await entry.session.fetch(currentUrl, {
                    method,
                    headers,
                    ...(body ? { body } : {}),
                    redirect: "manual",
                });
            if (![301, 302, 303, 307, 308].includes(upstream.status)) break;
            const location = upstream.headers.get("location");
            if (!location || redirects >= 10) return new Response("Invalid or excessive redirect", { status: 502 });
            await upstream.body?.cancel();
            currentUrl = new URL(location, currentUrl).href;
            if (upstream.status === 303 || ((upstream.status === 301 || upstream.status === 302) && method === "POST")) {
                method = "GET";
                body = undefined;
                headers.delete("content-type");
                headers.delete("content-length");
            }
        }
    } catch (error: unknown) {
        return new Response(`Session fetch failed: ${errMessage(error)}`, { status: 502 });
    }

    const headers = new Headers();
    for (const name of FORWARDED_RESPONSE_HEADERS) {
        const value = upstream.headers.get(name);
        if (value !== null) headers.set(name, value);
    }
    return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers,
    });
}

async function assertBoardNetworkAllowed(
    url: string,
    policy: NonNullable<SessionSourceEntry["boardPolicy"]>,
): Promise<BoardNetworkAddress[]> {
    const permissions = policy.permissions;
    const network = permissions.kind === "legacy" ? "full" : permissions.flags.network;
    if (network === false) throw new Error('permission-denied: "network" is not enabled in board-manifest.json');
    const target = new URL(url);
    const mcp = new URL(policy.mcpUrl);
    const port = Number(target.port || (target.protocol === "https:" ? 443 : 80));
    const mcpPort = Number(mcp.port || (mcp.protocol === "https:" ? 443 : 80));
    const targetHost = target.hostname.replace(/^\[|\]$/g, "");
    const mcpHost = mcp.hostname.replace(/^\[|\]$/g, "");
    const targetFamily = net.isIP(targetHost);
    const mcpFamily = net.isIP(mcpHost);
    const targetAddresses = targetFamily
        ? [{ address: targetHost, family: targetFamily }]
        : await dns.lookup(targetHost, { all: true, verbatim: true });
    const mcpAddresses = mcpFamily
        ? [{ address: mcpHost, family: mcpFamily }]
        : await dns.lookup(mcpHost, { all: true, verbatim: true }).catch((): { address: string; family: number }[] => []);
    const appScripting = permissions.kind === "legacy" || permissions.flags.appScripting;
    if (!appScripting && port === mcpPort && (
        targetHost.toLowerCase() === mcpHost.toLowerCase()
        || targetAddresses.some(({ address }) => mcpAddresses.some((item) => item.address === address))
    )) throw new Error('permission-denied: "appScripting" is not enabled in board-manifest.json');
    if (network === "internet" && targetAddresses.some(({ address }) => isPrivateAddress(address, net.isIP))) {
        throw new Error('permission-denied: "network" is not enabled in board-manifest.json');
    }
    return targetAddresses;
}

interface PinnedSessionFetchOptions {
    method: string;
    headers: Headers;
    body?: ArrayBuffer;
    addresses: BoardNetworkAddress[];
    session: Session;
}

async function pinnedSessionFetch(url: string, options: PinnedSessionFetchOptions): Promise<Response> {
    const { method, body, addresses, session } = options;
    // A per-hop copy: the redirect loop reuses its headers, and a cookie added for this host
    // must not follow a redirect to another one.
    const headers = new Headers(options.headers);
    const target = new URL(url);
    const isHttps = target.protocol === "https:";
    const lib = isHttps ? https : http;
    if (!headers.has("cookie")) {
        const cookies = await session.cookies.get({ url });
        if (cookies.length) headers.set("cookie", cookies.map(({ name, value }) => `${name}=${value}`).join("; "));
    }
    if (!headers.has("user-agent")) headers.set("user-agent", session.getUserAgent());
    headers.set("accept-encoding", "identity");

    return new Promise((resolve, reject) => {
        const agent = isHttps
            ? new https.Agent({ keepAlive: false, rejectUnauthorized: true })
            : new http.Agent({ keepAlive: false });
        const request = lib.request({
            hostname: target.hostname,
            port: target.port || (isHttps ? 443 : 80),
            path: target.pathname + target.search,
            method,
            headers: Object.fromEntries(headers),
            agent,
            lookup: pinnedLookup(addresses) as typeof import("node:dns").lookup,
            timeout: 30_000,
            ...(isHttps ? { rejectUnauthorized: true } : {}),
        }, (response) => {
            const responseHeaders = new Headers();
            for (const [name, value] of Object.entries(response.headers)) {
                if (value === undefined) continue;
                responseHeaders.set(name, Array.isArray(value) ? value.join(", ") : value);
            }
            const hasBody = method !== "HEAD" && response.statusCode !== 204
                && response.statusCode !== 205 && response.statusCode !== 304;
            resolve(new Response(
                hasBody ? Readable.toWeb(response) as ReadableStream<Uint8Array> : null,
                {
                    status: response.statusCode ?? 200,
                    statusText: response.statusMessage ?? "OK",
                    headers: responseHeaders,
                },
            ));
        });

        const connectionTimeout = setTimeout(() => {
            request.destroy(new Error(`Session fetch timed out connecting to ${url}.`));
        }, 30_000);
        request.on("socket", (socket) => {
            const connectedEvent = isHttps ? "secureConnect" : "connect";
            socket.once(connectedEvent, () => clearTimeout(connectionTimeout));
            if (!socket.connecting) clearTimeout(connectionTimeout);
        });
        request.on("timeout", () => request.destroy(new Error(`Session fetch timed out: ${url}`)));
        request.on("error", (error: unknown) => {
            clearTimeout(connectionTimeout);
            reject(error);
        });
        if (body && method !== "GET" && method !== "HEAD") request.end(Buffer.from(body));
        else request.end();
    });
}

function filteredRequestHeaders(headers: Headers): Headers {
    const filtered = new Headers();
    for (const [name, value] of headers) {
        if (!REQUEST_HEADERS_TO_DROP.has(name.toLowerCase())) filtered.set(name, value);
    }
    return filtered;
}

/** `url` in its canonical form, or "" when it does not parse. Never throws. */
function normalizedUrl(url: string): string {
    try {
        return new URL(url).href;
    } catch {
        return "";
    }
}

/** Protocol of `url`, or "" when it does not parse. Never throws. */
function safeProtocol(url: string): string {
    try {
        return new URL(url).protocol;
    } catch {
        return "";
    }
}
