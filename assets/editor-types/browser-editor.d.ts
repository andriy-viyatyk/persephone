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
 *
 * // Query the page
 * const heading = await browser.getText("h1");
 * const exists = await browser.exists("#login-form");
 *
 * // Interact with elements
 * await browser.type("#search", "hello");
 * await browser.click("#submit");
 */
export interface IBrowserEditor {
    /** Current URL of the active tab. */
    readonly url: string;

    /** Current page title of the active tab. */
    readonly title: string;

    // --- Navigation ---

    /** Navigate the active tab to a URL. Supports URLs and search queries. */
    navigate(url: string): void;

    /** Go back in history. */
    back(): void;

    /** Go forward in history. */
    forward(): void;

    /** Reload the current page (or stop loading if in progress). */
    reload(): void;

    // --- Evaluate ---

    /**
     * Run JavaScript in the page and return the result.
     * Supports async expressions (awaited automatically).
     *
     * @example
     * const title = await browser.evaluate("document.title");
     * const count = await browser.evaluate("document.querySelectorAll('a').length");
     */
    evaluate(expression: string): Promise<unknown>;

    // --- Query methods ---

    /** Get textContent of an element. Returns null if not found. */
    getText(selector: string): Promise<string | null>;

    /** Get the value of an input/textarea/select. Returns null if not found. */
    getValue(selector: string): Promise<string | null>;

    /** Get an attribute value. Returns null if element or attribute not found. */
    getAttribute(selector: string, attribute: string): Promise<string | null>;

    /** Get innerHTML of an element. Returns null if not found. */
    getHtml(selector: string): Promise<string | null>;

    /** Check if an element exists on the page. */
    exists(selector: string): Promise<boolean>;

    // --- Interaction methods ---

    /** Click an element. Throws if not found. */
    click(selector: string): Promise<void>;

    /**
     * Type text into an input/textarea. Clears existing value first.
     * Dispatches input and change events for framework compatibility.
     * Throws if not found.
     */
    type(selector: string, text: string): Promise<void>;

    /** Select an option in a <select> element by value. Throws if not found. */
    select(selector: string, value: string): Promise<void>;

    /** Check a checkbox or radio button. Throws if not found. */
    check(selector: string): Promise<void>;

    /** Uncheck a checkbox. Throws if not found. */
    uncheck(selector: string): Promise<void>;

    /** Clear the value of an input/textarea. Throws if not found. */
    clear(selector: string): Promise<void>;
}
