import { createElement, ReactNode } from "react";
const { ipcRenderer } = require("electron");
import { IEditorState } from "../../../shared/types";
import { getDefaultEditorModelState, EditorModel } from "../base";
import { TComponentState } from "../../core/state/state";
import { globalKeyDown, windowClosing, SubscriptionObject } from "../../core/state/events";
import { pagesModel } from "../../api/pages";
import { IncognitoIcon, TorIcon } from "../../theme/language-icons";
import { GlobeIcon, OpenLinkIcon } from "../../theme/icons";
import { settings, BrowserProfile } from "../../api/settings";
import { DEFAULT_BROWSER_COLOR } from "../../theme/palette-colors";
import { BrowserChannel } from "../../../ipc/browser-ipc";
import { TorChannel } from "../../../ipc/tor-ipc";
import { globalPopupRateLimiter } from "../../../ipc/popup-rate-limiter";
import { searchHistoryManager } from "./browser-search-history";
import { BrowserBookmarks } from "./BrowserBookmarks";
import { BrowserWebviewModel } from "./BrowserWebviewModel";
import { BrowserUrlBarModel } from "./BrowserUrlBarModel";
import { BrowserBookmarksUIModel } from "./BrowserBookmarksUIModel";

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

export interface BrowserEditorState extends IEditorState {
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
    /** Whether this is a Tor browsing session. */
    isTor: boolean;
    /** Tor connection status. */
    torStatus: "disconnected" | "connecting" | "connected" | "error";
    /** Accumulated Tor log text (stdout from tor.exe). */
    torLog: string;
    /** Whether the Tor status overlay is visible. */
    torOverlayVisible: boolean;
    /** Page-level mute — mutes all internal tabs. */
    pageMuted: boolean;
    /** True if any internal tab is currently emitting audio (for PageTab icon). */
    _anyTabAudible: boolean;
    /** Selected search engine ID (default: "google"). */
    searchEngineId: string;
    /** Last search query typed by the user (used when switching engines on path-based URLs). */
    lastSearchQuery: string;

    // -- Ephemeral state (managed by sub-models, not persisted) --

    /** Current text in URL input (managed by BrowserUrlBarModel). */
    urlInput: string;
    /** Whether the URL suggestions dropdown is visible. */
    suggestionsOpen: boolean;
    /** Whether the user has typed in the URL bar (vs just focused it). */
    userHasTyped: boolean;
    /** Keyboard-navigated suggestion index (-1 = none). */
    hoveredIndex: number;
    /** Loaded search history entries for the suggestions dropdown. */
    searchEntries: string[];
    /** Whether a context menu popup is open (shows transparent overlay). */
    popupOpen: boolean;
    /** Whether the bookmarks drawer is visible. */
    bookmarksOpen: boolean;
    /** Bookmarks drawer width in pixels. */
    bookmarksWidth: number;
    /** Whether the current URL is bookmarked (star button state). */
    isBookmarked: boolean;
    /** Whether bookmarks have been initialized. */
    bookmarksReady: boolean;

    /** Number of popups/tabs blocked by rate limiting since last dismiss. */
    blockedPopupCount: number;

    /** Whether the find-in-page bar is visible. */
    findBarVisible: boolean;
    /** Current find-in-page search text. */
    findText: string;
    /** Active match ordinal (0-based). */
    findActiveMatch: number;
    /** Total number of matches found. */
    findTotalMatches: number;
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

export const getDefaultBrowserPageState = (): BrowserEditorState => {
    const tab = createTab();
    return {
        ...getDefaultEditorModelState(),
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
        isTor: false,
        torStatus: "disconnected",
        torLog: "",
        torOverlayVisible: false,
        pageMuted: false,
        _anyTabAudible: false,
        searchEngineId: "google",
        lastSearchQuery: "",
        // Ephemeral state (managed by sub-models)
        urlInput: DEFAULT_URL,
        suggestionsOpen: false,
        userHasTyped: false,
        hoveredIndex: -1,
        searchEntries: [],
        popupOpen: false,
        bookmarksOpen: false,
        bookmarksWidth: 0,
        isBookmarked: false,
        bookmarksReady: false,
        blockedPopupCount: 0,
        findBarVisible: false,
        findText: "",
        findActiveMatch: 0,
        findTotalMatches: 0,
    };
};

/** Compute the Electron session partition string for a browser page. */
export function getPartitionString(
    profileName: string,
    isIncognito: boolean,
    incognitoId?: string,
    isTor?: boolean,
    torId?: string,
): string {
    if (isTor) {
        return `browser-tor-${torId || crypto.randomUUID()}`;
    }
    if (isIncognito) {
        return `browser-incognito-${incognitoId || crypto.randomUUID()}`;
    }
    return `persist:browser-${profileName || "default"}`;
}

export class BrowserEditorModel extends EditorModel<BrowserEditorState, void> {
    noLanguage = true;
    skipSave = true;

