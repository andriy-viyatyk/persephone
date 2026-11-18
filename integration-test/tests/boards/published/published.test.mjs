import { rm } from "node:fs/promises";
import { test } from "../../../lib/context.mjs";
import { closeBoardPage, openBoardPage, untrustBoard } from "../../helpers/boards.mjs";
import { registerPublishedBoard } from "../../helpers/published-boards.mjs";

export default [
    test("registers and opens a published checkout board copy", async (ctx) => {
        const root = ctx.fixture("boards/published-checkout/chess");
        let page;
        try {
            // The copy is registered in this profile; attach borrows one whose profile the suite does not reset.
            await registerPublishedBoard(ctx, "chess");
            page = await openBoardPage(ctx, root);
            ctx.expect(await page.editor.evaluate("() => document.title")).toBe("Agent Chess");
        } finally {
            await closeBoardPage(ctx, page?.id);
            await untrustBoard(ctx, root);
            await rm(root, { recursive: true, force: true }).catch(() => {});
        }
    }, { requires: ["launch", "published-board-checkout"] }),
];
