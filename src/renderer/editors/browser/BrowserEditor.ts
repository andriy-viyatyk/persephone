import { EditorId } from "../../../shared/editor-ids";
import { PAGE_ZOOM_DEFAULT, isValidPageZoom } from "../../../shared/browser-zoom";
import { englishMessage, t } from "../../../shared/i18n/t";
import { TComponentState } from "../../core/state/state";
import {
    EditorModel,
    type EditorRestoreOptions,
    type RestoreData,
} from "../base/EditorModel";
import type { EditorDescriptor } from "../../../shared/persistence";
import { globalKeyDown } from "../../core/state/events";
import { pages } from "../../api/pages";
import { IncognitoIcon, TorIcon } from "../../theme/language-icons";
import { GlobeIcon } from "../../theme/icons";
import { settings } from "../../api/settings";
import { searchHistoryManager } from "./browser-search-history";
import { errMessage } from "../../../shared/utils";
import { BrowserWebviewModel } from "./BrowserWebviewModel";
import { BrowserTranslationController } from "./BrowserTranslationController";
import { BrowserSiteExtensionController } from "./BrowserSiteExtensionController";
import { BrowserUrlBarModel } from "./BrowserUrlBarModel";
import { BrowserBookmarksModel } from "./BrowserBookmarksModel";
import { resolveBrowserProfile } from "./browser-profile";
import { BrowserTargetModel } from "./BrowserTargetModel";
import { BrowserTabsModel } from "./BrowserTabsModel";
import { BrowserTorModel } from "./BrowserTorModel";
import { BrowserProfileNetworkModel } from "./BrowserProfileNetworkModel";
import {
    type BrowserEditorState,
    type BrowserTabData,
    DEFAULT_URL,
    createInternalTabId,
    createBrowserTab,
    createTabGroupId,
    browserPageTitle,
    getPartitionString,
    getDefaultBrowserPageState,
} from "./browser-state";
import { SEARCH_ENGINES, detectSearchEngine, type SearchEngine } from "./search-engines";
import { isPrivateBrowserSession } from "./agent-access";
import { BrowserPageRemote } from "./BrowserPageRemote";
import { BrowserFindModel } from "./BrowserFindModel";
import { BrowserPromptsModel } from "./BrowserPromptsModel";
import { BrowserShortcutTable } from "./BrowserShortcutTable";
import { BrowserGuestChannel } from "./BrowserGuestChannel";
import { BrowserSitePermissionsModel } from "./BrowserSitePermissionsModel";
import { fs as appFs } from "../../api/fs";

export interface BrowserNewOptions { profileName?: string; incognito?: boolean; tor?: boolean; url?: string; openedByAgent?: boolean; }
interface BrowserRestoreOptions extends EditorRestoreOptions { retryTorOnFailure?: boolean; }
export type BrowserNewResult = { editor: BrowserEditor } | { refused: string };

export type BrowserQueueEvent = { type: "focus" };
export type BrowserQueueRequest = never;

export class BrowserEditor extends EditorModel<
    BrowserEditorState,
    BrowserQueueEvent,
    BrowserQueueRequest
