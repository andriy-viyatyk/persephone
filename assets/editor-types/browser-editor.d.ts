/**
 * IBrowserEditor — script interface for browser pages.
 *
 * Obtained via `page.editor`. Only available for browser pages.
 *
 * All automation methods accept an optional `{ tabId }` option to target
 * a specific tab. Defaults to the active tab.
 *
 * @example
 * const browser = page.editor;
 * browser.navigate("https://example.com");
 *
 * // Query and interact
 * await browser.waitForSelector("h1");
 * const heading = await browser.getText("h1");
 * await browser.type("#search", "hello");
 * await browser.click("#submit");
 *
 * // Work with tabs
 * const newTab = browser.addTab("https://other.com");
 * await browser.waitForNavigation({ tabId: newTab });
 * const title = await browser.getText("h1", { tabId: newTab });
 */
export type IBrowserElementLocator = string | { ref: string };
export type IBrowserJsonValue = null | boolean | number | string | IBrowserJsonValue[] | { [key: string]: IBrowserJsonValue };
export type IBrowserEvaluateFunction = (...args: never[]) => unknown;
export type IBrowserMousePosition = { x: number; y: number };
export type IBrowserMouseModifier = "Alt" | "Control" | "Meta" | "Shift";
export interface IBrowserClickOptions {
    tabId?: string;
    button?: "left" | "right" | "middle";
    clickCount?: number;
    modifiers?: IBrowserMouseModifier[];
    position?: IBrowserMousePosition;
    force?: boolean;
    synthetic?: boolean;
    nth?: number;
    timeout?: number;
}
export interface IBrowserHoverOptions {
    tabId?: string;
    position?: IBrowserMousePosition;
    modifiers?: IBrowserMouseModifier[];
    force?: boolean;
    synthetic?: boolean;
    nth?: number;
    timeout?: number;
}
export interface IBrowserTypeOptions {
    tabId?: string;
    slowly?: boolean;
    submit?: boolean;
    synthetic?: boolean;
    nth?: number;
    timeout?: number;
    force?: boolean;
}
export interface IBrowserSelectOptions { tabId?: string; nth?: number; timeout?: number; force?: boolean }
export interface IBrowserActionOptions { tabId?: string; nth?: number; timeout?: number; force?: boolean }
export interface IBrowserKeyboardOptions {
    tabId?: string;
    target?: IBrowserElementLocator;
    nth?: number;
    timeout?: number;
    synthetic?: boolean;
}

export interface IBrowserDragOptions {
    tabId?: string; position?: IBrowserMousePosition; targetPosition?: IBrowserMousePosition;
    modifiers?: IBrowserMouseModifier[]; force?: boolean; nth?: number; timeout?: number;
}
export type IBrowserFormField =
    | { name: string; locator: IBrowserElementLocator; action: "type"; value: string; options?: IBrowserTypeOptions }
    | { name: string; locator: IBrowserElementLocator; action: "select"; value: string | string[]; options?: IBrowserSelectOptions }
    | { name: string; locator: IBrowserElementLocator; action: "check" | "uncheck"; options?: IBrowserActionOptions };
export type IBrowserScreenshotFormat = "png" | "jpeg";
export interface IBrowserScreenshotOptions {
    tabId?: string; target?: IBrowserElementLocator; fullPage?: boolean; format?: IBrowserScreenshotFormat; quality?: number;
    /** Zero-based among visible matches when `target` is a selector matching several. */
    nth?: number;
}
export interface IBrowserEvaluateOptions { tabId?: string; args?: IBrowserJsonValue[] }
export interface IBrowserViewportOptions { tabId?: string; width: number; height: number; deviceScaleFactor?: number }

export interface IBrowserScreenshot {
    readonly type: "image";
    readonly data: string;
    readonly mimeType: "image/png" | "image/jpeg";
}

