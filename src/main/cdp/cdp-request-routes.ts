import type { WebContents } from "electron";
import { isRecord } from "../../shared/utils";
import type { BrowserRouteAbortReason, BrowserRouteAction, BrowserRouteRequest, BrowserRouteRemovalRequest, BrowserRouteResponse } from "../../ipc/browser-ipc";
import type { CdpTarget } from "./CdpTarget";
import { recordRoutedRequest } from "../network-logger";

const MAX_ROUTES_PER_TARGET = 50;
const MAX_ROUTE_BODY_BYTES = 1_048_576;
const MAX_ROUTE_DELAY_MS = 30_000;
const MAX_ROUTE_URL_PATTERN_CHARS = 2_000;
const RESOURCE_TYPES = new Set(["Document", "Stylesheet", "Image", "Media", "Font", "Script", "TextTrack", "XHR", "Fetch", "Prefetch", "EventSource", "WebSocket", "Manifest", "SignedExchange", "Ping", "CSPViolationReport", "Preflight", "Other"]);
const ABORT_REASONS = new Set<BrowserRouteAbortReason>([
    "Failed", "Aborted", "TimedOut", "AccessDenied", "ConnectionClosed", "ConnectionReset", "ConnectionRefused",
    "ConnectionAborted", "ConnectionFailed", "NameNotResolved", "InternetDisconnected", "AddressUnreachable",
    "BlockedByClient", "BlockedByResponse",
]);

interface CompiledPattern { kind: "glob" | "regex"; source: string; flags: string; matcher: RegExp; key: string; }
interface RouteRecord {
    pattern: CompiledPattern;
    response: BrowserRouteAction;
    options: { times?: number; methods?: Set<string>; resourceTypes?: Set<string> };
    order: number;
    cancelled?: boolean;
}
interface PausedRequest { requestId: string; url: string; method: string; resourceType: string; route?: RouteRecord; cancelDelay?: () => void; }
interface TargetState {
    wc: WebContents;
    cdp: CdpTarget;
    generation: number;
    unsubscribe?: () => void;
    paused: Map<string, PausedRequest>;
    timers: Map<ReturnType<typeof setTimeout>, (active: boolean) => void>;
    ready?: Promise<void>;
}

const routesByKey = new Map<string, RouteRecord[]>();
const targetsByKey = new Map<string, TargetState>();
const operationQueues = new Map<string, Promise<unknown>>();
let nextOrder = 1;

export async function addRoute(key: string, wc: WebContents, cdp: CdpTarget, request: BrowserRouteRequest): Promise<void> {
    await serialize(key, async () => {
        if (!isRecord(request) || Object.keys(request).some((name) => !["registrationKey", "pattern", "response", "options"].includes(name))) {
            throw new Error("The browser route request contains unsupported fields.");
        }
        const pattern = compilePattern(request?.pattern);
        const response = validateResponse(request?.response);
        const options = validateOptions(request?.options);
        const current = routesByKey.get(key) ?? [];
        if (current.length >= MAX_ROUTES_PER_TARGET) throw new Error(`A browser page can have at most ${MAX_ROUTES_PER_TARGET} request routes.`);
        const records = [...current, { pattern, response, options, order: nextOrder++ }];
        routesByKey.set(key, records);
        await activateTarget(key, wc, cdp);
        await refreshPatterns(key);
    });
}

export async function removeRoutes(key: string, wc: WebContents, cdp: CdpTarget, request: BrowserRouteRemovalRequest): Promise<void> {
    await serialize(key, async () => {
        if (!isRecord(request) || Object.keys(request).some((name) => !["registrationKey", "pattern"].includes(name))) {
            throw new Error("The browser route removal request contains unsupported fields.");
        }
        const pattern = request?.pattern === undefined ? undefined : compilePattern(request.pattern);
        const current = routesByKey.get(key) ?? [];
        const next = pattern ? current.filter((route) => route.pattern.key !== pattern.key) : [];
        for (const route of current) if (!next.includes(route)) route.cancelled = true;
        if (next.length) routesByKey.set(key, next);
        else routesByKey.delete(key);
        const state = targetsByKey.get(key);
        if (state) for (const pending of state.paused.values()) {
            if (pending.route?.cancelled) {
                pending.cancelDelay?.();
                void finishRequest(state, pending.requestId, "Fetch.continueRequest");
            }
        }
        await activateTarget(key, wc, cdp);
        await refreshPatterns(key);
    });
}

export function onTargetAttached(key: string, wc: WebContents, cdp: CdpTarget): void {
    if (!routesByKey.has(key)) return;
    void serialize(key, async () => {
        await activateTarget(key, wc, cdp);
        await refreshPatterns(key);
    }).catch((): undefined => undefined);
}

