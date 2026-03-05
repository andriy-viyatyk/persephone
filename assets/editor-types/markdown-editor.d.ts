/**
 * IMarkdownEditor — script interface for the markdown preview.
 *
 * Obtained via `page.asMarkdown()`. Only for text pages with markdown content.
 *
 * @example
 * const md = await page.asMarkdown();
 * if (md.viewMounted) {
 *     console.log(md.html); // rendered HTML from the preview
 * }
 */
export interface IMarkdownEditor {
    /** True if the markdown preview container is mounted in the DOM. */
    readonly viewMounted: boolean;

    /** The rendered HTML content from the preview container. Empty if view is not mounted. */
    readonly html: string;
}
