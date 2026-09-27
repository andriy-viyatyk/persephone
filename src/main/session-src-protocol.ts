/**
 * `session-src://` is a short-lived, main-issued capability for fetching one
 * HTTP(S) source through a private browser session.
 *
 * The handle is deliberately the only session identity the renderer sees. The
 * target URL is carried as encoded data, and the protocol never accepts a
 * caller-supplied partition or falls back to the default session.
 */
import { randomBytes } from "node:crypto";
import { session } from "electron";
import type { Session } from "electron";
import { torService } from "./tor-service";
import { errMessage } from "../shared/utils";

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
    readonly expiresAt: number;
    readonly expiryTimer: ReturnType<typeof setTimeout>;
}

const sessionSources = new Map<string, SessionSourceEntry>();

/** Register a private browser session and return its opaque hand-off handle. */
export function registerSessionSource(session: Session, targetUrl: string, torPartition?: string): string {
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
        expiresAt,
        expiryTimer,
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
        const init: RequestInit = {
            method: request.method,
            headers: filteredRequestHeaders(request.headers),
        };
        if (request.method !== "GET" && request.method !== "HEAD") {
            init.body = await request.arrayBuffer();
        }
        upstream = await entry.session.fetch(target, init);
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
