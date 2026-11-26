import { test } from "../../../lib/context.mjs";
import { closePage } from "../../editors/helpers.mjs";

const HUB_ID = "tools-hub-page";
const HUB_EDITOR = "tools-hub-view";
const CLIPBOARD_PAGE_ID = "clipboard-page";
const SETTINGS_PAGE_ID = "settings-page";
const SETTINGS_EDITOR = "settings-view";

// Uncovered: the clipboard node has no copy-back, open, or listener-health methods. The UI covers
// Copy and opening rows; OS clipboard read-back is not asserted because the screen does not restore it.

async function resetFixture(ctx, relativePath) {
    const folder = ctx.fixture(relativePath);
    await ctx.app.fs.removeDir(folder, true);
    await ctx.app.fs.mkdir(folder);
    return folder;
}

async function removeFixture(ctx, folder) {
    try {
        await ctx.app.fs.removeDir(folder, true);
    } catch {
        // A missing fixture directory is already clean.
    }
}

async function openHub(ctx) {
    const pagesBefore = await ctx.app.pages.all;
    const existed = pagesBefore.some((page) => page.id === HUB_ID);
    const previousTab = existed ? await ctx.app.pages[HUB_ID].editor.activeTab : undefined;
    await ctx.app.pages.showToolsHubPage({ tab: "editors" });
    await ctx.waitFor(
        (activeContext) => activeContext.app.pages.all,
        (pages) => pages.some((page) => page.id === HUB_ID && page.editor === HUB_EDITOR),
    );
    return { existed, previousTab };
}

async function openClipboardPanel(ctx) {
    const ownership = await openHub(ctx);
    await ctx.app.window.screen.click('text="Clipboard"');
    await ctx.waitFor(
        (activeContext) => activeContext.app.window.screen.evaluate(
            '() => Boolean(document.querySelector(\'[data-name="clipboard-history"]\'))',
        ),
        Boolean,
    );
    return ownership;
}

async function restoreHub(ctx, ownership) {
    if (!ownership) return;
    if (ownership.existed) {
        try {
            if (ownership.previousTab) await ctx.app.pages[HUB_ID].editor.setTab(ownership.previousTab);
        } catch {
            // Preserve the test's original result if restoring the prior tab fails.
        }
    }
}

async function closeCreatedPages(ctx, initialPageIds) {
    try {
        const pages = await ctx.app.pages.all;
        for (const page of pages) {
            if (initialPageIds.has(page.id)) continue;
            try {
                await closePage(ctx, page.id);
            } catch {
                // Preserve the test's original result if a page cannot be closed.
            }
        }
    } catch {
        // Preserve the test's original result if page state is unavailable during cleanup.
    }
}

async function saveClipboardText(ctx) {
    return ctx.script("await navigator.clipboard.readText()");
}

async function restoreClipboardText(ctx, text) {
    if (typeof text !== "string") return;
    try {
        await ctx.script(`await navigator.clipboard.writeText(${JSON.stringify(text)});\ntrue;`);
    } catch {
        // Preserve the test's original result if the OS clipboard cannot be restored.
    }
}

async function captureText(ctx, text, options = {}) {
    await ctx.script(`await navigator.clipboard.writeText(${JSON.stringify(text)});\ntrue;`);
    return ctx.waitFor(
        (activeContext) => activeContext.app.clipboard.items,
        (items) => items.some((item) => item.primary === "text" && item.preview === text),
        options,
    );
}

async function prepareClipboardTest(ctx, folder) {
    await resetFixture(ctx, folder);
    await ctx.app.settings.set("clipboard.enabled", true);
    await ctx.waitFor(
        (activeContext) => activeContext.app.settings.get("clipboard.enabled"),
        (enabled) => enabled === true,
    );
    await ctx.app.clipboard.clear();
    const hubOwnership = await openClipboardPanel(ctx);
    await ctx.waitFor(
        (activeContext) => activeContext.app.window.screen.evaluate(
            '() => Boolean(document.querySelector(\'[data-name="clipboard-history"]\'))',
        ),
        Boolean,
    );
    return hubOwnership;
}

