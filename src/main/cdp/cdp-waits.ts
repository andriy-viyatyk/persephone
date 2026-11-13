import type { WebContents } from "electron";
import type { BrowserResponsePattern, BrowserResponseResult, BrowserResponseWaitOptions } from "../../ipc/browser-ipc";
import { APP_WINDOW_CDP_KEY } from "../../ipc/api-types";
import { errMessage, isRecord } from "../../shared/utils";
import { boundedResponseBody, ensureNetworkCollector, forgetOwnedFrameSession, getNetworkCollector, getOwnedTargetSessions } from "./cdp-network-collector";
import type { CdpEventHandler, CdpFeatureTarget } from "./CdpTarget";

interface NavigationWaitState { key: string; wc: WebContents; sessionId?: string; promise: Promise<{ url: string; status: number | null }>; cancel: () => void }
interface ResponseWaitState { key: string; wc: WebContents; promise: Promise<BrowserResponseResult>; cancel: () => void }
export interface NavigationWaitRequest {
    waitUntil?: "load" | "domcontentloaded" | "networkidle";
    timeout?: number;
    kind?: "navigation" | "url";
    /** Count a load already in progress at arm time (waitForNavigation). Actions that trigger
     *  their own navigation must not: a still-committing previous load (an error page, say)
     *  would satisfy the wait with the wrong document. */
    adoptInProgress?: boolean;
    urlPattern?: string | { source: string; flags?: string };
}
const navigationWaits = new Map<string, NavigationWaitState>();
const responseWaits = new Map<string, ResponseWaitState>();

