import { test } from "../../../lib/context.mjs";
import { closeBoardPage, fixtureBoard, openBoardPage, trustFixtureBoard, untrustBoard } from "../../helpers/boards.mjs";
import { createStore, restoreStore } from "../../editors/env-vars/helpers.mjs";
import { closePendingDialog, waitForDialog } from "../../helpers/shell-helpers.mjs";

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
    test("trusted tree service reads and updates only its own environment namespace without its board page", async (ctx) => {
        const root = fixtureBoard(ctx, PRIMARY);
        const foreignRoot = fixtureBoard(ctx, FOREIGN);
        const store = await createStore(ctx, "boards/bridge", "service-vars.json");
        let board;
        let treeId;
        let namespace;
        let foreignNamespace;
        try {
            namespace = await ctx.app.boardVars.namespaceFor(root);
            foreignNamespace = await ctx.app.boardVars.namespaceFor(foreignRoot);
            await ctx.app.boardVars.set(namespace, "TREE_SERVICE_SEED", "synthetic-seed");
            await ctx.app.boardVars.set(namespace, "TREE_SERVICE_DELETE", "synthetic-delete");
            await ctx.app.boardVars.set(foreignNamespace, "TREE_FOREIGN_ONLY", "foreign-secret-fixture");
            await trustFixtureBoard(ctx, root);
            board = await openBoardPage(ctx, root);
            const before = new Set(await treePageIds(ctx, "test/tree"));
            await board.editor.evaluate('async () => await window.persephone.openTree({ type: "test/tree", config: { conn: "a" }, rootPath: "/_test/service-vars" })');
            treeId = await ctx.waitFor(async (active) => (await treePageIds(active, "test/tree")).find((id) => !before.has(id)) ?? null, Boolean);
            await closeBoardPage(ctx, board.id);
            board = undefined;
            const items = await ctx.waitFor((active) => active.app.pages[treeId].panels.explorer.listItems(), (values) => values.length === 4);
            ctx.expect(items.map((item) => item.title).sort()).toEqual([
                "delete-removed:ok", "foreign-hidden:ok", "seed-read:ok", "set-written:ok",
            ]);
            ctx.expect(await ctx.app.boardVars.get(namespace, "TREE_SERVICE_WRITTEN")).toBe("synthetic-service-value");
            const deletedValue = await ctx.app.boardVars.get(namespace, "TREE_SERVICE_DELETE");
            ctx.expect(deletedValue === null || deletedValue === undefined).toBe(true);
            const ownerKeys = await ctx.app.boardVars.list(namespace);
            ctx.expect(ownerKeys).toContain("TREE_SERVICE_SEED");
            ctx.expect(ownerKeys).toContain("TREE_SERVICE_WRITTEN");
            ctx.expect(ownerKeys).not.toContain("TREE_SERVICE_DELETE");
            ctx.expect(await ctx.app.boardVars.get(foreignNamespace, "TREE_FOREIGN_ONLY")).toBe("foreign-secret-fixture");
            ctx.expect(await ctx.app.boardVars.list(foreignNamespace)).toEqual(["TREE_FOREIGN_ONLY"]);
        } finally {
            await closePendingDialog(ctx);
            if (treeId) await ctx.app.pages.closePage(treeId).catch(() => undefined);
            await closeBoardPage(ctx, board?.id);
            await untrustBoard(ctx, root);
            if (namespace) {
                for (const name of ["TREE_SERVICE_SEED", "TREE_SERVICE_DELETE", "TREE_SERVICE_WRITTEN"]) await ctx.app.boardVars.delete(namespace, name).catch(() => undefined);
            }
            if (foreignNamespace) await ctx.app.boardVars.delete(foreignNamespace, "TREE_FOREIGN_ONLY").catch(() => undefined);
            await restoreStore(ctx, store);
            await ctx.app.fs.delete(store.filePath).catch(() => undefined);
        }
    }, { requires: ["launch"] }),

    test("service environment variable request reports creation dialog decline", async (ctx) => {
        const root = fixtureBoard(ctx, PRIMARY);
        const store = await createStore(ctx, "boards/bridge", "service-vars-decline.json");
        let board;
        let treeId;
        try {
            await ctx.app.settings.set("board-vars.file", "");
            await trustFixtureBoard(ctx, root);
            board = await openBoardPage(ctx, root);
            const before = new Set(await treePageIds(ctx, "test/tree"));
            await board.editor.evaluate('async () => await window.persephone.openTree({ type: "test/tree", config: { conn: "a" }, rootPath: "/_test/service-vars" })');
            treeId = await ctx.waitFor(async (active) => (await treePageIds(active, "test/tree")).find((id) => !before.has(id)) ?? null, Boolean);
            await closeBoardPage(ctx, board.id);
            board = undefined;
            await waitForDialog(ctx, "dialogs[0].title", (title) => title === "Create environment variables storage");
            await /* dialog options require ctx.call */ ctx.call("dialogs[0].cancel", [], { dialog: true });
            // Read the rows the Explorer already rendered for the declined request. Calling
            // listItems() here would start a new listing, which legitimately prompts again.
            const slot = `[data-name="page-slot"][data-page-id=${JSON.stringify(treeId)}]`;
            const rows = await ctx.waitFor((active) => active.app.window.screen.evaluate(`() => Array.from(
                document.querySelectorAll(${JSON.stringify(slot)} + ' [role="treeitem"]'),
                (row) => row.textContent ?? "")`), (values) => Array.isArray(values) && values.length > 0);
            ctx.expect(rows.some((text) => text.includes("board-vars-declined:failed"))).toBe(true);
        } finally {
            await closePendingDialog(ctx);
            if (treeId) await ctx.app.pages.closePage(treeId).catch(() => undefined);
            await closeBoardPage(ctx, board?.id);
            await untrustBoard(ctx, root);
            await restoreStore(ctx, store);
            await ctx.app.fs.delete(store.filePath).catch(() => undefined);
        }
    }, { requires: ["launch"] }),

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
