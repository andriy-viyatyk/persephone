import { PAGE_ZOOM_MIN, PAGE_ZOOM_MAX, PAGE_ZOOM_STEP } from "../../../shared/browser-zoom";
const { ipcRenderer } = require("electron");
import {
    BrowserChannel,
    BrowserEvent,
    BrowserPermissionPromptData,
} from "../../../ipc/browser-ipc";
import type { IAiHostSignal, IAiVisionShape } from "ai-vision";
import type { MenuItem } from "../../uikit/Menu";
import { app } from "../../api/app";
import { pagesModel } from "../../api/pages";
import { ui } from "../../api/ui";

import { globalPopupRateLimiter } from "../../../ipc/popup-rate-limiter";
import { browserUrlChanged, type BrowserUrlEvent } from "../../core/state/events";
import { DEFAULT_URL, type BrowserEditorModel } from "./BrowserEditorModel";
import { showBrowserContextMenu } from "./webview-context-menu";
import { agentMayAccessBrowserPage } from "./agent-access";
import { evaluateInTarget, ensureTargetReady } from "../../automation/operations";
import { tryParseJson } from "../../core/utils/parse-utils";
import { errMessage } from "../../../shared/utils";
import { t } from "../../../shared/i18n/t";
import { withTimeout } from "../../core/utils/utils";
import { api } from "../../../ipc/renderer/api";
import { fs } from "../../api/fs";
import { siteExtensionStore } from "../../api/site-extensions";
import type { SiteExtensionRecord } from "../../api/site-extensions";
import type { SiteExtensionReloadResult, SiteActionOutcome, SiteActionResult } from "../../api/types/site-extensions";
import { siteExtensionTrust, sameSiteExtensionHostSet } from "../../api/site-extension-trust";
import {
    logBrowserNavigated,
    logBrowserShapeChanged,
    logRemoteNotify,
} from "../../scripting/ai-vision/event-log";
import { validateSiteActions } from "../../../shared/site-extension-actions";
import type { SiteActionItem } from "../../../shared/site-extension-actions";
import { validateSiteActionResult } from "./site-extension-actions";
import { BrowserPageTranslationController } from "./BrowserPageTranslationController";

const AI_VISION_PROBE = `(() => {
    const site = window.__aiVision;
    const webmcp = window.__persephoneWebMcpRemote;
    const siteResult = site ? { shape: site.describe(), version: site.version } : null;
    const webmcpResult = webmcp ? { shape: webmcp.describe(), version: webmcp.version } : null;
    if (!siteResult && !webmcpResult?.shape) return null;
    return JSON.stringify({ site: siteResult, webmcp: webmcpResult?.shape ? webmcpResult : null });
})()`;
const MAX_AI_VISION_SHAPE_BYTES = 262_144;
const MAX_AI_VISION_NOTIFY_LENGTH = 512;
const AI_VISION_NOTIFY_LIMIT = 5;
const AI_VISION_NOTIFY_WINDOW_MS = 60_000;
/** A shape signal from a page with no registration probes at most this often per tab. */
const AI_VISION_LATE_PROBE_INTERVAL_MS = 1_000;

function stripExtensionErrorControls(message: string): string {
    return Array.from(message).filter((character) => {
        const code = character.charCodeAt(0);
        return !((code >= 0 && code <= 8)
            || code === 11
            || code === 12
            || (code >= 14 && code <= 31)
            || (code >= 127 && code <= 159));
    }).join("");
}

function boundExtensionError(message: string): string {
    const sanitized = stripExtensionErrorControls(message);
    return sanitized.length > 512 ? `${sanitized.slice(0, 511)}…` : sanitized;
}

function pageExtensionError(message: string): string {
    const labelled = `Page-derived extension error: ${stripExtensionErrorControls(message)}`;
    return labelled.length > 512 ? `${labelled.slice(0, 511)}…` : labelled;
}

/**
 * Manages webview references, IPC event handling, context menu,
 * and keyboard shortcuts for the browser editor.
 */
export class BrowserWebviewModel {
    readonly model: BrowserEditorModel;
    /** Map from internal tab ID to webview element. */
    webviewRefs = new Map<string, Electron.WebviewTag>();
    /** Set of internalTabIds whose webview has fired dom-ready. */
    webviewReady = new Set<string>();
    private readonly loadedWaiters = new Map<string, Set<() => void>>();

    waitForLoaded(id: string): Promise<void> {
        if (this.webviewReady.has(id)) return Promise.resolve();
        return new Promise((resolve) => {
            const waiters = this.loadedWaiters.get(id) ?? new Set<() => void>();
            this.loadedWaiters.set(id, waiters);
            const finish = (): void => {
                clearTimeout(timer);
                waiters.delete(finish);
                if (!waiters.size) this.loadedWaiters.delete(id);
                resolve();
            };
            const timer = setTimeout(finish, 5000);
            waiters.add(finish);
        });
    }
    clearLoadedWaiters(id: string): void {
        for (const resolve of this.loadedWaiters.get(id) ?? []) resolve();
    }
    markLoaded(id: string): void {
        this.webviewReady.add(id);
        this.clearLoadedWaiters(id);
    }

    /** When true, rate limiting is disabled (user clicked "Allow"). */
    popupsAllowed = false;

    /** Tracks the previous active tab URL for navigation change detection. */
    private prevActiveUrl = "";
    private readonly warnedAiVisionShapes = new Set<string>();
    private readonly probedAiVisionGenerations = new Set<string>();
    private readonly aiVisionNotifyTimes: number[] = [];
    private readonly lateAiVisionProbeTimes = new Map<string, number>();
    private readonly lateAiVisionProbeTimers = new Map<string, ReturnType<typeof setTimeout>>();
    /** The shape a refresh() replaced, per tab, keyed to the generation its re-probe runs at.
     *  `shape-changed` is logged only when that probe finds a different shape, or none. */
    private readonly pendingShapeComparisons = new Map<string, { generation: number; shape: string }>();
    /** Whether the tab had a live model when its latest load started. Chromium fires
     *  `did-start-loading` (which clears the registration) before `did-navigate-in-page`, even
     *  for a same-document navigation, so the registration alone cannot answer "was it live". */
    private readonly liveModelAtLoadStart = new Map<string, boolean>();
    private readonly dismissedExtensionPrompts = new Set<string>();
    /** Cross-document navigation count per tab: the document identity for site-extension
     *  prompts and injection. Not the AiVision generation, which also advances whenever a probe
     *  finds no model (always, on a page whose extension is still untrusted). */
    private readonly siteDocuments = new Map<string, number>();
    private readonly injectedSiteExtensions = new Map<string, { documentId: number; name: string }>();
    private readonly actionDocuments = new Map<string, {
        documentId: number; host: string; id: string; hosts: string[]; fetchHosts: string[]; contextId?: number;
        fetchKey: string; fetchRequests: Set<number>;
        injected: boolean; items: SiteActionItem[]; running: boolean; runVersion: number; lastPublish: number;
        pending?: SiteActionItem[]; timer?: ReturnType<typeof setTimeout>; cancelRun?: () => void;
    }>();
    private readonly actionChoices = new Map<string, { tabId: string; document: object; expires: number; runVersion: number; items: Extract<SiteActionResult, { kind: "video" }> ["items"] }>();
    private readonly pageTranslations = new Map<string, BrowserPageTranslationController>();
    private translationLifecycle: ((internalTabId: string) => void) | undefined;

    setTranslationLifecycle(callback: (internalTabId: string) => void): void {
        this.translationLifecycle = callback;
    }

    /** Script and toolbar entry points for the current page's translation lifecycle. */
    startPageTranslation = async (from: string, to: string, internalTabId = this.model.state.get().activeTabId): Promise<void> => {
        await this.translationController(internalTabId).start(from, to);
    };
    stopPageTranslation = (internalTabId = this.model.state.get().activeTabId): Promise<void> =>
        this.pageTranslations.get(internalTabId)?.stop() ?? Promise.resolve();
    endPageTranslation = (internalTabId: string): void => {
        const controller = this.pageTranslations.get(internalTabId);
        if (controller) void controller.stop(true);
    };
    getPageTranslationState = (internalTabId = this.model.state.get().activeTabId) =>
        this.pageTranslations.get(internalTabId)?.state ?? { active: false, from: "", to: "", pendingCount: 0, doneCount: 0, failedCount: 0 };
    subscribePageTranslationState = (internalTabId: string, listener: () => void): (() => void) =>
        this.translationController(internalTabId).subscribe(listener);
    handleTranslationFrame = (tabId: string, frameId: [number, number], kind: "translation-ready" | "translation-units", payload: unknown): void => {
        this.translationController(tabId).handleFrame(frameId, kind, payload);
    };
    private translationController(tabId: string): BrowserPageTranslationController {
        let controller = this.pageTranslations.get(tabId);
        if (!controller) { controller = new BrowserPageTranslationController(tabId, () => this.webviewRefs.get(tabId)); this.pageTranslations.set(tabId, controller); }
        return controller;
    }

