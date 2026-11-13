import { BrowserBookmarks, createEmptyLinkFile } from "./BrowserBookmarks";
import { showEditLinkDialog } from "../link-editor/EditLinkDialog";
import { api } from "../../../ipc/renderer/api";
import type { BrowserEditor } from "./BrowserEditor";
import type { LinkItem } from "../link-editor/linkTypes";
import { app } from "../../api/app";
import { BookmarkEvent } from "../../api/events/events";
import { withTimeout } from "../../core/utils/utils";
import { DisposableStore } from "../../core/utils/DisposableStore";
import { DialogButton } from "../../ui/dialogs/dialog-buttons";
import { t } from "../../../shared/i18n/t";
import { isPrivateBrowserSession } from "./agent-access";
import { createIconElement } from "../../uikit/shared/slots";
import { resolveBrowserProfile } from "./browser-profile";
import { DEFAULT_URL } from "./browser-state";

const SELECT_BOOKMARK_FILE_ID = "select-bookmarks-file";
const CREATE_BOOKMARK_FILE_ID = "create-bookmarks-file";

/** Tracked image URLs from a specific navigation level. */
export interface TrackedImageLevel {
    level: number;
    imgUrls: string[];
}

const BOOKMARKS_FILE_FILTER = { name: "Link Files", extensions: ["link.json"] };

/**
 * How long a bookmark may wait on the page for its suggested images before the dialog
 * opens without them. The probe runs on the page's own renderer thread, so a loading or
 * busy page can hold it indefinitely — and the URL and title, which are the parts that
 * matter, are already known from our own tab state.
 */
const IMAGE_DISCOVERY_TIMEOUT = 1000;

/**
 * Owns the bookmarks resource, its lifecycle, and bookmark UI behavior.
 */
export class BrowserBookmarksModel {
    readonly model: BrowserEditor;
    bookmarks: BrowserBookmarks | null = null;
    private bookmarkPreloadTimer: ReturnType<typeof setTimeout> | undefined;
    private bookmarkLifecycleGeneration = 0;
    private disposed = false;

    /** Per-tab tracked images for bookmark image discovery. */
    trackedImagesRef = new Map<string, TrackedImageLevel[]>();

    /** Cleanup function for linkEditor state subscription. */
    private bookmarksSub: (() => void) | null = null;
    /** Cleanup function for model state subscription (urlInput tracking). */
    private urlTrackingSub: (() => void) | null = null;
    private readonly subscriptions = new DisposableStore();

    constructor(model: BrowserEditor) {
        this.model = model;
        const generation = this.bookmarkLifecycleGeneration;
        this.bookmarkPreloadTimer = setTimeout(() => {
            this.bookmarkPreloadTimer = undefined;
            if (this.disposed || generation !== this.bookmarkLifecycleGeneration) return;
            void this.preloadBookmarks(generation);
        }, 300);
    }

    /** Release bookmark subscriptions, pending preload, and the bookmark resource. */
    dispose = async () => {
        this.disposed = true;
        this.bookmarkLifecycleGeneration++;
        if (this.bookmarkPreloadTimer !== undefined) {
            clearTimeout(this.bookmarkPreloadTimer);
            this.bookmarkPreloadTimer = undefined;
        }
        this.bookmarksSub?.();
        this.bookmarksSub = null;
        this.urlTrackingSub?.();
        this.urlTrackingSub = null;
        this.subscriptions.dispose();
        if (this.bookmarks) {
            await this.bookmarks.dispose();
            this.bookmarks = null;
        }
    };

    // =====================================================================
    // Bookmarks Initialization
    // =====================================================================

