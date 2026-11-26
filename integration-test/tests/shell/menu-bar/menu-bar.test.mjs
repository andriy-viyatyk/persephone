import { test } from "../../../lib/context.mjs";

const userFolderLabel = "US-2035 work folder";
const userFolderContents = "menu-bar-bookmark.txt";

async function menuBarFolderRow(ctx, label) {
    return ctx.app.window.screen.evaluate(`() => {
            const list = document.querySelector('[data-name="menubar-folders"]');
            const rows = Array.from(list?.querySelectorAll('[data-type="list-item"]') ?? []);
            const row = rows
                .find((item) => item.textContent.trim().endsWith(${JSON.stringify(label)}));
            return row?.id ?? null;
        }`);
}

async function closeQuickSettings(ctx) {
    const isOpen = await ctx.app.window.screen.evaluate('() => Boolean(document.querySelector(\'[data-name="header-quick-settings"]\'))');
    if (!isOpen) return;
    await ctx.app.window.screen.pressKey("Escape");
    await ctx.waitFor(
        (activeContext) => activeContext.app.window.screen.evaluate('() => Boolean(document.querySelector(\'[data-name="header-quick-settings"]\'))'),
        (open) => open === false,
    );
}

export default [
    test("Menu Bar opens with each built-in section from the guide", async (ctx) => {
        try {
            await ctx.app.window.screen.click('[data-name="persephone-menu"]');
            ctx.expect(await ctx.waitFor((activeContext) => activeContext.app.window.menuBar.isOpen, (open) => open)).toBe(true);

            const menuVisible = await ctx.app.window.screen.evaluate('() => { const panel = document.querySelector(\'[data-name="menu-bar-content"]\'); return Boolean(panel && panel.getClientRects().length && panel.closest(\'[data-name="menu-bar"]\')?.classList.contains("open")); }');
            ctx.expect(menuVisible).toBe(true);

            const sections = (await ctx.app.window.menuBar.folders)
                .filter((folder) => folder.kind === "builtin")
                .map((folder) => folder.label);
            ctx.expect(sections).toEqual(["Open Tabs", "Recent Files", "Tools & Editors", "Script Library"]);

            const listing = await ctx.app.window.screen.snapshot({ root: '[data-name="menubar-folders"]' });
            for (const section of sections) ctx.expect(listing).toContain(section);
        } finally {
            await ctx.app.window.menuBar.close();
        }
    }),

    test("a work folder bookmark appears, opens its contents, and can be removed", async (ctx) => {
        const folderPath = ctx.fixture("us-2035/menu-bar/folder-bookmark");
        const filePath = `${folderPath}/` + userFolderContents;
        let folderId;
        try {
            await ctx.app.fs.removeDir(folderPath, true);
            for (const folder of await ctx.app.menuFolders.folders) {
                if (folder.name === userFolderLabel && folder.path === folderPath) {
                    await ctx.app.menuFolders.remove(folder.id);
                }
            }
            await ctx.app.fs.mkdir(folderPath);
            await ctx.app.fs.write(filePath, "The bookmarked work folder is readable.\n");
            folderId = await ctx.app.menuFolders.add({ name: userFolderLabel, path: folderPath });

            await ctx.app.window.menuBar.open();
            await ctx.waitFor(
                (activeContext) => activeContext.app.window.menuBar.folders,
                (folders) => folders.find((folder) => folder.id === folderId),
            );
            const folderRecord = (await ctx.app.window.menuBar.folders).find((folder) => folder.id === folderId);
            ctx.expect(folderRecord.label).toBe(userFolderLabel);
            ctx.expect(folderRecord.kind).toBe("user");

            const rowId = await ctx.waitFor(
                (activeContext) => menuBarFolderRow(activeContext, userFolderLabel),
                (value) => typeof value === "string" && value.length > 0,
            );
            const rowSelector = `[data-name="menubar-folders"] [id=${JSON.stringify(rowId)}]`;
            await ctx.app.window.screen.click(rowSelector);
            ctx.expect((await ctx.waitFor((activeContext) => activeContext.app.window.menuBar.selected.id, (selectedId) => selectedId === folderId))).toBe(folderId);

            const contentListing = await ctx.waitFor(
                (activeContext) => activeContext.app.window.screen.snapshot({ root: '[data-name="menubar-content"]' }),
                (snapshot) => snapshot.includes(userFolderContents),
            );
            ctx.expect(contentListing).toContain(userFolderContents);

            await /* ctx.call remains because the app stand-in cannot pass call options such as { dialog: true }. */ ctx.call("window.screen.click", [rowSelector, { button: "right" }], { dialog: true });
            const menuItems = await /* ctx.call remains because the app stand-in cannot pass call options such as { dialog: true }. */ ctx.call("menus[0].items", undefined, { dialog: true });
            ctx.expect(menuItems.some((item) => item.displayedLabel === "Remove Folder" && item.enabled)).toBe(true);
            await /* ctx.call remains because the app stand-in cannot pass call options such as { dialog: true }. */ ctx.call("menus[0].click", ["Remove Folder"], { dialog: true });
            const remainingFolders = await ctx.waitFor(
                (activeContext) => activeContext.app.window.menuBar.folders,
                (folders) => !folders.some((folder) => folder.id === folderId),
            );
            ctx.expect(remainingFolders.some((folder) => folder.id === folderId)).toBe(false);
            folderId = undefined;
        } finally {
            await /* ctx.call remains because the app stand-in cannot pass call options such as { dialog: true }. */ ctx.call("menus[0].close", [], { dialog: true }).catch(() => undefined);
            try {
                const configuredFolders = await ctx.app.menuFolders.folders;
                for (const folder of configuredFolders) {
                    if (folder.id === folderId || (folder.name === userFolderLabel && folder.path === folderPath)) {
                        await ctx.app.menuFolders.remove(folder.id);
                    }
                }
                await ctx.waitFor(
                    (activeContext) => activeContext.app.menuFolders.folders,
                    (folders) => !folders.some((folder) => folder.name === userFolderLabel && folder.path === folderPath),
                );
                await ctx.app.window.menuBar.open("open-tabs");
            } finally {
                await ctx.app.window.menuBar.close().catch(() => undefined);
                await ctx.app.fs.removeDir(folderPath, true);
            }
        }
    }),

    test("header quick settings change a service switch and persist it to settings", async (ctx) => {
        const key = "clipboard.enabled";
        const original = await ctx.app.settings.get(key);
        const starting = !original;
        const switchSelector = '[data-name="header-quick-settings"] [data-type="switch"][data-name="header-quick-settings-clipboard-enabled"]';
        try {
            await ctx.app.settings.set(key, starting);
            ctx.expect(await ctx.app.settings.get(key)).toBe(starting);

            await ctx.app.window.screen.click('[data-name="header-snip-button"]');
            await ctx.waitFor(
                (activeContext) => activeContext.app.window.screen.evaluate(`() => Boolean(document.querySelector(${JSON.stringify(switchSelector)}))`),
                Boolean,
            );
            const switchState = await ctx.app.window.screen.evaluate(`() => document.querySelector(${JSON.stringify(switchSelector)})?.getAttribute("aria-checked") === "true"`);
            ctx.expect(switchState).toBe(Boolean(starting));

            await ctx.app.window.screen.click(switchSelector);
            ctx.expect(await ctx.waitFor((activeContext) => activeContext.app.settings.get(key), (value) => value === original)).toBe(original);
            const updatedSwitchState = await ctx.app.window.screen.evaluate(`() => document.querySelector(${JSON.stringify(switchSelector)})?.getAttribute("aria-checked") === "true"`);
            ctx.expect(updatedSwitchState).toBe(Boolean(original));
        } finally {
            try {
                await closeQuickSettings(ctx);
            } finally {
                const current = await ctx.app.settings.get(key);
                if (current !== original) await ctx.app.settings.set(key, original);
            }
        }
    }, { requires: ["windows"] }),

    test("seeded header status indicators include quick settings and MCP", async (ctx) => {
        const elements = await ctx.app.ui.elements;
        const element = (name) => elements.find((entry) => entry.name === name);
        ctx.expect(element("status-indicators").visible).toBe(true);
        ctx.expect(element("header-snip-button").visible).toBe(true);
        ctx.expect(element("mcp-indicator").visible).toBe(true);
    }),
];
