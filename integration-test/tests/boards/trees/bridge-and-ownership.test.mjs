import { test } from "../../../lib/context.mjs";
import { closeBoardPage, fixtureBoard, openBoardPage, trustFixtureBoard, untrustBoard } from "../../helpers/boards.mjs";

const PRIMARY = "trees/tree-board";
const FOREIGN = "trees/foreign-tree-board";

async function treePageIds(ctx, type) {
    const result = [];
    for (const page of await ctx.app.pages.all) {
        try { if (await ctx.app.pages[page.id].panels.explorer.providerType === type) result.push(page.id); }
        catch { /* Ignore pages without a board tree panel. */ }
    }
    return result;
}

async function bridgeOutcome(page, expression) {
    return page.editor.evaluate(`async () => { try { await (${expression}); return { message: null, code: null }; } catch (error) { return { message: error?.message ?? String(error), code: error?.code ?? null }; } }`);
}

export default [
    test("openRawLink opens a claimed tree link and rejects an unclaimed scheme", async (ctx) => {
        const root = fixtureBoard(ctx, PRIMARY);
        let board;
        try {
            await trustFixtureBoard(ctx, root);
            board = await openBoardPage(ctx, root);
            await board.editor.evaluate('async () => await window.persephone.openRawLink("testtree://a/Readme.md")');
            const contentPage = await ctx.waitFor(async (active) => {
                const pages = await active.app.pages.all;
                return pages.find((page) => page.title === "Readme.md")?.id ?? null;
            }, Boolean);
            ctx.expect(await ctx.app.pages[contentPage].content).toContain("Uppercase sibling.");

            const unclaimed = await bridgeOutcome(board, 'window.persephone.openRawLink("unclaimed-tree://host/file.txt")');
            ctx.expect(unclaimed.message).toBeTruthy();
        } finally {
            for (const type of ["test/tree", "test/foreign-tree"]) {
                for (const id of await treePageIds(ctx, type)) await ctx.app.pages.closePage(id).catch(() => undefined);
            }
            await closeBoardPage(ctx, board?.id);
            await untrustBoard(ctx, root);
        }
    }, { requires: ["launch"] }),

    test("openTree refuses another trusted board's provider type", async (ctx) => {
        const primaryRoot = fixtureBoard(ctx, PRIMARY);
        const foreignRoot = fixtureBoard(ctx, FOREIGN);
        let primary;
        let foreign;
        try {
            await trustFixtureBoard(ctx, foreignRoot);
            foreign = await openBoardPage(ctx, foreignRoot);
            await trustFixtureBoard(ctx, primaryRoot);
            primary = await openBoardPage(ctx, primaryRoot);
            const outcome = await bridgeOutcome(primary, 'window.persephone.openTree({ type: "test/foreign-tree", config: {}, rootPath: "/" })');
            ctx.expect(outcome.message).toBeTruthy();
            ctx.expect(await treePageIds(ctx, "test/foreign-tree")).toEqual([]);
        } finally {
            for (const type of ["test/tree", "test/foreign-tree"]) {
                for (const id of await treePageIds(ctx, type)) await ctx.app.pages.closePage(id).catch(() => undefined);
            }
            await closeBoardPage(ctx, primary?.id);
            await closeBoardPage(ctx, foreign?.id);
            await untrustBoard(ctx, primaryRoot);
            await untrustBoard(ctx, foreignRoot);
        }
    }, { requires: ["launch"] }),

    test("another board's claimed scheme does not authorize its links to the primary board", async (ctx) => {
        const primaryRoot = fixtureBoard(ctx, PRIMARY);
        const foreignRoot = fixtureBoard(ctx, FOREIGN);
        let primary;
        let foreign;
        try {
            await trustFixtureBoard(ctx, foreignRoot);
            foreign = await openBoardPage(ctx, foreignRoot);
            await trustFixtureBoard(ctx, primaryRoot);
            primary = await openBoardPage(ctx, primaryRoot);
            const outcome = await bridgeOutcome(primary, 'window.persephone.openRawLink("othertree://fixture/foreign.txt")');
            ctx.expect(outcome.message).toBeTruthy();
        } finally {
            for (const type of ["test/tree", "test/foreign-tree"]) {
                for (const id of await treePageIds(ctx, type)) await ctx.app.pages.closePage(id).catch(() => undefined);
            }
            await closeBoardPage(ctx, primary?.id);
            await closeBoardPage(ctx, foreign?.id);
            await untrustBoard(ctx, primaryRoot);
            await untrustBoard(ctx, foreignRoot);
        }
    }, { requires: ["launch"] }),
];
