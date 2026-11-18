import { test } from "../../../lib/context.mjs";
import { activatePage, closeBrowserPage, fixturePage, openBrowserPage } from "../helpers.mjs";

// Uncovered: typing does not filter visited-page history; it switches to search-query history,
// and recording a search query requires submitting an internet search.

const START_URL = (ctx) => fixturePage(ctx, "navigation", "start.html");
const TARGET_URL = (ctx) => fixturePage(ctx, "navigation", "target.html");

async function waitForUrl(ctx, page, url) {
    return ctx.waitFor((activeContext) => activeContext.app.pages[page.id].editor.url, (value) => value === url);
}

export default [
    test("opens fixture pages and reads committed navigation metadata", async (ctx) => {
        let page;
        try {
            page = await openBrowserPage(ctx, START_URL(ctx));
            const firstTab = await page.editor.activeTab;
            const targetPageId = await ctx.app.pages.openUrlInBrowserTab(TARGET_URL(ctx));
            ctx.expect(targetPageId).toBe(page.id);
            await page.editor.waitFor({ text: "Target" });

            const activeTab = await page.editor.activeTab;
            const tabs = await page.editor.tabs;
            ctx.expect(await page.editor.id).toBe("browser-view");
            ctx.expect(await page.editor.url).toBe(TARGET_URL(ctx));
            ctx.expect(await page.editor.title).toBe("US-2078 Target");
            ctx.expect(activeTab.url).toBe(TARGET_URL(ctx));
            ctx.expect(activeTab.title).toBe("US-2078 Target");
            ctx.expect(activeTab.active).toBe(true);
            ctx.expect(tabs.some((tab) => tab.id === firstTab.id && tab.url === START_URL(ctx))).toBe(true);
            ctx.expect(tabs.some((tab) => tab.id === activeTab.id && tab.url === TARGET_URL(ctx))).toBe(true);

            await page.editor.switchTab(firstTab.id);
            await page.editor.click("#next");
            await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].editor.title, (title) => title === "US-2078 Target");
            await waitForUrl(ctx, page, TARGET_URL(ctx));
        } finally {
            await closeBrowserPage(ctx, page);
        }
    }),

    test("navigateAndWait reports redirects and HTTP error statuses", async (ctx) => {
        let page;
        try {
            page = await openBrowserPage(ctx, START_URL(ctx));
            await page.editor.navigate(TARGET_URL(ctx));
            await page.editor.waitFor({ text: "Target" });
            await waitForUrl(ctx, page, TARGET_URL(ctx));

            const redirected = await page.editor.navigateAndWait(ctx.httpUrl("/redirect?to=%2Fbrowser%2Fnavigation%2Ftarget.html"));
            ctx.expect(redirected.url).toBe(TARGET_URL(ctx));
            ctx.expect(redirected.status).toBe(200);

            const errorStatus = await page.editor.navigateAndWait(ctx.httpUrl("/status?code=503"));
            ctx.expect(errorStatus.status).toBe(503);
        } finally {
            await closeBrowserPage(ctx, page);
        }
    }),

    test("back, forward, home, and toolbar disabled state follow browser history", async (ctx) => {
        let page;
        try {
            page = await openBrowserPage(ctx, START_URL(ctx));
            const noHistoryTabId = await page.editor.addTab(START_URL(ctx));
            await page.editor.waitFor({ text: "Start" });
            await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].editor.activeTab.id, (id) => id === noHistoryTabId);
            await activatePage(ctx, page.id);
            const initialDisabled = await ctx.app.window.screen.evaluate(
                "() => ({ back: document.querySelector('button[data-name=\"toolbar-back\"]')?.disabled, forward: document.querySelector('button[data-name=\"toolbar-forward\"]')?.disabled })",
            );
            ctx.expect(initialDisabled).toEqual({ back: true, forward: true });

            let backError;
            try {
                await page.editor.back();
            } catch (error) {
                backError = error;
            }
            ctx.expect(backError?.message).toContain("No back history");

            await page.editor.click("#next");
            await page.editor.waitFor({ text: "Target" });
            await waitForUrl(ctx, page, TARGET_URL(ctx));
            const backResult = await page.editor.back();
            ctx.expect(backResult.url).toBe(START_URL(ctx));
            await waitForUrl(ctx, page, START_URL(ctx));
            const forwardResult = await page.editor.forward();
            ctx.expect(forwardResult.url).toBe(TARGET_URL(ctx));
            await waitForUrl(ctx, page, TARGET_URL(ctx));

            await activatePage(ctx, page.id);
            await ctx.app.window.screen.click('[data-name="toolbar-back"]');
            await waitForUrl(ctx, page, START_URL(ctx));
            await activatePage(ctx, page.id);
            await ctx.app.window.screen.click('[data-name="toolbar-forward"]');
            await waitForUrl(ctx, page, TARGET_URL(ctx));
            await activatePage(ctx, page.id);
            await ctx.app.window.screen.click('[data-name="toolbar-home"]');
            await waitForUrl(ctx, page, START_URL(ctx));
        } finally {
            await closeBrowserPage(ctx, page);
        }
    }),

    test("reload waits until the reloaded document is committed", async (ctx) => {
        let page;
        try {
            page = await openBrowserPage(ctx, fixturePage(ctx, "navigation", "reload-counter.html"));
            await page.editor.waitFor({ selector: "#load-count" });
            const initialCount = await page.editor.evaluate("() => document.querySelector('#load-count').textContent");
            ctx.expect(Number(initialCount)).toBe(1);
            const result = await page.editor.reload();
            ctx.expect(result.url).toBe(fixturePage(ctx, "navigation", "reload-counter.html"));
            ctx.expect(result.status).toBe(200);
            const reloadedCount = await page.editor.evaluate("() => document.querySelector('#load-count').textContent");
            ctx.expect(Number(reloadedCount)).toBe(2);
        } finally {
            await closeBrowserPage(ctx, page);
        }
    }),

    test("reload restarts a still-loading page instead of stopping it", async (ctx) => {
        let page;
        try {
            page = await openBrowserPage(ctx, START_URL(ctx));
            const slowUrl = fixturePage(ctx, "navigation", "slow-load.html");
            await page.editor.navigate(slowUrl);
            await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].editor.activeTab.loading, (loading) => loading === true);
            await page.editor.waitFor({ selector: "#load-count" });
            ctx.expect(Number(await page.editor.evaluate("() => document.querySelector('#load-count').textContent"))).toBe(1);
            ctx.expect(await page.editor.activeTab.loading).toBe(true);

            await activatePage(ctx, page.id);
            // The icon button has no title attribute or accessible name; its label is a hover tooltip.
            await ctx.app.window.screen.hover('[data-name="toolbar-reload"]');
            await ctx.app.window.screen.waitFor({ text: "Stop", timeout: 3000 });
            const result = await page.editor.reload();
            ctx.expect(result.url).toBe(slowUrl);
            ctx.expect(result.status).toBe(200);
            await page.editor.waitFor({ selector: "#load-count" });
            const loadCount = await page.editor.evaluate("() => document.querySelector('#load-count').textContent");
            ctx.expect(Number(loadCount)).toBe(2);
            ctx.expect(await page.editor.url).toBe(slowUrl);
            ctx.expect(await page.editor.activeTab.loading).toBe(false);
        } finally {
            await closeBrowserPage(ctx, page);
        }
    }),

    test("URL bar focuses, submits fixture URLs, and shows visited history", async (ctx) => {
        let page;
        try {
            page = await openBrowserPage(ctx, START_URL(ctx));
            await activatePage(ctx, page.id);
            await ctx.app.window.screen.pressKey("Control+l");
            const focused = await ctx.app.window.screen.evaluate(
                "() => document.activeElement === document.querySelector('[data-name=\"url-input\"] input')",
            );
            ctx.expect(focused).toBe(true);
            await ctx.app.window.screen.type('[data-name="url-input"] input', TARGET_URL(ctx));
            await ctx.app.window.screen.pressKey("Enter");
            await page.editor.waitFor({ text: "Target" });
            ctx.expect(await page.editor.url).toBe(TARGET_URL(ctx));

            await page.editor.navigateAndWait(START_URL(ctx));
            await activatePage(ctx, page.id);
            await ctx.app.window.screen.click('[data-name="url-input"] input');
            const suggestionRows = await ctx.waitFor(
                (activeContext) => activeContext.app.window.screen.evaluate(
                    "() => Array.from(document.querySelectorAll('[data-name=\"url-suggestions-list\"] [data-type=\"list-item\"]')).filter((row) => row.offsetParent !== null).map((row) => row.textContent.trim())",
                ),
                (rows) => rows.length >= 2,
            );
            ctx.expect(suggestionRows).toContain(START_URL(ctx));
            ctx.expect(suggestionRows).toContain(TARGET_URL(ctx));
            await ctx.app.window.screen.pressKey("Escape");
        } finally {
            if (page) {
                try {
                    await activatePage(ctx, page.id);
                    await ctx.app.window.screen.pressKey("Escape");
                } catch { /* Suggestions may already be closed. */ }
            }
            await closeBrowserPage(ctx, page);
        }
    }),

    test("search engine choice updates offline without submitting a search", async (ctx) => {
        let page;
        const previousEngine = await ctx.app.settings.get("browser-search-engine");
        try {
            page = await openBrowserPage(ctx, START_URL(ctx));
            await activatePage(ctx, page.id);
            await ctx.app.window.screen.click('[data-name="url-input"] input');
            await ctx.app.window.screen.clear('[data-name="url-input"] input');
            await ctx.app.window.screen.type('[data-name="url-input"] input', "offline fixture query");

            await ctx.app.window.screen.click('[data-search-engine-chip]');
            const menuSnapshot = await ctx.app.window.screen.snapshot({ root: '[data-name="search-engine-menu"]', interactive: true });
            const bingRow = menuSnapshot.match(/\bBing\b[^\n]*\[ref=(e\d+)\]/);
            ctx.expect(bingRow).toBeTruthy();
            await ctx.app.window.screen.click({ ref: bingRow[1] });

            const engine = await ctx.app.settings.get("browser-search-engine");
            ctx.expect(engine).toBe("bing");
            const chipLabel = await ctx.app.window.screen.evaluate(
                "() => document.querySelector('[data-search-engine-chip]')?.textContent?.trim()",
            );
            ctx.expect(chipLabel).toBe("Bing ▾");
            const query = await ctx.app.window.screen.evaluate(
                "() => document.querySelector('[data-name=\"url-input\"] input')?.value",
            );
            ctx.expect(query).toBe("offline fixture query");
            ctx.expect(await page.editor.url).toBe(START_URL(ctx));
            await ctx.app.window.screen.clear('[data-name="url-input"] input');
        } finally {
            if (page) {
                try {
                    await activatePage(ctx, page.id);
                    await ctx.app.window.screen.pressKey("Escape");
                    await ctx.app.window.screen.clear('[data-name="url-input"] input');
                } catch { /* Preserve the test result. */ }
            }
            try { await ctx.app.settings.set("browser-search-engine", previousEngine); } catch { /* Preserve the test result. */ }
            await closeBrowserPage(ctx, page);
        }
    }),
];
