import { PAGE_ZOOM_DEFAULT, isValidPageZoom } from "../../../shared/browser-zoom";
import { englishMessage } from "../../../shared/i18n/t";
const { ipcRenderer } = require("electron");
import { TComponentState } from "../../core/state/state";
import {
    EditorModel,
    type RestoreData,
} from "../base/EditorModel";
import { ComponentQueue } from "../../core/state/ComponentQueue";
import type { EditorDescriptor } from "../../../shared/persistence";
import { globalKeyDown } from "../../core/state/events";
import { pages } from "../../api/pages";
import { IncognitoIcon, TorIcon } from "../../theme/language-icons";
import { GlobeIcon } from "../../theme/icons";
import { settings } from "../../api/settings";
import type { BrowserProfile } from "../../api/settings-schema";
import { DEFAULT_BROWSER_COLOR } from "../../theme/palette-colors";
import { BrowserChannel } from "../../../ipc/browser-ipc";
import type { BrowserSitePermissionKey, BrowserSitePermissions } from "../../../ipc/browser-ipc";
import { globalPopupRateLimiter } from "../../../ipc/popup-rate-limiter";
import { searchHistoryManager } from "./browser-search-history";
import { errMessage } from "../../../shared/utils";
import { BrowserWebviewModel } from "./BrowserWebviewModel";
import { BrowserTranslationController } from "./BrowserTranslationController";
import { BrowserSiteExtensionController } from "./BrowserSiteExtensionController";
import { BrowserUrlBarModel } from "./BrowserUrlBarModel";
import { BrowserBookmarksUIModel } from "./BrowserBookmarksUIModel";
import { BrowserTargetModel } from "./BrowserTargetModel";
import { BrowserTabsModel } from "./BrowserTabsModel";
import { BrowserTorModel } from "./BrowserTorModel";
import { BrowserProfileNetworkModel } from "./BrowserProfileNetworkModel";
import {
    type BrowserEditorState,
    type BrowserTabData,
    DEFAULT_URL,
    createInternalTabId,
    createTabGroupId,
    browserPageTitle,
    getPartitionString,
} from "./browser-state";
import { SEARCH_ENGINES, detectSearchEngine, type SearchEngine } from "./search-engines";
import { isPrivateBrowserSession } from "./agent-access";
import { BrowserPageRemote } from "./BrowserPageRemote";
import { BrowserFindModel } from "./BrowserFindModel";
import { BrowserShortcutTable } from "./BrowserShortcutTable";

export type BrowserQueueEvent = { type: "focus" };
export type BrowserQueueRequest = never;

export class BrowserEditor extends EditorModel<
    BrowserEditorState,
    void,
    BrowserQueueEvent