    /** Sub-model: webview refs, IPC events, context menu, keyboard shortcuts. */
    readonly webview: BrowserWebviewModel;
    /** Sub-model: URL input, suggestions, search engine selector. */
    readonly urlBar: BrowserUrlBarModel;
    /** Sub-model: bookmarks drawer, star button, image discovery. */
    readonly bookmarksUI: BrowserBookmarksUIModel;

    private keyDownSub: SubscriptionObject;
    private windowClosingSub: SubscriptionObject;

    constructor(state: TComponentState<BrowserEditorState>) {
        super(state);
        this.webview = new BrowserWebviewModel(this);
        this.urlBar = new BrowserUrlBarModel(this);
        this.bookmarksUI = new BrowserBookmarksUIModel(this);
        this.keyDownSub = globalKeyDown.subscribe((e) => this.handleGlobalKeyDown(e!));
        this.windowClosingSub = windowClosing.subscribe(() => this.handleWindowClosing());
        // Preload bookmarks silently after a short delay (don't block browser page opening)
        setTimeout(() => this.preloadBookmarks(), 300);
    }

    /** Stable random ID for incognito partitions (generated once per model instance). */
    private incognitoId = crypto.randomUUID();
    /** Stable random ID for Tor partitions (generated once per model instance). */
    private torId = crypto.randomUUID();

    /** Electron session partition string, derived from profile state. */
    get partition(): string {
        const s = this.state.get();
        return getPartitionString(s.profileName, s.isIncognito, this.incognitoId, s.isTor, this.torId);
    }

    /** Per-tab actual current URL (may differ from state after redirects). Keyed by internalTabId. */
    currentUrls = new Map<string, string>();
    private faviconCache = new Map<string, string>();

    /** Lazily initialized bookmarks model (null until user opens bookmarks). */
    bookmarks: BrowserBookmarks | null = null;

    /** Get the bookmarks file path for the current profile from settings. */
    getBookmarksFilePath(): string {
        const { profileName, isIncognito, isTor } = this.state.get();
        if (isTor) {
            return settings.get("tor.bookmarks-file") || "";
        }
        if (isIncognito) {
            return settings.get("browser-incognito-bookmarks-file") || "";
        }
        if (profileName) {
            const profiles = settings.get("browser-profiles");
            const profile = profiles.find((p: BrowserProfile) => p.name === profileName);
            return profile?.bookmarksFile || "";
        }
        // Default profile — check if current default-profile setting points to a named profile
        const defaultName = settings.get("browser-default-profile");
        if (defaultName) {
            const profiles = settings.get("browser-profiles");
            const profile = profiles.find((p: BrowserProfile) => p.name === defaultName);
            return profile?.bookmarksFile || "";
        }
        return settings.get("browser-default-bookmarks-file") || "";
    }

    /**
     * Preload bookmarks silently (no password dialog for encrypted files).
     * Called automatically after browser page is created.
     */
    preloadBookmarks = async (): Promise<void> => {
        const filePath = this.getBookmarksFilePath();
        if (!filePath) return; // no bookmarks configured
        if (this.bookmarks) return; // already loaded
        const bm = new BrowserBookmarks(filePath);
        const ok = await bm.init({ silent: true });
        if (!ok) {
            await bm.dispose();
            return; // encrypted or failed — user will trigger manually
        }
        this.bookmarks = bm;
        bm.linkModel.onInternalLinkOpen = (url) => this.bookmarksUI.handleBookmarkLinkClick(url);
        bm.linkModel.onGetLinkMenuItems = (link) => link.href ? [{
            label: "Open in New Tab",
            icon: createElement(OpenLinkIcon),
            onClick: () => this.addTab(link.href),
        }] : [];
        this.state.update((s) => { s.bookmarksReady = true; });
    };

    /** Initialize bookmarks from a file path. Returns null if user cancels (e.g. encrypted file). */
    async initBookmarks(filePath: string): Promise<BrowserBookmarks | null> {
        if (this.bookmarks) {
            await this.bookmarks.dispose();
        }
        const bm = new BrowserBookmarks(filePath);
        const ok = await bm.init();
        if (!ok) {
            await bm.dispose();
            return null;
        }
        this.bookmarks = bm;
        bm.linkModel.onInternalLinkOpen = (url) => this.bookmarksUI.handleBookmarkLinkClick(url);
        bm.linkModel.onGetLinkMenuItems = (link) => link.href ? [{
            label: "Open in New Tab",
            icon: createElement(OpenLinkIcon),
            onClick: () => this.addTab(link.href),
        }] : [];
        return this.bookmarks;
    }

    // -------------------------------------------------------------------------
    // Tor proxy
    // -------------------------------------------------------------------------

