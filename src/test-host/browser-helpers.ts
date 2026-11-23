import type { McpClient } from "./client.js";
import type { TestContext } from "./context.js";
import { errMessage } from "../shared/utils.js";
import type { TestWindowOwner } from "./test-window.js";
import { EnvironmentStopError } from "./attention-policy.js";
import fs from "node:fs/promises";
import path from "node:path";
import type { BrowserCookie } from "../ipc/browser-ipc.js";

type LogHostEvent = (event: string, details: Record<string, unknown>) => void;
export interface BrowserPage { id: string; editor: string; title?: string; url?: string; }
export interface UsePageOptions { url?: string | RegExp; title?: string | RegExp; }
export interface TestStorageState { cookies: BrowserCookie[]; origins: Array<{ origin: string; localStorage: Array<{ name: string; value: string }>; sessionStorage: Array<{ name: string; value: string }> }>; }
export type StorageStateInput = TestStorageState | string;
interface OwnershipSnapshot { pages: BrowserPage[]; popups: Map<string, Set<string>>; untrackablePopups: Set<string>; errors: string[]; }

export async function openBrowser(
    context: Pick<TestContext, "call" | "app" | "handle">,
    url: string,
    options: { profile?: string; incognito?: boolean; timeout?: number; storageState?: StorageStateInput },
    waitTimeout: number,
    requestTimeout: number,
    onCreated: (pageId: string) => void,
    testFile?: string,
    removeInitScript?: (pageId: string, id: string) => Promise<unknown>,
): Promise<object> {
    if (typeof url !== "string" || !url) throw new TypeError("ctx.openBrowser(url) requires a non-empty URL.");
    const profileNames = await context.call("settings.browserProfiles");
    const defaultProfile = await context.call("settings.defaultBrowserProfile");
    const profiles = Array.isArray(profileNames) ? profileNames.filter((name): name is string => typeof name === "string") : [];
    const profile = options.profile?.trim() ? options.profile : typeof defaultProfile === "string" ? defaultProfile : "";
    if (profile && !profiles.includes(profile)) {
        throw new Error(`Unknown browser profile ${JSON.stringify(profile)}. Valid browser profiles: ${profiles.length ? profiles.join(", ") : "(none)"}.`);
    }

    const before = await context.call("pages.all");
    const beforeIds = new Set(pageList(before).map((page) => page.id));
    await context.call("pages.showBrowserPage", [{ profileName: profile || undefined, incognito: options.incognito }]);
    const after = pageList(await context.call("pages.all"));
    const created = after.find((page) => page.editor === "browser-view" && !beforeIds.has(page.id));
    if (!created) throw new Error("browser page was not created; Persephone refused it, see the app notification");
    onCreated(created.id);
    const navigationTimeout = options.timeout ?? waitTimeout;
    let initScriptId: unknown;
    if (options.storageState !== undefined) {
        let state = options.storageState;
        if (typeof state === "string") {
            const statePath = path.isAbsolute(state) ? state : path.resolve(testFile ? path.dirname(testFile) : process.cwd(), state);
            try { state = JSON.parse(await fs.readFile(statePath, "utf8")); }
            catch { throw new Error("Could not read valid browser storage state JSON."); }
        }
        initScriptId = await context.call(`pages[${JSON.stringify(created.id)}].editor.applyStorageStateForTestRun`, [state]);
    }
    try {
        await context.call(`pages[${JSON.stringify(created.id)}].editor.navigateAndWait`, [url, { waitUntil: "domcontentloaded", timeout: navigationTimeout }], { timeout: Math.max(requestTimeout, navigationTimeout + 1000) });
    } finally {
        if (typeof initScriptId === "string") {
            try {
                if (removeInitScript) await removeInitScript(created.id, initScriptId);
                else await context.call(`pages[${JSON.stringify(created.id)}].editor.removeInitScript`, [initScriptId]);
            }
            catch { /* Best-effort removal; registration is also cleared when the owned page closes. */ }
        }
    }
    return editorHandle(context, created.id);
}

