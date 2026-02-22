import { createElement, ReactNode } from "react";
const { ipcRenderer } = require("electron");
import { IPage } from "../../../shared/types";
import { getDefaultPageModelState, PageModel } from "../base";
import { TComponentState } from "../../core/state/state";
import { IncognitoIcon } from "../../theme/language-icons";
import { GlobeIcon } from "../../theme/icons";
import { appSettings, BrowserProfile } from "../../store/app-settings";
import { DEFAULT_BROWSER_COLOR } from "../../theme/palette-colors";
import { BrowserChannel } from "../../../ipc/browser-ipc";
import { searchHistoryManager } from "./browser-search-history";

// ============================================================================
// Search Engines
// ============================================================================

export interface SearchEngine {
    id: string;
    label: string;
    /** URL template — `%s` is replaced with the encoded search query. */
    searchUrl: string;
    /** Hostname(s) that identify this engine in the URL bar. */
    hosts: string[];
    /** URL search param that contains the query (e.g. "q" for Google). */
    queryParam: string;
    /** Optional path prefix to detect this engine even when query param is missing
     *  (e.g. Perplexity redirects `/search?q=foo` to `/search/foo-<hash>`). */
    searchPathPrefix?: string;
}

export const SEARCH_ENGINES: SearchEngine[] = [
    {
        id: "google",
        label: "Google",
        searchUrl: "https://www.google.com/search?q=%s",
        hosts: ["www.google.com", "google.com"],
        queryParam: "q",
    },
    {
        id: "bing",
        label: "Bing",
        searchUrl: "https://www.bing.com/search?q=%s",
        hosts: ["www.bing.com", "bing.com"],
        queryParam: "q",
    },
    {
        id: "duckduckgo",
        label: "DuckDuckGo",
        searchUrl: "https://duckduckgo.com/?q=%s",
        hosts: ["duckduckgo.com", "www.duckduckgo.com"],
        queryParam: "q",
    },
    {
        id: "yahoo",
        label: "Yahoo",
        searchUrl: "https://search.yahoo.com/search?p=%s",
        hosts: ["search.yahoo.com"],
        queryParam: "p",
    },
    {
        id: "ecosia",
        label: "Ecosia",
        searchUrl: "https://www.ecosia.org/search?q=%s",
        hosts: ["www.ecosia.org", "ecosia.org"],
        queryParam: "q",
    },
    {
        id: "brave",
        label: "Brave",
        searchUrl: "https://search.brave.com/search?q=%s",
        hosts: ["search.brave.com"],
        queryParam: "q",
    },
    {
        id: "startpage",
        label: "Startpage",
        searchUrl: "https://www.startpage.com/sp/search?query=%s",
        hosts: ["www.startpage.com", "startpage.com"],
        queryParam: "query",
    },
    {
        id: "qwant",
        label: "Qwant",
        searchUrl: "https://www.qwant.com/?q=%s",
        hosts: ["www.qwant.com", "qwant.com"],
        queryParam: "q",
    },
    {
        id: "baidu",
        label: "Baidu",
        searchUrl: "https://www.baidu.com/s?wd=%s",
        hosts: ["www.baidu.com", "baidu.com"],
        queryParam: "wd",
    },
    {
        id: "perplexity",
        label: "Perplexity",
        searchUrl: "https://www.perplexity.ai/search?q=%s",
        hosts: ["www.perplexity.ai", "perplexity.ai"],
        queryParam: "q",
        searchPathPrefix: "/search",
    },
    {
        id: "gibiru",
        label: "Gibiru",
        searchUrl: "https://gibiru.com/results.html?q=%s",
        hosts: ["gibiru.com", "www.gibiru.com"],
        queryParam: "q",
    },
];

/** Try to detect a search engine from a URL and extract the query string. */
export function detectSearchEngine(url: string): { engine: SearchEngine; query: string } | null {
    try {
        const parsed = new URL(url);
        for (const engine of SEARCH_ENGINES) {
            if (engine.hosts.includes(parsed.hostname)) {
                const query = parsed.searchParams.get(engine.queryParam);
                if (query) {
                    return { engine, query };
                }
                // Fallback: some engines redirect to a path-based URL (e.g. Perplexity
                // rewrites /search?q=foo → /search/foo-<hash>). Detect by path prefix.
                if (engine.searchPathPrefix && parsed.pathname.startsWith(engine.searchPathPrefix)) {
                    return { engine, query: "" };
                }
            }
        }
    } catch {
        // Invalid URL
    }
    return null;
}

