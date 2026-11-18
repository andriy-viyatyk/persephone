import { test } from "../../../lib/context.mjs";
import { fixtureBoard, trustFixtureBoard, untrustBoard } from "../../helpers/boards.mjs";

async function serviceState(ctx, root) {
    const boards = await ctx.app.boards.list();
    return boards.find((board) => board.root === root)?.service?.state;
}

async function removeFixtureTrust(ctx, root) {
    try {
        await untrustBoard(ctx, root);
    } catch {
        // Cleanup must not hide the test result.
    }
}

export default [
    test("declared board service starts lazily and round-trips a request", async (ctx) => {
        const root = fixtureBoard(ctx, "extensions/ext-board");
        try {
            await trustFixtureBoard(ctx, root);
            const result = await ctx.app.boards.requestService(root, { op: "echo", value: "fixture-service" });
            ctx.expect(result).toEqual({ op: "echo", value: "fixture-service", handledBy: "extension-fixture" });

            await ctx.waitFor(
                (activeContext) => serviceState(activeContext, root),
                (state) => state === "running",
            );
        } finally {
            await removeFixtureTrust(ctx, root);
        }
    }),

    test("board service can be explicitly started and stopped", async (ctx) => {
        const root = fixtureBoard(ctx, "extensions/ext-board");
        try {
            await trustFixtureBoard(ctx, root);
            await ctx.app.boards.startService(root);
            await ctx.waitFor(
                (activeContext) => serviceState(activeContext, root),
                (state) => state === "running",
            );

            await ctx.app.boards.stopService(root);
            const state = await ctx.waitFor(
                (activeContext) => serviceState(activeContext, root),
                (value) => value === "stopped",
            );
            ctx.expect(state).toBe("stopped");
        } finally {
            await removeFixtureTrust(ctx, root);
        }
    }),
];