    /** Ensure bookmarks are loaded, prompting user to associate a file if needed. */
    ensureBookmarks = async (): Promise<BrowserBookmarks | null> => {
        if (this.bookmarks) {
            return this.bookmarks;
        }

        const profile = resolveBrowserProfile(this.model.state.get());
        let filePath = profile.bookmarksFile;

        // If the configured file no longer exists, treat as unconfigured
        if (filePath && !(await app.fs.exists(filePath))) {
            filePath = "";
        }

        if (!filePath) {
            const { showConfirmationDialog } = await import("../../ui/dialogs/ConfirmationDialog");
            const choice = await showConfirmationDialog({
                message: t("browser.bookmarksMissingFile"),
                title: t("browser.bookmarksFileTitle"),
                buttons: [
                    { id: SELECT_BOOKMARK_FILE_ID, label: t("browser.bookmarksSelectFile") },
                    { id: CREATE_BOOKMARK_FILE_ID, label: t("browser.bookmarksCreateFile") },
                    DialogButton.cancel,
                ],
            });

            if (choice === SELECT_BOOKMARK_FILE_ID) {
                const result = await api.showOpenFileDialog({
                    title: t("browser.bookmarksSelectFileTitle"),
                    filters: [BOOKMARKS_FILE_FILTER],
                });
                filePath = result?.[0] || "";
            } else if (choice === CREATE_BOOKMARK_FILE_ID) {
                const result = await api.showSaveFileDialog({
                    title: t("browser.bookmarksCreateFileTitle"),
                    defaultPath: "bookmarks.link.json",
                    filters: [BOOKMARKS_FILE_FILTER],
                });
                if (result) {
                    filePath = result.endsWith(".link.json") ? result : result + ".link.json";
                    createEmptyLinkFile(filePath);
                }
            }

            if (!filePath) return null;

            profile.setBookmarksFile(filePath);
        }

        const bm = await this.initBookmarks(filePath);
        if (bm) {
            this.model.state.update((s) => { s.bookmarksReady = true; });
            this.startBookmarkTracking(bm);
        }
        return bm;
    };

    preloadBookmarks = async (generation = this.bookmarkLifecycleGeneration): Promise<void> => {
        if (this.disposed || generation !== this.bookmarkLifecycleGeneration) return;
        const filePath = resolveBrowserProfile(this.model.state.get()).bookmarksFile;
        if (!filePath || this.bookmarks) return;
        const bookmarks = new BrowserBookmarks(filePath);
        const ok = await bookmarks.init({ silent: true });
        if (this.disposed || generation !== this.bookmarkLifecycleGeneration) {
            await bookmarks.dispose();
            return;
        }
        if (!ok) {
            await bookmarks.dispose();
            return;
        }
        if (this.bookmarks) {
            await bookmarks.dispose();
            return;
        }
        this.bookmarks = bookmarks;
        this.configureBookmarks(bookmarks);
        this.model.state.update((s) => { s.bookmarksReady = true; });
    };

    initBookmarks = async (filePath: string): Promise<BrowserBookmarks | null> => {
        const generation = ++this.bookmarkLifecycleGeneration;
        if (this.bookmarks) {
            const current = this.bookmarks;
            this.bookmarks = null;
            await current.dispose();
        }
        const bookmarks = new BrowserBookmarks(filePath);
        const ok = await bookmarks.init();
        if (this.disposed || generation !== this.bookmarkLifecycleGeneration || !ok) {
            await bookmarks.dispose();
            return null;
        }
        if (this.bookmarks) {
            await bookmarks.dispose();
            return this.bookmarks;
        }
        this.bookmarks = bookmarks;
        this.configureBookmarks(bookmarks);
        return bookmarks;
    };

    private configureBookmarks = (bookmarks: BrowserBookmarks): void => {
        bookmarks.linkEditor.onLinkOpen = (data) => {
            data.target = "browser";
            data.browserPageId = this.model.page?.id;
            const currentTab = this.model.activeTab;
            if (!currentTab?.url || currentTab.url === DEFAULT_URL) data.browserTabMode = "navigate";
        };
        bookmarks.linkEditor.onGetLinkMenuItems = (link) => link.href ? [{
            id: "open-in-new-tab",
            label: t("shell.openInNewTab"),
            icon: createIconElement("open-link"),
            onClick: () => this.model.tabs.addTab(link.href),
        }] : [];
        bookmarks.linkEditor.imageProxySource = () => this.model.network.imageRoute;
        bookmarks.panelHost.setInitialWidth(this.model.state.get().bookmarksSidebarWidth);
        bookmarks.panelHost.onWidthChange = (width) => this.model.state.update((s) => { s.bookmarksSidebarWidth = width; });
    };

    // =====================================================================
    // Bookmark Tracking (isBookmarked state)
    // =====================================================================

    /** Subscribe to linkEditor state changes to track whether current URL is bookmarked. */
    private startBookmarkTracking = (bm: BrowserBookmarks) => {
        // Clean up previous subscriptions
        this.bookmarksSub?.();
        this.bookmarksSub = null;
        this.urlTrackingSub?.();
        this.urlTrackingSub = null;

        // Track changes in the link editor (add/remove/edit bookmarks)
        this.bookmarksSub = this.subscriptions.add(bm.linkEditor.state.subscribe(
            () => this.updateIsBookmarked(),
            (state) => state.data.links,
        ));

        // Track urlInput changes to re-check isBookmarked
        this.urlTrackingSub = this.subscriptions.add(this.model.state.subscribe(
            () => this.updateIsBookmarked(),
            (state) => state.urlInput,
        ));

        this.updateIsBookmarked();
    };