export function onTargetDetached(wc: WebContents): void {
    for (const [key, state] of targetsByKey) {
        if (state.wc !== wc) continue;
        clearTransient(state);
        targetsByKey.delete(key);
    }
}

export function clearKey(key: string): void {
    routesByKey.delete(key);
    const state = targetsByKey.get(key);
    if (state) clearTransient(state);
    targetsByKey.delete(key);
    operationQueues.delete(key);
}

export async function restoreRoutes(key: string, wc: WebContents, cdp: CdpTarget): Promise<void> {
    if (!routesByKey.has(key)) return;
    await serialize(key, async () => {
        await activateTarget(key, wc, cdp);
        await refreshPatterns(key);
    });
}

async function activateTarget(key: string, wc: WebContents, cdp: CdpTarget): Promise<TargetState> {
    let state = targetsByKey.get(key);
    if (!state || state.wc !== wc || state.cdp !== cdp) {
        if (state) clearTransient(state);
        state = { wc, cdp, generation: 0, paused: new Map(), timers: new Map() };
        const active = state;
        state.unsubscribe = cdp.subscribeCdpEvents((method, params, sessionId) => {
            if (method !== "Fetch.requestPaused" || sessionId !== undefined || !isRecord(params)
                || typeof params.requestId !== "string" || !isRecord(params.request)) return;
            void onRequestPaused(key, active, params as unknown as PausedRequest & { request: { url: string; method: string }; resourceType?: string });
        });
        targetsByKey.set(key, state);
    }
    return state;
}

async function refreshPatterns(key: string): Promise<void> {
    const state = targetsByKey.get(key);
    if (!state || !state.cdp.attached || state.wc.isDestroyed()) return;
    const generation = state.generation;
    const records = routesByKey.get(key) ?? [];
    if (!records.length) {
        await state.wc.debugger.sendCommand("Fetch.disable").catch((): undefined => undefined);
        return;
    }
    await state.wc.debugger.sendCommand("Fetch.enable", {
        handleAuthRequests: false,
        patterns: [{ urlPattern: "*", requestStage: "Request" }],
    });
    if (targetsByKey.get(key) !== state || state.generation !== generation) {
        await state.wc.debugger.sendCommand("Fetch.disable").catch((): undefined => undefined);
    }
}

async function onRequestPaused(key: string, state: TargetState, raw: PausedRequest & { request: { url: string; method: string }; resourceType?: string }): Promise<void> {
    if (typeof raw.request?.url !== "string" || typeof raw.request.method !== "string") {
        await finishRequest(state, raw.requestId, "Fetch.continueRequest");
        return;
    }
    const request: PausedRequest = {
        requestId: raw.requestId,
        url: raw.request.url,
        method: raw.request.method,
        resourceType: typeof raw.resourceType === "string" ? raw.resourceType : "Other",
    };
    state.paused.set(request.requestId, request);
    let route: RouteRecord | undefined;
    try {
        for (const candidate of routesByKey.get(key) ?? []) {
            if (matches(candidate, request) && (!route || candidate.order > route.order)) route = candidate;
        }
    } catch {
        await finishRequest(state, request.requestId, "Fetch.continueRequest");
        return;
    }
    if (!route) { await finishRequest(state, request.requestId, "Fetch.continueRequest"); return; }
    request.route = route;
    state.paused.set(request.requestId, request);
    if (route.options.times !== undefined) {
        route.options.times--;
        if (route.options.times <= 0) {
            const current = routesByKey.get(key) ?? [];
            const remaining = current.filter((candidate) => candidate !== route);
            if (remaining.length) routesByKey.set(key, remaining); else routesByKey.delete(key);
            void serialize(key, () => refreshPatterns(key)).catch((): undefined => undefined);
        }
    }
    try {
        const action = route.response;
        const delayMs = typeof action === "object" && !isAbortAction(action) ? action.delayMs ?? 0 : 0;
        if (delayMs > 0 && !await delay(state, delayMs, request)) {
            await finishRequest(state, request.requestId, "Fetch.continueRequest");
            return;
        }
        if (!isCurrentRoute(key, state, route)) {
            await finishRequest(state, request.requestId, "Fetch.continueRequest");
        } else if (action === "abort" || isAbortAction(action)) {
            const reason = action === "abort" ? "Failed" : action.abort;
            await finishRequest(state, request.requestId, "Fetch.failRequest", { errorReason: reason });
            recordRoutedRequest(key, { url: request.url, method: request.method, resourceType: request.resourceType, error: `net::ERR_${reason} (routed abort)` });
        } else if (isDelayOnly(action)) {
            await finishRequest(state, request.requestId, "Fetch.continueRequest");
        } else {
            const body = action.bodyBase64 ?? Buffer.from(action.body ?? "", "utf8").toString("base64");
            const headers = { ...(action.headers ?? {}) };
            if (action.contentType && !Object.keys(headers).some((name) => name.toLowerCase() === "content-type")) headers["Content-Type"] = action.contentType;
            await finishRequest(state, request.requestId, "Fetch.fulfillRequest", {
                responseCode: action.status ?? 200,
                responseHeaders: Object.entries(headers).map(([name, value]) => ({ name, value })),
                body,
            });
            recordRoutedRequest(key, { url: request.url, method: request.method, resourceType: request.resourceType, statusCode: action.status ?? 200 });
        }
    } catch {
        await finishRequest(state, request.requestId, "Fetch.continueRequest");
    }
}

