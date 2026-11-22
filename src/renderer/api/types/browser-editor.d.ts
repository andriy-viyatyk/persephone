import type { SiteAction, SiteActionOutcome } from "./site-extensions";

/**
 * IBrowserEditor — script interface for browser pages.
 *
 * Obtained via `page.editor`. Only available for browser pages.
 *
 * Content automation methods accept tab IDs or live popup IDs in `{ tabId }`;
 * defaults to the active tab. Tab management and active-tab navigation methods
 * accept tab IDs only.
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
/** CSS, text=, role=, label=, placeholder=, testid=, title= or alt= locator string, or a host-local accessibility snapshot ref. */
export interface IBrowserLocatorRegex { regex: string; flags?: string }
export interface IBrowserLocatorModifiers {
    /** Restrict matches to descendants of another locator; { ref } must name a main-frame element. */
    within?: string | { ref: string } | IBrowserLocatorObject;
    /** Role-name matcher, or a JSON-safe regular expression object. */
    name?: string | IBrowserLocatorRegex;
    /** Exact match for name, label, placeholder, title, alt, or text. */
    exact?: boolean;
    /** Filter the matched element by normalized DOM text. */
    hasText?: string;
    /** Require visibility when true; false adds no filter. */
    visible?: boolean;
    /** Signed raw selector-step index; negative values count from the end. */
    nth?: number;
}
export type IBrowserLocatorObject = IBrowserLocatorModifiers & (
    | { role: string; label?: never; placeholder?: never; testId?: never; title?: never; alt?: never; text?: never; selector?: never }
    | { label: string; role?: never; placeholder?: never; testId?: never; title?: never; alt?: never; text?: never; selector?: never }
    | { placeholder: string; role?: never; label?: never; testId?: never; title?: never; alt?: never; text?: never; selector?: never }
    | { testId: string; role?: never; label?: never; placeholder?: never; title?: never; alt?: never; text?: never; selector?: never }
    | { title: string; role?: never; label?: never; placeholder?: never; testId?: never; alt?: never; text?: never; selector?: never }
    | { alt: string; role?: never; label?: never; placeholder?: never; testId?: never; title?: never; text?: never; selector?: never }
    | { text: string; role?: never; label?: never; placeholder?: never; testId?: never; title?: never; alt?: never; selector?: never }
    | { selector: string; role?: never; label?: never; placeholder?: never; testId?: never; title?: never; alt?: never; text?: never }
);
/**
 * Selector strings support CSS, text/role/attribute engines, chaining (>>), suffix filters,
 * positional nth= steps, and a leading main-frame ref=e12 step. A ref= step must be first.
 * Object form accepts exactly one of role, label, placeholder, testId, title, alt, text, selector,
 * plus name/exact/within/hasText/visible/nth modifiers. Regex names use { regex, flags? } so they
 * remain JSON-safe; exact is limited to role name, label, placeholder, title, alt, and text.
 * Selector nth= selects from the raw ordered union; action option { nth } selects after final visibility filtering.
 * Snapshot-root and wait selector APIs remain selector/ref-only.
 */
export type IBrowserElementLocator = string | { ref: string } | IBrowserLocatorObject;
export type IBrowserJsonValue = null | boolean | number | string | IBrowserJsonValue[] | { [key: string]: IBrowserJsonValue };
export type IBrowserLocatorReadOptions = { nth?: number; tabId?: string };
export type IBrowserQueryField = "role" | "name" | "text" | "visible" | "enabled" | "checked" | "tag" | "ref" | "value" | "attributes";
export interface IBrowserQueryOptions extends IBrowserLocatorReadOptions { fields?: IBrowserQueryField[] }
export interface IBrowserQueryResult { matches: Array<Record<string, unknown>>; truncated: boolean }
export interface IBrowserWaitForFunctionOptions {
    args?: IBrowserJsonValue[];
    timeout?: number;
    polling?: "raf" | number;
    tabId?: string;
}
export type IBrowserEvaluateFunction = (...args: never[]) => unknown;
export type IBrowserMousePosition = { x: number; y: number };
export type IBrowserMouseModifier = "Alt" | "Control" | "Meta" | "Shift";
export interface IBrowserClickOptions {
    tabId?: string;
    button?: "left" | "right" | "middle";
    clickCount?: number;
    /** For browser guests, allow Persephone's browser context menu after a right-click. */
    nativeMenu?: boolean;
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
    /** Focus the target directly instead of using the default trusted click. */
    focus?: "focus" | "click";
}

