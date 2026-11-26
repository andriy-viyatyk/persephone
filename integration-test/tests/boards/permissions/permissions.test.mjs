import path from "node:path";
import { test } from "../../../lib/context.mjs";
import { closeBoardPage, fixtureBoard, openBoardPage, resetBoardFile, trustFixtureBoard, untrustBoard } from "../../helpers/boards.mjs";

const ALL_FALSE = {
    execute: false,
    service: false,
    fileSystem: false,
    openExternal: false,
    appScripting: false,
    network: false,
    clipboardRead: false,
    camera: false,
    microphone: false,
    computerAudio: false,
    geolocation: false,
    notifications: false,
    themes: false,
};

function manifest(name, permissions = ALL_FALSE) {
    return `${JSON.stringify({
        schemaVersion: 1,
        name,
        author: "Fixture Author",
        minBridgeVersion: "1.30.0",
        permissions,
    }, null, 2)}\n`;
}

async function bestEffort(action) {
    try { await action(); } catch { /* Cleanup must not hide the test result. */ }
}

async function waitForDialog(ctx, predicate) {
    await ctx.waitFor(
        (activeContext) => activeContext.call("dialogs[0].title", undefined, { dialog: true }).catch(() => null),
        (title) => typeof title === "string" && predicate(title),
    );
}

async function resetFixture(ctx, name) {
    const root = fixtureBoard(ctx, `permissions/${name}`);
    const permissions = name === "granted-board"
        ? { ...ALL_FALSE, execute: true, fileSystem: "board", network: "full", themes: true }
        : ALL_FALSE;
    await resetBoardFile(ctx, root, "board-manifest.json", manifest(`US-2092 ${name === "granted-board" ? "Granted" : "Locked"} Board`, permissions));
    return root;
}

