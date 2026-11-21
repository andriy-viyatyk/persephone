import type { McpClient } from "./client.js";
import type { TestContext } from "./context.js";
import { errMessage } from "../shared/utils.js";

type LogHostEvent = (event: string, details: Record<string, unknown>) => void;
interface BrowserPage { id: string; editor: string; }
interface OwnershipSnapshot { pages: BrowserPage[]; popups: Map<string, Set<string>>; untrackablePopups: Set<string>; errors: string[]; }

export async function openBrowser(
    context: Pick<TestContext, "call" | "app" | "handle">,
    url: string,
    options: { profile?: string; incognito?: boolean; timeout?: number },
    waitTimeout: number,
    requestTimeout: number,
    onCreated: (pageId: string) => void,
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
    await context.call(`pages[${JSON.stringify(created.id)}].editor.navigateAndWait`, [url, { waitUntil: "domcontentloaded", timeout: navigationTimeout }], { timeout: Math.max(requestTimeout, navigationTimeout + 1000) });
    const app = context.app as Record<string, unknown>;
    const pages = app["pages"] as Record<string, unknown>;
    const page = pages[created.id] as Record<string, unknown>;
    return context.handle(page["editor"], { pageId: created.id });
}

export async function beginPageOwnership(client: McpClient, log: LogHostEvent): Promise<OwnershipSnapshot> {
    const snapshot = await readSnapshot(client, "baseline", log);
    return snapshot;
}

/**
 * Close what the test left behind. In an owned app every page or popup that appeared since the
 * baseline is the test's, and renderer dialogs/menus are swept. With `--attach` (`ownedPages` set) the
 * window is also the user's: a page that appeared there may be one the user just opened, and an open
 * dialog may be the user's own "Unsaved Changes" prompt. So only pages the test opened through
 * `ctx.openBrowser` (and new popups of those pages) are closed, other new pages are left open and
 * logged, and the dialog/menu sweep is skipped.
 */
