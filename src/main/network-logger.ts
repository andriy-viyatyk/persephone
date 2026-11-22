/**
 * Network request logger for browser webview sessions.
 *
 * Attaches webRequest listeners to every Electron session to capture
 * HTTP/HTTPS request and response metadata. Logs are stored per page
 * (registration key: tabId/internalTabId) and exposed to the renderer
 * via IPC. Cleared automatically when the webview is unregistered.
 *
 * Its onBeforeSendHeaders listener is the only one a session can have, so it also adds the
 * Windows single sign-on proof to Microsoft sign-in navigations (see windows-sso.ts).
 */
import { app, Session } from "electron";
import { performance } from "node:perf_hooks";
import { type NetworkLogEntry, type NetworkLogOptions } from "../ipc/browser-ipc";
import { addWindowsSsoHeaders, redactWindowsSsoHeaders, wantsWindowsSso } from "./windows-sso";

const MAX_LOG_ENTRIES = 200;
const MAX_BODY_SIZE = 100 * 1024; // 100 KB — skip larger bodies

/** Per-page (registration key) circular buffer of network log entries. */
const pageLogs = new Map<string, NetworkLogEntry[]>();

/** Per-page pending request map (request id → entry reference). */
const pagePending = new Map<string, Map<number, NetworkLogEntry>>();

/** Sessions already hooked — prevent double-hooking. */
const hookedSessions = new WeakSet<Session>();

let resolveWebContentsId: (wcId: number) => string | undefined = () => undefined;
export interface NetworkLogAttribution { pageId?: string; editorId: string; popupId?: string; }
export interface NetworkOutcome {
    pageId: string | null;
    editorId: string;
    popupId?: string;
    method: string;
    url: string;
    resourceType: string;
    startedAt: string;
    elapsedMs: number;
    statusCode?: number;
    error?: string;
}
interface PendingNetworkOutcome { registrationKey: string; attribution: NetworkLogAttribution; startedAt: string; startTick: number; }
const pendingNetworkOutcomes = new Map<string, PendingNetworkOutcome>();
const networkLogListeners = new Set<(outcome: NetworkOutcome) => void>();
let resolveAttribution: (webContentsId: number) => NetworkLogAttribution | undefined = () => undefined;
type ResponseBodyFields = { responseBody: string; responseBodyBase64Encoded: boolean; responseBodyTruncated: boolean };
let resolveResponseBodies: (key: string, entries: NetworkLogEntry[], maxBodyBytes: number) => Promise<Map<number, ResponseBodyFields>> = async () => new Map();

export interface NetworkLoggerStartDependencies {
    resolveWebContentsId: (webContentsId: number) => string | undefined;
    resolveAttribution: (webContentsId: number) => NetworkLogAttribution | undefined;
    resolveResponseBodies: (key: string, entries: NetworkLogEntry[], maxBodyBytes: number) => Promise<Map<number, ResponseBodyFields>>;
}

/** Decode request body from uploadData. Returns undefined if empty or too large. */
function decodeBody(uploadData?: Electron.UploadData[]): string | undefined {
    if (!uploadData || uploadData.length === 0) return undefined;
    try {
        const buffers = uploadData.filter(d => d.bytes).map(d => d.bytes);
        if (buffers.length === 0) return undefined;
        const totalSize = buffers.reduce((sum, b) => sum + b.length, 0);
        if (totalSize > MAX_BODY_SIZE) return undefined;
        return Buffer.concat(buffers).toString("utf-8");
    } catch {
        return undefined;
    }
}

/** Record a request in its page's log. `requestHeaders` is what may be stored and shown. */
function logRequest(details: Electron.OnBeforeSendHeadersListenerDetails, requestHeaders: Record<string, string>): void {
    const key = details.webContentsId != null
        ? resolveWebContentsId(details.webContentsId)
        : undefined;
    if (!key) return;

    if (!pageLogs.has(key)) {
        pageLogs.set(key, []);
        pagePending.set(key, new Map());
    }

    const log = pageLogs.get(key);
    const pending = pagePending.get(key);

    const entry: NetworkLogEntry = {
        id: details.id,
        url: details.url,
        method: details.method,
        resourceType: details.resourceType,
        referrer: details.referrer,
        timestamp: details.timestamp,
        requestHeaders,
        requestBody: decodeBody(details.uploadData),
    };

    // Circular buffer: remove oldest if at capacity
    if (log.length >= MAX_LOG_ENTRIES) {
        const removed = log.shift();
        pending.delete(removed.id);
    }

    pending.set(details.id, entry);
    log.push(entry);
}