export async function armResponseWait(
    key: string,
    pattern: string | BrowserResponsePattern,
    options: BrowserResponseWaitOptions = {},
    resolveRoute: () => CdpFeatureTarget,
    resolveBoardSession: (registration: Extract<CdpFeatureTarget, { kind: "board" }>['registration']) => Promise<string | undefined>,
): Promise<string> {
    let matches: (url: string) => boolean;
    if (typeof pattern === "string") matches = url => url === pattern;
    else if (isRecord(pattern) && typeof pattern.source === "string" && typeof pattern.flags === "string") {
        let expression: RegExp;
        try { expression = new RegExp(pattern.source, pattern.flags); }
        catch { throw new Error("waitForResponse received an invalid regular expression."); }
        matches = url => { expression.lastIndex = 0; return expression.test(url); };
    } else throw new Error("waitForResponse requires a URL string or RegExp.");
    const timeout = options.timeout === undefined ? 10_000 : options.timeout;
    if (typeof timeout !== "number" || !Number.isFinite(timeout) || timeout <= 0) throw new Error("waitForResponse timeout must be a positive finite number.");
    const includeBody = options.includeBody === true;
    const requestedBytes = options.maxBodyBytes ?? 64 * 1024;
    if (typeof requestedBytes !== "number" || !Number.isFinite(requestedBytes) || requestedBytes < 0) throw new Error("maxBodyBytes must be a non-negative finite number.");
    const maxBodyBytes = Math.min(Math.floor(requestedBytes), 1024 * 1024);
    const target = resolveRoute();
    const board = target.kind === "board" ? target.registration : undefined;
    const wc = target.webContents;
    if (!wc || wc.isDestroyed()) throw new Error("WebContents not found or destroyed");
    const cdp = target.attach(wc);
    const rootSessionId = board ? await resolveBoardSession(board) : undefined;
    if (board && !rootSessionId) throw new Error("Board frame not ready for CDP (still loading?)");
    // Everything up to the first await below runs synchronously, so the event subscription and the
    // root session's Network.enable are both issued before any trigger IPC the caller sent after
    // arming (a fast `evaluate` would otherwise fire its request while iframes are still being
    // discovered). Owned OOPIF sessions are added to `sessions` once attached.
    const sessions: Set<string | undefined> = new Set([rootSessionId]);
    const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    let resolve!: (result: BrowserResponseResult) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<BrowserResponseResult>((done, fail) => { resolve = done; reject = fail; });
    const requests = new Map<string, { url: string; response?: BrowserResponseResult }>();
    let cleanupEvent = () => {};
    let settled = false;
    const finish = (error?: Error, result?: BrowserResponseResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cleanupEvent();
        if (error) reject(error); else if (result) resolve(result);
    };
    const timer = setTimeout(() => finish(new Error(`Timed out waiting for response after ${timeout} ms (timeout ${timeout} ms).`)), Math.min(timeout, 595_000));
    cleanupEvent = cdp.subscribeCdpEvents((method, raw, sessionId) => {
        if (!sessions.has(sessionId) || !isRecord(raw) || typeof raw.requestId !== "string") return;
        const id = `${sessionId ?? ""}\u0000${raw.requestId}`;
        if (method === "Network.requestWillBeSent") {
            const request = isRecord(raw.request) ? raw.request : {};
            requests.set(id, { url: typeof request.url === "string" ? request.url : "" });
            return;
        }
        const tracked = requests.get(id);
        if (!tracked) return;
        if (method === "Network.responseReceived" && isRecord(raw.response)) {
            const response = raw.response;
            tracked.response = {
                url: tracked.url,
                status: typeof response.status === "number" ? response.status : 0,
                statusText: typeof response.statusText === "string" ? response.statusText : "",
                headers: isRecord(response.headers) ? Object.fromEntries(Object.entries(response.headers).filter((item): item is [string, string] => typeof item[1] === "string")) : {},
                mimeType: typeof response.mimeType === "string" ? response.mimeType : "",
            };
            if (!includeBody && matches(tracked.url)) finish(undefined, tracked.response);
        } else if (method === "Network.loadingFailed") {
            if (!matches(tracked.url)) return;
            if (tracked.response) { finish(undefined, tracked.response); return; }
            finish(new Error(`Network request failed for ${tracked.url}: ${typeof raw.errorText === "string" ? raw.errorText : "unknown network error"}.`));
        } else if (method === "Network.loadingFinished" && tracked.response && matches(tracked.url)) {
            const result = tracked.response;
            if (!includeBody) { finish(undefined, result); return; }
            void wc.debugger.sendCommand("Network.getResponseBody", { requestId: raw.requestId }, sessionId).then(bodyResult => {
                if (isRecord(bodyResult) && typeof bodyResult.body === "string") {
                    const bounded = boundedResponseBody(bodyResult.body, bodyResult.base64Encoded === true, result, maxBodyBytes);
                    if (!bounded) { finish(undefined, result); return; }
                    result.body = bounded.body;
                    if (bounded.base64Encoded) result.base64Encoded = true;
                    result.truncated = bounded.truncated;
                }
                finish(undefined, result);
            }).catch(() => finish(undefined, result));
        }
    });
    const isBrowserTab = target.kind === "browser" && key !== APP_WINDOW_CDP_KEY;
    try {
        await Promise.all([
            cdp.enableDomain("Network", rootSessionId),
            isBrowserTab ? ensureNetworkCollector(key, wc, cdp) : undefined,
        ]);
        for (const sessionId of await getOwnedTargetSessions(wc, rootSessionId)) {
            if (sessionId !== rootSessionId) {
                try { await cdp.enableDomain("Network", sessionId); }
                catch { forgetOwnedFrameSession(wc, sessionId); continue; }
            }
            sessions.add(sessionId);
            if (isBrowserTab) getNetworkCollector(key)?.sessions.add(sessionId);
        }
    } catch (error: unknown) {
        finish(new Error("Response wait was cancelled."));
        promise.catch((): void => undefined);
        throw error;
    }
    responseWaits.set(token, { key, wc, promise, cancel: () => finish(new Error("Response wait was cancelled.")) });
    return token;
}