    siteDocumentId(internalTabId: string): number {
        return this.siteDocuments.get(internalTabId) ?? 0;
    }

    getAiVisionSiteExtensionName(internalTabId: string): string | undefined {
        const marker = this.injectedSiteExtensions.get(internalTabId);
        return marker?.documentId === this.siteDocumentId(internalTabId) ? marker.name : undefined;
    }

    clearAiVisionSiteExtension(internalTabId: string): void {
        const actions = this.actionDocuments.get(internalTabId);
        if (actions?.timer) clearTimeout(actions.timer);
        actions?.cancelRun?.();
        if (actions) {
            void api.cancelSiteExtensionFetches(actions.fetchKey).catch((): undefined => undefined);
            if (actions.contextId !== undefined) for (const id of actions.fetchRequests) {
                const response = JSON.stringify({ id, error: "Fetch cancelled" });
                void this.model.target.cdp(internalTabId).send("Runtime.evaluate", {
                    expression: `window.__persephoneSiteRuntime?.resolveFetch(${response})`,
                    contextId: actions.contextId, returnByValue: true,
                }).catch((): undefined => undefined);
            }
            actions.fetchRequests.clear();
        }
        this.actionDocuments.delete(internalTabId);
        for (const [token, choice] of this.actionChoices) if (choice.tabId === internalTabId) this.actionChoices.delete(token);
        if (this.injectedSiteExtensions.delete(internalTabId) || actions) this.model.notifyAiVisionIndicatorChanged();
    }

    dispose(): void {
        for (const controller of this.pageTranslations.values()) controller.dispose();
        this.pageTranslations.clear();
        for (const internalTabId of new Set([...this.injectedSiteExtensions.keys(), ...this.actionDocuments.keys()])) this.clearAiVisionSiteExtension(internalTabId);
    }

    private setAiVisionSiteExtension(internalTabId: string, documentId: number, name: string): void {
        const previous = this.injectedSiteExtensions.get(internalTabId);
        if (previous?.documentId === documentId && previous.name === name) return;
        this.injectedSiteExtensions.set(internalTabId, { documentId, name });
        this.model.notifyAiVisionIndicatorChanged();
    }

    constructor(model: BrowserEditorModel) {
        this.model = model;
    }

    /** Get the active tab's webview element. */
    getActiveWebview = (): Electron.WebviewTag | undefined => {
        const { activeTabId } = this.model.state.get();
        return this.webviewRefs.get(activeTabId);
    };

    goBack = () => {
        this.getActiveWebview()?.goBack();
    };

    goForward = () => {
        this.getActiveWebview()?.goForward();
    };

    reloadOrStop = () => {
        const wv = this.getActiveWebview();
        if (!wv) return;
        if (this.model.state.get().loading) {
            this.resetTranslationForReload();
            wv.stop();
        } else {
            this.resetTranslationForReload();
            this.clearAiVisionSiteExtension(this.model.state.get().activeTabId);
            wv.reload();
        }
    };

    /** Hard reload (ignore cache) the active tab, bypassing any beforeunload
     *  guard prompt. Routed through the main process so the bypass flag is
     *  armed atomically with the reload (see browser-service.ts). */
    hardReload = () => {
        const { activeTabId } = this.model.state.get();
        if (!this.webviewRefs.has(activeTabId)) return;
        this.resetTranslationForReload(activeTabId);
        this.clearAiVisionSiteExtension(activeTabId);
        ipcRenderer.send(
            BrowserChannel.hardReload,
            `${this.model.id}/${activeTabId}`,
        );
    };

    openDevTools = () => {
        this.getActiveWebview()?.openDevTools();
    };

    /** Handle keyboard shortcuts on the root browser div (Ctrl+L, Ctrl+F). */
    handleKeyDown = (e: KeyboardEvent) => {
        if (e.ctrlKey && e.key === "l") {
            e.preventDefault();
            this.model.urlBar.focusUrlInput();
        }
        // `key` is "F" under Shift or Caps Lock, and a missed match leaves the
        // shortcut dead rather than opening the find bar.
        if (e.ctrlKey && e.key.toLowerCase() === "f") {
            e.preventDefault();
            this.openFind();
        }
    };

    // =====================================================================
    // Find in Page
    // =====================================================================

    openFind = () => {
        this.model.state.update((s) => { s.findBarVisible = true; });
    };

    closeFind = () => {
        const webview = this.getActiveWebview();
        webview?.stopFindInPage("clearSelection");
        this.model.state.update((s) => {
            s.findBarVisible = false;
            s.findText = "";
            s.findActiveMatch = 0;
            s.findTotalMatches = 0;
        });
    };

    setFindText = (text: string) => {
        this.model.state.update((s) => { s.findText = text; });
        const webview = this.getActiveWebview();
        if (!webview) return;
        if (text) {
            // Electron's `findNext` means "begin a new find session" — true for changed text,
            // false for stepping through the matches of the current one.
            webview.findInPage(text, { findNext: true });
        } else {
            webview.stopFindInPage("clearSelection");
            this.model.state.update((s) => {
                s.findActiveMatch = 0;
                s.findTotalMatches = 0;
            });
        }
    };

    findNext = () => {
        const { findText } = this.model.state.get();
        if (!findText) return;
        const webview = this.getActiveWebview();
        webview?.findInPage(findText, { forward: true, findNext: false });
    };

    findPrev = () => {
        const { findText } = this.model.state.get();
        if (!findText) return;
        const webview = this.getActiveWebview();
        webview?.findInPage(findText, { forward: false, findNext: false });
    };

    handleFoundInPage = (result: Electron.FoundInPageResult) => {
        if (result.finalUpdate) {
            this.model.state.update((s) => {
                s.findActiveMatch = result.activeMatchOrdinal - 1;
                s.findTotalMatches = result.matches;
            });
        }
    };

    /**
     * Navigate the active tab's webview when the tab URL changes.
     * Called from the view's update path when activeTab.url changes.
     */
    navigateWebview = (activeTabId: string, url: string) => {
        if (url !== this.prevActiveUrl) {
            const webview = this.webviewRefs.get(activeTabId);
            if (webview && this.webviewReady.has(activeTabId)) {
                const actualUrl = this.model.tabs.currentUrls.get(activeTabId) || "";
                if (actualUrl !== url) {
                    // A failed load (e.g. ERR_NAME_NOT_RESOLVED) is shown by the webview's own
                    // error page and reported to automation by the navigation wait; the promise
                    // rejection itself must not surface as an unhandled-rejection alert.
                    webview.loadURL(url).catch((): void => undefined);
                }
            }
        }
        this.prevActiveUrl = url;
    };

    // =====================================================================
    // IPC Event Handler
    // =====================================================================

    /** Set up the global IPC event listener during view mount. */
    initIpcHandler = () => {
        ipcRenderer.on(BrowserChannel.event, this.handleBrowserEvent);
    };

    /** Remove the global IPC event listener during view disposal. */
    disposeIpcHandler = () => {
        ipcRenderer.removeListener(BrowserChannel.event, this.handleBrowserEvent);
        for (const timer of this.lateAiVisionProbeTimers.values()) clearTimeout(timer);
        this.lateAiVisionProbeTimers.clear();
        this.pendingShapeComparisons.clear();
        this.liveModelAtLoadStart.clear();
    };

    /** Reload the active page even while it is loading. */
    reload = () => {
        this.resetTranslationForReload();
        this.getActiveWebview()?.reload();
    };

    private resetTranslationForReload(internalTabId = this.model.state.get().activeTabId): void {
        void this.stopPageTranslation(internalTabId);
        this.translationLifecycle?.(internalTabId);
    }

    resolvePermissionRequest = (requestId: string, decision: "allow" | "block") => {
        void ipcRenderer.invoke(BrowserChannel.resolvePermissionRequest, { requestId, decision });
    };

