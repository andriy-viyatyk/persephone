import { test } from "../../../lib/context.mjs";

const testWindowPath = "windows[0]";

export default [
    test("a visible desktop requirement runs for the visible test window", async (ctx) => {
        ctx.expect(await ctx.call(`${testWindowPath}.desktopVisible`, [])).toBe(true);
    }, { requires: ["desktop", "launch"] }),

    test("minimize the owned test window for the desktop requirement check", async (ctx) => {
        await ctx.call(`${testWindowPath}.window.minimize`, []);
    }, { requires: ["launch"] }),

    test("a desktop requirement skips when the selected test window is minimized", async (ctx) => {
        ctx.expect(await ctx.call(`${testWindowPath}.desktopVisible`, [])).toBe(true);
    }, { requires: ["desktop", "launch"] }),

    test("restore the owned test window after the desktop requirement check", async (ctx) => {
        await ctx.call(`${testWindowPath}.window.restore`, []);
    }, { requires: ["launch"] }),
];

export async function afterAll(ctx) {
    await ctx.call(`${testWindowPath}.window.restore`, []);
}
