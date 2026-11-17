import { test } from "../../../lib/context.mjs";

const closePages = async (ctx, pageIds) => {
    for (const pageId of pageIds) {
        try {
            await /* ctx.call remains because the app stand-in cannot pass call options such as dialog or maxLength. */ ctx.call("pages.closePage", [pageId], { dialog: true });
            const buttons = await /* ctx.call remains because the app stand-in cannot pass call options such as dialog or maxLength. */ ctx.call("dialogs[0].buttons", undefined, { dialog: true }).catch(() => undefined);
            const discard = buttons?.find((button) => /don't save|discard/i.test(button));
            if (discard) await /* ctx.call remains because the app stand-in cannot pass call options such as dialog or maxLength. */ ctx.call("dialogs[0].click", [discard], { dialog: true });
        } catch {
            // Cleanup must not hide the original test failure.
        }
    }
};

export default [
    test("the MCP call description and root help expose the live object-model namespaces", async (ctx) => {
        const { tools } = await ctx._getClient().client.listTools();
        const callTool = tools.find((tool) => tool.name === "call");
        ctx.expect(Boolean(callTool)).toBe(true);
        ctx.expect(callTool.description).toContain("live object model by PATH");
        ctx.expect(callTool.description).toContain("Start with no path to see the overview");
        ctx.expect(JSON.stringify(callTool.inputSchema)).toContain("maxLength");

        const rootText = await ctx.callText("$help", []);
        for (const namespace of ["pages", "settings", "fs", "ui", "script", "guides", "main", "windows"]) {
            ctx.expect(rootText).toContain(namespace);
        }

        const scriptHelp = await ctx.callText("script.$help", []);
        for (const contract of ["JavaScript or TypeScript", "transpiled without type checking", "app, page, and io", "runId", "pending", "maxLength"]) {
            ctx.expect(scriptHelp).toContain(contract);
        }
    }),

    test("an invalid MCP path reports a useful member hint", async (ctx) => {
        let message;
        try {
            const result = await ctx.app.pages.us2032DefinitelyUnknownMember;
            message = typeof result === "string" ? result : JSON.stringify(result);
        } catch (error) {
            message = error.message;
        }
        const normalized = message.toLowerCase();
        ctx.expect(normalized).toContain("us2032definitelyunknownmember");
        ctx.expect(normalized).toContain("not a member of pages");
        ctx.expect(normalized).toContain("resolved up to");
    }),

    test("maxLength truncation returns a bounded body and an explicit marker", async (ctx) => {
        const pageIds = [];
        try {
            const page = await ctx.app.pages.addEmptyPage();
            pageIds.push(page.id);
            await ctx.app.pages.showPage(page.id);
            const longText = "us2032-truncation-marker-".repeat(40);
            const setValue = await ctx.app.script.execute(`page.data.us2032Long = ${JSON.stringify(longText)}`, page.id, "javascript");
            ctx.expect(setValue.isError).toBe(false);

            const raw = await ctx._getClient().rawCall(`pages[${JSON.stringify(page.id)}].data.us2032Long`, undefined, { maxLength: 120 });
            const blocks = raw.content.filter((block) => block.type === "text").map((block) => block.text);
            const marker = blocks.find((value) => value.startsWith("[truncated:"));
            ctx.expect(Boolean(marker)).toBe(true);
            ctx.expect(marker.toLowerCase()).toContain("chars");
            ctx.expect(blocks[0].length <= 120).toBe(true);
            ctx.expect(blocks[0].length > 0).toBe(true);
        } finally {
            await closePages(ctx, pageIds);
        }
    }),

    test("a bounded automation wait returns a timeout error", async (ctx) => {
        let failure;
        try {
            await ctx.app.window.screen.waitFor({ selector: "[data-us2032-never-present]", timeout: 150 });
        } catch (error) {
            failure = error;
        }

        ctx.expect(Boolean(failure)).toBe(true);
        ctx.expect(/timed?\s*out|timeout/i.test(failure.message)).toBe(true);
    }),
];
