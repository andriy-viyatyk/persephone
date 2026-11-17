import { test } from "../../../lib/context.mjs";
import { closeEditorPage, closePage, openSvgPage, waitForDrawingToastToClear } from "../helpers.mjs";

const initialSvg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80">',
    '<rect width="120" height="80" fill="blue"/><text x="8" y="45">Original label</text>',
    "</svg>",
    "",
].join("\n");
const updatedSvg = initialSvg.replace("Original label", "Updated label");
const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];

async function readPngSummary(ctx, path) {
    return JSON.parse(await ctx.script(`
        const bytes = await app.fs.readBinary(${JSON.stringify(path)});
        return JSON.stringify({ size: bytes.length, signature: Array.from(bytes.subarray(0, 8)) });
    `));
}

export default [
    test("SVG Preview zooms in and resets to fit", async (ctx) => {
        let page;
        try {
            page = await openSvgPage(ctx, "us-2048/svg/zoom", "graphic.svg", initialSvg);
            const initialSnapshot = await ctx.waitFor(
                (activeContext) => activeContext.callText("window.screen.snapshot", [{ maxChars: 12000 }]),
                (snapshot) => snapshot.includes('image "SVG Preview"') && snapshot.includes('generic "100%"'),
            );
            ctx.expect(initialSnapshot).toContain('generic "100%"');

            await ctx.call("window.screen.pressKey", ["=", { target: "[data-type=\"image-view\"]" }]);
            const zoomedSnapshot = await ctx.waitFor(
                (activeContext) => activeContext.callText("window.screen.snapshot", [{ maxChars: 12000 }]),
                (snapshot) => snapshot.includes('generic "120%"'),
            );
            ctx.expect(zoomedSnapshot).toContain('generic "120%"');

            await ctx.call("window.screen.pressKey", ["0", { target: "[data-type=\"image-view\"]" }]);
            const resetSnapshot = await ctx.waitFor(
                (activeContext) => activeContext.callText("window.screen.snapshot", [{ maxChars: 12000 }]),
                (snapshot) => snapshot.includes('generic "100%"'),
            );
            ctx.expect(resetSnapshot).toContain('generic "100%"');
        } finally {
            await closeEditorPage(ctx, page);
        }
    }),

    test("SVG Preview renders unsaved source edits", async (ctx) => {
        let page;
        try {
            page = await openSvgPage(ctx, "us-2048/svg/live-edit", "graphic.svg", initialSvg);
            ctx.expect(await ctx.call(`${page.root}.editor.id`)).toBe("svg-view");
            ctx.expect(await ctx.call(`${page.root}.editor.svg`)).toBe(initialSvg);
            ctx.expect(await ctx.call(`${page.root}.editor.viewMounted`)).toBe(true);

            await ctx.call(`${page.root}.editorSwitches.switchTo`, ["monaco"]);
            await ctx.waitFor(`${page.root}.editor.id`, (editor) => editor === "monaco");
            await ctx.call("window.screen.pressKey", ["Control+a", { target: ".monaco-editor-host-root .monaco-editor" }]);
            await ctx.call(`${page.root}.editor.replaceSelection`, [updatedSvg]);
            ctx.expect(await ctx.waitFor(
                (activeContext) => activeContext.callText(`${page.root}.content`),
                (content) => content === updatedSvg,
            )).toBe(updatedSvg);

            await ctx.call(`${page.root}.editorSwitches.switchTo`, ["svg-view"]);
            await ctx.waitFor(`${page.root}.editor.id`, (editor) => editor === "svg-view");
            ctx.expect(await ctx.call(`${page.root}.editor.svg`)).toBe(updatedSvg);
            const renderedImageSource = await ctx.waitFor(
                (activeContext) => activeContext.call("window.screen.evaluate", [
                    '() => document.querySelector(\'[data-type="image-view"] img\')?.getAttribute("src") ?? ""',
                ]),
                (source) => source.startsWith("data:image/svg+xml,")
                    && decodeURIComponent(source).includes("Updated label"),
            );
            ctx.expect(decodeURIComponent(renderedImageSource)).toContain("Updated label");
            ctx.expect(await ctx.call(`${page.root}.modified`)).toBe(true);
        } finally {
            await closeEditorPage(ctx, page);
        }
    }),

    test("SVG PNG export writes a valid image and copy completes", async (ctx) => {
        let page;
        try {
            page = await openSvgPage(ctx, "us-2048/svg/export", "graphic.svg", initialSvg);
            const pngPath = ctx.fixture("us-2048/svg/export/graphic.png");
            ctx.expect(await ctx.call(`${page.root}.editor.savePngToFile`, [pngPath])).toBe(pngPath);
            const summary = await readPngSummary(ctx, pngPath);
            ctx.expect(summary.size > 8).toBe(true);
            ctx.expect(summary.signature).toEqual(pngSignature);
            ctx.expect(await ctx.call(`${page.root}.editor.copyImageToClipboard`, [])).toBe(null);
        } finally {
            await closeEditorPage(ctx, page);
        }
    }),

    test("Open in Drawing follows the available image editor", async (ctx) => {
        let page;
        let drawingPage;
        try {
            page = await openSvgPage(ctx, "us-2048/svg/drawing", "graphic.svg", initialSvg);
            const pagesBefore = await ctx.call("pages.all");
            await waitForDrawingToastToClear(ctx);
            let actionError;
            try {
                await ctx.call(`${page.root}.editor.openInDrawingEditor`, []);
            } catch (error) {
                actionError = String(error);
            }

            const pagesAfterAction = await ctx.call("pages.all");
            drawingPage = pagesAfterAction.find((entry) => !pagesBefore.some((previous) => previous.id === entry.id));
            if (actionError?.includes("No image editor is registered")) {
                await ctx.call("window.screen.click", [`[data-page-id="${page.id}"] [data-name="svg-open-draw"]`]);
                const snapshot = await ctx.waitFor(
                    (activeContext) => activeContext.callText("window.screen.snapshot", [{ maxChars: 12000 }]),
                    (value) => value.includes("No image editor is registered."),
                );
                ctx.expect(snapshot).toContain("No image editor is registered. Enable the board in Tools & Editors or install a replacement.");
                await waitForDrawingToastToClear(ctx);
            } else {
                ctx.expect(actionError).toBe(undefined);
                ctx.expect(drawingPage).toBeTruthy();
                ctx.expect(drawingPage.editor).toBeTruthy();
            }
        } finally {
            if (drawingPage) await closePage(ctx, drawingPage.id);
            await closeEditorPage(ctx, page);
        }
    }),
];