    /** Apply shared state updates for full and in-page navigation events. */
    private applyNavigation = (
        internalTabId: string,
        data: { url?: string; canGoBack?: boolean; canGoForward?: boolean },
        inPage: boolean,
    ) => {
        const previousUrl = this.model.tabs.currentUrls.get(internalTabId);
        const url = data.url || "";
        this.model.tabs.currentUrls.set(internalTabId, url);
        if (internalTabId === this.model.state.get().activeTabId) {
            this.model.urlBar.syncFromUrl(url);
            if (!inPage && this.model.state.get().findBarVisible) this.closeFind();
        }
        this.model.updateTab(internalTabId, {
            url: data.url,
            canGoBack: data.canGoBack,
            canGoForward: data.canGoForward,
            ...(!inPage ? { favicon: this.model.tabs.getCachedFavicon(url) } : {}),
        });
        let handled = false;
        if (data.url) {
            const event: BrowserUrlEvent = { url: data.url };
            browserUrlChanged.send(event);
            handled = !!event.handled;
            if (handled) this.restoreClaimedNavigation(internalTabId, previousUrl, data.canGoBack);
        }
        if (!handled) this.model.addNavHistory(internalTabId, url);
        if (!inPage) this.model.bookmarksUI.shiftTrackedImages(internalTabId);
    };

    private restoreClaimedNavigation(
        internalTabId: string,
        previousUrl: string | undefined,
        reportedCanGoBack: boolean | undefined,
    ): void {
        if (!this.model.state.get().tabs.some((tab) => tab.id === internalTabId)) return;
        const webview = this.webviewRefs.get(internalTabId);
        if (webview && this.webviewReady.has(internalTabId)) {
            let canGoBack = !!reportedCanGoBack;
            try {
                canGoBack = webview.canGoBack();
            } catch {
                canGoBack = false;
            }
            if (canGoBack) {
                webview.goBack();
                return;
            }
            if (previousUrl) {
                webview.loadURL(previousUrl).catch((): void => undefined);
                return;
            }
            webview.loadURL(DEFAULT_URL).catch((): void => undefined);
            return;
        }
        const safeUrl = previousUrl || DEFAULT_URL;
        this.model.tabs.currentUrls.set(internalTabId, safeUrl);
        this.model.updateTab(internalTabId, { url: safeUrl });
    }

    setTabZoom = (internalTabId: string, zoomPercent: number): void => {
        if (!Number.isFinite(zoomPercent) || zoomPercent < PAGE_ZOOM_MIN || zoomPercent > PAGE_ZOOM_MAX) return;
        if (!this.model.state.get().tabs.some((tab) => tab.id === internalTabId)) return;
        this.model.updateTab(internalTabId, { zoomPercent });
        void ipcRenderer.invoke(BrowserChannel.setZoom, { registrationKey: `${this.model.id}/${internalTabId}`, zoomPercent });
    };

    private handleBrowserEvent = async (
        _event: Electron.IpcRendererEvent,
        browserEvent: BrowserEvent,
    ) => {
        const pageTabId = this.model.id;
        if (browserEvent.tabId !== pageTabId) return;
        const { internalTabId, type, data } = browserEvent;

        switch (type) {
            case "zoom-intent": {
                const tab = this.model.state.get().tabs.find((item) => item.id === internalTabId);
                if (!tab || !data.zoomIntent) break;
                const value = data.zoomIntent === "reset" ? 100 : Math.max(PAGE_ZOOM_MIN, Math.min(PAGE_ZOOM_MAX, tab.zoomPercent + (data.zoomIntent === "in" ? PAGE_ZOOM_STEP : -PAGE_ZOOM_STEP)));
                this.setTabZoom(internalTabId, value);
                break;
            }
            case "did-navigate": {
                this.endPageTranslation(internalTabId);
                this.translationLifecycle?.(internalTabId);
                const touched = this.model.hasAiVisionRegisteredTab(internalTabId);
                this.model.clearAiVisionRegistration(internalTabId);
                this.pendingShapeComparisons.delete(internalTabId);
                this.liveModelAtLoadStart.delete(internalTabId);
                this.clearAiVisionSiteExtension(internalTabId);
                this.siteDocuments.set(internalTabId, this.siteDocumentId(internalTabId) + 1);
                this.model.clearSiteExtensionTrustPrompt(internalTabId);
                for (const key of this.dismissedExtensionPrompts) {
                    if (key.startsWith(`${internalTabId}:`)) this.dismissedExtensionPrompts.delete(key);
                }
                this.applyNavigation(internalTabId, data, false);
                if (touched && data.url !== DEFAULT_URL && this.model.page?.id) {
                    logBrowserNavigated(this.model.page.id);
                }
                break;
            }
            case "did-navigate-in-page": {
                this.applyNavigation(internalTabId, data, true);
                // Under a live model the model is the agent's view of the page; it refreshes
                // itself, so a same-document route change is not worth an event.
                const modelWasLive = !!this.model.getAiVisionRegistration(internalTabId)
                    || this.liveModelAtLoadStart.get(internalTabId) === true;
                if (this.model.hasAiVisionRegisteredTab(internalTabId)
                    && !modelWasLive
                    && data.url !== DEFAULT_URL && this.model.page?.id) {
                    logBrowserNavigated(this.model.page.id);
                }
                break;
            }
            case "did-start-loading":
                this.liveModelAtLoadStart.set(internalTabId, !!this.model.getAiVisionRegistration(internalTabId));
                // The injected-extension marker is not cleared here: did-start-loading also fires
                // for frame and same-document loads, where the injected script keeps running. A new
                // document arrives through did-navigate, which clears it and bumps siteDocumentId.
                this.model.clearAiVisionRegistration(internalTabId);
                this.pendingShapeComparisons.delete(internalTabId);
                this.model.updateTab(internalTabId, { loading: true });
                break;
            case "did-stop-loading":
                this.model.updateTab(internalTabId, { loading: false });
                if (!agentMayAccessBrowserPage(this.model.state.get())) {
                    this.model.clearAiVisionRegistration(internalTabId);
                    break;
                }
                void this.probeAiVision(internalTabId);
                break;
            case "audio-state-changed":
                this.model.updateTab(internalTabId, { audible: !!data.audible });
                break;
            case "did-start-navigation": {
                if (data.isMainFrame && !data.isSameDocument) this.clearAiVisionSiteExtension(internalTabId);
                this.model.state.update((state) => {
                    state.permissionPrompts = state.permissionPrompts.filter((item) => item.internalTabId !== internalTabId);
                });
                if (data.blocked) {
                    const webview = this.webviewRefs.get(internalTabId);
                    const tabData = this.model.state
                        .get()
                        .tabs.find((t) => t.id === internalTabId);
                    if (webview && tabData && tabData.url !== data.url) {
                        webview.goBack();
                    }
                }
                break;
            }
            case "new-window": {
                if (data.url) {
                    if (!this.popupsAllowed && !globalPopupRateLimiter.check("tabs")) {
                        this.model.state.update((s) => { s.blockedPopupCount++; });
                        break;
                    }
                    const parentTab = this.model.state.get().tabs.find((t) => t.id === internalTabId);
                    const newInternalTabId = this.model.addTab(data.url, parentTab?.groupId);
                    const event: BrowserUrlEvent = { url: data.url };
                    browserUrlChanged.send(event);
                    if (event.handled) this.model.closeTab(newInternalTabId);
                }
                break;
            }
            case "popups-blocked": {
                this.model.state.update((s) => { s.blockedPopupCount++; });
                break;
            }
            case "permission-request": {
                const prompt = data.permissionRequest as BrowserPermissionPromptData | undefined;
                if (prompt && this.model.state.get().tabs.some((tab) => tab.id === internalTabId)) {
                    this.model.state.update((state) => {
                        if (!state.permissionPrompts.some((item) => item.requestId === prompt.requestId)) {
                            state.permissionPrompts.push({ ...prompt, internalTabId });
                        }
                    });
                }
                break;
            }
            case "show-find-bar":
                this.openFind();
                break;
            case "hide-find-bar":
                if (this.model.state.get().findBarVisible) {
                    this.closeFind();
                }
                break;
            case "ai-vision-signal":
                this.handleAiVisionSignal(internalTabId, data);
                break;
            case "context-menu": {
                const webview = this.webviewRefs.get(internalTabId);
                if (!webview) break;
                await this.handleContextMenu(webview, internalTabId, data);
                break;
            }
        }
    };

    /** Called from `dom-ready`, for a tab whose document finished loading before its load events
     *  could reach this model (a session restore). Same gate and same per-generation dedupe as the
     *  `did-stop-loading` path, so a tab probed by either route is not probed twice. */
    probeAiVisionOnReady(internalTabId: string): void {
        if (!agentMayAccessBrowserPage(this.model.state.get())) return;
        void this.probeAiVision(internalTabId);
    }

