import { test } from "../../../lib/context.mjs";
import { closeBrowserPage } from "../../browser/helpers.mjs";

// Run with: npm run test:ui -- --area core/virtual-desktop --with virtual-desktop --desktop 2
// The wrapper also checks that the user's current desktop did not change. Pop-up placement is checked
// manually: the permissions fixture's pop-ups go through the pop-up permission prompt.
export default test("owned windows stay on the selected virtual desktop", async (ctx) => {
    let secondWindow;
    let browserPage;
    try {
        ctx.expect(await ctx.call("windows[0].desktopVisible")).toBe(false);
        secondWindow = await ctx.call("windows.createTestWindow", []);
        ctx.expect(await ctx.call(`windows[${secondWindow.index}].desktopVisible`)).toBe(false);

        browserPage = await ctx.openBrowser(ctx.httpUrl("/browser/permissions/popups.html"));
        ctx.expect(await ctx.call("windows[0].desktopVisible")).toBe(false);
        ctx.expect(await browserPage.evaluate("() => document.visibilityState")).toBe("visible");
    } finally {
        await closeBrowserPage(ctx, browserPage && { id: browserPage.pageId });
        if (secondWindow) await ctx.call("windows.disposeTestWindow", [secondWindow.index, secondWindow.windowId]).catch(() => {});
    }
}, { requires: ["launch", "virtual-desktop"] });