/** State for a single internal browser tab. */
export interface BrowserTabData {
    id: string;
    url: string;
    pageTitle: string;
    loading: boolean;
    canGoBack: boolean;
    canGoForward: boolean;
    favicon: string;
    /** Whether the webview is currently emitting audio. */
    audible: boolean;
    /** Whether the webview is muted by the user. */
    muted: boolean;
    /** The "home" URL for this tab — set on user-initiated navigation or tab creation with a URL. */
    homeUrl: string;
    /** Navigation history for this tab — most recent URL first. */
    navHistory: string[];
}

export interface BrowserPageState extends IPage {
    /** Active internal tab's URL (kept in sync for toolbar display). */
    url: string;
    pageTitle: string;
    loading: boolean;
    canGoBack: boolean;
    canGoForward: boolean;
    favicon: string;
    /** All internal browser tabs. */
    tabs: BrowserTabData[];
    /** ID of the active internal tab. */
    activeTabId: string;
    /** Width of the right-side tabs panel. */
    tabsPanelWidth: number;
    /** Profile name ("" for default). */
    profileName: string;
    /** Whether this is an incognito session. */
    isIncognito: boolean;
    /** Page-level mute — mutes all internal tabs. */
    pageMuted: boolean;
    /** True if any internal tab is currently emitting audio (for PageTab icon). */
    _anyTabAudible: boolean;
    /** Selected search engine ID (default: "google"). */
    searchEngineId: string;
    /** Last search query typed by the user (used when switching engines on path-based URLs). */
    lastSearchQuery: string;
}

const DEFAULT_URL = "about:blank";

let nextInternalTabId = 1;

export function createInternalTabId(): string {
    return `bt-${nextInternalTabId++}`;
}

function createTab(url = DEFAULT_URL): BrowserTabData {
    return {
        id: createInternalTabId(),
        url,
        pageTitle: "",
        loading: false,
        canGoBack: false,
        canGoForward: false,
        favicon: "",
        audible: false,
        muted: false,
        homeUrl: url !== DEFAULT_URL ? url : "",
        navHistory: [],
    };
}

export const getDefaultBrowserPageState = (): BrowserPageState => {
    const tab = createTab();
    return {
        ...getDefaultPageModelState(),
        type: "browserPage",
        title: "Browser",
        editor: "browser-view",
        url: DEFAULT_URL,
        pageTitle: "",
        loading: false,
        canGoBack: false,
        canGoForward: false,
        favicon: "",
        tabs: [tab],
        activeTabId: tab.id,
        tabsPanelWidth: 34,
        profileName: "",
        isIncognito: false,
        pageMuted: false,
        _anyTabAudible: false,
        searchEngineId: "google",
        lastSearchQuery: "",
    };
};

/** Compute the Electron session partition string for a browser page. */
export function getPartitionString(profileName: string, isIncognito: boolean, incognitoId?: string): string {
    if (isIncognito) {
        return `browser-incognito-${incognitoId || crypto.randomUUID()}`;
    }
    return `persist:browser-${profileName || "default"}`;
}

export class BrowserPageModel extends PageModel<BrowserPageState, void> {
    noLanguage = true;
    skipSave = true;

    /** Stable random ID for incognito partitions (generated once per model instance). */
    private incognitoId = crypto.randomUUID();

    /** Electron session partition string, derived from profile state. */
    get partition(): string {
        const s = this.state.get();
        return getPartitionString(s.profileName, s.isIncognito, this.incognitoId);
    }

    /** Per-tab actual current URL (may differ from state after redirects). Keyed by internalTabId. */
    currentUrls = new Map<string, string>();
    private faviconCache = new Map<string, string>();

    async restore() {
        await super.restore();
        const s = this.state.get();
        if (s.url && s.url !== DEFAULT_URL) {
            this.state.update((st) => {
                st.title = st.pageTitle || "Browser";
            });
        }
    }

