import { test } from "../../../lib/context.mjs";
import { close, open } from "../../helpers/pilot-helpers.mjs";

async function closeSavedPage(ctx, page) {
    if (!page) return;
    const modified = await ctx.call(`${page.root}.modified`);
    if (modified) {
        const editor = await ctx.call(`${page.root}.editor.id`);
        if (editor !== "monaco") {
            await ctx.call(`${page.root}.editorSwitches.switchTo`, ["monaco"]);
            await ctx.waitFor(`${page.root}.editor.id`, (current) => current === "monaco");
        }
        await ctx.call(`${page.root}.editor.saveFile`, []);
        await ctx.waitFor(`${page.root}.modified`, (current) => current === false);
    }
    await close(ctx, page.id);
}

export default [
    test("JSON content and edits stay in sync between Grid and Text Editor", async (ctx) => {
        const initial = '[{"name":"Ada","city":"Kyiv"}]\n';
        const textEdit = '[{"name":"Ada","city":"Lviv"}]\n';
        let page;
        try {
            page = await open(ctx, "us-2047/json/data.grid.json", initial, "grid-json");
            ctx.expect(await ctx.call(`${page.root}.editor.id`)).toBe("grid-json");
            ctx.expect(await ctx.call(`${page.root}.editor.rows`)).toEqual([{ name: "Ada", city: "Kyiv" }]);

            const rowKey = (await ctx.call(`${page.root}.editor.rowKeys`))[0];
            await ctx.call(`${page.root}.editor.editCell`, ["city", rowKey, "Odesa"]);
            await ctx.waitFor(`${page.root}.editor.rows`, (rows) => rows[0]?.city === "Odesa");
            await ctx.call(`${page.root}.editorSwitches.switchTo`, ["monaco"]);
            await ctx.waitFor(`${page.root}.editor.id`, (editor) => editor === "monaco");
            ctx.expect(JSON.parse(await ctx.callText(`${page.root}.content`))).toEqual([
                { name: "Ada", city: "Odesa" },
            ]);

            await ctx.call("window.screen.pressKey", ["Control+a", { target: ".monaco-editor-host-root .monaco-editor" }]);
            await ctx.call(`${page.root}.editor.replaceSelection`, [textEdit]);
            ctx.expect(await ctx.waitFor(
                (activeContext) => activeContext.callText(`${page.root}.content`),
                (content) => content === textEdit,
            )).toBe(textEdit);

            await ctx.call(`${page.root}.editorSwitches.switchTo`, ["grid-json"]);
            await ctx.waitFor(`${page.root}.editor.id`, (editor) => editor === "grid-json");
            ctx.expect(await ctx.waitFor(
                `${page.root}.editor.rows`,
                (rows) => rows[0]?.city === "Lviv",
            )).toEqual([{ name: "Ada", city: "Lviv" }]);
        } finally {
            await closeSavedPage(ctx, page);
        }
    }),

    test("Markdown source edits render in Preview and each page keeps its selected editor", async (ctx) => {
        const firstSource = "# First page\n\nOriginal text.\n";
        const changedSource = "# First page\n\nChanged from Text Editor.\n";
        let firstPage;
        let secondPage;
        try {
            firstPage = await open(ctx, "us-2047/markdown/first.md", firstSource, "md-view");
            ctx.expect(await ctx.call(`${firstPage.root}.editor.id`)).toBe("md-view");
            await ctx.call(`${firstPage.root}.editorSwitches.switchTo`, ["monaco"]);
            await ctx.waitFor(`${firstPage.root}.editor.id`, (editor) => editor === "monaco");

            await ctx.call("window.screen.pressKey", ["Control+a", { target: ".monaco-editor-host-root .monaco-editor" }]);
            await ctx.call(`${firstPage.root}.editor.replaceSelection`, [changedSource]);
            ctx.expect(await ctx.waitFor(
                (activeContext) => activeContext.callText(`${firstPage.root}.content`),
                (content) => content === changedSource,
            )).toBe(changedSource);

            await ctx.call(`${firstPage.root}.editorSwitches.switchTo`, ["md-view"]);
            await ctx.waitFor(`${firstPage.root}.editor.id`, (editor) => editor === "md-view");
            const rendered = await ctx.waitFor(
                (activeContext) => activeContext.callText(`${firstPage.root}.editor.html`),
                (html) => html.includes("Changed from Text Editor."),
            );
            ctx.expect(rendered).toContain("<h1");

            secondPage = await open(ctx, "us-2047/markdown/second.md", "# Second page\n", "md-view");
            ctx.expect(await ctx.call(`${secondPage.root}.editor.id`)).toBe("md-view");
            await ctx.call(`${secondPage.root}.editorSwitches.switchTo`, ["monaco"]);
            ctx.expect(await ctx.waitFor(`${secondPage.root}.editor.id`, (editor) => editor === "monaco")).toBe("monaco");

            await ctx.call("pages.showPage", [firstPage.id]);
            ctx.expect(await ctx.waitFor(`${firstPage.root}.editor.id`, (editor) => editor === "md-view")).toBe("md-view");
            await ctx.call("pages.showPage", [secondPage.id]);
            ctx.expect(await ctx.waitFor(`${secondPage.root}.editor.id`, (editor) => editor === "monaco")).toBe("monaco");
        } finally {
            await closeSavedPage(ctx, secondPage);
            await closeSavedPage(ctx, firstPage);
        }
    }),

    test("Mermaid source edits render after switching between Text Editor and Mermaid", async (ctx) => {
        const initial = "flowchart TD\n    Start --> Finish\n";
        const edited = "flowchart LR\n    Start[Start] --> Review[Review]\n";
        let page;
        try {
            page = await open(ctx, "us-2047/mermaid/flow.mmd", initial, "mermaid-view");
            ctx.expect(await ctx.call(`${page.root}.editor.id`)).toBe("mermaid-view");
            await ctx.waitFor(`${page.root}.editor.loading`, (loading) => loading === false);
            ctx.expect(await ctx.call(`${page.root}.editor.error`)).toBe("");
            const initialSvgUrl = await ctx.waitFor(
                `${page.root}.editor.svgUrl`,
                (url) => typeof url === "string" && url.includes("data:image/svg+xml"),
            );

            await ctx.call(`${page.root}.editorSwitches.switchTo`, ["monaco"]);
            await ctx.waitFor(`${page.root}.editor.id`, (editor) => editor === "monaco");
            ctx.expect(await ctx.callText(`${page.root}.content`)).toBe(initial);
            await ctx.call("window.screen.pressKey", ["Control+a", { target: ".monaco-editor-host-root .monaco-editor" }]);
            await ctx.call(`${page.root}.editor.replaceSelection`, [edited]);
            ctx.expect(await ctx.waitFor(
                (activeContext) => activeContext.callText(`${page.root}.content`),
                (content) => content === edited,
            )).toBe(edited);

            await ctx.call(`${page.root}.editorSwitches.switchTo`, ["mermaid-view"]);
            await ctx.waitFor(`${page.root}.editor.id`, (editor) => editor === "mermaid-view");
            await ctx.waitFor(`${page.root}.editor.loading`, (loading) => loading === false);
            ctx.expect(await ctx.call(`${page.root}.editor.error`)).toBe("");
            ctx.expect(await ctx.waitFor(
                (activeContext) => activeContext.call(`${page.root}.editor.svgUrl`),
                (url) => typeof url === "string" && url.includes("data:image/svg+xml") && url !== initialSvgUrl,
            )).toContain("data:image/svg+xml");
        } finally {
            await closeSavedPage(ctx, page);
        }
    }),

    test("plain text files offer no editor switch target besides Text Editor", async (ctx) => {
        let page;
        try {
            page = await open(ctx, "us-2047/single-editor/notes.txt", "A plain text note.\n", "monaco");
            const options = await ctx.call(`${page.root}.editorSwitches.options`);
            ctx.expect(await ctx.call(`${page.root}.editor.id`)).toBe("monaco");
            ctx.expect(options.map((option) => option.id)).toEqual(["monaco"]);
        } finally {
            await closeSavedPage(ctx, page);
        }
    }),
];
