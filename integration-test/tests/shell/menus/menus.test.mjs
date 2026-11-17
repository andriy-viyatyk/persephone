import { test } from "../../../lib/context.mjs";
import {
    clickTabMenuItem,
    closeOwnedPages,
    closeTabMenu,
    openTabMenu,
    openTextPage,
    replacePageContent,
    shellPagePath,
} from "../../helpers/shell-helpers.mjs";

const menuFixtureRoot = "us-2037/menus";

export default [
    test("tab context menu lists its actions and Save writes the changed fixture", async (ctx) => {
        const folder = ctx.fixture(`${menuFixtureRoot}/tab-save`);
        const filePath = `${folder}\\menu-save.txt`;
        let pageId;
        try {
            await ctx.app.fs.removeDir(folder, true);
            await ctx.app.fs.mkdir(folder);
            const page = await openTextPage(ctx, `${menuFixtureRoot}/tab-save`, "menu-save.txt", "saved from the tab menu\n");
            pageId = page.id;
            await replacePageContent(ctx, page.id, "changed through the tab menu\n");
            ctx.expect(await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].modified, (modified) => modified)).toBe(true);

            await openTabMenu(ctx, page.id);
            const items = await ctx.waitFor(
                (activeContext) => /* ctx.call remains because the app stand-in cannot pass call options such as { dialog: true }. */ activeContext.call("menus[0].items", undefined, { dialog: true }),
                (current) => current.length > 0,
            );
            const labels = items.map((item) => item.label);
            for (const label of ["Close Tab", "Close Other Tabs", "Duplicate Tab", "Save", "Rename", "Copy File Path"]) {
                ctx.expect(labels).toContain(label);
            }

            await clickTabMenuItem(ctx, "save");
            ctx.expect(await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].modified, (modified) => modified === false)).toBe(false);
            ctx.expect(await ctx.callText("fs.read", [filePath])).toBe("changed through the tab menu\n");
        } finally {
            await closeTabMenu(ctx);
            await closeOwnedPages(ctx, [pageId]);
            await ctx.app.fs.removeDir(folder, true);
            await ctx.app.fs.removeDir(ctx.fixture(menuFixtureRoot), true);
        }
    }),

    test("Browser page menu opens and lists its page actions", async (ctx) => {
        const initialPageIds = new Set((await ctx.app.pages.all).map((page) => page.id));
        let pageId;
        try {
            await ctx.app.pages.showBrowserPage({ url: ctx.httpUrl("/sample.txt") });
            pageId = await ctx.waitFor((activeContext) => activeContext.app.pages.activePage.id, async (id) => {
                const page = await ctx.app.pages[id].editor.id;
                return !initialPageIds.has(id) && page === "browser-view";
            });
            const pageSlot = `[data-name="page-slot"][data-page-id=${JSON.stringify(pageId)}]`;
            const moreButton = `${pageSlot} [data-name="browser-toolbar-content"] [data-name="toolbar-more"]`;
            await ctx.waitFor(
                (activeContext) => activeContext.app.window.screen.evaluate(`() => document.querySelectorAll(${JSON.stringify(moreButton)}).length`),
                (count) => count === 1,
            );
            await ctx.app.window.screen.click(moreButton);

            const snapshot = await ctx.waitFor(
                (activeContext) => activeContext.callText("window.screen.snapshot", []),
                (text) => text.includes("View Source") && text.includes("View Actual DOM") && text.includes("Show Resources"),
            );
            for (const label of ["View Source", "View Actual DOM", "Show Resources"]) {
                ctx.expect(snapshot).toContain(label);
            }

            await /* ctx.call remains because the app stand-in cannot pass call options such as { dialog: true }. */ ctx.call("window.screen.pressKey", ["Escape"], { dialog: true });
            await ctx.waitFor(
                (activeContext) => activeContext.app.window.screen.evaluate('() => document.querySelectorAll(\'[data-type="menu"]\').length'),
                (count) => count === 0,
            );
        } finally {
            await /* ctx.call remains because the app stand-in cannot pass call options such as { dialog: true }. */ ctx.call("window.screen.pressKey", ["Escape"], { dialog: true }).catch(() => {});
            const createdPages = (await ctx.app.pages.all)
                .filter((page) => !initialPageIds.has(page.id))
                .map((page) => page.id);
            await closeOwnedPages(ctx, [...createdPages, pageId]);
        }
    }),

    test("Markdown link context menu offers link actions and Copy Link copies its href", async (ctx) => {
        const uniqueSuffix = Date.now();
        const markdownPageId = `us-2037-link-${uniqueSuffix}`;
        const href = `https://example.invalid/us-2037-link/${uniqueSuffix}`;
        const initialPageIds = new Set((await ctx.app.pages.all).map((page) => page.id));
        let pageId;
        try {
            const page = await ctx.app.pages.addEditorPage("md-view", "markdown", markdownPageId, `[menu link](${href})\n`);
            pageId = page.id;
            await ctx.app.pages.showPage(page.id);
            const pageSlot = `[data-name="page-slot"][data-page-id="${page.id}"]`;
            const linkSelector = `${pageSlot} [data-name="markdown-view-root"] [data-name="markdown-scroll"] a[href="${href}"]`;
            await ctx.waitFor(
                (activeContext) => activeContext.app.window.screen.evaluate(`() => document.querySelectorAll(${JSON.stringify(linkSelector)}).length`),
                (count) => count === 1,
            );
            await /* ctx.call remains because the app stand-in cannot pass call options such as { dialog: true }. */ ctx.call("window.screen.click", [linkSelector, { button: "right" }], { dialog: true });

            const items = await ctx.waitFor(
                (activeContext) => /* ctx.call remains because the app stand-in cannot pass call options such as { dialog: true }. */ activeContext.call("menus[0].items", undefined, { dialog: true }),
                (current) => current.some((item) => item.id === "copy-link"),
            );
            const itemIds = items.map((item) => item.id);
            ctx.expect(itemIds).toContain("open-in-default-browser");
            ctx.expect(itemIds).toContain("open-in-internal-browser");
            ctx.expect(itemIds).toContain("copy-link");
            await /* ctx.call remains because the app stand-in cannot pass call options such as { dialog: true }. */ ctx.call("menus[0].click", ["copy-link"], { dialog: true });

            const copiedText = await ctx.waitFor(
                (activeContext) => activeContext.app.window.screen.evaluate("() => navigator.clipboard.readText()"),
                (text) => text === href,
            );
            ctx.expect(copiedText).toBe(href);
        } finally {
            await closeTabMenu(ctx);
            const createdPages = (await ctx.app.pages.all)
                .filter((page) => !initialPageIds.has(page.id))
                .map((page) => page.id);
            await closeOwnedPages(ctx, [...createdPages, pageId]);
        }
    }),

    test("Escape and a click outside dismiss the tab context menu", async (ctx) => {
        const initialPageIds = new Set((await ctx.app.pages.all).map((page) => page.id));
        let pageId;
        try {
            const page = await ctx.app.pages.addEmptyPage();
            pageId = page.id;
            await ctx.app.pages.showPage(page.id);

            await openTabMenu(ctx, page.id);
            await /* ctx.call remains because the app stand-in cannot pass call options such as { dialog: true }. */ ctx.call("window.screen.pressKey", ["Escape"], { dialog: true });
            ctx.expect(await ctx.waitFor(
                (activeContext) => activeContext.app.window.screen.evaluate('() => document.querySelectorAll(\'[data-name="app-popup-menu"]\').length'),
                (count) => count === 0,
            )).toBe(0);

            await openTabMenu(ctx, page.id);
            await ctx.app.window.screen.click(`[data-name="page-tabs"] [data-page-id="${page.id}"]`);
            ctx.expect(await ctx.waitFor(
                (activeContext) => activeContext.app.window.screen.evaluate('() => document.querySelectorAll(\'[data-name="app-popup-menu"]\').length'),
                (count) => count === 0,
            )).toBe(0);
        } finally {
            await closeTabMenu(ctx);
            const createdPages = (await ctx.app.pages.all)
                .filter((page) => !initialPageIds.has(page.id))
                .map((page) => page.id);
            await closeOwnedPages(ctx, [...createdPages, pageId]);
        }
    }),
];
