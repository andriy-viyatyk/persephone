import { test } from "../../../lib/context.mjs";
import { close, open } from "../../helpers/pilot-helpers.mjs";

async function closeSavedPage(ctx, page) {
    if (!page) return;
    const modified = await ctx.app.pages[page.id].modified;
    if (modified) {
        const editor = await ctx.app.pages[page.id].editor.id;
        if (editor !== "monaco") {
            await ctx.app.pages[page.id].editorSwitches.switchTo("monaco");
            await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].editor.id, (current) => current === "monaco");
        }
        await ctx.app.pages[page.id].editor.saveFile();
        await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].modified, (current) => current === false);
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
            ctx.expect(await ctx.app.pages[page.id].editor.id).toBe("grid-json");
            ctx.expect(await ctx.app.pages[page.id].editor.rows).toEqual([{ name: "Ada", city: "Kyiv" }]);

            const rowKey = (await ctx.app.pages[page.id].editor.rowKeys)[0];
            await ctx.app.pages[page.id].editor.editCell("city", rowKey, "Odesa");
            await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].editor.rows, (rows) => rows[0]?.city === "Odesa");
            await ctx.app.pages[page.id].editorSwitches.switchTo("monaco");
            await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].editor.id, (editor) => editor === "monaco");
            ctx.expect(JSON.parse(await ctx.callText(`pages[${JSON.stringify(page.id)}].content`))).toEqual([
                { name: "Ada", city: "Odesa" },
            ]);

            await ctx.app.window.screen.pressKey("Control+a", { target: ".monaco-editor-host-root .monaco-editor" });
            await ctx.app.pages[page.id].editor.replaceSelection(textEdit);
            ctx.expect(await ctx.waitFor(
                (activeContext) => activeContext.callText(`pages[${JSON.stringify(page.id)}].content`),
                (content) => content === textEdit,
            )).toBe(textEdit);

            await ctx.app.pages[page.id].editorSwitches.switchTo("grid-json");
            await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].editor.id, (editor) => editor === "grid-json");
            ctx.expect(await ctx.waitFor(
                (activeContext) => activeContext.app.pages[page.id].editor.rows,
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
            ctx.expect(await ctx.app.pages[firstPage.id].editor.id).toBe("md-view");
            await ctx.app.pages[firstPage.id].editorSwitches.switchTo("monaco");
            await ctx.waitFor((activeContext) => activeContext.app.pages[firstPage.id].editor.id, (editor) => editor === "monaco");

            await ctx.app.window.screen.pressKey("Control+a", { target: ".monaco-editor-host-root .monaco-editor" });
            await ctx.app.pages[firstPage.id].editor.replaceSelection(changedSource);
            ctx.expect(await ctx.waitFor(
                (activeContext) => activeContext.callText(`pages[${JSON.stringify(firstPage.id)}].content`),
                (content) => content === changedSource,
            )).toBe(changedSource);

            await ctx.app.pages[firstPage.id].editorSwitches.switchTo("md-view");
            await ctx.waitFor((activeContext) => activeContext.app.pages[firstPage.id].editor.id, (editor) => editor === "md-view");
            const rendered = await ctx.waitFor(
                (activeContext) => activeContext.callText(`pages[${JSON.stringify(firstPage.id)}].editor.html`),
                (html) => html.includes("Changed from Text Editor."),
            );
            ctx.expect(rendered).toContain("<h1");

            secondPage = await open(ctx, "us-2047/markdown/second.md", "# Second page\n", "md-view");
            ctx.expect(await ctx.app.pages[secondPage.id].editor.id).toBe("md-view");
            await ctx.app.pages[secondPage.id].editorSwitches.switchTo("monaco");
            ctx.expect(await ctx.waitFor((activeContext) => activeContext.app.pages[secondPage.id].editor.id, (editor) => editor === "monaco")).toBe("monaco");

            await ctx.app.pages.showPage(firstPage.id);
            ctx.expect(await ctx.waitFor((activeContext) => activeContext.app.pages[firstPage.id].editor.id, (editor) => editor === "md-view")).toBe("md-view");
            await ctx.app.pages.showPage(secondPage.id);
            ctx.expect(await ctx.waitFor((activeContext) => activeContext.app.pages[secondPage.id].editor.id, (editor) => editor === "monaco")).toBe("monaco");
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
            ctx.expect(await ctx.app.pages[page.id].editor.id).toBe("mermaid-view");
            await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].editor.loading, (loading) => loading === false);
            ctx.expect(await ctx.app.pages[page.id].editor.error).toBe("");
            const initialSvgUrl = await ctx.waitFor(
                (activeContext) => activeContext.app.pages[page.id].editor.svgUrl,
                (url) => typeof url === "string" && url.includes("data:image/svg+xml"),
            );

            await ctx.app.pages[page.id].editorSwitches.switchTo("monaco");
            await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].editor.id, (editor) => editor === "monaco");
            ctx.expect(await ctx.callText(`pages[${JSON.stringify(page.id)}].content`)).toBe(initial);
            await ctx.app.window.screen.pressKey("Control+a", { target: ".monaco-editor-host-root .monaco-editor" });
            await ctx.app.pages[page.id].editor.replaceSelection(edited);
            ctx.expect(await ctx.waitFor(
                (activeContext) => activeContext.callText(`pages[${JSON.stringify(page.id)}].content`),
                (content) => content === edited,
            )).toBe(edited);

            await ctx.app.pages[page.id].editorSwitches.switchTo("mermaid-view");
            await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].editor.id, (editor) => editor === "mermaid-view");
            await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].editor.loading, (loading) => loading === false);
            ctx.expect(await ctx.app.pages[page.id].editor.error).toBe("");
            ctx.expect(await ctx.waitFor(
                (activeContext) => activeContext.app.pages[page.id].editor.svgUrl,
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
            const options = await ctx.app.pages[page.id].editorSwitches.options;
            ctx.expect(await ctx.app.pages[page.id].editor.id).toBe("monaco");
            ctx.expect(options.map((option) => option.id)).toEqual(["monaco"]);
        } finally {
            await closeSavedPage(ctx, page);
        }
    }),
];
