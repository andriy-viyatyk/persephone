import { test } from "../../../lib/context.mjs";
import { closeBrowserPage } from "../../browser/helpers.mjs";

export default test("unseen mode toggles and manages new contents", async (ctx) => {
    let secondWindow;
    let browserPage;
    const mode = "main.unseenMode";

    try {
        ctx.expect(await ctx.call(`${mode}.enabled`)).toBe(true);
        ctx.expect(await ctx.call(`${mode}.disable`, [])).toEqual({ enabled: false });
        ctx.expect(await ctx.call(`${mode}.enabled`)).toBe(false);
        ctx.expect(await ctx.call(`${mode}.enable`, [])).toEqual({ enabled: true });
        ctx.expect(await ctx.call(`${mode}.enabled`)).toBe(true);

        let previousCount = await ctx.call(`${mode}.managedCount`);
        secondWindow = await ctx.call("windows.createTestWindow", []);
        const afterSecondWindow = await ctx.waitFor(
            (activeContext) => activeContext.call(`${mode}.managedCount`),
            (count) => count > previousCount,
        );
        ctx.expect(afterSecondWindow).toBeGreaterThan(previousCount);
        previousCount = afterSecondWindow;

        browserPage = await ctx.openBrowser(ctx.httpUrl("/browser/permissions/popups.html"));
        const afterBrowserPage = await ctx.waitFor(
            (activeContext) => activeContext.call(`${mode}.managedCount`),
            (count) => count > previousCount,
        );
        ctx.expect(afterBrowserPage).toBeGreaterThan(previousCount);

        ctx.expect(await ctx.call(`${mode}.disable`, [])).toEqual({ enabled: false });
        ctx.expect(await ctx.call(`${mode}.enabled`)).toBe(false);
        ctx.expect(await ctx.call(`${mode}.managedCount`)).toBe(0);
        ctx.expect(await ctx.call(`${mode}.enable`, [])).toEqual({ enabled: true });
        ctx.expect(await ctx.call(`${mode}.enabled`)).toBe(true);
    } finally {
        await closeBrowserPage(ctx, browserPage && { id: browserPage.pageId });
        if (secondWindow) {
            await ctx.call("windows.disposeTestWindow", [secondWindow.index, secondWindow.windowId]).catch(() => {});
        }
    }
});
