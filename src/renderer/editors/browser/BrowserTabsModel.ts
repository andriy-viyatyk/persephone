import { TOneState } from "../../core/state/state";
import type { BrowserEditor } from "./BrowserEditor";
import { isPrivateBrowserSession } from "./agent-access";
import type {
    BrowserTabData,
} from "./browser-state";
import {
    DEFAULT_URL,
    createBrowserTab,
    createTabGroupId,
    browserPageTitle,
} from "./browser-state";
/** Owns internal browser tabs and tab-scoped navigation state. */
export class BrowserTabsModel {
    readonly materializationRevision = new TOneState(0);
    private readonly materialized = new Set<string>();
    isMaterialized = (id: string): boolean => this.materialized.has(id);
    materialize = (id: string): void => {
        if (this.materialized.has(id) || !this.model.state.get().tabs.some((tab) => tab.id === id)) return;
        this.materialized.add(id);
        this.materializationRevision.set(this.materializationRevision.get() + 1);
    };
    resetMaterialized = (id: string): void => {
        this.materialized.clear();
        this.materialize(id);
    };
    private removeMaterialized = (id: string): void => {
        this.materialized.delete(id);
        this.model.webview.clearLoadedWaiters(id);
    };
    private readonly faviconCache = new Map<string, string>();
    private activeTabHistory: string[] = [];
    constructor(readonly model: BrowserEditor) {
        this.materialized.add(model.state.get().activeTabId);
    }
    cacheFavicon = (url: string, favicon: string) => {
        try {
            this.faviconCache.set(new URL(url).origin, favicon);
        } catch {
            // Invalid URL
        }
    };
    getCachedFavicon = (url: string): string => {
        try {
            return this.faviconCache.get(new URL(url).origin) || "";
        } catch {
            return "";
        }
    };
    onFavicon = (tabId: string, pageUrl: string, faviconUrl: string): void => {
        if (!faviconUrl) return;
        const webview = this.model.webview.get(tabId);
        if (!webview) return;
        this.cacheFavicon(pageUrl, faviconUrl); this.model.updateTab(tabId, { favicon: faviconUrl });
        if (isPrivateBrowserSession(this.model.state.get())) return;
        const routedUrl = this.model.network.routedFetchUrl(faviconUrl);
        if (routedUrl === null) return;
        void import("../../components/icons/favicon-cache").then((cache) => {
            if (this.model.webview.get(tabId) !== webview) return;
            const hostname = cache.getHostname(pageUrl);
            if (!hostname) return;
            const links = this.model.bookmarks.bookmarks?.linkEditor.state.get().data.links;
            if (cache.consumeFaviconSaveRequest(hostname) || links?.some((link) => cache.getHostname(link.href) === hostname)) cache.saveFavicon(hostname, faviconUrl, routedUrl);
        });
    };
    addTab = (url = DEFAULT_URL, parentGroupId?: string): string => {
        const tab = createBrowserTab(url, parentGroupId);
        this.materialized.add(tab.id);
        this.model.state.update((s) => {
            if (parentGroupId) {
                const activeIdx = s.tabs.findIndex((t) => t.id === s.activeTabId);
                s.tabs.splice(activeIdx + 1, 0, tab);
            } else {
                s.tabs.push(tab);
            }
            this.activeTabHistory.push(s.activeTabId);
            s.activeTabId = tab.id;
        });
        this.syncPageTitle();
        this.model.urlBar.syncFromUrl(tab.url);
        this.materializationRevision.set(this.materializationRevision.get() + 1);
        return tab.id;
    };
    closeTab = (internalTabId: string) => {
        const state = this.model.state.get();
        if (!state.tabs.some((tab) => tab.id === internalTabId)) return;
        this.removeMaterialized(internalTabId);
        this.model.releaseTab(internalTabId);
        this.model.state.update((s) => {
            const idx = s.tabs.findIndex((t) => t.id === internalTabId);
            if (idx < 0) return;
            this.activeTabHistory = this.activeTabHistory.filter((id) => id !== internalTabId);
            if (s.tabs.length <= 1) {
                const fresh = this.createBlankTab();
                s.tabs = [fresh];
                s.activeTabId = fresh.id;
                this.activeTabHistory = [];
                return;
            }
            s.tabs.splice(idx, 1);
            if (s.activeTabId === internalTabId) {
                const tabIds = new Set(s.tabs.map((t) => t.id));
                let newActive: BrowserTabData | undefined;
                while (this.activeTabHistory.length > 0) {
                    const prevId = this.activeTabHistory.pop();
                    if (prevId && tabIds.has(prevId)) {
                        newActive = this.model.findTab(prevId);
                        break;
                    }
                }
                if (!newActive) newActive = s.tabs[Math.min(idx, s.tabs.length - 1)];
                s.activeTabId = newActive.id;
            }
        });
        this.syncPageTitle();
        this.model.urlBar.syncFromUrl(this.model.activeTab?.url || "");
        this.refreshAnyTabAudible();
        this.materialize(this.model.state.get().activeTabId);
    };
    /** A closed tab never reports `audible: false`, so recompute the page-tab sound indicator
     *  from the tabs that remain whenever tabs are removed. */
    private refreshAnyTabAudible = (): void => {
        const anyAudible = this.model.state.get().tabs.some((tab) => tab.audible);
        if (this.model.state.get()._anyTabAudible === anyAudible) return;
        this.model.state.update((s) => {
            s._anyTabAudible = anyAudible;
        });
    };
    closeOtherTabs = (internalTabId: string) => {
        const state = this.model.state.get();
        const tab = this.model.findTab(internalTabId);
        if (!tab) return;
        for (const candidate of state.tabs) {
            if (candidate.id !== internalTabId) {
                this.removeMaterialized(candidate.id);
                this.model.releaseTab(candidate.id);
            }
        }
        this.model.state.update((s) => {
            s.tabs = [tab];
            s.activeTabId = tab.id;
            this.activeTabHistory = [];
        });
        this.syncPageTitle();
        this.model.urlBar.syncFromUrl(tab.url);
        this.refreshAnyTabAudible();
        this.materialize(internalTabId);
    };
    closeTabsBelow = (internalTabId: string) => {
        const state = this.model.state.get();
        const idx = state.tabs.findIndex((t) => t.id === internalTabId);
        if (idx < 0 || idx >= state.tabs.length - 1) return;
        const removed = state.tabs.slice(idx + 1);
        for (const tab of removed) {
            this.removeMaterialized(tab.id);
            this.model.releaseTab(tab.id);
        }
        this.model.state.update((s) => {
            const removed = s.tabs.splice(idx + 1);
            const removedIds = new Set(removed.map((t) => t.id));
            this.activeTabHistory = this.activeTabHistory.filter((id) => !removedIds.has(id));
            if (!s.tabs.find((tab) => tab.id === s.activeTabId)) {
                const tab = s.tabs[idx];
                s.activeTabId = tab.id;
            }
        });
        this.syncPageTitle();
        this.model.urlBar.syncFromUrl(this.model.activeTab?.url || "");
        this.refreshAnyTabAudible();
        this.materialize(this.model.state.get().activeTabId);
    };
    moveTab = (fromId: string, toId: string) => {
        if (fromId === toId) return;
        this.model.state.update((s) => {
            const fromIndex = s.tabs.findIndex((t) => t.id === fromId);
            const toIndex = s.tabs.findIndex((t) => t.id === toId);
            if (fromIndex < 0 || toIndex < 0) return;
            const fromTab = s.tabs[fromIndex];
            const toTab = s.tabs[toIndex];
            if (fromTab.groupId !== toTab.groupId) fromTab.groupId = createTabGroupId();
            const [moved] = s.tabs.splice(fromIndex, 1);
            s.tabs.splice(toIndex, 0, moved);
        });
    };

