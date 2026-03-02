import type { PageEditor } from "../../../shared/types";

/**
 * IPageCollection — `app.pages`
 *
 * Manage open pages (tabs) in the current window.
 *
 * @example
 * // List all open pages
 * app.pages.activePage
 *
 * // Open a file
 * await app.pages.openFile("C:/data.json");
 *
 * // Add an empty page
 * app.pages.addEmptyPage();
 */
export interface IPageCollection {
    // ── Queries ──────────────────────────────────────────────────────

    /** Currently active (visible) page, or undefined. */
    readonly activePage: IPageInfo | undefined;

    /** The grouped (side-by-side) partner of the active page, if any. */
    readonly groupedPage: IPageInfo | undefined;

    /** Find a page by its ID. */
    findPage(pageId: string): IPageInfo | undefined;

    /** Get the grouped (side-by-side) partner of a page, if any. */
    getGroupedPage(withPageId: string): IPageInfo | undefined;

    /** True if the page is the last tab in the tab bar. */
    isLastPage(pageId?: string): boolean;

    /** True if the page is currently grouped (side-by-side). */
    isGrouped(pageId: string): boolean;

    // ── Lifecycle ────────────────────────────────────────────────────

    /** Open a file in a new or existing tab. */
    openFile(filePath: string): Promise<void>;

    /** Show the Open File dialog and open the selected file. */
    openFileWithDialog(): Promise<void>;

    /** Navigate an existing page to a different file. */
    navigatePageTo(pageId: string, newFilePath: string, options?: {
        revealLine?: number;
        highlightText?: string;
        forceTextEditor?: boolean;
    }): Promise<boolean>;

    /** Add an empty text page. */
    addEmptyPage(): IPageInfo;

    /** Add a page with a specific editor, language, and title. */
    addEditorPage(editor: PageEditor, language: string, title: string): IPageInfo;

    /** Open a diff view for two files side by side. */
    openDiff(params: { firstPath: string; secondPath: string }): Promise<void>;

    /** Show the About page. */
    showAboutPage(): Promise<void>;

    /** Show the Settings page. */
    showSettingsPage(): Promise<void>;

    /** Show a browser page, optionally with a profile or URL. */
    showBrowserPage(options?: {
        profileName?: string;
        incognito?: boolean;
        url?: string;
    }): Promise<void>;

    /** Open a URL in a browser tab (internal or existing). */
    openUrlInBrowserTab(url: string, options?: {
        incognito?: boolean;
        profileName?: string;
        external?: boolean;
    }): Promise<void>;

    // ── Navigation ───────────────────────────────────────────────────

    /** Activate (show) a page by ID. */
    showPage(pageId: string): void;

    /** Activate the next tab (wraps around). */
    showNext(): void;

    /** Activate the previous tab (wraps around). */
    showPrevious(): void;

    // ── Layout ───────────────────────────────────────────────────────

    /** Move a tab to a new position. */
    moveTab(fromId: string, toId: string): void;

    /** Pin a tab. */
    pinTab(pageId: string): void;

    /** Unpin a tab. */
    unpinTab(pageId: string): void;

    /** Group two pages side by side. */
    group(leftPageId: string, rightPageId: string): void;

    /** Remove a page from its group. */
    ungroup(pageId: string): void;
}

/**
 * Read-only page information exposed to scripts.
 * Access via `app.pages.activePage` or `app.pages.findPage(id)`.
 */
export interface IPageInfo {
    readonly id: string;
    readonly type: string;
    readonly title: string;
    readonly modified: boolean;
    readonly pinned: boolean;
    readonly filePath?: string;
    readonly language?: string;
}
