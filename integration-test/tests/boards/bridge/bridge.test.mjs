import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "../../../lib/context.mjs";
import { closeBoardPage, fixtureBoard, openBoardPage, resetBoardFile, trustFixtureBoard, untrustBoard } from "../../helpers/boards.mjs";
import { createStore, restoreStore } from "../../editors/env-vars/helpers.mjs";

const POSITIVE_BOARD = "bridge/bridge-board";
const DENIAL_BOARD = "bridge/no-app-board";
const HOVER_BOARD = "bridge/hover-state-board";

export default [
    test("board automation applies forced hover to hover-revealed controls", async (ctx) => {
        const root = fixtureBoard(ctx, HOVER_BOARD);
        let page;
        try {
            await trustFixtureBoard(ctx, root);
            page = await openBoardPage(ctx, root);
            await page.editor.waitFor({ selector: "#hover-row" });
            await page.editor.hover("#hover-row");
            await page.editor.click("#menu");
            ctx.expect(await page.editor.evaluate("() => window.results")).toEqual(["clicked"]);
        } finally {
            await closeBoardPage(ctx, page?.id);
            await untrustBoard(ctx, root);
        }
    }),

    test("board bridge reports the app bridge version", async (ctx) => {
        const bridgeVersionSource = await readFile(new URL("../../../../src/shared/board-bridge-version.ts", import.meta.url), "utf8");
        const bridgeVersion = /BOARD_BRIDGE_VERSION\s*=\s*["']([^"']+)["']/.exec(bridgeVersionSource)?.[1];
        ctx.expect(bridgeVersion).toBeTruthy();
        const root = fixtureBoard(ctx, POSITIVE_BOARD);
        let page;
        try {
            await trustFixtureBoard(ctx, root);
            page = await openBoardPage(ctx, root);
            ctx.expect(await page.editor.evaluate("() => window.persephone.version")).toBe(bridgeVersion);
        } finally {
            await closeBoardPage(ctx, page?.id);
            await untrustBoard(ctx, root);
        }
    }),

    test("execute returns JSON and forwards command arguments", async (ctx) => {
        const root = fixtureBoard(ctx, POSITIVE_BOARD);
        let page;
        try {
            await resetBoardFile(ctx, root, "data/start.json", '{"value":"fixture-start"}\n');
            await trustFixtureBoard(ctx, root);
            page = await openBoardPage(ctx, root);
            const result = await page.editor.evaluate("async () => await window.persephone.execute('node scripts/echo.js alpha beta').getJson(/@@RESULT@@(.*)/)");
            ctx.expect(result).toEqual({ args: ["alpha", "beta"] });
        } finally {
            await closeBoardPage(ctx, page?.id);
            await untrustBoard(ctx, root);
        }
    }),

    test("execute reports a failed script with its stderr", async (ctx) => {
        const root = fixtureBoard(ctx, POSITIVE_BOARD);
        let page;
        try {
            await trustFixtureBoard(ctx, root);
            page = await openBoardPage(ctx, root);
            const outcome = await page.editor.evaluate("async () => { try { await window.persephone.execute('node scripts/fail.js').getJson(/@@RESULT@@(.*)/); return { error: null }; } catch (error) { return { error: String(error), exitCode: error.exitCode, stderr: error.stderr }; } }");
            ctx.expect(outcome.error).toContain("exit");
            ctx.expect(outcome.stderr).toContain("fixture diagnostic");
            ctx.expect(outcome.exitCode).toBe(7);
        } finally {
            await closeBoardPage(ctx, page?.id);
            await untrustBoard(ctx, root);
        }
    }),

    test("executeNode preserves argv boundaries", async (ctx) => {
        const root = fixtureBoard(ctx, POSITIVE_BOARD);
        let page;
        try {
            await trustFixtureBoard(ctx, root);
            page = await openBoardPage(ctx, root);
            const result = await page.editor.evaluate("async () => await window.persephone.executeNode('scripts/args.js', ['fake-one', 'fake two']).getJson(/@@RESULT@@(.*)/)");
            ctx.expect(result).toEqual({ args: ["fake-one", "fake two"] });
        } finally {
            await closeBoardPage(ctx, page?.id);
            await untrustBoard(ctx, root);
        }
    }),

    test("persephone.call reaches the app tree only with appScripting", async (ctx) => {
        const root = fixtureBoard(ctx, POSITIVE_BOARD);
        const deniedRoot = fixtureBoard(ctx, DENIAL_BOARD);
        let page;
        let deniedPage;
        try {
            await trustFixtureBoard(ctx, root);
            await trustFixtureBoard(ctx, deniedRoot);
            page = await openBoardPage(ctx, root);
            deniedPage = await openBoardPage(ctx, deniedRoot);
            ctx.expect(await page.editor.evaluate("() => window.persephone.call('version')")).toBe(await ctx.app.version);
            const denied = await deniedPage.editor.evaluate("async () => { try { return { value: await window.persephone.call('version') }; } catch (error) { return { error: String(error), code: error.code }; } }");
            ctx.expect(denied.error).toContain("permission-denied");
        } finally {
            await closeBoardPage(ctx, deniedPage?.id);
            await closeBoardPage(ctx, page?.id);
            await untrustBoard(ctx, deniedRoot);
            await untrustBoard(ctx, root);
        }
    }),

    test("board-scoped file access reads, writes, and lists files", async (ctx) => {
        const root = fixtureBoard(ctx, POSITIVE_BOARD);
        const startPath = path.join(root, "data", "start.json");
        const resultPath = path.join(root, "data", "result.txt");
        const dataPath = path.join(root, "data");
        let page;
        try {
            await resetBoardFile(ctx, root, "data/start.json", '{"value":"fixture-start"}\n');
            await resetBoardFile(ctx, root, "data/result.txt", "");
            await trustFixtureBoard(ctx, root);
            page = await openBoardPage(ctx, root);
            const expression = `async () => {
                const startPath = ${JSON.stringify(startPath)};
                const resultPath = ${JSON.stringify(resultPath)};
                const dataPath = ${JSON.stringify(dataPath)};
                const initial = await window.persephone.readFile(startPath);
                await window.persephone.writeFile(resultPath, "fixture-written");
                const written = await window.persephone.readFile(resultPath);
                const entries = await window.persephone.listFolder(dataPath);
                return { initial, written, entries };
            }`;
            const result = await page.editor.evaluate(expression);
            ctx.expect(result.initial).toContain("fixture-start");
            ctx.expect(result.written).toBe("fixture-written");
            ctx.expect(JSON.stringify(result.entries)).toContain("result.txt");
        } finally {
            await closeBoardPage(ctx, page?.id);
            await untrustBoard(ctx, root);
        }
    }),

    test("board file grant refuses access to a sibling fixture", async (ctx) => {
        const root = fixtureBoard(ctx, POSITIVE_BOARD);
        const outsidePath = ctx.fixture("boards/bridge/outside.txt");
        let page;
        try {
            await resetBoardFile(ctx, root, "data/start.json", '{"value":"fixture-start"}\n');
            await trustFixtureBoard(ctx, root);
            page = await openBoardPage(ctx, root);
            const expression = `async () => {
                const outsidePath = ${JSON.stringify(outsidePath)};
                const outcomes = {};
                try { await window.persephone.readFile(outsidePath); outcomes.read = null; }
                catch (error) { outcomes.read = { message: String(error), code: error.code }; }
                try { await window.persephone.writeFile(outsidePath, "fixture-overwrite"); outcomes.write = null; }
                catch (error) { outcomes.write = { message: String(error), code: error.code }; }
                return outcomes;
            }`;
            const outcome = await page.editor.evaluate(expression);
            ctx.expect(outcome.read.code).toBe("permission-denied");
            ctx.expect(outcome.write.code).toBe("permission-denied");
            ctx.expect(await ctx.app.fs.read(outsidePath)).toBe("fixture-outside-content\n");
        } finally {
            await closeBoardPage(ctx, page?.id);
            await untrustBoard(ctx, root);
        }
    }),

    test("board variables are provisioned and readable by their owner", async (ctx) => {
        const root = fixtureBoard(ctx, POSITIVE_BOARD);
        const varsPath = ctx.fixture("boards/bridge/vars.json");
        const originalPath = await ctx.app.settings.get("board-vars.file");
        let page;
        try {
            await ctx.app.fs.write(varsPath, "{}\n");
            await ctx.app.settings.set("board-vars.file", "");
            await ctx.app.settings.set("board-vars.file", varsPath);
            const namespace = await ctx.app.boardVars.namespaceFor(root);
            await ctx.app.boardVars.set(namespace, "FAKE_TOKEN", "fixture-value");
            await trustFixtureBoard(ctx, root);
            page = await openBoardPage(ctx, root);
            const owned = await page.editor.evaluate("async () => { const seeded = await window.persephone.var.get('FAKE_TOKEN'); await window.persephone.var.set('FAKE_LABEL', 'fixture-label'); const written = await window.persephone.var.get('FAKE_LABEL'); return { seeded, written }; }");
            ctx.expect(owned).toEqual({ seeded: "fixture-value", written: "fixture-label" });
            ctx.expect((await ctx.app.boardVars.list(namespace)).sort()).toEqual(["FAKE_LABEL", "FAKE_TOKEN"]);
        } finally {
            await closeBoardPage(ctx, page?.id);
            await untrustBoard(ctx, root);
            try { await ctx.app.settings.set("board-vars.file", originalPath); } catch { /* Cleanup must not mask the test result. */ }
        }
    }),

    test("board variables do not leak across board namespaces", async (ctx) => {
        const root = fixtureBoard(ctx, POSITIVE_BOARD);
        const varsPath = ctx.fixture("boards/bridge/vars.json");
        const originalPath = await ctx.app.settings.get("board-vars.file");
        let page;
        try {
            await ctx.app.fs.write(varsPath, "{}\n");
            await ctx.app.settings.set("board-vars.file", "");
            await ctx.app.settings.set("board-vars.file", varsPath);
            const ownerNamespace = await ctx.app.boardVars.namespaceFor(root);
            const otherRoot = fixtureBoard(ctx, DENIAL_BOARD);
            const otherNamespace = await ctx.app.boardVars.namespaceFor(otherRoot);
            await ctx.app.boardVars.set(otherNamespace, "FAKE_TOKEN", "foreign-fixture-value");
            await trustFixtureBoard(ctx, root);
            page = await openBoardPage(ctx, root);
            const value = await page.editor.evaluate("async () => await window.persephone.var.get('FAKE_TOKEN')");
            ctx.expect(value).toBe(null);
            ctx.expect(await ctx.app.boardVars.list(ownerNamespace)).toEqual([]);
            ctx.expect(await ctx.app.boardVars.list(otherNamespace)).toEqual(["FAKE_TOKEN"]);
        } finally {
            await closeBoardPage(ctx, page?.id);
            await untrustBoard(ctx, root);
            try { await ctx.app.settings.set("board-vars.file", originalPath); } catch { /* Cleanup must not mask the test result. */ }
        }
    }),

    test("board var delete and keys preserve list compatibility", async (ctx) => {
        const root = fixtureBoard(ctx, POSITIVE_BOARD);
        const store = await createStore(ctx, "boards/bridge", "page-vars.json");
        let page;
        let namespace;
        try {
            namespace = await ctx.app.boardVars.namespaceFor(root);
            await ctx.app.boardVars.set(namespace, "PAGE_DELETE_FIXTURE", "synthetic-value");
            await trustFixtureBoard(ctx, root);
            page = await openBoardPage(ctx, root);
            const result = await page.editor.evaluate(`async () => {
                const keys = await window.persephone.var.keys();
                const list = await window.persephone.var.list();
                await window.persephone.var.delete("PAGE_DELETE_FIXTURE");
                await window.persephone.var.delete("PAGE_MISSING_FIXTURE");
                return { keys, list, afterKeys: await window.persephone.var.keys(), afterList: await window.persephone.var.list() };
            }`);
            ctx.expect(result.keys).toContain("PAGE_DELETE_FIXTURE");
            ctx.expect(result.list).toEqual(result.keys);
            ctx.expect(result.afterKeys).toEqual(result.afterList);
            ctx.expect(result.afterKeys).not.toContain("PAGE_DELETE_FIXTURE");
            ctx.expect((await ctx.app.boardVars.get(namespace, "PAGE_DELETE_FIXTURE")) ?? undefined).toBe(undefined);
        } finally {
            await closeBoardPage(ctx, page?.id);
            await untrustBoard(ctx, root);
            await restoreStore(ctx, store);
            await ctx.app.fs.delete(store.filePath).catch(() => undefined);
        }
    }),
];