    /** Inject the valid site extension for this document's exact HTTPS host, then probe for its model. */
    async injectSiteExtension(internalTabId: string): Promise<void> {
        await siteExtensionTrust.load().catch((): undefined => undefined);
        const state = this.model.state.get();
        if (state.isIncognito || state.isTor) return;
        const webview = this.webviewRefs.get(internalTabId);
        if (!webview) return;
        let pageUrl: URL;
        try {
            pageUrl = new URL(webview.getURL());
        } catch {
            return;
        }
        if (pageUrl.protocol !== "https:") return;
        const documentId = this.siteDocumentId(internalTabId);
        const extension = await siteExtensionStore.findForHost(pageUrl.hostname).catch((): undefined => undefined);
        if (!extension) return;

        if (!this.isCurrentDocument(internalTabId, documentId, pageUrl.hostname)) return;
        const grant = siteExtensionTrust.get(extension.id);
        const hostsMatch = !!grant && (sameSiteExtensionHostSet(grant.hosts, extension.hosts) && sameSiteExtensionHostSet(grant.fetchHosts, extension.fetchHosts));
        if (grant?.enabled && hostsMatch) {
            await this.injectTrustedExtensionIntoCurrentDocument(internalTabId, extension, documentId);
            return;
        }
        if (grant && !grant.enabled) return;
        const promptKey = `${internalTabId}:${documentId}`;
        if (!this.dismissedExtensionPrompts.has(promptKey)) {
            this.model.setSiteExtensionTrustPrompt({ internalTabId, documentId, id: extension.id, name: extension.name, host: pageUrl.hostname, hosts: [...extension.hosts], fetchHosts: [...extension.fetchHosts], available: true });
        }
    }

    /**
     * Trust the extension a bar shows, for that bar's document only. Used by the bar's Trust button
     * and by the agent facade. `changed`: the manifest changed since the bar appeared,
     * so the bar now shows the new name/hosts and nothing was granted. `unavailable`: the
     * extension is gone or invalid. `not-current`: no such bar, or the document changed.
     */
    async trustSiteExtensionPrompt(internalTabId: string, documentId: number): Promise<"trusted" | "changed" | "unavailable" | "not-current"> {
        const prompt = this.model.state.get().siteExtensionTrustPrompts.find((item) => item.internalTabId === internalTabId && item.documentId === documentId);
        if (!prompt || !this.isCurrentDocument(internalTabId, documentId, prompt.host)) return "not-current";
        if (!prompt.available) return "unavailable";
        const current = await siteExtensionStore.findForHost(prompt.host).catch((): undefined => undefined);
        if (!this.isCurrentDocument(internalTabId, documentId, prompt.host)) return "not-current";
        if (!current || current.id !== prompt.id || (!sameSiteExtensionHostSet(current.hosts, prompt.hosts) || !sameSiteExtensionHostSet(current.fetchHosts, prompt.fetchHosts))) {
            if (current) this.model.setSiteExtensionTrustPrompt({ internalTabId, documentId, id: current.id, name: current.name, host: prompt.host, hosts: [...current.hosts], fetchHosts: [...current.fetchHosts], available: true });
            else this.model.setSiteExtensionTrustPrompt({ ...prompt, available: false });
            return current ? "changed" : "unavailable";
        }
        await siteExtensionTrust.trust(current.id, prompt.hosts, prompt.fetchHosts);
        if (!this.isCurrentDocument(internalTabId, documentId, prompt.host)) return "trusted";
        this.model.clearSiteExtensionTrustPrompt(internalTabId, documentId);
        await this.injectTrustedExtensionIntoCurrentDocument(internalTabId, current, documentId);
        return "trusted";
    }

    dismissSiteExtensionTrustPrompt(internalTabId: string, documentId: number): void {
        this.dismissedExtensionPrompts.add(`${internalTabId}:${documentId}`);
        this.model.clearSiteExtensionTrustPrompt(internalTabId, documentId);
    }

    private isCurrentDocument(internalTabId: string, documentId: number, host: string): boolean {
        if (this.siteDocumentId(internalTabId) !== documentId) return false;
        const webview = this.webviewRefs.get(internalTabId);
        if (!webview) return false;
        try {
            const current = new URL(webview.getURL());
            return current.protocol === "https:" && current.hostname === host;
        } catch { return false; }
    }

    /** Re-inject the trusted extension into only the active, current browser document. */
    async reloadSiteExtension(): Promise<SiteExtensionReloadResult> {
        const internalTabId = this.model.state.get().activeTabId;
        const documentId = this.siteDocumentId(internalTabId);
        const currentHost = (): string | undefined => {
            if (this.model.state.get().isIncognito || this.model.state.get().isTor) return undefined;
            const webview = this.webviewRefs.get(internalTabId);
            if (!webview || !this.webviewReady.has(internalTabId)) return undefined;
            try {
                const pageUrl = new URL(webview.getURL());
                return pageUrl.protocol === "https:" ? pageUrl.hostname : undefined;
            } catch { return undefined; }
        };
        const isCurrent = (host: string): boolean => this.model.state.get().activeTabId === internalTabId
            && this.webviewReady.has(internalTabId)
            && !this.model.state.get().isIncognito
            && !this.model.state.get().isTor
            && this.isCurrentDocument(internalTabId, documentId, host);
        const notCurrent = (): SiteExtensionReloadResult => ({ status: "not-current", registered: false });

        const host = currentHost();
        if (!host || !isCurrent(host)) return notCurrent();
        await siteExtensionTrust.load().catch((): undefined => undefined);
        if (!isCurrent(host)) return notCurrent();

        let extension = await siteExtensionStore.findForHost(host).catch((): undefined => undefined);
        if (!isCurrent(host)) return notCurrent();
        if (!extension) return { status: "no-extension", registered: false };
        let grant = siteExtensionTrust.get(extension.id);
        if (grant && !grant.enabled) return { status: "disabled", registered: false };
        if (!grant || !(sameSiteExtensionHostSet(grant.hosts, extension.hosts) && sameSiteExtensionHostSet(grant.fetchHosts, extension.fetchHosts))) {
            this.showExtensionTrustPrompt(internalTabId, documentId, extension, host);
            return { status: "waiting-for-user", registered: false };
        }

        const webview = this.webviewRefs.get(internalTabId);
        if (!webview || !this.webviewReady.has(internalTabId) || !isCurrent(host)) return notCurrent();
        try {
            const cdp = this.model.target.cdp(internalTabId);
            if (!await cdp.attach({ aiVisionBinding: true })) return notCurrent();
            if (!isCurrent(host)) return notCurrent();
            await ensureTargetReady(this.model.target, internalTabId);
            if (!isCurrent(host)) return notCurrent();

            // Refresh the inventory and trust immediately before teardown; no failed gate may
            // dispose code that is already running in this document.
            const currentExtension = await siteExtensionStore.findForHost(host);
            if (!isCurrent(host)) return notCurrent();
            if (!currentExtension) return { status: "no-extension", registered: false };
            extension = currentExtension;
            grant = siteExtensionTrust.get(extension.id);
            if (grant && !grant.enabled) return { status: "disabled", registered: false };
            if (!grant || !(sameSiteExtensionHostSet(grant.hosts, currentExtension.hosts) && sameSiteExtensionHostSet(grant.fetchHosts, currentExtension.fetchHosts))) {
                this.showExtensionTrustPrompt(internalTabId, documentId, extension, host);
                return { status: "waiting-for-user", registered: false };
            }

            const teardown = `(() => {
    if (location.protocol !== "https:" || location.hostname !== ${JSON.stringify(host)}) return "host-mismatch";
    window.__persephoneSiteRuntime?.dispose?.();
    delete window.__persephoneSiteExtension;
    return "ok";
})()`;
            this.clearAiVisionSiteExtension(internalTabId);
            const teardownResult = await evaluateInTarget(this.model.target, teardown, internalTabId);
            if (!isCurrent(host)) return notCurrent();
            if (String(teardownResult) !== "ok") return notCurrent();

            this.clearAiVisionSiteExtension(internalTabId);
            this.model.clearAiVisionRegistration(internalTabId);
            // The reload is an explicit request: its model's first refresh() must not be held back
            // by the late-probe interval from the previous script.
            this.lateAiVisionProbeTimes.delete(internalTabId);
            const generation = this.model.getAiVisionDocumentGeneration(internalTabId);
            if (generation === undefined || !isCurrent(host)) return notCurrent();

            const injection = await this.injectTrustedExtensionIntoCurrentDocument(internalTabId, extension, documentId, false);
            if (!isCurrent(host)) return notCurrent();
            if (injection.status !== "injected") {
                return injection.status === "extension-error"
                    ? { status: "extension-error", registered: false, error: injection.error }
                    : notCurrent();
            }

            const deadline = Date.now() + 3_000;
            this.probedAiVisionGenerations.delete(`${internalTabId}:${generation}`);
            await withTimeout(this.probeAiVision(internalTabId), Math.max(0, deadline - Date.now()), undefined);
            if (!isCurrent(host)) return notCurrent();
            // A probe that finds no model yet advances the generation, so a late model registers
            // under a newer one. Navigation is excluded by isCurrent(), so any registration from
            // the captured generation onward belongs to this reload.
            const registeredSinceReload = (): boolean => {
                const registration = this.model.getAiVisionRegistration(internalTabId);
                return registration !== undefined && registration.generation >= generation;
            };
            while (Date.now() < deadline) {
                if (registeredSinceReload()) return { status: "injected", registered: true };
                await new Promise<void>((resolve) => setTimeout(resolve, Math.min(50, deadline - Date.now())));
                if (!isCurrent(host)) return notCurrent();
            }
            return { status: "injected", registered: registeredSinceReload() };
        } catch (error) {
            if (!isCurrent(host)) return notCurrent();
            return { status: "extension-error", registered: false, error: boundExtensionError(errMessage(error, "Extension reload failed.")) };
        }
    }

