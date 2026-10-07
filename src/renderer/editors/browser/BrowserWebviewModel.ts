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
import { withTimeout } from "../../core/utils/utils";
import { api } from "../../../ipc/renderer/api";
import { fs } from "../../api/fs";
import { siteExtensionStore } from "../../api/site-extensions";
import type { SiteExtensionRecord } from "../../api/site-extensions";
import type { SiteExtensionReloadResult } from "../../api/types/site-extensions";
import { siteExtensionTrust, sameSiteExtensionHostSet } from "../../api/site-extension-trust";
import {
    logBrowserNavigated,
    logBrowserShapeChanged,
    logRemoteNotify,
} from "../../scripting/ai-vision/event-log";

const AI_VISION_PROBE = `(() => {
    const remote = window.__aiVision;
    return remote
        ? JSON.stringify({ shape: remote.describe(), version: remote.version })
        : null;
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

    siteDocumentId(internalTabId: string): number {
        return this.siteDocuments.get(internalTabId) ?? 0;
    }

    getAiVisionSiteExtensionName(internalTabId: string): string | undefined {
        const marker = this.injectedSiteExtensions.get(internalTabId);
        return marker?.documentId === this.siteDocumentId(internalTabId) ? marker.name : undefined;
    }

    clearAiVisionSiteExtension(internalTabId: string): void {
        if (this.injectedSiteExtensions.delete(internalTabId)) this.model.notifyAiVisionIndicatorChanged();
    }

    dispose(): void {
        for (const internalTabId of this.injectedSiteExtensions.keys()) this.clearAiVisionSiteExtension(internalTabId);
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
            wv.stop();
        } else {
            wv.reload();
        }
    };

    /** Hard reload (ignore cache) the active tab, bypassing any beforeunload
     *  guard prompt. Routed through the main process so the bypass flag is
     *  armed atomically with the reload (see browser-service.ts). */
    hardReload = () => {
        const { activeTabId } = this.model.state.get();
        if (!this.webviewRefs.has(activeTabId)) return;
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
        this.getActiveWebview()?.reload();
    };

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

    private handleBrowserEvent = async (
        _event: Electron.IpcRendererEvent,
        browserEvent: BrowserEvent,
    ) => {
        const pageTabId = this.model.id;
        if (browserEvent.tabId !== pageTabId) return;
        const { internalTabId, type, data } = browserEvent;

        switch (type) {
            case "did-navigate": {
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
        const hostsMatch = !!grant && sameSiteExtensionHostSet(grant.hosts, extension.hosts);
        if (grant?.enabled && hostsMatch) {
            await this.injectTrustedExtensionIntoCurrentDocument(internalTabId, extension, documentId);
            return;
        }
        if (grant && !grant.enabled) return;
        const promptKey = `${internalTabId}:${documentId}`;
        if (!this.dismissedExtensionPrompts.has(promptKey)) {
            this.model.setSiteExtensionTrustPrompt({ internalTabId, documentId, id: extension.id, name: extension.name, host: pageUrl.hostname, hosts: [...extension.hosts], available: true });
        }
    }

    /**
     * Trust the extension a bar shows, for that bar's document only. Used by the bar's Trust button
     * and by the agent facade (US-1614). `changed`: the manifest changed since the bar appeared,
     * so the bar now shows the new name/hosts and nothing was granted. `unavailable`: the
     * extension is gone or invalid. `not-current`: no such bar, or the document changed.
     */
    async trustSiteExtensionPrompt(internalTabId: string, documentId: number): Promise<"trusted" | "changed" | "unavailable" | "not-current"> {
        const prompt = this.model.state.get().siteExtensionTrustPrompts.find((item) => item.internalTabId === internalTabId && item.documentId === documentId);
        if (!prompt || !this.isCurrentDocument(internalTabId, documentId, prompt.host)) return "not-current";
        if (!prompt.available) return "unavailable";
        const current = await siteExtensionStore.findForHost(prompt.host).catch((): undefined => undefined);
        if (!this.isCurrentDocument(internalTabId, documentId, prompt.host)) return "not-current";
        if (!current || current.id !== prompt.id || !sameSiteExtensionHostSet(current.hosts, prompt.hosts)) {
            if (current) this.model.setSiteExtensionTrustPrompt({ internalTabId, documentId, id: current.id, name: current.name, host: prompt.host, hosts: [...current.hosts], available: true });
            else this.model.setSiteExtensionTrustPrompt({ ...prompt, available: false });
            return current ? "changed" : "unavailable";
        }
        await siteExtensionTrust.trust(current.id, prompt.hosts);
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
        if (!grant || !sameSiteExtensionHostSet(grant.hosts, extension.hosts)) {
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
            if (!grant || !sameSiteExtensionHostSet(grant.hosts, currentExtension.hosts)) {
                this.showExtensionTrustPrompt(internalTabId, documentId, extension, host);
                return { status: "waiting-for-user", registered: false };
            }

            const teardown = `(() => {
    if (location.protocol !== "https:" || location.hostname !== ${JSON.stringify(host)}) return "host-mismatch";
    window.__persephoneSiteRuntime?.dispose?.();
    delete window.__persephoneSiteExtension;
    return "ok";
})()`;
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
        if (pageUrl.protocol !== "https:" || !this.isCurrentDocument(internalTabId, documentId, pageUrl.hostname)) return { status: "not-current" };

        let expression: string;
        try {
            const [source, runtime] = await Promise.all([
                fs.read(extension.scriptPath),
                api.getSiteExtensionRuntime(),
            ]);
            if (!this.isCurrentDocument(internalTabId, documentId, pageUrl.hostname)) return { status: "not-current" };
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

        if (!this.isCurrentDocument(internalTabId, documentId, pageUrl.hostname)) return { status: "not-current" };

        let result: unknown;
        try {
            const cdp = this.model.target.cdp(internalTabId);
            if (!await cdp.attach({ aiVisionBinding: true })) {
                console.warn(`[site-extension] ${extension.id}: CDP attach failed`);
                return { status: "not-current" };
            }
            if (!this.isCurrentDocument(internalTabId, documentId, pageUrl.hostname)) return { status: "not-current" };
            await ensureTargetReady(this.model.target, internalTabId);
            if (!this.isCurrentDocument(internalTabId, documentId, pageUrl.hostname)) return { status: "not-current" };
            result = await evaluateInTarget(this.model.target, expression, internalTabId);
        } catch (error) {
            console.warn(`[site-extension] ${extension.id}: ${errMessage(error, "injection failed").slice(0, 256)}`);
            return { status: "extension-error", error: boundExtensionError(`Extension evaluation failed: ${errMessage(error, "injection failed")}`) };
        }
        if (!this.isCurrentDocument(internalTabId, documentId, pageUrl.hostname)) return { status: "not-current" };
        const detail = String(result);
        if (detail.startsWith("extension-error:")) {
            console.warn(`[site-extension] ${extension.id}: extension script failed`);
            return { status: "extension-error", error: pageExtensionError(detail.slice("extension-error:".length)) };
        }
        if (detail === "host-mismatch" || detail === "already-injected") return { status: "not-current" };
        if (detail !== "ok") return { status: "extension-error", error: boundExtensionError("Extension evaluation returned an unexpected result.") };
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
            this.pendingShapeComparisons.set(internalTabId, { generation: probeGeneration, shape: JSON.stringify(registration.shape) });
        }
        void this.probeAiVision(internalTabId);
    }

    /** Resolve a pending refresh() comparison for this probe; `shape` undefined means no model. */
    private settleShapeComparison(internalTabId: string, generation: number, shape: string | undefined): void {
        const pending = this.pendingShapeComparisons.get(internalTabId);
        if (!pending || pending.generation !== generation) return;
        this.pendingShapeComparisons.delete(internalTabId);
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
        const probe = isAiVisionProbeResult(parsed)
            ? parsed
            : isAiVisionShape(parsed)
                ? { shape: parsed, version: undefined }
                : undefined;
        if (!probe) return;
        if (this.webviewRefs.get(internalTabId) !== webview
            || !this.webviewReady.has(internalTabId)
            || !this.model.state.get().tabs.some((tab) => tab.id === internalTabId)
            || this.model.getAiVisionDocumentGeneration(internalTabId) !== generation) return;
        const current = this.model.getAiVisionRegistration(internalTabId);
        if (current?.generation === generation
            && current.version === probe.version
            && JSON.stringify(current.shape) === JSON.stringify(probe.shape)) return;
        if (this.model.setAiVisionRegistration(internalTabId, generation, probe.shape, probe.version)) {
            this.settleShapeComparison(internalTabId, generation, JSON.stringify(probe.shape));
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
        data: { registrationKey?: string; payload?: string },
    ): void {
        if (!agentMayAccessBrowserPage(this.model.state.get())) return;
        if (data.registrationKey !== `${this.model.id}/${internalTabId}`
            || typeof data.payload !== "string") return;
        const webview = this.webviewRefs.get(internalTabId);
        if (!webview || !this.webviewReady.has(internalTabId)
            || !this.model.state.get().tabs.some((tab) => tab.id === internalTabId)) return;

        const signal = tryParseJson<unknown>(data.payload, undefined);
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
                label: "View Source",
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
                label: "View Actual DOM",
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
                label: "Show Resources",
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
        const [html, networkLog] = await Promise.all([
            ipcRenderer.invoke(BrowserChannel.collectDom, regKey),
            ipcRenderer.invoke(BrowserChannel.getNetworkLog, regKey),
        ]);

        const { extractHtmlResources } = await import("../../core/utils/html-resources");
        const { networkLogToLinks } = await import("./network-log-links");

        const domLinks = extractHtmlResources(html, { baseUrl: pageUrl });
        const networkLinks = networkLogToLinks(networkLog);
        const links = [...domLinks, ...networkLinks];
        // The list opens as a standalone page outside this page's session, so on a
        // Tor or proxied page its image thumbnails would load direct (US-1557).
        if (this.model.network.imageRoute) {
            for (const link of links) delete link.imgSrc;
        }

        if (links.length === 0) {
            ui.notify("No resources found on this page.", "info");
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

function isAiVisionProbeResult(
    value: unknown,
): value is { shape: IAiVisionShape; version?: number } {
    if (!value || typeof value !== "object") return false;
    const result = value as { shape?: unknown; version?: unknown };
    if (!isAiVisionShape(result.shape)) return false;
    return result.version === undefined
        || (typeof result.version === "number" && Number.isFinite(result.version));
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
