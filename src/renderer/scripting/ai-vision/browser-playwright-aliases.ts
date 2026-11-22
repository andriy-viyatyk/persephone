import type { IAiMember } from "ai-vision";
import type {
    IBrowserActionOptions, IBrowserClickOptions, IBrowserElementLocator, IBrowserKeyboardOptions,
    IBrowserSelectOptions, IBrowserTypeOptions,
} from "../../api/types/browser-editor";

interface BrowserPlaywrightAliasHost {
    click(locator: IBrowserElementLocator, options?: IBrowserClickOptions): Promise<void>;
    type(locator: IBrowserElementLocator, text: string, options?: IBrowserTypeOptions): Promise<void>;
    pressKey(key: string, options?: IBrowserKeyboardOptions): Promise<void>;
    navigateAndWait(url: string, options?: { waitUntil?: "load" | "domcontentloaded" | "networkidle"; timeout?: number; tabId?: string }): Promise<{ url: string; status: number | null }>;
    select(locator: IBrowserElementLocator, values: string | string[], options?: IBrowserSelectOptions): Promise<void>;
    check(locator: IBrowserElementLocator, options?: IBrowserActionOptions): Promise<void>;
    uncheck(locator: IBrowserElementLocator, options?: IBrowserActionOptions): Promise<void>;
    getText(locator: IBrowserElementLocator, options?: { tabId?: string }): Promise<string | null>;
    getValue(locator: IBrowserElementLocator, options?: { tabId?: string }): Promise<string | null>;
    wait(ms: number): Promise<void>;
    back(options?: { waitUntil?: "load" | "domcontentloaded" | "networkidle"; timeout?: number; tabId?: string }): Promise<{ url: string; status: number | null }>;
    forward(options?: { waitUntil?: "load" | "domcontentloaded" | "networkidle"; timeout?: number; tabId?: string }): Promise<{ url: string; status: number | null }>;
}

/** Descriptor-only aliases for common Playwright names; all calls delegate to the facade. */
export const BROWSER_PLAYWRIGHT_ALIAS_MEMBERS: readonly IAiMember[] = [
    { name: "dblclick", kind: "method", signature: "dblclick(locator, options?)", summary: "Click twice with trusted input.", hidden: true },
    { name: "fill", kind: "method", signature: "fill(locator, text, options?)", summary: "Replace editable content, including native date/time/color/range values.", hidden: true },
    { name: "press", kind: "method", signature: "press(key, options?)", summary: "Press a key first; use options.target to target a locator.", hidden: true },
    { name: "goto", kind: "method", signature: "goto(url, options?)", summary: "Navigate and wait; returns { url, status }.", hidden: true },
    { name: "selectOption", kind: "method", signature: "selectOption(locator, values, options?)", summary: "Select by string value or an array of string values.", hidden: true },
    { name: "setChecked", kind: "method", signature: "setChecked(locator, checked, options?)", summary: "Set a checkbox or radio state; radio buttons cannot be unchecked.", hidden: true },
    { name: "textContent", kind: "method", signature: "textContent(locator, options?)", summary: "Read the first match's text content, or null.", hidden: true },
    { name: "inputValue", kind: "method", signature: "inputValue(locator, options?)", summary: "Read the first input value, or null.", hidden: true },
    { name: "waitForTimeout", kind: "method", signature: "waitForTimeout(ms)", summary: "Wait for milliseconds.", hidden: true },
    { name: "goBack", kind: "method", signature: "goBack(options?)", summary: "Navigate back and return { url, status }.", hidden: true },
    { name: "goForward", kind: "method", signature: "goForward(options?)", summary: "Navigate forward and return { url, status }.", hidden: true },
];

/** Each text completes the resolver's "Did you mean …?" line. */
const BROWSER_PLAYWRIGHT_SUGGESTIONS: Readonly<Record<string, string>> = {
    getByRole: 'a CSS or text= selector passed to the action, e.g. click(\'button[aria-label="Save"]\') or click("text=Save") (role locators are not available yet)',
    locator: 'passing the selector straight to the action, e.g. click(".popover button")',
    waitForLoadState: 'waitForNavigation({ waitUntil: "load" }) (it waits for the next navigation)',
    isVisible: 'exists(selector), or waitForSelector(selector, { state: "visible" }) (it waits and throws on timeout)',
    $: "exists(selector), getText(selector), getValue(selector) or evaluate(...)",
    $$: "evaluate(...) returning the values you need (element handles are not exposed)",
    content: 'getHtml(selector), or evaluate("document.documentElement.outerHTML") for the whole document',
};

export function suggestBrowserPlaywrightName(name: string): string | undefined {
    return BROWSER_PLAYWRIGHT_SUGGESTIONS[name];
}

export function provideBrowserPlaywrightAlias(host: BrowserPlaywrightAliasHost, name: string): { value: unknown } | undefined {
    const aliases: Record<string, (...args: unknown[]) => unknown> = {
        dblclick: (locator, options) => host.click(locator as IBrowserElementLocator, { ...(options as IBrowserClickOptions), clickCount: 2 }),
        fill: (locator, text, options) => host.type(locator as IBrowserElementLocator, text as string, options as IBrowserTypeOptions),
        press: (key, options) => host.pressKey(key as string, options as IBrowserKeyboardOptions),
        goto: (url, options) => host.navigateAndWait(url as string, options as { waitUntil?: "load" | "domcontentloaded" | "networkidle"; timeout?: number; tabId?: string }),
        selectOption: (locator, values, options) => host.select(locator as IBrowserElementLocator, values as string | string[], options as IBrowserSelectOptions),
        setChecked: (locator, checked, options) => {
            if (typeof checked !== "boolean") throw new Error("setChecked(locator, checked, options?) requires a boolean checked value.");
            return checked ? host.check(locator as IBrowserElementLocator, options as IBrowserActionOptions) : host.uncheck(locator as IBrowserElementLocator, options as IBrowserActionOptions);
        },
        textContent: (locator, options) => host.getText(locator as IBrowserElementLocator, options as { tabId?: string }),
        inputValue: (locator, options) => host.getValue(locator as IBrowserElementLocator, options as { tabId?: string }),
        waitForTimeout: ms => host.wait(ms as number),
        goBack: options => host.back(options as { waitUntil?: "load" | "domcontentloaded" | "networkidle"; timeout?: number; tabId?: string }),
        goForward: options => host.forward(options as { waitUntil?: "load" | "domcontentloaded" | "networkidle"; timeout?: number; tabId?: string }),
    };
    const implementation = aliases[name];
    return implementation ? { value: implementation } : undefined;
}