    private showExtensionTrustPrompt(
        internalTabId: string,
        documentId: number,
        extension: SiteExtensionRecord,
        host: string,
    ): void {
        const promptKey = `${internalTabId}:${documentId}`;
        if (this.dismissedExtensionPrompts.has(promptKey)) return;
        this.model.setSiteExtensionTrustPrompt({
            internalTabId,
            documentId,
            id: extension.id,
            name: extension.name,
            host,
            hosts: [...extension.hosts],
            fetchHosts: [...extension.fetchHosts],
            available: true,
        });
    }

    private async injectTrustedExtensionIntoCurrentDocument(
        internalTabId: string,
        extension: SiteExtensionRecord,
        documentId: number,
        probeAfterInjection = true,
    ): Promise<{ status: "injected" } | { status: "not-current" } | { status: "extension-error"; error: string }> {
        const webview = this.webviewRefs.get(internalTabId);
        if (!webview || this.model.state.get().isIncognito || this.model.state.get().isTor) return { status: "not-current" };
        let pageUrl: URL;
        try { pageUrl = new URL(webview.getURL()); } catch { return { status: "not-current" }; }
        const isAllowed = (): boolean => {
            const grant = siteExtensionTrust.get(extension.id);
            const state = this.model.state.get();
            return !state.isIncognito && !state.isTor && !!grant?.enabled
                && (sameSiteExtensionHostSet(grant.hosts, extension.hosts) && sameSiteExtensionHostSet(grant.fetchHosts, extension.fetchHosts))
                && extension.hosts.includes(pageUrl.hostname)
                && this.isCurrentDocument(internalTabId, documentId, pageUrl.hostname);
        };
        if (pageUrl.protocol !== "https:" || !isAllowed()) return { status: "not-current" };

        let expression: string;
        try {
            const [source, runtime] = await Promise.all([
                fs.read(extension.scriptPath),
                api.getSiteExtensionRuntime(),
            ]);
            if (!isAllowed()) return { status: "not-current" };
            expression = `(() => {
    const host = ${JSON.stringify(pageUrl.hostname)};
    if (location.protocol !== "https:" || location.hostname !== host) return "host-mismatch";
    if (window.__persephoneSiteExtension) return "already-injected";
    Object.defineProperty(window, "__persephoneSiteExtension", {
        value: { id: ${JSON.stringify(extension.id)}, host }, enumerable: false, configurable: true,
    });
${runtime}
    try {
${source}
    } catch (error) {
        // Keep a page-console diagnostic while returning a bounded message to the agent.
        console.error("[site-extension] " + ${JSON.stringify(extension.id)} + ":", error);
        let message = "Unknown page error";
        try {
            message = error && typeof error === "object" && typeof error.message === "string"
                ? error.message
                : String(error);
        } catch { /* retain the safe fallback */ }
        return "extension-error:" + message;
    }
    return "ok";
})()`;
        } catch (error) {
            console.warn(`[site-extension] ${extension.id}: extension files could not be read`);
            return { status: "extension-error", error: boundExtensionError(`Extension files could not be read: ${errMessage(error, "read failed")}`) };
        }

        if (!isAllowed()) return { status: "not-current" };

        let result: unknown;
        let actionDocument: NonNullable<ReturnType<typeof this.actionDocuments.get>> | undefined;
        const clearOwnActions = (): void => {
            if (actionDocument && this.actionDocuments.get(internalTabId) === actionDocument) this.clearAiVisionSiteExtension(internalTabId);
        };
        try {
            const cdp = this.model.target.cdp(internalTabId);
            if (!await cdp.attach({ aiVisionBinding: true })) {
                console.warn(`[site-extension] ${extension.id}: CDP attach failed`);
                return { status: "not-current" };
            }
            if (!isAllowed()) return { status: "not-current" };
            await ensureTargetReady(this.model.target, internalTabId);
            if (!isAllowed()) return { status: "not-current" };
            const existing = this.actionDocuments.get(internalTabId);
            if (existing && this.isActionDocumentCurrent(internalTabId, existing, false)) {
                return existing.injected ? { status: "injected" } : { status: "not-current" };
            }
            this.clearAiVisionSiteExtension(internalTabId);
            actionDocument = { documentId, host: pageUrl.hostname, id: extension.id, hosts: [...extension.hosts], fetchHosts: [...extension.fetchHosts], fetchKey: `${this.model.id}/${internalTabId}`, fetchRequests: new Set(), injected: false, items: [], running: false, runVersion: 0, lastPublish: 0 };
            this.actionDocuments.set(internalTabId, actionDocument);
            result = await evaluateInTarget(this.model.target, expression, internalTabId);
        } catch (error) {
            clearOwnActions();
            console.warn(`[site-extension] ${extension.id}: ${errMessage(error, "injection failed").slice(0, 256)}`);
            return { status: "extension-error", error: boundExtensionError(`Extension evaluation failed: ${errMessage(error, "injection failed")}`) };
        }
        if (!isAllowed() || this.actionDocuments.get(internalTabId) !== actionDocument) { clearOwnActions(); return { status: "not-current" }; }
        const detail = String(result);
        if (detail !== "ok") clearOwnActions();
        if (detail.startsWith("extension-error:")) {
            console.warn(`[site-extension] ${extension.id}: extension script failed`);
            return { status: "extension-error", error: pageExtensionError(detail.slice("extension-error:".length)) };
        }
        if (detail === "host-mismatch" || detail === "already-injected") return { status: "not-current" };
        if (detail !== "ok") return { status: "extension-error", error: boundExtensionError("Extension evaluation returned an unexpected result.") };
        const actions = this.actionDocuments.get(internalTabId);
        if (actions && this.isActionDocumentCurrent(internalTabId, actions, false)) {
            actions.injected = true;
            this.model.notifyAiVisionIndicatorChanged();
        }
        this.setAiVisionSiteExtension(internalTabId, documentId, extension.name);
        if (probeAfterInjection) this.probeAiVisionAgain(internalTabId);
        return { status: "injected" };
    }

    /** Probe the current document even if it was probed already — for a model that appeared
     *  after the load-time probe found nothing. */
    private probeAiVisionAgain(internalTabId: string): void {
        const generation = this.model.getAiVisionDocumentGeneration(internalTabId);
        if (generation === undefined) return;
        this.probedAiVisionGenerations.delete(`${internalTabId}:${generation}`);
        void this.probeAiVision(internalTabId);
    }

    /** `compareShape` is set for a page's own refresh() signal: the re-probe then logs
     *  `shape-changed` only if the shape really changed. The stale-version re-probe stays silent. */
    reprobeAiVision(internalTabId: string, generation: number, token: number, compareShape = false): void {
        const registration = this.model.getAiVisionRegistration(internalTabId);
        if (!registration
            || registration.generation !== generation
            || registration.token !== token) return;
        this.model.clearAiVisionRegistrationIfCurrent(internalTabId, generation);
        const probeGeneration = this.model.getAiVisionDocumentGeneration(internalTabId);
        if (compareShape && probeGeneration !== undefined) {
            const shape = registration.webMcpShape
                ? registration.siteShape ? JSON.stringify(registration.siteShape) : ""
                : JSON.stringify(registration.shape);
            this.pendingShapeComparisons.set(internalTabId, { generation: probeGeneration, shape });
        }
        void this.probeAiVision(internalTabId);
    }

    /** Resolve a pending refresh() comparison for this probe; `shape` undefined means no model. */
    private settleShapeComparison(internalTabId: string, generation: number, shape: string | undefined): void {
        const pending = this.pendingShapeComparisons.get(internalTabId);
        if (!pending || pending.generation !== generation) return;
        this.pendingShapeComparisons.delete(internalTabId);
        if (pending.shape === "") return;
        const pageId = this.model.page?.id;
        if (pageId && shape !== pending.shape) logBrowserShapeChanged(pageId);
    }