> {
    static async createNew(options: BrowserNewOptions = {}): Promise<BrowserNewResult> {
        if (options.tor) {
            const torPath = settings.get("tor.exe-path");
            if (!torPath) return { refused: t("browser.browserTorNeedsExe") };
            if (!(await appFs.exists(torPath))) return { refused: t("browser.browserTorExeNotFound", { path: torPath }) };
        }
        const editor = new BrowserEditor(new TComponentState(getDefaultBrowserPageState()));
        try {
            editor.configureMode(options); editor.applyRememberedSearchEngine();
            if (options.url) editor.navigate(options.url);
            await editor.restore({ retryTorOnFailure: true });
            const networkError = editor.state.get().networkError;
            if (networkError) throw new Error(t("browser.browserProxyOpenFailed", { error: networkError }));
            return { editor };
        } catch (error) {
            await editor.dispose(); return { refused: errMessage(error) };
        }
    }

    configureMode(options: BrowserNewOptions): void {
        if (!(options.profileName || options.incognito || options.tor || options.openedByAgent)) return;
        this.state.update((state) => {
            if (options.profileName) state.profileName = options.profileName;
            if (options.incognito) state.isIncognito = true;
            if (options.tor) state.isTor = true;
            if (options.openedByAgent) state.openedByAgent = true;
            state.title = browserPageTitle(state, this.activeTab?.pageTitle);
        });
    }

    matches(options: Pick<BrowserNewOptions, "incognito" | "profileName" | "openedByAgent">): boolean {
        const state = this.state.get();
        return options.incognito
            ? !!state.isIncognito && (!options.openedByAgent || state.openedByAgent)
            : !isPrivateBrowserSession(state) && (options.profileName === undefined || (state.profileName ?? "") === options.profileName);
    }

    readonly editorId = EditorId.browserView;
    noLanguage = true;
    skipSave = true;
    readonly guest: BrowserGuestChannel;
    readonly webview: BrowserWebviewModel;
    readonly find: BrowserFindModel;
    readonly prompts: BrowserPromptsModel;
    readonly translation: BrowserTranslationController;
    readonly siteExtensions: BrowserSiteExtensionController;
    readonly pageRemote: BrowserPageRemote;
    readonly urlBar: BrowserUrlBarModel;
    readonly bookmarks: BrowserBookmarksModel;
    readonly target: BrowserTargetModel;
    readonly tabs: BrowserTabsModel;
    readonly tor: BrowserTorModel;
    readonly network: BrowserProfileNetworkModel;
    readonly sitePermissions: BrowserSitePermissionsModel;
    private readonly shortcuts: BrowserShortcutTable;
    private keyDownSub: () => void;
    private readonly incognitoId = crypto.randomUUID();
    private readonly torId = crypto.randomUUID();

    constructor(state: TComponentState<BrowserEditorState>) {
        super(state);
        this.guest = new BrowserGuestChannel(this.id);
        this.tabs = new BrowserTabsModel(this);
        this.bookmarks = new BrowserBookmarksModel(this);
        this.tor = new BrowserTorModel(this);
        this.network = new BrowserProfileNetworkModel(this);
        this.webview = new BrowserWebviewModel(this);
        this.prompts = new BrowserPromptsModel(this);
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
        this.pageRemote = new BrowserPageRemote(this);
        this.urlBar = new BrowserUrlBarModel(this);
        this.target = new BrowserTargetModel(this);
        this.sitePermissions = new BrowserSitePermissionsModel(this);
        this.webview.init();
        this.keyDownSub = globalKeyDown.subscribe((event) => this.handleBrowserShortcut(event, "global"));
        this.own(this.keyDownSub);
    }

    /** Electron session partition string, derived from profile state. */
    get partition(): string {
        const state = this.state.get();
        return getPartitionString(state.profileName, state.isIncognito, this.incognitoId, state.isTor, this.torId);
    }
    get activeTab(): BrowserTabData | undefined { const state = this.state.get(); return state.tabs.find((tab) => tab.id === state.activeTabId); }
    findTab = (id: string): BrowserTabData | undefined => this.state.get().tabs.find((tab) => tab.id === id);
    /** Put the profile session on its configured route before the first navigation. */
    armProfileNetwork = async (): Promise<void> => this.network.armProxy();
    showNetworkInfoDialog = async (): Promise<void> => this.network.showInfoDialog();
    retryProfileNetwork = async (): Promise<void> => { try { await this.network.armProxy(); } catch { /* `networkError` carries the error-panel reason. */ } };
    releaseTab = (internalTabId: string): void => { this.webview.clearPendingLoad(internalTabId); this.siteExtensions.onTabReleased(internalTabId); this.translation.onTabReleased(internalTabId); this.pageRemote.onTabReleased(internalTabId); };

    async dispose(): Promise<void> {
        this.webview.dispose();
        this.translation.dispose();
        this.siteExtensions.dispose();
        this.pageRemote.dispose();
        const s = this.state.get();
        await Promise.all([this.tabs.dispose(), this.bookmarks.dispose()]);
        this.tor.dispose();
        this.network.dispose();
        await super.dispose();

        // Clear HTTP cache for this partition to free disk space.
        // Skip incognito/tor: no persist: prefix means no disk storage.
        if (!isPrivateBrowserSession(s)) {
            this.guest.clearCache(this.partition);
        }
    }

    handleBrowserShortcut = (event: KeyboardEvent, source: "root" | "global"): void => {
        this.shortcuts.dispatch(event, source);
    };

    focus(): void { this.queue.send({ type: "focus" }); }

    async restore(options: BrowserRestoreOptions = {}): Promise<void> {
        await super.restore(options);
        const s = this.state.get();

        if (s.isTor) {
            await this.armTorProxy(options.retryTorOnFailure === true);
        }

        if (!s.isTor) {
            try {
                await this.armProfileNetwork();
            } catch {
                // Recorded in `networkError` by the sub-model.
            }
        }

        if (this.activeTab?.url && this.activeTab.url !== DEFAULT_URL) {
            this.state.update((st) => {
                st.title = browserPageTitle(st, this.activeTab?.pageTitle);
            });
        }
    }

    private async armTorProxy(retryOnFailure: boolean): Promise<void> {
        try {
            await this.tor.armProxy();
        } catch (error) {
            this.state.update((state) => {
                state.torStatus = "error";
                state.torOverlayVisible = true;
                state.torLog += (state.torLog ? "\n" : "") + `Could not secure the session: ${errMessage(error)}`;
            });
            if (!retryOnFailure) return;
            try { await this.tor.armProxy(); }
            catch (retryError) { throw new Error(t("browser.browserTorSecureFailed", { error: errMessage(retryError) })); }
        }
    }

    get currentUrl(): string | undefined { return this.activeTab?.url; }

    getRestoreData(): EditorDescriptor {
        const s = this.state.get();
        const tabs = s.tabs.map((tab) => ({ ...tab }));
        const url = this.currentUrl;
        return {
            editorId: this.editorId,
            id: s.id,
            state: {
                title: s.title,
                modified: s.modified,
                secondaryView: s.secondaryView,
                url,
                pageTitle: this.activeTab?.pageTitle || "",
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

    applyRestoreData(data: RestoreData<BrowserEditorState> & { url?: string; pageTitle?: string }): void {
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
            } else {
                if (data.url && s.tabs[0]) s.tabs[0].url = data.url;
                if (data.pageTitle && s.tabs[0]) s.tabs[0].pageTitle = data.pageTitle;
            }
            s._anyTabAudible = false;
            if (!data.tabs?.length && s.tabs.length) {
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
                    const fresh = createBrowserTab();
                    s.tabs = [fresh];
                    s.activeTabId = fresh.id;
                    s.title = englishMessage("editors.browser");
                }
            }
            const active = s.tabs.find((tab) => tab.id === s.activeTabId);
            s.title = browserPageTitle(
                { isIncognito: s.isIncognito, isTor: s.isTor, openedByAgent: s.openedByAgent },
                active?.pageTitle,
            );
            if (data.searchEngineId) s.searchEngineId = data.searchEngineId;
            if (data.lastSearchQuery) s.lastSearchQuery = data.lastSearchQuery;
        });
        this.urlBar.syncFromUrl(this.activeTab?.url || "");
        this.tabs.resetMaterialized(this.state.get().activeTabId);
    }

    getIconElement = (): SVGElement | undefined => {
        const s = this.state.get();
        if (s.isTor) return TorIcon.createElement();
        if (s.isIncognito) return IncognitoIcon.createElement();
        return GlobeIcon.createElement({ color: resolveBrowserProfile(s).color });
    }

    getSearchEngine(): SearchEngine {
        const id = this.state.get().searchEngineId;
        return SEARCH_ENGINES.find((e) => e.id === id) || SEARCH_ENGINES[0];
    }

    private get searchEngineSettingKey(): "browser-search-engine" | "browser-private-search-engine" {
        const s = this.state.get();
        return isPrivateBrowserSession(s) ? "browser-private-search-engine" : "browser-search-engine";
    }

    applyRememberedSearchEngine(): void {
        const engineId = settings.get(this.searchEngineSettingKey);
        this.state.update((s) => { s.searchEngineId = engineId; });
    }

    setSearchEngine = (engineId: string) => {
        this.state.update((s) => { s.searchEngineId = engineId; });
        settings.set(this.searchEngineSettingKey, engineId);
    };

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
                this.navigate(newUrl);
            }
        }
    };

    navigate = (url: string) => {
        const normalizedUrl = this.resolveAddressInput(url);
        if (!normalizedUrl) return;

        const tab = this.activeTab;
        if (!tab) return;
        this.state.update((state) => {
            const active = state.tabs.find((item) => item.id === tab.id);
            if (active) active.homeUrl = normalizedUrl;
        });
        if (!this.webview.get(tab.id)) this.setFutureUrl(tab.id, normalizedUrl);
        this.urlBar.syncFromUrl(normalizedUrl);
        this.webview.load(tab.id, normalizedUrl);
    };

    /** Set the URL that a tab without a guest will use as its future webview source. */
    setFutureUrl = (internalTabId: string, url: string): void => {
        if (this.webview.get(internalTabId)) return;
        this.state.update((state) => {
            const tab = state.tabs.find((item) => item.id === internalTabId);
            if (tab) tab.url = url;
        });
    };

    /** Commit the URL reported by Chromium, the only runtime URL write for an attached guest. */
    commitNavigation = (internalTabId: string, url: string, updates: Partial<Pick<BrowserTabData, "canGoBack" | "canGoForward" | "favicon">>): void => {
        let active = false;
        this.state.update((state) => {
            const tab = state.tabs.find((item) => item.id === internalTabId);
            if (!tab) return;
            tab.url = url;
            if (updates.canGoBack !== undefined) tab.canGoBack = updates.canGoBack;
            if (updates.canGoForward !== undefined) tab.canGoForward = updates.canGoForward;
            if (updates.favicon !== undefined) tab.favicon = updates.favicon;
            active = internalTabId === state.activeTabId;
        });
        if (active) this.urlBar.syncFromUrl(url);
    };

    /** Normalize address input and record searches; blank input resolves to an empty string. */
    resolveAddressInput = (url: string): string => {
        let normalizedUrl = url.trim();
        if (!normalizedUrl) return "";

        // Convert pasted Windows paths to file URLs.
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
        const tab = this.activeTab;
        if (tab?.homeUrl) {
            this.navigate(tab.homeUrl);
        }
    };

    /** Update tab metadata other than its committed URL. */
    updateTab = (
        internalTabId: string,
        updates: Partial<Omit<BrowserTabData, "url" | "canGoBack" | "canGoForward">>,
    ) => {
        this.state.update((s) => {
            const tab = s.tabs.find((item) => item.id === internalTabId);
            if (!tab) return;
            if (updates.zoomPercent !== undefined) tab.zoomPercent = updates.zoomPercent;
            if (updates.pageTitle !== undefined) tab.pageTitle = updates.pageTitle;
            if (updates.loading !== undefined) tab.loading = updates.loading;
            if (updates.favicon !== undefined) tab.favicon = updates.favicon;
            if (updates.audible !== undefined) {
                tab.audible = updates.audible;
                s._anyTabAudible = s.tabs.some((t) => t.audible);
            }
            if (updates.muted !== undefined) tab.muted = updates.muted;

            if (internalTabId === s.activeTabId && updates.pageTitle !== undefined)
                s.title = browserPageTitle(s, tab.pageTitle);
        });
    };

    /** Record a navigation in the tab's history and add hostname to search history. */
    addNavHistory = (internalTabId: string, url: string) => {
        if (!url || url === DEFAULT_URL) return;
        this.state.update((s) => {
            const tab = s.tabs.find((item) => item.id === internalTabId);
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

}
