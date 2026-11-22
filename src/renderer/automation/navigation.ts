import { type NavigationWaitOptions, type NavigationWaitResult, type BrowserResponseResult, type BrowserResponseWaitOptions } from "../../ipc/browser-ipc";
import type { IAutomationTarget, INavigableTarget, ITabInfoTarget } from "./types";

/**
 * A URL pattern for `waitForURL` / `waitForResponse`: an exact string, a RegExp, or — for callers
 * that pass JSON (MCP `call`, test stand-ins), which cannot carry a RegExp — `{ regex, flags? }`.
 */
export type UrlPatternInput = string | RegExp | { regex: string; flags?: string };

export type WireUrlPattern = string | { source: string; flags: string };

function isRegexDescriptor(value: unknown): value is { regex: string; flags?: string } {
    return typeof value === "object" && value !== null && !(value instanceof RegExp)
        && typeof (value as { regex?: unknown }).regex === "string";
}

/** Normalize a pattern for the main-process waiter; a `{ regex }` descriptor is compiled once here
 *  so an invalid expression fails at the call instead of at the waiter. */
export function toWirePattern(value: UrlPatternInput, method: string): WireUrlPattern {
    if (typeof value === "string") return value;
    if (value instanceof RegExp) return { source: value.source, flags: value.flags };
    if (isRegexDescriptor(value)) {
        if (Object.keys(value).some((key) => key !== "regex" && key !== "flags")) {
            throw new Error(`${method}: regex patterns accept only regex and flags.`);
        }
        const flags = value.flags ?? "";
        if (typeof flags !== "string") throw new Error(`${method}: regex flags must be a string.`);
        const compiled = new RegExp(value.regex, flags);
        return { source: compiled.source, flags: compiled.flags };
    }
    throw new Error(`${method} requires a URL string, a RegExp, or { regex, flags? }.`);
}


/** Wait for navigation to start and then for the new document to finish loading. */
/** Arm the main-process CDP waiter before triggering a browser navigation. */
export async function waitForNavigationEvents(
    target: IAutomationTarget,
    trigger: () => void,
    options: NavigationWaitOptions & {
        tabId?: string; kind?: "navigation" | "url"; urlPattern?: UrlPatternInput;
        /** Count a load already in progress when armed (waitForNavigation only). */
        adoptInProgress?: boolean;
    } = {},
): Promise<NavigationWaitResult> {
    const pattern = options.urlPattern === undefined ? undefined : toWirePattern(options.urlPattern, "waitForURL");
    const cdp = target.cdp(options.tabId);
    const token = await cdp.armNavigationWait({
        waitUntil: options.waitUntil ?? "load",
        timeout: options.timeout ?? 10_000,
        kind: options.kind ?? "navigation",
        adoptInProgress: options.adoptInProgress === true,
        ...(pattern !== undefined ? { urlPattern: pattern } : {}),
    });
    let triggerError: unknown;
    try { trigger(); } catch (error: unknown) { triggerError = error; }
    const result = await cdp.awaitNavigationWait(token);
    if (triggerError !== undefined) throw triggerError;
    return result;
}

export async function waitForResponse(
    target: IAutomationTarget,
    urlOrRegex: UrlPatternInput,
    options: BrowserResponseWaitOptions & { tabId?: string } = {},
): Promise<BrowserResponseResult> {
    const pattern = toWirePattern(urlOrRegex, "waitForResponse");
    const cdp = target.cdp(options.tabId);
    const token = await cdp.armResponseWait(pattern, options);
    return cdp.awaitResponseWait(token);
}

/** Navigate and return the committed main-frame URL and HTTP status. */
export function navigateAndWait(
    target: IAutomationTarget & INavigableTarget & ITabInfoTarget,
    url: string,
    options: NavigationWaitOptions = {},
): Promise<NavigationWaitResult> {
    // Navigating to the URL the tab already shows is a no-op in the browser editor (it only loads
    // on a URL change), so the wait would time out. Reload instead, as Playwright's goto does.
    const current = target.activeTab?.url;
    const trigger = current !== undefined && current === url ? () => target.reload() : () => target.navigate(url);
    return waitForNavigationEvents(target, trigger, options);
}

/** Wait for the next or currently loading main-frame navigation. */
export function navigateBackAndWait(
    target: IAutomationTarget & Pick<INavigableTarget, "back">,
    action: () => void = () => target.back(),
    options: NavigationWaitOptions = {},
): Promise<NavigationWaitResult> {
    return waitForNavigationEvents(target, action, options);
}

/** Click an element using a selector or a host-local accessibility ref. */
