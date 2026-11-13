import type { WebContents } from "electron";
import { APP_WINDOW_CDP_KEY } from "../../ipc/api-types";
import type { PageConsoleLevel, PageConsoleRecord, PageDialogPolicy, PageDialogRecord, PageErrorRecord, PageEventsSnapshot } from "../../ipc/browser-ipc";
import { ensureNetworkCollector } from "./cdp-network-collector";
import type { CdpFeatureTarget, CdpTarget } from "./CdpTarget";

const MAX_PAGE_EVENTS = 500;
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

export interface PageEventsTarget { webContents: WebContents; cdp: CdpTarget; sessionId?: string; isBoard: boolean }
type ResolveBoardSession = (registration: Extract<CdpFeatureTarget, { kind: "board" }>['registration']) => Promise<string | undefined>;

function eventStateKey(key: string, sessionId?: string): string {
    return `${key}\u0000${sessionId ?? ""}`;
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
    cdp: CdpTarget,
    sessionId: string | undefined,
    send: (method: string, params?: object) => Promise<unknown>,
): PageEventState {
    const stateKey = eventStateKey(key, sessionId);
    const existing = pageEventStates.get(stateKey);
    if (existing) return existing;
    const state: PageEventState = {
        key, sessionId, wc, send, policy: "dismiss", dialogs: [], consoleMessages: [], pageErrors: [], cleanup: () => {},
    };
    state.cleanup = cdp.subscribeCdpEvents((method, rawParams, eventSessionId) => {
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

export async function resolvePageEventsTarget(
    key: string,
    route: CdpFeatureTarget,
    resolveBoardSession: ResolveBoardSession,
): Promise<PageEventsTarget> {
    if (route.kind === "app") {
        const wc = route.webContents;
        if (!wc || wc.isDestroyed()) throw new Error("App window is gone");
        return { webContents: wc, cdp: route.attach(wc), isBoard: false };
    }
    if (route.kind === "board") {
        const board = route.registration;
        const sessionId = await resolveBoardSession(board);
        if (!sessionId) throw new Error("Board frame not ready for CDP (still loading?)");
        const cdp = route.attach(board.host);
        return { webContents: board.host, cdp, sessionId, isBoard: true };
    }
    const wc = route.webContents;
    if (!wc || wc.isDestroyed()) throw new Error("WebContents not found or destroyed");
    return { webContents: wc, cdp: route.attach(wc), isBoard: false };
}

async function pageEventsForTarget(key: string, target: PageEventsTarget): Promise<PageEventState> {
    const { webContents: wc, cdp, sessionId } = target;
    if (!target.isBoard && key !== APP_WINDOW_CDP_KEY) await ensureNetworkCollector(key, wc, cdp);
    const state = createPageEventState(key, wc, cdp, sessionId,
        (method, params) => wc.debugger.sendCommand(method, params, sessionId));
    await cdp.enableDomain("Page", sessionId);
    await cdp.enableDomain("Runtime", sessionId);
    return state;
}

async function pageEventsForSender(
    key: string,
    route: CdpFeatureTarget,
    resolveBoardSession: ResolveBoardSession,
): Promise<PageEventState> {
    const target = await resolvePageEventsTarget(key, route, resolveBoardSession);
    if (target.isBoard) {
        const boardRoute = route as Extract<CdpFeatureTarget, { kind: "board" }>;
        let sessionId = target.sessionId;
        const enableSession = async () => pageEventsForTarget(key, { ...target, sessionId });
        try { return await enableSession(); }
        catch (error: unknown) {
            if (boardRoute.registration.sessionId !== sessionId) throw error;
            boardRoute.registration.sessionId = undefined;
            sessionId = await resolveBoardSession(boardRoute.registration);
            if (!sessionId) throw error;
            return enableSession();
        }
    }
    return pageEventsForTarget(key, target);
}

export async function getPageEvents(key: string, route: CdpFeatureTarget, resolveBoardSession: ResolveBoardSession): Promise<PageEventsSnapshot> {
    const state = await pageEventsForSender(key, route, resolveBoardSession);
    return { policy: state.policy, dialogs: state.dialogs.map(dialog => ({ ...dialog })),
        consoleMessages: state.consoleMessages.map(message => ({ ...message, args: [...message.args] })),
        pageErrors: state.pageErrors.map(error => ({ ...error })) } satisfies PageEventsSnapshot;
}

export async function markDialogReported(key: string, route: CdpFeatureTarget, resolveBoardSession: ResolveBoardSession): Promise<void> {
    const state = await pageEventsForSender(key, route, resolveBoardSession);
    const dialog = state.dialogs.find(record => !record.reported && record.disposition !== "pending");
    if (dialog) dialog.reported = true;
}

export async function setDialogPolicy(key: string, policy: PageDialogPolicy, route: CdpFeatureTarget, resolveBoardSession: ResolveBoardSession): Promise<PageDialogPolicy> {
    if (policy !== "accept" && policy !== "dismiss" && policy !== "manual") throw new Error("Dialog policy must be accept, dismiss, or manual.");
    const state = await pageEventsForSender(key, route, resolveBoardSession);
    state.policy = policy;
    if (policy !== "manual") {
        const pending = state.dialogs.find(record => record.disposition === "pending" && record.type !== "beforeunload");
        if (pending) await sendDialogCommand(state, policy === "accept");
    }
    return policy;
}

export async function handleDialog(key: string, accept: boolean, promptText: string | undefined, route: CdpFeatureTarget, resolveBoardSession: ResolveBoardSession): Promise<void> {
    const state = await pageEventsForSender(key, route, resolveBoardSession);
    const pending = key === APP_WINDOW_CDP_KEY ? undefined : state.dialogs.find(record => record.disposition === "pending" && record.type !== "beforeunload");
    if (!pending) throw new Error("No pending JavaScript dialog is open on this page.");
    await sendDialogCommand(state, accept, promptText);
}

export async function automationBegin(key: string, route: CdpFeatureTarget, resolveBoardSession: ResolveBoardSession): Promise<void> {
    const state = await pageEventsForSender(key, route, resolveBoardSession);
    const pending = key === APP_WINDOW_CDP_KEY ? undefined : state.dialogs.find(record => record.disposition === "pending" && record.type !== "beforeunload");
    if (pending) {
        if (state.policy === "manual") throw new Error(`A ${pending.type}("${pending.message}") dialog is open on this page — call handleDialog(accept, promptText?) or set dialogs({ policy })`);
        await sendDialogCommand(state, state.policy === "accept");
    }
    const activity = automationActivity.get(key) ?? { count: 0, graceUntil: 0 };
    activity.count++;
    automationActivity.set(key, activity);
}

export function automationEnd(key: string): void {
    const activity = automationActivity.get(key);
    if (!activity || activity.count === 0) return;
    activity.count--;
    if (activity.count === 0) activity.graceUntil = Date.now() + 2000;
}

export function clearKey(key: string): void {
    for (const stateKey of targetStateKeys.get(key) ?? []) {
        const state = pageEventStates.get(stateKey);
        state?.cleanup();
        pageEventStates.delete(stateKey);
    }
    targetStateKeys.delete(key);
    automationActivity.delete(key);
}

export function onTargetDetached(wc: WebContents): void {
    for (const [stateKey, state] of pageEventStates) {
        if (state.wc !== wc) continue;
        pageEventStates.delete(stateKey);
        targetStateKeys.get(state.key)?.delete(stateKey);
        state.cleanup();
    }
}
