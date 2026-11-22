/**
 * Chrome DevTools Protocol session management for browser webviews and board frames.
 *
 * The service owns target resolution, debugger lifecycle composition, and the stable IPC facade.
 * CDP feature state and algorithms live in the feature modules under `cdp/`.
 */
import type { WebContents } from "electron";
import { boardFrameRegistry, type BoardFrameRegistration } from "./board-host/BoardFrameRegistry";
import {
    type PageDialogPolicy,
    type PageEventsSnapshot,
    type BrowserResponsePattern,
    type BrowserResponseWaitOptions,
} from "../ipc/browser-ipc";
import { APP_WINDOW_CDP_KEY } from "../ipc/api-types";
import { createNetworkResponseBodyResolver } from "./cdp-network-response-bodies";
import { CdpTarget, type CdpFeatureTarget } from "./cdp/CdpTarget";
import * as cdpAiVisionBinding from "./cdp/cdp-ai-vision-binding";
import * as cdpDragIntercept from "./cdp/cdp-drag-intercept";
import * as cdpNetworkCollector from "./cdp/cdp-network-collector";
import * as cdpPageEvents from "./cdp/cdp-page-events";
import * as cdpWaits from "./cdp/cdp-waits";
import * as cdpBrowserTestFeatures from "./cdp/cdp-browser-test-methods";

const BOARD_FRAME_REPLACEMENT_TIMEOUT_MS = 5000;

let getWebContents: ((key: string) => WebContents | undefined) | undefined;
let onAiVisionSignalCallback: ((webContents: WebContents, payload: string, executionContextId: number, mainContext: boolean) => void) | undefined;

export function clearCdpTargetState(key: string): void {
    clearTransientTargetState(key);
    cdpBrowserTestFeatures.clearBrowserTestCdpState(key);
}

function clearTransientTargetState(key: string): void {
    cdpWaits.clearKey(key);
    cdpNetworkCollector.clearKey(key);
    cdpPageEvents.clearKey(key);
}

/** Whether browser automation (its dialog policy or the agent) answers a JavaScript dialog the page opens now. */
export function automationAnswersPageDialog(wc: WebContents): boolean {
    return cdpPageEvents.automationAnswersDialog(wc);
}

function attachTarget(wc: WebContents): CdpTarget {
    const target = CdpTarget.for(wc);
    if (!target.ensureAttached()) return target;
    cdpAiVisionBinding.onTargetAttached(wc);
    cdpBrowserTestFeatures.onBrowserTestTargetAttached(wc, {
        kind: "browser", webContents: wc, cdp: target, attach: () => target,
    });
    target.onDetached(() => {
        cdpAiVisionBinding.onTargetDetached(wc);
        cdpBrowserTestFeatures.onBrowserTestTargetDetached(wc);
        cdpNetworkCollector.onTargetDetached(wc);
        cdpWaits.onTargetDetached(wc);
        cdpPageEvents.onTargetDetached(wc);
    });
    return target;
}

/**
 * Resolve (and cache) the flattened CDP session for a board's `board://<host>` frame.
 * Mirrors the iframe-attach the snapshot code does, but at the host-wc level: find the
 * board frame among the host's CDP targets, then `attachToTarget({ flatten: true })`.
 */
async function resolveBoardSession(reg: BoardFrameRegistration): Promise<string | undefined> {
    const active = boardFrameRegistry.get(reg.key) ?? reg;
    if (active.host.isDestroyed()) return undefined;
    attachTarget(active.host);
    if (active.sessionId) return active.sessionId;
    const origin = `board://${active.boardHost}`;
    const { targetInfos } = await active.host.debugger.sendCommand("Target.getTargets");
    const iframes = (targetInfos || []).filter(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (t: any) => t.type === "iframe" && typeof t.url === "string" && t.url.startsWith(origin),
    );
    // Prefer the frame whose URL carries THIS registration's ?v= nonce — origin alone
    // is ambiguous when the same board is open in several tabs, or when a remount's old
    // frame briefly lingers. Fall back to the first same-origin frame only when
    // no nonce is known or none matches (e.g. an older shim without the tag).
    const target =
        (active.frameNonce &&
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            iframes.find((t: any) => t.url.includes(`v=${active.frameNonce}`))) ||
        iframes[0];
    if (!target) return undefined;
    const { sessionId } = await active.host.debugger.sendCommand("Target.attachToTarget", {
        targetId: target.targetId,
        flatten: true,
    });
    active.sessionId = sessionId;
    return sessionId;
}