async function cleanupClipboardTest(ctx, folder, initialPageIds, previousClipboardText, hubOwnership) {
    try {
        await ctx.app.settings.set("clipboard.enabled", true);
    } catch {
        // Continue cleanup if the setting cannot be restored to an enabled state.
    }
    await restoreClipboardText(ctx, previousClipboardText);
    try {
        await ctx.app.clipboard.clear();
    } catch {
        // The call-tree node can be unavailable if setting restoration failed.
    }
    try {
        await ctx.app.settings.set("clipboard.enabled", false);
    } catch {
        // Preserve the test's original result if the setting cannot be restored.
    }
    await closeCreatedPages(ctx, initialPageIds);
    await restoreHub(ctx, hubOwnership);
    await removeFixture(ctx, folder);
}

function uniqueText(label) {
    return `US-2070 ${label} ${Date.now()} ${Math.random().toString(36).slice(2, 8)}`;
}

export default [
    test("Clipboard panel shows its disabled warning and opens Settings", async (ctx) => {
        const folder = ctx.fixture("us-2070/disabled-panel");
        const initialPageIds = new Set((await ctx.app.pages.all).map((page) => page.id));
        let hubOwnership;
        try {
            await resetFixture(ctx, "us-2070/disabled-panel");
            try {
                await ctx.app.clipboard.clear();
            } catch {
                // The clipboard node is unavailable while history is disabled.
            }
            await ctx.app.settings.set("clipboard.enabled", false);
            await ctx.waitFor(
                (activeContext) => activeContext.app.settings.get("clipboard.enabled"),
                (enabled) => enabled === false,
            );
            hubOwnership = await openClipboardPanel(ctx);
            await ctx.waitFor(
                (activeContext) => activeContext.app.window.screen.evaluate(
                    '() => Boolean(document.querySelector(\'[data-name="clipboard-unavailable"]\'))',
                ),
                Boolean,
            );
            const warningPresent = await ctx.app.window.screen.evaluate(
                '() => { const warning = document.querySelector(\'[data-name="clipboard-unavailable"]\'); return Boolean(warning && warning.textContent.trim()); }',
            );
            ctx.expect(warningPresent).toBe(true);

            await ctx.app.window.screen.click('[data-name="clipboard-open-settings"]');
            const pages = await ctx.waitFor(
                (activeContext) => activeContext.app.pages.all,
                (currentPages) => currentPages.some((page) => page.id === SETTINGS_PAGE_ID && page.editor === SETTINGS_EDITOR),
            );
            ctx.expect(pages.some((page) => page.id === SETTINGS_PAGE_ID && page.editor === SETTINGS_EDITOR)).toBe(true);
        } finally {
            await cleanupClipboardTest(ctx, folder, initialPageIds, undefined, hubOwnership);
        }
    }, { requires: ["windows"] }),

    test("Clipboard captures renderer text at the top of history and exposes it in the node", async (ctx) => {
        const folder = ctx.fixture("us-2070/capture");
        const initialPageIds = new Set((await ctx.app.pages.all).map((page) => page.id));
        const firstText = uniqueText("capture-first");
        const secondText = uniqueText("capture-second");
        let previousClipboardText;
        let hubOwnership;
        try {
            previousClipboardText = await saveClipboardText(ctx);
            hubOwnership = await prepareClipboardTest(ctx, "us-2070/capture");

            await captureText(ctx, firstText, { timeout: 30000 });
            const newestFirst = await captureText(ctx, secondText);
            ctx.expect(newestFirst[0].preview).toBe(secondText);
            ctx.expect(newestFirst[1].preview).toBe(firstText);
            const previewsVisible = await ctx.app.window.screen.evaluate(
                `() => { const list = document.querySelector('[data-name="clipboard-history"]'); return Boolean(list && list.textContent.includes(${JSON.stringify(firstText)}) && list.textContent.includes(${JSON.stringify(secondText)})); }`,
            );
            ctx.expect(previewsVisible).toBe(true);
        } finally {
            await cleanupClipboardTest(ctx, folder, initialPageIds, previousClipboardText, hubOwnership);
        }
    }, { requires: ["desktop", "windows"] }),

    test("Copying a stored clipboard row captures a new top entry", async (ctx) => {
        const folder = ctx.fixture("us-2070/copy-again");
        const initialPageIds = new Set((await ctx.app.pages.all).map((page) => page.id));
        const text = uniqueText("copy-again");
        let previousClipboardText;
        let hubOwnership;
        try {
            previousClipboardText = await saveClipboardText(ctx);
            hubOwnership = await prepareClipboardTest(ctx, "us-2070/copy-again");
            const initialItems = await captureText(ctx, text, { timeout: 30000 });
            const original = initialItems.find((item) => item.preview === text);
            ctx.expect(original).toBeTruthy();

            await ctx.app.window.screen.hover(`text=${JSON.stringify(text)}`);
            await ctx.app.window.screen.click(`[data-name="clipboard-copy-${original.id}"]`);
            const copiedItems = await ctx.waitFor(
                (activeContext) => activeContext.app.clipboard.items,
                (items) => items[0]?.preview === text && items[0]?.id !== original.id,
            );
            ctx.expect(copiedItems[0].preview).toBe(text);
            ctx.expect(copiedItems[0].id === original.id).toBe(false);
        } finally {
            await cleanupClipboardTest(ctx, folder, initialPageIds, previousClipboardText, hubOwnership);
        }
    }, { requires: ["desktop", "windows"] }),

    test("Selecting a clipboard row opens its content and remove deletes the stored item", async (ctx) => {
        const folder = ctx.fixture("us-2070/open-remove");
        const initialPageIds = new Set((await ctx.app.pages.all).map((page) => page.id));
        const text = uniqueText("open-remove");
        let previousClipboardText;
        let hubOwnership;
        try {
            previousClipboardText = await saveClipboardText(ctx);
            hubOwnership = await prepareClipboardTest(ctx, "us-2070/open-remove");
            const items = await captureText(ctx, text, { timeout: 30000 });
            const item = items.find((entry) => entry.preview === text);
            ctx.expect(item).toBeTruthy();

            await ctx.app.window.screen.click(`text=${JSON.stringify(text)}`);
            const openedContent = await ctx.waitFor(
                (activeContext) => activeContext.app.pages[CLIPBOARD_PAGE_ID].content,
                (content) => content === text,
            );
            ctx.expect(openedContent).toBe(text);

            await ctx.app.clipboard.remove(item.id);
            const remainingItems = await ctx.waitFor(
                (activeContext) => activeContext.app.clipboard.items,
                (currentItems) => !currentItems.some((entry) => entry.id === item.id),
            );
            ctx.expect(remainingItems.some((entry) => entry.id === item.id)).toBe(false);
        } finally {
            await cleanupClipboardTest(ctx, folder, initialPageIds, previousClipboardText, hubOwnership);
        }
    }, { requires: ["desktop", "windows"] }),

    test("Clear empties history and disabling hides the clipboard call-tree node", async (ctx) => {
        const folder = ctx.fixture("us-2070/clear-disable");
        const initialPageIds = new Set((await ctx.app.pages.all).map((page) => page.id));
        const text = uniqueText("clear-disable");
        let previousClipboardText;
        let hubOwnership;
        try {
            previousClipboardText = await saveClipboardText(ctx);
            hubOwnership = await prepareClipboardTest(ctx, "us-2070/clear-disable");
            await captureText(ctx, text, { timeout: 30000 });

            await ctx.app.clipboard.clear();
            const emptyItems = await ctx.waitFor(
                (activeContext) => activeContext.app.clipboard.items,
                (items) => items.length === 0,
            );
            ctx.expect(emptyItems).toEqual([]);

            await ctx.app.settings.set("clipboard.enabled", false);
            await ctx.waitFor(
                (activeContext) => activeContext.app.settings.get("clipboard.enabled"),
                (enabled) => enabled === false,
            );
            let clipboardNodeRejected = false;
            try {
                await ctx.app.clipboard.items;
            } catch {
                clipboardNodeRejected = true;
            }
            ctx.expect(clipboardNodeRejected).toBe(true);
        } finally {
            await cleanupClipboardTest(ctx, folder, initialPageIds, previousClipboardText, hubOwnership);
        }
    }, { requires: ["desktop", "windows"] }),
];