export interface IBrowserNetworkRequest {
    readonly id: number;
    readonly url: string;
    readonly method: string;
    readonly resourceType: string;
    readonly referrer: string;
    readonly timestamp: number;
    readonly requestHeaders: Record<string, string>;
    readonly requestBody?: string;
    readonly statusCode?: number;
    readonly statusLine?: string;
    readonly responseHeaders?: Record<string, string[]>;
    readonly fromCache?: boolean;
    readonly error?: string;
    readonly responseBody?: string;
    readonly responseBodyBase64Encoded?: boolean;
    readonly responseBodyTruncated?: boolean;
}

export interface IBrowserNetworkRequestsOptions { tabId?: string; includeBodies?: boolean; maxBodyBytes?: number }
export interface IBrowserResponseWaitOptions { timeout?: number; tabId?: string; includeBody?: boolean; maxBodyBytes?: number }
export interface IBrowserResponse {
    readonly url: string;
    readonly status: number;
    readonly statusText: string;
    readonly headers: Record<string, string>;
    readonly mimeType: string;
    readonly body?: string;
    readonly base64Encoded?: boolean;
    readonly truncated?: boolean;
}

export type IBrowserDialogPolicy = "accept" | "dismiss" | "manual";
export type IBrowserDialogDisposition = "accepted" | "dismissed" | "pending";
export type IBrowserConsoleLevel = "debug" | "info" | "log" | "warning" | "error";
export interface IBrowserDialogRecord {
    readonly type: string;
    readonly message: string;
    readonly url: string;
    readonly timestamp: number;
    readonly disposition: IBrowserDialogDisposition;
}
export interface IBrowserConsoleMessage {
    readonly type: IBrowserConsoleLevel;
    readonly args: readonly string[];
    readonly url: string;
    readonly lineNumber: number;
    readonly columnNumber: number;
    readonly timestamp: number;
}
export interface IBrowserPageError {
    readonly text: string;
    readonly url: string;
    readonly lineNumber: number;
    readonly columnNumber: number;
    readonly timestamp: number;
}

export interface IBrowserEditor {
    readonly id: "browser-view";
    readonly name: string;
    /** Current URL of the active tab. */
    readonly url: string | undefined;

    /** Current page title of the active tab. */
    readonly title: string | undefined;

    // --- Navigation ---

    /** Dispatch navigation without waiting for completion. Supports URLs and search queries. */
    navigate(url: string): Promise<void>;

    /** Navigate, await a lifecycle event, and return the committed URL and HTTP status. */
    navigateAndWait(url: string, options?: IBrowserNavigationOptions): Promise<IBrowserNavigationResult>;

    /** Go back and await the main-frame result; rejects immediately when history is absent. */
    back(options?: IBrowserNavigationOptions): Promise<IBrowserNavigationResult>;

    /** Go forward and await the main-frame result; rejects immediately when history is absent. */
    forward(options?: IBrowserNavigationOptions): Promise<IBrowserNavigationResult>;

    /** Reload the current page (or stop loading if in progress). */
    reload(): Promise<void>;

    // --- Tab management ---

    /** List of all open tabs in this browser page. */
    readonly tabs: IBrowserTab[];

    /** The active (visible) tab. */
    readonly activeTab: IBrowserTab | undefined;

    /** Open a new tab. Returns the new tab's ID. */
    addTab(url?: string): string;

    /** Close a tab. Defaults to active tab. */
    closeTab(tabId?: string): "Tab closed";

    /** Switch to a tab (make it active/visible). */
    switchTab(tabId: string): void;

    // --- Evaluate ---

    /**
     * Run JavaScript in the page and return the result.
     * Supports async expressions (awaited automatically).
     */
    evaluate(expression: string | IBrowserEvaluateFunction, options?: IBrowserEvaluateOptions): Promise<unknown>;

