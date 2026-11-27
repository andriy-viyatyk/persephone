import { test } from "../../../lib/context.mjs";
import { answerInputDialog, chooseTreeMenuItem, openTreeContextMenu } from "../../helpers/sidebar-helpers.mjs";
import { closeBoardPage, fixtureBoard, openBoardPage, trustFixtureBoard, untrustBoard } from "../../helpers/boards.mjs";

const BOARD = "trees/tree-board";

async function treePageIds(ctx) {
    const result = [];
    for (const page of await ctx.app.pages.all) {
        try { if (await ctx.app.pages[page.id].panels.explorer.providerType === "test/tree") result.push(page.id); }
        catch { /* Not a tree page. */ }
    }
    return result;
}

async function openTreePage(ctx, board, conn = "a") {
    await board.editor.evaluate(`async () => await window.persephone.openTree({ type: "test/tree", config: { conn: ${JSON.stringify(conn)} }, rootPath: "/" })`);
    return await ctx.waitFor(async (active) => {
        const pages = await treePageIds(active);
        return pages.length ? pages.at(-1) : null;
    }, Boolean);
}

async function listedNames(ctx, pageId) {
    return (await ctx.app.pages[pageId].panels.explorer.listItems()).map((item) => item.title).sort();
}

export default [
    test("Explorer creates, renames, and deletes board tree folders", async (ctx) => {
        const root = fixtureBoard(ctx, BOARD);
        let board;
        try {
            await trustFixtureBoard(ctx, root);
            board = await openBoardPage(ctx, root);
            const id = await openTree(ctx, board);
            const explorer = ctx.app.pages[id].panels.explorer;
            const initial = await explorer.listItems();
            const readme = initial.find((item) => item.title === "Readme.md");
            await openTreeContextMenu(ctx, "Readme.md");
            await chooseTreeMenuItem(ctx, "new-folder");
            await answerInputDialog(ctx, "created-folder", "Create");
            await ctx.waitFor(async (active) => (await active.app.pages[id].panels.explorer.listItems()).some((item) => item.title === "created-folder"), Boolean);
            await openTreeContextMenu(ctx, "created-folder");
            await chooseTreeMenuItem(ctx, "rename");
            await answerInputDialog(ctx, "renamed-folder", "Rename");
            await ctx.waitFor(async (active) => {
                const names = await listedNames(active, id);
                return names.includes("renamed-folder") && !names.includes("created-folder");
            }, Boolean);
            await openTreeContextMenu(ctx, "renamed-folder");
            await chooseTreeMenuItem(ctx, "delete");
            await ctx.call("window.screen.click", ['text="Delete"'], { dialog: true });
            await ctx.waitFor(async (active) => !(await listedNames(active, id)).includes("renamed-folder"), Boolean);
            const after = await listedNames(ctx, id);
            ctx.expect(after).toContain("Readme.md");
            ctx.expect(after).not.toContain("renamed-folder");
            ctx.expect(readme.isDirectory).toBe(false);
        } finally {
            for (const id of await treePageIds(ctx)) await ctx.app.pages.closePage(id).catch(() => undefined);
            await closeBoardPage(ctx, board?.id);
            await untrustBoard(ctx, root);
        }
    }, { requires: ["launch"] }),

    test("read-only connection offers no mkdir, rename, or delete and keeps its tree", async (ctx) => {
        const root = fixtureBoard(ctx, BOARD);
        let board;
        try {
            await trustFixtureBoard(ctx, root);
            board = await openBoardPage(ctx, root);
            const id = await openTree(ctx, board, "ro");
            const initial = await listedNames(ctx, id);
            // The fixture marks every `ro` listing readOnly (US-2258), so no write action is offered.
            await openTreeContextMenu(ctx, "Readme.md");
            const menu = JSON.stringify(await ctx.call("menus[0].items", undefined, { dialog: true })).toLowerCase();
            await ctx.call("menus[0].close", [], { dialog: true }).catch(() => undefined);
            for (const menuId of ['"new-folder"', '"new-file"', '"rename"', '"delete"', '"cut"', '"paste"']) ctx.expect(menu).not.toContain(menuId);
            ctx.expect(await listedNames(ctx, id)).toEqual(initial);
            ctx.expect((await ctx.app.pages[id].panels.explorer.listItems()).find((item) => item.title === "Readme.md").href).toBe("testtree://ro/Readme.md");
        } finally {
            for (const id of await treePageIds(ctx)) await ctx.app.pages.closePage(id).catch(() => undefined);
            await closeBoardPage(ctx, board?.id);
            await untrustBoard(ctx, root);
        }
    }, { requires: ["launch"] }),

    test("tree item menus expose no local import, reveal, or terminal actions", async (ctx) => {
        const root = fixtureBoard(ctx, BOARD);
        let board;
        try {
            await trustFixtureBoard(ctx, root);
            board = await openBoardPage(ctx, root);
            const id = await openTree(ctx, board);
            await openTreeContextMenu(ctx, "Readme.md");
            const menu = await ctx.call("menus[0].items", undefined, { dialog: true });
            const labels = JSON.stringify(menu).toLowerCase();
            ctx.expect(labels).not.toContain("import");
            ctx.expect(labels).not.toContain("reveal");
            ctx.expect(labels).not.toContain("terminal");
            for (const id of ['"show-in-file-explorer"', '"open-in-new-window"', '"open-with:default-app"']) ctx.expect(labels).not.toContain(id);
            await ctx.call("menus[0].close", [], { dialog: true }).catch(() => undefined);
            ctx.expect(await ctx.app.pages[id].panels.explorer.providerType).toBe("test/tree");
        } finally {
            for (const id of await treePageIds(ctx)) await ctx.app.pages.closePage(id).catch(() => undefined);
            await closeBoardPage(ctx, board?.id);
            await untrustBoard(ctx, root);
        }
    }, { requires: ["launch"] }),

    test("truncated board tree listings show a warning and stay within the 5,000 item cap", async (ctx) => {
        const root = fixtureBoard(ctx, BOARD);
        let board;
        try {
            await trustFixtureBoard(ctx, root);
            board = await openBoardPage(ctx, root);
            const id = await openTree(ctx, board);
            await ctx.app.pages[id].panels.explorer.expand("/_test");
            await ctx.app.pages[id].panels.explorer.expand("/_test/truncated");
            const alerts = await ctx.app.ui.alerts.list();
            const warning = alerts.find((alert) => alert.type === "warning" && alert.message.includes("truncated"));
            ctx.expect(warning).toBeTruthy();
            ctx.expect(warning.message).toContain("5000");
            const visibleEntries = await ctx.app.window.screen.evaluate('() => Array.from(document.querySelectorAll(\'[data-type="tree-provider-view"] [role="treeitem"]\')).filter((row) => row.textContent.trim().startsWith("entry-")).length');
            ctx.expect(visibleEntries).toBeGreaterThan(0);
            ctx.expect(visibleEntries).toBeLessThanOrEqual(5000);
        } finally {
            for (const id of await treePageIds(ctx)) await ctx.app.pages.closePage(id).catch(() => undefined);
            await closeBoardPage(ctx, board?.id);
            await untrustBoard(ctx, root);
        }
    }, { requires: ["launch"] }),
];

// Board-tree paths resolve only after their parent is listed, so wait for the root listing.
async function openTree(ctx, ...args) {
    const id = await openTreePage(ctx, ...args);
    await ctx.waitFor(async (active) => (await active.app.pages[id].panels.explorer.listItems()).length, (count) => count > 0);
    return id;
}