    private updateIsBookmarked = () => {
        const bm = this.bookmarks;
        if (!bm) {
            this.model.state.update((s) => { s.isBookmarked = false; });
            return;
        }
        const { urlInput } = this.model.state.get();
        const found = !!bm.findByUrl(urlInput);
        const current = this.model.state.get().isBookmarked;
        if (found !== current) {
            this.model.state.update((s) => { s.isBookmarked = found; });
        }
    };

    // =====================================================================
    // Drawer Handlers
    // =====================================================================

    handleOpenBookmarks = async () => {
        const bm = await this.ensureBookmarks();
        if (bm) {
            this.model.state.update((s) => { s.bookmarksOpen = true; });
        }
    };

    handleBookmarkLinkClick = (url: string) => {
        const currentTab = this.model.activeTab;
        const currentUrl = currentTab?.url || "";
        // Ctrl+Click (or Cmd+Click on Mac) opens in a new tab; plain click navigates current blank tab
        const e = window.event as KeyboardEvent | MouseEvent | undefined;
        const ctrlPressed = e?.ctrlKey || e?.metaKey;
        if (ctrlPressed || (currentUrl && currentUrl !== "about:blank")) {
            this.model.addTab(url);
        } else {
            this.model.navigate(url);
        }
        this.model.state.update((st) => { st.bookmarksOpen = false; });
    };

    handleCloseBookmarks = () => {
        this.model.state.update((s) => { s.bookmarksOpen = false; });
    };

    // =====================================================================
    // Star Button
    // =====================================================================

    /**
     * Re-entrancy guard for the star button. Everything before the dialog is async
     * (bookmark-file setup, favicon cache, the page image probe), so without this a user
     * who clicks the star again because nothing appeared yet ends up with one dialog per
     * click, all opening at once when the awaits finally settle.
     */
    private starClickBusy = false;

    /** Star button click: add or edit bookmark for the current URL. */
    handleStarClick = async () => {
        if (this.starClickBusy) return;
        this.starClickBusy = true;
        try {
            await this.runStarClick();
        } finally {
            this.starClickBusy = false;
        }
    };

    private runStarClick = async () => {
        const bm = await this.ensureBookmarks();
        if (!bm) return;

        const state = this.model.state.get();
        const { urlInput, activeTabId } = state;

        // Cache the favicon for this hostname before showing the dialog.
        // Skip on Tor pages too: `saveFavicon` downloads over a raw Node
        // https request (no proxy at all) AND writes to the persistent on-disk
        // cache. The guest `page-favicon` path already excludes
        // Tor; this one used to check only incognito.
        if (!isPrivateBrowserSession(state)) {
            const activeTab = this.model.findTab(activeTabId);
            if (activeTab?.favicon) {
                const { getHostname, saveFavicon } = await import("../../components/icons/favicon-cache");
                const hostname = getHostname(urlInput);
                // A proxied profile downloads it through its own session.
                const routedUrl = this.model.network.routedFetchUrl(activeTab.favicon);
                if (hostname && routedUrl !== null) saveFavicon(hostname, activeTab.favicon, routedUrl);
            }
        }
        const existingLink = bm.findByUrl(urlInput);
        const metaImages = await this.discoverImages();
        const tracked = this.getTrackedImages(activeTabId);
        // Merge: meta-tag images first, then tracked images, deduplicated
        const seen = new Set(metaImages);
        const allImages = [...metaImages];
        for (const url of tracked) {
            if (!seen.has(url)) {
                allImages.push(url);
            }
        }

        const activeTab = this.model.findTab(activeTabId);
        await this.showBookmarkDialog({
            title: activeTab?.pageTitle || "",
            href: urlInput,
            discoveredImages: allImages,
            existingLink,
        });
    };