    getRestoreData(): Partial<BrowserPageState> {
        const data = super.getRestoreData() as Partial<BrowserPageState>;
        const s = this.state.get();
        // Save all tabs with their actual current URLs
        data.tabs = s.tabs.map((t) => ({
            ...t,
            url: this.currentUrls.get(t.id) || t.url,
        }));
        data.activeTabId = s.activeTabId;
        data.tabsPanelWidth = s.tabsPanelWidth;
        data.pageTitle = s.pageTitle;
        data.profileName = s.profileName;
        data.isIncognito = s.isIncognito;
        data.searchEngineId = s.searchEngineId;
        data.lastSearchQuery = s.lastSearchQuery;
        // Top-level url = active tab's actual URL
        const activeTab = s.tabs.find((t) => t.id === s.activeTabId);
        data.url = activeTab
            ? this.currentUrls.get(activeTab.id) || activeTab.url
            : s.url;
        return data;
    }

    applyRestoreData(data: Partial<BrowserPageState>): void {
        super.applyRestoreData(data);
        this.state.update((s) => {
            if (data.tabs && data.tabs.length > 0) {
                // Re-assign fresh IDs to restored tabs
                s.tabs = data.tabs.map((t) => ({
                    ...t,
                    id: createInternalTabId(),
                }));
                // Map activeTabId: if the original activeTabId matches a tab by index, use the new ID
                const origIndex = data.tabs.findIndex(
                    (t) => t.id === data.activeTabId,
                );
                s.activeTabId =
                    origIndex >= 0 ? s.tabs[origIndex].id : s.tabs[0].id;
                // Sync top-level state from active tab
                const active = s.tabs.find((t) => t.id === s.activeTabId);
                if (active) {
                    s.url = active.url;
                    s.pageTitle = active.pageTitle;
                    s.favicon = active.favicon;
                    s.title = active.pageTitle || "Browser";
                }
            } else {
                if (data.url) s.url = data.url;
                if (data.pageTitle) s.pageTitle = data.pageTitle;
            }
            if (data.tabsPanelWidth) s.tabsPanelWidth = data.tabsPanelWidth;
            if (data.profileName !== undefined) s.profileName = data.profileName;
            if (data.isIncognito !== undefined) s.isIncognito = data.isIncognito;
            if (data.searchEngineId) s.searchEngineId = data.searchEngineId;
            if (data.lastSearchQuery) s.lastSearchQuery = data.lastSearchQuery;
        });
    }

    getIcon = (): ReactNode => {
        const s = this.state.get();
        if (s.isIncognito) {
            return createElement(IncognitoIcon);
        }
        return createElement(GlobeIcon, { color: this.resolvedColor });
    };

    /** Resolved icon color: profile color for named profiles, default browser color otherwise. */
    get resolvedColor(): string {
        const profileName = this.state.get().profileName;
        if (profileName) {
            const profiles = appSettings.get("browser-profiles");
            return profiles.find((p: BrowserProfile) => p.name === profileName)?.color || DEFAULT_BROWSER_COLOR;
        }
        // No explicit profile — resolve from the default profile setting
        const defaultName = appSettings.get("browser-default-profile");
        if (defaultName) {
            const profiles = appSettings.get("browser-profiles");
            return profiles.find((p: BrowserProfile) => p.name === defaultName)?.color || DEFAULT_BROWSER_COLOR;
        }
        return DEFAULT_BROWSER_COLOR;
    }

