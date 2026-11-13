import { EditorId } from "../../../shared/editor-ids";
import { englishMessage } from "../../../shared/i18n/t";
import { IEditorState } from "../../../shared/types";
import { TorStatus } from "../../../ipc/tor-ipc";
import { getDefaultEditorModelState } from "../base";
import { isPrivateBrowserSession } from "./agent-access";

export interface BrowserUrlBarState {
    urlInput: string;
    suggestionsOpen: boolean;
    userHasTyped: boolean;
    hoveredIndex: number;
    searchEntries: string[];
}

export const getDefaultBrowserUrlBarState = (): BrowserUrlBarState => ({
    urlInput: DEFAULT_URL,
    suggestionsOpen: false,
    userHasTyped: false,
    hoveredIndex: -1,
    searchEntries: [],
});

/** State for a single internal browser tab. */
export interface BrowserTabData {
    /** Page zoom relative to the host window. */
    zoomPercent: number;
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
    /** Tab group ID — tabs opened from the same parent share a group. */
    groupId: string;
}

export interface BrowserEditorState extends IEditorState {
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
    torStatus: TorStatus;
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

    /**
     * True when an agent (MCP tool or MCP-run script) opened this page. Agents are blocked from
     * incognito/Tor pages the *user* opened; a private page the agent opened itself is its own to
     * read and drive. Deliberately not persisted: after a restart the page counts as the user's.
     */
    openedByAgent: boolean;
    /** `profile-src` token while this page's profile is proxied, else "". */
    networkToken: string;
    /** Proxy shown in the URL bar, e.g. "SOCKS5 127.0.0.1:1080"; "" when direct. */
    networkLabel: string;
    /** Why the profile network could not be applied; "" when it was. */
    networkError: string;
    /** Whether a context menu popup is open (shows transparent overlay). */
    popupOpen: boolean;
    /** Whether the bookmarks drawer is visible. */
    bookmarksOpen: boolean;
    /** Bookmarks drawer width in pixels. Persisted (NH3 — sixth instance of `leftPanelWidth`-equivalent silent fix). */
    bookmarksWidth: number;
    /** SecondaryViews sidebar width (Categories/Tags/Hostnames panels) inside the
     *  bookmarks surfaces. Persisted in browser state. */
    bookmarksSidebarWidth?: number;
    /** Whether the current URL is bookmarked (star button state). */
    isBookmarked: boolean;
    /** Whether bookmarks have been initialized. */
    bookmarksReady: boolean;

}

export const DEFAULT_URL = "about:blank";

let nextInternalTabId = 1;
let nextGroupId = 1;

export function createInternalTabId(): string {
    return `bt-${nextInternalTabId++}`;
}

export function createTabGroupId(): string {
    return `bg-${nextGroupId++}`;
}

export function createBrowserTab(url = DEFAULT_URL, groupId?: string): BrowserTabData {
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
        groupId: groupId || createTabGroupId(),
        zoomPercent: 100,
    };
}

export const getDefaultBrowserPageState = (): BrowserEditorState => {
    const tab = createBrowserTab();
    return {
        ...getDefaultEditorModelState(),
        title: englishMessage("editors.browser"),
        editor: EditorId.browserView,
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
        openedByAgent: false,
        networkToken: "",
        networkLabel: "",
        networkError: "",
        popupOpen: false,
        bookmarksOpen: false,
        bookmarksWidth: 0,
        isBookmarked: false,
        bookmarksReady: false,
    };
};

/**
 * The Persephone page title for a browser page.
 *
 * Incognito and Tor sessions report a constant `"Browser"` and never track the active tab. The
 * page title is not a private surface: it shows in the tab strip and, more importantly, is
 * returned in `pages` summaries, which already withhold `url` for these modes and refuse to drive
 * them through the call surface. The title was
 * the remaining leak -- it named the site being viewed.
 *
 * Suppressed here, at every point of assignment, rather than masked at the MCP boundary: one rule
 * then covers the page title, the tab strip and the tool output together, and cannot be bypassed
 * by a new caller. The browser's *own* tab labels are unaffected -- they read `pageTitle`, which
 * still tracks the page, so the user still sees which tab is which inside the session.
 */
export function browserPageTitle(
    flags: { isIncognito?: boolean; isTor?: boolean; openedByAgent?: boolean },
    pageTitle: string | undefined,
): string {
    // A private page the agent opened is readable by the agent — say so in the tab, so the user
    // never mistakes it for their own private session.
    if (isPrivateBrowserSession(flags)) return flags.openedByAgent ? "Browser (agent)" : "Browser";
    return pageTitle || "Browser";
}

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
