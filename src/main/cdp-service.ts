/**
 * Chrome DevTools Protocol session management for browser webviews and board frames.
 *
 * Manages CDP debugger attach/detach/sendCommand via IPC. Uses Electron's
 * webContents.debugger API — no network port needed.
 *
 * Three kinds of automation target share these handlers:
 *  • Browser pages — each is its own `<webview>` `WebContents`; the debugger attaches
 *    directly to it (resolved via the browser's `getWebContents` resolver).
 *  • Boards (EPIC-037) — a board is an in-DOM `board://<host>` `<iframe>` inside the
 *    HOST window's `WebContents` (no board webContents). The debugger attaches to the
 *    host wc, and every board command is routed to the board frame via its flattened
 *    CDP session, so `Runtime.evaluate` / `Accessibility.getFullAXTree` / screenshots
 *    run in the board frame, NEVER the host's own React UI.
 *  • The app window itself — automating Persephone's OWN React UI (the `APP_WINDOW_CDP_KEY`
 *    sentinel, used by `browser_*` with `pageId: "app"`). Needs no registration: the
 *    command arrives from the target window's own renderer, so `event.sender` IS the
 *    window to drive. We attach the debugger to it and run commands on the TOP-LEVEL
 *    session (the app UI) with no frame routing.
 */
import { ipcMain, WebContents } from "electron";
import {
    BrowserChannel,
    type CdpAttachOptions,
    type PageConsoleLevel,
    type PageConsoleRecord,
    type PageDialogPolicy,
    type PageDialogRecord,
    type PageErrorRecord,
    type PageEventsSnapshot,
    type DragData,
    type BrowserResponsePattern,
    type BrowserResponseWaitOptions,
    type BrowserResponseResult,
} from "../ipc/browser-ipc";
import { APP_WINDOW_CDP_KEY } from "../ipc/api-types";
import { AI_VISION_HOST_SIGNAL } from "ai-vision";
import { errMessage } from "../shared/utils";
import { setNetworkResponseBodyResolver } from "./network-logger";

/** Track which webContents have an attached debugger. */
const attachedDebuggers = new WeakSet<WebContents>();
type CdpEventHandler = (method: string, params: unknown, sessionId: string | undefined) => void;
interface CdpEventDispatcher {
    handler: DebuggerMessageHandler;
    subscribers: Set<CdpEventHandler>;
}
const cdpEventDispatchers = new WeakMap<WebContents, CdpEventDispatcher>();
const enabledDomains = new WeakMap<WebContents, Map<string, Set<string>>>();
const enablingDomains = new WeakMap<WebContents, Map<string, Map<string, Promise<void>>>>();
const MAX_PAGE_EVENTS = 500;
type DebuggerMessageHandler = (
    event: Electron.Event,
    method: string,
    params: unknown,
    sessionId: string,
) => void;
interface AiVisionBindingState {
    handler: DebuggerMessageHandler;
    installed: boolean;
    installing?: Promise<void>;
}
const aiVisionBindingStates = new WeakMap<WebContents, AiVisionBindingState>();

interface PageEventState {
    key: string;
    sessionId?: string;
    wc: WebContents;
    policy: PageDialogPolicy;
    dialogs: PageDialogRecord[];
    consoleMessages: PageConsoleRecord[];
    pageErrors: PageErrorRecord[];
    cleanup: () => void;
    send: (method: string, params?: object) => Promise<unknown>;
}
const pageEventStates = new Map<string, PageEventState>();
const targetStateKeys = new Map<string, Set<string>>();
const automationActivity = new Map<string, { count: number; graceUntil: number }>();
const dialogCommandPromises = new WeakMap<PageDialogRecord, Promise<void>>();
interface NavigationWaitState {
    key: string;
    wc: WebContents;
    sessionId?: string;
    promise: Promise<{ url: string; status: number | null }>;
    cancel: () => void;
}
const navigationWaits = new Map<string, NavigationWaitState>();
interface NetworkRequestRecord {
    sessionId?: string;
    requestId: string;
    url: string;
    method: string;
    wallTime?: number;
    response?: { status: number; statusText: string; headers: Record<string, string>; mimeType: string };
    finished: boolean;
}
interface NetworkCollector { wc: WebContents; records: NetworkRequestRecord[]; sessions: Set<string | undefined>; cleanup: () => void; ready?: Promise<void> }
const networkCollectors = new Map<string, NetworkCollector>();
interface ResponseWaitState { key: string; wc: WebContents; promise: Promise<BrowserResponseResult>; cancel: () => void }
const responseWaits = new Map<string, ResponseWaitState>();
interface DragInterceptState { promise: Promise<DragData>; cleanup: () => void; result?: DragData; taken?: boolean }
const dragIntercepts = new Map<string, DragInterceptState>();

function eventStateKey(key: string, sessionId?: string): string {
    return `${key}\u0000${sessionId ?? ""}`;
}

/** Subscribe to CDP messages on one WebContents through a shared tracked dispatcher. */
export function subscribeCdpEvents(wc: WebContents, handler: CdpEventHandler): () => void {
    let dispatcher = cdpEventDispatchers.get(wc);
    if (!dispatcher) {
        const subscribers = new Set<CdpEventHandler>();
        const messageHandler: DebuggerMessageHandler = (_event, method, params, sessionId) => {
            for (const subscriber of [...subscribers]) subscriber(method, params, sessionId || undefined);
        };
        dispatcher = { handler: messageHandler, subscribers };
        cdpEventDispatchers.set(wc, dispatcher);
        wc.debugger.on("message", messageHandler);
    }
    dispatcher.subscribers.add(handler);
    let subscribed = true;
    return () => {
        if (!subscribed) return;
        subscribed = false;
        const current = cdpEventDispatchers.get(wc);
        if (!current) return;
        current.subscribers.delete(handler);
        if (current.subscribers.size === 0) {
            try {
                if (!wc.isDestroyed()) wc.debugger.removeListener("message", current.handler);
            } catch { /* WebContents may already be destroyed. */ }
            cdpEventDispatchers.delete(wc);
        }
    };
}

