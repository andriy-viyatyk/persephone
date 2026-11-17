import { test } from "../../../lib/context.mjs";
import { closeOrphanedUs2036Pages, closeOwnedPages, closePendingDialog, waitForDialog } from "../../helpers/shell-helpers.mjs";

export default [
    test("Open URL opens a fixture-server URL and Cancel opens no page", async (ctx) => {
        const ownedPageIds = [];
        let previousLinkBehavior;
        try {
            await closePendingDialog(ctx);
            await closeOrphanedUs2036Pages(ctx);
            previousLinkBehavior = await ctx.app.settings.get("link-open-behavior");
            await ctx.app.settings.set("link-open-behavior", "internal-browser");
            const before = await ctx.app.pages.all;
            await /* ctx.call remains because the app stand-in cannot pass call options such as { dialog: true }. */ ctx.call("window.screen.pressKey", ["Ctrl+O"], { dialog: true });
            await waitForDialog(ctx, "dialogs[0].title", (title) => title === "Open");
            ctx.expect(await ctx.callText("dialogs[0].message", undefined, { dialog: true })).toBe("Paste file path, URL, or cURL command");
            const url = ctx.httpUrl("/echo?source=us2036-dialog");
            await /* ctx.call remains because the app stand-in cannot pass call options such as { dialog: true }. */ ctx.call("window.screen.type", ['[data-name="open-url-input"]', url], { dialog: true });
            await /* ctx.call remains because the app stand-in cannot pass call options such as { dialog: true }. */ ctx.call("dialogs[0].click", ["Open"], { dialog: true });

            const openedPages = await ctx.waitFor((activeContext) => activeContext.app.pages.all, (pages) => pages.filter((page) => !before.some((old) => old.id === page.id)).length > 0
                ? pages.filter((page) => !before.some((old) => old.id === page.id))
                : false);
            ownedPageIds.push(...openedPages.map((page) => page.id));
            const browserPage = openedPages.find((page) => page.editor === "browser-view");
            ctx.expect(browserPage).toBeTruthy();
            ctx.expect(await ctx.waitFor(`pages[${JSON.stringify(browserPage.id)}].editor.url`, (value) => value === url)).toBe(url);
        } finally {
            await closePendingDialog(ctx);
            await closeOwnedPages(ctx, ownedPageIds);
            if (previousLinkBehavior !== undefined) {
                await ctx.app.settings.set("link-open-behavior", previousLinkBehavior);
            }
        }

        const beforeCancel = await ctx.app.pages.all;
        await /* ctx.call remains because the app stand-in cannot pass call options such as { dialog: true }. */ ctx.call("window.screen.pressKey", ["Ctrl+O"], { dialog: true });
        await waitForDialog(ctx, "dialogs[0].title", (title) => title === "Open");
        await /* ctx.call remains because the app stand-in cannot pass call options such as { dialog: true }. */ ctx.call("dialogs[0].click", ["Cancel"], { dialog: true });
        const afterCancel = await ctx.waitFor((activeContext) => activeContext.app.pages.all, (pages) => pages.every((page) => beforeCancel.some((old) => old.id === page.id)));
        ctx.expect(afterCancel.map((page) => page.id)).toEqual(beforeCancel.map((page) => page.id));
    }),
];
