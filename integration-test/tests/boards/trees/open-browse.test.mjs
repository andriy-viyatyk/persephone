import { test } from "../../../lib/context.mjs";
import { closeBoardPage, fixtureBoard, openBoardPage, trustFixtureBoard, untrustBoard } from "../../helpers/boards.mjs";

const BOARD = "trees/tree-board";

async function pageIdsForProvider(ctx, type = "test/tree") {
    const pages = await ctx.app.pages.all;
    const ids = [];
    for (const page of pages) {
        try {
            if (await ctx.app.pages[page.id].panels.explorer.providerType === type) ids.push(page.id);
        } catch { /* A page without a mounted Explorer is not a tree page. */ }
    }
    return ids;
}

async function openTreePage(ctx, boardPage, options = {}) {
    const descriptor = { type: "test/tree", config: { conn: "a" }, rootPath: "/", ...options };
    const existing = new Set(await pageIdsForProvider(ctx));
    await boardPage.editor.evaluate(`async () => await window.persephone.openTree(${JSON.stringify(descriptor)})`);
    return await ctx.waitFor(async (active) => {
        const ids = await pageIdsForProvider(active);
        const added = ids.find((id) => !existing.has(id));
        if (added) return added;
        const activeId = await active.app.pages.activePage.id;
        if (ids.includes(activeId)) return activeId;
        return null;
    }, (id) => Boolean(id));
}

async function openFileFromBoard(boardPage, href) {
    return boardPage.editor.evaluate(`async () => await window.persephone.openRawLink(${JSON.stringify(href)})`);
}