    /**
     * Unified bookmark dialog entry point. Both star button and context menu
     * route through this method. Fires app.events.browser.onBookmark before
     * showing the dialog so scripts can modify bookmark data.
     */
    showBookmarkDialog = async (params: {
        title: string;
        href: string;
        discoveredImages: string[];
        imgSrc?: string;
        category?: string;
        tags?: string[];
        existingLink?: LinkItem;
    }): Promise<void> => {
        const bm = this.bookmarks;
        if (!bm) return;

        const isEdit = !!params.existingLink;

        // Fire onBookmark event — scripts can modify all parameters
        const bookmarkEvent = new BookmarkEvent(
            params.existingLink?.title ?? params.title,
            params.existingLink?.href ?? params.href,
            params.discoveredImages,
            params.existingLink?.imgSrc ?? params.imgSrc ?? "",
            params.existingLink?.category ?? params.category ?? "",
            params.existingLink?.tags ?? params.tags ?? [],
            isEdit,
        );
        await app.events.browser.onBookmark.sendAsync(bookmarkEvent);

        // Show dialog with (possibly modified) event data
        const bmState = bm.linkEditor.state.get();
        const result = await showEditLinkDialog({
            title: isEdit ? t("browser.bookmarkEdit") : t("browser.bookmarkAdd"),
            link: {
                title: bookmarkEvent.title,
                href: bookmarkEvent.href,
                imgSrc: bookmarkEvent.imgSrc || undefined,
                category: bookmarkEvent.category,
                tags: bookmarkEvent.tags,
            },
            categories: bmState.categories,
            tags: bmState.tags,
            discoveredImages: bookmarkEvent.discoveredImages,
            imageProxy: bm.linkEditor.imageProxy,
        });

        if (!result) return;

        if (params.existingLink) {
            bm.linkEditor.updateLink(params.existingLink.id, result);
        } else {
            bm.linkEditor.addLink(result);
        }
    };

    // =====================================================================
    // Image Discovery
    // =====================================================================

    /**
     * Extract og:image, twitter:image, and similar meta tag images from the active webview.
     * Bounded by `IMAGE_DISCOVERY_TIMEOUT` — returns `[]` rather than making the caller wait
     * on a page that cannot answer.
     */
    discoverImages = async (): Promise<string[]> => {
        const webview = this.model.webview.getActiveWebview();
        if (!webview) return [];
        try {
            const probe: Promise<string[]> = webview.executeJavaScript(`
                (() => {
                    const imgs = [];
                    const seen = new Set();
                    const add = (u) => {
                        try {
                            const abs = new URL(u, document.baseURI).href;
                            if (abs.startsWith('http') && !seen.has(abs)) {
                                seen.add(abs);
                                imgs.push(abs);
                            }
                        } catch {}
                    };
                    const og = document.querySelector('meta[property="og:image"]');
                    if (og) add(og.content);
                    const ogUrl = document.querySelector('meta[property="og:image:url"]');
                    if (ogUrl) add(ogUrl.content);
                    const tw = document.querySelector('meta[name="twitter:image"]')
                        || document.querySelector('meta[property="twitter:image"]');
                    if (tw) add(tw.content);
                    const schema = document.querySelector('meta[itemprop="image"]');
                    if (schema) add(schema.content);
                    const touch = document.querySelector('link[rel="apple-touch-icon"]');
                    if (touch) add(touch.href);
                    return imgs;
                })()
            `);
            return (await withTimeout(probe, IMAGE_DISCOVERY_TIMEOUT, [])) || [];
        } catch {
            return [];
        }
    };

    /** Collect all tracked images for a tab across all levels, deduplicated. */
    getTrackedImages = (tabId: string): string[] => {
        const tracked = this.trackedImagesRef.get(tabId) || [];
        const urls: string[] = [];
        const seen = new Set<string>();
        for (const entry of tracked) {
            for (const url of entry.imgUrls) {
                if (!seen.has(url)) {
                    seen.add(url);
                    urls.push(url);
                }
            }
        }
        return urls;
    };

    /** Add clicked images to a tab's level 0 tracking. Called from webview model. */
    trackClickedImages = (tabId: string, imgUrls: string[]) => {
        const tracked = this.trackedImagesRef.get(tabId) || [];
        let level0 = tracked.find((e) => e.level === 0);
        if (!level0) {
            level0 = { level: 0, imgUrls: [] };
            tracked.unshift(level0);
            this.trackedImagesRef.set(tabId, tracked);
        }
        for (const url of imgUrls) {
            if (url && !level0.imgUrls.includes(url)) {
                level0.imgUrls.push(url);
            }
        }
    };

    /** Shift tracked images on navigation: increment levels, drop > 2, add fresh level 0. */
    shiftTrackedImages = (tabId: string) => {
        const prev = this.trackedImagesRef.get(tabId) || [];
        const shifted = prev
            .map((e) => ({ level: e.level + 1, imgUrls: e.imgUrls }))
            .filter((e) => e.level <= 2);
        this.trackedImagesRef.set(tabId, [{ level: 0, imgUrls: [] }, ...shifted]);
    };
}
