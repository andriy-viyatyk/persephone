import styled from "@emotion/styled";
import { useCallback, useEffect, useRef, useState } from "react";
const { ipcRenderer } = require("electron");
import { IPageState, PageType } from "../../../shared/types";
import { PageModel, PageToolbar } from "../base";
import { TComponentState } from "../../core/state/state";
import { EditorModule } from "../types";
import color from "../../theme/color";
import { Button } from "../../components/basic/Button";
import { TextField } from "../../components/basic/TextField";
import {
    ArrowLeftIcon,
    ArrowRightIcon,
    BookmarkIcon,
    CloseIcon,
    HomeIcon,
    RefreshIcon,
    SettingsIcon,
    StarFilledIcon,
    StarIcon,
    StopIcon,
} from "../../theme/icons";
import { IncognitoIcon } from "../../theme/language-icons";
import {
    BrowserPageModel,
    BrowserPageState,
    BrowserTabData,
    getDefaultBrowserPageState,
} from "./BrowserPageModel";
import {
    BrowserChannel,
    BrowserRegisterRequest,
} from "../../../ipc/browser-ipc";
import { Splitter } from "../../components/layout/Splitter";
import { BrowserTabsPanel } from "./BrowserTabsPanel";
import { WithPopupMenu } from "../../components/overlay/WithPopupMenu";
import { UrlSuggestionsDropdown } from "./UrlSuggestionsDropdown";
import { BookmarksDrawer } from "./BookmarksDrawer";
import { LinkEditor } from "../link-editor/LinkEditor";
import { BrowserBookmarks } from "./BrowserBookmarks";
import { DownloadButton } from "./DownloadButton";
import { BrowserDownloadsPopup } from "./BrowserDownloadsPopup";
import { BrowserFindBar } from "./BrowserFindBar";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const WEBVIEW_PRELOAD_URL = (window as any).webviewPreloadUrl as string;

// ============================================================================
// Styled Component
// ============================================================================

const BrowserPageViewRoot = styled.div({
    flex: "1 1 auto",
    display: "flex",
    flexDirection: "column",
    outline: "none",
    overflow: "hidden",

    "& .browser-toolbar-content": {
        display: "flex",
        alignItems: "center",
        flex: 1,
        gap: 4,
    },

    "& .url-bar": {
        flex: 1,
    },

    "& .search-engine-btn": {
        cursor: "pointer",
        fontSize: 11,
        color: color.text.light,
        padding: "0 4px",
        borderRadius: 3,
        whiteSpace: "nowrap",
        userSelect: "none",
        lineHeight: "20px",
        "&:hover": {
            color: color.text.default,
            backgroundColor: color.background.light,
        },
    },

    "& .loading-bar": {
        height: 2,
        backgroundColor: color.border.active,
        animation: "loading-pulse 1.5s ease-in-out infinite",
    },

    "& .loading-bar-placeholder": {
        height: 2,
    },

    "& .browser-body": {
        flex: "1 1 auto",
        display: "flex",
        flexDirection: "row",
        overflow: "hidden",
        position: "relative",
    },

    "& .webview-area": {
        flex: "1 1 auto",
        display: "flex",
        position: "relative",
        overflow: "hidden",
    },

    "& .webview-wrapper": {
        position: "absolute",
        inset: 0,
        display: "flex",
        "&.hidden": {
            visibility: "hidden",
            pointerEvents: "none",
        },
        "& webview": {
            flex: "1 1 auto",
            border: "none",
        },
    },

    "& .webview-click-overlay": {
        position: "absolute",
        inset: 0,
        zIndex: 1,
    },

    "& .blank-page-links": {
        position: "absolute",
        inset: 0,
        zIndex: 3,
        display: "flex",
        flexDirection: "column",
        backgroundColor: color.background.default,
    },
    "& .blank-page-toolbar": {
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: "4px 8px",
        borderBottom: `1px solid ${color.border.default}`,
        backgroundColor: color.background.dark,
        minHeight: 32,
        flexShrink: 0,
        // Portal placeholder divs need flex layout for horizontal items
        "& > div": {
            display: "flex",
            alignItems: "center",
            gap: 4,
        },
        // Hide "Add Link" and browser selector buttons on the empty page toolbar
        "& .link-btn-add": { display: "none" },
        "& .link-btn-browser-selector": { display: "none" },
    },
    "& .blank-page-editor": {
        flex: "1 1 auto",
        display: "flex",
        overflow: "hidden",
    },

    "& .tabs-panel": {
        flexShrink: 0,
        overflow: "hidden",
        borderRight: `1px solid ${color.border.default}`,
    },

    "& .browser-body > .splitter": {
        position: "absolute",
        top: 0,
        bottom: 0,
        zIndex: 2,
        backgroundColor: "transparent",
        borderRight: "none",
        "&:hover": {
            backgroundColor: color.background.light,
        },
    },

    "& .popup-blocked-bar": {
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "3px 8px",
        fontSize: 13,
        color: color.text.default,
        backgroundColor: color.background.light,
        borderBottom: `1px solid ${color.border.default}`,
        "& .popup-blocked-message": {
            flex: 1,
        },
    },

    "@keyframes loading-pulse": {
        "0%": { opacity: 0.3 },
        "50%": { opacity: 1 },
        "100%": { opacity: 0.3 },
    },
});