    /** Listener for Tor log events from the main process. */
    private torLogListener = (_event: any, line: string) => {
        this.state.update((s) => {
            s.torLog += (s.torLog ? "\n" : "") + line;
        });
    };

    /** Start Tor proxy for this page's partition. Shows overlay with progress. */
    initTorProxy = async (): Promise<{ success: boolean; error?: string }> => {
        this.state.update((s) => {
            s.torStatus = "connecting";
            s.torOverlayVisible = true;
            s.torLog = "";
        });
        ipcRenderer.on(TorChannel.log, this.torLogListener);

        const torExePath = settings.get("tor.exe-path");
        const socksPort = settings.get("tor.socks-port");
        const result = await ipcRenderer.invoke(
            TorChannel.start, torExePath, socksPort, this.partition,
        );

        this.state.update((s) => {
            s.torStatus = result.success ? "connected" : "error";
            if (result.error) {
                s.torLog += (s.torLog ? "\n" : "") + result.error;
            }
            if (result.success) {
                // Auto-hide overlay after brief delay
                setTimeout(() => {
                    this.state.update((s2) => { s2.torOverlayVisible = false; });
                }, 500);
            }
        });
        return result;
    };

    /** Reconnect Tor (e.g. after session restore). */
    reconnectTor = async (): Promise<void> => {
        await this.initTorProxy();
    };

    /** Toggle the Tor status overlay visibility. */
    toggleTorOverlay = () => {
        this.state.update((s) => { s.torOverlayVisible = !s.torOverlayVisible; });
    };

    /** Release Tor resources when the renderer window is closing. */
    private handleWindowClosing = () => {
        const s = this.state.get();
        if (s.isTor) {
            ipcRenderer.removeListener(TorChannel.log, this.torLogListener);
            ipcRenderer.invoke(TorChannel.stop, this.partition);
        }
    };

    async dispose(): Promise<void> {
        this.keyDownSub.unsubscribe();
        this.windowClosingSub.unsubscribe();
        this.bookmarksUI.dispose();
        if (this.bookmarks) {
            await this.bookmarks.dispose();
            this.bookmarks = null;
        }

        const s = this.state.get();

        // Clean up Tor listener and stop partition
        if (s.isTor) {
            ipcRenderer.removeListener(TorChannel.log, this.torLogListener);
            ipcRenderer.invoke(TorChannel.stop, this.partition);
        }

        await super.dispose();

        // Clear HTTP cache for this partition to free disk space.
        // Skip incognito/tor — no persist: prefix means no disk storage.
        if (!s.isIncognito && !s.isTor) {
            ipcRenderer.invoke(BrowserChannel.clearCache, this.partition);
        }
    }

    /** Handle global keyboard shortcuts when this browser page is active. */
    private handleGlobalKeyDown = (e: KeyboardEvent) => {
        if (e.defaultPrevented) return;
        if (pagesModel.activePage !== this.page) return;

        const keyLower = e.key.toLowerCase();

        // F5 / Ctrl+F5 / Ctrl+R / Ctrl+Shift+R — reload
        if (e.key === "F5" || (keyLower === "r" && e.ctrlKey)) {
            e.preventDefault();
            if (e.key === "F5" ? e.ctrlKey : e.shiftKey) {
                this.webview.getActiveWebview()?.reloadIgnoringCache();
            } else {
                this.webview.reloadOrStop();
            }
            return;
        }
        // F12 — devtools
        if (e.key === "F12") {
            e.preventDefault();
            this.webview.openDevTools();
            return;
        }
        // Ctrl+F — open find bar
        if (keyLower === "f" && e.ctrlKey) {
            e.preventDefault();
            this.webview.openFind();
            return;
        }
        // Escape — close find bar first, then stop loading
        if (e.key === "Escape") {
            e.preventDefault();
            if (this.state.get().findBarVisible) {
                this.webview.closeFind();
            } else {
                this.webview.getActiveWebview()?.stop();
            }
            return;
        }
        // Alt+Left / Alt+Right — back / forward
        if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
            e.preventDefault();
            if (e.key === "ArrowLeft") {
                this.webview.goBack();
            } else {
                this.webview.goForward();
            }
            return;
        }
        // Alt+Home — go to home page
        if (e.altKey && e.key === "Home") {
            e.preventDefault();
            this.goHome();
            return;
        }
    };

    async restore() {
        await super.restore();
        const s = this.state.get();
        if (s.url && s.url !== DEFAULT_URL) {
            this.state.update((st) => {
                st.title = st.pageTitle || "Browser";
            });
        }
    }

    getRestoreData(): Partial<BrowserEditorState> {
        const data = super.getRestoreData() as Partial<BrowserEditorState>;
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
        data.isTor = s.isTor;
        data.searchEngineId = s.searchEngineId;
        data.lastSearchQuery = s.lastSearchQuery;
        // Top-level url = active tab's actual URL
        const activeTab = s.tabs.find((t) => t.id === s.activeTabId);
        data.url = activeTab
            ? this.currentUrls.get(activeTab.id) || activeTab.url
            : s.url;
        return data;
    }

