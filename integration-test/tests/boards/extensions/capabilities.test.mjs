import { test } from "../../../lib/context.mjs";
import { fixtureBoard, trustFixtureBoard, untrustBoard } from "../../helpers/boards.mjs";

async function removeFixtureTrust(ctx, root) {
    try {
        await untrustBoard(ctx, root);
    } catch {
        // Cleanup must not hide the test result.
    }
}

export default [
    test("capability discovery lists the fixture provider", async (ctx) => {
        const root = fixtureBoard(ctx, "extensions/ext-board");
        try {
            await trustFixtureBoard(ctx, root);
            const help = await ctx.waitFor(
                "capabilities.$help",
                (text) => text.includes("test.extensions.echo"),
            );
            ctx.expect(help).toContain("US-2094 Echo");
            ctx.expect(help).toContain("echo");
        } finally {
            await removeFixtureTrust(ctx, root);
        }
    }),

    test("capability call reaches the board and returns its value", async (ctx) => {
        const root = fixtureBoard(ctx, "extensions/ext-board");
        try {
            await trustFixtureBoard(ctx, root);
            const result = await ctx.app.capabilities["test.extensions.echo"].echo("fixture-input");
            ctx.expect(result).toEqual({ value: "fixture-input", handledBy: "extension-fixture" });
        } finally {
            await removeFixtureTrust(ctx, root);
        }
    }),
];