export default [
    test("trust dialog lists the declared grants", async (ctx) => {
        const root = fixtureBoard(ctx, "permissions/granted-board");
        let registerPromise;
        try {
            await resetBoardFile(ctx, root, "board-manifest.json", manifest("US-2092 Granted Board", {
                ...ALL_FALSE,
                execute: true,
                fileSystem: "board",
                network: "full",
                themes: true,
            }));
            registerPromise = ctx.call("boards.registerBoard", [root], { dialog: true });
            await waitForDialog(ctx, (title) => title === "Trust this board?");
            ctx.expect(await ctx.call("dialogs[0].permissions", undefined, { dialog: true })).toEqual({
                kind: "flags",
                flags: { ...ALL_FALSE, execute: true, fileSystem: "board", network: "full", themes: true },
            });
            ctx.expect(await ctx.call("dialogs[0].permissionLines", undefined, { dialog: true })).toEqual([
                "Run programs and scripts on this computer.",
                "Full access",
                "This process can access your files and the network regardless of the board's other permissions.",
                "Read and write files in this board's folder (including its own code) and files you pick in its dialogs.",
                "Connect to the internet, this computer, and your local network.",
                "Full access",
                "Can reach everything your user account can.",
                "Create, change, delete, and apply app themes.",
            ]);
            ctx.expect(await ctx.call("dialogs[0].buttons", undefined, { dialog: true })).toEqual(["Cancel", "Trust Board"]);
            await ctx.call("dialogs[0].click", ["Trust Board"], { dialog: true });
            await registerPromise;
        } finally {
            await bestEffort(() => ctx.call("dialogs[0].cancel", [], { dialog: true }));
            await bestEffort(() => registerPromise);
            await bestEffort(() => untrustBoard(ctx, root));
        }
    }),

    test("service permission explains process access when frame network is denied", async (ctx) => {
        const root = fixtureBoard(ctx, "permissions/service-network-disabled");
        let registerPromise;
        try {
            await resetBoardFile(ctx, root, "board-manifest.json", manifest("Service Network Disabled Board", {
                ...ALL_FALSE,
                service: true,
            }));
            registerPromise = ctx.call("boards.registerBoard", [root], { dialog: true });
            await waitForDialog(ctx, (title) => title === "Trust this board?");
            ctx.expect(await ctx.call("dialogs[0].permissionLines", undefined, { dialog: true })).toEqual([
                "Run a background program while Persephone is open.",
                "Full access",
                "This process can access your files and the network regardless of the board's other permissions.",
            ]);
            await ctx.call("dialogs[0].click", ["Trust Board"], { dialog: true });
            await registerPromise;
        } finally {
            await bestEffort(() => ctx.call("dialogs[0].cancel", [], { dialog: true }));
            await bestEffort(() => registerPromise);
            await bestEffort(() => untrustBoard(ctx, root));
        }
    }),

    test("execute and executeNode require execute permission", async (ctx) => {
        const root = await resetFixture(ctx, "locked-board");
        let page;
        try {
            await trustFixtureBoard(ctx, root);
            page = await openBoardPage(ctx, root);
            const outcome = await page.editor.evaluate(`async () => {
                const result = {};
                try { await window.persephone.execute('node -e "process.exit(0)"').getText(); result.execute = null; }
                catch (error) { result.execute = String(error); }
                try { await window.persephone.executeNode('scripts/ok.js').getText(); result.executeNode = null; }
                catch (error) { result.executeNode = String(error); }
                return result;
            }`);
            ctx.expect(outcome.execute).toContain('permission-denied: "execute"');
            ctx.expect(outcome.executeNode).toContain('permission-denied: "execute"');
        } finally {
            await bestEffort(() => closeBoardPage(ctx, page?.id));
            await bestEffort(() => untrustBoard(ctx, root));
        }
    }),

    test("file bridge access is denied without fileSystem", async (ctx) => {
        const root = await resetFixture(ctx, "locked-board");
        let page;
        try {
            await trustFixtureBoard(ctx, root);
            await resetBoardFile(ctx, root, "probe.txt", "fixture-probe-content\n");
            page = await openBoardPage(ctx, root);
            const outcome = await page.editor.evaluate(`async () => {
                const methods = [
                    () => window.persephone.listFolder("."),
                    () => window.persephone.readFile("probe.txt"),
                    () => window.persephone.writeFile("probe.txt", "fake"),
                ];
                const results = await Promise.allSettled(methods.map((method) => method()));
                return results.map((result) => result.status === "rejected" ? String(result.reason) : "fulfilled");
            }`);
            for (const message of outcome) ctx.expect(message).toContain("permission-denied");
            ctx.expect(await ctx.app.fs.read(path.join(root, "probe.txt"))).toBe("fixture-probe-content\n");
        } finally {
            await bestEffort(() => closeBoardPage(ctx, page?.id));
            await bestEffort(() => untrustBoard(ctx, root));
        }
    }),

    test("app scripting is denied from the hosting board frame", async (ctx) => {
        const root = await resetFixture(ctx, "locked-board");
        let page;
        try {
            await trustFixtureBoard(ctx, root);
            page = await openBoardPage(ctx, root);
            const message = await page.editor.evaluate(`async () => {
                try { await window.persephone.call("pages.all"); return "no error"; }
                catch (error) { return String(error); }
            }`);
            ctx.expect(message).toContain('permission-denied: "appScripting"');
        } finally {
            await bestEffort(() => closeBoardPage(ctx, page?.id));
            await bestEffort(() => untrustBoard(ctx, root));
        }
    }),

    test("network bridge is denied without network", async (ctx) => {
        const root = await resetFixture(ctx, "locked-board");
        let page;
        try {
            await trustFixtureBoard(ctx, root);
            page = await openBoardPage(ctx, root);
            const message = await page.editor.evaluate(
                "(url) => (async () => { try { await window.persephone.fetch(url); return 'no error'; } catch (error) { return String(error); } })()",
                { args: [ctx.httpUrl("/sample.txt")] },
            );
            ctx.expect(message).toContain('permission-denied: "network"');
        } finally {
            await bestEffort(() => closeBoardPage(ctx, page?.id));
            await bestEffort(() => untrustBoard(ctx, root));
        }
    }),

    test("themes bridge is denied without themes", async (ctx) => {
        const root = await resetFixture(ctx, "locked-board");
        let page;
        try {
            await trustFixtureBoard(ctx, root);
            page = await openBoardPage(ctx, root);
            const message = await page.editor.evaluate(`async () => {
                try { await window.persephone.themes.current(); return "no error"; }
                catch (error) { return String(error); }
            }`);
            ctx.expect(message).toContain('permission-denied: "themes"');
        } finally {
            await bestEffort(() => closeBoardPage(ctx, page?.id));
            await bestEffort(() => untrustBoard(ctx, root));
        }
    }),

    test("granted executeNode runs the fixture script", async (ctx) => {
        const root = await resetFixture(ctx, "granted-board");
        let page;
        try {
            await trustFixtureBoard(ctx, root);
            page = await openBoardPage(ctx, root);
            const result = await page.editor.evaluate("async () => await window.persephone.executeNode('scripts/ok.js').getJson(/@@RESULT@@(.*)/)");
            ctx.expect(result).toEqual({ ok: true });
        } finally {
            await bestEffort(() => closeBoardPage(ctx, page?.id));
            await bestEffort(() => untrustBoard(ctx, root));
        }
    }),

    test("granted board file access reads and writes only the work copy", async (ctx) => {
        const root = await resetFixture(ctx, "granted-board");
        let page;
        try {
            await trustFixtureBoard(ctx, root);
            await resetBoardFile(ctx, root, "probe.txt", "fixture-probe-content\n");
            page = await openBoardPage(ctx, root);
            const contents = await page.editor.evaluate(`async () => {
                await window.persephone.writeFile("probe.txt", "US-2092 fake");
                return await window.persephone.readFile("probe.txt");
            }`);
            ctx.expect(contents).toBe("US-2092 fake");
        } finally {
            await bestEffort(() => resetBoardFile(ctx, root, "probe.txt", "fixture-probe-content\n"));
            await bestEffort(() => closeBoardPage(ctx, page?.id));
            await bestEffort(() => untrustBoard(ctx, root));
        }
    }),

    test("granted network fetch reaches only the local fixture server", async (ctx) => {
        const root = await resetFixture(ctx, "granted-board");
        let page;
        try {
            await trustFixtureBoard(ctx, root);
            page = await openBoardPage(ctx, root);
            const body = await page.editor.evaluate(
                "(url) => (async () => await (await window.persephone.fetch(url)).text())()",
                { args: [ctx.httpUrl("/sample.txt")] },
            );
            ctx.expect(body).toBe("HTTP fixture sample\n");
        } finally {
            await bestEffort(() => closeBoardPage(ctx, page?.id));
            await bestEffort(() => untrustBoard(ctx, root));
        }
    }),

    test("permission increase dialog reports the change and accept grants it", async (ctx) => {
        const root = fixtureBoard(ctx, "permissions/widen-board");
        const widenedManifest = manifest("US-2092 Widen Board", { ...ALL_FALSE, themes: true });
        let page;
        let reloadPromise;
        try {
            await resetBoardFile(ctx, root, "board-manifest.json", manifest("US-2092 Widen Board"));
            await trustFixtureBoard(ctx, root);
            page = await openBoardPage(ctx, root);
            await resetBoardFile(ctx, root, "board-manifest.json", widenedManifest);
            reloadPromise = ctx.call(`pages["${page.id}"].editor.reload`, [], { dialog: true });
            await waitForDialog(ctx, (title) => title === "Board permissions changed");
            const change = await ctx.call("dialogs[0].change", undefined, { dialog: true });
            ctx.expect(change.granted).toEqual({ kind: "flags", flags: ALL_FALSE });
            ctx.expect(change.proposed).toEqual({ kind: "flags", flags: { ...ALL_FALSE, themes: true } });
            ctx.expect(change.changes).toEqual([{ flag: "themes", kind: "added", from: false, to: true }]);
            ctx.expect(await ctx.call("dialogs[0].permissionLines", undefined, { dialog: true })).toEqual([
                "+ Create, change, delete, and apply app themes.",
            ]);
            ctx.expect(await ctx.call("dialogs[0].buttons", undefined, { dialog: true })).toEqual(["Unregister board", "Accept"]);
            await ctx.call("dialogs[0].click", ["Accept"], { dialog: true });
            await reloadPromise;
            const outcome = await page.editor.evaluate(`async () => {
                try { await window.persephone.themes.current(); return { error: null }; }
                catch (error) { return { error: String(error) }; }
            }`);
            ctx.expect(outcome.error).toBe(null);
        } finally {
            await bestEffort(() => ctx.call("dialogs[0].cancel", [], { dialog: true }));
            await bestEffort(() => reloadPromise);
            await bestEffort(() => resetBoardFile(ctx, root, "board-manifest.json", manifest("US-2092 Widen Board")));
            await bestEffort(() => closeBoardPage(ctx, page?.id));
            await bestEffort(() => untrustBoard(ctx, root));
        }
    }),

    test("closing a permission change keeps the old grant and prompts again", async (ctx) => {
        const root = fixtureBoard(ctx, "permissions/widen-board");
        let page;
        let reloadPromise;
        let reopenPromise;
        try {
            await resetBoardFile(ctx, root, "board-manifest.json", manifest("US-2092 Widen Board"));
            await trustFixtureBoard(ctx, root);
            page = await openBoardPage(ctx, root);
            await resetBoardFile(ctx, root, "board-manifest.json", manifest("US-2092 Widen Board", { ...ALL_FALSE, themes: true }));
            reloadPromise = ctx.call(`pages["${page.id}"].editor.reload`, [], { dialog: true });
            await waitForDialog(ctx, (title) => title === "Board permissions changed");
            await ctx.call("dialogs[0].cancel", [], { dialog: true });
            await bestEffort(() => reloadPromise);
            await bestEffort(() => closeBoardPage(ctx, page?.id));
            page = undefined;

            reopenPromise = ctx.call("boards.openBoard", [root], { dialog: true });
            await waitForDialog(ctx, (title) => title === "Board permissions changed");
            const change = await ctx.call("dialogs[0].change", undefined, { dialog: true });
            ctx.expect(change.granted).toEqual({ kind: "flags", flags: ALL_FALSE });
            ctx.expect(change.proposed).toEqual({ kind: "flags", flags: { ...ALL_FALSE, themes: true } });
        } finally {
            await bestEffort(() => ctx.call("dialogs[0].cancel", [], { dialog: true }));
            await bestEffort(() => reopenPromise);
            await bestEffort(() => reloadPromise);
            await bestEffort(() => resetBoardFile(ctx, root, "board-manifest.json", manifest("US-2092 Widen Board")));
            await bestEffort(() => closeBoardPage(ctx, page?.id));
            await bestEffort(() => untrustBoard(ctx, root));
        }
    }),

    test("legacy manifests expose the deprecation note", async (ctx) => {
        const root = fixtureBoard(ctx, "permissions/legacy-board");
        const cases = [
            `${JSON.stringify({
                schemaVersion: 1,
                name: "US-2092 Legacy Board",
                author: "Fixture Author",
                minBridgeVersion: "1.30.0",
            }, null, 2)}\n`,
            `${JSON.stringify({
                schemaVersion: 1,
                name: "US-2092 Legacy Board",
                author: "Fixture Author",
                minBridgeVersion: "1.30.0",
                permissions: ["service"],
            }, null, 2)}\n`,
        ];
        try {
            for (const content of cases) {
                await resetBoardFile(ctx, root, "board-manifest.json", content);
                await trustFixtureBoard(ctx, root);
                try {
                    const board = (await ctx.app.boards.list()).find((entry) => entry.root === root);
                    ctx.expect(Boolean(board)).toBe(true);
                    ctx.expect(board.deprecationNote).toContain("deprecated");
                } finally {
                    await bestEffort(() => untrustBoard(ctx, root));
                }
            }
        } finally {
            await bestEffort(() => untrustBoard(ctx, root));
        }
    }),
];