export async function closePagesOpenedSince(client: McpClient, baseline: OwnershipSnapshot, log: LogHostEvent, cleanupTimeout: number, ownedPages?: ReadonlySet<string>): Promise<string[]> {
    const errors: string[] = [...baseline.errors];
    const attached = ownedPages !== undefined;
    const sweep = attached
        ? async (_phase: "before-snapshot" | "after-close") => ({ found: false, errors: [] as string[] })
        : (phase: "before-snapshot" | "after-close") => sweepRendererDialogs(client, log, cleanupTimeout, phase);
    const beforeSnapshot = await sweep("before-snapshot");
    if (beforeSnapshot.found) errors.push("The test left a renderer dialog open; cleanup dismissed it.");
    errors.push(...beforeSnapshot.errors);
    let current: OwnershipSnapshot;
    try { current = await readSnapshot(client, "cleanup", log); }
    catch (error) {
        errors.push(`Could not inspect browser pages for cleanup: ${errMessage(error)}`);
        const afterSnapshot = await sweep("after-close");
        if (afterSnapshot.found) errors.push("A renderer dialog remained during cleanup; cleanup dismissed it.");
        errors.push(...afterSnapshot.errors);
        return errors;
    }

    errors.push(...current.errors);
    const newPopups: Array<{ pageId: string; popupId: string }> = [];
    for (const [pageId, popupIds] of current.popups) {
        if (attached && !ownedPages.has(pageId)) continue;
        if (baseline.untrackablePopups.has(pageId) || current.untrackablePopups.has(pageId)) continue;
        const known = baseline.popups.get(pageId) ?? new Set<string>();
        for (const popupId of popupIds) if (!known.has(popupId)) newPopups.push({ pageId, popupId });
    }
    for (const { pageId, popupId } of newPopups) {
        log("cleanup", { action: "close-popup", pageId, popupId });
        try {
            await boundedCall(client, `pages[${JSON.stringify(pageId)}].editor.closePopup`, [popupId], cleanupTimeout);
            log("cleanup", { action: "popup-closed", pageId, popupId, ok: true });
        } catch (error) {
            const message = `Could not close popup ${popupId} on page ${pageId}: ${errMessage(error)}`;
            errors.push(message);
            log("cleanup", { action: "popup-closed", pageId, popupId, ok: false, error: message });
        }
    }

    const baselinePages = new Set(baseline.pages.map((page) => page.id));
    const appeared = current.pages.filter((page) => !baselinePages.has(page.id));
    const newPages = attached ? appeared.filter((page) => ownedPages.has(page.id)) : appeared;
    const leftOpen = attached ? appeared.filter((page) => !ownedPages.has(page.id)).map(({ id }) => id) : [];
    if (leftOpen.length) log("cleanup", { action: "leave-unowned-pages", pageIds: leftOpen, reason: "attach: not opened by ctx.openBrowser" });
    for (const page of newPages) {
        log("cleanup", { action: "close-page", pageId: page.id });
        try {
            let closed = await closeOwnedPage(client, page.id, log, cleanupTimeout);
            if (closed !== true && await boundedCall(client, `pages[${JSON.stringify(page.id)}].pinSide`, undefined, cleanupTimeout) === "right") {
                // A right-pinned page refuses to close until it is unpinned (canCloseNormal). The test
                // pinned it, so it is still the test's page to remove.
                log("cleanup", { action: "unpin-page", pageId: page.id });
                await boundedCall(client, "pages.unpinTab", [page.id], cleanupTimeout);
                closed = await closeOwnedPage(client, page.id, log, cleanupTimeout);
            }
            if (closed !== true) throw new Error("pages.closePage refused the close.");
            const remaining = pageList(await boundedCall(client, "pages.all", undefined, cleanupTimeout, true));
            if (remaining.some(({ id }) => id === page.id)) throw new Error("The page remained open after pages.closePage.");
            log("cleanup", { action: "page-closed", pageId: page.id, ok: true });
        } catch (error) {
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

export async function snapshotOwnedPages(client: McpClient, baseline: OwnershipSnapshot, log: LogHostEvent): Promise<BrowserPage[]> {
    const current = await readSnapshot(client, "failure-capture", log);
    const known = new Set(baseline.pages.map((page) => page.id));
    return current.pages.filter((page) => page.editor === "browser-view" && !known.has(page.id));
}

async function readSnapshot(client: McpClient, phase: string, log: LogHostEvent): Promise<OwnershipSnapshot> {
    log("cleanup", { action: "snapshot-start", phase });
    const pages = pageList(await client.call("pages.all"));
    const browserPages = pages.filter((page) => page.editor === "browser-view");
    const popups = new Map<string, Set<string>>();
    const untrackablePopups = new Set<string>();
    const errors: string[] = [];
    for (const page of browserPages) {
        try {
            const values = await client.call(`pages[${JSON.stringify(page.id)}].editor.popups`);
            popups.set(page.id, new Set(Array.isArray(values) ? values.flatMap((popup) =>
                popup && typeof popup === "object" && "id" in popup && typeof popup.id === "string" ? [popup.id] : []) : []));
        } catch (error) {
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
        ? [{ id: page.id, editor: typeof page.editor === "string" ? page.editor : "" }] : []);
}

async function closeOwnedPage(client: McpClient, pageId: string, log: LogHostEvent, timeout: number): Promise<unknown> {
    const closed = await boundedCall(client, "pages.closePage", [pageId], timeout, true);
    if (isPending(closed)) {
        const title = await boundedCall(client, "dialogs[0].title", undefined, timeout, true);
        if (title !== "Unsaved Changes") throw new Error(`Closing owned page ${pageId} opened an unexpected renderer dialog: ${String(title)}.`);
        await boundedCall(client, "dialogs[0].click", ["Don't Save"], timeout, true);
        log("cleanup", { action: "answer-owned-page-dialog", pageId, title, choice: "Don't Save", ok: true });
        const remaining = pageList(await boundedCall(client, "pages.all", undefined, timeout, true));
        return !remaining.some(({ id }) => id === pageId);
    }
    return closed;
}

async function sweepRendererDialogs(
    client: McpClient,
    log: LogHostEvent,
    timeout: number,
    phase: "before-snapshot" | "after-close",
): Promise<{ found: boolean; errors: string[] }> {
    const errors: string[] = [];
    let found = false;
    // A popup menu left open answers every later call with attention, like a dialog; close it first.
    try {
        const items = await boundedCall(client, "menus[0].items", undefined, timeout, true);
        found = true;
        await boundedCall(client, "menus[0].close", [], timeout, true);
        log("cleanup", { action: "close-popup-menu", phase, items: Array.isArray(items) ? items.length : undefined, ok: true });
    } catch (error) {
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
            title = await boundedCall(client, "dialogs[0].title", undefined, timeout, true);
        } catch (error) {
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
            if (choice === "Don't Save") await boundedCall(client, "dialogs[0].click", [choice], timeout, true);
            else await boundedCall(client, "dialogs[0].cancel", [], timeout, true);
            log("cleanup", { action: "dismiss-renderer-dialog", phase, title, choice, ok: true });
            if (index === 4) {
                log("cleanup", { action: "renderer-dialog-sweep-limit", phase, limit: 5 });
            }
        } catch (error) {
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

async function boundedCall(client: McpClient, apiPath: string, args: unknown[] | undefined, timeout: number, dialog = false): Promise<unknown> {
    return client.call(apiPath, args, timeout, undefined, dialog);
}
