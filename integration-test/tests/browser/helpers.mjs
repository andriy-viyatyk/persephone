// Shared steps for the browser area (EPIC-189). Module-specific steps stay in their own test files.
import { closePage } from "../editors/helpers.mjs";

export { closePage };

/** URL of a static fixture page under `integration-test/fixtures/http/browser/<module>/`. */
export function fixturePage(ctx, module, file) {
    return ctx.httpUrl(`/browser/${module}/${file}`);
}

/**
 * Open a browser page with `ctx.openBrowser(url, options)` (waits for DOMContentLoaded) and return
 * `{ id, editor }`: the new page id and an awaitable stand-in for `pages[id].editor`.
 * Options: `{ profile?, incognito?, timeout? }`.
 */
export async function openBrowserPage(ctx, url, options = {}) {
    const before = new Set((await ctx.app.pages.all).map((page) => page.id));
    await ctx.openBrowser(url, options);
    const created = (await ctx.app.pages.all).find((page) => page.editor === "browser-view" && !before.has(page.id));
    if (!created) throw new Error(`openBrowserPage: no new browser page for ${url}`);
    return { id: created.id, editor: ctx.handle(ctx.app.pages[created.id].editor) };
}

/** Make the page active, so `window.screen` acts on its toolbar and bars. */
export async function activatePage(ctx, pageId) {
    await ctx.app.pages.showPage(pageId);
    await ctx.waitFor((activeContext) => activeContext.app.pages.activePage.id, (id) => id === pageId);
}

/** Close a browser page in `finally`; never throws. */
export async function closeBrowserPage(ctx, page) {
    if (!page?.id) return;
    try { await closePage(ctx, page.id); } catch { /* cleanup must not hide the test's own error */ }
}