export async function usePage(
    context: Pick<TestContext, "app" | "handle">,
    options: UsePageOptions,
    testWindow: TestWindowOwner,
    getClient: () => McpClient,
    requestTimeout: number,
    sessionPages: Set<string>,
    assertActive: () => void = () => undefined,
): Promise<object> {
    assertActive();
    validateUsePageOptions(options);
    const pages = pageList(await testWindow.call(getClient(), "pages.all", undefined, requestTimeout));
    assertActive();
    const matches = pages.filter((page) => page.editor === "browser-view"
        && matchesCriterion(options.url, page.url, (url, criterion) => typeof criterion === "string"
            ? url.startsWith(criterion)
            : testRegularExpression(criterion, url))
        && matchesCriterion(options.title, page.title, (title, criterion) => typeof criterion === "string"
            ? title.includes(criterion)
            : testRegularExpression(criterion, title)));
    if (matches.length !== 1) throw new Error(`ctx.usePage matched ${matches.length} pages.`);
    const match = matches[0];
    assertActive();
    await testWindow.call(getClient(), `pages[${JSON.stringify(match.id)}].editor.adoptForTestRun`, [], requestTimeout);
    assertActive();
    sessionPages.add(match.id);
    return editorHandle(context, match.id);
}

export async function beginPageOwnership(client: McpClient, log: LogHostEvent, testWindow: TestWindowOwner): Promise<OwnershipSnapshot> {
    const snapshot = await readSnapshot(client, "baseline", log, testWindow);
    return snapshot;
}

/**
 * Close what the test left behind. In an owned app every page or popup that appeared since the
 * baseline is the test's, and renderer dialogs/menus are swept. With `--attach` (`ownedPages` set) the
 * window is also the user's: a page that appeared there may be one the user just opened, and an open
 * dialog may be the user's own "Unsaved Changes" prompt. So only pages the test opened through
 * `ctx.openBrowser` pages and their new popups are closed, other new pages are left open and logged,
 * and the dialog/menu sweep runs only inside the selected test window.
 */