    private async probeAiVision(internalTabId: string): Promise<void> {
        if (!agentMayAccessBrowserPage(this.model.state.get())) {
            this.model.clearAiVisionRegistration(internalTabId);
            return;
        }
        const generation = this.model.getAiVisionDocumentGeneration(internalTabId);
        const webview = this.webviewRefs.get(internalTabId);
        if (generation === undefined || !webview || !this.webviewReady.has(internalTabId)) return;
        const probeKey = `${internalTabId}:${generation}`;
        if (this.probedAiVisionGenerations.has(probeKey)) return;
        this.probedAiVisionGenerations.add(probeKey);

        let serialized: unknown;
        try {
            const cdp = this.model.target.cdp(internalTabId);
            if (!await cdp.attach({ aiVisionBinding: true })) return;
            await ensureTargetReady(this.model.target, internalTabId);
            serialized = await evaluateInTarget(this.model.target, AI_VISION_PROBE, internalTabId);
        } catch {
            return;
        }

        if (typeof serialized !== "string") {
            const current = this.model.getAiVisionRegistration(internalTabId);
            if (current?.generation === generation) return;
            this.settleShapeComparison(internalTabId, generation, undefined);
            this.model.clearAiVisionRegistrationIfCurrent(internalTabId, generation);
            return;
        }
        if (new TextEncoder().encode(serialized).byteLength > MAX_AI_VISION_SHAPE_BYTES) {
            const warningKey = `${internalTabId}:${generation}`;
            if (!this.warnedAiVisionShapes.has(warningKey)) {
                this.warnedAiVisionShapes.add(warningKey);
                console.warn(
                    `[browser] AiVision shape exceeded ${MAX_AI_VISION_SHAPE_BYTES} UTF-8 bytes `
                    + `for tab ${internalTabId}.`,
                );
            }
            this.model.clearAiVisionRegistrationIfCurrent(internalTabId, generation);
            return;
        }

        const parsed = tryParseJson<unknown>(serialized, undefined);
        if (parsed === null) {
            this.settleShapeComparison(internalTabId, generation, undefined);
            this.model.clearAiVisionRegistrationIfCurrent(internalTabId, generation);
            return;
        }
        const probe = isBrowserAiVisionProbeResult(parsed);
        if (!probe) return;
        if (this.webviewRefs.get(internalTabId) !== webview
            || !this.webviewReady.has(internalTabId)
            || !this.model.state.get().tabs.some((tab) => tab.id === internalTabId)
            || this.model.getAiVisionDocumentGeneration(internalTabId) !== generation) return;
        const current = this.model.getAiVisionRegistration(internalTabId);
        if (!probe.siteShape && !probe.webMcpShape) {
            this.settleShapeComparison(internalTabId, generation, undefined);
            this.model.clearAiVisionRegistrationIfCurrent(internalTabId, generation);
            return;
        }
        const composed = composeBrowserAiVisionShape(probe.siteShape, probe.webMcpShape);
        if (!composed) return;
        if (current?.generation === generation
            && current.siteVersion === probe.siteVersion
            && current.webMcpVersion === probe.webMcpVersion
            && JSON.stringify(current.shape) === JSON.stringify(composed.shape)) return;
        if (this.model.setAiVisionRegistration(
            internalTabId, generation, composed.shape, composed.version,
            probe.siteShape, probe.siteVersion, probe.webMcpShape, probe.webMcpVersion, composed.namespace,
        )) {
            const comparisonShape = probe.siteShape && probe.webMcpShape
                ? JSON.stringify(probe.siteShape)
                : JSON.stringify(composed.shape);
            this.settleShapeComparison(internalTabId, generation, comparisonShape);
        }
    }

    /**
     * Probe for a model announced by a refresh() signal with no registration, at most once per
     * interval. A signal inside the interval schedules one trailing probe rather than being
     * dropped, because that signal may be the model's only announcement.
     */
    private scheduleLateAiVisionProbe(internalTabId: string): void {
        if (this.lateAiVisionProbeTimers.has(internalTabId)) return;
        const wait = (this.lateAiVisionProbeTimes.get(internalTabId) ?? 0) + AI_VISION_LATE_PROBE_INTERVAL_MS - Date.now();
        const probe = (): void => {
            this.lateAiVisionProbeTimers.delete(internalTabId);
            this.lateAiVisionProbeTimes.set(internalTabId, Date.now());
            if (!this.model.getAiVisionRegistration(internalTabId)) this.probeAiVisionAgain(internalTabId);
        };
        if (wait <= 0) {
            probe();
            return;
        }
        this.lateAiVisionProbeTimers.set(internalTabId, setTimeout(probe, wait));
    }

    private handleAiVisionSignal(
        internalTabId: string,
        data: { registrationKey?: string; payload?: string; executionContextId?: number; mainContext?: boolean },
    ): void {
        if (!agentMayAccessBrowserPage(this.model.state.get())) return;
        if (data.registrationKey !== `${this.model.id}/${internalTabId}`
            || typeof data.payload !== "string") return;
        const webview = this.webviewRefs.get(internalTabId);
        if (!webview || !this.webviewReady.has(internalTabId)
            || !this.model.state.get().tabs.some((tab) => tab.id === internalTabId)) return;

        if (data.payload.length > 262_144 || new TextEncoder().encode(data.payload).byteLength > 262_144) return;
        const signal = tryParseJson<unknown>(data.payload, undefined);
        if (signal && typeof signal === "object" && (signal as { type?: unknown }).type === "fetch-cancel") {
            const doc = this.actionDocuments.get(internalTabId);
            if (doc && data.mainContext && typeof data.executionContextId === "number"
                && (doc.contextId === undefined || doc.contextId === data.executionContextId)
                && Object.keys(signal).length === 1 && this.isActionDocumentCurrent(internalTabId, doc, false)) {
                doc.fetchRequests.clear();
                void api.cancelSiteExtensionFetches(doc.fetchKey).catch((): undefined => undefined);
            }
            return;
        }
        if (signal && typeof signal === "object" && (signal as { type?: unknown }).type === "fetch-request") {
            this.acceptFetchRequest(internalTabId, data, signal);
            return;
        }
        if (signal && typeof signal === "object" && (signal as { type?: unknown }).type === "actions-published") {
            this.acceptActionPublication(internalTabId, data, signal);
            return;
        }
        if (!isAiHostSignal(signal)) return;
        if (signal.type === "shape") {
            const registration = this.model.getAiVisionRegistration(internalTabId);
            if (!registration) {
                // A model published after the load-time probe (a single-page app that builds it
                // late). Its first refresh() is the only way the host learns it exists.
                this.scheduleLateAiVisionProbe(internalTabId);
                return;
            }
            if (registration.version === signal.version) return;
            this.reprobeAiVision(internalTabId, registration.generation, registration.token, true);
            return;
        }

        // Notify signals may arrive while a shape signal has cleared the live registration and
        // its replacement probe is still running. Historical registration preserves the
        // anti-injection boundary without dropping that normal refresh-then-notify sequence.
        if (!this.model.hasAiVisionRegisteredTab(internalTabId)) return;
        const text = signal.text.replace(/\s+/g, " ").trim();
        if (!text) return;
        const now = Date.now();
        while (this.aiVisionNotifyTimes.length > 0
            && now - this.aiVisionNotifyTimes[0] >= AI_VISION_NOTIFY_WINDOW_MS) {
            this.aiVisionNotifyTimes.shift();
        }
        if (this.aiVisionNotifyTimes.length >= AI_VISION_NOTIFY_LIMIT) return;
        this.aiVisionNotifyTimes.push(now);
        const boundedText = text.length > MAX_AI_VISION_NOTIFY_LENGTH
            ? `${text.slice(0, MAX_AI_VISION_NOTIFY_LENGTH - 3)}...`
            : text;
        const pageId = this.model.page?.id;
        const path = pageId ? `pages[${JSON.stringify(pageId)}].editor.app` : undefined;
        logRemoteNotify(boundedText, path, "page");
    }

    private isActionDocumentCurrent(tabId: string, doc: NonNullable<ReturnType<typeof this.actionDocuments.get>>, active: boolean): boolean {
        const state = this.model.state.get();
        const grant = siteExtensionTrust.get(doc.id);
        return this.actionDocuments.get(tabId) === doc && !state.isIncognito && !state.isTor
            && (!active || state.activeTabId === tabId) && state.tabs.some(tab => tab.id === tabId)
            && !!grant?.enabled && (sameSiteExtensionHostSet(grant.hosts, doc.hosts) && sameSiteExtensionHostSet(grant.fetchHosts, doc.fetchHosts))
            && this.isCurrentDocument(tabId, doc.documentId, doc.host);
    }

