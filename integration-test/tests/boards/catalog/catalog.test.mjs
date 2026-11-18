import path from "node:path";
import { test } from "../../../lib/context.mjs";
import { closeBoardPage, openBoardPage, trustFixtureBoard, untrustBoard, waitForBoardDialog } from "../helpers.mjs";

const CATALOG_BASE = "http://127.0.0.1:17867/boards-catalog";
const VERSIONED_ID = "us2095-versioned";
const BAD_SHA_ID = "us2095-bad-sha";

async function refreshCatalog(ctx) {
    return ctx.app.boards.checkPublishedUpdates(true);
}

async function removeWork(ctx, dir) {
    if (!dir) return;
    try { await ctx.app.fs.removeDir(dir, true); } catch { /* cleanup must not hide the test result */ }
}

async function findInstalledRoot(ctx, id) {
    const entries = await ctx.app.boards.list();
    return entries.find((entry) => entry.installed?.id === id)?.root ?? null;
}

async function cleanupInstall(ctx, id, pageIds = [], root) {
    for (const pageId of pageIds) await closeBoardPage(ctx, pageId);
    try {
        const installedRoot = await findInstalledRoot(ctx, id);
        if (!installedRoot) return;
        root = installedRoot;
        const uninstall = ctx.app.boards.uninstallBoard(id);
        uninstall.then(undefined, () => {});
        await waitForDeleteConfirmation(ctx);
        await ctx.call("dialogs[0].click", ["Delete"], { dialog: true });
        await uninstall;
    } catch {
        // Cleanup is best-effort if the install or confirmation has already disappeared.
    }
}

async function waitForDeleteConfirmation(ctx) {
    await ctx.waitFor(
        (active) => active.call("dialogs[0].buttons", undefined, { dialog: true }).catch(() => null),
        (buttons) => Array.isArray(buttons) && buttons.includes("Delete"),
        { timeout: 10000 },
    );
}

async function showDialogAndClick(ctx, pending, title, button) {
    pending.then(undefined, () => {});
    await waitForBoardDialog(ctx, title);
    await ctx.call("dialogs[0].click", [button], { dialog: true });
    return pending;
}

function installedSearchEntry(entries, id) {
    return entries.find((entry) => entry.id === id);
}