function clearCdpSubscriptions(wc: WebContents): void {
    const dispatcher = cdpEventDispatchers.get(wc);
    if (!dispatcher) return;
    try {
        if (!wc.isDestroyed()) wc.debugger.removeListener("message", dispatcher.handler);
    } catch { /* WebContents may already be destroyed. */ }
    dispatcher.subscribers.clear();
    cdpEventDispatchers.delete(wc);
}

export function clearCdpTargetState(key: string): void {
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
    networkCollectors.get(key)?.cleanup();
    networkCollectors.delete(key);
    for (const stateKey of targetStateKeys.get(key) ?? []) {
        const state = pageEventStates.get(stateKey);
        state?.cleanup();
        pageEventStates.delete(stateKey);
    }
    targetStateKeys.delete(key);
    automationActivity.delete(key);
}

/**
 * Board frame registrations (EPIC-037 / US-773). Kept SEPARATE from the browser's
 * registrations: a board has no webContents of its own — it is a `board://<host>`
 * frame of the host window's webContents. We store the host wc + the board's
 * `board://` host, and lazily resolve (and cache) the board frame's flattened CDP
 * session so commands target the frame, not the host app. Keyed
 * `${boardEditorId}/${BOARD_CDP_TAB}`; set/cleared via the controller.
 */
interface BoardReg {
    /** The host window's webContents (the renderer that hosts the iframe). */
    host: WebContents;
    /** The board's `board://` URL host (a stable hash of the board root). */
    boardHost: string;
    /** The iframe document's `?v=` nonce (per-mount boardId). Disambiguates THIS tab's
     *  frame from other tabs of the same board (same origin) and from the pre-reload
     *  frame after a remount — origin alone is not unique (US-796). */
    frameNonce?: string;
    /** Cached flattened session for the board frame; cleared on reload/re-register. */
    sessionId?: string;
}
const boardRegistrations = new Map<string, BoardReg>();

export function registerBoardFrame(key: string, host: WebContents, boardHost: string, frameNonce?: string): void {
    // Re-registration (e.g. a reload recreated the frame) invalidates the cached
    // session — the OOPIF target id changes, so a stale session would be dead. The new
    // `frameNonce` re-points resolution at the freshly-loaded frame.
    boardRegistrations.set(key, { host, boardHost, frameNonce });
}

export function unregisterBoardFrame(key: string, frameNonce?: string): void {
    const registration = boardRegistrations.get(key);
    if (frameNonce !== undefined && registration?.frameNonce !== frameNonce) return;
    boardRegistrations.delete(key);
    clearCdpTargetState(key);
}

function ensureAttached(wc: WebContents): void {
    if (attachedDebuggers.has(wc)) return;
    wc.debugger.attach("1.3");
    attachedDebuggers.add(wc);
    wc.debugger.on("detach", () => {
        attachedDebuggers.delete(wc);
        clearAiVisionBinding(wc);
        clearCdpSubscriptions(wc);
        enabledDomains.delete(wc);
        ownedFrameSessions.delete(wc);
        for (const [key, collector] of networkCollectors) {
            if (collector.wc !== wc) continue;
            collector.cleanup();
            networkCollectors.delete(key);
        }
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
        for (const [stateKey, state] of pageEventStates) {
            if (state.wc !== wc) continue;
            pageEventStates.delete(stateKey);
            targetStateKeys.get(state.key)?.delete(stateKey);
            state.cleanup();
        }
    });
}

async function enableDomain(wc: WebContents, domain: "Page" | "Runtime" | "Network", sessionId?: string): Promise<void> {
    let sessions = enabledDomains.get(wc);
    if (!sessions) {
        sessions = new Map();
        enabledDomains.set(wc, sessions);
    }
    const sessionKey = sessionId ?? "";
    let domains = sessions.get(sessionKey);
    if (!domains) {
        domains = new Set();
        sessions.set(sessionKey, domains);
    }
    if (domains.has(domain)) return;
    let pendingSessions = enablingDomains.get(wc);
    if (!pendingSessions) { pendingSessions = new Map(); enablingDomains.set(wc, pendingSessions); }
    let pendingDomains = pendingSessions.get(sessionKey);
    if (!pendingDomains) { pendingDomains = new Map(); pendingSessions.set(sessionKey, pendingDomains); }
    const existing = pendingDomains.get(domain);
    if (existing) return existing;
    const params = domain === "Network" ? { maxTotalBufferSize: 20 * 1024 * 1024, maxResourceBufferSize: 1024 * 1024 } : {};
    const pending = wc.debugger.sendCommand(`${domain}.enable`, params, sessionId).then(() => { domains.add(domain); }).finally(() => {
        pendingDomains?.delete(domain);
    });
    pendingDomains.set(domain, pending);
    return pending;
}

function rememberNetworkRecord(collector: NetworkCollector, record: NetworkRequestRecord): void {
    const existingIndex = collector.records.findIndex(item => item.sessionId === record.sessionId && item.requestId === record.requestId);
    if (existingIndex >= 0) collector.records.splice(existingIndex, 1);
    collector.records.push(record);
    if (collector.records.length > 200) collector.records.splice(0, collector.records.length - 200);
}