    switchTab = (internalTabId: string) => {
        const state = this.model.state.get();
        if (state.activeTabId === internalTabId || !state.tabs.some((tab) => tab.id === internalTabId)) return;
        this.materialize(internalTabId);
        this.model.pageRemote.invalidateBinding();
        const tab = this.model.findTab(internalTabId);
        if (!tab) return;
        this.model.state.update((s) => {
            this.activeTabHistory.push(s.activeTabId);
            s.activeTabId = internalTabId;
            if (this.model.find.state.get().findBarVisible) this.model.find.reset();
        });
        this.syncPageTitle();
        this.model.urlBar.syncFromUrl(tab.url);
    };

    toggleMute = (internalTabId: string) => {
        const s = this.model.state.get();
        const tab = this.model.findTab(internalTabId);
        if (!tab) return;
        const newMuted = !tab.muted;
        this.model.updateTab(internalTabId, { muted: newMuted });
        this.model.guest.setMuted(internalTabId, newMuted || s.pageMuted);
    };

    toggleMuteAll = () => {
        const s = this.model.state.get();
        const newPageMuted = !s.pageMuted;
        this.model.state.update((st) => { st.pageMuted = newPageMuted; });
        for (const tab of s.tabs) {
            this.model.guest.setMuted(tab.id, tab.muted || newPageMuted);
        }
    };

    setPanelWidth = (width: number) => {
        const clamped = Math.max(34, Math.min(400, width));
        this.model.state.update((s) => { s.tabsPanelWidth = clamped; });
    };

    dispose = async () => {
        for (const id of this.model.state.get().tabs.map((tab) => tab.id)) this.removeMaterialized(id);
        this.materialized.clear();
    };

    private createBlankTab = (): BrowserTabData => createBrowserTab();

    private syncPageTitle = (): void => {
        const tab = this.model.activeTab;
        this.model.state.update((state) => { state.title = browserPageTitle(state, tab?.pageTitle); });
    };

}
