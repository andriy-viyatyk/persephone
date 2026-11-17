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
    const navigationTimeout = options.timeout ?? waitTimeout;
    await context.call(`pages[${JSON.stringify(created.id)}].editor.navigateAndWait`, [url, { waitUntil: "domcontentloaded", timeout: navigationTimeout }], { timeout: Math.max(requestTimeout, navigationTimeout + 1000) });
    const app = context.app as Record<string, unknown>;
    const pages = app["pages"] as Record<string, unknown>;
    const page = pages[created.id] as Record<string, unknown>;
    return context.handle(page["editor"]);
}

export async function beginPageOwnership(client: McpClient, log: LogHostEvent): Promise<OwnershipSnapshot> {
    const snapshot = await readSnapshot(client, "baseline", log);
    return snapshot;
}

export async function closePagesOpenedSince(client: McpClient, baseline: OwnershipSnapshot, log: LogHostEvent, cleanupTimeout: number): Promise<string[]> {
    const errors: string[] = [...baseline.errors];
    let current: OwnershipSnapshot;
    try { current = await readSnapshot(client, "cleanup", log); }
    catch (error) { return [`Could not inspect browser pages for cleanup: ${errMessage(error)}`]; }

    errors.push(...current.errors);
    const newPopups: Array<{ pageId: string; popupId: string }> = [];
    for (const [pageId, popupIds] of current.popups) {
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
    const newPages = current.pages.filter((page) => !baselinePages.has(page.id));
    for (const page of newPages) {
        log("cleanup", { action: "close-page", pageId: page.id });
        try {
            let closed = await boundedCall(client, "pages.closePage", [page.id], cleanupTimeout);
            if (closed !== true && await boundedCall(client, `pages[${JSON.stringify(page.id)}].pinSide`, undefined, cleanupTimeout) === "right") {
                // A right-pinned page refuses to close until it is unpinned (canCloseNormal). The test
                // pinned it, so it is still the test's page to remove.
                log("cleanup", { action: "unpin-page", pageId: page.id });
                await boundedCall(client, "pages.unpinTab", [page.id], cleanupTimeout);
                closed = await boundedCall(client, "pages.closePage", [page.id], cleanupTimeout);
            }
            if (closed !== true) throw new Error("pages.closePage refused the close.");
            log("cleanup", { action: "page-closed", pageId: page.id, ok: true });
        } catch (error) {
            const message = `Could not close page ${page.id}: ${errMessage(error)}`;
            errors.push(message);
            log("cleanup", { action: "page-closed", pageId: page.id, ok: false, error: message });
        }
    }
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
        && "editor" in page && typeof page.editor === "string"
        ? [{ id: page.id, editor: page.editor }] : []);
}

async function boundedCall(client: McpClient, apiPath: string, args: unknown[] | undefined, timeout: number): Promise<unknown> {
    return client.call(apiPath, args, timeout);
}
