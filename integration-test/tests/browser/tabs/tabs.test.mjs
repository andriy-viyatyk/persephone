// Uncovered: the page-zoom shortcuts (Ctrl+=, Ctrl+-, Ctrl+0). Automation key input reaches the page but not
// the browser guest's before-input-event handler that turns them into zoom, so they cannot be driven from a test.
import { test } from "../../../lib/context.mjs";
import { activatePage, closeBrowserPage, fixturePage, openBrowserPage } from "../helpers.mjs";

const tabsUrl = (ctx, file) => fixturePage(ctx, "tabs", file);

async function waitForFixtureText(ctx, page, text) {
    return ctx.waitFor(
        async (activeContext) => await activeContext.app.pages[page.id].editor.evaluate("document.body.textContent.trim()"),
        (value) => value.includes(text),
    );
}

async function readZoomPercent(ctx, page) {
    await activatePage(ctx, page.id);
    const value = await ctx.app.window.screen.evaluate(
        "() => document.querySelector('[data-name=\"toolbar-page-zoom\"]')?.textContent?.trim() ?? \"\"",
    );
    return value;
}

async function assertPageZoom(ctx, page, baseline, percentage) {
    const expectedFactor = percentage / 100;
    const ratio = await ctx.waitFor(
        async (activeContext) => await activeContext.app.pages[page.id].editor.evaluate("window.devicePixelRatio"),
        (value) => Math.abs(value / baseline - expectedFactor) < 0.02,
    );
    ctx.expect(Math.abs(ratio / baseline - expectedFactor) < 0.02).toBe(true);
}

async function chooseZoomPreset(ctx, page, percentage) {
    await activatePage(ctx, page.id);
    // ctx.call is needed here to pass dialog:true while interacting with the zoom popover.
    await ctx.call("window.screen.click", ['[data-name="toolbar-page-zoom"]'], { dialog: true });
    await activatePage(ctx, page.id);
    await ctx.call("window.screen.click", [`[data-name="zoom-preset-${percentage}"]`], { dialog: true });
    await activatePage(ctx, page.id);
    await ctx.app.window.screen.pressKey("Escape");
    await activatePage(ctx, page.id);
    await ctx.waitFor(
        async (activeContext) => await activeContext.app.window.screen.evaluate(
            "() => document.querySelector('[data-name=\"toolbar-page-zoom\"]')?.getAttribute('aria-expanded')",
        ),
        (value) => value === "false",
    );
}

