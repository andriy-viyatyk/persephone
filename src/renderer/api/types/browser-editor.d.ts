/**
 * IBrowserEditor — script interface for browser pages.
 *
 * Obtained via `page.asBrowser()`. Only available for browser pages.
 *
 * @example
 * const browser = await page.asBrowser();
 * browser.navigate("https://example.com");
 * console.log(browser.url);   // "https://example.com"
 * console.log(browser.title); // "Example Domain"
 */
export interface IBrowserEditor {
    /** Current URL of the active tab. */
    readonly url: string;

    /** Current page title of the active tab. */
    readonly title: string;

    /** Navigate the active tab to a URL. Supports URLs and search queries. */
    navigate(url: string): void;

    /** Go back in history. */
    back(): void;

    /** Go forward in history. */
    forward(): void;

    /** Reload the current page (or stop loading if in progress). */
    reload(): void;
}
