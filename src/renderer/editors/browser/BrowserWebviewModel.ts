import { PAGE_ZOOM_DEFAULT, PAGE_ZOOM_STEP, clampPageZoom, isValidPageZoom } from "../../../shared/browser-zoom";
const { ipcRenderer } = require("electron");
import {
    BrowserChannel,
    BrowserEvent,
    BrowserPermissionPromptData,
} from "../../../ipc/browser-ipc";
import { globalPopupRateLimiter } from "../../../ipc/popup-rate-limiter";
import { browserUrlChanged, type BrowserUrlEvent } from "../../core/state/events";
import { DEFAULT_URL } from "./browser-state";
import type { BrowserEditor } from "./BrowserEditor";
import { showBrowserContextMenu } from "./webview-context-menu";
import { showResources } from "./browser-page-menu";

/**
 * Manages webview references, IPC event handling, context menu, and guest operations.
 */
export class BrowserWebviewModel {
    readonly model: BrowserEditor;
    /** Map from internal tab ID to webview element. */
    private readonly webviewRefs = new Map<string, Electron.WebviewTag>();
    /** Set of internalTabIds whose webview has fired dom-ready. */
    private readonly webviewReady = new Set<string>();
    private readonly loadedWaiters = new Map<string, Set<() => void>>();

    attach(tabId: string, webview: Electron.WebviewTag): void {
        this.webviewRefs.set(tabId, webview);
    }

    /** Remove the exact guest owned by a view, then release its tab-scoped collaborators. */
    detach(tabId: string, webview: Electron.WebviewTag): boolean {
        if (this.get(tabId) !== webview) return false;
        this.webviewRefs.delete(tabId);
        this.model.siteExtensions.onTabReleased(tabId);
        this.model.translation.onTabReleased(tabId);
        this.webviewReady.delete(tabId);
        return true;
    }

    get(tabId: string): Electron.WebviewTag | undefined {
        return this.webviewRefs.get(tabId);
    }

    isReady(tabId: string): boolean {
        return this.webviewReady.has(tabId);
    }

    isVisible(tabId: string): boolean {
        const webview = this.get(tabId);
        if (!webview?.isConnected || !webview.getClientRects().length || !webview.offsetWidth || !webview.offsetHeight) {
            return false;
        }
        return true;
    }

    waitForLoaded(id: string): Promise<void> {
        if (this.isReady(id)) return Promise.resolve();
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

    constructor(model: BrowserEditor) {
        this.model = model;
    }

    /** Get the active tab's webview element. */
    getActiveWebview = (): Electron.WebviewTag | undefined => {
        const { activeTabId } = this.model.state.get();
        return this.get(activeTabId);
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
            this.model.siteExtensions.onNavigationStarted(this.model.state.get().activeTabId, true, false);
            wv.reload();
        }
    };

    /** Hard reload (ignore cache) the active tab, bypassing any beforeunload
     *  guard prompt. Routed through the main process so the bypass flag is
     *  armed atomically with the reload (see browser-service.ts). */
    hardReload = () => {
        const { activeTabId } = this.model.state.get();
        if (!this.get(activeTabId)) return;
        this.resetTranslationForReload(activeTabId);
        this.model.siteExtensions.onNavigationStarted(activeTabId, true, false);
        ipcRenderer.send(
            BrowserChannel.hardReload,
            `${this.model.id}/${activeTabId}`,
        );
    };

    openDevTools = () => {
        this.getActiveWebview()?.openDevTools();
    };

    /**
     * Navigate the active tab's webview when the tab URL changes.
     * Called from the view's update path when activeTab.url changes.
     */
    navigateWebview = (activeTabId: string, url: string) => {
        if (url !== this.prevActiveUrl) {
            const webview = this.get(activeTabId);
            if (webview && this.isReady(activeTabId)) {
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
        this.model.pageRemote.clearViewLifecycle();
    };

    /** Reload the active page even while it is loading. */
    reload = () => {
        this.resetTranslationForReload();
        this.getActiveWebview()?.reload();
    };

    private resetTranslationForReload(internalTabId = this.model.state.get().activeTabId): void {
        this.model.translation.onReloadStart(internalTabId);
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
            if (!inPage && this.model.find.state.get().findBarVisible) this.model.find.close();
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
        const webview = this.get(internalTabId);
        if (webview && this.isReady(internalTabId)) {
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
        if (!isValidPageZoom(zoomPercent)) return;
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
                const value = data.zoomIntent === "reset" ? PAGE_ZOOM_DEFAULT : clampPageZoom(tab.zoomPercent + (data.zoomIntent === "in" ? PAGE_ZOOM_STEP : -PAGE_ZOOM_STEP));
                this.setTabZoom(internalTabId, value);
                break;
            }
            case "did-navigate": {
                this.model.translation.onNavigation(internalTabId);
                const touched = this.model.pageRemote.onNavigation(internalTabId);
                this.model.siteExtensions.onNavigation(internalTabId);
                this.applyNavigation(internalTabId, data, false);
                this.model.pageRemote.onNavigationApplied(touched, data.url);
                break;
            }
            case "did-navigate-in-page": {
                this.applyNavigation(internalTabId, data, true);
                this.model.pageRemote.onInPageNavigation(internalTabId, data.url);
                break;
            }
            case "did-start-loading":
                this.model.pageRemote.onLoadStart(internalTabId);
                // The injected-extension marker is not cleared here: did-start-loading also fires
                // for frame and same-document loads, where the injected script keeps running. A new
                // document arrives through did-navigate, which advances the site document id.
                this.model.updateTab(internalTabId, { loading: true });
                break;
            case "did-stop-loading":
                this.model.updateTab(internalTabId, { loading: false });
                this.model.pageRemote.onLoadStop(internalTabId);
                break;
            case "audio-state-changed":
                this.model.updateTab(internalTabId, { audible: !!data.audible });
                break;
            case "did-start-navigation": {
                this.model.siteExtensions.onNavigationStarted(internalTabId, data.isMainFrame, data.isSameDocument);
                this.model.state.update((state) => {
                    state.permissionPrompts = state.permissionPrompts.filter((item) => item.internalTabId !== internalTabId);
                });
                if (data.blocked) {
                    const webview = this.get(internalTabId);
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
                    if (event.handled) this.model.tabs.closeTab(newInternalTabId);
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
                this.model.find.open();
                break;
            case "hide-find-bar":
                if (this.model.find.state.get().findBarVisible) {
                    this.model.find.close();
                }
                break;
            case "ai-vision-signal":
                this.model.pageRemote.onSignal(internalTabId, data);
                break;
            case "context-menu": {
                const webview = this.get(internalTabId);
                if (!webview) break;
                await this.handleContextMenu(webview, internalTabId, data);
                break;
            }
        }
    };

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
            showResources: (regKey, pageUrl, title) => showResources(this.model, regKey, pageUrl, title),
        });
    };

}
