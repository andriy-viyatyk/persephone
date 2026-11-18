import { test } from "../../../lib/context.mjs";
import { fixtureBoard, trustFixtureBoard, untrustBoard } from "../../helpers/boards.mjs";

const BOARD = "speech/fixture-speech-synthesizer";

export default [
    test("speech synthesis discovery lists the fixture call methods", async (ctx) => {
        const root = fixtureBoard(ctx, BOARD);
        try {
            await trustFixtureBoard(ctx, root);
            const help = await ctx.callText('capabilities["speech.synthesize"].$help');
            ctx.expect(help).toContain("Fixture Speech Synthesizer");
            ctx.expect(help).toContain("speak(text: string, options?: { lang?: string; voice?: number; speed?: number })");
            ctx.expect(help).toContain("stop()");
        } finally {
            await untrustBoard(ctx, root);
        }
    }),

    test("speech capability calls preserve success and rejection results", async (ctx) => {
        const root = fixtureBoard(ctx, BOARD);
        try {
            await trustFixtureBoard(ctx, root);
            ctx.expect(await ctx.app.capabilities["speech.synthesize"].stop()).toBe(null);

            let failure;
            try {
                await ctx.call('capabilities["speech.synthesize"].speak', ["fixture"]);
            } catch (error) {
                failure = error;
            }
            ctx.expect(failure?.message).toContain("This fixture does not synthesize audio.");
            ctx.expect(failure?.code).toBe("rejected");
        } finally {
            try {
                await ctx.app.boards.stopService(root);
                await ctx.waitFor(
                    () => ctx.app.boards.list(),
                    (boards) => boards.some((board) => board.root.toLowerCase() === root.toLowerCase() && board.service?.state === "stopped"),
                );
            } catch { /* Service may not have started. */ }
            await untrustBoard(ctx, root);
        }
    }, { requires: ["launch"] }),
];