    applyRestoreData(data: Partial<BrowserEditorState>): void {
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
            if (data.isTor !== undefined) {
                s.isTor = data.isTor;
                if (data.isTor) {
                    // After restore: show overlay with "Reconnect", clear tabs
                    s.torStatus = "disconnected";
                    s.torOverlayVisible = true;
                    const fresh = createTab();
                    s.tabs = [fresh];
                    s.activeTabId = fresh.id;
                    s.url = DEFAULT_URL;
                    s.pageTitle = "";
                    s.title = "Browser";
                }
            }
            if (data.searchEngineId) s.searchEngineId = data.searchEngineId;
            if (data.lastSearchQuery) s.lastSearchQuery = data.lastSearchQuery;
        });
    }

    getIcon = (): ReactNode => {
        const s = this.state.get();
        if (s.isTor) {
            return createElement(TorIcon);
        }
        if (s.isIncognito) {
            return createElement(IncognitoIcon);
        }
        return createElement(GlobeIcon, { color: this.resolvedColor });
    };

    /** Resolved icon color: profile color for named profiles, default browser color otherwise. */
    get resolvedColor(): string {
        const profileName = this.state.get().profileName;
        if (profileName) {
            const profiles = settings.get("browser-profiles");
            return profiles.find((p: BrowserProfile) => p.name === profileName)?.color || DEFAULT_BROWSER_COLOR;
        }
        // No explicit profile — resolve from the default profile setting
        const defaultName = settings.get("browser-default-profile");
        if (defaultName) {
            const profiles = settings.get("browser-profiles");
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
        // Add hostname to search history (unless incognito/tor)
        const s = this.state.get();
        if (!s.isIncognito && !s.isTor) {
            try {
                const hostname = new URL(url).hostname;
                if (hostname) {
                    searchHistoryManager.get(s.profileName, false)?.add(hostname);
                }
            } catch { /* invalid URL */ }
        }
    };

    /** Add a new internal tab after the active tab and switch to it. Returns the new tab's ID. */
    addTab = (url = DEFAULT_URL): string => {
        const tab = createTab(url);
        this.state.update((s) => {
            const activeIdx = s.tabs.findIndex((t) => t.id === s.activeTabId);
            s.tabs.splice(activeIdx + 1, 0, tab);
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
    moveTab = (fromId: string, toId: string) => {
        if (fromId === toId) return;
        this.state.update((s) => {
            const fromIndex = s.tabs.findIndex((t) => t.id === fromId);
            const toIndex = s.tabs.findIndex((t) => t.id === toId);
            if (fromIndex === -1 || toIndex === -1) return;
            const [moved] = s.tabs.splice(fromIndex, 1);
            s.tabs.splice(toIndex, 0, moved);
        });
    };

    switchTab = (internalTabId: string) => {
        this.state.update((s) => {
            if (s.activeTabId === internalTabId) return;
            const tab = s.tabs.find((t) => t.id === internalTabId);
            if (!tab) return;
            s.activeTabId = internalTabId;
            this.syncTopLevelFromTab(s, tab);
            // Close find bar — search context changes with the tab
            if (s.findBarVisible) {
                s.findBarVisible = false;
                s.findText = "";
                s.findActiveMatch = 0;
                s.findTotalMatches = 0;
            }
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

    /** Dismiss the "popups blocked" notification bar. */
    dismissBlockedPopups = () => {
        this.state.update((s) => { s.blockedPopupCount = 0; });
    };

    /** Allow popups for this page (disables rate limiting). */
    allowPopups = () => {
        this.webview.popupsAllowed = true;
        globalPopupRateLimiter.allow("tabs");
        ipcRenderer.send(BrowserChannel.allowPopups);
        this.state.update((s) => { s.blockedPopupCount = 0; });
    };

    setTabsPanelWidth = (width: number) => {
        const clamped = Math.max(34, Math.min(400, width));
        this.state.update((s) => {
            s.tabsPanelWidth = clamped;
        });
    };

    private syncTopLevelFromTab(s: BrowserEditorState, tab: BrowserTabData) {
        s.url = this.currentUrls.get(tab.id) || tab.url;
        s.pageTitle = tab.pageTitle;
        s.loading = tab.loading;
        s.canGoBack = tab.canGoBack;
        s.canGoForward = tab.canGoForward;
        s.favicon = tab.favicon;
        s.title = tab.pageTitle || "Browser";
    }
}

export function newBrowserEditorModel(): BrowserEditorModel {
    return new BrowserEditorModel(
        new TComponentState(getDefaultBrowserPageState()),
    );
}
