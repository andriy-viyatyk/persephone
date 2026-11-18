import { test } from "../../../lib/context.mjs";
import { closePublishedSample, openPublishedSample, samePublishedRoot } from "../helpers.mjs";

export default [
    test("font viewer opens metadata and previews the sample font", async (ctx) => {
        const handle = await openPublishedSample(ctx, "font-viewer", "font-viewer/KaTeX_Main-Regular.ttf");
        try {
            const editor = ctx.app.pages[handle.id].editor;
            ctx.expect(samePublishedRoot(await editor.boardRoot, handle.root)).toBe(true);
            await ctx.waitFor(`pages[${JSON.stringify(handle.id)}].editor.frameReady`, (ready) => ready === true);
            await ctx.waitFor(() => editor.evaluate("() => document.querySelector('#viewer').hidden"), (hidden) => hidden === false, { timeout: 10000 });
            const state = await editor.evaluate("() => ({ family: document.querySelector('#family').innerText.trim(), style: document.querySelector('#subtitle').innerText.trim(), metadata: document.querySelector('#metadata').innerText, previewCount: document.querySelectorAll('#previews .preview-line').length, glyphCount: document.querySelectorAll('#glyph-grid .glyph').length })");
            ctx.expect(state.family).toBe("KaTeX_Main");
            ctx.expect(state.style).toBe("Regular");
            ctx.expect(state.metadata).toContain("Glyph count");
            ctx.expect(state.previewCount).toBe(3);
            ctx.expect(state.glyphCount > 0).toBe(true);
        } finally {
            await closePublishedSample(ctx, handle);
        }
    }, { requires: ["launch", "published-board-checkout"] }),

    test("font viewer renders its glyph page and Unicode coverage", async (ctx) => {
        const handle = await openPublishedSample(ctx, "font-viewer", "font-viewer/KaTeX_Main-Regular.ttf");
        try {
            const editor = ctx.app.pages[handle.id].editor;
            ctx.expect(samePublishedRoot(await editor.boardRoot, handle.root)).toBe(true);
            await ctx.waitFor(() => editor.evaluate("() => document.querySelectorAll('#glyph-grid .glyph').length"), (count) => count > 0, { timeout: 10000 });
            const state = await editor.evaluate("() => ({ count: document.querySelectorAll('#glyph-grid .glyph').length, canvas: (() => { const r = document.querySelector('#glyph-grid canvas').getBoundingClientRect(); return r.width > 0 && r.height > 0; })(), page: document.querySelector('#page').innerText, coverage: document.querySelector('#coverage').innerText })");
            ctx.expect(state.count <= 72).toBe(true);
            ctx.expect(state.canvas).toBe(true);
            ctx.expect(state.page.startsWith("1 / ")).toBe(true);
            ctx.expect(state.coverage.trim().length > 0).toBe(true);
        } finally {
            await closePublishedSample(ctx, handle);
        }
    }, { requires: ["launch", "published-board-checkout"] }),

    test("font viewer shows a visible error for a corrupt font", async (ctx) => {
        const handle = await openPublishedSample(ctx, "font-viewer", "font-viewer/corrupt.ttf");
        try {
            const editor = ctx.app.pages[handle.id].editor;
            ctx.expect(samePublishedRoot(await editor.boardRoot, handle.root)).toBe(true);
            await ctx.waitFor(() => editor.evaluate("() => document.querySelector('#state').classList.contains('error')"), (error) => error === true, { timeout: 10000 });
            const state = await editor.evaluate("() => ({ text: document.querySelector('#state').innerText, viewerHidden: document.querySelector('#viewer').hidden })");
            ctx.expect(state.text.includes("Could not open font:") || state.text.includes("Unsupported font format.")).toBe(true);
            ctx.expect(state.viewerHidden).toBe(true);
        } finally {
            await closePublishedSample(ctx, handle);
        }
    }, { requires: ["launch", "published-board-checkout"] }),
];
