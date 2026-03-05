/**
 * IHtmlEditor — script interface for the HTML preview.
 *
 * Obtained via `page.asHtml()`. Only for text pages with HTML content.
 *
 * @example
 * const htmlEditor = await page.asHtml();
 * console.log(htmlEditor.html); // the HTML source
 */
export interface IHtmlEditor {
    /** The HTML source content. */
    readonly html: string;
}