    deactivateSiteActions(tabId: string): void {
        const doc = this.actionDocuments.get(tabId);
        if (doc) { doc.runVersion++; doc.cancelRun?.(); }
        for (const [token, choice] of this.actionChoices) if (choice.tabId === tabId) this.actionChoices.delete(token);
    }

    refreshActionTrust(): void {
        for (const [tabId, doc] of this.actionDocuments) if (!this.isActionDocumentCurrent(tabId, doc, false)) this.clearAiVisionSiteExtension(tabId);
    }

    private acceptFetchRequest(tabId: string, data: { mainContext?: boolean; executionContextId?: number }, value: object): void {
        const doc = this.actionDocuments.get(tabId);
        const request = value as { id?: unknown; url?: unknown };
        if (!doc || !data.mainContext || typeof data.executionContextId !== "number"
            || !this.isActionDocumentCurrent(tabId, doc, false)
            || (doc.contextId !== undefined && doc.contextId !== data.executionContextId)
            || Object.keys(value).some(key => key !== "type" && key !== "id" && key !== "url")
            || !Number.isSafeInteger(request.id) || (request.id as number) < 1
            || typeof request.url !== "string" || request.url.length > 4096) return;
        doc.contextId = data.executionContextId;
        const id = request.id as number;
        if (doc.fetchRequests.has(id)) return;
        const respond = (result: { text?: string; error?: string }): void => {
            if (!doc.fetchRequests.has(id) || !this.isActionDocumentCurrent(tabId, doc, false) || doc.contextId !== data.executionContextId) return;
            const response = JSON.stringify({ id, ...result });
            void this.model.target.cdp(tabId).send("Runtime.evaluate", {
                expression: `window.__persephoneSiteRuntime?.resolveFetch(${response})`,
                contextId: doc.contextId, returnByValue: true,
            }).catch((): undefined => undefined);
        };
        if (doc.fetchRequests.size >= 4) {
            void this.model.target.cdp(tabId).send("Runtime.evaluate", {
                expression: `window.__persephoneSiteRuntime?.resolveFetch(${JSON.stringify({ id, error: "Too many fetch requests" })})`,
                contextId: doc.contextId, returnByValue: true,
            }).catch((): undefined => undefined);
            return;
        }
        doc.fetchRequests.add(id);
        void api.fetchSiteExtensionText(doc.fetchKey, doc.id, request.url)
            .then(respond, () => respond({ error: "Fetch failed" }))
            .finally(() => doc.fetchRequests.delete(id));
    }

    private acceptActionPublication(tabId: string, data: { mainContext?: boolean; executionContextId?: number }, value: object): void {
        const doc = this.actionDocuments.get(tabId);
        if (!doc || !data.mainContext || typeof data.executionContextId !== "number"
            || !this.isActionDocumentCurrent(tabId, doc, false)
            || (doc.contextId !== undefined && doc.contextId !== data.executionContextId)) return;
        const envelope = value as { items?: unknown };
        if (Object.keys(value).some(key => key !== "type" && key !== "items")) return;
        let items: SiteActionItem[];
        try { items = validateSiteActions(envelope.items, false).items; } catch { return; }
        doc.contextId = data.executionContextId;
        doc.pending = items;
        const publish = (): void => {
            doc.timer = undefined;
            if (!this.isActionDocumentCurrent(tabId, doc, false) || !doc.pending) return;
            doc.items = doc.pending; doc.pending = undefined; doc.lastPublish = Date.now();
            this.model.notifyAiVisionIndicatorChanged();
        };
        if (doc.timer) return;
        const delay = Math.max(0, doc.lastPublish + 100 - Date.now());
        if (delay) doc.timer = setTimeout(publish, delay); else publish();
    }

    getSiteActions(tabId = this.model.state.get().activeTabId): SiteActionItem[] {
        const doc = this.actionDocuments.get(tabId);
        return doc?.injected && this.isActionDocumentCurrent(tabId, doc, false) ? structuredClone(doc.items) : [];
    }