function isCurrentRoute(key: string, state: TargetState, route: RouteRecord): boolean {
    return targetsByKey.get(key) === state && !route.cancelled;
}

async function finishRequest(state: TargetState, requestId: string, method: string, params?: object): Promise<void> {
    if (!state.paused.has(requestId)) return;
    state.paused.delete(requestId);
    try {
        if (!state.wc.isDestroyed() && state.cdp.attached) await state.wc.debugger.sendCommand(method, { requestId, ...params });
    } catch {
        if (method !== "Fetch.continueRequest" && !state.wc.isDestroyed() && state.cdp.attached) {
            await state.wc.debugger.sendCommand("Fetch.continueRequest", { requestId }).catch((): undefined => undefined);
        }
    }
}

function delay(state: TargetState, delayMs: number, request: PausedRequest): Promise<boolean> {
    if (!delayMs) return Promise.resolve(true);
    return new Promise((resolve) => {
        const settle = (active: boolean) => { request.cancelDelay = undefined; resolve(active); };
        const timer = setTimeout(() => {
            state.timers.delete(timer);
            settle(targetsByKeyHasState(state));
        }, delayMs);
        state.timers.set(timer, settle);
        request.cancelDelay = () => {
            clearTimeout(timer);
            state.timers.delete(timer);
            settle(false);
        };
    });
}

function targetsByKeyHasState(state: TargetState): boolean {
    return [...targetsByKey.values()].includes(state);
}

function clearTransient(state: TargetState): void {
    state.generation++;
    state.unsubscribe?.();
    state.unsubscribe = undefined;
    for (const [timer, resolve] of state.timers) { clearTimeout(timer); resolve(false); }
    state.timers.clear();
    state.paused.clear();
}

function matches(route: RouteRecord, request: PausedRequest): boolean {
    if (route.options.methods && !route.options.methods.has(request.method.toUpperCase())) return false;
    if (route.options.resourceTypes && !route.options.resourceTypes.has(request.resourceType)) return false;
    route.pattern.matcher.lastIndex = 0;
    return route.pattern.matcher.test(request.url);
}

function compilePattern(value: unknown): CompiledPattern {
    if (typeof value === "string") {
        if (!value.length || value.length > MAX_ROUTE_URL_PATTERN_CHARS) throw new Error(`Route URL patterns must contain 1 to ${MAX_ROUTE_URL_PATTERN_CHARS} characters.`);
        return { kind: "glob", source: value, flags: "", matcher: new RegExp(globToRegex(value)), key: JSON.stringify(["glob", value, ""]) };
    }
    if (!isRecord(value) || Object.keys(value).some((key) => key !== "source" && key !== "flags") || typeof value.source !== "string" || typeof value.flags !== "string") {
        throw new Error("A route pattern must be a URL glob or a regular expression descriptor.");
    }
    if (!value.source.length || value.source.length > MAX_ROUTE_URL_PATTERN_CHARS) throw new Error(`Route URL patterns must contain 1 to ${MAX_ROUTE_URL_PATTERN_CHARS} characters.`);
    try {
        const matcher = new RegExp(value.source, value.flags);
        return { kind: "regex", source: matcher.source, flags: matcher.flags, matcher, key: JSON.stringify(["regex", matcher.source, matcher.flags]) };
    } catch { throw new Error("The route regular expression or its flags are invalid."); }
}

function globToRegex(glob: string): string {
    let source = "^";
    for (let index = 0; index < glob.length; index++) {
        const char = glob[index];
        if (char === "\\" && index + 1 < glob.length && (glob[index + 1] === "*" || glob[index + 1] === "\\")) {
            source += escapeRegex(glob[++index]);
        } else if (char === "*") {
            if (glob[index + 1] === "*") { index++; source += ".*"; }
            else source += "[^/]*";
        } else source += escapeRegex(char);
    }
    return `${source}$`;
}