> {
    readonly editorId = "browser-view";
    noLanguage = true;
    skipSave = true;
    /** Sub-model: webview refs, IPC events, context menu, keyboard shortcuts. */
    readonly webview: BrowserWebviewModel;
    /** Owns find-in-page state and commands. */
    readonly find: BrowserFindModel;
    /** User-facing Translate workflow for the active browser page. */
    readonly translation: BrowserTranslationController;
    readonly siteExtensions: BrowserSiteExtensionController;
    readonly pageRemote: BrowserPageRemote;
    /** Sub-model: URL input, suggestions, search engine selector. */
    readonly urlBar: BrowserUrlBarModel;
    /** Sub-model: bookmarks drawer, star button, image discovery. */
    readonly bookmarksUI: BrowserBookmarksUIModel;
    /** Sub-model: automation adapter for Playwright-compatible MCP tools. */
    readonly target: BrowserTargetModel;
    /** Sub-model: internal tabs, bookmark resource, and favicon/current-URL caches. */
    readonly tabs: BrowserTabsModel;
    /** Sub-model: Tor partition and daemon lifecycle. */
    readonly tor: BrowserTorModel;
    /** Sub-model: the profile's proxy route; inert on Tor/incognito pages. */
    readonly network: BrowserProfileNetworkModel;
    private readonly shortcuts: BrowserShortcutTable;

    readonly typedQueue: ComponentQueue<BrowserQueueEvent, BrowserQueueRequest>;
    private keyDownSub: () => void;
    private readonly incognitoId = crypto.randomUUID();
    private readonly torId = crypto.randomUUID();

    constructor(state: TComponentState<BrowserEditorState>) {
        super(state);
        this.typedQueue = this.queue as unknown as ComponentQueue<
            BrowserQueueEvent,
            BrowserQueueRequest
        >;
        this.tabs = new BrowserTabsModel(this);
        this.tor = new BrowserTorModel(this);
        this.network = new BrowserProfileNetworkModel(this);
        this.webview = new BrowserWebviewModel(this);
        this.find = new BrowserFindModel(this);
        this.shortcuts = new BrowserShortcutTable({
            focusUrlInput: () => this.urlBar.focusUrlInput(),
            openFind: () => this.find.open(),
            isFindVisible: () => this.find.state.get().findBarVisible,
            closeFind: () => this.find.close(),
            stopActiveGuest: () => this.webview.getActiveWebview()?.stop(),
            reloadOrStop: () => this.webview.reloadOrStop(),
            hardReload: () => this.webview.hardReload(),
            openDevTools: () => this.webview.openDevTools(),
            goBack: () => this.webview.goBack(),
            goForward: () => this.webview.goForward(),
            goHome: () => this.goHome(),
            isFocused: () => pages.query.focusedPage === this.page,
        });
        let activeActionTab = state.get().activeTabId;
        this.own(state.subscribe(() => {
            const next = state.get().activeTabId;
            if (next !== activeActionTab) this.siteExtensions.onActiveTabChanged(activeActionTab);
            activeActionTab = next;
        }));
        this.translation = new BrowserTranslationController(this);
        this.siteExtensions = new BrowserSiteExtensionController(this);
        // Cross-calls begin only after webview, translation, and siteExtensions are composed.
        this.pageRemote = new BrowserPageRemote(this);
        this.urlBar = new BrowserUrlBarModel(this);
        this.bookmarksUI = new BrowserBookmarksUIModel(this);
        this.target = new BrowserTargetModel(this);
        this.keyDownSub = globalKeyDown.subscribe((event) => this.handleBrowserShortcut(event, "global"));
        this.own(this.keyDownSub);
    }

    /** Electron session partition string, derived from profile state. */
    get partition(): string {
        const state = this.state.get();
        return getPartitionString(state.profileName, state.isIncognito, this.incognitoId, state.isTor, this.torId);
    }
    /** Put the profile session on its configured route before the first navigation. */
    armProfileNetwork = async (): Promise<void> => this.network.armProxy();
    showNetworkInfoDialog = async (): Promise<void> => this.network.showInfoDialog();
    getSitePermissions = (registrationKey: string): Promise<BrowserSitePermissions> =>
        ipcRenderer.invoke(BrowserChannel.getSitePermissions, { registrationKey });
    setSitePermission = (registrationKey: string, key: BrowserSitePermissionKey, decision: "allow" | "block"): Promise<boolean> =>
        ipcRenderer.invoke(BrowserChannel.setSitePermission, { registrationKey, key, decision });
    resetSitePermissions = (registrationKey: string): Promise<boolean> =>
        ipcRenderer.invoke(BrowserChannel.resetSitePermissions, { registrationKey });
    /** Retry a profile network that could not be applied; its webviews stay unmounted until then. */
    retryProfileNetwork = async (): Promise<void> => {
        try {
            await this.network.armProxy();
        } catch {
            // `networkError` already carries the reason for the error panel.
        }
    };
    /** Return Chromium's leaf-first DER certificate chain for the selected HTTPS tab. */
    getCertificate = async (
        internalTabId = this.state.get().activeTabId,
    ): Promise<{ url: string; certificates: string[] } | undefined> => {
        const state = this.state.get();
        const tab = state.tabs.find((item) => item.id === internalTabId);
        const currentUrl = this.tabs.currentUrls.get(internalTabId) || tab?.url;
        if (!currentUrl || !URL.canParse(currentUrl)) return undefined;
        const url = new URL(currentUrl);
        if (url.protocol !== "https:") return undefined;

        await this.target.ensureReady(internalTabId);
        const response = await this.target.cdp(internalTabId).send(
            "Network.getCertificate",
            { origin: url.origin },
        ) as { tableNames?: unknown };
        if (!Array.isArray(response?.tableNames) || response.tableNames.length === 0
            || !response.tableNames.every((certificate: unknown) => typeof certificate === "string")) {
            return undefined;
        }
        return { url: currentUrl, certificates: response.tableNames };
    };

    releaseTab = (internalTabId: string): void => {
        this.siteExtensions.onTabReleased(internalTabId);
        this.translation.onTabReleased(internalTabId);
        this.pageRemote.onTabReleased(internalTabId);
    };

    async dispose(): Promise<void> {
        this.translation.dispose();
        this.siteExtensions.dispose();
        this.pageRemote.dispose();
        this.bookmarksUI.dispose();

        const s = this.state.get();
        await this.tabs.dispose();
        this.tor.dispose();
        this.network.dispose();

        await super.dispose();

        // Clear HTTP cache for this partition to free disk space.
        // Skip incognito/tor: no persist: prefix means no disk storage.
        if (!isPrivateBrowserSession(s)) {
            ipcRenderer.invoke(BrowserChannel.clearCache, this.partition);
        }
    }

    /** Dispatch a browser shortcut from its existing root or global event source. */
    handleBrowserShortcut = (event: KeyboardEvent, source: "root" | "global"): void => {
        this.shortcuts.dispatch(event, source);
    };

    focus(): void {
        this.typedQueue.send({ type: "focus" });
    }

    async restore(): Promise<void> {
        await super.restore();
        const s = this.state.get();

        // Arm here rather than only at the `showBrowserPage` call site: this runs on
        // every path that produces a Tor page, session restore included, and always
        // before the page is added to the window. A restored Tor page resets its tabs
        // to about:blank and waits for Reconnect, but its URL bar is live without
        // this, typing a URL before reconnecting would navigate a bare partition
        // straight out onto the normal network. Failures are recorded rather than
        // thrown, so a page is never dropped from a restore; the overlay then shows
        // the error, `BrowserTorModel.reconnect()` retries the arming. A newly opened page's
        // `showBrowserPage` path re-asserts it and declines to open on failure.
        if (s.isTor) {
            try {
                await this.tor.armProxy();
            } catch (err) {
                this.state.update((st) => {
                    st.torStatus = "error";
                    st.torOverlayVisible = true;
                    st.torLog += (st.torLog ? "\n" : "")
                        + `Could not secure the session: ${errMessage(err)}`;
                });
            }
        }

        // Same ordering for a proxied profile: Electron does not persist
        // `setProxy`, so a restored page re-applies it before any webview mounts. On
        // failure the page keeps its tabs but mounts no webview (see `networkError`)
        // rather than browse a session whose route is unknown.
        if (!s.isTor) {
            try {
                await this.armProfileNetwork();
            } catch {
                // Recorded in `networkError` by the sub-model.
            }
        }

        if (s.url && s.url !== DEFAULT_URL) {
            this.state.update((st) => {
                st.title = browserPageTitle(st, st.pageTitle);
            });
        }
    }

    get currentUrl(): string | undefined {
        const state = this.state.get();
        const tab = state.tabs.find(t => t.id === state.activeTabId);
        return this.tabs.currentUrls.get(state.activeTabId) || tab?.url || state.url || undefined;
    }

    getRestoreData(): EditorDescriptor {
        const s = this.state.get();
        // Save all tabs with their actual current URLs
        const tabs = s.tabs.map((t) => ({
            ...t,
            url: this.tabs.currentUrls.get(t.id) || t.url,
        }));
        // Top-level url = active tab's actual URL
        const url = this.currentUrl;
        return {
            editorId: this.editorId,
            id: s.id,
            state: {
                title: s.title,
                modified: s.modified,
                secondaryView: s.secondaryView,
                url,
                pageTitle: s.pageTitle,
                tabs,
                activeTabId: s.activeTabId,
                tabsPanelWidth: s.tabsPanelWidth,
                bookmarksWidth: s.bookmarksWidth, // NH3 promoted to persisted (sixth instance of leftPanelWidth-equivalent silent fix)
                bookmarksSidebarWidth: s.bookmarksSidebarWidth, // Persist the secondary-view sidebar width.

                profileName: s.profileName,
                isIncognito: s.isIncognito,
                isTor: s.isTor,
                searchEngineId: s.searchEngineId,
                lastSearchQuery: s.lastSearchQuery,
            } as Record<string, unknown>,
        };
    }

    applyRestoreData(data: RestoreData<BrowserEditorState>): void {
        super.applyRestoreData(data);
        this.state.update((s) => {
            if (data.tabs && data.tabs.length > 0) {
                // Re-assign fresh IDs to restored tabs
                s.tabs = data.tabs.map((t) => ({
                    ...t,
                    loading: false, audible: false, canGoBack: false, canGoForward: false,
                    id: createInternalTabId(),
                    groupId: t.groupId || createTabGroupId(),
                    zoomPercent: isValidPageZoom(t.zoomPercent) ? t.zoomPercent : PAGE_ZOOM_DEFAULT,
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
                    // `s.isIncognito` / `s.isTor` are copied from `data` further down this same
                    // update -- the Tor branch has to run after the tabs are restored, because it
                    // replaces them. So the restored flags are read from `data` here; reading `s`
                    // would see the pre-restore defaults and let a private title through.
                    s.title = browserPageTitle(
                        {
                            isIncognito: data.isIncognito ?? s.isIncognito,
                            isTor: data.isTor ?? s.isTor,
                        },
                        active.pageTitle,
                    );
                }
            } else {
                if (data.url) s.url = data.url;
                if (data.pageTitle) s.pageTitle = data.pageTitle;
            }
            s.loading = false;
            s.canGoBack = false;
            s.canGoForward = false;
            s._anyTabAudible = false;
            if (!data.tabs?.length && s.tabs.length) {
                s.tabs[0].url = s.url;
                s.tabs[0].pageTitle = s.pageTitle;
                s.tabs[0].loading = false;
                s.tabs[0].audible = false;
                s.tabs[0].canGoBack = false;
                s.tabs[0].canGoForward = false;
            }
            if (data.tabsPanelWidth) s.tabsPanelWidth = data.tabsPanelWidth;
            if (data.bookmarksWidth !== undefined) s.bookmarksWidth = data.bookmarksWidth; // NH3
            if (data.bookmarksSidebarWidth !== undefined) s.bookmarksSidebarWidth = data.bookmarksSidebarWidth;
            if (data.profileName !== undefined) s.profileName = data.profileName;
            if (data.isIncognito !== undefined) s.isIncognito = data.isIncognito;
            if (data.isTor !== undefined) {
                s.isTor = data.isTor;
                if (data.isTor) {
                    // After restore: show overlay with "Reconnect", clear tabs
                    s.torStatus = "disconnected";
                    s.torOverlayVisible = true;
                    const fresh = {
                        id: createInternalTabId(),
                        url: DEFAULT_URL,
                        pageTitle: "",
                        loading: false,
                        canGoBack: false,
                        canGoForward: false,
                        favicon: "",
                        audible: false,
                        muted: false,
                        homeUrl: "",
                        navHistory: [] as string[],
                        groupId: createTabGroupId(),
                        zoomPercent: PAGE_ZOOM_DEFAULT,
                    } satisfies BrowserTabData;
                    s.tabs = [fresh];
                    s.activeTabId = fresh.id;
                    s.url = DEFAULT_URL;
                    s.pageTitle = "";
                    s.favicon = "";
                    s.title = englishMessage("editors.browser");
                }
            }
            if (data.searchEngineId) s.searchEngineId = data.searchEngineId;
            if (data.lastSearchQuery) s.lastSearchQuery = data.lastSearchQuery;
        });
        this.tabs.resetMaterialized(this.state.get().activeTabId);
    }

    getIconElement = (): SVGElement | undefined => {
        const s = this.state.get();
        if (s.isTor) return TorIcon.createElement();
        if (s.isIncognito) return IncognitoIcon.createElement();
        return GlobeIcon.createElement({ color: this.resolvedColor });
    };

    /** Resolved icon color: profile color for named profiles, default browser color otherwise. */
    get resolvedColor(): string {
        const profileName = this.state.get().profileName;
        if (profileName) {
            const profiles = settings.get("browser-profiles");
            return profiles.find((p: BrowserProfile) => p.name === profileName)?.color || DEFAULT_BROWSER_COLOR;
        }
        // No explicit profile: resolve from the default profile setting
        const defaultName = settings.get("browser-default-profile");
        if (defaultName) {
            const profiles = settings.get("browser-profiles");
            return profiles.find((p: BrowserProfile) => p.name === defaultName)?.color || DEFAULT_BROWSER_COLOR;
        }
        return DEFAULT_BROWSER_COLOR;
    }

    /** Get the currently selected search engine. */
    getSearchEngine(): SearchEngine {
        const id = this.state.get().searchEngineId;
        return SEARCH_ENGINES.find((e) => e.id === id) || SEARCH_ENGINES[0];
    }

    /** The setting remembering the last pick: one for profile pages, one shared by Incognito and Tor. */
    private get searchEngineSettingKey(): "browser-search-engine" | "browser-private-search-engine" {
        const s = this.state.get();
        return isPrivateBrowserSession(s) ? "browser-private-search-engine" : "browser-search-engine";
    }

    /** Preselect the engine last picked in a page of the same mode. Call on a new page only. */
    applyRememberedSearchEngine(): void {
        const engineId = settings.get(this.searchEngineSettingKey);
        this.state.update((s) => { s.searchEngineId = engineId; });
    }

    /** Set the search engine by ID, and remember it for new pages of the same mode. */
    setSearchEngine = (engineId: string) => {
        this.state.update((s) => { s.searchEngineId = engineId; });
        settings.set(this.searchEngineSettingKey, engineId);
    };

    /** Switch the current search query to a different engine. Also updates the tab's homeUrl. */
    switchSearchEngine = (engineId: string) => {
        const s = this.state.get();
        const currentUrl = this.currentUrl || "";
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
        const normalizedUrl = this.resolveAddressInput(url);
        if (!normalizedUrl) return;

        this.state.update((s) => {
            s.url = normalizedUrl;
            const tab = s.tabs.find((t) => t.id === s.activeTabId);
            if (tab) {
                tab.url = normalizedUrl;
                tab.homeUrl = normalizedUrl;
            }
        });
    };

    /** Turn what was typed in the address bar (or passed by a script) into a loadable URL: a
     *  Windows path becomes file://, a bare host gets https://, and anything else is a search with
     *  the selected engine (recorded in search history). Returns "" for blank input. Used by
     *  navigate() and by every path that opens a page or tab at a URL, so search text works the
     *  same in all of them. */
    resolveAddressInput = (url: string): string => {
        let normalizedUrl = url.trim();
        if (!normalizedUrl) return "";

        // Convert a Windows file path (drive or UNC) pasted into the URL bar
        // into a file:// URL so the webview can load it.
        if (
            /^[a-zA-Z]:[\\/]/.test(normalizedUrl) ||
            normalizedUrl.startsWith("\\\\")
        ) {
            try {
                const { pathToFileURL } = require("url") as typeof import("url");
                normalizedUrl = pathToFileURL(normalizedUrl).href;
            } catch {
                // Fall through to the existing search/scheme heuristic.
            }
        }

        const isHostWithPort = /^[^:/\s]+:\d+(?:\/|$)/.test(normalizedUrl);
        const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(normalizedUrl) && !isHostWithPort;

        if (!hasScheme) {
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
        return normalizedUrl;
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
            if (updates.zoomPercent !== undefined) tab.zoomPercent = updates.zoomPercent;
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
                    s.title = browserPageTitle(s, updates.pageTitle);
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
        if (!isPrivateBrowserSession(s)) {
            try {
                const hostname = new URL(url).hostname;
                if (hostname) {
                    searchHistoryManager.get(s.profileName, false)?.add(hostname);
                }
            } catch { /* invalid URL */ }
        }
    };

    /** Add a new internal tab and switch to it.
     *  If parentGroupId is provided, the new tab inherits that group and is inserted after the active tab.
     *  Otherwise the tab is appended at the end. Returns the new tab's ID.
     *
     *  A blank tab focuses the URL bar, because a blank tab is a question the user has to answer
     *  and the URL bar is where the answer goes. `BrowserView` does this for a new browser page;
     *  doing it here is what makes a tab added to an existing page behave the same. A tab opened
     *  *at* a URL is left alone: the page it is loading is the answer, and stealing focus from it
     *  would fight the webview for the caret. */
    addTab = (url = DEFAULT_URL, parentGroupId?: string): string => {
        const internalTabId = this.tabs.addTab(url, parentGroupId);
        if (url === DEFAULT_URL) this.urlBar.focusUrlInput();
        return internalTabId;
    };

    dismissBlockedPopups = () => {
        this.state.update((s) => { s.blockedPopupCount = 0; });
    };

    allowPopups = () => {
        this.webview.popupsAllowed = true;
        globalPopupRateLimiter.allow("tabs");
        ipcRenderer.send(BrowserChannel.allowPopups);
        this.state.update((s) => { s.blockedPopupCount = 0; });
    };

    resolvePermissionPrompt = (requestId: string, decision: "allow" | "block") => {
        this.state.update((state) => {
            state.permissionPrompts = state.permissionPrompts.filter((prompt) => prompt.requestId !== requestId);
        });
        this.webview.resolvePermissionRequest(requestId, decision);
    };

}
