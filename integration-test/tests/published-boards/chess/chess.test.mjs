import { test } from "../../../lib/context.mjs";
import { closePublishedSample, openPublishedBoard } from "../helpers.mjs";

const requiresPublishedBoard = { requires: ["launch", "published-board-checkout"] };
const startingFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

async function waitForChessModel(ctx, id, member = "fen") {
    return ctx.waitFor(
        async (active) => {
            try {
                return await active.app.pages[id].editor.app[member];
            } catch {
                return null;
            }
        },
        (value) => value !== null && value !== undefined,
        { timeout: 15000 },
    );
}

export default [
    test("opens Agent Chess at the standard starting position", async (ctx) => {
        let handle;
        try {
            handle = await openPublishedBoard(ctx, "chess");
            await waitForChessModel(ctx, handle.id);

            const model = ctx.app.pages[handle.id].editor.app;
            ctx.expect(await model.status).toBe("playing");
            ctx.expect(await model.result).toBe("*");
            ctx.expect(await model.turn).toBe("white");
            ctx.expect(await model.fen).toBe(startingFen);
            ctx.expect(await model.history).toEqual([]);
            ctx.expect(await model.lastMove).toBe(null);
        } finally {
            await closePublishedSample(ctx, handle);
        }
    }, requiresPublishedBoard),

    test("plays a legal move and rejects an illegal move without changing position", async (ctx) => {
        let handle;
        try {
            handle = await openPublishedBoard(ctx, "chess");
            await waitForChessModel(ctx, handle.id);
            const model = ctx.app.pages[handle.id].editor.app;

            const freshGame = await model.newGame("white");
            ctx.expect(freshGame.turn).toBe("white");
            ctx.expect(freshGame.agentColor).toBe("white");
            ctx.expect(freshGame.status).toBe("playing");

            const played = await model.move("e4");
            ctx.expect(played.played).toBe("e4");
            ctx.expect(played.turn).toBe("black");
            ctx.expect(await model.history).toEqual(["e4"]);
            ctx.expect(await model.lastMove).toEqual({
                from: "e2",
                to: "e4",
                san: "e4",
                color: "white",
                by: "agent",
            });

            await model.newGame("white");
            const beforeFen = await model.fen;
            const beforeHistory = await model.history;
            let errorMessage = "";
            try {
                await model.move("e2e5");
            } catch (error) {
                errorMessage = typeof error?.message === "string" ? error.message : String(error);
            }
            ctx.expect(errorMessage).toContain("Illegal move");
            ctx.expect(await model.fen).toBe(beforeFen);
            ctx.expect(await model.history).toEqual(beforeHistory);
        } finally {
            await closePublishedSample(ctx, handle);
        }
    }, requiresPublishedBoard),

    test("sends chat and draws then clears an arrow", async (ctx) => {
        let handle;
        try {
            handle = await openPublishedBoard(ctx, "chess");
            await waitForChessModel(ctx, handle.id);
            const editor = ctx.app.pages[handle.id].editor;
            const model = editor.app;
            await model.newGame("white");

            ctx.expect(await model.say("Synthetic chess test message")).toBe(true);
            const chat = await model.chat;
            ctx.expect(chat[chat.length - 1]).toEqual({
                who: "agent",
                text: "Synthetic chess test message",
            });

            ctx.expect(await model.showArrows(["e2e4", "d2d4"])).toBe(2);
            const arrowCount = `() => document.querySelectorAll('#arrowLayer line').length`;
            ctx.expect(await editor.evaluate(arrowCount)).toBe(2);
            ctx.expect(await model.clearArrows()).toBe(true);
            ctx.expect(await editor.evaluate(arrowCount)).toBe(0);
        } finally {
            await closePublishedSample(ctx, handle);
        }
    }, requiresPublishedBoard),

    test("new game resets the position and history", async (ctx) => {
        let handle;
        try {
            handle = await openPublishedBoard(ctx, "chess");
            await waitForChessModel(ctx, handle.id);
            const model = ctx.app.pages[handle.id].editor.app;
            await model.newGame("white");
            await model.move("e4");

            const reset = await model.newGame("black");
            ctx.expect(reset.fen).toBe(startingFen);
            ctx.expect(reset.turn).toBe("white");
            ctx.expect(reset.agentColor).toBe("black");
            ctx.expect(reset.status).toBe("playing");
            ctx.expect(await model.history).toEqual([]);
            ctx.expect(await model.lastMove).toBe(null);
        } finally {
            await closePublishedSample(ctx, handle);
        }
    }, requiresPublishedBoard),
];