    async runSiteAction(id: string): Promise<SiteActionOutcome> {
        const tabId = this.model.state.get().activeTabId;
        const doc = this.actionDocuments.get(tabId);
        const contains = (items: SiteActionItem[]): boolean => items.some(item => item.children?.length ? contains(item.children) : item.id === id);
        if (!doc?.injected || doc.contextId === undefined || !this.isActionDocumentCurrent(tabId, doc, true)) return { status: "not-current" };
        if (!contains(doc.items)) return { status: "error", error: t("browser.siteActionUnknown") };
        if (doc.running) return { status: "busy" };
        doc.running = true;
        const runVersion = ++doc.runVersion;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const expression = `(async () => {
    try {
        const value = await window.__persephoneSiteRuntime.invokeAction(${JSON.stringify(id)});
        if (typeof value !== "string" || value.length > 2097152 || new TextEncoder().encode(value).byteLength > 2097152) throw new Error("Invalid action result size");
        return value;
    } catch (error) {
        let message = "Action handler failed";
        try { message = String(error && typeof error === "object" && "message" in error ? error.message : error).slice(0, 512); } catch { /* Use fallback. */ }
        throw new Error(message);
    }
})()`;
        const operation = this.model.target.cdp(tabId).send("Runtime.evaluate", {
            expression, contextId: doc.contextId, awaitPromise: true, returnByValue: true,
        }).then(response => {
            if (response.exceptionDetails) {
                // The description is "Error: <message>\n    at …"; keep only the message line.
                const description = String(response.exceptionDetails.exception?.description ?? "Action handler failed");
                throw new Error(description.split("\n")[0].replace(/^Error: /, "").slice(0, 512));
            }
            return response.result?.value as unknown;
        });
        let timedOut = false;
        let settled = false;
        const cancelled = Symbol("cancelled");
        const cancellation = new Promise<typeof cancelled>(resolve => { doc.cancelRun = () => resolve(cancelled); });
        void operation.then(() => { settled = true; if (timedOut) doc.running = false; }, () => { settled = true; if (timedOut) doc.running = false; });
        try {
            const result = await Promise.race([operation, cancellation, new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), 60_000); })]);
            if (result === cancelled) { timedOut = !settled; return { status: "not-current" }; }
            if (doc.runVersion !== runVersion || !this.isActionDocumentCurrent(tabId, doc, true)) return { status: "not-current" };
            if (result === undefined) { timedOut = !settled; throw new Error(t("browser.siteActionTimeout")); }
            const outcome = await this.openActionResult(tabId, doc, runVersion, validateSiteActionResult(result));
            return doc.runVersion === runVersion && this.isActionDocumentCurrent(tabId, doc, true) ? outcome : { status: "not-current" };
        } catch (error) {
            if (doc.runVersion !== runVersion || !this.isActionDocumentCurrent(tabId, doc, true)) return { status: "not-current" };
            const message = boundExtensionError(errMessage(error, t("browser.siteActionFailure")));
            ui.notify(t("browser.siteActionFailed", { error: message }), "error");
            return { status: "error", error: message };
        } finally { if (timer) clearTimeout(timer); doc.cancelRun = undefined; if (!timedOut) doc.running = false; }
    }

    private async openActionResult(tabId: string, doc: NonNullable<ReturnType<typeof this.actionDocuments.get>>, runVersion: number, result: SiteActionResult): Promise<SiteActionOutcome> {
        if (doc.runVersion !== runVersion || !this.isActionDocumentCurrent(tabId, doc, true)) return { status: "not-current" };
        if (result.kind === "message") { ui.notify(result.text, "info"); return { status: "message", text: result.text }; }
        if (result.kind === "url") { await app.openRawLink(result.url); return { status: "opened" }; }
        if (result.kind === "links") { pagesModel.openLinks(result.items.map(item => ({ title: item.title, href: item.url, category: "", tags: [] as string[], isDirectory: false })), result.title); return { status: "opened" }; }
        if (result.kind === "text") {
            const formats = { markdown: ["md-view", "markdown"], json: ["grid-json", "json"], csv: ["grid-csv", "csv"], plain: ["monaco", "plaintext"] } as const;
            const [editor, language] = formats[result.format];
            pagesModel.addEditorPage(editor, language, result.title, result.content); return { status: "opened" };
        }
        if (result.items.length > 1) {
            const token = crypto.randomUUID();
            for (const [key, choice] of this.actionChoices) if (choice.expires < Date.now() || choice.tabId === tabId) this.actionChoices.delete(key);
            this.actionChoices.set(token, { tabId, document: doc, expires: Date.now() + 60_000, runVersion, items: result.items });
            return { status: "choice-required", token, choices: result.items.map(item => ({ label: item.label })) };
        }
        return this.openActionVideo(tabId, doc, runVersion, result.items[0]);
    }

    private async openActionVideo(tabId: string, doc: NonNullable<ReturnType<typeof this.actionDocuments.get>>, runVersion: number, item: Extract<SiteActionResult, { kind: "video" }>["items"][number]): Promise<SiteActionOutcome> {
        const opened = await pagesModel.openSiteActionVideo({ url: item.url, method: "GET", body: "", headers: item.headers ?? {} }, () => doc.runVersion === runVersion && this.isActionDocumentCurrent(tabId, doc, true));
        return { status: opened ? "opened" : "not-current" };
    }

    async chooseSiteActionResult(token: string, index: number): Promise<SiteActionOutcome> {
        const choice = this.actionChoices.get(token);
        this.actionChoices.delete(token);
        const doc = choice && this.actionDocuments.get(choice.tabId);
        if (!choice || !doc || choice.document !== doc || choice.runVersion !== doc.runVersion || choice.expires < Date.now() || !Number.isInteger(index) || !choice.items[index] || !this.isActionDocumentCurrent(choice.tabId, doc, true)) return { status: "not-current" };
        try {
            const outcome = await this.openActionVideo(choice.tabId, doc, choice.runVersion, choice.items[index]);
            return choice.runVersion === doc.runVersion && this.isActionDocumentCurrent(choice.tabId, doc, true) ? outcome : { status: "not-current" };
        }
        catch (error) { if (!this.isActionDocumentCurrent(choice.tabId, doc, true) || choice.runVersion !== doc.runVersion) return { status: "not-current" }; const message = boundExtensionError(errMessage(error)); ui.notify(t("browser.siteActionFailed", { error: message }), "error"); return { status: "error", error: message }; }
    }

    // =====================================================================
    // Context Menu
    // =====================================================================

    private handleContextMenu = async (
        webview: Electron.WebviewTag,
        internalTabId: string,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: any,
    ) => {
        await showBrowserContextMenu({
            model: this.model,
            webview,
            internalTabId,
            data,
            showResources: this.showResources,
        });
    };

    // =====================================================================
    // Page Menu (toolbar "..." button)
    // =====================================================================

    /**
     * Build menu items for the toolbar page menu ("..." button).
     * Provides View Source, View Actual DOM, and Show Resources
     * without needing a right-click context menu on the webview.
     */
    getPageMenuItems(): MenuItem[] {
        const state = this.model.state.get();
        const activeTabId = state.activeTabId;
        const tab = state.tabs.find((t) => t.id === activeTabId);
        const webview = this.getActiveWebview();
        const pageUrl = tab?.url || "";
        const hasPage = !!webview && !!pageUrl && pageUrl !== "about:blank";
        const regKey = `${this.model.id}/${activeTabId}`;

        return [
            {
                id: "view-source",
                label: t("browser.toolbarViewSource"),
                disabled: !hasPage,
                onClick: async () => {
                    if (!webview) return;
                    const resp = await webview.executeJavaScript(
                        `fetch(location.href).then(r => r.text())`,
                    );
                    await app.capabilities.invoke("text.open", {
                        content: resp,
                        language: "html",
                        title: "Source: " + (tab?.pageTitle || pageUrl),
                    });
                },
            },
            {
                id: "view-actual-dom",
                label: t("browser.toolbarViewActualDom"),
                disabled: !hasPage,
                onClick: async () => {
                    const html = await ipcRenderer.invoke(
                        BrowserChannel.collectDom,
                        regKey,
                    );
                    await app.capabilities.invoke("text.open", {
                        content: html,
                        language: "html",
                        title: "DOM: " + (tab?.pageTitle || pageUrl),
                    });
                },
            },
            {
                id: "show-resources",
                label: t("browser.toolbarShowResources"),
                disabled: !hasPage,
                onClick: () => this.showResources(regKey, pageUrl, tab?.pageTitle || pageUrl),
            },
        ];
    }

    // =====================================================================
    // Show Resources (shared by context menu and toolbar menu)
    // =====================================================================

    /** Collect DOM resources + network log and open as a link collection. */
    private showResources = async (regKey: string, pageUrl: string, title: string) => {
        const [html, networkLog, loadedUrls] = await Promise.all([
            ipcRenderer.invoke(BrowserChannel.collectDom, regKey),
            ipcRenderer.invoke(BrowserChannel.getNetworkLog, regKey),
            ipcRenderer.invoke(BrowserChannel.collectLoadedResources, regKey) as Promise<string[]>,
        ]);

        const { extractHtmlResources, loadedFontLinks } = await import("../../core/utils/html-resources");
        const { networkLogToLinks } = await import("./network-log-links");

        const domLinks = extractHtmlResources(html, { baseUrl: pageUrl });
        // Fonts come from the page's own Resource Timing list: the network log misses cache hits.
        const domHrefs = new Set(domLinks.map((link) => link.href));
        const fontLinks = loadedFontLinks(loadedUrls).filter((link) => !domHrefs.has(link.href));
        const networkLinks = networkLogToLinks(networkLog);
        const links = [...domLinks, ...fontLinks, ...networkLinks];
        // The list opens as a standalone page outside this page's session, so on a
        // Tor or proxied page its image thumbnails would load direct.
        if (this.model.network.imageRoute) {
            for (const link of links) delete link.imgSrc;
        }

        if (links.length === 0) {
            ui.notify(t("browser.toolbarNoResources"), "info");
            return;
        }

        pagesModel.openLinks(links, title + " \u2014 Resources");
    };
}

function isSchemaMajorOne(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && Math.floor(value) === 1;
}

function isAiVisionShape(value: unknown): value is IAiVisionShape {
    if (!value || typeof value !== "object") return false;
    const shape = value as { schemaVersion?: unknown; root?: unknown };
    if (!isSchemaMajorOne(shape.schemaVersion) || !shape.root || typeof shape.root !== "object") return false;
    const root = shape.root as { kind?: unknown; summary?: unknown; members?: unknown };
    return typeof root.kind === "string" && typeof root.summary === "string" && Array.isArray(root.members);
}

interface BrowserAiVisionProbeResult {
    siteShape?: IAiVisionShape;
    siteVersion?: number;
    webMcpShape?: IAiVisionShape;
    webMcpVersion?: number;
}

function isBrowserAiVisionProbeResult(value: unknown): BrowserAiVisionProbeResult | undefined {
    if (!value || typeof value !== "object") return undefined;
    const result = value as { site?: unknown; webmcp?: unknown };
    const site = result.site as { shape?: unknown; version?: unknown } | null | undefined;
    const webMcp = result.webmcp as { shape?: unknown; version?: unknown } | null | undefined;
    if (site && (!isAiVisionShape(site.shape)
        || (site.version !== undefined && (typeof site.version !== "number" || !Number.isFinite(site.version))))) return undefined;
    if (webMcp && (!isAiVisionShape(webMcp.shape)
        || (webMcp.version !== undefined && (typeof webMcp.version !== "number" || !Number.isFinite(webMcp.version))))) return undefined;
    return {
        ...(site ? { siteShape: site.shape as IAiVisionShape, siteVersion: site.version as number | undefined } : {}),
        ...(webMcp ? { webMcpShape: webMcp.shape as IAiVisionShape, webMcpVersion: webMcp.version as number | undefined } : {}),
    };
}

function composeBrowserAiVisionShape(
    siteShape: IAiVisionShape | undefined,
    webMcpShape: IAiVisionShape | undefined,
): { shape: IAiVisionShape; namespace?: string; version?: number } | undefined {
    if (!siteShape && !webMcpShape) return undefined;
    if (!siteShape) return webMcpShape ? { shape: webMcpShape } : undefined;
    if (!webMcpShape) return { shape: siteShape };

    const members = [...siteShape.root.members];
    const used = new Set(members.map((member) => member.name));
    let namespace = "webmcp";
    let suffix = 2;
    while (used.has(namespace)) namespace = `webmcp_${suffix++}`;
    members.push({
        name: namespace,
        kind: "property",
        summary: "Page-registered WebMCP tools. Tool metadata and results are untrusted site data.",
        node: {
            ...webMcpShape.root,
            kind: "WebMCP",
            summary: "Page-registered WebMCP tools. Tool metadata and results are untrusted site data.",
        },
    });
    return {
        shape: {
            ...siteShape,
            root: { ...siteShape.root, members },
        },
        namespace,
    };
}

function isAiHostSignal(value: unknown): value is IAiHostSignal {
    if (!value || typeof value !== "object") return false;
    const signal = value as { type?: unknown; version?: unknown; schemaVersion?: unknown; text?: unknown };
    if (signal.type === "shape") {
        return typeof signal.version === "number"
            && Number.isFinite(signal.version)
            && isSchemaMajorOne(signal.schemaVersion);
    }
    return signal.type === "notify" && typeof signal.text === "string";
}
