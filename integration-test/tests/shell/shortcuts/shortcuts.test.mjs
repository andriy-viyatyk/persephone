import { test } from "../../../lib/context.mjs";
import { addFileBackedPage, closeOwnedPages, closePagesCreatedSince, focusNeutralWindow, pagePath, pressNativeShortcut, pressWindowShortcut, replacePageContent, waitForPageEditorFocus } from "../../helpers/shell-helpers.mjs";

const folder = "us-2038-shortcuts";

export default [
    test("Ctrl+N creates a page and Ctrl+W closes that page", async (ctx) => {
        const before = await ctx.app.pages.all;
        const beforeIds = new Set(before.map((page) => page.id));
        const originalActiveId = before.find((page) => page.active)?.id;
        let createdId;
        try {
            await pressWindowShortcut(ctx, "Ctrl+N");
            const created = await ctx.waitFor(
                (activeContext) => activeContext.app.pages.all,
                (pages) => pages.find((page) => !beforeIds.has(page.id)),
            );
            const newPage = created.find((page) => !beforeIds.has(page.id));
            createdId = newPage.id;
            ctx.expect(newPage.active).toBe(true);
            ctx.expect(newPage.editor).toBe("monaco");

            await pressWindowShortcut(ctx, "Ctrl+W");
            const afterClose = await ctx.waitFor(
                (activeContext) => activeContext.app.pages.all,
                (pages) => !pages.some((page) => page.id === createdId),
            );
            ctx.expect(afterClose.length).toBe(before.length);
            ctx.expect(afterClose.every((page) => beforeIds.has(page.id))).toBe(true);
        } finally {
            await closeOwnedPages(ctx, [createdId]);
            await closePagesCreatedSince(ctx, beforeIds);
            if (originalActiveId) await ctx.app.pages.showPage(originalActiveId).catch(() => {});
        }
    }),

    test("Ctrl+Tab moves to the next page", async (ctx) => {
        const initialIds = new Set((await ctx.app.pages.all).map((page) => page.id));
        const owned = new Set();
        try {
            const first = await addFileBackedPage(ctx, `${folder}/tab-next`, "first.txt", "first tab\n");
            owned.add(first.id);
            const second = await addFileBackedPage(ctx, `${folder}/tab-next`, "second.txt", "second tab\n");
            owned.add(second.id);
            await focusNeutralWindow(ctx);
            await ctx.app.pages.showPage(first.id);
            await waitForPageEditorFocus(ctx, first.id);
            ctx.expect(await ctx.app.pages.activePage.id).toBe(first.id);

            const ordered = await ctx.app.pages.all;
            const firstIndex = ordered.findIndex((page) => page.id === first.id);
            const expectedNext = ordered[(firstIndex + 1) % ordered.length];
            ctx.expect(firstIndex >= 0).toBe(true);
            ctx.expect(expectedNext.id).toBe(second.id);

            await pressWindowShortcut(ctx, "Ctrl+Tab");
            ctx.expect(await ctx.waitFor((activeContext) => activeContext.app.pages.activePage.id, (id) => id === expectedNext.id)).toBe(expectedNext.id);
        } finally {
            await closeOwnedPages(ctx, owned);
            await closePagesCreatedSince(ctx, initialIds);
            await ctx.app.fs.removeDir(ctx.fixture(folder), true).catch(() => {});
        }
    }),

    test("Ctrl+Shift+Tab moves to the previous page", async (ctx) => {
        const initialIds = new Set((await ctx.app.pages.all).map((page) => page.id));
        const owned = new Set();
        try {
            const first = await addFileBackedPage(ctx, `${folder}/tab-previous`, "first.txt", "first tab\n");
            owned.add(first.id);
            const second = await addFileBackedPage(ctx, `${folder}/tab-previous`, "second.txt", "second tab\n");
            owned.add(second.id);
            await focusNeutralWindow(ctx);
            await ctx.app.pages.showPage(first.id);
            await waitForPageEditorFocus(ctx, first.id);
            await focusNeutralWindow(ctx);
            await ctx.app.pages.showPage(second.id);
            await waitForPageEditorFocus(ctx, second.id);

            const ordered = await ctx.app.pages.all;
            const secondIndex = ordered.findIndex((page) => page.id === second.id);
            const expectedPrevious = ordered[(secondIndex - 1 + ordered.length) % ordered.length];
            ctx.expect(secondIndex >= 0).toBe(true);
            ctx.expect(expectedPrevious.id).toBe(first.id);

            await pressWindowShortcut(ctx, "Ctrl+Shift+Tab");
            ctx.expect(await ctx.waitFor((activeContext) => activeContext.app.pages.activePage.id, (id) => id === expectedPrevious.id)).toBe(expectedPrevious.id);
        } finally {
            await closeOwnedPages(ctx, owned);
            await closePagesCreatedSince(ctx, initialIds);
            await ctx.app.fs.removeDir(ctx.fixture(folder), true).catch(() => {});
        }
    }),

    test("Ctrl+S saves the active text page to its file", async (ctx) => {
        const initialIds = new Set((await ctx.app.pages.all).map((entry) => entry.id));
        let page;
        try {
            page = await addFileBackedPage(ctx, `${folder}/save`, "saved-by-shortcut.txt", "before shortcut\n");
            await replacePageContent(ctx, page.id, "saved by Ctrl+S\n");
            ctx.expect(await ctx.app.pages[page.id].modified).toBe(true);

            await ctx.app.window.screen.pressKey("Ctrl+S");
            ctx.expect(await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].modified, (modified) => modified === false)).toBe(false);
            ctx.expect(await ctx.callText("fs.read", [page.filePath])).toBe("saved by Ctrl+S\n");
        } finally {
            await closeOwnedPages(ctx, [page?.id]);
            await closePagesCreatedSince(ctx, initialIds);
            await ctx.app.fs.removeDir(ctx.fixture(folder), true).catch(() => {});
        }
    }),

    test("Ctrl+plus zooms the window in", async (ctx) => {
        const originalZoom = await ctx.app.window.zoomLevel;
        try {
            await ctx.app.window.resetZoom();
            ctx.expect(await ctx.waitFor((activeContext) => activeContext.app.window.zoomLevel, (level) => level === 0)).toBe(0);

            await pressNativeShortcut(ctx, "=", ["control"]);
            const zoomedIn = await ctx.waitFor((activeContext) => activeContext.app.window.zoomLevel, (level) => level > 0);
            ctx.expect(zoomedIn > 0).toBe(true);
        } finally {
            await ctx.app.window.resetZoom();
            if (originalZoom !== 0) await ctx.app.window.zoom(originalZoom);
            await ctx.waitFor((activeContext) => activeContext.app.window.zoomLevel, (level) => level === originalZoom);
        }
    }),

    test("Ctrl+- zooms the window out", async (ctx) => {
        const originalZoom = await ctx.app.window.zoomLevel;
        try {
            await ctx.app.window.resetZoom();
            await ctx.app.window.zoom(0.5);
            ctx.expect(await ctx.waitFor((activeContext) => activeContext.app.window.zoomLevel, (level) => level === 0.5)).toBe(0.5);

            await pressNativeShortcut(ctx, "-", ["control"]);
            const zoomedOut = await ctx.waitFor((activeContext) => activeContext.app.window.zoomLevel, (level) => level < 0.5);
            ctx.expect(zoomedOut < 0.5).toBe(true);
        } finally {
            await ctx.app.window.resetZoom();
            if (originalZoom !== 0) await ctx.app.window.zoom(originalZoom);
            await ctx.waitFor((activeContext) => activeContext.app.window.zoomLevel, (level) => level === originalZoom);
        }
    }),

    test("Ctrl+0 resets the window zoom", async (ctx) => {
        const originalZoom = await ctx.app.window.zoomLevel;
        try {
            await ctx.app.window.resetZoom();
            await ctx.app.window.zoom(1);
            ctx.expect(await ctx.waitFor((activeContext) => activeContext.app.window.zoomLevel, (level) => level === 1)).toBe(1);

            await pressNativeShortcut(ctx, "0", ["control"]);
            ctx.expect(await ctx.waitFor((activeContext) => activeContext.app.window.zoomLevel, (level) => level === 0)).toBe(0);
        } finally {
            await ctx.app.window.resetZoom();
            if (originalZoom !== 0) await ctx.app.window.zoom(originalZoom);
            await ctx.waitFor((activeContext) => activeContext.app.window.zoomLevel, (level) => level === originalZoom);
        }
    }),

    test("theme shortcuts select the next theme and return to the original theme", async (ctx) => {
        const originalTheme = await ctx.app.themes.current;
        try {
            await pressWindowShortcut(ctx, "Ctrl+Alt+]");
            const nextTheme = await ctx.waitFor((activeContext) => activeContext.app.themes.current.id, (id) => id !== originalTheme.id);
            ctx.expect(nextTheme !== originalTheme.id).toBe(true);

            await pressWindowShortcut(ctx, "Ctrl+Alt+[");
            ctx.expect(await ctx.waitFor((activeContext) => activeContext.app.themes.current.id, (id) => id === originalTheme.id)).toBe(originalTheme.id);
        } finally {
            const currentTheme = await ctx.app.themes.current.id;
            if (currentTheme !== originalTheme.id) await ctx.app.themes.apply(originalTheme.id);
            await ctx.waitFor((activeContext) => activeContext.app.themes.current.id, (id) => id === originalTheme.id);
        }
    }),

    test("F1 opens the active text editor guide", async (ctx) => {
        const initialIds = new Set((await ctx.app.pages.all).map((entry) => entry.id));
        try {
            await pressWindowShortcut(ctx, "F1");
            const about = await ctx.waitFor((activeContext) => activeContext.app.pages.all, (pages) => pages.find((page) => page.id === "about-page"));
            ctx.expect(about.find((page) => page.id === "about-page").editor).toBe("about-view");
            const contents = await ctx.waitFor(
                (activeContext) => activeContext.app.window.screen.snapshot({ root: '[data-name="about-guide-browser"]' }),
                (snapshot) => snapshot.includes('heading "Text Editor"'),
            );
            ctx.expect(contents).toContain('heading "Text Editor"');
            ctx.expect(contents).toContain("Monaco-powered default");
        } finally {
            await closeOwnedPages(ctx, ["about-page"]);
            await closePagesCreatedSince(ctx, initialIds);
        }
    }),

    test("F5 runs the active JavaScript page", async (ctx) => {
        const initialIds = new Set((await ctx.app.pages.all).map((entry) => entry.id));
        let pageId;
        try {
            const page = await ctx.app.pages.addEditorPage("monaco", "javascript", "us-2038-f5.js", 'page.data.shortcutF5 = "ran";\n');
            pageId = page.id;
            ctx.expect(await ctx.app.pages[pageId].data.shortcutF5).toBe(null);
            await ctx.app.pages.showPage(pageId);

            await ctx.app.window.screen.click(`[data-name="page-slot"][data-page-id=${JSON.stringify(pageId)}] [data-name="page-editor"]`);
            await ctx.app.window.screen.pressKey("F5");
            ctx.expect(await ctx.waitFor((activeContext) => activeContext.app.pages[pageId].data.shortcutF5, (value) => value === "ran")).toBe("ran");
        } finally {
            await closeOwnedPages(ctx, [pageId]);
            await closePagesCreatedSince(ctx, initialIds);
        }
    }),

    test("Alt+Left and Alt+Right navigate the active page history", async (ctx) => {
        const initialIds = new Set((await ctx.app.pages.all).map((entry) => entry.id));
        const owned = new Set();
        try {
            const first = await addFileBackedPage(ctx, `${folder}/history`, "first.txt", "first history entry\n");
            owned.add(first.id);
            const secondPath = ctx.fixture(`${folder}/history/second.txt`);
            await ctx.app.fs.write(secondPath, "second history entry\n");

            await ctx.app.pages.navigatePageTo(first.id, secondPath);
            ctx.expect(await ctx.waitFor((activeContext) => activeContext.app.pages[first.id].filePath, (filePath) => filePath === secondPath)).toBe(secondPath);
            ctx.expect(await ctx.app.pages[first.id].history.canGoBack).toBe(true);

            await pressWindowShortcut(ctx, "Alt+ArrowLeft");
            ctx.expect(await ctx.waitFor((activeContext) => activeContext.app.pages[first.id].filePath, (filePath) => filePath === first.filePath)).toBe(first.filePath);
            ctx.expect(await ctx.app.pages[first.id].history.canGoForward).toBe(true);

            await pressWindowShortcut(ctx, "Alt+ArrowRight");
            ctx.expect(await ctx.waitFor((activeContext) => activeContext.app.pages[first.id].filePath, (filePath) => filePath === secondPath)).toBe(secondPath);
        } finally {
            await closeOwnedPages(ctx, owned);
            await closePagesCreatedSince(ctx, initialIds);
            await ctx.app.fs.removeDir(ctx.fixture(folder), true).catch(() => {});
        }
    }),
];