function escapeRegex(value: string): string { return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&"); }

function validateResponse(value: unknown): BrowserRouteAction {
    if (value === "abort") return value;
    if (!isRecord(value)) throw new Error("A route response must be an object or 'abort'.");
    if ("abort" in value) {
        if (Object.keys(value).length !== 1 || typeof value.abort !== "string" || !ABORT_REASONS.has(value.abort as BrowserRouteAbortReason)) throw new Error("The route abort reason is invalid.");
        return { abort: value.abort as BrowserRouteAbortReason };
    }
    const allowed = new Set(["status", "body", "bodyBase64", "headers", "contentType", "delayMs"]);
    if (Object.keys(value).some((key) => !allowed.has(key))) throw new Error("A route response contains an unsupported field.");
    if (value.body !== undefined && typeof value.body !== "string") throw new Error("Route body must be UTF-8 text.");
    if (value.bodyBase64 !== undefined && (typeof value.bodyBase64 !== "string" || value.body !== undefined)) throw new Error("bodyBase64 must be a string and cannot be combined with body.");
    let bytes: Buffer;
    if (typeof value.bodyBase64 === "string") {
        if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.bodyBase64)) throw new Error("Route bodyBase64 is invalid.");
        bytes = Buffer.from(value.bodyBase64, "base64");
        if (bytes.toString("base64") !== value.bodyBase64) throw new Error("Route bodyBase64 is invalid.");
    } else bytes = Buffer.from(typeof value.body === "string" ? value.body : "", "utf8");
    if (bytes.length > MAX_ROUTE_BODY_BYTES) throw new Error(`A route body cannot exceed ${MAX_ROUTE_BODY_BYTES} bytes.`);
    if (value.status !== undefined && (!Number.isInteger(value.status) || (value.status as number) < 100 || (value.status as number) > 599)) throw new Error("Route status must be an integer from 100 to 599.");
    if (value.headers !== undefined && !isRecord(value.headers)) throw new Error("Route headers must be a string record.");
    const headers: Record<string, string> = {};
    if (isRecord(value.headers)) {
        for (const [name, headerValue] of Object.entries(value.headers)) {
            if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || typeof headerValue !== "string" || /[\r\n]/.test(headerValue)) throw new Error("Route header names and values must be valid HTTP strings.");
            headers[name] = headerValue;
        }
    }
    if (value.contentType !== undefined && (typeof value.contentType !== "string" || /[\r\n]/.test(value.contentType))) throw new Error("Route contentType must be a valid header value.");
    const delayMs = normalizeDelay(value.delayMs);
    return { ...(value.status !== undefined ? { status: value.status as number } : {}), ...(typeof value.body === "string" ? { body: value.body } : {}), ...(typeof value.bodyBase64 === "string" ? { bodyBase64: value.bodyBase64 } : {}), ...(Object.keys(headers).length ? { headers } : {}), ...(typeof value.contentType === "string" ? { contentType: value.contentType } : {}), ...(delayMs ? { delayMs } : {}) };
}

function normalizeDelay(value: unknown): number {
    if (value === undefined) return 0;
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Route delayMs must be a finite number.");
    return Math.max(0, Math.min(MAX_ROUTE_DELAY_MS, value));
}

function validateOptions(value: unknown): RouteRecord["options"] {
    if (value === undefined) return {};
    if (!isRecord(value) || Object.keys(value).some((key) => !["times", "method", "resourceTypes"].includes(key))) throw new Error("Route options contain an unsupported field.");
    let times: number | undefined;
    if (value.times !== undefined) {
        if (!Number.isInteger(value.times) || (value.times as number) <= 0) throw new Error("Route times must be a positive integer.");
        times = value.times as number;
    }
    const methodValues = value.method === undefined ? undefined : (Array.isArray(value.method) ? value.method : [value.method]);
    if (methodValues && (!methodValues.length || methodValues.some((item) => typeof item !== "string" || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(item)))) throw new Error("Route method must be an HTTP method or a non-empty array of methods.");
    const resourceTypes = value.resourceTypes;
    if (resourceTypes !== undefined && (!Array.isArray(resourceTypes) || !resourceTypes.length || resourceTypes.some((item) => typeof item !== "string" || !RESOURCE_TYPES.has(item)))) throw new Error("Route resourceTypes contains an unsupported CDP resource type.");
    return { ...(times !== undefined ? { times } : {}), ...(methodValues ? { methods: new Set((methodValues as string[]).map((item) => item.toUpperCase())) } : {}), ...(Array.isArray(resourceTypes) ? { resourceTypes: new Set(resourceTypes as string[]) } : {}) };
}

function isAbortAction(action: BrowserRouteAction): action is { abort: BrowserRouteAbortReason } { return typeof action === "object" && action !== null && "abort" in action; }
function isDelayOnly(action: BrowserRouteResponse): boolean { return Object.keys(action).every((key) => key === "delayMs"); }

function serialize<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = operationQueues.get(key) ?? Promise.resolve();
    const current = previous.catch((): undefined => undefined).then(operation);
    operationQueues.set(key, current);
    return current.finally(() => { if (operationQueues.get(key) === current) operationQueues.delete(key); });
}
