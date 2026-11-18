import { test } from "../../../lib/context.mjs";
import { closeBoardPage, fixtureBoard, openBoardPage, resetBoardFile, trustFixtureBoard, untrustBoard, waitForBoardDialog } from "../helpers.mjs";

const FOREIGN_BOARD = "lifecycle/foreign";
const FIXTURE_INDEX = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>US-2091 Foreign Fixture</title><link rel="stylesheet" href="board-base.css"></head>
<body><main><h1>Foreign fixture board</h1><p id="fixture-ready">US-2091 fixture marker</p></main><script src="app.js"></script></body>
</html>
`;

function sameRoot(left, right) {
    return typeof left === "string" && typeof right === "string"
        && left.replace(/[\\/]+/g, "\\").replace(/\\$/, "").toLowerCase()
            === right.replace(/[\\/]+/g, "\\").replace(/\\$/, "").toLowerCase();
}

async function removeWork(ctx, dir) {
    if (!dir) return;
    try { await ctx.app.fs.removeDir(dir, true); } catch { /* the test work folder may already be gone */ }
}

async function prepareWork(ctx, rel) {
    const dir = ctx.fixture(`boards/lifecycle-work/${rel}`);
    await removeWork(ctx, dir);
    await ctx.app.fs.mkdir(dir);
    return dir;
}

async function cleanupBoard(ctx, root, pageId, dir) {
    if (!pageId && root) {
        try { pageId = await findBoardPage(ctx, root); } catch { /* the page may already be gone */ }
    }
    await closeBoardPage(ctx, pageId);
    await untrustBoard(ctx, root);
    await removeWork(ctx, dir);
}

async function findBoardPage(ctx, root) {
    const pages = await ctx.app.pages.all;
    for (const page of pages) {
        if (page.editor === "board-view" || page.editor?.startsWith("board-editor:")) {
            const candidateRoot = await ctx.app.pages[page.id].editor.boardRoot;
            if (sameRoot(candidateRoot, root)) return page.id;
        }
    }
    return null;
}

export default [
    test("createBoard scaffolds and auto-trusts an all-false blank board", async (ctx) => {
        const dir = await prepareWork(ctx, "create-board");
        let root;
        let page;
        try {
            root = await ctx.app.boards.createBoard("Blank", dir);
            ctx.expect(typeof root).toBe("string");
            ctx.expect(sameRoot(root, `${dir}/Blank`)).toBe(true);
            const expectedFiles = [
                "board-manifest.json", "index.html", "app.js", "board-base.css", "lang/en.json", "scripts/hello.js",
            ];
            for (const relative of expectedFiles) ctx.expect(await ctx.app.fs.exists(`${root}/${relative}`)).toBe(true);
            const manifest = JSON.parse(await ctx.callText("fs.read", [`${root}/board-manifest.json`]));
            ctx.expect(Object.values(manifest.permissions).every((allowed) => allowed === false)).toBe(true);
            const listing = (await ctx.app.boards.list()).find((board) => sameRoot(board.root, root));
            ctx.expect(listing.trusted).toBe(true);
            page = await openBoardPage(ctx, root);
            ctx.expect(await page.editor.renderState).toBe("trusted");
            ctx.expect(await page.editor.frameReady).toBe(true);
        } finally {
            await cleanupBoard(ctx, root, page?.id, dir);
        }
    }),

    test("createBoard rejects a name collision without replacing the existing board", async (ctx) => {
        const dir = await prepareWork(ctx, "create-board-collision");
        let root;
        try {
            root = await ctx.app.boards.createBoard("Blank", dir);
            const originalManifest = await ctx.callText("fs.read", [`${root}/board-manifest.json`]);
            let errorText = "";
            try { await ctx.app.boards.createBoard("Blank", dir); } catch (error) { errorText = String(error); }
            ctx.expect(/already exists|exists/i.test(errorText)).toBe(true);
            ctx.expect(await ctx.callText("fs.read", [`${root}/board-manifest.json`])).toBe(originalManifest);
            const listing = (await ctx.app.boards.list()).find((board) => sameRoot(board.root, root));
            ctx.expect(listing.trusted).toBe(true);
        } finally {
            await cleanupBoard(ctx, root, null, dir);
        }
    }),

    test("createDemoBoard copies and opens the bundled Demo board", async (ctx) => {
        const dir = await prepareWork(ctx, "create-demo-board");
        let root;
        let page;
        try {
            root = await ctx.app.boards.createDemoBoard("Demo", dir);
            ctx.expect(typeof root).toBe("string");
            for (const relative of ["board-manifest.json", "index.html", "app.js"]) {
                ctx.expect(await ctx.app.fs.exists(`${root}/${relative}`)).toBe(true);
            }
            ctx.expect((await ctx.app.boards.list()).find((board) => sameRoot(board.root, root)).trusted).toBe(true);
            page = await openBoardPage(ctx, root);
            ctx.expect(await page.editor.evaluate("() => document.querySelector('h1')?.innerText")).toBe("Persephone Boards");
        } finally {
            await cleanupBoard(ctx, root, page?.id, dir);
        }
    }),

    test("openBoard opens a tab once and reuses it; list reports root, trust, and page ids", async (ctx) => {
        const root = fixtureBoard(ctx, FOREIGN_BOARD);
        let pageId;
        try {
            await resetBoardFile(ctx, root, "index.html", FIXTURE_INDEX);
            await trustFixtureBoard(ctx, root);
            const before = await ctx.app.pages.all;
            await ctx.app.boards.openBoard(root);
            pageId = await ctx.app.pages.activePage.id;
            if (!sameRoot(await ctx.app.pages[pageId].editor.boardRoot, root)) pageId = await findBoardPage(ctx, root);
            ctx.expect(pageId !== null && pageId !== undefined).toBe(true);
            ctx.expect(before.some((page) => page.id === pageId)).toBe(false);
            ctx.expect(await ctx.app.pages.activePage.id).toBe(pageId);
            await ctx.app.boards.openBoard(root);
            ctx.expect(await ctx.app.pages.activePage.id).toBe(pageId);
            const listing = (await ctx.app.boards.list()).find((board) => sameRoot(board.root, root));
            ctx.expect(listing.name).toBe("US-2091 Foreign Fixture");
            ctx.expect(listing.trusted).toBe(true);
            ctx.expect(listing.openPageIds).toEqual([pageId]);
            ctx.expect(Object.hasOwn(listing, "installed")).toBe(false);
            ctx.expect(Object.hasOwn(listing, "service")).toBe(false);
            ctx.expect(Object.hasOwn(listing, "deprecationNote")).toBe(false);
        } finally {
            if (!pageId) {
                try { pageId = await findBoardPage(ctx, root); } catch { /* the page may already be gone */ }
            }
            await closeBoardPage(ctx, pageId);
            await untrustBoard(ctx, root);
        }
    }),

    test("reload reads updated board HTML from disk", async (ctx) => {
        const root = fixtureBoard(ctx, FOREIGN_BOARD);
        let page;
        try {
            await resetBoardFile(ctx, root, "index.html", FIXTURE_INDEX);
            await trustFixtureBoard(ctx, root);
            page = await openBoardPage(ctx, root);
            const replacement = FIXTURE_INDEX.replace("US-2091 fixture marker", "US-2091 reloaded marker");
            await resetBoardFile(ctx, root, "index.html", replacement);
            const result = await page.editor.reload();
            ctx.expect(result.refreshed).toBe(true);
            ctx.expect(result.frameReady).toBe(true);
            ctx.expect(await page.editor.evaluate("() => document.querySelector('#fixture-ready')?.innerText")).toBe("US-2091 reloaded marker");
        } finally {
            await closeBoardPage(ctx, page?.id);
            await untrustBoard(ctx, root);
        }
    }),

    test("edit and reload a blank board to run its starter backend", async (ctx) => {
        const dir = await prepareWork(ctx, "starter-backend");
        let root;
        let page;
        try {
            root = await ctx.app.boards.createBoard("Blank", dir);
            page = await openBoardPage(ctx, root);
            await page.editor.click("#run");
            const localOutput = await page.editor.evaluate("() => ({ shown: document.querySelector('#out')?.innerText, expected: window.persephone.i18n.t('starter.result') })");
            ctx.expect(localOutput.shown).toBe(localOutput.expected);

            const wiredApp = `document.body.dataset.lifecycleBackendWired = "yes";