export async function closePagesOpenedSince(client: McpClient, baseline: OwnershipSnapshot, log: LogHostEvent, cleanupTimeout: number, ownedPages: ReadonlySet<string> | undefined, sessionPages: ReadonlySet<string>, testWindow: TestWindowOwner): Promise<string[]> {
    const errors: string[] = [...baseline.errors];
    const selectedWindow = testWindow.mode === "attached-selected";
    const sweep = (phase: "before-snapshot" | "after-close") => sweepRendererDialogs(client, log, cleanupTimeout, phase, testWindow);
    for (const pageId of sessionPages) {
        log("cleanup", { action: "clear-clipboard", pageId });
        try {
            await boundedCall(client, `pages[${JSON.stringify(pageId)}].editor.clearClipboardForTestRun`, [], cleanupTimeout, testWindow);
            log("cleanup", { action: "clipboard-cleared", pageId, ok: true });
        } catch {
            errors.push(`Could not clear clipboard state on adopted page ${pageId}.`);
            log("cleanup", { action: "clipboard-cleared", pageId, ok: false });
        }
        log("cleanup", { action: "clear-request-routes", pageId });
        try {
            await boundedCall(client, `pages[${JSON.stringify(pageId)}].editor.unrouteAll`, [], cleanupTimeout, testWindow);
            log("cleanup", { action: "request-routes-cleared", pageId, ok: true });
        } catch (error) {
            const message = `Could not clear request routes on adopted page ${pageId}: ${errMessage(error)}`;
            errors.push(message);
            log("cleanup", { action: "request-routes-cleared", pageId, ok: false, error: message });
        }
        log("cleanup", { action: "uninstall-clock", pageId });
        try {
            await boundedCall(client, `pages[${JSON.stringify(pageId)}].editor.clock.uninstall`, [], cleanupTimeout, testWindow);
            log("cleanup", { action: "clock-uninstalled", pageId, ok: true });
        } catch (error) {
            const message = `Could not uninstall browser clock on adopted page ${pageId}: ${errMessage(error)}`;
            errors.push(message);
            log("cleanup", { action: "clock-uninstalled", pageId, ok: false, error: message });
        }
        log("cleanup", { action: "clear-init-scripts", pageId });
        try {
            const removed = await boundedCall(client, `pages[${JSON.stringify(pageId)}].editor.clearInitScripts`, undefined, cleanupTimeout, testWindow);
            log("cleanup", { action: "init-scripts-cleared", pageId, removed, ok: true });
        } catch (error) {
            const message = `Could not clear init scripts on adopted page ${pageId}: ${errMessage(error)}`;
            errors.push(message);
            log("cleanup", { action: "init-scripts-cleared", pageId, ok: false, error: message });
        }
        try {
            await boundedCall(client, `pages[${JSON.stringify(pageId)}].editor.releaseFromTestRun`, [], cleanupTimeout, testWindow);
            log("cleanup", { action: "test-power-released", pageId, ok: true });
        } catch (error) {
            const message = `Could not release test access on adopted page ${pageId}: ${errMessage(error)}`;
            errors.push(message);
            log("cleanup", { action: "test-power-released", pageId, ok: false, error: message });
        }
    }
    const beforeSnapshot = await sweep("before-snapshot");
    if (beforeSnapshot.found) errors.push("The test left a renderer dialog open; cleanup dismissed it.");
    errors.push(...beforeSnapshot.errors);
    let current: OwnershipSnapshot | undefined;
    // Two attempts: a menu or dialog the test's last action opened can appear between the sweep above
    // and this read (the read then answers with attention), and a busy app can time out one read.
    for (let attempt = 1; !current; attempt++) {
        try { current = await readSnapshot(client, "cleanup", log, testWindow); }
        catch (error) {
            if (error instanceof EnvironmentStopError) throw error;
            const afterSnapshot = await sweep("after-close");
            if (afterSnapshot.found) errors.push("The test left a renderer dialog or popup menu open; cleanup dismissed it.");
            errors.push(...afterSnapshot.errors);
            if (attempt >= 2) {
                errors.push(`Could not inspect browser pages for cleanup: ${errMessage(error)}`);
                return errors;
            }
            log("cleanup", { action: "snapshot-retry", error: errMessage(error) });
        }
    }

    errors.push(...current.errors);
    const newPopups: Array<{ pageId: string; popupId: string }> = [];
    for (const [pageId, popupIds] of current.popups) {
        if (selectedWindow && !ownedPages?.has(pageId) && !sessionPages.has(pageId)) continue;
        if (baseline.untrackablePopups.has(pageId) || current.untrackablePopups.has(pageId)) continue;
        const known = baseline.popups.get(pageId) ?? new Set<string>();
        for (const popupId of popupIds) if (!known.has(popupId)) newPopups.push({ pageId, popupId });
    }
    for (const { pageId, popupId } of newPopups) {
        log("cleanup", { action: "close-popup", pageId, popupId });
        try {
            await boundedCall(client, `pages[${JSON.stringify(pageId)}].editor.closePopup`, [popupId], cleanupTimeout, testWindow);
            log("cleanup", { action: "popup-closed", pageId, popupId, ok: true });
        } catch (error) {
            if (error instanceof EnvironmentStopError) throw error;
            const message = `Could not close popup ${popupId} on page ${pageId}: ${errMessage(error)}`;
            errors.push(message);
            log("cleanup", { action: "popup-closed", pageId, popupId, ok: false, error: message });
        }
    }

    const baselinePages = new Set(baseline.pages.map((page) => page.id));
    const appeared = current.pages.filter((page) => !baselinePages.has(page.id));
    const newPages = appeared.filter((page) => !sessionPages.has(page.id)
        && (!selectedWindow || ownedPages?.has(page.id)));
    const leftOpen = selectedWindow ? appeared.filter((page) => !ownedPages?.has(page.id) && !sessionPages.has(page.id)).map(({ id }) => id) : [];
    if (leftOpen.length) log("cleanup", { action: "leave-unowned-pages", pageIds: leftOpen, reason: "attach: not opened by ctx.openBrowser" });
    for (const page of newPages) {
        log("cleanup", { action: "close-page", pageId: page.id });
        try {
            let closed = await closeOwnedPage(client, page.id, log, cleanupTimeout, testWindow);
            if (closed !== true && await boundedCall(client, `pages[${JSON.stringify(page.id)}].pinSide`, undefined, cleanupTimeout, testWindow) === "right") {
                // A right-pinned page refuses to close until it is unpinned (canCloseNormal). The test
                // pinned it, so it is still the test's page to remove.
                log("cleanup", { action: "unpin-page", pageId: page.id });
                await boundedCall(client, "pages.unpinTab", [page.id], cleanupTimeout, testWindow);
                closed = await closeOwnedPage(client, page.id, log, cleanupTimeout, testWindow);
            }
            if (closed !== true) throw new Error("pages.closePage refused the close.");
            const remaining = pageList(await readWithAttentionRetry(client, "pages.all", undefined, cleanupTimeout, testWindow));
            if (remaining.some(({ id }) => id === page.id)) throw new Error("The page remained open after pages.closePage.");
            log("cleanup", { action: "page-closed", pageId: page.id, ok: true });
        } catch (error) {
            if (error instanceof EnvironmentStopError) throw error;
            const message = `Could not close page ${page.id}: ${errMessage(error)}`;
            errors.push(message);
            log("cleanup", { action: "page-closed", pageId: page.id, ok: false, error: message });
        }
    }
    const afterClose = await sweep("after-close");
    if (afterClose.found) errors.push("A renderer dialog remained after owned-page cleanup; cleanup dismissed it.");
    errors.push(...afterClose.errors);
    return errors;
}

