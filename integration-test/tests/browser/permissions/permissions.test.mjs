import { test } from "../../../lib/context.mjs";
import { activatePage, closeBrowserPage, fixturePage, openBrowserPage } from "../helpers.mjs";

const permissionsPopover = '[data-type="browser-site-permissions"]';
const permissionsButton = '[data-name="url-site-permissions"]';
const resetButton = '[data-name="site-permissions-reset"]';

async function waitForScreen(ctx, page, selector, state = "visible") {
    await activatePage(ctx, page.id);
    await ctx.waitFor(
        (activeContext) => activeContext.app.window.screen.evaluate(
            `() => { const element = document.querySelector(${JSON.stringify(selector)}); return Boolean(element && element.getClientRects().length); }`,
        ),
        (visible) => state === "visible" ? visible : !visible,
    );
}

async function clickScreen(ctx, page, selector) {
    await activatePage(ctx, page.id);
    await ctx.app.window.screen.click(selector);
}

async function openPermissions(ctx, page, state) {
    await clickScreen(ctx, page, permissionsButton);
    await waitForScreen(ctx, page, permissionsPopover);
    state.open = true;
}

async function closePermissions(ctx, page, state) {
    await activatePage(ctx, page.id);
    await ctx.app.window.screen.pressKey("Escape");
    await waitForScreen(ctx, page, permissionsPopover, "hidden");
    state.open = false;
}

async function resetPermissions(ctx, page, state) {
    if (!state.open) await openPermissions(ctx, page, state);
    await clickScreen(ctx, page, resetButton);
}

async function cleanupPermissions(ctx, page, state) {
    if (!page?.id) return;
    try {
        await activatePage(ctx, page.id);
        if (!state.open) {
            await ctx.app.window.screen.click(permissionsButton);
            state.open = true;
        }
        await activatePage(ctx, page.id);
        await ctx.app.window.screen.click(resetButton);
    } catch {
        // Best-effort permission reset must not replace the test result.
    }
    try {
        await activatePage(ctx, page.id);
        await ctx.app.window.screen.pressKey("Escape");
        await waitForScreen(ctx, page, permissionsPopover, "hidden");
        state.open = false;
    } catch {
        // Best-effort popover cleanup must not replace the test result.
    }
}

async function waitForPermissionRow(ctx, page, expected) {
    await activatePage(ctx, page.id);
    return await ctx.waitFor(
        (activeContext) => activeContext.app.window.screen.evaluate(`() => {
            const row = document.querySelector('button[data-name="site-permission-notifications"]');
            const ask = row?.closest('[data-part="permission-row"]')?.querySelector('[data-part="permission-ask"]');
            return {
                checked: row?.getAttribute("aria-checked"),
                askVisible: Boolean(ask && ask.getClientRects().length),
            };
        }`),
        (row) => row.checked === expected.checked && row.askVisible === expected.askVisible,
    );
}