function requestOutcomeKey(webContentsId: number, requestId: number): string { return `${webContentsId}/${requestId}`; }

function captureNetworkStart(details: Electron.OnBeforeSendHeadersListenerDetails): void {
    if (!networkLogListeners.size || details.webContentsId == null) return;
    const registrationKey = resolveWebContentsId(details.webContentsId);
    const attribution = resolveAttribution(details.webContentsId);
    if (!registrationKey || !attribution) return;
    pendingNetworkOutcomes.set(requestOutcomeKey(details.webContentsId, details.id), {
        registrationKey, attribution, startedAt: new Date().toISOString(), startTick: performance.now(),
    });
}

function publishNetworkOutcome(details: Electron.OnCompletedListenerDetails | Electron.OnErrorOccurredListenerDetails, outcome: { statusCode?: number; error?: string }): void {
    if (details.webContentsId == null) return;
    const key = requestOutcomeKey(details.webContentsId, details.id);
    const pending = pendingNetworkOutcomes.get(key);
    if (!pending) return;
    pendingNetworkOutcomes.delete(key);
    const record: NetworkOutcome = {
        pageId: pending.attribution.pageId ?? null,
        editorId: pending.attribution.editorId,
        ...(pending.attribution.popupId === undefined ? {} : { popupId: pending.attribution.popupId }),
        method: details.method,
        url: details.url,
        resourceType: details.resourceType,
        startedAt: pending.startedAt,
        elapsedMs: Math.max(0, performance.now() - pending.startTick),
        ...outcome,
    };
    for (const listener of networkLogListeners) listener(record);
}

export function subscribeNetworkLog(listener: (outcome: NetworkOutcome) => void): () => void {
    networkLogListeners.add(listener);
    return () => networkLogListeners.delete(listener);
}

/**
 * Attach webRequest listeners to a session for network logging.
 * Idempotent via WeakSet guard.
 */
function hookSession(ses: Session): void {
    if (hookedSessions.has(ses)) return;
    hookedSessions.add(ses);

    const filter = { urls: ["http://*/*", "https://*/*"] };

    ses.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
        captureNetworkStart(details);
        // Skip OPTIONS preflight requests — not useful as resources
        if (details.method === "OPTIONS") {
            callback({ requestHeaders: details.requestHeaders });
            return;
        }

        if (wantsWindowsSso(ses, details.url, details.resourceType)) {
            void addWindowsSsoHeaders(details.url, details.requestHeaders).then((requestHeaders) => {
                logRequest(details, redactWindowsSsoHeaders(requestHeaders));
                callback({ requestHeaders });
            });
            return;
        }

        logRequest(details, { ...details.requestHeaders });
        // Pass through unchanged
        callback({ requestHeaders: details.requestHeaders });
    });

    ses.webRequest.onCompleted(filter, (details) => {
        publishNetworkOutcome(details, { statusCode: details.statusCode });
        const key = details.webContentsId != null
            ? resolveWebContentsId(details.webContentsId)
            : undefined;
        if (!key) return;

        const pending = pagePending.get(key);
        const entry = pending?.get(details.id);
        if (entry) {
            entry.statusCode = details.statusCode;
            entry.statusLine = details.statusLine;
            entry.responseHeaders = details.responseHeaders;
            entry.fromCache = details.fromCache;
            pending.delete(details.id);
        }
    });

    ses.webRequest.onErrorOccurred(filter, (details) => {
        publishNetworkOutcome(details, { error: details.error });
        const key = details.webContentsId != null
            ? resolveWebContentsId(details.webContentsId)
            : undefined;
        if (!key) return;

        const pending = pagePending.get(key);
        const entry = pending?.get(details.id);
        if (entry) {
            entry.error = details.error;
            pending.delete(details.id);
        }
    });
}

