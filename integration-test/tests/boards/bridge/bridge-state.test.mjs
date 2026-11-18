import { test } from "../../../lib/context.mjs";
import { closeBoardPage, fixtureBoard, openBoardPage, resetBoardFile, trustFixtureBoard, untrustBoard } from "../../helpers/boards.mjs";

const BOARD = "bridge/bridge-board";
const SETTING_SECTION = (namespace) => `[data-name="settings-section-board-${encodeURIComponent(namespace)}"]`;

async function waitUntilActionable(ctx, selector) {
    const expression = `() => {
        const target = document.querySelector(${JSON.stringify(selector)});
        if (!(target instanceof HTMLElement) || target.disabled || target.getClientRects().length === 0) return false;
        const rect = target.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return hit === target || target.contains(hit);
    }`;
    await ctx.waitFor((active) => active.app.window.screen.evaluate(expression), (value) => value === true);
}

async function selectBoardSettings(ctx, namespace) {
    const settingsSelector = SETTING_SECTION(namespace);
    await ctx.app.pages.showSettingsPage();
    await ctx.waitFor((active) => active.app.pages.all, (pages) => pages.some((page) => page.editor === "settings-view"));
    await ctx.app.window.screen.click(settingsSelector);
    return settingsSelector;
}

async function resetMode(ctx, namespace) {
    const section = await selectBoardSettings(ctx, namespace);
    const resetSelector = `${section} button[data-type="button"]`;
    await waitUntilActionable(ctx, resetSelector);
    await ctx.app.window.screen.click(resetSelector);
}

async function closeSettingsIfNew(ctx, before) {
    try {
        const after = await ctx.app.pages.all;
        const opened = after.filter((page) => page.editor === "settings-view" && !before.some((old) => old.id === page.id));
        for (const page of opened) await ctx.app.pages.closePage(page.id);
    } catch { /* Cleanup must not mask the test result. */ }
}

