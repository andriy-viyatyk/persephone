import { test } from "../../../lib/context.mjs";

export default test("open fixture text", async (ctx) => {
    await ctx.app.pages.openFile(ctx.fixture("smoke.txt"));
    const content = await ctx.waitFor(
        (activeContext) => activeContext.callText("page.content"),
        (value) => value === "Hello, integration runner!\n",
    );
    ctx.expect(content).toBe("Hello, integration runner!\n");
});