let nextRoutedRequestId = -1;

/**
 * Record a request a page route (`cdp/cdp-request-routes.ts`) answered itself with a fulfil or an abort: such a request
 * never reaches the session's webRequest listeners, so without this it would be missing from `networkRequests()` and
 * the failure bundle. Metadata only — the routed body and response headers are never stored. Ids are negative so they
 * cannot collide with webRequest ids (and never match a CDP response body).
 */
export function recordRoutedRequest(key: string, request: { url: string; method: string; resourceType: string; statusCode?: number; error?: string }): void {
    if (!pageLogs.has(key)) {
        pageLogs.set(key, []);
        pagePending.set(key, new Map());
    }
    const log = pageLogs.get(key);
    if (log.length >= MAX_LOG_ENTRIES) {
        const removed = log.shift();
        pagePending.get(key)?.delete(removed.id);
    }
    log.push({
        id: nextRoutedRequestId--,
        url: request.url,
        method: request.method,
        resourceType: request.resourceType.toLowerCase(),
        referrer: "",
        timestamp: Date.now(),
        requestHeaders: {},
        requestBody: undefined,
        ...(request.statusCode === undefined ? {} : { statusCode: request.statusCode, statusLine: `HTTP/1.1 ${request.statusCode} (routed)` }),
        ...(request.error === undefined ? {} : { error: request.error }),
    });
}

/** Clear the network log for a page. Called when webview is unregistered. */
export function clearNetworkLog(key: string): void {
    pageLogs.delete(key);
    pagePending.delete(key);
    for (const [requestKey, request] of pendingNetworkOutcomes) {
        if (request.registrationKey === key) pendingNetworkOutcomes.delete(requestKey);
    }
}

export interface NetworkLogMetadata {
    id: number;
    url: string;
    method: string;
    resourceType: string;
    referrer: string;
    timestamp: number;
    statusCode?: number;
    statusLine?: string;
    fromCache?: boolean;
    error?: string;
}

export function getNetworkLogSnapshot(): { keys: Array<{ key: string; count: number }> } {
    return { keys: [...pageLogs.entries()].map(([key, entries]) => ({ key, count: entries.length })) };
}

/** Return only bounded request metadata; headers and bodies never leave this module. */
export function getNetworkLogMetadata(key: string, limit = 20): NetworkLogMetadata[] {
    const entries = pageLogs.get(key) ?? [];
    const boundedLimit = Math.max(0, Math.min(200, Math.floor(limit)));
    return entries.slice(-boundedLimit).map(({ id, url, method, resourceType, referrer, timestamp, statusCode, statusLine, fromCache, error }) => ({
        id,
        url,
        method,
        resourceType,
        referrer,
        timestamp,
        ...(statusCode === undefined ? {} : { statusCode }),
        ...(statusLine === undefined ? {} : { statusLine }),
        ...(fromCache === undefined ? {} : { fromCache }),
        ...(error === undefined ? {} : { error }),
    }));
}

/** Initialize network logging. Call once during app startup. */
export function initNetworkLogger(dependencies: NetworkLoggerStartDependencies): void {
    resolveWebContentsId = dependencies.resolveWebContentsId;
    resolveAttribution = dependencies.resolveAttribution;
    resolveResponseBodies = dependencies.resolveResponseBodies;
    app.on("session-created", (ses: Session) => {
        hookSession(ses);
    });

}

export async function getNetworkLog(key: string, options: NetworkLogOptions = {}) {
    const entries = pageLogs.get(key) ?? [];
    if (!options.includeBodies) return entries.map(entry => ({ ...entry }));
    const requestedLimit = options.maxBodyBytes ?? 64 * 1024;
    const maxBodyBytes = Number.isFinite(requestedLimit) ? Math.max(0, Math.min(1024 * 1024, Math.floor(requestedLimit))) : 64 * 1024;
    const bodies = await resolveResponseBodies(key, entries, maxBodyBytes);
    return entries.map(entry => ({ ...entry, ...(bodies.get(entry.id) ?? {}) }));
}
