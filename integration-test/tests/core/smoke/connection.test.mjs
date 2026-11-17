import { test } from "../../../lib/context.mjs";

export default test("bare call answers", async (ctx) => {
    const value = await ctx.app;
    ctx.expect(value).toBeTruthy();
});