    /**
     * Get an accessibility snapshot of the page as a YAML-like tree.
     * Format matches Playwright MCP's browser_snapshot output. It may begin with
     * `# <overlay>` when a modal covers the page. Pass a returned ref explicitly as
     * `{ ref: "e52" }`; plain strings are always CSS selectors.
     *
     * @example
     * const snapshot = await browser.snapshot();
     * // - heading "Page Title" [level=1] [ref=e40]
     * // - textbox "Search" [ref=e52]
     * // - button "Submit" [ref=e65]
     * await browser.snapshot({ interactive: true });
     * await browser.snapshot({ root: { ref: "e40" }, maxChars: 8000 });
     */
    snapshot(options?: { tabId?: string; root?: string | { ref: string }; interactive?: boolean; maxNodes?: number; maxChars?: number }): Promise<string>;

    // --- Query methods ---

    /** Get textContent by CSS selector or explicit snapshot ref. Returns null if not found. */
    getText(locator: IBrowserElementLocator, options?: { tabId?: string }): Promise<string | null>;

    /** Get a value by CSS selector or explicit snapshot ref. Returns null if not found. */
    getValue(locator: IBrowserElementLocator, options?: { tabId?: string }): Promise<string | null>;

    /** Get an attribute by CSS selector or explicit snapshot ref. Returns null if unavailable. */
    getAttribute(locator: IBrowserElementLocator, attribute: string, options?: { tabId?: string }): Promise<string | null>;

    /** Get innerHTML by CSS selector or explicit snapshot ref. Returns null if not found. */
    getHtml(locator: IBrowserElementLocator, options?: { tabId?: string }): Promise<string | null>;

    /** Check whether a CSS selector or explicit snapshot ref identifies an element. */
    exists(locator: IBrowserElementLocator, options?: { tabId?: string }): Promise<boolean>;

    // --- Interaction methods ---

    /** Click by CSS selector or ref using trusted mouse input by default. */
    click(locator: IBrowserElementLocator, options?: IBrowserClickOptions): Promise<void>;

    /** Move the page pointer over a CSS selector or ref. */
    hover(locator: IBrowserElementLocator, options?: IBrowserHoverOptions): Promise<void>;

    /**
     * Type text into an input/textarea. Clears existing value first.
     * Dispatches input and change events for framework compatibility.
     * Throws if not found.
     */
    type(locator: IBrowserElementLocator, text: string, options?: IBrowserTypeOptions): Promise<void>;

    /** Select an option in a <select> element by value. Throws if not found. */
    select(locator: IBrowserElementLocator, values: string | string[], options?: IBrowserSelectOptions): Promise<void>;

    /** Check a checkbox or radio button. Throws if not found. */
    check(locator: IBrowserElementLocator, options?: IBrowserActionOptions): Promise<void>;

    /** Uncheck a checkbox. Throws if not found. */
    uncheck(locator: IBrowserElementLocator, options?: IBrowserActionOptions): Promise<void>;

    /** Clear the value of an input/textarea. Throws if not found. */
    clear(locator: IBrowserElementLocator, options?: IBrowserTypeOptions): Promise<void>;

    /** Drag between actionable elements in the same frame. */
    drag(source: IBrowserElementLocator, destination: IBrowserElementLocator, options?: IBrowserDragOptions): Promise<void>;
    /** Fill named locator actions in order, stopping at the first failing field. */
    fillForm(fields: IBrowserFormField[]): Promise<void>;
    /** Assign local files directly to an input[type=file], including hidden inputs. */
    setInputFiles(locator: IBrowserElementLocator, paths: string[], options?: { tabId?: string }): Promise<void>;

    /** Wait for one selector, text, textGone, or time condition; selector state defaults to attached. */
    waitFor(options: {
        selector?: string;
        state?: IBrowserWaitState;
        text?: string;
        textGone?: string;
        time?: number;
        timeout?: number;
        tabId?: string;
    }): Promise<void>;

    /** Capture the selected tab as a PNG; unavailable sessions return undefined. */
    screenshot(options?: IBrowserScreenshotOptions): Promise<IBrowserScreenshot | undefined>;
    /** Emulate browser page viewport metrics inside the existing webview box. */
    setViewport(options: IBrowserViewportOptions): Promise<void>;
    /** Clear selected tab viewport emulation. */
    clearViewport(options?: { tabId?: string }): Promise<void>;

