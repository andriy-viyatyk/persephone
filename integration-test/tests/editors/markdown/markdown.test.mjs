import { test } from "../../../lib/context.mjs";
import { close, open } from "../../helpers/pilot-helpers.mjs";

async function openMarkdown(ctx, folder, filename, content) {
    return open(ctx, `${folder}/${filename}`, content, "md-view");
}

async function closePage(ctx, page) {
    if (page && await ctx.app.pages[page.id].modified) {
        await ctx.app.pages[page.id].editorSwitches.switchTo("monaco");
        await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].editor.id, (editor) => editor === "monaco");
        await ctx.app.pages[page.id].editor.saveFile();
        await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].modified, (modified) => modified === false);
    }
    if (page) await close(ctx, page.id);
}

export default [
    test("Markdown files open in preview and render headings, lists, code, and tables", async (ctx) => {
        let page;
        try {
            page = await openMarkdown(ctx, "us-2044/rendering", "document.md", [
                "# Rendering sample",
                "",
                "## Details",
                "",
                "- first item",
                "- second item",
                "",
                "```js",
                "const answer = 42;",
                "```",
                "",
                "| Name | Count |",
                "| --- | ---: |",
                "| answer | 42 |",
                "",
            ].join("\n"));

            ctx.expect(await ctx.app.pages[page.id].editor.id).toBe("md-view");
            const html = await ctx.waitFor(
                (activeContext) => activeContext.callText(`pages[${JSON.stringify(page.id)}].editor.html`),
                (rendered) => rendered.includes("<h1") && rendered.includes("<ul")
                    && rendered.includes("<pre") && rendered.includes("<table"),
            );
            ctx.expect(html).toContain("<h2");
            ctx.expect(html).toContain("<li");
            ctx.expect(html).toContain("<code");
            ctx.expect(html).toContain("<th");
            ctx.expect(html).toContain("<td");
        } finally {
            await closePage(ctx, page);
        }
    }),

    test("a Mermaid fence in Markdown renders a diagram image", async (ctx) => {
        let page;
        try {
            page = await openMarkdown(ctx, "us-2044/mermaid", "flow.md", [
                "# Flow",
                "",
                "```mermaid",
                "flowchart LR",
                "    Start --> Finish",
                "```",
                "",
            ].join("\n"));

            const html = await ctx.waitFor(
                (activeContext) => activeContext.callText(`pages[${JSON.stringify(page.id)}].editor.html`),
                (rendered) => rendered.includes('class="mermaid-diagram"') && rendered.includes("<img"),
            );
            ctx.expect(html).toContain("mermaid-diagram");
            ctx.expect(html).toContain("data:image/svg+xml");
        } finally {
            await closePage(ctx, page);
        }
    }),

    test("local Markdown links open in the same page and heading links scroll to their target", async (ctx) => {
        const folder = "us-2044/navigation";
        const targetContent = "# Details\n\nOpened from the local Markdown link.\n";
        await ctx.app.fs.write(ctx.fixture(`${folder}/details.md`), targetContent);

        const filler = Array.from(
            { length: 30 },
            (_, index) => `Paragraph ${index + 1} keeps the target below the preview viewport.`,
        );
        const indexContent = [
            "# Navigation",
            "",
            "[Jump to conclusion](#conclusion)",
            "",
            ...filler,
            "",
            "## Conclusion",
            "",
            "The heading anchor target.",
            "",
            "[Open details](details.md)",
            "",
        ].join("\n");

        let page;
        try {
            page = await openMarkdown(ctx, folder, "index.md", indexContent);
            const initialScrollTop = await ctx.app.window.screen.evaluate("() => document.querySelector('[data-name=\"markdown-scroll\"]')?.scrollTop ?? -1");
            ctx.expect(initialScrollTop).toBe(0);
            const pageCountBefore = (await ctx.app.pages.all).length;

            await ctx.app.window.screen.click("text=Jump to conclusion", { nth: 1 });
            const anchoredScrollTop = await ctx.waitFor(
                (activeContext) => activeContext.app.window.screen.evaluate("() => document.querySelector('[data-name=\"markdown-scroll\"]')?.scrollTop ?? -1"),
                (scrollTop) => scrollTop > 0,
            );
            ctx.expect(anchoredScrollTop > initialScrollTop).toBe(true);

            await ctx.app.window.screen.click("text=Open details", { nth: 1 });
            ctx.expect(await ctx.waitFor(
                (activeContext) => activeContext.callText(`pages[${JSON.stringify(page.id)}].content`),
                (content) => content === targetContent,
            )).toBe(targetContent);
            ctx.expect(await ctx.app.pages[page.id].title).toBe("details.md");
            const pagesAfterNavigation = await ctx.app.pages.all;
            ctx.expect(pagesAfterNavigation.length).toBe(pageCountBefore);
            ctx.expect(pagesAfterNavigation.some((entry) => entry.id === page.id)).toBe(true);
        } finally {
            await closePage(ctx, page);
        }
    }),

    test("the Markdown find bar finds and cycles through preview text", async (ctx) => {
        let page;
        try {
            page = await openMarkdown(ctx, "us-2044/find", "search.md", [
                "# Search",
                "",
                "The needle appears here.",
                "",
                "A second needle appears here.",
                "",
            ].join("\n"));
            ctx.expect(await ctx.app.pages[page.id].editor.totalMatches).toBe(0);

            await ctx.app.pages[page.id].editor.openSearch();
            ctx.expect(await ctx.app.pages[page.id].editor.elements.then(
                (elements) => elements.find((element) => element.name === "find-input").visible,
            )).toBe(true);
            await ctx.app.window.screen.type("[data-name=\"find-input\"] input", "needle");

            await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].editor.totalMatches, (count) => count === 2);
            ctx.expect(await ctx.app.pages[page.id].editor.searchText).toBe("needle");
            ctx.expect(await ctx.app.pages[page.id].editor.currentMatchIndex).toBe(0);
            const initialHtml = await ctx.callText(`pages[${JSON.stringify(page.id)}].editor.html`);
            const initialActiveMatch = initialHtml.indexOf("highlighted-text-active");
            ctx.expect(initialActiveMatch >= 0).toBe(true);

            await ctx.app.pages[page.id].editor.nextMatch();
            ctx.expect(await ctx.waitFor(
                (activeContext) => activeContext.app.pages[page.id].editor.currentMatchIndex,
                (index) => index === 1,
            )).toBe(1);
            const nextHtml = await ctx.callText(`pages[${JSON.stringify(page.id)}].editor.html`);
            const nextActiveMatch = nextHtml.indexOf("highlighted-text-active");
            ctx.expect(nextActiveMatch >= 0).toBe(true);
            ctx.expect(nextActiveMatch !== initialActiveMatch).toBe(true);
        } finally {
            if (page) await ctx.app.pages[page.id].editor.closeSearch();
            await closePage(ctx, page);
        }
    }),

    test("editing Markdown in Text Editor updates the rendered preview", async (ctx) => {
        const initial = "# Original heading\n\nOriginal preview text.\n";
        const updated = "# Updated heading\n\nUpdated preview text.\n";
        let page;
        try {
            page = await openMarkdown(ctx, "us-2044/live-edit", "live.md", initial);
            ctx.expect(await ctx.callText(`pages[${JSON.stringify(page.id)}].content`)).toBe(initial);
            ctx.expect(await ctx.app.pages[page.id].editor.id).toBe("md-view");

            await ctx.app.pages[page.id].editorSwitches.switchTo("monaco");
            await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].editor.id, (editor) => editor === "monaco");
            await ctx.app.window.screen.pressKey("Control+a", { target: ".monaco-editor-host-root .monaco-editor" });
            await ctx.app.pages[page.id].editor.replaceSelection(updated);
            ctx.expect(await ctx.waitFor(
                (activeContext) => activeContext.callText(`pages[${JSON.stringify(page.id)}].content`),
                (content) => content === updated,
            )).toBe(updated);

            await ctx.app.pages[page.id].editorSwitches.switchTo("md-view");
            await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].editor.id, (editor) => editor === "md-view");
            const html = await ctx.waitFor(
                (activeContext) => activeContext.callText(`pages[${JSON.stringify(page.id)}].editor.html`),
                (rendered) => rendered.includes("Updated heading") && rendered.includes("Updated preview text."),
            );
            ctx.expect(html).toContain("<h1");
            ctx.expect(await ctx.app.pages[page.id].modified).toBe(true);
        } finally {
            await closePage(ctx, page);
        }
    }),
];