export default [
    test("notification prompt remembers Allow, reports granted, and Reset returns Ask", async (ctx) => {
        const page = await openBrowserPage(ctx, fixturePage(ctx, "permissions", "notifications.html"));
        const permissionsState = { open: false };
        try {
            await page.editor.waitFor({ selector: "#request-notification" });
            await resetPermissions(ctx, page, permissionsState);
            await closePermissions(ctx, page, permissionsState);

            await page.editor.click("#request-notification");
            await waitForScreen(ctx, page, '[data-name="browser-permission-prompt"]');
            await activatePage(ctx, page.id);
            const origin = await ctx.app.window.screen.evaluate(
                '() => document.querySelector("[data-name=permission-origin]")?.textContent?.trim()',
            );
            ctx.expect(origin).toContain("127.0.0.1:17867");
            await clickScreen(ctx, page, '[data-name="permission-allow"]');

            await page.editor.waitFor({ text: "granted" });
            ctx.expect(await page.editor.evaluate("() => document.querySelector('#permission-result').textContent.trim()")).toBe("granted");

            await openPermissions(ctx, page, permissionsState);
            ctx.expect(await waitForPermissionRow(ctx, page, { checked: "true", askVisible: false })).toEqual({ checked: "true", askVisible: false });
            await clickScreen(ctx, page, resetButton);
            ctx.expect(await waitForPermissionRow(ctx, page, { checked: "false", askVisible: true })).toEqual({ checked: "false", askVisible: true });
            await closePermissions(ctx, page, permissionsState);
        } finally {
            await cleanupPermissions(ctx, page, permissionsState);
            await closeBrowserPage(ctx, page);
        }
    }),

    test("notification prompt remembers Block, reports denied, and Reset returns Ask", async (ctx) => {
        const page = await openBrowserPage(ctx, fixturePage(ctx, "permissions", "notifications.html"));
        const permissionsState = { open: false };
        try {
            await page.editor.waitFor({ selector: "#request-notification" });
            await resetPermissions(ctx, page, permissionsState);
            await closePermissions(ctx, page, permissionsState);

            await page.editor.click("#request-notification");
            await waitForScreen(ctx, page, '[data-name="browser-permission-prompt"]');
            await activatePage(ctx, page.id);
            const origin = await ctx.app.window.screen.evaluate(
                '() => document.querySelector("[data-name=permission-origin]")?.textContent?.trim()',
            );
            ctx.expect(origin).toContain("127.0.0.1:17867");
            await clickScreen(ctx, page, '[data-name="permission-block"]');

            await page.editor.waitFor({ text: "denied" });
            ctx.expect(await page.editor.evaluate("() => document.querySelector('#permission-result').textContent.trim()")).toBe("denied");

            await openPermissions(ctx, page, permissionsState);
            ctx.expect(await waitForPermissionRow(ctx, page, { checked: "false", askVisible: false })).toEqual({ checked: "false", askVisible: false });
            await clickScreen(ctx, page, resetButton);
            ctx.expect(await waitForPermissionRow(ctx, page, { checked: "false", askVisible: true })).toEqual({ checked: "false", askVisible: true });
            await closePermissions(ctx, page, permissionsState);
        } finally {
            await cleanupPermissions(ctx, page, permissionsState);
            await closeBrowserPage(ctx, page);
        }
    }),

    // Allow changes the app-wide popup limiter state, so this must remain the final test in the module.
    test("blocked popup bar can be dismissed and Allow opens later tabs", async (ctx) => {
        const page = await openBrowserPage(ctx, fixturePage(ctx, "permissions", "popups.html"));
        try {
            await page.editor.waitFor({ selector: "#burst" });
            await page.editor.waitFor({ selector: "#single" });
            const tabsBeforeBurst = await page.editor.tabs;
            const originTabId = tabsBeforeBurst.find((tab) => tab.active).id;
            const targetCount = (tabs) => tabs.filter((tab) => tab.url?.includes("/browser/permissions/popup-target.html")).length;
            await page.editor.click("#burst");

            try {
                await waitForScreen(ctx, page, '[data-name="popup-blocked-bar"]');
            } catch {
                throw new Error("Blocked pop-ups bar did not appear after the five-window burst.");
            }
            await activatePage(ctx, page.id);
            const blockedMessage = await ctx.app.window.screen.evaluate(
                '() => document.querySelector("[data-name=popup-blocked-bar]")?.textContent?.trim()',
            );
            ctx.expect(blockedMessage.toLowerCase()).toContain("blocked");
            const tabsAfterBurst = await page.editor.tabs;
            ctx.expect(tabsAfterBurst.length - tabsBeforeBurst.length <= 3).toBe(true);

            await clickScreen(ctx, page, '[data-name="popup-dismiss"]');
            await waitForScreen(ctx, page, '[data-name="popup-blocked-bar"]', "hidden");

            // An allowed pop-up becomes the active tab; go back to the fixture tab. A second burst
            // trips the limiter again without depending on the first burst's time window.
            await page.editor.switchTab(originTabId);
            await page.editor.click("#burst");
            await waitForScreen(ctx, page, '[data-name="popup-blocked-bar"]');
            await clickScreen(ctx, page, '[data-name="popup-allow"]');
            await waitForScreen(ctx, page, '[data-name="popup-blocked-bar"]', "hidden");

            // After Allow, a whole burst opens: all five pop-ups become tabs and no bar appears.
            const allowedBefore = targetCount(await page.editor.tabs);
            await page.editor.switchTab(originTabId);
            await page.editor.click("#burst");
            const tabsAfterAllowedBurst = await ctx.waitFor(
                (activeContext) => activeContext.app.pages[page.id].editor.tabs,
                (tabs) => targetCount(tabs) >= allowedBefore + 5,
            );
            ctx.expect(targetCount(tabsAfterAllowedBurst)).toBe(allowedBefore + 5);
        } finally {
            await closeBrowserPage(ctx, page);
        }
    }),
];