async function resolveReplacementSession(registration: BoardFrameRegistration, detachedSessionId: string): Promise<string | undefined> {
    const key = registration.key;
    if (registration.sessionId === detachedSessionId) registration.sessionId = undefined;
    const target = attachTarget(registration.host);
    return new Promise<string | undefined>((resolve) => {
        let settled = false;
        let resolving = false;
        let cleanupRegistration = () => {};
        let cleanupTarget = () => {};
        const finish = (sessionId?: string) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            cleanupRegistration();
            cleanupTarget();
            resolve(sessionId);
        };
        const tryResolve = async () => {
            if (settled || resolving) return;
            resolving = true;
            try {
                const current = boardFrameRegistry.get(key);
                if (current && !current.host.isDestroyed()) {
                    const sessionId = await resolveBoardSession(current);
                    if (sessionId) { finish(sessionId); return; }
                }
            } catch {
                // Chromium can expose the replacement after its renderer registration.
            } finally {
                resolving = false;
            }
        };
        const timer = setTimeout(() => finish(), BOARD_FRAME_REPLACEMENT_TIMEOUT_MS);
        cleanupRegistration = boardFrameRegistry.onRegistrationChanged((changedKey) => {
            if (changedKey === key) void tryResolve();
        });
        cleanupTarget = target.subscribeCdpEvents((method) => {
            if (method === "Target.attachedToTarget") void tryResolve();
        });
        void tryResolve();
    });
}