async function ensureNetworkCollector(key: string, wc: WebContents): Promise<void> {
    const existing = networkCollectors.get(key);
    if (existing) return existing.ready;
    const collector: NetworkCollector = { wc, records: [], sessions: new Set([undefined]), cleanup: () => {} };
    collector.cleanup = subscribeCdpEvents(wc, (method, raw, sessionId) => {
        if (!isRecord(raw) || !collector.sessions.has(sessionId)) return;
        if (method === "Network.requestWillBeSent" && typeof raw.requestId === "string" && isRecord(raw.request)) {
            rememberNetworkRecord(collector, {
                requestId: raw.requestId,
                url: typeof raw.request.url === "string" ? raw.request.url : "",
                method: typeof raw.request.method === "string" ? raw.request.method : "GET",
                wallTime: typeof raw.wallTime === "number" ? raw.wallTime * 1000 : undefined,
                finished: false,
            });
        } else if (typeof raw.requestId === "string") {
            const record = collector.records.findLast(item => item.sessionId === sessionId && item.requestId === raw.requestId);
            if (!record) return;
            if (method === "Network.responseReceived" && isRecord(raw.response)) {
                const response = raw.response;
                record.response = {
                    status: typeof response.status === "number" ? response.status : 0,
                    statusText: typeof response.statusText === "string" ? response.statusText : "",
                    headers: isRecord(response.headers) ? Object.fromEntries(Object.entries(response.headers).filter((entry): entry is [string, string] => typeof entry[1] === "string")) : {},
                    mimeType: typeof response.mimeType === "string" ? response.mimeType : "",
                };
            } else if (method === "Network.loadingFinished") record.finished = true;
        }
    });
    networkCollectors.set(key, collector);
    collector.ready = enableDomain(wc, "Network");
    try { await collector.ready; }
    catch (error: unknown) {
        collector.cleanup();
        networkCollectors.delete(key);
        throw error;
    }
}

/**
 * Bound a `Network.getResponseBody` result to `maxBodyBytes` source bytes. Returns undefined when
 * Chromium hands back an empty body for a response whose `content-length` says otherwise — a
 * response the page read as a Blob is not buffered for DevTools, and "" would misreport it.
 */
function boundedResponseBody(
    body: string, base64Encoded: boolean, response: { mimeType: string; headers: Record<string, string> }, maxBodyBytes: number,
): { body: string; base64Encoded: boolean; truncated: boolean } | undefined {
    const bytes = base64Encoded ? Buffer.from(body, "base64") : Buffer.from(body, "utf8");
    const contentLength = Object.entries(response.headers).find(([name]) => name.toLowerCase() === "content-length")?.[1];
    if (bytes.length === 0 && Number(contentLength) > 0) return undefined;
    const mimeType = response.mimeType;
    const truncated = bytes.length > maxBodyBytes;
    const bounded = truncated ? bytes.subarray(0, maxBodyBytes) : bytes;
    const binary = base64Encoded || !/^(?:text\/|application\/(?:[^;]+\+)?(?:json|xml)|application\/(?:javascript|x-javascript|ecmascript|x-www-form-urlencoded)|image\/svg\+xml)/i.test(mimeType);
    return { body: binary ? bounded.toString("base64") : bounded.toString("utf8"), base64Encoded: binary, truncated };
}

/** Flattened OOPIF sessions `getOwnedTargetSessions` attached, by target id — reused across waits
 * instead of attaching (and receiving every event) once more per arm. */
const ownedFrameSessions = new WeakMap<WebContents, Map<string, string>>();

/** Drop a cached OOPIF session that stopped answering (its frame swapped process or detached). */
function forgetOwnedFrameSession(wc: WebContents, sessionId: string | undefined): void {
    const cached = ownedFrameSessions.get(wc);
    if (!cached) return;
    for (const [targetId, cachedSessionId] of cached) {
        if (cachedSessionId === sessionId) cached.delete(targetId);
    }
}

async function getOwnedTargetSessions(wc: WebContents, rootSessionId?: string): Promise<Set<string | undefined>> {
    const owned: Set<string | undefined> = new Set([rootSessionId]);
    const targetInfo = await wc.debugger.sendCommand("Target.getTargetInfo", {}, rootSessionId);
    const rootTargetId = targetInfo?.targetInfo?.targetId;
    if (typeof rootTargetId !== "string") return owned;
    const { targetInfos = [] } = await wc.debugger.sendCommand("Target.getTargets");
    const byId = new Map<string, { targetId: string; type: string; parentId?: string }>();
    let cached = ownedFrameSessions.get(wc);
    if (!cached) { cached = new Map(); ownedFrameSessions.set(wc, cached); }
    for (const item of targetInfos) {
        if (isRecord(item) && typeof item.targetId === "string" && typeof item.type === "string") {
            byId.set(item.targetId, { targetId: item.targetId, type: item.type, parentId: typeof item.parentId === "string" ? item.parentId : undefined });
        }
    }
    const isDescendant = (target: { parentId?: string }): boolean => {
        let parentId = target.parentId;
        const seen = new Set<string>();
        while (parentId && !seen.has(parentId)) {
            if (parentId === rootTargetId) return true;
            seen.add(parentId);
            const parent = byId.get(parentId);
            // Target.getTargets spans the whole app: never walk up through a browser tab's
            // webview, or the app window would own every tab's iframes (private tabs included).
            if (!parent || parent.type === "webview") return false;
            parentId = parent.parentId;
        }
        return false;
    };
    for (const targetId of cached.keys()) {
        if (!byId.has(targetId)) cached.delete(targetId);
    }
    const pending = [...byId.values()].filter(target => target.type === "iframe" && isDescendant(target));
    for (const target of pending) {
        const existing = cached.get(target.targetId);
        if (existing) { owned.add(existing); continue; }
        try {
            const attached = await wc.debugger.sendCommand("Target.attachToTarget", { targetId: target.targetId, flatten: true });
            if (typeof attached?.sessionId === "string") {
                cached.set(target.targetId, attached.sessionId);
                owned.add(attached.sessionId);
            }
        } catch { /* A frame can disappear between enumeration and attach. */ }
    }
    return owned;
}