export interface IBrowserCoordinateOptions { tabId?: string; button?: "left" | "right" | "middle"; clickCount?: number; /** For browser guests, allow Persephone's browser context menu after a right-click. */ nativeMenu?: boolean }
export interface IBrowserDragTimingOptions extends IBrowserCoordinateOptions { steps?: number; holdMs?: number }
export type IBrowserDragDestination = IBrowserElementLocator | { by: IBrowserMousePosition };
export interface IBrowserDragOptions {
    tabId?: string; position?: IBrowserMousePosition; targetPosition?: IBrowserMousePosition;
    modifiers?: IBrowserMouseModifier[]; force?: boolean; nth?: number; timeout?: number; steps?: number; holdMs?: number;
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
    /** Live real BrowserWindow pop-ups opened by this page. Popup IDs are runtime-only content targets. */
    readonly popups: IBrowserPopup[];
    /** Close one owned popup and wait for its beforeunload handler to finish. */
    closePopup(id: string): Promise<void>;
    /** Fullscreen the largest visible selector match in the main frame, or a playing video across frames. */
    fullscreen(selector?: string, options?: { tabId?: string }): Promise<{ fullscreen: boolean }>;
    /** Exit this guest's HTML fullscreen without clearing independent host fullscreen. */
    exitFullscreen(options?: { tabId?: string }): Promise<{ fullscreen: boolean }>;
    /** Actions published by the trusted extension for the active document. */
    readonly siteActions: SiteAction[];
    /** Run page code and open its result; URLs may access local networks and redirects. */
    runSiteAction(id: string): Promise<SiteActionOutcome>;
    /** Consume a video choice returned by runSiteAction. */
    chooseSiteActionResult(token: string, index: number): Promise<SiteActionOutcome>;
    /** Attach a page-scoped test script for one exact HTTP(S) host authority. */
    attachTestExtension(options: ITemporarySiteExtensionOptions): Promise<ITemporarySiteExtensionAttachResult>;
    /** Detach the temporary rule for a host authority and clean up its current documents. */
    detachTestExtension(host: string): Promise<ITemporarySiteExtensionDetachResult>;
    /** Read attached temporary test extensions without exposing their source or params. */
    readonly testExtensions: ITemporarySiteExtensionListItem[];
    /** Current URL of the active tab. */
    readonly url: string | undefined;

    /** Current page title of the active tab. */
    readonly title: string | undefined;

    /** Read Chromium's leaf-first base64 DER certificate chain for the active HTTPS page.
     *  Returns undefined for non-HTTPS pages or when Chromium has no chain for the tab yet. */
    getCertificate(): Promise<{ url: string; certificates: string[] } | undefined>;

    // --- Navigation ---

    /** Dispatch navigation without waiting for completion. Supports URLs and search queries. */
    navigate(url: string): Promise<void>;

    /** Navigate, await a lifecycle event, and return the committed URL and HTTP status. */
    navigateAndWait(url: string, options?: IBrowserNavigationOptions): Promise<IBrowserNavigationResult>;

    /** Go back and await the main-frame result; rejects immediately when history is absent. */
    back(options?: IBrowserNavigationOptions): Promise<IBrowserNavigationResult>;

    /** Go forward and await the main-frame result; rejects immediately when history is absent. */
    forward(options?: IBrowserNavigationOptions): Promise<IBrowserNavigationResult>;

    /** Reload the active tab, even while it is loading, and await the reloaded document's result. */
    reload(options?: IBrowserNavigationOptions): Promise<IBrowserNavigationResult>;

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
     * `{ ref: "e52" }`; plain strings accept CSS, text=, role=, label=, placeholder=, testid=, title= or alt=.
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
    /** Focus a visible element without dispatching pointer input. */
    focus(locator: IBrowserElementLocator, options?: IBrowserActionOptions): Promise<void>;
    /** Trusted click at selected page viewport CSS pixels from the top-left. */
    clickAt(position: IBrowserMousePosition, options?: IBrowserCoordinateOptions): Promise<void>;
    /** Trusted drag between selected page viewport CSS pixel coordinates. */
    dragTo(points: { from: IBrowserMousePosition; to: IBrowserMousePosition }, options?: IBrowserDragTimingOptions): Promise<void>;

    // --- Query methods ---

    /** Get textContent by CSS, text=, role=, label=, placeholder=, testid=, title=, alt= or explicit snapshot ref. Returns null if not found. */
    getText(locator: IBrowserElementLocator, options?: { tabId?: string }): Promise<string | null>;

    /** Get a value by CSS, text=, role=, label=, placeholder=, testid=, title=, alt= or explicit snapshot ref. Returns null if not found. */
    getValue(locator: IBrowserElementLocator, options?: { tabId?: string }): Promise<string | null>;

    /** Get an attribute by CSS, text=, role=, label=, placeholder=, testid=, title=, alt= or explicit snapshot ref. Returns null if unavailable. */
    getAttribute(locator: IBrowserElementLocator, attribute: string, options?: { tabId?: string }): Promise<string | null>;

    /** Get innerHTML by CSS, text=, role=, label=, placeholder=, testid=, title=, alt= or explicit snapshot ref. Returns null if not found. */
    getHtml(locator: IBrowserElementLocator, options?: { tabId?: string }): Promise<string | null>;