export default [
    test("shared storage round-trips JSON and supports listing and deletion", async (ctx) => {
        const root = fixtureBoard(ctx, BOARD);
        const key = "us2093-bridge-storage-fixture";
        let page;
        try {
            await trustFixtureBoard(ctx, root);
            page = await openBoardPage(ctx, root);
            await page.editor.evaluate(`() => window.persephone.storage.delete(${JSON.stringify(key)})`);
            const result = await page.editor.evaluate(`async () => {
                const key = ${JSON.stringify(key)};
                await window.persephone.storage.set(key, { label: "fixture", count: 2 });
                const value = await window.persephone.storage.get(key);
                const beforeDelete = await window.persephone.storage.keys();
                const deleted = await window.persephone.storage.delete(key);
                const afterDelete = await window.persephone.storage.get(key);
                return { value, beforeDelete, deleted, afterDelete: afterDelete ?? null };
            }`);
            ctx.expect(result.value).toEqual({ label: "fixture", count: 2 });
            ctx.expect(result.beforeDelete).toContain(key);
            ctx.expect(result.deleted).toBe(true);
            ctx.expect(result.afterDelete).toBe(null);
        } finally {
            if (page?.editor) {
                try { await page.editor.evaluate(`() => window.persephone.storage.delete(${JSON.stringify(key)})`); } catch { /* Best-effort key cleanup. */ }
            }
            await closeBoardPage(ctx, page?.id);
            await untrustBoard(ctx, root);
        }
    }),

    test("board setting reads its manifest default", async (ctx) => {
        const root = fixtureBoard(ctx, BOARD);
        const namespace = await ctx.app.boardVars.namespaceFor(root);
        const pagesBefore = await ctx.app.pages.all;
        let page;
        try {
            await trustFixtureBoard(ctx, root);
            await resetMode(ctx, namespace);
            page = await openBoardPage(ctx, root);
            ctx.expect(await page.editor.evaluate("async () => await window.persephone.settings.get('mode')")).toBe("fixture-default");
        } finally {
            try { await resetMode(ctx, namespace); } catch { /* Cleanup must not mask the test result. */ }
            await closeBoardPage(ctx, page?.id);
            await untrustBoard(ctx, root);
            await closeSettingsIfNew(ctx, pagesBefore);
        }
    }),

    test("app-side board setting changes notify the board frame", async (ctx) => {
        const root = fixtureBoard(ctx, BOARD);
        const namespace = await ctx.app.boardVars.namespaceFor(root);
        const pagesBefore = await ctx.app.pages.all;
        let page;
        try {
            await trustFixtureBoard(ctx, root);
            await resetMode(ctx, namespace);
            page = await openBoardPage(ctx, root);
            const section = await selectBoardSettings(ctx, namespace);
            const inputSelector = `${section} [data-name="board-setting-mode"] input`;
            await waitUntilActionable(ctx, inputSelector);
            await ctx.app.window.screen.type(inputSelector, "fixture-changed");
            await page.editor.waitFor({ text: "fixture-changed" });
            const notification = await page.editor.evaluate("() => JSON.parse(document.querySelector('#result').innerText)");
            ctx.expect(notification).toEqual({ id: "mode", value: "fixture-changed" });
            ctx.expect(await page.editor.evaluate("async () => await window.persephone.settings.get('mode')")).toBe("fixture-changed");
        } finally {
            try { await resetMode(ctx, namespace); } catch { /* Cleanup must not mask the test result. */ }
            await closeBoardPage(ctx, page?.id);
            await untrustBoard(ctx, root);
            await closeSettingsIfNew(ctx, pagesBefore);
        }
    }),

    test("reset returns a board setting to its manifest default", async (ctx) => {
        const root = fixtureBoard(ctx, BOARD);
        const namespace = await ctx.app.boardVars.namespaceFor(root);
        const pagesBefore = await ctx.app.pages.all;
        let page;
        try {
            await trustFixtureBoard(ctx, root);
            await resetMode(ctx, namespace);
            page = await openBoardPage(ctx, root);
            const section = await selectBoardSettings(ctx, namespace);
            const inputSelector = `${section} [data-name="board-setting-mode"] input`;
            await waitUntilActionable(ctx, inputSelector);
            await ctx.app.window.screen.type(inputSelector, "fixture-override");
            await page.editor.waitFor({ text: "fixture-override" });
            ctx.expect(await page.editor.evaluate("async () => await window.persephone.settings.get('mode')")).toBe("fixture-override");
            const resetSelector = `${section} button[data-type="button"]`;
            await waitUntilActionable(ctx, resetSelector);
            await ctx.app.window.screen.click(resetSelector);
            await page.editor.waitFor({ text: "fixture-default" });
            ctx.expect(await page.editor.evaluate("async () => await window.persephone.settings.get('mode')")).toBe("fixture-default");
            const notification = await page.editor.evaluate("() => JSON.parse(document.querySelector('#result').innerText)");
            ctx.expect(notification).toEqual({ id: "mode", value: "fixture-default" });
        } finally {
            try { await resetMode(ctx, namespace); } catch { /* Cleanup must not mask the test result. */ }
            await closeBoardPage(ctx, page?.id);
            await untrustBoard(ctx, root);
            await closeSettingsIfNew(ctx, pagesBefore);
        }
    }),

    test("board language pack translates messages and falls back to the key", async (ctx) => {
        const root = fixtureBoard(ctx, BOARD);
        let page;
        try {
            await trustFixtureBoard(ctx, root);
            page = await openBoardPage(ctx, root);
            ctx.expect(await page.editor.evaluate("() => window.persephone.i18n.t('bridge.greeting', { name: 'Test' })")).toBe("Hello Test");
            ctx.expect(await page.editor.evaluate("() => window.persephone.i18n.t('bridge.missing')")).toBe("bridge.missing");
        } finally {
            await closeBoardPage(ctx, page?.id);
            await untrustBoard(ctx, root);
        }
    }),

    test("page-scoped state round-trips and removes a value", async (ctx) => {
        const root = fixtureBoard(ctx, BOARD);
        const key = "us2093-bridge-page-state";
        let page;
        try {
            await trustFixtureBoard(ctx, root);
            page = await openBoardPage(ctx, root);
            await page.editor.evaluate(`() => window.persephone.pageState.remove(${JSON.stringify(key)})`);
            const result = await page.editor.evaluate(`async () => {
                const key = ${JSON.stringify(key)};
                await window.persephone.pageState.set(key, "fixture-value");
                const beforeRemove = await window.persephone.pageState.get(key);
                await window.persephone.pageState.remove(key);
                const afterRemove = await window.persephone.pageState.get(key);
                return { beforeRemove, afterRemove: afterRemove ?? null };
            }`);
            ctx.expect(result).toEqual({ beforeRemove: "fixture-value", afterRemove: null });
        } finally {
            if (page?.editor) {
                try { await page.editor.evaluate(`() => window.persephone.pageState.remove(${JSON.stringify(key)})`); } catch { /* Best-effort state cleanup. */ }
            }
            await closeBoardPage(ctx, page?.id);
            await untrustBoard(ctx, root);
        }
    }),

    test("page visibility changes when the board is deactivated and reactivated", async (ctx) => {
        const root = fixtureBoard(ctx, BOARD);
        const secondPath = ctx.fixture("boards/bridge/visibility-second.txt");
        let page;
        let secondPageId;
        try {
            await resetBoardFile(ctx, root, "data/start.json", '{"value":"fixture-start"}\n');
            await trustFixtureBoard(ctx, root);
            page = await openBoardPage(ctx, root);
            const secondPage = await ctx.app.pages.openFile(secondPath);
            secondPageId = secondPage.id;
            await ctx.waitFor((active) => active.app.pages.all, (pages) => pages.some((entry) => entry.id === secondPageId));
            await page.editor.waitFor({ text: "false" });
            await ctx.app.pages.showPage(page.id);
            await page.editor.waitFor({ text: "true" });
            const visibility = await page.editor.evaluate("() => JSON.parse(document.querySelector('#result').innerText)");
            ctx.expect(visibility).toEqual({ visible: true });
        } finally {
            try { if (secondPageId) await ctx.app.pages.closePage(secondPageId); } catch { /* Cleanup must not mask the test result. */ }
            await closeBoardPage(ctx, page?.id);
            await untrustBoard(ctx, root);
        }
    }),
];
