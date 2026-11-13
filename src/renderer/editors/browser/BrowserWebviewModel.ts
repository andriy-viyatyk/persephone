import { PAGE_ZOOM_DEFAULT, PAGE_ZOOM_STEP, clampPageZoom, isValidPageZoom } from "../../../shared/browser-zoom";
import type { BrowserEvent, BrowserPermissionPromptData, BrowserRegisterRequest } from "../../../ipc/browser-ipc";
import { BrowserGuestMessageChannel, type GuestMessage } from "../../../ipc/browser-guest-messages";
import { globalPopupRateLimiter } from "../../../ipc/popup-rate-limiter";
import { browserUrlChanged, type BrowserUrlEvent } from "../../core/state/events";
import { DEFAULT_URL } from "./browser-state";
import type { BrowserEditor } from "./BrowserEditor";
import { showBrowserContextMenu } from "./webview-context-menu";
import { dismissOverlays } from "../../uikit/shared/overlayLayer";
import { BrowserWebviewReadiness } from "./BrowserWebviewReadiness";

/**
 * Manages webview references, IPC event handling, context menu, and guest operations.
 */
export class BrowserWebviewModel {
    readonly model: BrowserEditor;
    /** Map from internal tab ID to webview element. */
    private readonly webviewRefs = new Map<string, Electron.WebviewTag>();
    private readonly readiness = new BrowserWebviewReadiness();
    private readonly detachGuest = new Map<string, () => void>();
    private readonly registeredGuests = new Set<string>();
    private readonly pendingLoads = new Map<string, string>();
    attach(tabId: string, webview: Electron.WebviewTag): void {
        this.detachGuest.get(tabId)?.();
        this.detachGuest.delete(tabId);
        this.registeredGuests.delete(tabId);
        this.pendingLoads.delete(tabId);
        this.webviewRefs.set(tabId, webview);
        const onDomReady = (): void => {
            if (this.get(tabId) !== webview) return;
            const request: BrowserRegisterRequest = {
                tabId: this.model.id,
                internalTabId: tabId,
                webContentsId: webview.getWebContentsId(),
                zoomPercent: this.model.findTab(tabId)?.zoomPercent ?? PAGE_ZOOM_DEFAULT,
            };
            this.model.guest.register(request);
            this.readiness.markLoaded(tabId);
            this.registeredGuests.add(tabId);
            const pendingUrl = this.pendingLoads.get(tabId);
            if (pendingUrl !== undefined) {
                this.pendingLoads.delete(tabId);
                this.loadReady(webview, pendingUrl);
            }
            const tab = this.model.findTab(tabId);
            if (tab?.muted || this.model.state.get().pageMuted) this.model.guest.setMuted(tabId, true);
            this.model.pageRemote.onReady(tabId);
            this.model.siteExtensions.onDocumentReady(tabId);
        };
        webview.addEventListener("dom-ready", onDomReady);
        this.detachGuest.set(tabId, () => webview.removeEventListener("dom-ready", onDomReady));
    }
    /** Remove the exact guest owned by a view, then release its tab-scoped collaborators. */
    detach(tabId: string, webview: Electron.WebviewTag): boolean {
        if (this.get(tabId) !== webview) return false;
        this.webviewRefs.delete(tabId);
        this.pendingLoads.delete(tabId);
        this.detachGuest.get(tabId)?.();
        this.detachGuest.delete(tabId);
        if (this.registeredGuests.delete(tabId)) this.model.guest.unregister(tabId);
        this.model.siteExtensions.onTabReleased(tabId);
        this.model.translation.onTabReleased(tabId);
        this.readiness.release(tabId);
        return true;
    }
    get(tabId: string): Electron.WebviewTag | undefined {
        return this.webviewRefs.get(tabId);
    }
    isReady(tabId: string): boolean {
        return this.readiness.isReady(tabId);
    }
    clearPendingLoad(tabId: string): void { this.pendingLoads.delete(tabId); }
    load(tabId: string, url: string): void {
        const webview = this.get(tabId);
        if (!webview) return;
        if (!this.isReady(tabId)) { this.pendingLoads.set(tabId, url); return; }
        this.loadReady(webview, url);
    }
    private loadReady(webview: Electron.WebviewTag, url: string): void {
        if (webview.getURL() !== url) void webview.loadURL(url).catch((): void => undefined);
    }
    isRegistered = (tabId: string): boolean => this.registeredGuests.has(tabId);
    isVisible(tabId: string): boolean {
        const webview = this.get(tabId);
        if (!webview?.isConnected || !webview.getClientRects().length || !webview.offsetWidth || !webview.offsetHeight) {
            return false;
        }
        return true;
    }

    waitForLoaded(id: string): Promise<void> {
        return this.readiness.waitForLoaded(id);
    }
    clearLoadedWaiters(id: string): void {
        this.readiness.clearLoadedWaiters(id);
    }
    markLoaded(id: string): void {
        this.readiness.markLoaded(id);
    }

    /** When true, rate limiting is disabled (user clicked "Allow"). */
    popupsAllowed = false;

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
        if (this.model.activeTab?.loading) {
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
        this.model.guest.hardReload(activeTabId);
    };