export default [
    test("the Open tree button opens the fixture tree page", async (ctx) => {
        const root = fixtureBoard(ctx, BOARD);
        let board;
        try {
            await trustFixtureBoard(ctx, root);
            board = await openBoardPage(ctx, root);
            await board.editor.click("#open-tree");
            const id = await ctx.waitFor(async (active) => {
                for (const candidate of await pageIdsForProvider(active)) {
                    if (await active.app.pages[candidate].panels.explorer.rootPath === "/") return candidate;
                }
                return null;
            }, (value) => Boolean(value));
            ctx.expect(await ctx.app.pages[id].panels.explorer.providerType).toBe("test/tree");
            ctx.expect((await ctx.app.pages[id].panels.explorer.listItems()).some((item) => item.title === "docs")).toBe(true);
        } finally {
            for (const id of await pageIdsForProvider(ctx)) await ctx.app.pages.closePage(id).catch(() => undefined);
            await closeBoardPage(ctx, board?.id);
            await untrustBoard(ctx, root);
        }
    }, { requires: ["launch"] }),

    test("openTree reuses an identical descriptor", async (ctx) => {
        const root = fixtureBoard(ctx, BOARD);
        let board;
        try {
            await trustFixtureBoard(ctx, root);
            board = await openBoardPage(ctx, root);
            const first = await openTree(ctx, board);
            const before = await pageIdsForProvider(ctx);
            const second = await openTree(ctx, board);
            ctx.expect(second).toBe(first);
            ctx.expect(await pageIdsForProvider(ctx)).toEqual(before);
            ctx.expect(await ctx.app.pages.activePage.id).toBe(first);
        } finally {
            for (const id of await pageIdsForProvider(ctx)) await ctx.app.pages.closePage(id).catch(() => undefined);
            await closeBoardPage(ctx, board?.id);
            await untrustBoard(ctx, root);
        }
    }, { requires: ["launch"] }),

    test("different connections and roots open distinct tree pages", async (ctx) => {
        const root = fixtureBoard(ctx, BOARD);
        let board;
        try {
            await trustFixtureBoard(ctx, root);
            board = await openBoardPage(ctx, root);
            const a = await openTree(ctx, board);
            const b = await openTree(ctx, board, { config: { conn: "b" } });
            const docs = await openTree(ctx, board, { rootPath: "/docs" });
            ctx.expect(new Set([a, b, docs]).size).toBe(3);
            ctx.expect(await ctx.app.pages[b].panels.explorer.rootPath).toBe("/");
            ctx.expect(await ctx.app.pages[docs].panels.explorer.rootPath).toBe("/docs");
        } finally {
            for (const id of await pageIdsForProvider(ctx)) await ctx.app.pages.closePage(id).catch(() => undefined);
            await closeBoardPage(ctx, board?.id);
            await untrustBoard(ctx, root);
        }
    }, { requires: ["launch"] }),

    test("tree browsing preserves nested, Unicode, and case-distinct entries", async (ctx) => {
        const root = fixtureBoard(ctx, BOARD);
        let board;
        try {
            await trustFixtureBoard(ctx, root);
            board = await openBoardPage(ctx, root);
            const id = await openTree(ctx, board, { rootPath: "/docs" });
            const explorer = ctx.app.pages[id].panels.explorer;
            let items = await explorer.listItems();
            ctx.expect(items.some((item) => item.title === "nested" && item.isDirectory)).toBe(true);
            await explorer.expand("/docs/nested");
            let snapshot = await ctx.waitFor(
                (active) => active.callText("window.screen.snapshot", [{ interactive: true }]),
                (value) => value.includes("guide.txt"),
            );
            ctx.expect(snapshot).toContain("guide.txt");
            await explorer.navigateUp();
            items = await explorer.listItems();
            ctx.expect(items.some((item) => item.title === "Readme.md")).toBe(true);
            ctx.expect(items.some((item) => item.title === "readme.md")).toBe(true);
            ctx.expect(items.filter((item) => ["Readme.md", "readme.md"].includes(item.title))).toHaveLength(2);
            await ctx.waitFor((active) => active.callText("window.screen.snapshot", [{ interactive: true }]), (value) => value.includes("Readme.md") && value.includes("readme.md"));
            await explorer.expand("/café 📚");
            snapshot = await ctx.waitFor(
                (active) => active.callText("window.screen.snapshot", [{ interactive: true }]),
                (value) => value.includes("über.txt"),
            );
            ctx.expect(snapshot).toContain("über.txt");
        } finally {
            for (const id of await pageIdsForProvider(ctx)) await ctx.app.pages.closePage(id).catch(() => undefined);
            await closeBoardPage(ctx, board?.id);
            await untrustBoard(ctx, root);
        }
    }, { requires: ["launch"] }),

    test("claimed tree files open and saved editor bytes are read again", async (ctx) => {
        const root = fixtureBoard(ctx, BOARD);
        let board;
        let contentPageId;
        try {
            await trustFixtureBoard(ctx, root);
            board = await openBoardPage(ctx, root);
            const treeId = await openTree(ctx, board);
            const explorer = ctx.app.pages[treeId].panels.explorer;
            await explorer.expand("/data");
            await openFileFromBoard(board, "testtree://a/data/sample.json");
            const jsonPageId = await ctx.waitFor(async (active) => (await active.app.pages.all).find((page) => page.title === "sample.json")?.id ?? null, Boolean);
            ctx.expect(await ctx.app.pages[jsonPageId].content).toContain("tree-fixture");
            await ctx.app.pages.closePage(jsonPageId);

            await openFileFromBoard(board, "testtree://a/docs/nested/guide.txt");
            contentPageId = await ctx.waitFor(async (active) => {
                const pages = await active.app.pages.all;
                return pages.find((page) => page.title === "guide.txt")?.id ?? null;
            }, Boolean);
            ctx.expect(await ctx.app.pages[contentPageId].content).toContain("Original guide bytes.");
            const saved = "Edited guide bytes from the tree test.";
            await ctx.app.pages[contentPageId].editor.insertText(saved);
            await ctx.waitFor((active) => active.app.pages[contentPageId].content, (content) => content.includes(saved));
            await ctx.app.pages[contentPageId].editor.saveFile();
            await ctx.app.pages.closePage(contentPageId);
            contentPageId = undefined;
            await openFileFromBoard(board, "testtree://a/docs/nested/guide.txt");
            contentPageId = await ctx.waitFor(async (active) => {
                const pages = await active.app.pages.all;
                return pages.find((page) => page.title === "guide.txt")?.id ?? null;
            }, Boolean);
            ctx.expect(await ctx.app.pages[contentPageId].content).toContain(saved);
        } finally {
            if (contentPageId) await ctx.app.pages.closePage(contentPageId).catch(() => undefined);
            for (const id of await pageIdsForProvider(ctx)) await ctx.app.pages.closePage(id).catch(() => undefined);
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