export async function snapshotOwnedPages(client: McpClient, baseline: OwnershipSnapshot, _log: LogHostEvent, testWindow: TestWindowOwner): Promise<BrowserPage[]> {
    const current = pageList(await readWithAttentionRetry(client, "pages.all", undefined, client.timeouts.cleanup ?? 3000, testWindow));
    const known = new Set(baseline.pages.map((page) => page.id));
    return current.filter((page) => page.editor === "browser-view" && !known.has(page.id));
}

export async function listBrowserPages(client: McpClient, testWindow: TestWindowOwner): Promise<BrowserPage[]> {
    return pageList(await readWithAttentionRetry(client, "pages.all", undefined, client.timeouts.cleanup ?? 3000, testWindow))
        .filter((page) => page.editor === "browser-view");
}

async function readSnapshot(client: McpClient, phase: string, log: LogHostEvent, testWindow: TestWindowOwner): Promise<OwnershipSnapshot> {
    log("cleanup", { action: "snapshot-start", phase });
    const pages = pageList(await readWithAttentionRetry(client, "pages.all", undefined, client.timeouts.cleanup ?? 3000, testWindow));
    const browserPages = pages.filter((page) => page.editor === "browser-view");
    const popups = new Map<string, Set<string>>();
    const untrackablePopups = new Set<string>();
    const errors: string[] = [];
    for (const page of browserPages) {
        try {
            const values = await readWithAttentionRetry(client, `pages[${JSON.stringify(page.id)}].editor.popups`, undefined, client.timeouts.cleanup ?? 3000, testWindow);
            popups.set(page.id, new Set(Array.isArray(values) ? values.flatMap((popup) =>
                popup && typeof popup === "object" && "id" in popup && typeof popup.id === "string" ? [popup.id] : []) : []));
        } catch (error) {
            if (error instanceof EnvironmentStopError) throw error;
            const message = errMessage(error);
            if (message.includes("Agent access is disabled for privacy protection")) {
                popups.set(page.id, new Set());
                untrackablePopups.add(page.id);
                log("cleanup", { action: "popup-snapshot", phase, pageId: page.id, ok: true, inaccessible: true });
            } else {
                log("cleanup", { action: "popup-snapshot", phase, pageId: page.id, ok: false, error: message });
                popups.set(page.id, new Set());
                untrackablePopups.add(page.id);
                errors.push(`Could not inspect popups on page ${page.id}: ${message}`);
            }
        }
    }
    log("cleanup", { action: "snapshot-complete", phase, pageIds: browserPages.map(({ id }) => id) });
    return { pages, popups, untrackablePopups, errors };
}