    openDevTools = () => {
        this.getActiveWebview()?.openDevTools();
    };

    init = () => {
        this.eventUnsubscribe = this.model.guest.onEvent(this.handleBrowserEvent);
    };

    dispose = () => {
        this.eventUnsubscribe?.();
        this.eventUnsubscribe = undefined;
        for (const [tabId, webview] of this.webviewRefs) this.detach(tabId, webview);
        this.model.pageRemote.clearViewLifecycle();
    };

    private eventUnsubscribe?: () => void;

    reload = () => {
        this.resetTranslationForReload();
        this.getActiveWebview()?.reload();
    };

    private resetTranslationForReload(internalTabId = this.model.state.get().activeTabId): void {
        this.model.translation.onReloadStart(internalTabId);
    }

    private applyNavigation = (
        internalTabId: string,
        data: { url?: string; canGoBack?: boolean; canGoForward?: boolean },
        inPage: boolean,
    ) => {
        const previousUrl = this.model.findTab(internalTabId)?.url;
        const url = data.url || "";
        if (internalTabId === this.model.state.get().activeTabId) {
            if (!inPage && this.model.find.state.get().findBarVisible) this.model.find.close();
        }
        this.model.commitNavigation(internalTabId, url, {
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
        if (!inPage) this.model.bookmarks.shiftTrackedImages(internalTabId);
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
        if (webview) this.load(internalTabId, safeUrl);
        else this.model.setFutureUrl(internalTabId, safeUrl);
    }

    setTabZoom = (internalTabId: string, zoomPercent: number): void => {
        if (!isValidPageZoom(zoomPercent)) return;
        if (!this.model.state.get().tabs.some((tab) => tab.id === internalTabId)) return;
        this.model.updateTab(internalTabId, { zoomPercent });
        void this.model.guest.setZoom(internalTabId, zoomPercent);
    };

    handleGuestMessage(tabId: string, msg: GuestMessage, frameId: [number, number]): void {
        switch (msg.channel) {
            case BrowserGuestMessageChannel.pageTitle:
                this.model.updateTab(tabId, { pageTitle: msg.payload }); return;
            case BrowserGuestMessageChannel.pageFavicon: {
                const pageUrl = this.get(tabId)?.getURL() || this.model.findTab(tabId)?.url || "";
                this.model.tabs.onFavicon(tabId, pageUrl, msg.payload);
                return;
            }
            case BrowserGuestMessageChannel.pointerDown: {
                const webview = this.get(tabId);
                if (webview) dismissOverlays(webview);
                return;
            }
            case BrowserGuestMessageChannel.showFindBar:
                this.model.find.open(); return;
            case BrowserGuestMessageChannel.hideFindBar:
                if (this.model.find.state.get().findBarVisible) this.model.find.close(); return;
            case BrowserGuestMessageChannel.clickedImages:
                this.model.bookmarks.trackClickedImages(tabId, msg.payload); return;
            case BrowserGuestMessageChannel.translationUnits:
            case BrowserGuestMessageChannel.translationReady:
                this.model.translation.handleFrame(tabId, frameId, msg.channel, msg.payload); return;
            default: {
                const exhaustive: never = msg;
                return exhaustive;
            }
        }
    }

    private handleBrowserEvent = async (
        _event: Electron.IpcRendererEvent,
        browserEvent: BrowserEvent,
    ) => {
        const pageTabId = this.model.id;
        if (browserEvent.tabId !== pageTabId) return;
        const { internalTabId, type, data } = browserEvent;

        switch (type) {
            case "zoom-intent": {
                const tab = this.model.findTab(internalTabId);
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
                this.model.prompts.clearTab(internalTabId);
                if (data.blocked) {
                    const webview = this.get(internalTabId);
                    const tabData = this.model.findTab(internalTabId);
                    if (webview && tabData && tabData.url !== data.url) {
                        webview.goBack();
                    }
                }
                break;
            }
            case "new-window": {
                if (data.url) {
                    if (!this.popupsAllowed && !globalPopupRateLimiter.check("tabs")) {
                        this.model.prompts.countBlockedPopup();
                        break;
                    }
                    const parentTab = this.model.findTab(internalTabId);
                    const newInternalTabId = this.model.addTab(data.url, parentTab?.groupId);
                    const event: BrowserUrlEvent = { url: data.url };
                    browserUrlChanged.send(event);
                    if (event.handled) this.model.tabs.closeTab(newInternalTabId);
                }
                break;
            }
            case "popups-blocked": {
                this.model.prompts.countBlockedPopup();
                break;
            }
            case "permission-request": {
                const prompt = data.permissionRequest as BrowserPermissionPromptData | undefined;
                if (prompt && this.model.state.get().tabs.some((tab) => tab.id === internalTabId)) {
                    this.model.prompts.enqueuePermission(prompt, internalTabId);
                }
                break;
            }
            case "ai-vision-signal":
                this.model.pageRemote.onSignal(internalTabId, data);
                break;
            case "context-menu": {
                const webview = this.get(internalTabId);
                if (!webview) break;
                await showBrowserContextMenu({ model: this.model, webview, internalTabId, data });
                break;
            }
        }
    };

}
