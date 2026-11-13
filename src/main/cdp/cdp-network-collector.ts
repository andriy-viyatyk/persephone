import type { WebContents } from "electron";
import { isRecord } from "../../shared/utils";
import type { CdpTarget } from "./CdpTarget";

interface NetworkRequestRecord {
    sessionId?: string;
    requestId: string;
    url: string;
    method: string;
    wallTime?: number;
    response?: { status: number; statusText: string; headers: Record<string, string>; mimeType: string };
    finished: boolean;
}

export interface NetworkCollector { wc: WebContents; records: NetworkRequestRecord[]; sessions: Set<string | undefined>; cleanup: () => void; ready?: Promise<void> }
const networkCollectors = new Map<string, NetworkCollector>();
const ownedFrameSessions = new WeakMap<WebContents, Map<string, string>>();

function rememberNetworkRecord(collector: NetworkCollector, record: NetworkRequestRecord): void {
    const existingIndex = collector.records.findIndex(item => item.sessionId === record.sessionId && item.requestId === record.requestId);
    if (existingIndex >= 0) collector.records.splice(existingIndex, 1);
    collector.records.push(record);
    if (collector.records.length > 200) collector.records.splice(0, collector.records.length - 200);
}

export async function ensureNetworkCollector(key: string, wc: WebContents, cdp: CdpTarget): Promise<void> {
    const existing = networkCollectors.get(key);
    if (existing) return existing.ready;
    const collector: NetworkCollector = { wc, records: [], sessions: new Set([undefined]), cleanup: () => {} };
    collector.cleanup = cdp.subscribeCdpEvents((method, raw, sessionId) => {
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
    collector.ready = cdp.enableDomain("Network");
    try { await collector.ready; }
    catch (error: unknown) {
        collector.cleanup();
        networkCollectors.delete(key);
        throw error;
    }
}

export function getNetworkCollector(key: string): NetworkCollector | undefined {
    return networkCollectors.get(key);
}

/**
 * Bound a `Network.getResponseBody` result to `maxBodyBytes` source bytes. Returns undefined when
 * Chromium hands back an empty body for a response whose `content-length` says otherwise — a
 * response the page read as a Blob is not buffered for DevTools, and "" would misreport it.
 */
export function boundedResponseBody(
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

/** Drop a cached OOPIF session that stopped answering (its frame swapped process or detached). */
export function forgetOwnedFrameSession(wc: WebContents, sessionId: string | undefined): void {
    const cached = ownedFrameSessions.get(wc);
    if (!cached) return;
    for (const [targetId, cachedSessionId] of cached) {
        if (cachedSessionId === sessionId) cached.delete(targetId);
    }
}

/** Flattened OOPIF sessions attached by target id are reused across waits. */
export async function getOwnedTargetSessions(wc: WebContents, rootSessionId?: string): Promise<Set<string | undefined>> {
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

export function clearKey(key: string): void {
    networkCollectors.get(key)?.cleanup();
    networkCollectors.delete(key);
}

export function onTargetDetached(wc: WebContents): void {
    ownedFrameSessions.delete(wc);
    for (const [key, collector] of networkCollectors) {
        if (collector.wc !== wc) continue;
        collector.cleanup();
        networkCollectors.delete(key);
    }
}