function pageList(value: unknown): BrowserPage[] {
    if (!Array.isArray(value)) throw new Error("pages.all did not return a page list.");
    return value.flatMap((page) => page && typeof page === "object"
        && "id" in page && typeof page.id === "string"
        // A workspace page (Explorer rooted at a folder) has editor null; it is still a page the test may own.
        && "editor" in page && (typeof page.editor === "string" || page.editor === null)
        ? [{
            id: page.id,
            editor: typeof page.editor === "string" ? page.editor : "",
            ...(typeof page.title === "string" ? { title: page.title } : {}),
            ...(typeof page.url === "string" ? { url: page.url } : {}),
        }] : []);
}

function editorHandle(context: Pick<TestContext, "app" | "handle">, pageId: string): object {
    const app = context.app as Record<string, unknown>;
    const pages = app["pages"] as Record<string, unknown>;
    const page = pages[pageId] as Record<string, unknown>;
    return context.handle(page["editor"], { pageId });
}

function validateUsePageOptions(options: UsePageOptions): void {
    if (!options || typeof options !== "object" || Array.isArray(options)) throw new TypeError("ctx.usePage(options) requires a URL prefix or title substring.");
    const hasUrl = options.url !== undefined;
    const hasTitle = options.title !== undefined;
    if ((!hasUrl && !hasTitle)
        || (hasUrl && !isValidCriterion(options.url))
        || (hasTitle && !isValidCriterion(options.title))) {
        throw new TypeError("ctx.usePage(options) requires a URL prefix or title substring.");
    }
}

function isValidCriterion(value: unknown): value is string | RegExp {
    return (typeof value === "string" && value.length > 0) || value instanceof RegExp;
}

function matchesCriterion(criterion: string | RegExp | undefined, value: string | undefined, matches: (value: string, criterion: string | RegExp) => boolean): boolean {
    return criterion === undefined || (value !== undefined && matches(value, criterion));
}

function testRegularExpression(expression: RegExp, value: string): boolean {
    const lastIndex = expression.lastIndex;
    try {
        expression.lastIndex = 0;
        return expression.test(value);
    } finally {
        expression.lastIndex = lastIndex;
    }
}

async function closeOwnedPage(client: McpClient, pageId: string, log: LogHostEvent, timeout: number, testWindow: TestWindowOwner): Promise<unknown> {
    const closed = await boundedCall(client, "pages.closePage", [pageId], timeout, testWindow, true);
    if (isPending(closed)) {
        const title = await boundedCall(client, "dialogs[0].title", undefined, timeout, testWindow, true);
        if (title !== "Unsaved Changes") throw new Error(`Closing owned page ${pageId} opened an unexpected renderer dialog: ${String(title)}.`);
        await boundedCall(client, "dialogs[0].click", ["Don't Save"], timeout, testWindow, true);
        log("cleanup", { action: "answer-owned-page-dialog", pageId, title, choice: "Don't Save", ok: true });
        const remaining = pageList(await readWithAttentionRetry(client, "pages.all", undefined, timeout, testWindow));
        return !remaining.some(({ id }) => id === pageId);
    }
    return closed;
}

