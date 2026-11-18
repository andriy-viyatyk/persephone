import { test } from "../../../lib/context.mjs";
import { closePublishedSample, openPublishedSample } from "../helpers.mjs";
import { writeWordSample } from "../office-samples.mjs";

async function waitForWordModel(ctx, pageId) {
    return ctx.waitFor(
        async (activeContext) => {
            try {
                return await activeContext.app.pages[pageId].editor.app.isLoaded;
            } catch {
                return null;
            }
        },
        (loaded) => loaded === true,
        { timeout: 15000 },
    );
}

function modelPath(pageId, member) {
    return `pages[${JSON.stringify(pageId)}].editor.app.${member}`;
}

export default [
    test("opens and renders a DOCX through the published Word editor", async (ctx) => {
        await writeWordSample(ctx);
        let handle;
        try {
            handle = await openPublishedSample(ctx, "word-viewer", "word-viewer/sample.docx");
            await waitForWordModel(ctx, handle.id);
            const editor = ctx.app.pages[handle.id].editor;
            ctx.expect(await editor.app.pageCount).toBe(1);
            ctx.expect(await editor.evaluate("() => document.querySelectorAll('#doc section.docx').length")).toBeTruthy();
            ctx.expect(await editor.app.isLoaded).toBe(true);
        } finally {
            await closePublishedSample(ctx, handle);
        }
    }, { requires: ["launch", "published-board-checkout"] }),

    test("reads Word paragraphs as plain text", async (ctx) => {
        await writeWordSample(ctx);
        let handle;
        try {
            handle = await openPublishedSample(ctx, "word-viewer", "word-viewer/sample.docx");
            await waitForWordModel(ctx, handle.id);
            const text = await ctx.callText(modelPath(handle.id, "getText"), []);
            ctx.expect(text).toContain("Sample Heading");
            ctx.expect(text).toContain("First sample paragraph.");
            ctx.expect(text).toContain("Second sample paragraph.");
            ctx.expect(text.includes("# Sample Heading")).toBe(false);
        } finally {
            await closePublishedSample(ctx, handle);
        }
    }, { requires: ["launch", "published-board-checkout"] }),

    test("preserves Word heading structure in Markdown and outline", async (ctx) => {
        await writeWordSample(ctx);
        let handle;
        try {
            handle = await openPublishedSample(ctx, "word-viewer", "word-viewer/sample.docx");
            await waitForWordModel(ctx, handle.id);
            const markdown = await ctx.callText(modelPath(handle.id, "getMarkdown"), []);
            const outline = await ctx.app.pages[handle.id].editor.app.getOutline();
            ctx.expect(markdown).toContain("# Sample Heading");
            ctx.expect(markdown).toContain("First sample paragraph.");
            ctx.expect(markdown).toContain("Second sample paragraph.");
            ctx.expect(outline).toEqual([{ title: "Sample Heading", level: 1, page: 1 }]);
        } finally {
            await closePublishedSample(ctx, handle);
        }
    }, { requires: ["launch", "published-board-checkout"] }),
];