    cacheFavicon = (url: string, favicon: string) => {
        try {
            const origin = new URL(url).origin;
            this.faviconCache.set(origin, favicon);
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

    /** Get the currently selected search engine. */
    getSearchEngine(): SearchEngine {
        const id = this.state.get().searchEngineId;
        return SEARCH_ENGINES.find((e) => e.id === id) || SEARCH_ENGINES[0];
    }

    /** Set the search engine by ID. */
    setSearchEngine = (engineId: string) => {
        this.state.update((s) => { s.searchEngineId = engineId; });
    };

    /** Switch the current search query to a different engine. Also updates the tab's homeUrl. */
    switchSearchEngine = (engineId: string) => {
        const s = this.state.get();
        const currentUrl = this.currentUrls.get(s.activeTabId) || s.url;
        const detected = detectSearchEngine(currentUrl);
        this.setSearchEngine(engineId);
        const query = detected?.query || s.lastSearchQuery;
        if (detected && query) {
            const newEngine = SEARCH_ENGINES.find((e) => e.id === engineId);
            if (newEngine) {
                const newUrl = newEngine.searchUrl.replace("%s", encodeURIComponent(query));
                this.state.update((st) => {
                    st.url = newUrl;
                    const tab = st.tabs.find((t) => t.id === st.activeTabId);
                    if (tab) {
                        tab.url = newUrl;
                        tab.homeUrl = newUrl;
                    }
                });
            }
        }
    };

    navigate = (url: string) => {
        let normalizedUrl = url.trim();
        if (!normalizedUrl) return;

        if (
            !normalizedUrl.startsWith("http://") &&
            !normalizedUrl.startsWith("https://") &&
            !normalizedUrl.startsWith("about:")
        ) {
            if (
                normalizedUrl.includes(".") &&
                !normalizedUrl.includes(" ")
            ) {
                normalizedUrl = "https://" + normalizedUrl;
            } else {
                const engine = this.getSearchEngine();
                this.state.update((s) => { s.lastSearchQuery = normalizedUrl; });
                const st = this.state.get();
                searchHistoryManager.get(st.profileName, st.isIncognito)?.add(normalizedUrl);
                normalizedUrl = engine.searchUrl.replace(
                    "%s",
                    encodeURIComponent(normalizedUrl),
                );
            }
        }

        this.state.update((s) => {
            s.url = normalizedUrl;
            const tab = s.tabs.find((t) => t.id === s.activeTabId);
            if (tab) {
                tab.url = normalizedUrl;
                tab.homeUrl = normalizedUrl;
            }
        });
    };

    /** Navigate the active tab to its home URL. */
    goHome = () => {
        const s = this.state.get();
        const tab = s.tabs.find((t) => t.id === s.activeTabId);
        if (tab?.homeUrl) {
            this.navigate(tab.homeUrl);
        }
    };

    /** Update the active internal tab and sync top-level state. */
    updateTab = (
        internalTabId: string,
        updates: Partial<BrowserTabData>,
    ) => {
        this.state.update((s) => {
            const tab = s.tabs.find((t) => t.id === internalTabId);
            if (!tab) return;
            if (updates.url !== undefined) tab.url = updates.url;
            if (updates.pageTitle !== undefined) tab.pageTitle = updates.pageTitle;
            if (updates.loading !== undefined) tab.loading = updates.loading;
            if (updates.canGoBack !== undefined) tab.canGoBack = updates.canGoBack;
            if (updates.canGoForward !== undefined)
                tab.canGoForward = updates.canGoForward;
            if (updates.favicon !== undefined) tab.favicon = updates.favicon;
            if (updates.audible !== undefined) {
                tab.audible = updates.audible;
                s._anyTabAudible = s.tabs.some((t) => t.audible);
            }
            if (updates.muted !== undefined) tab.muted = updates.muted;

            // Sync top-level state if this is the active tab
            if (internalTabId === s.activeTabId) {
                if (updates.pageTitle !== undefined) {
                    s.pageTitle = updates.pageTitle;
                    s.title = updates.pageTitle || "Browser";
                }
                if (updates.loading !== undefined) s.loading = updates.loading;
                if (updates.canGoBack !== undefined)
                    s.canGoBack = updates.canGoBack;
                if (updates.canGoForward !== undefined)
                    s.canGoForward = updates.canGoForward;
                if (updates.favicon !== undefined) s.favicon = updates.favicon;
            }
        });
    };

    /** Record a navigation in the tab's history and add hostname to search history. */
    addNavHistory = (internalTabId: string, url: string) => {
        if (!url || url === DEFAULT_URL) return;
        this.state.update((s) => {
            const tab = s.tabs.find((t) => t.id === internalTabId);
            if (!tab) return;
            tab.navHistory = [
                url,
                ...tab.navHistory.filter((u) => u !== url),
            ].slice(0, 100);
        });
        // Add hostname to search history (unless incognito)
        const s = this.state.get();
        if (!s.isIncognito) {
            try {
                const hostname = new URL(url).hostname;
                if (hostname) {
                    searchHistoryManager.get(s.profileName, false)?.add(hostname);
                }
            } catch { /* invalid URL */ }
        }
    };

    /** Add a new internal tab and switch to it. Returns the new tab's ID. */
    addTab = (url = DEFAULT_URL): string => {
        const tab = createTab(url);
        this.state.update((s) => {
            s.tabs.push(tab);
            s.activeTabId = tab.id;
            // Sync top-level state
            s.url = tab.url;
            s.pageTitle = tab.pageTitle;
            s.loading = false;
            s.canGoBack = false;
            s.canGoForward = false;
            s.favicon = "";
            s.title = "Browser";
        });
        return tab.id;
    };

    /** Close an internal tab. If it's the active one, switch to adjacent tab.
     *  Closing the last tab replaces it with a fresh about:blank tab. */
    closeTab = (internalTabId: string) => {
        this.state.update((s) => {
            const idx = s.tabs.findIndex((t) => t.id === internalTabId);
            if (idx < 0) return;

            if (s.tabs.length <= 1) {
                // Replace the last tab with a fresh one
                const fresh = createTab();
                s.tabs = [fresh];
                s.activeTabId = fresh.id;
                this.currentUrls.delete(internalTabId);
                this.syncTopLevelFromTab(s, fresh);
                return;
            }

            s.tabs.splice(idx, 1);
            this.currentUrls.delete(internalTabId);

            if (s.activeTabId === internalTabId) {
                // Switch to the tab at same index, or the last one
                const newIdx = Math.min(idx, s.tabs.length - 1);
                const newActive = s.tabs[newIdx];
                s.activeTabId = newActive.id;
                this.syncTopLevelFromTab(s, newActive);
            }
        });
    };

    /** Close all tabs except the specified one. */
    closeOtherTabs = (internalTabId: string) => {
        this.state.update((s) => {
            const tab = s.tabs.find((t) => t.id === internalTabId);
            if (!tab) return;
            for (const t of s.tabs) {
                if (t.id !== internalTabId) {
                    this.currentUrls.delete(t.id);
                }
            }
            s.tabs = [tab];
            s.activeTabId = tab.id;
            this.syncTopLevelFromTab(s, tab);
        });
    };

    /** Close all tabs below (after) the specified one. */
    closeTabsBelow = (internalTabId: string) => {
        this.state.update((s) => {
            const idx = s.tabs.findIndex((t) => t.id === internalTabId);
            if (idx < 0 || idx >= s.tabs.length - 1) return;
            const removed = s.tabs.splice(idx + 1);
            for (const t of removed) {
                this.currentUrls.delete(t.id);
            }
            // If active tab was removed, switch to the specified tab
            if (!s.tabs.find((t) => t.id === s.activeTabId)) {
                const tab = s.tabs[idx];
                s.activeTabId = tab.id;
                this.syncTopLevelFromTab(s, tab);
            }
        });
    };

    /** Switch to a different internal tab. */
    switchTab = (internalTabId: string) => {
        this.state.update((s) => {
            if (s.activeTabId === internalTabId) return;
            const tab = s.tabs.find((t) => t.id === internalTabId);
            if (!tab) return;
            s.activeTabId = internalTabId;
            this.syncTopLevelFromTab(s, tab);
        });
    };

    /** Toggle mute on an internal tab. Effective mute = tabMuted || pageMuted. */
    toggleMute = (internalTabId: string) => {
        const s = this.state.get();
        const tab = s.tabs.find((t) => t.id === internalTabId);
        if (!tab) return;
        const newMuted = !tab.muted;
        this.updateTab(internalTabId, { muted: newMuted });
        const key = `${this.id}/${internalTabId}`;
        ipcRenderer.send(BrowserChannel.setAudioMuted, key, newMuted || s.pageMuted);
    };

    /** Toggle page-level mute for all internal tabs. */
    toggleMuteAll = () => {
        const s = this.state.get();
        const newPageMuted = !s.pageMuted;
        this.state.update((st) => { st.pageMuted = newPageMuted; });
        for (const tab of s.tabs) {
            const key = `${this.id}/${tab.id}`;
            ipcRenderer.send(BrowserChannel.setAudioMuted, key, tab.muted || newPageMuted);
        }
    };

    setTabsPanelWidth = (width: number) => {
        const clamped = Math.max(34, Math.min(400, width));
        this.state.update((s) => {
            s.tabsPanelWidth = clamped;
        });
    };

    private syncTopLevelFromTab(s: BrowserPageState, tab: BrowserTabData) {
        s.url = this.currentUrls.get(tab.id) || tab.url;
        s.pageTitle = tab.pageTitle;
        s.loading = tab.loading;
        s.canGoBack = tab.canGoBack;
        s.canGoForward = tab.canGoForward;
        s.favicon = tab.favicon;
        s.title = tab.pageTitle || "Browser";
    }
}

export function newBrowserPageModel(): BrowserPageModel {
    return new BrowserPageModel(
        new TComponentState(getDefaultBrowserPageState()),
    );
}