export async function armNavigationWait(
    key: string,
    request: NavigationWaitRequest,
    resolveRoute: () => CdpFeatureTarget,
): Promise<string> {
    const waitUntil = request.waitUntil ?? "load";
    if (waitUntil !== "load" && waitUntil !== "domcontentloaded" && waitUntil !== "networkidle") {
        throw new Error("waitUntil must be load, domcontentloaded, or networkidle.");
    }
    const kind = request.kind ?? "navigation";
    if (kind !== "navigation" && kind !== "url") throw new Error("Navigation wait kind is invalid.");
    const timeout = typeof request.timeout === "number" && Number.isFinite(request.timeout)
        ? Math.max(1, Math.min(request.timeout, 595_000)) : 10_000;
    let urlMatches: (url: string) => boolean = () => true;
    if (kind === "url") {
        if (typeof request.urlPattern === "string") {
            urlMatches = url => url === request.urlPattern;
        } else if (isRecord(request.urlPattern)
            && typeof request.urlPattern.source === "string"
            && (request.urlPattern.flags === undefined || typeof request.urlPattern.flags === "string")) {
            let expression: RegExp;
            try { expression = new RegExp(request.urlPattern.source, request.urlPattern.flags as string | undefined); }
            catch { throw new Error("waitForURL received an invalid regular expression."); }
            urlMatches = url => { expression.lastIndex = 0; return expression.test(url); };
        } else {
            throw new Error("waitForURL requires a string or RegExp URL pattern.");
        }
    }
    const target = resolveRoute();
    const wc = target.kind === "browser" ? target.webContents : undefined;
    if (!wc || wc.isDestroyed()) throw new Error("WebContents not found or destroyed");
    const cdp = target.attach(wc);
    await ensureNetworkCollector(key, wc, cdp);
    const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    let settle!: (result: { url: string; status: number | null }) => void;
    let fail!: (error: Error) => void;
    const promise = new Promise<{ url: string; status: number | null }>((resolve, reject) => { settle = resolve; fail = reject; });
    let cleanupEvent = () => {};
    const timer: { id?: ReturnType<typeof setTimeout> } = {};
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    let mainFrameId: string | undefined;
    let currentUrl = "";
    let responseStatus: number | null = null;
    let committed = false;
    let navigationStarted = false;
    let domContentLoaded = false;
    let loaded = false;
    let documentRequestId: string | undefined;
    const inFlight = new Set<string>();
    const persistentRequests = new Set<string>();
    const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        if (timer.id) clearTimeout(timer.id);
        if (idleTimer) clearTimeout(idleTimer);
        cleanupEvent();
        if (error) fail(error);
        else settle({ url: currentUrl, status: /^(about|data):/i.test(currentUrl) ? null : responseStatus });
    };
    const maybeFinish = () => {
        if (!navigationStarted || !committed || !urlMatches(currentUrl)) return;
        if (currentUrl.startsWith("chrome-error://")) return;
        if (waitUntil === "domcontentloaded" && (domContentLoaded || currentUrl.startsWith("about:"))) finish();
        else if (waitUntil === "load" && (loaded || currentUrl.startsWith("about:"))) finish();
        else if (waitUntil === "networkidle") {
            if (idleTimer) clearTimeout(idleTimer);
            if (inFlight.size === 0) {
                idleTimer = setTimeout(() => {
                    if (committed && urlMatches(currentUrl) && inFlight.size === 0) finish();
                }, 500);
            }
        }
    };
    const eventHandler: CdpEventHandler = (method, raw, sessionId) => {
        if (sessionId !== undefined) return;
        if (!isRecord(raw)) return;
        if (method === "Page.frameStartedLoading") {
            if (typeof raw.frameId !== "string" || (mainFrameId && raw.frameId !== mainFrameId)) return;
            navigationStarted = true;
        } else if (method === "Page.frameNavigated") {
            const frame = raw.frame;
            if (!isRecord(frame) || typeof frame.id !== "string" || frame.parentId !== undefined) return;
            mainFrameId = frame.id;
            currentUrl = typeof frame.url === "string" ? frame.url : currentUrl;
            committed = true;
            navigationStarted = true;
            domContentLoaded = false;
            loaded = false;
            maybeFinish();
        } else if (method === "Page.navigatedWithinDocument") {
            if (typeof raw.frameId !== "string" || (mainFrameId && raw.frameId !== mainFrameId)) return;
            currentUrl = typeof raw.url === "string" ? raw.url : currentUrl;
            committed = true;
            navigationStarted = true;
            responseStatus = null;
            domContentLoaded = true;
            loaded = true;
            maybeFinish();
        } else if (method === "Page.lifecycleEvent") {
            if (typeof raw.frameId !== "string" || (mainFrameId && raw.frameId !== mainFrameId)) return;
            if (raw.name === "DOMContentLoaded") domContentLoaded = true;
            if (raw.name === "load") loaded = true;
            if (raw.name === "networkIdle") maybeFinish();
            maybeFinish();
        } else if (method === "Page.loadEventFired") {
            loaded = true;
            maybeFinish();
        } else if (method === "Network.requestWillBeSent") {
            if (typeof raw.requestId !== "string") return;
            const type = raw.type;
            if (type === "Document" && (mainFrameId === undefined || raw.frameId === mainFrameId)) {
                inFlight.clear();
                persistentRequests.clear();
                documentRequestId = raw.requestId;
                responseStatus = null;
            }
            if (type === "WebSocket" || type === "EventSource") persistentRequests.add(raw.requestId);
            else inFlight.add(raw.requestId);
            if (idleTimer) clearTimeout(idleTimer);
        } else if (method === "Network.responseReceived") {
            if (raw.requestId === documentRequestId && isRecord(raw.response) && typeof raw.response.status === "number") {
                responseStatus = raw.response.status;
            }
        } else if (method === "Network.loadingFinished" || method === "Network.loadingFailed") {
            if (typeof raw.requestId !== "string") return;
            if (method === "Network.loadingFailed" && raw.requestId === documentRequestId) {
                const errorText = typeof raw.errorText === "string" ? raw.errorText : "Unknown network error";
                finish(new Error(`Main-frame navigation failed: ${errorText}`));
                return;
            }
            inFlight.delete(raw.requestId);
            persistentRequests.delete(raw.requestId);
            maybeFinish();
        }
    };
    cleanupEvent = cdp.subscribeCdpEvents(eventHandler);
    navigationWaits.set(token, { key, wc, promise, cancel: () => finish(new Error("Navigation wait was cancelled.")) });
    try {
        await cdp.enableDomain("Page");
        await cdp.enableDomain("Network");
        await wc.debugger.sendCommand("Page.setLifecycleEventsEnabled", { enabled: true });
        const tree = await wc.debugger.sendCommand("Page.getFrameTree");
        if (isRecord(tree) && isRecord(tree.frameTree) && isRecord(tree.frameTree.frame)
            && typeof tree.frameTree.frame.id === "string") {
            mainFrameId = tree.frameTree.frame.id;
            if (typeof tree.frameTree.frame.url === "string") currentUrl = tree.frameTree.frame.url;
            committed = kind === "navigation" && request.adoptInProgress === true && wc.isLoading();
            navigationStarted = committed;
        }
    } catch (error: unknown) {
        finish(new Error(`Could not arm navigation wait: ${errMessage(error)}`));
        navigationWaits.delete(token);
        throw error;
    }
    if (kind === "url" && urlMatches(currentUrl)) {
        committed = true;
        navigationStarted = true;
        finish();
        return token;
    }
    timer.id = setTimeout(() => finish(new Error(`Timed out waiting for ${kind === "url" ? "URL match" : "navigation"} after ${timeout} ms (timeout ${timeout} ms).`)), timeout);
    return token;
}

export async function awaitNavigationWait(token: string): Promise<{ url: string; status: number | null }> {
    const state = navigationWaits.get(token);
    if (!state) throw new Error("Navigation wait token is missing or expired.");
    try { return await state.promise; } finally { navigationWaits.delete(token); }
}

export async function awaitResponseWait(token: string): Promise<BrowserResponseResult> {
    const state = responseWaits.get(token);
    if (!state) throw new Error("Response wait token is missing or expired.");
    try { return await state.promise; } finally { responseWaits.delete(token); }
}

export function clearKey(key: string): void {
    for (const [token, wait] of navigationWaits) {
        if (wait.key !== key) continue;
        navigationWaits.delete(token);
        wait.cancel();
    }
    for (const [token, wait] of responseWaits) {
        if (wait.key !== key) continue;
        responseWaits.delete(token);
        wait.cancel();
    }
}

export function onTargetDetached(wc: WebContents): void {
    for (const [token, wait] of responseWaits) {
        if (wait.wc !== wc) continue;
        responseWaits.delete(token);
        wait.cancel();
    }
    for (const [token, wait] of navigationWaits) {
        if (wait.wc !== wc) continue;
        navigationWaits.delete(token);
        wait.cancel();
    }
}