/**
 * Send a CDP command for a board key, routed to the board frame.
 *
 * A command WITHOUT an explicit session runs in the board frame's session (resolved +
 * cached on demand). A command WITH a session (snapshot's nested-iframe attaches)
 * passes through unchanged. `Target.getTargets` short-circuits to an empty list —
 * boards are single local documents, so nested-iframe snapshots are unsupported
 *; this keeps the shared snapshot code from discovering sibling
 * frames. On a stale session (the frame reloaded) we re-resolve once.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function boardSend(reg: BoardFrameRegistration, method: string, params: object | undefined, sessionId?: string): Promise<any> {
    if (reg.host.isDestroyed()) throw new Error("Board host window is gone");
    if (method === "Target.getTargets") return { targetInfos: [] };

    // `Page.captureScreenshot` can only run on a TOP-LEVEL target, not the board's
    // OOPIF session. Capture the host page on the top-level session, clipped to the
    // board iframe's on-screen rect.
    if (method === "Page.captureScreenshot") {
        attachTarget(reg.host);
        let boardRect: { x: number; y: number; width: number; height: number; scale: number } | undefined;
        try {
            // Select THIS tab's iframe by its ?v= nonce (multiple tabs of the same board
            // share the board:// src prefix; only one is visible. Fall back to
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

    const key = reg.key;
    let activeRegistration = boardFrameRegistry.get(key) ?? reg;
    let sid = await resolveBoardSession(activeRegistration);
    if (!sid) throw new Error("Board frame not ready for CDP (still loading?)");
    for (let attempt = 0; attempt < 2; attempt++) {
        const target = attachTarget(activeRegistration.host);
        let resolveGone = () => {};
        let gone = false;
        const goneSignal = new Promise<void>((resolve) => { resolveGone = resolve; });
        const cleanupRegistration = boardFrameRegistry.onRegistrationChanged((changedKey, current, previous) => {
            if (changedKey === key && previous === activeRegistration && current !== activeRegistration) {
                gone = true;
                resolveGone();
            }
        });
        const cleanupTarget = target.subscribeCdpEvents((eventMethod, raw) => {
            if (eventMethod !== "Target.detachedFromTarget" || !raw || typeof raw !== "object") return;
            if ((raw as { sessionId?: unknown }).sessionId !== sid) return;
            gone = true;
            resolveGone();
        });
        if (boardFrameRegistry.get(key) !== activeRegistration) {
            gone = true;
            resolveGone();
        }
        const command = activeRegistration.host.debugger.sendCommand(method, params, sid);
        const outcome = await Promise.race([
            command.then(value => ({ value }), error => ({ error })),
            goneSignal.then(() => ({ replaced: true as const })),
        ]);
        cleanupRegistration();
        cleanupTarget();
        if (!gone && "value" in outcome) return outcome.value;
        if (!gone && "error" in outcome) {
            // The cached session may be stale while the registration is unchanged (the frame
            // navigated in place) — re-resolve once and retry on a different session.
            if (attempt > 0) throw outcome.error;
            activeRegistration.sessionId = undefined;
            const freshSessionId = await resolveBoardSession(activeRegistration);
            if (!freshSessionId || freshSessionId === sid) throw outcome.error;
            sid = freshSessionId;
            continue;
        }
        // The cached session may be stale (frame reloaded/navigated) — re-resolve once.
        activeRegistration.sessionId = undefined;
        const replacementSessionId = await resolveReplacementSession(activeRegistration, sid);
        const replacement = boardFrameRegistry.get(key);
        if (!replacement || !replacementSessionId) throw new Error("Board frame was replaced but the replacement did not become ready within 5000 ms.");
        activeRegistration = replacement;
        sid = replacementSessionId;
    }
    throw new Error("Board frame was replaced before the command completed.");
}

export interface CdpServiceStartDependencies {
    getWebContents: (key: string) => WebContents | undefined;
    onAiVisionSignal: (webContents: WebContents, payload: string, executionContextId: number, mainContext: boolean) => void;
}

export function resolveTarget(
    key: string,
    sender: WebContents | undefined,
    scope: "all" | "browser-only" = "all",
): CdpFeatureTarget {
    if (scope === "all" && key === APP_WINDOW_CDP_KEY) {
        return { kind: "app", webContents: sender, cdp: sender ? CdpTarget.for(sender) : undefined, attach: attachTarget };
    }
    if (scope === "all") {
        const registration = boardFrameRegistry.get(key);
        if (registration) return {
            kind: "board",
            registration,
            webContents: registration.host,
            cdp: CdpTarget.for(registration.host),
            attach: attachTarget,
        };
    }
    const webContents = getWebContents?.(key);
    return { kind: "browser", webContents, cdp: webContents ? CdpTarget.for(webContents) : undefined, attach: attachTarget };
}

export function startCdpService(dependencies: CdpServiceStartDependencies): void {
    getWebContents = dependencies.getWebContents;
    onAiVisionSignalCallback = dependencies.onAiVisionSignal;
}

export const resolveNetworkResponseBodies = createNetworkResponseBodyResolver(
    cdpNetworkCollector.getNetworkCollector,
    cdpNetworkCollector.boundedResponseBody,
);

export const cdpService = {
    async getPageEvents(event: Electron.IpcMainInvokeEvent, key: string): Promise<PageEventsSnapshot> {
        return cdpPageEvents.getPageEvents(key, resolveTarget(key, event.sender), resolveBoardSession);
    },
    async markDialogReported(event: Electron.IpcMainInvokeEvent, key: string): Promise<void> {
        return cdpPageEvents.markDialogReported(key, resolveTarget(key, event.sender), resolveBoardSession);
    },
    async setDialogPolicy(event: Electron.IpcMainInvokeEvent, key: string, policy: PageDialogPolicy): Promise<PageDialogPolicy> {
        if (policy !== "accept" && policy !== "dismiss" && policy !== "manual") throw new Error("Dialog policy must be accept, dismiss, or manual.");
        return cdpPageEvents.setDialogPolicy(key, policy, resolveTarget(key, event.sender), resolveBoardSession);
    },
    async handleDialog(event: Electron.IpcMainInvokeEvent, key: string, accept: boolean, promptText?: string): Promise<void> {
        return cdpPageEvents.handleDialog(key, accept, promptText, resolveTarget(key, event.sender), resolveBoardSession);
    },
    async automationBegin(event: Electron.IpcMainInvokeEvent, key: string): Promise<void> {
        return cdpPageEvents.automationBegin(key, resolveTarget(key, event.sender), resolveBoardSession);
    },
    automationEnd(key: string): void { cdpPageEvents.automationEnd(key); },
    armNavigationWait(key: string, request: cdpWaits.NavigationWaitRequest) {
        return cdpWaits.armNavigationWait(key, request, () => resolveTarget(key, undefined, "browser-only"));
    },
    awaitNavigationWait(token: string) { return cdpWaits.awaitNavigationWait(token); },
    armResponseWait(event: Electron.IpcMainInvokeEvent, key: string, pattern: string | BrowserResponsePattern, options: BrowserResponseWaitOptions) {
        return cdpWaits.armResponseWait(key, pattern, options,
            () => resolveTarget(key, event.sender), resolveBoardSession);
    },
    awaitResponseWait(token: string) { return cdpWaits.awaitResponseWait(token); },
    ...cdpBrowserTestFeatures.createBrowserTestCdpMethods(resolveTarget, resolveBoardSession),
    async armDragIntercept(event: Electron.IpcMainInvokeEvent, key: string, sessionId?: string): Promise<string> {
        const route = resolveTarget(key, event.sender);
        await cdpPageEvents.getPageEvents(key, route, resolveBoardSession);
        const context = await cdpPageEvents.resolvePageEventsTarget(key, route, resolveBoardSession);
        return cdpDragIntercept.armDragIntercept({ ...context, isBoard: route.kind === "board" }, key, sessionId);
    },
    takeDragIntercept(token: string, waitMs: number) { return cdpDragIntercept.takeDragIntercept(token, waitMs); },
    ...cdpBrowserTestFeatures.createCdpLifecycleMethods(resolveTarget, resolveBoardSession, () => onAiVisionSignalCallback, clearTransientTargetState),
    async cdpSend(event: Electron.IpcMainInvokeEvent, key: string, method: string, params?: object, sessionId?: string) {
        const target = resolveTarget(key, event.sender);
        if (target.kind === "app") {
            const wc = target.webContents;
            if (!wc) throw new Error("App window is gone");
            if (wc.isDestroyed()) throw new Error("App window is gone");
            if (!target.cdp?.attached) { try { attachTarget(wc); } catch { throw new Error("Failed to attach CDP debugger"); } }
            return wc.debugger.sendCommand(method, params, sessionId);
        }
        if (target.kind === "board") return boardSend(target.registration, method, params, sessionId);
        const wc = target.webContents;
        if (!wc || wc.isDestroyed()) throw new Error("WebContents not found or destroyed");
        if (!target.cdp?.attached) { try { attachTarget(wc); } catch { throw new Error("Failed to attach CDP debugger"); } }
        const cdp = target.cdp ?? attachTarget(wc);
        await cdpBrowserTestFeatures.restoreBrowserTestTargetState(key, wc, target, resolveBoardSession);
        await cdpNetworkCollector.ensureNetworkCollector(key, wc, cdp);
        return wc.debugger.sendCommand(method, params, sessionId);
    },
};