async function sweepRendererDialogs(
    client: McpClient,
    log: LogHostEvent,
    timeout: number,
    phase: "before-snapshot" | "after-close",
    testWindow: TestWindowOwner,
): Promise<{ found: boolean; errors: string[] }> {
    const errors: string[] = [];
    let found = false;
    // A popup menu left open answers every later call with attention, like a dialog; close it first.
    try {
        const items = await boundedCall(client, "menus[0].items", undefined, timeout, testWindow, true);
        found = true;
        await boundedCall(client, "menus[0].close", [], timeout, testWindow, true);
        log("cleanup", { action: "close-popup-menu", phase, items: Array.isArray(items) ? items.length : undefined, ok: true });
    } catch (error) {
        if (error instanceof EnvironmentStopError) throw error;
        const message = errMessage(error);
        if (!message.includes('No item 0 in "menus"')) {
            const failure = `Could not close a popup menu during ${phase}: ${message}`;
            errors.push(failure);
            log("cleanup", { action: "close-popup-menu", phase, ok: false, error: failure });
        }
    }
    for (let index = 0; index < 5; index++) {
        let title: unknown;
        try {
            title = await boundedCall(client, "dialogs[0].title", undefined, timeout, testWindow, true);
        } catch (error) {
            if (error instanceof EnvironmentStopError) throw error;
            const message = errMessage(error);
            // An empty dialog list reports `No item 0 in "dialogs"` (older builds: a read of undefined).
            if (message.includes('No item 0 in "dialogs"') || message.includes("Cannot read properties of undefined (reading 'title')")) break;
            const failure = `Could not inspect renderer dialogs during ${phase}: ${message}`;
            errors.push(failure);
            log("cleanup", { action: "renderer-dialog-inspection", phase, ok: false, error: failure });
            break;
        }
        found = true;
        const choice = title === "Unsaved Changes" ? "Don't Save" : "cancel";
        try {
            if (choice === "Don't Save") await boundedCall(client, "dialogs[0].click", [choice], timeout, testWindow, true);
            else await boundedCall(client, "dialogs[0].cancel", [], timeout, testWindow, true);
            log("cleanup", { action: "dismiss-renderer-dialog", phase, title, choice, ok: true });
            if (index === 4) {
                log("cleanup", { action: "renderer-dialog-sweep-limit", phase, limit: 5 });
            }
        } catch (error) {
            if (error instanceof EnvironmentStopError) throw error;
            const failure = `Could not dismiss renderer dialog ${String(title)}: ${errMessage(error)}`;
            errors.push(failure);
            log("cleanup", { action: "dismiss-renderer-dialog", phase, title, choice, ok: false, error: failure });
            break;
        }
    }
    return { found, errors };
}

function isPending(value: unknown): value is { pending: true } {
    return value !== null && typeof value === "object" && "pending" in value && value.pending === true;
}

async function boundedCall(client: McpClient, apiPath: string, args: unknown[] | undefined, timeout: number, testWindow: TestWindowOwner, dialog = false): Promise<unknown> {
    return testWindow.call(client, apiPath, args, timeout, undefined, dialog);
}

async function readWithAttentionRetry(client: McpClient, apiPath: string, args: unknown[] | undefined, timeout: number, testWindow: TestWindowOwner): Promise<unknown> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
        try { return await boundedCall(client, apiPath, args, timeout, testWindow); }
        catch (error) {
            lastError = error;
            const message = errMessage(error);
            if (!message.includes("attention") && !(error instanceof EnvironmentStopError)) throw error;
            if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, client.timeouts.poll));
        }
    }
    if (lastError instanceof EnvironmentStopError) throw lastError;
    if (errMessage(lastError).includes("in the test window")) throw lastError;
    throw new EnvironmentStopError("A dialog or popup menu requires attention in another window.");
}
