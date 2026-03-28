/**
 * ILinkEditor — scripting interface for the Link editor.
 *
 * Access via `await page.asLink()` on `.link.json` pages.
 *
 * @example
 * const le = await page.asLink();
 * le.addLink("https://example.com", "Example", "bookmarks");
 */
export interface ILinkEditor {
    /** All links (complete data, not filtered by UI). */
    readonly links: ILink[];

    /** All category names. */
    readonly categories: string[];

    /** All tag names. */
    readonly tags: string[];

    /** Total number of links. */
    readonly linksCount: number;

    /** Add a new link. */
    addLink(url: string, title?: string, category?: string): void;

    /** Delete a link by ID. */
    deleteLink(id: string): void;

    /** Update link properties. Map `url` to the link's href. */
    updateLink(id: string, data: { title?: string; category?: string; url?: string }): void;
}

/** A single link item. */
export interface ILink {
    readonly id: string;
    readonly url: string;
    readonly title: string;
    readonly category: string;
    readonly tags: readonly string[];
    readonly pinned: boolean;
    /** Whether this item represents a category/folder rather than a leaf link. */
    readonly isCategory: boolean;
}