const t = (key, params) => persephone.i18n.t(key, params);
const out = document.getElementById("out");
document.title = t("starter.title");
document.querySelector("h1").textContent = t("starter.title");
document.querySelector("body > p").textContent = t("starter.description");
document.getElementById("run").textContent = t("starter.run");
out.textContent = t("starter.output");
document.getElementById("run").addEventListener("click", async () => {
    const result = await persephone.execute("node scripts/hello.js").getJson(/@@RESULT@@(.*)/);
    out.textContent = JSON.stringify(result);
});
`;
            await resetBoardFile(ctx, root, "app.js", wiredApp);
            const manifest = JSON.parse(await ctx.callText("fs.read", [`${root}/board-manifest.json`]));
            manifest.permissions.execute = true;
            await resetBoardFile(ctx, root, "board-manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
            await ctx.call(`pages[${JSON.stringify(page.id)}].editor.reload`, [], { dialog: true });
            await waitForBoardDialog(ctx, "Board permissions changed");
            await ctx.call("dialogs[0].click", ["Accept"], { dialog: true });
            // Accepting reloads the board, but a frame read issued while that reload tears the old frame
            // down can block for the whole wait (seen in full runs). Reload once more through the facade,
            // which resolves only when the new frame is ready, then read it.
            await ctx.waitFor(`pages[${JSON.stringify(page.id)}].editor.frameReady`, (value) => value === true, { timeout: 15000 });
            // reload() rejects fast with "frame not ready" while the accept-triggered load is running.
            const reloaded = await ctx.waitFor(
                async () => { try { return await page.editor.reload(); } catch { return null; } },
                (value) => value?.frameReady === true,
                { timeout: 15000 },
            );
            ctx.expect(reloaded.frameReady).toBe(true);
            ctx.expect(await page.editor.evaluate("() => document.body.dataset.lifecycleBackendWired")).toBe("yes");
            await page.editor.click("#run");
            // The backend runs asynchronously; wait until the output holds its JSON result.
            const result = await ctx.waitFor(
                async () => { try { return await page.editor.evaluate("() => { try { return JSON.parse(document.querySelector('#out').innerText); } catch { return null; } }"); } catch { return null; } },
                (value) => value !== null && typeof value === "object",
                { timeout: 15000 },
            );
            ctx.expect(result.ok).toBe(true);
            ctx.expect(result.messageKey).toBe("starter.result");
            ctx.expect(new Date(result.ts).toISOString()).toBe(result.ts);
        } finally {
            await closeBoardPage(ctx, page?.id);
            await untrustBoard(ctx, root);
            await removeWork(ctx, dir);
        }
    }),

    test("renameBoard moves the folder and keeps its open page attached", async (ctx) => {
        const dir = await prepareWork(ctx, "rename-board");
        let root;
        let page;
        try {
            root = await ctx.app.boards.createBoard("Blank", dir);
            page = await openBoardPage(ctx, root);
            const oldRoot = root;
            root = await ctx.app.boards.renameBoard(root, "Renamed");
            ctx.expect(await ctx.app.fs.exists(oldRoot)).toBe(false);
            ctx.expect(await ctx.app.fs.exists(root)).toBe(true);
            const listing = (await ctx.app.boards.list()).find((board) => sameRoot(board.root, root));
            ctx.expect(listing.trusted).toBe(true);
            ctx.expect(listing.openPageIds).toContain(page.id);
            ctx.expect(sameRoot(await ctx.app.pages[page.id].editor.boardRoot, root)).toBe(true);
            // A rename reloads the board frame; wait for the reloaded frame instead of reading it mid-reload.
            ctx.expect(await ctx.waitFor(`pages[${JSON.stringify(page.id)}].editor.frameReady`, (value) => value === true, { timeout: 15000 })).toBe(true);
        } finally {
            await cleanupBoard(ctx, root, page?.id, dir);
        }
    }),

    test("unregisterBoard removes trust and its pin", async (ctx) => {
        const dir = await prepareWork(ctx, "unregister-board");
        let root;
        let page;
        let previousCategories;
        try {
            root = await ctx.app.boards.createBoard("Blank", dir);
            page = await openBoardPage(ctx, root);
            previousCategories = await ctx.app.settings.get("editor-categories");
            const categories = structuredClone(previousCategories);
            const top = categories.find((category) => category.name === "Top") ?? categories[0];
            top.items.push(`board:${root}`);
            await ctx.app.settings.set("editor-categories", categories);
            await ctx.app.boards.unregisterBoard(root);
            ctx.expect((await ctx.app.boards.list()).some((board) => sameRoot(board.root, root))).toBe(false);
            const updatedCategories = await ctx.app.settings.get("editor-categories");
            ctx.expect(updatedCategories.some((category) => category.items.includes(`board:${root}`))).toBe(false);
            const remainingPage = (await ctx.app.pages.all).find((candidate) => candidate.id === page.id);
            ctx.expect(Boolean(remainingPage?.editor === "board-view" || remainingPage?.editor?.startsWith("board-editor:"))).toBe(false);
        } finally {
            if (previousCategories !== undefined) {
                try { await ctx.app.settings.set("editor-categories", previousCategories); } catch { /* cleanup must not hide the test result */ }
            }
            await closeBoardPage(ctx, page?.id);
            await untrustBoard(ctx, root);
            await removeWork(ctx, dir);
        }
    }),

    test("registerBoard trusts the foreign work-copy fixture through Trust Board and then opens it", async (ctx) => {
        const root = fixtureBoard(ctx, FOREIGN_BOARD);
        let page;
        try {
            await resetBoardFile(ctx, root, "index.html", FIXTURE_INDEX);
            await ctx.call("boards.registerBoard", [root], { dialog: true });
            await waitForBoardDialog(ctx, "Trust this board?");
            ctx.expect(await ctx.call("dialogs[0].permissions", [], { dialog: true })).toEqual({
                kind: "flags",
                flags: {
                    execute: false, service: false, fileSystem: false, openExternal: false,
                    appScripting: false, network: false, clipboardRead: false, camera: false,
                    microphone: false, computerAudio: false, geolocation: false,
                    notifications: false, themes: false,
                },
            });
            ctx.expect(await ctx.call("dialogs[0].buttons", [], { dialog: true })).toEqual(["Cancel", "Trust Board"]);
            await ctx.call("dialogs[0].click", ["Trust Board"], { dialog: true });
            await ctx.waitFor(
                (active) => active.app.boards.list(),
                (boards) => boards.some((board) => sameRoot(board.root, root) && board.trusted),
                { timeout: 10000 },
            );
            page = await openBoardPage(ctx, root);
            ctx.expect(await page.editor.evaluate("() => document.querySelector('#fixture-ready')?.innerText")).toBe("US-2091 fixture marker");
        } finally {
            await closeBoardPage(ctx, page?.id);
            await untrustBoard(ctx, root);
        }
    }),

    test("openBoardWindow opens and reuses a trusted board window", async (ctx) => {
        const dir = await prepareWork(ctx, "open-board-window");
        let root;
        let windowIndex;
        try {
            root = await ctx.app.boards.createBoard("Blank", dir);
            const beforeCount = await ctx.call("windows.count");
            await ctx.app.boards.openBoardWindow(root);
            const count = await ctx.waitFor("windows.count", (value) => value > beforeCount, { timeout: 15000 });
            windowIndex = count - 1;
            const pages = await ctx.call(`windows[${windowIndex}].pages.all`);
            const boardPage = pages.find((candidate) => candidate.editor === "board-view" || candidate.editor?.startsWith("board-editor:"));
            ctx.expect(boardPage !== undefined).toBe(true);
            ctx.expect(sameRoot(await ctx.call(`windows[${windowIndex}].pages[${JSON.stringify(boardPage.id)}].editor.boardRoot`), root)).toBe(true);
            await ctx.app.boards.openBoardWindow(root);
            ctx.expect(await ctx.call("windows.count")).toBe(count);
            const reusedPages = await ctx.call(`windows[${windowIndex}].pages.all`);
            ctx.expect(reusedPages.some((candidate) => candidate.id === boardPage.id)).toBe(true);
            ctx.expect(sameRoot(await ctx.call(`windows[${windowIndex}].pages[${JSON.stringify(boardPage.id)}].editor.boardRoot`), root)).toBe(true);
        } finally {
            if (windowIndex !== undefined) {
                try { await ctx.call(`windows[${windowIndex}].window.close`); } catch { /* window may already be closed */ }
            }
            await untrustBoard(ctx, root);
            await removeWork(ctx, dir);
        }
    }),

    test("openBoardWindow rejects an untrusted fixture without opening a dialog", async (ctx) => {
        const root = fixtureBoard(ctx, FOREIGN_BOARD);
        const beforeCount = await ctx.call("windows.count");
        try {
            await resetBoardFile(ctx, root, "index.html", FIXTURE_INDEX);
            let errorText = "";
            try { await ctx.app.boards.openBoardWindow(root); } catch (error) { errorText = String(error); }
            ctx.expect(errorText).toContain("Board is not trusted");
            ctx.expect(await ctx.call("windows.count")).toBe(beforeCount);
            let dialogTitle = null;
            try { dialogTitle = await ctx.callText("dialogs[0].title", [], { dialog: true }); } catch { /* no dialog exists */ }
            ctx.expect(dialogTitle).toBe(null);
            const listing = (await ctx.app.boards.list()).find((board) => sameRoot(board.root, root));
            ctx.expect(listing?.trusted ?? false).toBe(false);
        } finally {
            await untrustBoard(ctx, root);
        }
    }),

    test("createShortcut writes to the explicit fixture path and refuses overwrite by default", async (ctx) => {
        const dir = await prepareWork(ctx, "create-shortcut");
        let root;
        try {
            root = await ctx.app.boards.createBoard("Blank", dir);
            const linkPath = `${dir}/test-shortcut.lnk`;
            const created = await ctx.app.boards.createShortcut(root, { linkPath });
            ctx.expect(sameRoot(created?.linkPath, linkPath)).toBe(true);
            ctx.expect(await ctx.app.fs.exists(linkPath)).toBe(true);
            let errorText = "";
            try { await ctx.app.boards.createShortcut(root, { linkPath }); } catch (error) { errorText = String(error); }
            ctx.expect(/already exists|overwrite/i.test(errorText)).toBe(true);
            ctx.expect(await ctx.app.fs.exists(linkPath)).toBe(true);
        } finally {
            await cleanupBoard(ctx, root, null, dir);
        }
    }),
];
