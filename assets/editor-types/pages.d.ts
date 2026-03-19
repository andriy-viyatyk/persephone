import type { PageEditor } from "./common";
import type { IPage } from "./page";

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

    /** All open pages (tabs) in the current window. */
    readonly all: IPage[];

    /** Currently active (visible) page, or undefined. */
    readonly activePage: IPage | undefined;

    /** The grouped (side-by-side) partner of the active page, if any. */
    readonly groupedPage: IPage | undefined;

    /** Find a page by its ID. */
    findPage(pageId: string): IPage | undefined;

    /** Get the grouped (side-by-side) partner of a page, if any. */
    getGroupedPage(withPageId: string): IPage | undefined;

    /** True if the page is the last tab in the tab bar. */
    isLastPage(pageId?: string): boolean;

    /** True if the page is currently grouped (side-by-side). */
    isGrouped(pageId: string): boolean;

    // ── Lifecycle ────────────────────────────────────────────────────

    /** Open a file in a new or existing tab. Returns the page. */
    openFile(filePath: string): Promise<IPage | undefined>;

    /** Close a page by ID. Returns true if closed, false if cancelled (e.g. unsaved changes). */
    closePage(pageId: string): Promise<boolean>;

    /** Show the Open File dialog and open the selected file. */
    openFileWithDialog(): Promise<void>;

    /** Navigate an existing page to a different file. */
    navigatePageTo(pageId: string, newFilePath: string, options?: {
        revealLine?: number;
        highlightText?: string;
        forceTextEditor?: boolean;
    }): Promise<boolean>;

    /** Add an empty text page. */
    addEmptyPage(): IPage;

    /** Add a page with a specific editor, language, and title. */
    addEditorPage(editor: PageEditor, language: string, title: string): IPage;

    /** Create a new drawing page with an embedded image.
     * @param dataUrl Image as data URL (e.g., `"data:image/png;base64,..."`)
     * @param title Optional page title (default: `"untitled.excalidraw"`)
     */
    addDrawPage(dataUrl: string, title?: string): Promise<IPage>;

    /** Open a diff view for two files side by side. */
    openDiff(params: { firstPath: string; secondPath: string }): Promise<void>;

    /** Show the About page. */
    showAboutPage(): Promise<void>;

    /** Show the Settings page. */
    showSettingsPage(): Promise<void>;

    /** Show an MCP Inspector page, optionally with a pre-filled URL. */
    showMcpInspectorPage(options?: { url?: string }): Promise<void>;

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
