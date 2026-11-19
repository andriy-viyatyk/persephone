import path from "node:path";
import { test } from "../../../lib/context.mjs";
import { closePublishedSample, openPublishedBoard } from "../helpers.mjs";

const requiresPublishedBoard = { requires: ["launch", "published-board-checkout"] };

export default [
    test("opens without models or creating a translation registry cache", async (ctx) => {
        let board;
        try {
            board = await openPublishedBoard(ctx, "translate");
            const view = await ctx.waitFor(async (active) => {
                try {
                    return await active.app.pages[board.id].editor.evaluate("() => ({ errorHidden: document.querySelector('#error')?.hidden === true, sourceOptions: [...document.querySelectorAll('#source-language option')].map((option) => option.value), targetOptions: [...document.querySelectorAll('#target-language option')].map((option) => option.value), languages: document.querySelectorAll('#languages > *').length })");
                } catch {
                    return null;
                }
            }, (value) => value?.errorHidden === true
                && value.sourceOptions?.length === 1
                && value.sourceOptions[0] === "en"
                && value.targetOptions?.length === 1
                && value.targetOptions[0] === "en"
                && value.languages === 0);

            ctx.expect(await board.editor.frameReady).toBe(true);
            ctx.expect(view).toEqual({
                errorHidden: true,
                sourceOptions: ["en"],
                targetOptions: ["en"],
                languages: 0,
            });

            const userData = await ctx.app.main.runtime.paths.userData;
            const registryFile = path.join(userData, "board-data", "translate", "registry", "translations-models-v2.json");
            ctx.expect(await ctx.app.fs.exists(registryFile)).toBe(false);
        } finally {
            await closePublishedSample(ctx, board);
        }
    }, requiresPublishedBoard),
];
