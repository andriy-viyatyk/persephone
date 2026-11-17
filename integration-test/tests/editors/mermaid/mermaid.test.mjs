import { test } from "../../../lib/context.mjs";
import { closeMermaidPage, openMermaidPage } from "../helpers.mjs";

const validDiagram = "flowchart TD\n    Start[Start] --> Finish[Finish]\n";

async function selectedMenuItem(ctx, page, buttonName, itemId) {
    const pageSlot = `[data-page-id="${page.id}"]`;
    await ctx.app.window.screen.click(`${pageSlot} [data-name="${buttonName}"]`);
    await ctx.waitFor(
        (activeContext) => activeContext.app.window.screen.evaluate(`() => Boolean(document.querySelector('[data-type="menu-row"][data-name="${itemId}"]'))`),
        (present) => present === true,
    );
    const selected = await ctx.app.window.screen.evaluate(`() => Boolean(document.querySelector('[data-type="menu-row"][data-name="${itemId}"] [data-part="selected-check"]'))`);
    await ctx.app.window.screen.pressKey("Escape");
    return selected;
}

async function waitForDiagramImage(ctx, page) {
    const selector = `[data-page-id="${page.id}"] img`;
    return ctx.waitFor(
        (activeContext) => activeContext.app.window.screen.evaluate(`() => document.querySelector(${JSON.stringify(selector)})?.getAttribute("src")?.startsWith("data:image/svg+xml,") === true`),
        (visible) => visible === true,
    );
}

async function renderedDiagramState(ctx, page) {
    const selector = `[data-page-id="${page.id}"] img`;
    return ctx.app.window.screen.evaluate(`() => {
            const source = document.querySelector(${JSON.stringify(selector)})?.getAttribute("src") ?? "";
            let hash = 0;
            for (let index = 0; index < source.length; index += 1) hash = (Math.imul(hash, 31) + source.charCodeAt(index)) >>> 0;
            return { hash, handDrawn: source.startsWith("data:image/svg+xml,") && decodeURIComponent(source).includes('data-look="handDrawn"') };
        }`);
}

