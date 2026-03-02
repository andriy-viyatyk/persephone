import type { PageEditor } from "../../../shared/types";

/**
 * IPageCollection — `app.pages`
 *
 * Manage open pages (tabs) in the current window.
 *
 * @example
 * // List all open pages
 * app.pages.all.forEach(p => console.log(p.title));
 *
 * // Open a file
 * await app.pages.openFile("C:/data.json");
 *
 * // Close current page
 * if (app.pages.activePage) {
 *   await app.pages.close(app.pages.activePage.id);
 * }
 */
export interface IPageCollection {
    // ── Queries ──────────────────────────────────────────────────────

    /** All open pages in tab-bar order. */
    readonly all: ReadonlyArray<IPageInfo>;

    /** Currently active (visible) page, or undefined. */
    readonly activePage: IPageInfo | undefined;

    /** Find a page by its ID. */
    find(pageId: string): IPageInfo | undefined;

    /** Get the grouped (side-by-side) partner of a page, if any. */
    getGrouped(pageId: string): IPageInfo | undefined;

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
    navigateTo(pageId: string, filePath: string): Promise<boolean>;

    /** Add an empty text page. */
    addEmpty(): IPageInfo;

    /** Add a page with a specific editor, language, and title. */
    addEditor(editor: PageEditor, language: string, title: string): IPageInfo;

    // ── Navigation ───────────────────────────────────────────────────

    /** Activate (show) a page by ID. */
    show(pageId: string): void;

    /** Activate the next tab (wraps around). */
    showNext(): void;

    /** Activate the previous tab (wraps around). */
    showPrevious(): void;

    // ── Layout ───────────────────────────────────────────────────────

    /** Move a tab to a new position. */
    moveTab(fromId: string, toId: string): void;

    /** Pin a tab. */
    pin(pageId: string): void;

    /** Unpin a tab. */
    unpin(pageId: string): void;

    /** Group two pages side by side. */
    group(leftId: string, rightId: string): void;

    /** Remove a page from its group. */
    ungroup(pageId: string): void;
}

/**
 * Read-only page information exposed to scripts.
 */
export interface IPageInfo {
    readonly id: string;
    readonly type: string;
    readonly title: string;
    readonly modified: boolean;
    readonly pinned: boolean;
    readonly filePath?: string;
    readonly language?: string;
    readonly editor?: PageEditor;
}
