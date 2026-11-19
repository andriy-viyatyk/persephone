import { test } from "../../../lib/context.mjs";
import { closePublishedSample, openPublishedSample } from "../helpers.mjs";
import { writeBrokenPowerPointSample, writePowerPointSample } from "../office-samples.mjs";

async function waitForPowerPointModel(ctx, pageId) {
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
    test("opens and renders both PowerPoint slides", async (ctx) => {
        await writePowerPointSample(ctx);
        let handle;
        try {
            handle = await openPublishedSample(ctx, "powerpoint-viewer", "powerpoint-viewer/sample.pptx");
            await waitForPowerPointModel(ctx, handle.id);
            const editor = ctx.app.pages[handle.id].editor;
            const stats = await editor.app.getStats();
            const outline = await editor.app.getOutline();
            ctx.expect(stats.slideCount).toBe(2);
            ctx.expect(outline.map((slide) => slide.title)).toEqual(["Sample Overview", "Sample Details"]);
            ctx.expect(await editor.evaluate("() => document.querySelectorAll('#slides .pptx-preview-slide-wrapper').length")).toBe(2);
        } finally {
            await closePublishedSample(ctx, handle);
        }
    }, { requires: ["launch", "published-board-checkout"] }),

    test("reads titles and text from both slides", async (ctx) => {
        await writePowerPointSample(ctx);
        let handle;
        try {
            handle = await openPublishedSample(ctx, "powerpoint-viewer", "powerpoint-viewer/sample.pptx");
            await waitForPowerPointModel(ctx, handle.id);
            const markdown = await ctx.callText(modelPath(handle.id, "getMarkdown"), [1, 2, { notes: false }]);
            ctx.expect(markdown).toContain("Sample Overview");
            ctx.expect(markdown).toContain("First slide text.");
            ctx.expect(markdown).toContain("Sample Details");
            ctx.expect(markdown).toContain("Second slide text.");
            ctx.expect(markdown.indexOf("Sample Overview") < markdown.indexOf("Sample Details")).toBe(true);
        } finally {
            await closePublishedSample(ctx, handle);
        }
    }, { requires: ["launch", "published-board-checkout"] }),

    test("moves the viewer to slide two", async (ctx) => {
        await writePowerPointSample(ctx);
        let handle;
        try {
            handle = await openPublishedSample(ctx, "powerpoint-viewer", "powerpoint-viewer/sample.pptx");
            await waitForPowerPointModel(ctx, handle.id);
            ctx.expect(await ctx.app.pages[handle.id].editor.app.goToSlide(2)).toBe(2);
            ctx.expect(await ctx.waitFor(
                modelPath(handle.id, "currentSlide"),
                (slide) => slide === 2,
                { timeout: 15000 },
            )).toBe(2);
        } finally {
            await closePublishedSample(ctx, handle);
        }
    }, { requires: ["launch", "published-board-checkout"] }),

    test("reports a parse error for a broken PowerPoint deck", async (ctx) => {
        await writeBrokenPowerPointSample(ctx);
        let handle;
        try {
            handle = await openPublishedSample(ctx, "powerpoint-viewer", "powerpoint-viewer/broken.pptx");
            const errorPath = modelPath(handle.id, "error");
            const error = await ctx.waitFor(errorPath, (value) => typeof value === "string" && value.length > 0, { timeout: 15000 });
            ctx.expect(typeof error).toBe("string");
            ctx.expect(error.length).toBeGreaterThan(0);
            const editor = ctx.app.pages[handle.id].editor;
            ctx.expect(await editor.app.isLoaded).toBe(false);
            const state = await editor.evaluate("() => { const element = document.querySelector('#state'); return { visible: element.classList.contains('show'), text: element.innerText.trim() }; }");
            ctx.expect(state.visible).toBe(true);
            ctx.expect(state.text === "This deck has no slides.").toBe(false);
        } finally {
            await closePublishedSample(ctx, handle);
        }
    }, { requires: ["launch", "published-board-checkout"] }),
];
