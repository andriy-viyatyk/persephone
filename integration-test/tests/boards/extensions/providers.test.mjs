import { test } from "../../../lib/context.mjs";
import { closeBoardPage, fixtureBoard, trustFixtureBoard, untrustBoard } from "../../helpers/boards.mjs";

async function closeOwnedPage(ctx, pageId) {
    if (!pageId) return;
    try {
        await closeBoardPage(ctx, pageId);
    } catch {
        // Cleanup must not hide the test result.
    }
}

async function removeFixtureTrust(ctx, root) {
    try {
        await untrustBoard(ctx, root);
    } catch {
        // Cleanup must not hide the test result.
    }
}

export default [
    test("board scheme provider reads fixture content", async (ctx) => {
        const root = fixtureBoard(ctx, "extensions/ext-board");
        let pageId;
        try {
            await trustFixtureBoard(ctx, root);
            const beforeIds = new Set((await ctx.app.pages.all).map((page) => page.id));
            await ctx.script("await app.openRawLink('us2094://fixture/item.us2094'); return 'opened'");

            const pages = await ctx.waitFor(
                (activeContext) => activeContext.app.pages.all,
                (items) => items.some((page) => !beforeIds.has(page.id)),
            );
            const openedPage = pages.find((page) => !beforeIds.has(page.id));
            pageId = openedPage.id;
            const content = await ctx.callText(`pages[${JSON.stringify(pageId)}].content`);
            ctx.expect(content).toBe("provider-payload");
        } finally {
            await closeOwnedPage(ctx, pageId);
            await removeFixtureTrust(ctx, root);
        }
    }),
];