export default [
    test("searches the fake catalog and annotates uninstalled compatible boards", async (ctx) => {
        await refreshCatalog(ctx);
        const all = await ctx.app.boards.searchPublished();
        const versioned = await ctx.app.boards.searchPublished("versioned");

        ctx.expect(all.map((entry) => entry.id).sort()).toEqual([BAD_SHA_ID, VERSIONED_ID]);
        for (const entry of all) {
            ctx.expect(entry.compatible).toBe(true);
            ctx.expect(entry.installed).toBe(false);
            ctx.expect(entry.updateAvailable).toBe(false);
        }
        ctx.expect(versioned.map((entry) => entry.id)).toEqual([VERSIONED_ID]);
    }, { requires: ["launch"] }),

    test("lists version history newest first with compatibility and unknown id empty", async (ctx) => {
        await refreshCatalog(ctx);
        const versions = await ctx.app.boards.getPublishedVersions(VERSIONED_ID);
        const unknown = await ctx.app.boards.getPublishedVersions("unknown-id");

        ctx.expect(versions.map((entry) => entry.version)).toEqual(["99.0.0", "1.1.0", "1.0.0"]);
        ctx.expect(versions.map((entry) => entry.compatible)).toEqual([false, true, true]);
        ctx.expect(versions.every((entry) => entry.installed === false)).toBe(true);
        ctx.expect(unknown).toEqual([]);
    }, { requires: ["launch"] }),

    test("downloads latest version inertly and records its install", async (ctx) => {
        const dir = ctx.fixture("boards/catalog-work/download-latest");
        const root = path.join(dir, VERSIONED_ID);
        try {
            await refreshCatalog(ctx);
            ctx.expect(await ctx.app.boards.downloadPublished(VERSIONED_ID, { dir })).toBe(root);
            ctx.expect(await ctx.callText("fs.read", [`${root}/index.html`])).toContain("US-2095 marker: v1.1.0");
            const search = installedSearchEntry(await ctx.app.boards.searchPublished("versioned"), VERSIONED_ID);
            ctx.expect({ installed: search.installed, version: search.installedVersion, updateAvailable: search.updateAvailable }).toEqual({ installed: true, version: "1.1.0", updateAvailable: false });
            const listing = (await ctx.app.boards.list()).find((entry) => entry.installed?.id === VERSIONED_ID);
            ctx.expect(listing.installed.version).toBe("1.1.0");
            ctx.expect(listing.trusted).toBe(false);
        } finally {
            await cleanupInstall(ctx, VERSIONED_ID, [], root);
            await removeWork(ctx, dir);
        }
    }, { requires: ["launch"] }),

    test("downloads a requested older version", async (ctx) => {
        const dir = ctx.fixture("boards/catalog-work/download-version");
        const root = path.join(dir, VERSIONED_ID);
        try {
            await refreshCatalog(ctx);
            ctx.expect(await ctx.app.boards.downloadPublished(VERSIONED_ID, { dir, version: "1.0.0" })).toBe(root);
            ctx.expect(await ctx.callText("fs.read", [`${root}/index.html`])).toContain("US-2095 marker: v1.0.0");
            const search = installedSearchEntry(await ctx.app.boards.searchPublished("versioned"), VERSIONED_ID);
            ctx.expect(search.installedVersion).toBe("1.0.0");
            const listing = (await ctx.app.boards.list()).find((entry) => entry.installed?.id === VERSIONED_ID);
            ctx.expect(listing.installed.version).toBe("1.0.0");
        } finally {
            await cleanupInstall(ctx, VERSIONED_ID, [], root);
            await removeWork(ctx, dir);
        }
    }, { requires: ["launch"] }),

    test("refuses an incompatible requested version without leaving files", async (ctx) => {
        const dir = ctx.fixture("boards/catalog-work/incompatible-version");
        const root = path.join(dir, VERSIONED_ID);
        try {
            await refreshCatalog(ctx);
            let errorText = "";
            try { await ctx.app.boards.downloadPublished(VERSIONED_ID, { dir, version: "99.0.0" }); } catch (error) { errorText = String(error); }
            ctx.expect(errorText).toContain("requires Persephone");
            ctx.expect(errorText).toContain("99.0.0");
            ctx.expect(await ctx.app.fs.exists(root)).toBe(false);
            ctx.expect(installedSearchEntry(await ctx.app.boards.searchPublished("versioned"), VERSIONED_ID)?.installed ?? false).toBe(false);
        } finally {
            await cleanupInstall(ctx, VERSIONED_ID, [], root);
            await removeWork(ctx, dir);
        }
    }, { requires: ["launch"] }),

    test("rejects the bad checksum without extracting or recording the board", async (ctx) => {
        const dir = ctx.fixture("boards/catalog-work/bad-sha");
        const root = path.join(dir, BAD_SHA_ID);
        try {
            await refreshCatalog(ctx);
            let errorText = "";
            try { await ctx.app.boards.downloadPublished(BAD_SHA_ID, { dir }); } catch (error) { errorText = String(error); }
            ctx.expect(errorText).toContain("Checksum mismatch");
            ctx.expect(await ctx.app.fs.exists(root)).toBe(false);
            ctx.expect(installedSearchEntry(await ctx.app.boards.searchPublished("bad sha"), BAD_SHA_ID)?.installed ?? false).toBe(false);
            ctx.expect((await ctx.app.boards.list()).some((entry) => entry.installed?.id === BAD_SHA_ID)).toBe(false);
        } finally {
            await cleanupInstall(ctx, BAD_SHA_ID, [], root);
            await removeWork(ctx, dir);
        }
    }, { requires: ["launch"] }),

    test("installs through Board Info and exposes its published versions and screenshot", async (ctx) => {
        const dir = ctx.fixture("boards/catalog-work/board-info-install");
        let install;
        let infoPageId;
        let boardPageId;
        let root;
        try {
            await refreshCatalog(ctx);
            install = ctx.app.boards.installPublished(VERSIONED_ID, { dir });
            install.then(undefined, () => {});
            const pageIdFound = await ctx.waitFor(
                async (active) => {
                    const pages = await active.app.pages.all;
                    const page = pages.find((candidate) => candidate.editor === "board-info");
                    return page?.id ?? null;
                },
                Boolean,
                { timeout: 15000 },
            );
            infoPageId = pageIdFound;
            const editor = ctx.app.pages[infoPageId].editor;
            await ctx.app.pages.showPage(infoPageId);
            await ctx.waitFor("pages.activePage.id", (id) => id === infoPageId, { timeout: 10000 });
            const match = await ctx.waitFor(
                `pages[${JSON.stringify(infoPageId)}].editor.matches`,
                (matches) => matches.some((entry) => entry.id === VERSIONED_ID),
                { timeout: 15000 },
            );
            const selected = match.find((entry) => entry.id === VERSIONED_ID);
            ctx.expect(selected.screenshotUrl).toBe(`${CATALOG_BASE}/boards/${VERSIONED_ID}/catalog.svg`);
            await ctx.waitFor(
                () => ctx.call("window.screen.evaluate", ["() => document.querySelector('[data-type=board-screenshot] img')?.currentSrc ?? null"]),
                (url) => url === selected.screenshotUrl,
                { timeout: 15000 },
            );
            await ctx.app.window.screen.waitFor({ selector: '[data-name="board-info-download"]' });
            await ctx.app.window.screen.click('[data-name="board-info-download"]');
            await ctx.waitFor(
                `pages[${JSON.stringify(infoPageId)}].editor.matches`,
                (matches) => matches.find((entry) => entry.id === VERSIONED_ID)?.installState === "downloaded",
                { timeout: 30000 },
            );
            await ctx.app.window.screen.waitFor({ selector: '[data-name="board-info-register"]' });
            await ctx.app.window.screen.click('[data-name="board-info-register"]');
            await waitForBoardDialog(ctx, "Trust this board?");
            await ctx.call("dialogs[0].click", ["Trust Board"], { dialog: true });
            root = await install;
            await ctx.waitFor(
                `pages[${JSON.stringify(infoPageId)}].editor.versionsState`,
                (state) => state === "idle",
                { timeout: 15000 },
            );
            const versions = await editor.versions;
            ctx.expect(versions.map((entry) => entry.version)).toEqual(["99.0.0", "1.1.0", "1.0.0"]);
            ctx.expect(versions.map((entry) => entry.compatible)).toEqual([false, true, true]);
            ctx.expect(versions.find((entry) => entry.version === "1.1.0").installed).toBe(true);
            const page = await openBoardPage(ctx, root);
            boardPageId = page.id;
            ctx.expect(await page.editor.evaluate("() => document.body.innerText")).toContain("US-2095 marker: v1.1.0");
        } finally {
            await cleanupInstall(ctx, VERSIONED_ID, [infoPageId, boardPageId].filter(Boolean), root);
            await untrustBoard(ctx, root);
            await removeWork(ctx, dir);
        }
    }, { requires: ["launch"] }),

    test("rolls back then updates an open installed board and refreshes update state", async (ctx) => {
        const dir = ctx.fixture("boards/catalog-work/rollback-update");
        const root = path.join(dir, VERSIONED_ID);
        let page;
        try {
            await refreshCatalog(ctx);
            await ctx.app.boards.downloadPublished(VERSIONED_ID, { dir });
            await trustFixtureBoard(ctx, root);
            page = await openBoardPage(ctx, root);
            await refreshCatalog(ctx);
            let search = installedSearchEntry(await ctx.app.boards.searchPublished("versioned"), VERSIONED_ID);
            ctx.expect(search.installedVersion).toBe("1.1.0");
            ctx.expect(search.updateAvailable).toBe(false);

            let rollback = ctx.app.boards.installPublished(VERSIONED_ID, { version: "1.0.0" });
            await showDialogAndClick(ctx, rollback, "Board is open", "Close board & continue");
            ctx.expect(await rollback).toBe(root);
            page = null;
            ctx.expect(await ctx.callText("fs.read", [`${root}/index.html`])).toContain("US-2095 marker: v1.0.0");
            search = installedSearchEntry(await ctx.app.boards.searchPublished("versioned"), VERSIONED_ID);
            ctx.expect(search.installedVersion).toBe("1.0.0");
            ctx.expect(search.updateAvailable).toBe(true);
            ctx.expect(search.version).toBe("1.1.0");
            page = await openBoardPage(ctx, root);
            ctx.expect(await page.editor.evaluate("() => document.body.innerText")).toContain("US-2095 marker: v1.0.0");

            let update = ctx.app.boards.installPublished(VERSIONED_ID, { version: "1.1.0" });
            await showDialogAndClick(ctx, update, "Board is open", "Close board & continue");
            ctx.expect(await update).toBe(root);
            page = null;
            ctx.expect(await ctx.callText("fs.read", [`${root}/index.html`])).toContain("US-2095 marker: v1.1.0");
            page = await openBoardPage(ctx, root);
            ctx.expect(await page.editor.evaluate("() => document.body.innerText")).toContain("US-2095 marker: v1.1.0");
            await refreshCatalog(ctx);
            search = installedSearchEntry(await ctx.app.boards.searchPublished("versioned"), VERSIONED_ID);
            ctx.expect(search.installedVersion).toBe("1.1.0");
            ctx.expect(search.updateAvailable).toBe(false);
        } finally {
            await cleanupInstall(ctx, VERSIONED_ID, page ? [page.id] : [], root);
            await untrustBoard(ctx, root);
            await removeWork(ctx, dir);
        }
    }, { requires: ["launch"] }),

    test("cancelling catalog uninstall keeps the board and all registrations", async (ctx) => {
        const dir = ctx.fixture("boards/catalog-work/uninstall-cancel");
        const root = path.join(dir, VERSIONED_ID);
        let previousCategories;
        try {
            await refreshCatalog(ctx);
            await ctx.app.boards.downloadPublished(VERSIONED_ID, { dir });
            await trustFixtureBoard(ctx, root);
            previousCategories = await ctx.app.settings.get("editor-categories");
            const categories = structuredClone(previousCategories);
            const top = categories.find((category) => category.name === "Top") ?? categories[0];
            top.items.push(`board:${root}`);
            await ctx.app.settings.set("editor-categories", categories);

            const uninstall = ctx.app.boards.uninstallBoard(VERSIONED_ID);
            uninstall.then(undefined, () => {});
            await waitForDeleteConfirmation(ctx);
            await ctx.call("dialogs[0].click", ["Cancel"], { dialog: true });
            ctx.expect(await uninstall).toBe(false);
            ctx.expect(await ctx.app.fs.exists(root)).toBe(true);
            ctx.expect((await ctx.app.boards.list()).find((entry) => entry.installed?.id === VERSIONED_ID)?.trusted).toBe(true);
            ctx.expect((await ctx.app.settings.get("editor-categories")).some((category) => category.items.includes(`board:${root}`))).toBe(true);
            ctx.expect(installedSearchEntry(await ctx.app.boards.searchPublished("versioned"), VERSIONED_ID).installed).toBe(true);
        } finally {
            await cleanupInstall(ctx, VERSIONED_ID, [], root);
            await untrustBoard(ctx, root);
            if (previousCategories !== undefined) {
                try { await ctx.app.settings.set("editor-categories", previousCategories); } catch { /* cleanup must not hide the test result */ }
            }
            await removeWork(ctx, dir);
        }
    }, { requires: ["launch"] }),

    test("confirming catalog uninstall removes files trust pin and install record", async (ctx) => {
        const dir = ctx.fixture("boards/catalog-work/uninstall-confirm");
        const root = path.join(dir, VERSIONED_ID);
        let previousCategories;
        try {
            await refreshCatalog(ctx);
            await ctx.app.boards.downloadPublished(VERSIONED_ID, { dir });
            await trustFixtureBoard(ctx, root);
            previousCategories = await ctx.app.settings.get("editor-categories");
            const categories = structuredClone(previousCategories);
            const top = categories.find((category) => category.name === "Top") ?? categories[0];
            top.items.push(`board:${root}`);
            await ctx.app.settings.set("editor-categories", categories);

            const uninstall = ctx.app.boards.uninstallBoard(VERSIONED_ID);
            uninstall.then(undefined, () => {});
            await waitForDeleteConfirmation(ctx);
            await ctx.call("dialogs[0].click", ["Delete"], { dialog: true });
            ctx.expect(await uninstall).toBe(true);
            ctx.expect(await ctx.app.fs.exists(root)).toBe(false);
            ctx.expect((await ctx.app.boards.list()).some((entry) => entry.installed?.id === VERSIONED_ID)).toBe(false);
            ctx.expect((await ctx.app.boards.list()).some((entry) => entry.trusted && entry.root === root)).toBe(false);
            ctx.expect((await ctx.app.settings.get("editor-categories")).some((category) => category.items.includes(`board:${root}`))).toBe(false);
            ctx.expect(installedSearchEntry(await ctx.app.boards.searchPublished("versioned"), VERSIONED_ID).installed).toBe(false);
        } finally {
            await cleanupInstall(ctx, VERSIONED_ID, [], root);
            await untrustBoard(ctx, root);
            if (previousCategories !== undefined) {
                try { await ctx.app.settings.set("editor-categories", previousCategories); } catch { /* cleanup must not hide the test result */ }
            }
            await removeWork(ctx, dir);
        }
    }, { requires: ["launch"] }),
];
