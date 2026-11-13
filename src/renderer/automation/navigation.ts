import { type NavigationWaitOptions, type NavigationWaitResult, type BrowserResponseResult, type BrowserResponseWaitOptions } from "../../ipc/browser-ipc";
import type { IAutomationTarget, INavigableTarget, ITabInfoTarget } from "./types";


/** Wait for navigation to start and then for the new document to finish loading. */
/** Arm the main-process CDP waiter before triggering a browser navigation. */
export async function waitForNavigationEvents(
    target: IAutomationTarget,
    trigger: () => void,
    options: NavigationWaitOptions & {
        tabId?: string; kind?: "navigation" | "url"; urlPattern?: string | RegExp;
        /** Count a load already in progress when armed (waitForNavigation only). */
        adoptInProgress?: boolean;
    } = {},
): Promise<NavigationWaitResult> {
    const pattern = options.urlPattern instanceof RegExp
        ? { source: options.urlPattern.source, flags: options.urlPattern.flags }
        : options.urlPattern;
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
    urlOrRegex: string | RegExp,
    options: BrowserResponseWaitOptions & { tabId?: string } = {},
): Promise<BrowserResponseResult> {
    if (!(urlOrRegex instanceof RegExp) && typeof urlOrRegex !== "string") {
        throw new Error("waitForResponse requires a URL string or RegExp.");
    }
    const pattern = urlOrRegex instanceof RegExp
        ? { source: urlOrRegex.source, flags: urlOrRegex.flags }
        : urlOrRegex;
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
