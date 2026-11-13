/**
 * Chrome DevTools Protocol session management for browser webviews and board frames.
 *
 * The service owns target resolution, debugger lifecycle composition, and the stable IPC facade.
 * CDP feature state and algorithms live in the feature modules under `cdp/`.
 */
import type { WebContents } from "electron";
import { boardFrameRegistry, type BoardFrameRegistration } from "./board-host/BoardFrameRegistry";
import {
    type CdpAttachOptions,
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

let getWebContents: ((key: string) => WebContents | undefined) | undefined;
let onAiVisionSignalCallback: ((webContents: WebContents, payload: string, executionContextId: number, mainContext: boolean) => void) | undefined;

export function clearCdpTargetState(key: string): void {
    cdpWaits.clearKey(key);
    cdpNetworkCollector.clearKey(key);
    cdpPageEvents.clearKey(key);
}

function attachTarget(wc: WebContents): CdpTarget {
    const target = CdpTarget.for(wc);
    if (!target.ensureAttached()) return target;
    cdpAiVisionBinding.onTargetAttached(wc);
    target.onDetached(() => {
        cdpAiVisionBinding.onTargetDetached(wc);
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
    if (reg.host.isDestroyed()) return undefined;
    attachTarget(reg.host);
    if (reg.sessionId) return reg.sessionId;
    const origin = `board://${reg.boardHost}`;
    const { targetInfos } = await reg.host.debugger.sendCommand("Target.getTargets");
    const iframes = (targetInfos || []).filter(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (t: any) => t.type === "iframe" && typeof t.url === "string" && t.url.startsWith(origin),
    );
    // Prefer the frame whose URL carries THIS registration's ?v= nonce — origin alone
    // is ambiguous when the same board is open in several tabs, or when a remount's old
    // frame briefly lingers. Fall back to the first same-origin frame only when
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

export interface CdpServiceStartDependencies {
    getWebContents: (key: string) => WebContents | undefined;
    onAiVisionSignal: (webContents: WebContents, payload: string, executionContextId: number, mainContext: boolean) => void;
}

function resolveTarget(
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
    async armDragIntercept(event: Electron.IpcMainInvokeEvent, key: string, sessionId?: string): Promise<string> {
        const route = resolveTarget(key, event.sender);
        await cdpPageEvents.getPageEvents(key, route, resolveBoardSession);
        const context = await cdpPageEvents.resolvePageEventsTarget(key, route, resolveBoardSession);
        return cdpDragIntercept.armDragIntercept({ ...context, isBoard: route.kind === "board" }, key, sessionId);
    },
    takeDragIntercept(token: string, waitMs: number) { return cdpDragIntercept.takeDragIntercept(token, waitMs); },
    async cdpAttach(event: Electron.IpcMainInvokeEvent, key: string, options?: CdpAttachOptions): Promise<boolean> {
        const target = resolveTarget(key, event.sender);
        if (target.kind === "app") {
            const wc = target.webContents;
            if (!wc || wc.isDestroyed()) return false;
            try { attachTarget(wc); return true; } catch { return false; }
        }
        if (target.kind === "board") {
            if (target.registration.host.isDestroyed()) return false;
            try { attachTarget(target.registration.host); return true; } catch { return false; }
        }
        const wc = target.webContents;
        if (!wc || wc.isDestroyed()) return false;
        const onAiVisionSignal = onAiVisionSignalCallback;
        if (options?.aiVisionBinding === true && !onAiVisionSignal) return false;
        try {
            attachTarget(wc);
            if (options?.aiVisionBinding === true && onAiVisionSignal) {
                await cdpAiVisionBinding.ensureAiVisionBinding(wc, target.attach, onAiVisionSignal);
            }
            return true;
        } catch { return false; }
    },
    async cdpDetach(key: string): Promise<void> {
        const target = resolveTarget(key, undefined);
        if (target.kind === "app") return;
        if (target.kind === "board") {
            target.registration.sessionId = undefined;
            clearCdpTargetState(key);
            return;
        }
        const wc = target.webContents;
        if (!wc || wc.isDestroyed() || !target.cdp?.attached) return;
        target.cdp.detach();
        cdpAiVisionBinding.clearAiVisionBinding(wc);
        clearCdpTargetState(key);
    },
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
        await cdpNetworkCollector.ensureNetworkCollector(key, wc, cdp);
        return wc.debugger.sendCommand(method, params, sessionId);
    },
};