// ============================================================================
// BrowserWebviewItem — manages a single webview and its IPC registration
// ============================================================================

interface BrowserWebviewItemProps {
    model: BrowserPageModel;
    tab: BrowserTabData;
    isActive: boolean;
    /** Electron session partition string for this browser page. */
    partition: string;
}

function BrowserWebviewItem({
    model,
    tab,
    isActive,
    partition,
}: BrowserWebviewItemProps) {
    const webviewRef = useRef<Electron.WebviewTag | null>(null);
    const tabId = model.id;
    const internalTabId = tab.id;

    // Track initial src — we only set src on mount, not on re-render
    const initialUrl = useRef(tab.url);

    // Store webview ref for parent access immediately (not waiting for dom-ready).
    // about:blank may not fire dom-ready, so toolbar operations (loadURL, devtools)
    // need the ref available right away.
    useEffect(() => {
        const webview = webviewRef.current;
        if (!webview) return;
        model.webview.webviewRefs.set(internalTabId, webview);
        return () => {
            model.webview.webviewRefs.delete(internalTabId);
        };
    }, [model, internalTabId]);

    // Close host-page popups when the webview gains focus.
    // Clicks inside a <webview> don't bubble to the host document, so Popper's
    // click-outside detection never fires. Dispatching a synthetic mousedown
    // on document.body bridges that gap.
    useEffect(() => {
        const webview = webviewRef.current;
        if (!webview) return;
        const handleFocus = () => {
            document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        };
        webview.addEventListener("focus", handleFocus);
        return () => webview.removeEventListener("focus", handleFocus);
    }, []);

    // Register with main process on dom-ready and listen for preload messages
    useEffect(() => {
        const webview = webviewRef.current;
        if (!webview) return;

        let registered = false;

        const onDomReady = () => {
            model.webview.webviewReady.add(internalTabId);
            const webContentsId = webview.getWebContentsId();
            const request: BrowserRegisterRequest = {
                tabId,
                internalTabId,
                webContentsId,
            };
            ipcRenderer.send(BrowserChannel.register, request);
            registered = true;

            // If the page is muted, mute this new webview immediately
            if (model.state.get().pageMuted) {
                const key = `${tabId}/${internalTabId}`;
                ipcRenderer.send(BrowserChannel.setAudioMuted, key, true);
            }
        };

        webview.addEventListener("dom-ready", onDomReady);

        // Handle messages from the webview preload script (title, favicon)
        const onIpcMessage = (event: Electron.IpcMessageEvent) => {
            const { channel, args } = event;
            if (channel === "page-title") {
                const title = args[0] as string;
                if (title) {
                    model.updateTab(internalTabId, { pageTitle: title });
                }
            } else if (channel === "page-favicon") {
                const faviconUrl = args[0] as string;
                if (faviconUrl) {
                    const currentUrl =
                        webview.getURL() || model.currentUrls.get(internalTabId) || "";
                    model.cacheFavicon(currentUrl, faviconUrl);
                    model.updateTab(internalTabId, { favicon: faviconUrl });
                    // Save favicon to disk cache when not incognito
                    if (!model.state.get().isIncognito) {
                        import("../link-editor/favicon-cache").then(({ getHostname, saveFavicon, consumeFaviconSaveRequest }) => {
                            const hostname = getHostname(currentUrl);
                            if (!hostname) return;
                            // Save if explicitly requested (e.g. "Open in Internal Browser" from Link Editor)
                            if (consumeFaviconSaveRequest(hostname)) {
                                saveFavicon(hostname, faviconUrl);
                                return;
                            }
                            // Save if bookmarks contain a link with this hostname
                            if (model.bookmarks) {
                                const links = model.bookmarks!.linkModel.state.get().data.links;
                                const hasLink = links.some((l: { href: string }) => getHostname(l.href) === hostname);
                                if (hasLink) saveFavicon(hostname, faviconUrl);
                            }
                        });
                    }
                }
            } else if (channel === "clicked-images") {
                const imgUrls = args[0] as string[];
                if (Array.isArray(imgUrls) && imgUrls.length > 0) {
                    model.bookmarksUI.trackClickedImages(internalTabId, imgUrls);
                }
            } else if (channel === "show-find-bar") {
                model.webview.openFind();
            } else if (channel === "hide-find-bar") {
                if (model.state.get().findBarVisible) {
                    model.webview.closeFind();
                }
            }
        };

        webview.addEventListener("ipc-message", onIpcMessage);

        const onFoundInPage = (event: Electron.FoundInPageEvent) => {
            if (isActive) {
                model.webview.handleFoundInPage(event.result);
            }
        };
        webview.addEventListener("found-in-page", onFoundInPage);

        return () => {
            model.webview.webviewReady.delete(internalTabId);
            webview.removeEventListener("dom-ready", onDomReady);
            webview.removeEventListener("ipc-message", onIpcMessage);
            webview.removeEventListener("found-in-page", onFoundInPage);
            if (registered) {
                const key = `${tabId}/${internalTabId}`;
                ipcRenderer.send(BrowserChannel.unregister, key);
            }
        };
        // Note: tab.url is intentionally excluded — this effect manages IPC
        // registration which doesn't depend on URL changes. Including it would
        // cause webviewReady to be cleared on every navigation, breaking loadURL.
    }, [model, tabId, internalTabId]);

    return (
        <div className={`webview-wrapper${isActive ? "" : " hidden"}`}>
            <webview
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ref={webviewRef as any}
                src={initialUrl.current}
                style={{
                    backgroundColor:
                        !tab.url || tab.url === "about:blank"
                            ? color.background.default
                            : "#ffffff",
                }}
                partition={partition}
                preload={WEBVIEW_PRELOAD_URL}
                // Allow popups so setWindowOpenHandler fires for target="_blank" links.
                // The main process handler denies the popup and relays the URL as a
                // "new-window" event, which opens it in a new internal tab.
                // @ts-expect-error -- webview boolean attribute not in React types
                allowpopups="true"
            />
        </div>
    );
}