async function armResponseWait(
    event: Electron.IpcMainInvokeEvent,
    key: string,
    pattern: string | BrowserResponsePattern,
    options: BrowserResponseWaitOptions = {},
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
    const board = boardRegistrations.get(key);
    const wc = key === APP_WINDOW_CDP_KEY ? event.sender : board?.host ?? getWebContentsForPageEvents(key);
    if (!wc || wc.isDestroyed()) throw new Error("WebContents not found or destroyed");
    ensureAttached(wc);
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
    cleanupEvent = subscribeCdpEvents(wc, (method, raw, sessionId) => {
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
            // Headers are the response (as Playwright's waitForResponse); only a requested body
            // has to wait for loadingFinished. A body the page never reads may never finish.
            if (!includeBody && matches(tracked.url)) finish(undefined, tracked.response);
        } else if (method === "Network.loadingFailed") {
            if (!matches(tracked.url)) return;
            // Headers already arrived: the response exists, only its body was cut off (for
            // example ERR_ABORTED when the page never reads it). Resolve without a body.
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
    const isBrowserTab = !board && key !== APP_WINDOW_CDP_KEY;
    try {
        await Promise.all([
            enableDomain(wc, "Network", rootSessionId),
            isBrowserTab ? ensureNetworkCollector(key, wc) : undefined,
        ]);
        for (const sessionId of await getOwnedTargetSessions(wc, rootSessionId)) {
            if (sessionId !== rootSessionId) {
                try { await enableDomain(wc, "Network", sessionId); }
                catch { forgetOwnedFrameSession(wc, sessionId); continue; }
            }
            sessions.add(sessionId);
            if (isBrowserTab) networkCollectors.get(key)?.sessions.add(sessionId);
        }
    } catch (error: unknown) {
        finish(new Error("Response wait was cancelled."));
        promise.catch((): void => undefined);
        throw error;
    }
    responseWaits.set(token, { key, wc, promise, cancel: () => finish(new Error("Response wait was cancelled.")) });
    return token;
}

function clearAiVisionBinding(wc: WebContents): void {
    const state = aiVisionBindingStates.get(wc);
    if (!state) return;
    try {
        if (!wc.isDestroyed()) wc.debugger.removeListener("message", state.handler);
    } catch {
        // WebContents may already be destroyed.
    }
    aiVisionBindingStates.delete(wc);
}

async function ensureAiVisionBinding(
    wc: WebContents,
    onAiVisionSignal: (webContents: WebContents, payload: string) => void,
): Promise<void> {
    const existing = aiVisionBindingStates.get(wc);
    if (existing?.installed) return;
    if (existing?.installing) return existing.installing;

    const state: AiVisionBindingState = existing || {
        handler: (_event, method, params) => {
            if (method !== "Runtime.bindingCalled") return;
            if (!params || typeof params !== "object") return;
            const binding = params as { name?: unknown; payload?: unknown };
            if (binding.name !== AI_VISION_HOST_SIGNAL) return;
            if (typeof binding.payload !== "string") return;
            onAiVisionSignal(wc, binding.payload);
        },
        installed: false,
    };
    if (!existing) {
        aiVisionBindingStates.set(wc, state);
        wc.debugger.on("message", state.handler);
    }

    const installing = (async () => {
        await enableDomain(wc, "Runtime");
        await wc.debugger.sendCommand("Runtime.addBinding", { name: AI_VISION_HOST_SIGNAL });
        if (aiVisionBindingStates.get(wc) === state) state.installed = true;
    })().catch(() => {
        if (aiVisionBindingStates.get(wc) === state) clearAiVisionBinding(wc);
    }).finally(() => {
        if (aiVisionBindingStates.get(wc) === state) state.installing = undefined;
    });
    state.installing = installing;
    return installing;
}

/**
 * Resolve (and cache) the flattened CDP session for a board's `board://<host>` frame.
 * Mirrors the iframe-attach the snapshot code does, but at the host-wc level: find the
 * board frame among the host's CDP targets, then `attachToTarget({ flatten: true })`.
 */
async function resolveBoardSession(reg: BoardReg): Promise<string | undefined> {
    if (reg.host.isDestroyed()) return undefined;
    ensureAttached(reg.host);
    if (reg.sessionId) return reg.sessionId;
    const origin = `board://${reg.boardHost}`;
    const { targetInfos } = await reg.host.debugger.sendCommand("Target.getTargets");
    const iframes = (targetInfos || []).filter(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (t: any) => t.type === "iframe" && typeof t.url === "string" && t.url.startsWith(origin),
    );
    // Prefer the frame whose URL carries THIS registration's ?v= nonce — origin alone
    // is ambiguous when the same board is open in several tabs, or when a remount's old
    // frame briefly lingers (US-796). Fall back to the first same-origin frame only when
    // no nonce is known or none matches (e.g. an older shim without the tag).
    const target =
        (reg.frameNonce &&
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            iframes.find((t: any) => t.url.includes(`v=${reg.frameNonce}`))) ||
        iframes[0];
    if (!target) return undefined;
    const { sessionId } = await reg.host.debugger.sendCommand("Target.attachToTarget", {
        targetId: target.targetId,
        flatten: true,
    });
    reg.sessionId = sessionId;
    return sessionId;
}

function appendBounded<T>(items: T[], value: T): void {
    items.push(value);
    if (items.length > MAX_PAGE_EVENTS) items.splice(0, items.length - MAX_PAGE_EVENTS);
}

function remoteObjectDescription(value: unknown): string {
    if (!value || typeof value !== "object") return String(value ?? "");
    const object = value as { value?: unknown; unserializableValue?: unknown; description?: unknown; type?: unknown };
    if (object.value !== undefined) {
        try { return typeof object.value === "string" ? object.value : JSON.stringify(object.value) ?? String(object.value); }
        catch { return String(object.value); }
    }
    if (typeof object.unserializableValue === "string") return object.unserializableValue;
    return typeof object.description === "string" ? object.description : String(object.type ?? "object");
}

function normalizeConsoleLevel(value: unknown): PageConsoleLevel {
    if (value === "warning") return "warning";
    if (value === "error" || value === "assert") return "error";
    if (value === "debug" || value === "trace") return "debug";
    if (value === "info") return "info";
    return "log";
}

function createPageEventState(
    key: string,
    wc: WebContents,
    sessionId: string | undefined,
    send: (method: string, params?: object) => Promise<unknown>,
): PageEventState {
    const stateKey = eventStateKey(key, sessionId);
    const existing = pageEventStates.get(stateKey);
    if (existing) return existing;
    const state: PageEventState = {
        key, sessionId, wc, send, policy: "dismiss", dialogs: [], consoleMessages: [], pageErrors: [], cleanup: () => {},
    };
    state.cleanup = subscribeCdpEvents(wc, (method, rawParams, eventSessionId) => {
        if ((eventSessionId || undefined) !== sessionId || !rawParams || typeof rawParams !== "object") return;
        const params = rawParams as Record<string, unknown>;
        const timestamp = Date.now();
        if (method === "Page.javascriptDialogOpening") {
            const type = typeof params.type === "string" ? params.type : "alert";
            const record: PageDialogRecord = {
                type,
                message: typeof params.message === "string" ? params.message : "",
                url: typeof params.url === "string" ? params.url : "",
                timestamp,
                disposition: "pending",
                reported: false,
            };
            appendBounded(state.dialogs, record);
            if (type === "beforeunload" || key === APP_WINDOW_CDP_KEY) return;
            const activity = automationActivity.get(key);
            const inAutomationWindow = Boolean(activity && (activity.count > 0 || activity.graceUntil > timestamp));
            if (!inAutomationWindow || state.policy === "manual") return;
            const accept = state.policy === "accept";
            void sendDialogCommand(state, accept, undefined, record).catch(() => { /* Keep the dialog pending if Chromium rejects CDP handling. */ });
            return;
        }
        if (method === "Runtime.consoleAPICalled") {
            const stackTrace = params.stackTrace as { callFrames?: Array<Record<string, unknown>> } | undefined;
            const stack = stackTrace?.callFrames?.[0] ?? {};
            appendBounded(state.consoleMessages, {
                type: normalizeConsoleLevel(params.type),
                args: Array.isArray(params.args) ? params.args.map(remoteObjectDescription) : [],
                url: typeof stack.url === "string" ? stack.url : "",
                lineNumber: Number.isFinite(stack.lineNumber) ? stack.lineNumber : 0,
                columnNumber: Number.isFinite(stack.columnNumber) ? stack.columnNumber : 0,
                timestamp,
            });
            return;
        }
        if (method === "Runtime.exceptionThrown") {
            const details = (params.exceptionDetails && typeof params.exceptionDetails === "object"
                ? params.exceptionDetails : {}) as Record<string, unknown>;
            const exception = details.exception;
            const exceptionText = remoteObjectDescription(exception);
            appendBounded(state.pageErrors, {
                text: exceptionText || (typeof details.text === "string" ? details.text : "Uncaught page exception"),
                url: typeof details.url === "string" ? details.url : "",
                lineNumber: typeof details.lineNumber === "number" && Number.isFinite(details.lineNumber) ? details.lineNumber : 0,
                columnNumber: typeof details.columnNumber === "number" && Number.isFinite(details.columnNumber) ? details.columnNumber : 0,
                timestamp,
            });
        }
    });
    pageEventStates.set(stateKey, state);
    let keys = targetStateKeys.get(key);
    if (!keys) { keys = new Set(); targetStateKeys.set(key, keys); }
    keys.add(stateKey);
    return state;
}

async function sendDialogCommand(
    state: PageEventState,
    accept: boolean,
    promptText?: string,
    selectedDialog?: PageDialogRecord,
): Promise<void> {
    const pending = selectedDialog ?? state.dialogs.find(dialog => dialog.disposition === "pending" && dialog.type !== "beforeunload");
    if (!pending || pending.disposition !== "pending") return;
    const existing = dialogCommandPromises.get(pending);
    if (existing) return existing;
    const command = Promise.resolve().then(() => state.send("Page.handleJavaScriptDialog", {
        accept,
        ...(promptText !== undefined ? { promptText } : {}),
    })).then(() => {
        pending.disposition = accept ? "accepted" : "dismissed";
    });
    dialogCommandPromises.set(pending, command);
    try {
        await command;
    } finally {
        if (dialogCommandPromises.get(pending) === command) dialogCommandPromises.delete(pending);
    }
}

async function pageEventsForSender(
    event: Electron.IpcMainInvokeEvent,
    key: string,
): Promise<PageEventState> {
    if (key === APP_WINDOW_CDP_KEY) {
        if (event.sender.isDestroyed()) throw new Error("App window is gone");
        ensureAttached(event.sender);
        const state = createPageEventState(key, event.sender, undefined,
            (method, params) => event.sender.debugger.sendCommand(method, params));
        await enableDomain(event.sender, "Page");
        await enableDomain(event.sender, "Runtime");
        return state;
    }
    const board = boardRegistrations.get(key);
    if (board) {
        let sessionId = await resolveBoardSession(board);
        if (!sessionId) throw new Error("Board frame not ready for CDP (still loading?)");
        const enableSession = async () => {
            const activeSession = sessionId;
            const state = createPageEventState(key, board.host, activeSession,
                (method, params) => board.host.debugger.sendCommand(method, params, activeSession));
            await enableDomain(board.host, "Page", activeSession);
            await enableDomain(board.host, "Runtime", activeSession);
            return state;
        };
        try {
            return await enableSession();
        } catch (error: unknown) {
            if (board.sessionId !== sessionId) throw error;
            board.sessionId = undefined;
            sessionId = await resolveBoardSession(board);
            if (!sessionId) throw error;
            return enableSession();
        }
    }
    const wc = getWebContentsForPageEvents(key);
    if (!wc || wc.isDestroyed()) throw new Error("WebContents not found or destroyed");
    ensureAttached(wc);
    await ensureNetworkCollector(key, wc);
    const state = createPageEventState(key, wc, undefined,
        (method, params) => wc.debugger.sendCommand(method, params));
    await enableDomain(wc, "Page");
    await enableDomain(wc, "Runtime");
    return state;
}

let getWebContentsForPageEvents: (key: string) => WebContents | undefined = () => undefined;

interface NavigationWaitRequest {
    waitUntil?: "load" | "domcontentloaded" | "networkidle";
    timeout?: number;
    kind?: "navigation" | "url";
    /** Count a load already in progress at arm time (waitForNavigation). Actions that trigger
     *  their own navigation must not: a still-committing previous load (an error page, say)
     *  would satisfy the wait with the wrong document. */
    adoptInProgress?: boolean;
    urlPattern?: string | { source: string; flags?: string };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object";
}

async function armNavigationWait(
    key: string,
    request: NavigationWaitRequest,
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
    const wc = getWebContentsForPageEvents(key);
    if (!wc || wc.isDestroyed()) throw new Error("WebContents not found or destroyed");
    ensureAttached(wc);
    await ensureNetworkCollector(key, wc);
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
        // Chromium's own error page commits after a failed load; it never satisfies a wait (the
        // failure itself is reported through Network.loadingFailed).
        if (currentUrl.startsWith("chrome-error://")) return;
        // about: documents may commit without lifecycle events, so their commit is enough. A
        // data: document is parsed like any other page and fires them: finishing on its commit
        // would hand back a document whose DOM is not there yet.
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
    cleanupEvent = subscribeCdpEvents(wc, eventHandler);
    navigationWaits.set(token, { key, wc, promise, cancel: () => finish(new Error("Navigation wait was cancelled.")) });
    try {
        await enableDomain(wc, "Page");
        await enableDomain(wc, "Network");
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
    // waitForURL: an already-matching URL resolves at once (Playwright semantics). The URL can
    // change between the caller's trigger and this arm completing.
    if (kind === "url" && urlMatches(currentUrl)) {
        committed = true;
        navigationStarted = true;
        finish();
        return token;
    }
    timer.id = setTimeout(() => finish(new Error(`Timed out waiting for ${kind === "url" ? "URL match" : "navigation"} after ${timeout} ms (timeout ${timeout} ms).`)), timeout);
    return token;
}

/**
 * Send a CDP command for a board key, routed to the board frame.
 *
 * A command WITHOUT an explicit session runs in the board frame's session (resolved +
 * cached on demand). A command WITH a session (snapshot's nested-iframe attaches)
 * passes through unchanged. `Target.getTargets` short-circuits to an empty list —
 * boards are single local documents, so nested-iframe snapshots are unsupported
 * (EPIC-037 C773-2); this keeps the shared snapshot code from discovering sibling
 * frames. On a stale session (the frame reloaded) we re-resolve once.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function boardSend(reg: BoardReg, method: string, params: object | undefined, sessionId?: string): Promise<any> {
    if (reg.host.isDestroyed()) throw new Error("Board host window is gone");
    if (method === "Target.getTargets") return { targetInfos: [] };

    // `Page.captureScreenshot` can only run on a TOP-LEVEL target, not the board's
    // OOPIF session. Capture the host page on the top-level session, clipped to the
    // board iframe's on-screen rect (EPIC-037 C773-4).
    if (method === "Page.captureScreenshot") {
        ensureAttached(reg.host);
        let boardRect: { x: number; y: number; width: number; height: number; scale: number } | undefined;
        try {
            // Select THIS tab's iframe by its ?v= nonce (multiple tabs of the same board
            // share the board:// src prefix; only one is visible — US-796). Fall back to
            // the origin-prefix selector when no nonce is known.
            const selector = reg.frameNonce
                ? `iframe[src*="v=${reg.frameNonce}"]`
                : `iframe[src^="board://${reg.boardHost}"]`;
            const rect = await reg.host.debugger.sendCommand("Runtime.evaluate", {
                expression:
                    `(() => { const f = document.querySelector('${selector}');` +
                    ` if (!f) return ""; const r = f.getBoundingClientRect();` +
                    ` return JSON.stringify({ x: r.x, y: r.y, width: r.width, height: r.height }); })()`,
                returnByValue: true,
            });
            const json = rect?.result?.value;
            if (json) {
                const r = JSON.parse(json);
                if (r.width > 0 && r.height > 0) {
                    boardRect = { x: r.x, y: r.y, width: r.width, height: r.height, scale: 1 };
                }
            }
        } catch {
            // Couldn't resolve the rect — fall back to capturing the whole host page.
        }
        const incoming = (params as { clip?: { x: number; y: number; width: number; height: number; scale?: number } } | undefined)?.clip;
        let clip = boardRect;
        if (boardRect && incoming) {
            const x = Math.max(boardRect.x, boardRect.x + incoming.x);
            const y = Math.max(boardRect.y, boardRect.y + incoming.y);
            const right = Math.min(boardRect.x + boardRect.width, boardRect.x + incoming.x + incoming.width);
            const bottom = Math.min(boardRect.y + boardRect.height, boardRect.y + incoming.y + incoming.height);
            if (right <= x || bottom <= y) throw new Error("Board screenshot target is outside the board iframe.");
            clip = { x, y, width: right - x, height: bottom - y, scale: incoming.scale ?? 1 };
        }
        return reg.host.debugger.sendCommand("Page.captureScreenshot", {
            ...(params || {}),
            ...(clip ? { clip } : {}),
        });
    }

    if (sessionId) {
        return reg.host.debugger.sendCommand(method, params, sessionId);
    }

    let sid = await resolveBoardSession(reg);
    if (!sid) throw new Error("Board frame not ready for CDP (still loading?)");
    try {
        return await reg.host.debugger.sendCommand(method, params, sid);
    } catch (e) {
        // The cached session may be stale (frame reloaded/navigated) — re-resolve once.
        reg.sessionId = undefined;
        sid = await resolveBoardSession(reg);
        if (sid) return reg.host.debugger.sendCommand(method, params, sid);
        throw e;
    }
}

/**
 * Initialize CDP IPC handlers.
 * @param getWebContents — resolver from registration key to webContents (browser pages)
 */
export function initCdpHandlers(
    getWebContents: (key: string) => WebContents | undefined,
    onAiVisionSignal: (webContents: WebContents, payload: string) => void,
): void {
    getWebContentsForPageEvents = getWebContents;
    setNetworkResponseBodyResolver(async (key, entries, maxBodyBytes) => {
        const collector = networkCollectors.get(key);
        const output = new Map<number, { responseBody: string; responseBodyBase64Encoded: boolean; responseBodyTruncated: boolean }>();
        if (!collector || collector.wc.isDestroyed()) return output;
        const candidates = entries.map(entry => collector.records.filter(record =>
            record.finished && record.response && record.url === entry.url && record.method === entry.method
            && record.wallTime !== undefined && Math.abs(record.wallTime - entry.timestamp) <= 1000));
        for (let index = 0; index < entries.length; index++) {
            const matches = candidates[index];
            if (matches.length !== 1) continue;
            const record = matches[0];
            if (candidates.some((other, otherIndex) => otherIndex !== index && other.includes(record))) continue;
            try {
                const result = await collector.wc.debugger.sendCommand("Network.getResponseBody", { requestId: record.requestId }, record.sessionId);
                if (!isRecord(result) || typeof result.body !== "string") continue;
                const body = boundedResponseBody(result.body, result.base64Encoded === true, record.response ?? { mimeType: "", headers: {} }, maxBodyBytes);
                if (!body) continue;
                output.set(entries[index].id, { responseBody: body.body, responseBodyBase64Encoded: body.base64Encoded, responseBodyTruncated: body.truncated });
            } catch { /* Chromium may already have discarded the body. */ }
        }
        return output;
    });
    ipcMain.handle(BrowserChannel.getPageEvents, async (event, key: string) => {
        const state = await pageEventsForSender(event, key);
        return {
            policy: state.policy,
            dialogs: state.dialogs.map(dialog => ({ ...dialog })),
            consoleMessages: state.consoleMessages.map(message => ({ ...message, args: [...message.args] })),
            pageErrors: state.pageErrors.map(error => ({ ...error })),
        } satisfies PageEventsSnapshot;
    });
    ipcMain.handle(BrowserChannel.markDialogReported, async (event, key: string) => {
        const state = await pageEventsForSender(event, key);
        const dialog = state.dialogs.find(record => !record.reported && record.disposition !== "pending");
        if (dialog) dialog.reported = true;
    });
    ipcMain.handle(BrowserChannel.setDialogPolicy, async (event, key: string, policy: PageDialogPolicy) => {
        if (policy !== "accept" && policy !== "dismiss" && policy !== "manual") {
            throw new Error("Dialog policy must be accept, dismiss, or manual.");
        }
        const state = await pageEventsForSender(event, key);
        state.policy = policy;
        if (policy !== "manual") {
            const pending = state.dialogs.find(record => record.disposition === "pending" && record.type !== "beforeunload");
            if (pending) await sendDialogCommand(state, policy === "accept");
        }
        return policy;
    });
    ipcMain.handle(BrowserChannel.handleDialog, async (event, key: string, accept: boolean, promptText?: string) => {
        const state = await pageEventsForSender(event, key);
        const pending = key === APP_WINDOW_CDP_KEY ? undefined
            : state.dialogs.find(record => record.disposition === "pending" && record.type !== "beforeunload");
        if (!pending) throw new Error("No pending JavaScript dialog is open on this page.");
        await sendDialogCommand(state, accept, promptText);
    });
    ipcMain.handle(BrowserChannel.automationBegin, async (event, key: string) => {
        const state = await pageEventsForSender(event, key);
        const pending = key === APP_WINDOW_CDP_KEY ? undefined
            : state.dialogs.find(record => record.disposition === "pending" && record.type !== "beforeunload");
        if (pending) {
            if (state.policy === "manual") {
                throw new Error(`A ${pending.type}("${pending.message}") dialog is open on this page — call handleDialog(accept, promptText?) or set dialogs({ policy })`);
            }
            await sendDialogCommand(state, state.policy === "accept");
        }
        const activity = automationActivity.get(key) ?? { count: 0, graceUntil: 0 };
        activity.count++;
        automationActivity.set(key, activity);
    });
    ipcMain.handle(BrowserChannel.automationEnd, (_event, key: string) => {
        const activity = automationActivity.get(key);
        if (!activity || activity.count === 0) return;
        activity.count--;
        if (activity.count === 0) activity.graceUntil = Date.now() + 2000;
    });
    ipcMain.handle(BrowserChannel.armNavigationWait, async (_event, key: string, options: NavigationWaitRequest) =>
        armNavigationWait(key, options));
    ipcMain.handle(BrowserChannel.awaitNavigationWait, async (_event, token: string) => {
        const state = navigationWaits.get(token);
        if (!state) throw new Error("Navigation wait token is missing or expired.");
        try { return await state.promise; }
        finally { navigationWaits.delete(token); }
    });
    ipcMain.handle(BrowserChannel.armResponseWait, async (event, key: string, pattern: string | BrowserResponsePattern, options: BrowserResponseWaitOptions) =>
        armResponseWait(event, key, pattern, options));
    ipcMain.handle(BrowserChannel.awaitResponseWait, async (_event, token: string) => {
        const state = responseWaits.get(token);
        if (!state) throw new Error("Response wait token is missing or expired.");
        try { return await state.promise; }
        finally { responseWaits.delete(token); }
    });
    ipcMain.handle(BrowserChannel.armDragIntercept, async (event, key: string, sessionId?: string) => {
        const page = await pageEventsForSender(event, key);
        if (boardRegistrations.has(key) && (page.sessionId || undefined) !== (sessionId || undefined)) {
            throw new Error("Drag interception session does not match the selected target.");
        }
        const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
        let resolve!: (data: DragData) => void;
        const promise = new Promise<DragData>(done => { resolve = done; });
        let cleanup = () => {};
        const state: DragInterceptState = { promise, cleanup: () => cleanup() };
        cleanup = subscribeCdpEvents(page.wc, (method, raw, eventSessionId) => {
            if (method !== "Input.dragIntercepted" || (eventSessionId || undefined) !== (sessionId || undefined)) return;
            if (!raw || typeof raw !== "object") return;
            const data = (raw as { data?: unknown }).data;
            if (!data || typeof data !== "object") return;
            state.result = data as DragData;
            cleanup();
            resolve(state.result);
        });
        dragIntercepts.set(token, state);
        return token;
    });
    ipcMain.handle(BrowserChannel.takeDragIntercept, async (_event, token: string, waitMs: number) => {
        const state = dragIntercepts.get(token);
        if (!state || state.taken) return null;
        state.taken = true;
        const delay = Number.isFinite(waitMs) ? Math.max(0, Math.min(waitMs, 5000)) : 0;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            return await Promise.race([
                state.promise,
                new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), delay); }),
            ]);
        } finally {
            if (timer !== undefined) clearTimeout(timer);
            state.cleanup();
            dragIntercepts.delete(token);
        }
    });

    ipcMain.handle(BrowserChannel.cdpAttach, async (event, key: string, options?: CdpAttachOptions) => {
        if (key === APP_WINDOW_CDP_KEY) {
            if (event.sender.isDestroyed()) return false;
            try {
                ensureAttached(event.sender);
                return true;
            } catch {
                return false;
            }
        }
        const board = boardRegistrations.get(key);
        if (board) {
            if (board.host.isDestroyed()) return false;
            try {
                ensureAttached(board.host);
                return true;
            } catch {
                return false;
            }
        }
        const wc = getWebContents(key);
        if (!wc || wc.isDestroyed()) return false;
        try {
            ensureAttached(wc);
            if (options?.aiVisionBinding === true) {
                await ensureAiVisionBinding(wc, onAiVisionSignal);
            }
            return true;
        } catch {
            return false;
        }
    });

    ipcMain.handle(BrowserChannel.cdpDetach, async (_event, key: string) => {
        if (key === APP_WINDOW_CDP_KEY) {
            // The app window's debugger is SHARED (boards attach to the same wc);
            // never detach it — just leave it attached for the window's lifetime.
            return;
        }
        const board = boardRegistrations.get(key);
        if (board) {
            // The host wc debugger is SHARED (other boards / future use); never detach
            // it for one board — just drop this board's cached frame session.
            board.sessionId = undefined;
            clearCdpTargetState(key);
            return;
        }
        const wc = getWebContents(key);
        if (!wc || wc.isDestroyed()) return;
        if (!attachedDebuggers.has(wc)) return;
        try {
            wc.debugger.detach();
        } catch {
            // already detached
        }
        clearAiVisionBinding(wc);
        clearCdpTargetState(key);
        attachedDebuggers.delete(wc);
    });

    ipcMain.handle(
        BrowserChannel.cdpSend,
        async (event, key: string, method: string, params?: object, sessionId?: string) => {
            if (key === APP_WINDOW_CDP_KEY) {
                const wc = event.sender;
                if (wc.isDestroyed()) throw new Error("App window is gone");
                if (!attachedDebuggers.has(wc)) {
                    try {
                        ensureAttached(wc);
                    } catch {
                        throw new Error("Failed to attach CDP debugger");
                    }
                }
                // Top-level session — Persephone's own React UI. `sessionId` is passed
                // through so the shared snapshot code's nested-iframe attaches (board
                // frames inside the app) and their `f1-…` refs still resolve.
                return wc.debugger.sendCommand(method, params, sessionId);
            }
            const board = boardRegistrations.get(key);
            if (board) {
                return boardSend(board, method, params, sessionId);
            }
            const wc = getWebContents(key);
            if (!wc || wc.isDestroyed()) {
                throw new Error("WebContents not found or destroyed");
            }
            // Auto-attach on first command
            if (!attachedDebuggers.has(wc)) {
                try {
                    ensureAttached(wc);
                } catch {
                    throw new Error("Failed to attach CDP debugger");
                }
            }
            await ensureNetworkCollector(key, wc);
            return wc.debugger.sendCommand(method, params, sessionId);
        },
    );
}
