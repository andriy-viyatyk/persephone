import { test } from "../../../lib/context.mjs";

export default test("session and desktop visibility reflect the unlocked test window", async (ctx) => {
    const windowIndex = 0;
    const windowPath = `windows[${windowIndex}]`;

    try {
        ctx.expect(await ctx.call("main.session.locked")).toBe(false);
        ctx.expect(await ctx.call(`${windowPath}.desktopVisible`)).toBe(true);

        await ctx.call(`${windowPath}.window.minimize`, []);
        ctx.expect(await ctx.call(`${windowPath}.desktopVisible`)).toBe(false);
    } finally {
        await ctx.call(`${windowPath}.window.restore`, []).catch(() => {});
    }
}, { requires: ["desktop"] });