// ============================================================================
// BlankPageLinks — Shows link editor on empty (about:blank) tabs
// ============================================================================

interface BlankPageLinksProps {
    bookmarks: BrowserBookmarks;
}

function BlankPageLinks({ bookmarks }: BlankPageLinksProps) {
    const [toolbarFirstRef, setToolbarFirstRef] = useState<HTMLDivElement | null>(null);
    const [toolbarLastRef, setToolbarLastRef] = useState<HTMLDivElement | null>(null);

    return (
        <div className="blank-page-links">
            <div className="blank-page-toolbar">
                <div ref={setToolbarFirstRef} />
                <div style={{ flex: 1 }} />
                <div ref={setToolbarLastRef} />
            </div>
            <div className="blank-page-editor">
                <LinkEditor
                    model={bookmarks.textModel}
                    toolbarRefFirst={toolbarFirstRef}
                    toolbarRefLast={toolbarLastRef}
                />
            </div>
        </div>
    );
}

// ============================================================================
// BrowserPageView Component
// ============================================================================

interface BrowserPageViewProps {
    model: BrowserPageModel;
}

function BrowserPageView({ model }: BrowserPageViewProps) {
    const {
        url, loading, canGoBack, canGoForward,
        tabs, activeTabId, tabsPanelWidth,
        homeUrl, isIncognito,
        urlInput, suggestionsOpen, hoveredIndex,
        popupOpen, bookmarksOpen, bookmarksWidth,
        bookmarksReady, isBookmarked, blockedPopupCount,
        findBarVisible, findText, findActiveMatch, findTotalMatches,
    } = model.state.use((s) => {
        const activeTab = s.tabs.find((t) => t.id === s.activeTabId);
        return {
            url: s.url,
            loading: s.loading,
            canGoBack: s.canGoBack,
            canGoForward: s.canGoForward,
            tabs: s.tabs,
            activeTabId: s.activeTabId,
            tabsPanelWidth: s.tabsPanelWidth,
            homeUrl: activeTab?.homeUrl ?? "",
            isIncognito: s.isIncognito,
            // Ephemeral state from sub-models
            urlInput: s.urlInput,
            suggestionsOpen: s.suggestionsOpen,
            hoveredIndex: s.hoveredIndex,
            popupOpen: s.popupOpen,
            bookmarksOpen: s.bookmarksOpen,
            bookmarksWidth: s.bookmarksWidth,
            bookmarksReady: s.bookmarksReady,
            isBookmarked: s.isBookmarked,
            blockedPopupCount: s.blockedPopupCount,
            findBarVisible: s.findBarVisible,
            findText: s.findText,
            findActiveMatch: s.findActiveMatch,
            findTotalMatches: s.findTotalMatches,
            // Included for re-render triggers (used by sub-model computed getters)
            searchEngineId: s.searchEngineId,
            userHasTyped: s.userHasTyped,
            searchEntries: s.searchEntries,
        };
    });

    const isInitialLoad = useRef(true);
    const [downloadsAnchor, setDownloadsAnchor] = useState<HTMLElement | null>(null);
    const handleDownloadClick = useCallback((el: HTMLElement) => {
        setDownloadsAnchor((prev) => (prev ? null : el));
    }, []);
    const handleDownloadsClose = useCallback(() => setDownloadsAnchor(null), []);

    // IPC event handler lifecycle
    useEffect(() => {
        model.webview.initIpcHandler();
        return () => model.webview.disposeIpcHandler();
    }, [model]);

    // Sync URL input when URL changes externally (navigation, tab switch)
    useEffect(() => {
        model.urlBar.syncFromUrl(url);
    }, [url, model]);

    // Focus URL bar on initial load when URL is blank
    useEffect(() => {
        if (isInitialLoad.current) {
            isInitialLoad.current = false;
            if (!url || url === "about:blank") {
                setTimeout(() => model.urlBar.focusUrlInput(), 100);
            }
        }
    }, [url, model]);

    // Navigate active tab's webview when URL changes
    const activeTab = tabs.find((t) => t.id === activeTabId);
    useEffect(() => {
        if (activeTab) {
            model.webview.navigateWebview(activeTabId, activeTab.url);
        }
    }, [activeTab?.url, activeTabId, model]);

    // Read computed values from sub-models (re-computed on each render)
    const { urlBar, bookmarksUI, webview } = model;
    const showSearchEngineSelector = urlBar.showSearchEngineSelector;
    const currentEngineName = urlBar.currentEngineName;
    const searchEngineMenuItems = urlBar.searchEngineMenuItems;
    const suggestionsMode = urlBar.suggestionsMode;
    const suggestionsItems = urlBar.suggestionsItems;

    return (
        <BrowserPageViewRoot onKeyDown={webview.handleKeyDown} tabIndex={-1}>
            <PageToolbar borderBottom>
                <div className="browser-toolbar-content">
                    <Button
                        type="icon"
                        size="small"
                        title={homeUrl ? `Go to ${homeUrl}` : "Home"}
                        onClick={model.goHome}
                        disabled={!homeUrl}
                    >
                        <HomeIcon />
                    </Button>
                    <Button
                        type="icon"
                        size="small"
                        title="Back (Alt+Left)"
                        onClick={webview.goBack}
                        disabled={!canGoBack}
                    >
                        <ArrowLeftIcon />
                    </Button>
                    <Button
                        type="icon"
                        size="small"
                        title="Forward (Alt+Right)"
                        onClick={webview.goForward}
                        disabled={!canGoForward}
                    >
                        <ArrowRightIcon />
                    </Button>
                    <Button
                        type="icon"
                        size="small"
                        title={loading ? "Stop" : "Reload"}
                        onClick={webview.reloadOrStop}
                    >
                        {loading ? <StopIcon /> : <RefreshIcon />}
                    </Button>
                    <WithPopupMenu items={searchEngineMenuItems} offset={[-4, 4]}>
                    {(openEngineMenu) => (
                    <TextField
                        ref={urlBar.setUrlInputRef}
                        className="url-bar"
                        value={urlInput}
                        onChange={urlBar.handleUrlChange}
                        onKeyDown={urlBar.handleUrlKeyDown}
                        onFocus={urlBar.handleUrlFocus}
                        onBlur={urlBar.handleUrlBlur}
                        onContextMenu={urlBar.handleUrlContextMenu}
                        placeholder="Enter URL or search term..."
                        startButtons={(() => {
                            const btns = [
                                ...(isIncognito ? [
                                    <IncognitoIcon key="incognito" color={color.icon.light} />,
                                ] : []),
                                ...(showSearchEngineSelector ? [
                                    <span
                                        key="search-engine"
                                        className="search-engine-btn"
                                        onClick={(e) => { e.stopPropagation(); openEngineMenu(e.currentTarget); }}
                                        title="Change search engine"
                                    >{currentEngineName} ▾</span>,
                                ] : []),
                            ];
                            return btns.length ? btns : undefined;
                        })()}
                        startButtonsWidth={
                            showSearchEngineSelector
                                ? (currentEngineName.length * 7 + 20) + (isIncognito ? 20 : 0)
                                : undefined
                        }
                        endButtons={[
                            <Button
                                key="go"
                                size="small"
                                type="icon"
                                title="Navigate"
                                onClick={urlBar.handleNavigate}
                            >
                                <ArrowRightIcon />
                            </Button>,
                            <Button
                                key="star"
                                size="small"
                                type="icon"
                                title={isBookmarked ? "Edit Bookmark" : "Add Bookmark"}
                                onClick={bookmarksUI.handleStarClick}
                                style={isBookmarked ? { color: color.misc.blue } : undefined}
                            >
                                {isBookmarked ? <StarFilledIcon /> : <StarIcon />}
                            </Button>,
                        ]}
                    />
                    )}
                    </WithPopupMenu>
                    <Button
                        type="icon"
                        size="small"
                        title="Open Bookmarks"
                        onClick={bookmarksUI.handleOpenBookmarks}
                    >
                        <BookmarkIcon />
                    </Button>
                    <DownloadButton onClick={handleDownloadClick} />
                    <Button
                        type="icon"
                        size="small"
                        title="Open DevTools"
                        onClick={webview.openDevTools}
                    >
                        <SettingsIcon />
                    </Button>
                    <Button
                        type="icon"
                        size="small"
                        title="Close Tab"
                        onClick={() => model.closeTab(activeTabId)}
                    >
                        <CloseIcon />
                    </Button>
                </div>
            </PageToolbar>
            {loading ? (
                <div className="loading-bar" />
            ) : (
                <div className="loading-bar-placeholder" />
            )}
            {blockedPopupCount > 0 && (
                <div className="popup-blocked-bar">
                    <span className="popup-blocked-message">
                        {blockedPopupCount === 1
                            ? "A popup was blocked on this page"
                            : `${blockedPopupCount} popups were blocked on this page`}
                    </span>
                    <Button size="small" type="flat" onClick={model.allowPopups}>
                        Allow
                    </Button>
                    <Button size="small" type="icon" onClick={model.dismissBlockedPopups}>
                        <CloseIcon />
                    </Button>
                </div>
            )}
            <div className="browser-body">
                <div
                    className="tabs-panel"
                    style={{ width: tabsPanelWidth }}
                >
                    <BrowserTabsPanel
                        model={model}
                        tabs={tabs}
                        activeTabId={activeTabId}
                        width={tabsPanelWidth}
                    />
                </div>
                <Splitter
                    type="vertical"
                    initialWidth={tabsPanelWidth}
                    onChangeWidth={model.setTabsPanelWidth}
                    borderSized="right"
                    style={{ left: tabsPanelWidth }}
                />
                <div className="webview-area">
                    {bookmarksReady && model.bookmarks && (!url || url === "about:blank") && (
                        <BlankPageLinks bookmarks={model.bookmarks} />
                    )}
                    {tabs.map((tab) => (
                        <BrowserWebviewItem
                            key={tab.id}
                            model={model}
                            tab={tab}
                            isActive={tab.id === activeTabId}
                            partition={model.partition}
                        />
                    ))}
                    {popupOpen && <div className="webview-click-overlay" />}
                    {findBarVisible && (
                        <BrowserFindBar
                            findText={findText}
                            activeMatch={findActiveMatch}
                            totalMatches={findTotalMatches}
                            onFindTextChange={webview.setFindText}
                            onNext={webview.findNext}
                            onPrev={webview.findPrev}
                            onClose={webview.closeFind}
                        />
                    )}
                </div>
                {bookmarksReady && model.bookmarks && (
                    <BookmarksDrawer
                        open={bookmarksOpen}
                        bookmarks={model.bookmarks}
                        width={bookmarksWidth}
                        onChangeWidth={(w) => model.state.update((s) => { s.bookmarksWidth = w; })}
                        onLinkClick={bookmarksUI.handleBookmarkLinkClick}
                        onClose={bookmarksUI.handleCloseBookmarks}
                    />
                )}
            </div>
            <UrlSuggestionsDropdown
                anchorEl={urlBar.urlInputRef?.closest('.url-bar') ?? null}
                open={suggestionsOpen}
                items={suggestionsItems}
                mode={suggestionsMode}
                searchText={suggestionsMode === "search" ? urlInput : undefined}
                hoveredIndex={hoveredIndex}
                onHoveredIndexChange={(i) => model.state.update((s) => { s.hoveredIndex = i; })}
                onSelect={urlBar.handleSuggestionSelect}
                onClearVisible={suggestionsMode === "search" ? urlBar.handleClearVisible : undefined}
            />
            <BrowserDownloadsPopup
                anchorEl={downloadsAnchor}
                onClose={handleDownloadsClose}
            />
        </BrowserPageViewRoot>
    );
}

// ============================================================================
// EditorModule
// ============================================================================

const browserEditorModule: EditorModule = {
    Editor: BrowserPageView as any,
    newPageModel: async () => {
        return new BrowserPageModel(
            new TComponentState(getDefaultBrowserPageState()),
        );
    },
    newEmptyPageModel: async (
        pageType: PageType,
    ): Promise<PageModel | null> => {
        if (pageType !== "browserPage") return null;
        const model = new BrowserPageModel(
            new TComponentState(getDefaultBrowserPageState()),
        );
        return model;
    },
    newPageModelFromState: async (
        state: Partial<IPageState>,
    ): Promise<PageModel> => {
        const initialState: BrowserPageState = {
            ...getDefaultBrowserPageState(),
            ...(state as Partial<BrowserPageState>),
        };
        return new BrowserPageModel(new TComponentState(initialState));
    },
};

export default browserEditorModule;
export { BrowserPageView, BrowserPageModel };
