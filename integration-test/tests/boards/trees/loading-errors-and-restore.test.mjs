import { test } from "../../../lib/context.mjs";
import { closeBoardPage, fixtureBoard, openBoardPage, trustFixtureBoard, untrustBoard } from "../../helpers/boards.mjs";

const BOARD = "trees/tree-board";

async function treePageIds(ctx) {
    const result = [];
    for (const page of await ctx.app.pages.all) {
        try { if (await ctx.app.pages[page.id].panels.explorer.providerType === "test/tree") result.push(page.id); }
        catch { /* Ignore pages without an Explorer. */ }
    }
    return result;
}

async function openTreePage(ctx, board, options = {}) {
    const descriptor = { type: "test/tree", config: { conn: "a" }, rootPath: "/", ...options };
    const previous = new Set(await treePageIds(ctx));
    await board.editor.evaluate(`async () => await window.persephone.openTree(${JSON.stringify(descriptor)})`);
    return await ctx.waitFor(async (active) => {
        const current = await treePageIds(active);
        const added = current.find((id) => !previous.has(id));
        if (added) return added;
        const activeId = await active.app.pages.activePage.id;
        return current.includes(activeId) ? activeId : null;
    }, Boolean);
}

async function listExplorer(ctx, id) {
    return ctx.app.pages[id].panels.explorer.listItems();
}

export default [
    test("a delayed board tree root displays loading before the listing resolves", async (ctx) => {
        const root = fixtureBoard(ctx, BOARD);
        let board;
        try {
            await trustFixtureBoard(ctx, root);
            board = await openBoardPage(ctx, root);
            const descriptor = { type: "test/tree", config: { conn: "a" }, rootPath: "/_test/slow" };
            await board.editor.evaluate(`() => { window.treeOpenPromise = window.persephone.openTree(${JSON.stringify(descriptor)}); return true; }`);
            const id = await ctx.waitFor(async (active) => {
                for (const pageId of await treePageIds(active)) {
                    if (await active.app.pages[pageId].panels.explorer.rootPath === descriptor.rootPath) return pageId;
                }
                return null;
            }, Boolean);
            const loading = await ctx.waitFor(
                (active) => active.app.window.screen.evaluate('() => document.querySelector(\'[data-name="tree-provider-empty"]\')?.textContent ?? ""'),
                (text) => /loading/i.test(text),
                { timeout: 1000 },
            );
            ctx.expect(loading).toMatch(/loading/i);
            await board.editor.evaluate("async () => await window.treeOpenPromise");
            await ctx.waitFor((active) => listExplorer(active, id), Array.isArray);
            ctx.expect(await ctx.app.pages[id].panels.explorer.rootPath).toBe("/_test/slow");
        } finally {
            for (const id of await treePageIds(ctx)) await ctx.app.pages.closePage(id).catch(() => undefined);
            await closeBoardPage(ctx, board?.id);
            await untrustBoard(ctx, root);
        }
    }, { requires: ["launch"] }),

    test("a nested list error is visible and expanding again retries successfully", async (ctx) => {
        const root = fixtureBoard(ctx, BOARD);
        let board;
        try {
            await trustFixtureBoard(ctx, root);
            board = await openBoardPage(ctx, root);
            const id = await openTree(ctx, board);
            const explorer = ctx.app.pages[id].panels.explorer;
            await explorer.expand("/_test");
            await explorer.expand("/_test/fail");
            await explorer.expand("/_test/fail/nested");
            // The error text lives in the Retry button's tooltip; the button itself marks the failed folder.
            await ctx.waitFor(
                (active) => active.app.window.screen.evaluate('() => Boolean(document.querySelector(\'[data-name="tree-provider-folder-retry"]\'))'),
                Boolean,
            );
            await ctx.app.window.screen.click('[data-name="tree-provider-folder-retry"]');
            const snapshot = await ctx.waitFor(
                (active) => active.callText("window.screen.snapshot", [{ interactive: true }]),
                (value) => value.includes("retry.txt"),
            );
            ctx.expect(snapshot).toContain("retry.txt");
        } finally {
            for (const id of await treePageIds(ctx)) await ctx.app.pages.closePage(id).catch(() => undefined);
            await closeBoardPage(ctx, board?.id);
            await untrustBoard(ctx, root);
        }
    }, { requires: ["launch"] }),

    test("both connection descriptors restore their tree, expansion, and selected item after restart", async (ctx) => {
        const root = fixtureBoard(ctx, BOARD);
        let board;
        try {
            await trustFixtureBoard(ctx, root);
            board = await openBoardPage(ctx, root);
            const a = await openTree(ctx, board, { config: { conn: "a" } });
            const b = await openTree(ctx, board, { config: { conn: "b" } });
            for (const [id, connection] of [[a, "a"], [b, "b"]]) {
                const explorer = ctx.app.pages[id].panels.explorer;
                await explorer.expand("/docs");
                await explorer.expand("/docs/nested");
                await explorer.openItem({ title: "guide.txt", href: `testtree://${connection}/docs/nested/guide.txt`, isDirectory: false, category: "/docs/nested", tags: [] });
            }
            const selectedBefore = [await ctx.app.pages[a].panels.explorer.selectedHref, await ctx.app.pages[b].panels.explorer.selectedHref];
            await ctx.restartApp();
            const restored = await ctx.waitFor(async (active) => {
                const ids = await treePageIds(active);
                return ids.length >= 2 ? ids : null;
            }, (ids) => Boolean(ids));
            ctx.expect(restored).toHaveLength(2);
            const restoredHrefs = [];
            for (const id of restored) {
                await ctx.app.pages.showPage(id);
                ctx.expect(await ctx.app.pages[id].panels.explorer.rootPath).toBe("/");
                ctx.expect(await ctx.app.pages[id].panels.explorer.providerType).toBe("test/tree");
                const selectedHref = await ctx.app.pages[id].panels.explorer.selectedHref;
                ctx.expect(selectedHref).toBeTruthy();
                restoredHrefs.push(selectedHref);
                const snapshot = await ctx.waitFor(
                    (active) => active.callText("window.screen.snapshot", [{ interactive: true }]),
                    (value) => value.includes("guide.txt"),
                );
                ctx.expect(snapshot).toContain("guide.txt");
            }
            ctx.expect(new Set(selectedBefore).size).toBe(2);
            ctx.expect(restoredHrefs.sort()).toEqual(selectedBefore.sort());
        } finally {
            for (const id of await treePageIds(ctx)) await ctx.app.pages.closePage(id).catch(() => undefined);
            await closeBoardPage(ctx, board?.id);
            await untrustBoard(ctx, root);
        }
    }, { requires: ["launch"] }),

    test("an open tree reports a missing provider and recovers after the board is trusted again", async (ctx) => {
        const root = fixtureBoard(ctx, BOARD);
        let board;
        try {
            await trustFixtureBoard(ctx, root);
            board = await openBoardPage(ctx, root);
            const id = await openTree(ctx, board);
            await untrustBoard(ctx, root);
            const failure = await ctx.waitFor(async (active) => {
                try { await active.app.pages[id].panels.explorer.listItems(); return null; }
                catch (error) { return { code: error.code, message: error.message }; }
            }, (value) => value?.code === "provider-missing");
            ctx.expect(failure.message).toContain("Provider \"test/tree\" is missing");
            await trustFixtureBoard(ctx, root);
            const items = await ctx.waitFor((active) => active.app.pages[id].panels.explorer.listItems(), (value) => value.some((item) => item.title === "docs"));
            ctx.expect(items.some((item) => item.title === "docs")).toBe(true);
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