    /** Check whether a CSS, text=, role=, label=, placeholder=, testid=, title=, alt= locator or explicit snapshot ref identifies an element. */
    exists(locator: IBrowserElementLocator, options?: { tabId?: string }): Promise<boolean>;

    /** Count resolver matches immediately; nth selects a zero-based match. */
    count(locator: IBrowserElementLocator, options?: IBrowserLocatorReadOptions): Promise<number>;
    /** Read visibility immediately; zero matches returns false and multiple matches are strict. */
    isVisible(locator: IBrowserElementLocator, options?: IBrowserLocatorReadOptions): Promise<boolean>;
    /** Read enabled state immediately using native disabled and inherited aria-disabled rules. */
    isEnabled(locator: IBrowserElementLocator, options?: IBrowserLocatorReadOptions): Promise<boolean>;
    /** Read native or supported ARIA checked state immediately. */
    isChecked(locator: IBrowserElementLocator, options?: IBrowserLocatorReadOptions): Promise<boolean>;
    /** Read untrimmed innerText from one HTML element. */
    innerText(locator: IBrowserElementLocator, options?: IBrowserLocatorReadOptions): Promise<string>;
    /** Read innerText for every resolver match, in resolver order. */
    allInnerTexts(locator: IBrowserElementLocator, options?: IBrowserLocatorReadOptions): Promise<string[]>;
    /** Read a visible element's CSS-pixel box relative to the target viewport. */
    boundingBox(locator: IBrowserElementLocator, options?: IBrowserLocatorReadOptions): Promise<{ x: number; y: number; width: number; height: number } | null>;
    /** Capture bounded element fields; role and name are Chromium accessibility facts. */
    query(locator: IBrowserElementLocator, options?: IBrowserQueryOptions): Promise<IBrowserQueryResult>;
    /** Poll a page function until it returns a truthy JSON value or the timeout expires. */
    waitForFunction(fn: string | IBrowserEvaluateFunction, options?: IBrowserWaitForFunctionOptions): Promise<IBrowserJsonValue>;

    // --- Interaction methods ---

    /** Click by CSS, text=, role=, label=, placeholder=, testid=, title=, alt= locator or ref using trusted mouse input by default. */
    click(locator: IBrowserElementLocator, options?: IBrowserClickOptions): Promise<void>;

    /** Move the page pointer over a CSS, text=, role=, label=, placeholder=, testid=, title=, alt= locator or ref. */
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
    drag(source: IBrowserElementLocator, destination: IBrowserDragDestination, options?: IBrowserDragOptions): Promise<void>;
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
    /** Current document trust prompt, including separately requested fetch hosts. */
    readonly siteExtensionTrustPrompt: { status: "waiting-for-user"; name: string; id: string; host: string; otherHosts: string[]; fetchHosts: string[]; note: string } | undefined;
    /**
     * Answer the active document's site-extension trust bar with Trust, as its button does.
     * Call it yourself for an extension you built on the user's request; any other extension
     * is the user's decision unless they ask you to review and trust it.
     */
    trustSiteExtension(): Promise<{ status: "trusted" | "changed" | "unavailable" | "not-current" | "no-prompt"; id?: string; hosts?: string[]; fetchHosts?: string[] }>;
    /** Answer the active document's site-extension trust bar with Not now. */
    dismissSiteExtensionTrustPrompt(): { status: "dismissed" | "no-prompt" };
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
    waitForURL(pattern: string | RegExp | { regex: string; flags?: string }, options?: IBrowserNavigationOptions): Promise<IBrowserNavigationResult>;

    /** Arm before the triggering action; strings match exactly, RegExp supports query matching. Resolves on the final response's headers; with `includeBody`, once its body finishes loading. */
    waitForResponse(urlOrRegex: string | RegExp | { regex: string; flags?: string }, options?: IBrowserResponseWaitOptions): Promise<IBrowserResponse>;

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

/** Current metadata for one real browser pop-up window. */
export interface IBrowserPopup {
    readonly id: string;
    /** Immediate opener tab ID or popup ID. */
    readonly openerId: string;
    readonly url: string;
    readonly title: string;
    readonly loading: boolean;
}

export interface ITemporarySiteExtensionOptions {
    host: string;
    name?: string;
    scriptPath?: string;
    source?: string;
    params?: Record<string, IBrowserJsonValue>;
}
export interface ITemporarySiteExtensionAttachResult {
    host: string;
    targets: { id: string; status: "injected" | "deferred" | "error"; error?: string }[];
}
export interface ITemporarySiteExtensionDetachResult {
    status: "detached" | "not-found";
    errors: { id: string; error: string }[];
}
export interface ITemporarySiteExtensionListItem {
    host: string;
    name?: string;
    scriptPath?: string;
    inline: boolean;
    injectedTabs: string[];
    /** Tabs whose last injection attempt failed, with the reason (for example an unreadable scriptPath). */
    failedTabs: Array<{ tabId: string; error: string }>;
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