export default [
    test("a Mermaid page renders valid source and reports invalid syntax", async (ctx) => {
        let validPage;
        let invalidPage;
        try {
            validPage = await openMermaidPage(ctx, "us-2045/render", "valid.mmd", validDiagram);
            ctx.expect(await ctx.app.pages[validPage.id].editor.id).toBe("mermaid-view");
            await ctx.waitFor((activeContext) => activeContext.app.pages[validPage.id].editor.loading, (loading) => loading === false);
            ctx.expect(await waitForDiagramImage(ctx, validPage)).toBe(true);
            ctx.expect(await ctx.app.pages[validPage.id].editor.error).toBe("");

            invalidPage = await openMermaidPage(ctx, "us-2045/render", "invalid.mmd", "this is not a Mermaid diagram\n");
            ctx.expect(await ctx.waitFor((activeContext) => activeContext.app.pages[invalidPage.id].editor.loading, (loading) => loading === false)).toBe(false);
            const error = await ctx.waitFor(
                (activeContext) => activeContext.app.pages[invalidPage.id].editor.error,
                (message) => typeof message === "string" && message.length > 0,
            );
            ctx.expect(error.length > 0).toBe(true);
            ctx.expect(await ctx.app.pages[invalidPage.id].editor.svgUrl).toBe("");
        } finally {
            await closeMermaidPage(ctx, invalidPage);
            await closeMermaidPage(ctx, validPage);
        }
    }),

    test("look and layout choices stay with their page across editor switches", async (ctx) => {
        let page;
        let freshPage;
        const folder = "us-2045/options";
        try {
            page = await openMermaidPage(ctx, folder, "options.mmd", validDiagram);
            await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].editor.loading, (loading) => loading === false);
            ctx.expect(await waitForDiagramImage(ctx, page)).toBe(true);

            const pageSlot = `[data-page-id="${page.id}"]`;
            const classicState = await renderedDiagramState(ctx, page);
            ctx.expect(await selectedMenuItem(ctx, page, "mermaid-look", "mermaid-look-handDrawn")).toBe(false);
            await ctx.app.window.screen.click(`${pageSlot} [data-name="mermaid-look"]`);
            await ctx.app.window.screen.click('[data-name="mermaid-look-handDrawn"]');
            ctx.expect(await selectedMenuItem(ctx, page, "mermaid-look", "mermaid-look-handDrawn")).toBe(true);
            const handDrawnState = await ctx.waitFor(
                (activeContext) => renderedDiagramState(activeContext, page),
                (state) => state.hash !== classicState.hash && state.handDrawn,
            );

            ctx.expect(await selectedMenuItem(ctx, page, "mermaid-layout", "mermaid-layout-elk")).toBe(false);
            await ctx.app.window.screen.click(`${pageSlot} [data-name="mermaid-layout"]`);
            await ctx.app.window.screen.click('[data-name="mermaid-layout-elk"]');
            ctx.expect(await selectedMenuItem(ctx, page, "mermaid-layout", "mermaid-layout-elk")).toBe(true);
            const elkState = await ctx.waitFor(
                (activeContext) => renderedDiagramState(activeContext, page),
                (state) => state.hash !== handDrawnState.hash,
            );
            ctx.expect(elkState.hash !== handDrawnState.hash).toBe(true);

            await ctx.app.pages[page.id].editorSwitches.switchTo("monaco");
            await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].editor.id, (editor) => editor === "monaco");
            await ctx.app.pages[page.id].editorSwitches.switchTo("mermaid-view");
            await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].editor.id, (editor) => editor === "mermaid-view");
            await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].editor.loading, (loading) => loading === false);
            ctx.expect(await selectedMenuItem(ctx, page, "mermaid-look", "mermaid-look-handDrawn")).toBe(true);
            ctx.expect(await selectedMenuItem(ctx, page, "mermaid-layout", "mermaid-layout-elk")).toBe(true);

            freshPage = await openMermaidPage(ctx, folder, "fresh.mmd", validDiagram);
            await ctx.waitFor((activeContext) => activeContext.app.pages[freshPage.id].editor.loading, (loading) => loading === false);
            ctx.expect(await selectedMenuItem(ctx, freshPage, "mermaid-look", "mermaid-look-classic")).toBe(true);
            ctx.expect(await selectedMenuItem(ctx, freshPage, "mermaid-layout", "mermaid-layout-dagre")).toBe(true);
        } finally {
            await closeMermaidPage(ctx, freshPage);
            await closeMermaidPage(ctx, page);
        }
    }),

    test("Mermaid PNG export writes a non-empty PNG and copy completes", async (ctx) => {
        let page;
        try {
            page = await openMermaidPage(ctx, "us-2045/image-actions", "export.mmd", validDiagram);
            await ctx.waitFor((activeContext) => activeContext.app.pages[page.id].editor.loading, (loading) => loading === false);
            ctx.expect(await waitForDiagramImage(ctx, page)).toBe(true);

            const pngPath = ctx.fixture("us-2045/image-actions/export.png");
            ctx.expect(await ctx.app.pages[page.id].editor.savePngToFile(pngPath)).toBe(pngPath);
            const pngInfo = await ctx.app.fs.stat(pngPath);
            ctx.expect(pngInfo.size > 8).toBe(true);
            const pngSummary = JSON.parse(await ctx.script(`
                const bytes = await app.fs.readBinary(${JSON.stringify(pngPath)});
                return JSON.stringify({ size: bytes.length, signature: Array.from(bytes.subarray(0, 8)) });
            `));
            ctx.expect(pngSummary.size > 8).toBe(true);
            ctx.expect(pngSummary.signature).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);

            ctx.expect(await ctx.app.pages[page.id].editor.copyImageToClipboard()).toBe(null);
        } finally {
            await closeMermaidPage(ctx, page);
        }
    }),
];