    /** Get request history. Response bodies require includeBodies and may contain secrets. */
    networkRequests(options?: IBrowserNetworkRequestsOptions): Promise<IBrowserNetworkRequest[]>;
    /** Read and optionally update per-page JavaScript dialog policy and recent dialog records. */
    dialogs(options?: { tabId?: string; policy?: IBrowserDialogPolicy }): Promise<{ policy: IBrowserDialogPolicy; dialogs: IBrowserDialogRecord[] }>;
    /** Resolve a pending page-authored JavaScript dialog. */
    handleDialog(accept: boolean, promptText?: string, options?: { tabId?: string }): Promise<void>;
    /** Read recent copied console records, optionally filtered by epoch-millisecond receipt time and level. */
    consoleMessages(options?: { tabId?: string; since?: number; level?: IBrowserConsoleLevel }): Promise<IBrowserConsoleMessage[]>;
    /** Read recent uncaught page exceptions. */
    pageErrors(options?: { tabId?: string }): Promise<IBrowserPageError[]>;

    // --- Wait methods ---

    /**
     * Wait for an element selector state. visible uses positive size, visibility not hidden, and display not none.
     * @param options.timeout — max wait time in ms (default 10000)
     * @param options.tabId — target tab (default: active tab)
     */
    waitForSelector(selector: string, options?: { state?: IBrowserWaitState; timeout?: number; tabId?: string }): Promise<void>;

    /**
     * Wait for the next or in-progress main-frame navigation using CDP lifecycle events.
     * HTTP 4xx/5xx responses resolve with their status; main-frame network failures reject.
     * @param options.timeout - max wait time in ms (default 10000)
     * @param options.tabId - target tab (default: active tab)
     */
    waitForNavigation(options?: IBrowserNavigationOptions): Promise<IBrowserNavigationResult>

    /** Wait for exact string or RegExp match on the main-frame URL, including SPA/hash changes. */
    waitForURL(pattern: string | RegExp, options?: IBrowserNavigationOptions): Promise<IBrowserNavigationResult>;

    /** Arm before the triggering action; strings match exactly, RegExp supports query matching. Resolves on the final response's headers; with `includeBody`, once its body finishes loading. */
    waitForResponse(urlOrRegex: string | RegExp, options?: IBrowserResponseWaitOptions): Promise<IBrowserResponse>;

    /** Wait for a specified number of milliseconds. */
    wait(ms: number): Promise<void>;

    /**
     * Press a key or key combination via CDP.
     * Supports compound keys: "Control+a", "Shift+Enter", "Control+Shift+Delete".
     */
    pressKey(key: string, options?: IBrowserKeyboardOptions): Promise<void>;
    /** Hold a key down; pair with keyUp to release it. */
    keyDown(key: string, options?: IBrowserKeyboardOptions): Promise<void>;
    /** Release a key held by keyDown. */
    keyUp(key: string, options?: IBrowserKeyboardOptions): Promise<void>;
}

export type IBrowserWaitState = "attached" | "detached" | "visible" | "hidden";
export interface IBrowserNavigationOptions {
    waitUntil?: "load" | "domcontentloaded" | "networkidle";
    timeout?: number;
    tabId?: string;
}
export interface IBrowserNavigationResult {
    url: string;
    /** Main-frame HTTP status; null for same-document, about:, and data: navigation. */
    status: number | null;
}

/** Represents a browser internal tab. */
export interface IBrowserTab {
    /** Internal tab ID (use with tabId option in automation methods). */
    readonly id: string;
    /** Current URL. */
    readonly url?: string;
    /** Page title. */
    readonly title?: string;
    /** Whether the page is currently loading. */
    readonly loading: boolean;
    /** Whether this is the active (visible) tab. */
    readonly active: boolean;
}