export default [
    test("addTab, switchTab, and closeTab preserve each tab's URL, history, and title", async (ctx) => {
        let page;
        try {
            page = await openBrowserPage(ctx, tabsUrl(ctx, "tabs.html"));
            await waitForFixtureText(ctx, page, "US-2079 tabs fixture");
            const firstId = (await ctx.app.pages[page.id].editor.activeTab).id;
            const firstUrl = tabsUrl(ctx, "tabs.html");

            await ctx.app.pages[page.id].editor.click("#open-next");
            await ctx.waitFor(
                async (activeContext) => await activeContext.app.pages[page.id].editor.tabs,
                (items) => items.some((item) => item.id === firstId && item.url === tabsUrl(ctx, "next.html")),
            );
            await waitForFixtureText(ctx, page, "US-2079 next fixture");

            const secondId = await ctx.app.pages[page.id].editor.addTab(tabsUrl(ctx, "second.html"));
            await waitForFixtureText(ctx, page, "US-2079 second fixture");
            const secondTabs = await ctx.waitFor(
                async (activeContext) => await activeContext.app.pages[page.id].editor.tabs,
                (items) => items.some((item) => item.id === secondId && item.url === tabsUrl(ctx, "second.html") && item.title === "US-2079 Second"),
            );
            ctx.expect(secondTabs.length).toBe(2);
            ctx.expect((await ctx.app.pages[page.id].editor.activeTab).id).toBe(secondId);

            await ctx.app.pages[page.id].editor.switchTab(firstId);
            ctx.expect((await ctx.app.pages[page.id].editor.activeTab).id).toBe(firstId);
            await ctx.app.pages[page.id].editor.back();
            const returned = await ctx.waitFor(
                async (activeContext) => await activeContext.app.pages[page.id].editor.tabs,
                (items) => items.some((item) => item.id === firstId && item.url === firstUrl && item.title === "US-2079 Tabs"),
            );
            ctx.expect(returned.find((item) => item.id === firstId).url).toBe(firstUrl);
            ctx.expect(returned.find((item) => item.id === firstId).title).toBe("US-2079 Tabs");

            await ctx.app.pages[page.id].editor.switchTab(secondId);
            const secondActive = await ctx.app.pages[page.id].editor.activeTab;
            ctx.expect(secondActive.url).toBe(tabsUrl(ctx, "second.html"));
            ctx.expect(secondActive.title).toBe("US-2079 Second");

            await ctx.app.pages[page.id].editor.closeTab(secondId);
            const oneLeft = await ctx.waitFor(
                async (activeContext) => await activeContext.app.pages[page.id].editor.tabs,
                (items) => items.length === 1 && items[0].id === firstId,
            );
            ctx.expect(oneLeft.length).toBe(1);
            ctx.expect((await ctx.app.pages[page.id].editor.activeTab).id).toBe(firstId);

            await ctx.app.pages[page.id].editor.closeTab(firstId);
            const blankTabs = await ctx.waitFor(
                async (activeContext) => await activeContext.app.pages[page.id].editor.tabs,
                (items) => items.length === 1 && items[0].id !== firstId,
            );
            ctx.expect(blankTabs.length).toBe(1);
            ctx.expect(blankTabs[0].url).toBe("about:blank");
            ctx.expect((await ctx.app.pages[page.id].editor.activeTab).id).toBe(blankTabs[0].id);
        } finally {
            await closeBrowserPage(ctx, page);
        }
    }),

    test("target=_blank opens a second inner browser tab", async (ctx) => {
        let page;
        try {
            page = await openBrowserPage(ctx, tabsUrl(ctx, "tabs.html"));
            await waitForFixtureText(ctx, page, "US-2079 tabs fixture");
            const firstId = (await ctx.app.pages[page.id].editor.activeTab).id;
            await ctx.app.pages[page.id].editor.click("#open-new-tab");

            const tabs = await ctx.waitFor(
                async (activeContext) => await activeContext.app.pages[page.id].editor.tabs,
                (items) => items.length === 2 && items.some((item) => item.url === tabsUrl(ctx, "second.html") && item.title === "US-2079 Second"),
            );
            const secondTab = tabs.find((item) => item.url === tabsUrl(ctx, "second.html"));
            ctx.expect(tabs.length).toBe(2);
            ctx.expect(secondTab.title).toBe("US-2079 Second");
            ctx.expect((await ctx.app.pages[page.id].editor.activeTab).id).toBe(secondTab.id);
            ctx.expect(tabs.some((item) => item.id === firstId && item.url === tabsUrl(ctx, "tabs.html"))).toBe(true);
            await waitForFixtureText(ctx, page, "US-2079 second fixture");
        } finally {
            await closeBrowserPage(ctx, page);
        }
    }),

    test("the tab panel plus button opens a blank tab and focuses the URL field", async (ctx) => {
        let page;
        try {
            page = await openBrowserPage(ctx, tabsUrl(ctx, "tabs.html"));
            await waitForFixtureText(ctx, page, "US-2079 tabs fixture");
            const firstId = (await ctx.app.pages[page.id].editor.activeTab).id;
            await activatePage(ctx, page.id);
            await ctx.app.window.screen.click('[data-name="tabs-panel-host"] [data-add-tab]');

            const tabs = await ctx.waitFor(
                async (activeContext) => await activeContext.app.pages[page.id].editor.tabs,
                (items) => items.length === 2 && items.some((item) => item.id !== firstId && item.active),
            );
            const blankTab = tabs.find((item) => item.id !== firstId && item.active);
            ctx.expect(blankTab.url).toBe("about:blank");
            ctx.expect((await ctx.app.pages[page.id].editor.activeTab).id).toBe(blankTab.id);

            await activatePage(ctx, page.id);
            const urlFocused = await ctx.app.window.screen.evaluate(
                "() => document.activeElement?.matches('[data-name=\"url-input\"] input') === true",
            );
            ctx.expect(urlFocused).toBe(true);
        } finally {
            await closeBrowserPage(ctx, page);
        }
    }),

    test("page zoom presets affect the page and stay with the tab across navigation", async (ctx) => {
        let page;
        try {
            page = await openBrowserPage(ctx, tabsUrl(ctx, "tabs.html"));
            await waitForFixtureText(ctx, page, "US-2079 tabs fixture");
            const baseline = await page.editor.evaluate("window.devicePixelRatio");

            for (const percentage of [200, 150, 100, 75, 50]) {
                await chooseZoomPreset(ctx, page, percentage);
                ctx.expect(await readZoomPercent(ctx, page)).toBe(`${percentage}%`);
                await assertPageZoom(ctx, page, baseline, percentage);
            }

            await chooseZoomPreset(ctx, page, 150);
            ctx.expect(await readZoomPercent(ctx, page)).toBe("150%");
            await assertPageZoom(ctx, page, baseline, 150);
            await page.editor.navigateAndWait(tabsUrl(ctx, "next.html"));
            await waitForFixtureText(ctx, page, "US-2079 next fixture");
            ctx.expect(await readZoomPercent(ctx, page)).toBe("150%");
            await assertPageZoom(ctx, page, baseline, 150);

            const firstId = (await page.editor.activeTab).id;
            const secondId = await page.editor.addTab(tabsUrl(ctx, "second.html"));
            await waitForFixtureText(ctx, page, "US-2079 second fixture");
            const secondBaseline = await page.editor.evaluate("window.devicePixelRatio");
            ctx.expect(await readZoomPercent(ctx, page)).toBe("100%");
            await assertPageZoom(ctx, page, secondBaseline, 100);

            await page.editor.switchTab(firstId);
            ctx.expect(await readZoomPercent(ctx, page)).toBe("150%");
            await assertPageZoom(ctx, page, baseline, 150);
            ctx.expect((await page.editor.activeTab).id !== secondId).toBe(true);
        } finally {
            await closeBrowserPage(ctx, page);
        }
    }),

    test("page zoom is restored with a browser page after app restart", async (ctx) => {
        let page;
        try {
            page = await openBrowserPage(ctx, tabsUrl(ctx, "next.html"));
            await waitForFixtureText(ctx, page, "US-2079 next fixture");
            const baseline = await page.editor.evaluate("window.devicePixelRatio");
            await chooseZoomPreset(ctx, page, 150);
            await assertPageZoom(ctx, page, baseline, 150);

            const sessionPath = await ctx.app.fs.resolveDataPath("openFiles0.json");
            await ctx.waitFor(async (activeContext) => await activeContext.app.fs.exists(sessionPath), Boolean);
            const savedText = await ctx.waitFor(
                async (activeContext) => /* ctx.callText is required to pass maxLength for this session-file read. */ await activeContext.callText("fs.read", [sessionPath], { maxLength: 50000 }),
                (text) => {
                    try {
                        const state = JSON.parse(text);
                        // Session schema: pages[].editors[].state.tabs[] holds each inner tab's url and zoomPercent.
                        return state.pages.some((item) => (item.editors ?? []).some((editor) => editor.state?.tabs?.some((tab) => tab.url === tabsUrl(ctx, "next.html") && tab.zoomPercent === 150)));
                    } catch {
                        return false;
                    }
                },
            );
            ctx.expect(typeof savedText).toBe("string");

            await ctx.restartApp();
            const restoredPages = await ctx.waitFor(
                async (activeContext) => await activeContext.app.pages.all,
                (items) => items.some((item) => item.editor === "browser-view" && item.title === "US-2079 Next"),
            );
            const restoredRecord = restoredPages.find((item) => item.editor === "browser-view" && item.title === "US-2079 Next");
            page = { id: restoredRecord.id, editor: ctx.handle(ctx.app.pages[restoredRecord.id].editor) };
            await waitForFixtureText(ctx, page, "US-2079 next fixture");
            await activatePage(ctx, page.id);
            ctx.expect(await readZoomPercent(ctx, page)).toBe("150%");
            await assertPageZoom(ctx, page, baseline, 150);
        } finally {
            await closeBrowserPage(ctx, page);
        }
    }, { requires: ["launch"] }),
];
