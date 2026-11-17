import { test } from "../../../lib/context.mjs";
import { open, close, text } from "../../helpers/pilot-helpers.mjs";

export default test("dialog: cancel rename preserves file", async (ctx) => {
    const p = await open(ctx, "pilot.txt", text, "monaco");
    ctx.expect(await /* ctx.call remains because the app stand-in cannot pass call options such as { dialog: true }. */ ctx.call(`pages[${JSON.stringify(p.id)}].editor.promptRename`, [], { dialog: true })).toEqual({ pending: true });
    await ctx.waitFor(
        (activeContext) => activeContext.callText("dialogs[0].title", undefined, { dialog: true }),
        (title) => title === "Rename File",
    );
    ctx.expect(await ctx.callText("dialogs[0].value", undefined, { dialog: true })).toBe('pilot.txt');
    await /* ctx.call remains because the app stand-in cannot pass call options such as { dialog: true }. */ ctx.call("dialogs[0].click", ["Cancel"], { dialog: true });
    await ctx.waitFor((activeContext) => activeContext.app.pages[p.id].filePath, (filePath) => filePath === p.filePath);
    ctx.expect(await ctx.callText("fs.read", [p.filePath])).toBe(text);
    await close(ctx, p.id);
});
