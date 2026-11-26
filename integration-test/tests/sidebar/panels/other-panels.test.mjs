import { test } from "../../../lib/context.mjs";
import { clickSidebarRow, clickSidebarText, closePages, readSidebarRows } from "../../helpers/sidebar-helpers.mjs";
import { shellPagePath } from "../../helpers/shell-helpers.mjs";

export default [
    test("Open Tabs lists open pages and selecting an entry activates that page", async (ctx) => {
        const ownedIds = [];
        let menuWasOpen = false;
        try {
            const first = await ctx.app.pages.addEditorPage("monaco", "javascript", "us-2041-open-tabs-a.js", "first\n");
            ownedIds.push(first.id);
            const second = await ctx.app.pages.addEditorPage("monaco", "typescript", "us-2041-open-tabs-b.ts", "second\n");
            ownedIds.push(second.id);

            await ctx.app.window.menuBar.open("open-tabs");
            menuWasOpen = true;
            const rows = await ctx.waitFor(
                (activeContext) => readSidebarRows(activeContext, '[data-name="sidebar-open-tabs"] [role="option"]'),
                (currentRows) => currentRows.some((row) => row.includes("us-2041-open-tabs-a.js"))
                    && currentRows.some((row) => row.includes("us-2041-open-tabs-b.ts")),
            );
            ctx.expect(rows.some((row) => row.includes("us-2041-open-tabs-a.js"))).toBe(true);
            ctx.expect(rows.some((row) => row.includes("us-2041-open-tabs-b.ts"))).toBe(true);

            await clickSidebarRow(ctx, '[data-name="sidebar-open-tabs"] [role="option"]', "us-2041-open-tabs-b.ts");
            ctx.expect(await ctx.app.pages.activePage.id).toBe(second.id);
        } finally {
            if (menuWasOpen && await ctx.app.window.menuBar.isOpen) await ctx.app.window.menuBar.close();
            await closePages(ctx, ownedIds);
        }
    }),

    test("Linux keeps clipboard history unavailable for copied settings", async (ctx) => {
        const original = await ctx.app.settings.get("clipboard.enabled");
        const beforeIds = new Set((await ctx.app.pages.all).map((page) => page.id));
        const fixtureFolder = ctx.fixture("us-2229/clipboard-workspace");
        try {
            await ctx.app.settings.set("clipboard.enabled", true);
            ctx.expect(await ctx.app.settings.get("clipboard.enabled")).toBe(true);
            ctx.expect((await ctx.app.settings.sections).some((section) => section.id === "clipboard")).toBe(false);

            await ctx.app.window.openMenuBar();
            await ctx.app.window.screen.click('[data-name="menubar-settings"]');
            await ctx.waitFor(
                (activeContext) => activeContext.app.window.screen.evaluate('() => Boolean(document.querySelector(\'[data-name="settings-root"]\'))'),
                Boolean,
            );
            ctx.expect(await ctx.app.window.screen.evaluate('() => Boolean(document.querySelector(\'[data-name="settings-section-clipboard"]\'))')).toBe(false);

            await ctx.app.window.screen.click('[data-name="header-snip-button"]');
            ctx.expect(await ctx.app.window.screen.evaluate('() => Boolean(document.querySelector(\'[data-name="header-quick-settings-clipboard-enabled"]\'))')).toBe(false);
            await ctx.app.window.screen.pressKey("Escape");

            await ctx.app.fs.mkdir(fixtureFolder);
            const workspace = await ctx.app.pages.openFile(fixtureFolder);
            await ctx.waitFor((activeContext) => activeContext.app.pages[workspace.id].panels.explorer, Boolean);
            ctx.expect(await ctx.app.window.screen.evaluate('() => Boolean(document.querySelector(\'[data-name="explorer-clipboard"]\'))')).toBe(false);

            await ctx.app.window.menuBar.open("tools-editors");
            const creatableRows = await readSidebarRows(ctx, '[data-name="editors-tree"] [role="treeitem"]');
            ctx.expect(creatableRows.some((row) => row.includes("Clipboard"))).toBe(false);
            ctx.expect((await ctx.app.settings.sections).some((section) => section.id === "clipboard")).toBe(false);

            let directClipboardRejected = false;
            try {
                await ctx.app.clipboard.items;
            } catch {
                directClipboardRejected = true;
            }
            ctx.expect(directClipboardRejected).toBe(true);
        } finally {
            if (await ctx.app.window.menuBar.isOpen) await ctx.app.window.menuBar.close();
            await closePages(ctx, (await ctx.app.pages.all).filter((page) => !beforeIds.has(page.id)).map((page) => page.id));
            await ctx.app.settings.set("clipboard.enabled", original);
        }
    }, { requires: ["linux"] }),

    test("Recent Files lists a closed fixture file and opens it from the list", async (ctx) => {
        const filePath = ctx.fixture("us-2041-panels/recent/closed-note.txt");
        const ownedIds = [];
        try {
            await ctx.app.fs.write(filePath, "Recent file fixture content.\n");
            await ctx.app.pages.openFile(filePath);
            const opened = await ctx.waitFor((activeContext) => activeContext.app.pages.all, (pages) => pages.find((page) => page.filePath === filePath));
            const openedPage = opened.find((page) => page.filePath === filePath);
            ownedIds.push(openedPage.id);
            await ctx.app.pages.closePage(openedPage.id);
            await ctx.waitFor((activeContext) => activeContext.app.pages.all, (pages) => !pages.some((page) => page.id === openedPage.id));

            await ctx.waitFor(
                async (activeContext) => {
                    await activeContext.app.recent.load();
                    return activeContext.app.recent.files;
                },
                (files) => files.includes(filePath),
            );

            await ctx.app.window.menuBar.open("recent-files");
            await ctx.waitFor(
                (activeContext) => activeContext.app.window.screen.evaluate(`() => Array.from(document.querySelectorAll('[data-name="menubar-content"] [role="option"]')).some((row) => row.innerText.includes("closed-note.txt"))`),
                Boolean,
            );
            const rows = await readSidebarRows(ctx, '[data-name="menubar-content"] [role="option"]');
            ctx.expect(rows.some((row) => row.includes("closed-note.txt"))).toBe(true);

            await clickSidebarRow(ctx, '[data-name="menubar-content"] [role="option"]', "closed-note.txt");
            const reopenedPages = await ctx.waitFor((activeContext) => activeContext.app.pages.all, (pages) => pages.some((page) => page.filePath === filePath));
            const reopened = reopenedPages.find((page) => page.filePath === filePath);
            ownedIds.push(reopened.id);
            ctx.expect(await ctx.callText(shellPagePath(reopened.id, "content"))).toBe("Recent file fixture content.\n");
        } finally {
            if (await ctx.app.window.menuBar.isOpen) await ctx.app.window.menuBar.close();
            await closePages(ctx, ownedIds);
            await ctx.app.recent.remove(filePath);
        }
    }),

    test("Script Library lists and opens a script from its configured fixture folder", async (ctx) => {
        const folderPath = ctx.fixture("us-2041-panels/library");
        const scriptPath = ctx.fixture("us-2041-panels/library/fixture-library-script.js");
        const originalPath = await ctx.app.settings.get("script-library.path");
        const ownedIds = [];
        try {
            await ctx.app.fs.write(scriptPath, "page.content = 'opened from Script Library';\n");
            await ctx.app.settings.set("script-library.path", folderPath);
            await ctx.app.window.menuBar.open("script-library");
            await ctx.waitFor(
                (activeContext) => activeContext.app.window.screen.evaluate(`() => Array.from(document.querySelectorAll('[data-name="sidebar-script-library"] [role="treeitem"]')).some((row) => row.innerText.includes("fixture-library-script.js"))`),
                Boolean,
            );
            const rows = await readSidebarRows(ctx, '[data-name="sidebar-script-library"] [role="treeitem"]');
            ctx.expect(rows.some((row) => row.includes("fixture-library-script.js"))).toBe(true);

            await clickSidebarRow(ctx, '[data-name="sidebar-script-library"] [role="treeitem"]', "fixture-library-script.js");
            const currentPages = await ctx.waitFor((activeContext) => activeContext.app.pages.all, (pages) => pages.some((entry) => entry.filePath === scriptPath));
            const page = currentPages.find((entry) => entry.filePath === scriptPath);
            ownedIds.push(page.id);
            ctx.expect(await ctx.callText(shellPagePath(page.id, "content"))).toBe("page.content = 'opened from Script Library';\n");
            ctx.expect(await ctx.app.window.menuBar.isOpen).toBe(false);
        } finally {
            if (await ctx.app.window.menuBar.isOpen) await ctx.app.window.menuBar.close();
            await closePages(ctx, ownedIds);
            await ctx.app.settings.set("script-library.path", originalPath ?? "");
        }
    }),

    test("Tools & Editors lists editors and opens the selected editor", async (ctx) => {
        const ownedIds = [];
        try {
            await ctx.app.window.menuBar.open("tools-editors");
            await ctx.waitFor(
                (activeContext) => activeContext.app.window.screen.evaluate(`() => Array.from(document.querySelectorAll('[data-name="editors-tree"] [role="treeitem"]')).some((row) => row.innerText.includes("Script (TS)"))`),
                Boolean,
            );
            const rows = await readSidebarRows(ctx, '[data-name="editors-tree"] [role="treeitem"]');
            ctx.expect(rows.some((row) => row.includes("Script (TS)"))).toBe(true);

            await clickSidebarRow(ctx, '[data-name="editors-tree"] [role="treeitem"]', "Script (TS)");
            const currentPages = await ctx.waitFor((activeContext) => activeContext.app.pages.all, (pages) => pages.some((page) => page.title === "untitled.ts"));
            const scriptPage = currentPages.find((page) => page.title === "untitled.ts");
            ownedIds.push(scriptPage.id);
            ctx.expect(scriptPage.language).toBe("typescript");
            ctx.expect(await ctx.app.window.menuBar.isOpen).toBe(false);
        } finally {
            if (await ctx.app.window.menuBar.isOpen) await ctx.app.window.menuBar.close();
            await closePages(ctx, ownedIds);
        }
    }),

    test("Boards and Clipboard entries open their panels with list or empty state", async (ctx) => {
        const folderPath = ctx.fixture("us-2041-panels/boards-root");
        const ownedIds = [];
        try {
            await ctx.app.fs.write(ctx.fixture("us-2041-panels/boards-root/seed.txt"), "fixture root\n");
            const workspace = await ctx.app.pages.openFile(folderPath);
            ownedIds.push(workspace.id);
            await ctx.waitFor((activeContext) => activeContext.app.page.panels.explorer, (panel) => Boolean(panel));
            await ctx.app.window.screen.click('[data-name="explorer-boards"]');

            const boards = await ctx.waitFor((activeContext) => activeContext.app.pages[workspace.id].panels.boards, (panel) => Boolean(panel && panel.state?.boards !== undefined));
            ctx.expect(boards.state.boards).toEqual([]);
            ctx.expect((await ctx.app.pages[workspace.id].panels.items).some((panel) => panel.id === "boards")).toBe(true);
            ctx.expect(await ctx.app.window.screen.evaluate('() => Boolean(document.querySelector(\'[data-name="boards-empty"]\'))')).toBe(true);

            await ctx.app.pages[workspace.id].panels.expand("explorer");
            const switchedPanels = await ctx.app.pages[workspace.id].panels.items;
            ctx.expect(switchedPanels.some((panel) => panel.id === "explorer" && panel.expanded)).toBe(true);
            await ctx.app.pages[workspace.id].panels.toggleSidebar();
            ctx.expect(await ctx.waitFor((activeContext) => activeContext.app.pages[workspace.id].panels.isOpen, (isOpen) => isOpen === false)).toBe(false);
            await ctx.app.pages[workspace.id].panels.toggleSidebar();
            ctx.expect(await ctx.waitFor((activeContext) => activeContext.app.pages[workspace.id].panels.isOpen, (isOpen) => isOpen === true)).toBe(true);

            await ctx.app.window.menuBar.open("tools-editors");
            await ctx.waitFor(
                (activeContext) => activeContext.app.window.screen.evaluate(`() => Array.from(document.querySelectorAll('[data-name="editors-tree"] [role="treeitem"]')).some((row) => row.innerText.includes("Clipboard"))`),
                Boolean,
            );
            ctx.expect((await readSidebarRows(ctx, '[data-name="editors-tree"] [role="treeitem"]')).some((row) => row.includes("Clipboard"))).toBe(true);
            await clickSidebarRow(ctx, '[data-name="editors-tree"] [role="treeitem"]', "Clipboard");

            const clipboardPages = await ctx.waitFor((activeContext) => activeContext.app.pages.all, (pages) => pages.some((page) => page.id === "clipboard-page"));
            const clipboardPage = clipboardPages.find((page) => page.id === "clipboard-page");
            ownedIds.push(clipboardPage.id);
            const clipboardPanels = await ctx.waitFor((activeContext) => activeContext.app.pages[clipboardPage.id].panels.items, (items) => items.some((panel) => panel.id === "clipboard"));
            ctx.expect(clipboardPanels.some((panel) => panel.id === "clipboard")).toBe(true);
            const clipboardEnabled = await ctx.app.settings.get("clipboard.enabled");
            const clipboardState = await ctx.waitFor(
                (activeContext) => activeContext.app.window.screen.evaluate('() => { const panel = document.querySelector(\'[data-name="clipboard-secondary-view"]\'); const list = panel?.querySelector(\'[data-name="clipboard-history"]\'); const warning = panel?.querySelector(\'[data-name="clipboard-unavailable"]\'); return list ? { loading: list.hasAttribute("data-loading"), empty: list.hasAttribute("data-empty"), rows: list.querySelectorAll("[role=option]").length, warning: warning?.innerText.trim() ?? "", healthBadge: document.querySelector(\'[data-name="clipboard-health"]\')?.innerText.trim() ?? "", restart: Boolean(document.querySelector(\'[data-name="clipboard-restart"]\')), openSettings: Boolean(document.querySelector(\'[data-name="clipboard-open-settings"]\')) } : null; }'),
                (state) => state !== null && !state.loading && (clipboardEnabled === false
                    ? state.empty && state.warning && state.openSettings
                    : state.empty || state.rows > 0 || state.warning),
            );
            if (clipboardEnabled === false) {
                ctx.expect(clipboardState.empty).toBe(true);
                ctx.expect(clipboardState.warning.length > 0).toBe(true);
                ctx.expect(clipboardState.openSettings).toBe(true);
            } else {
                ctx.expect(clipboardState.empty || clipboardState.rows > 0 || clipboardState.warning.length > 0).toBe(true);
                if (!clipboardState.empty && clipboardState.rows === 0) {
                    ctx.expect(clipboardState.warning.length > 0).toBe(true);
                    ctx.expect(clipboardState.healthBadge.length > 0).toBe(true);
                    ctx.expect(clipboardState.restart).toBe(true);
                }
            }
        } finally {
            if (await ctx.app.window.menuBar.isOpen) await ctx.app.window.menuBar.close();
            await closePages(ctx, ownedIds);
        }
    }, { requires: ["windows"] }),

    test("Menu Bar switches folders and Escape closes the sidebar", async (ctx) => {
        try {
            await ctx.app.window.menuBar.open("open-tabs");
            ctx.expect(await ctx.app.window.menuBar.isOpen).toBe(true);
            ctx.expect(await ctx.app.window.menuBar.selected.id).toBe("open-tabs");

            await clickSidebarText(ctx, "Recent Files");
            ctx.expect(await ctx.app.window.menuBar.selected.id).toBe("recent-files");
            await ctx.app.window.screen.pressKey("Escape", { target: '[data-name="menu-bar-content"]' });
            ctx.expect(await ctx.waitFor((activeContext) => activeContext.app.window.menuBar.isOpen, (isOpen) => isOpen === false)).toBe(false);
        } finally {
            if (await ctx.app.window.menuBar.isOpen) await ctx.app.window.menuBar.close();
        }
    }),
];
