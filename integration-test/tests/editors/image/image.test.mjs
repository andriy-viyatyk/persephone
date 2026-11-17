import { test } from "../../../lib/context.mjs";
import { closePage, makePng, openImagePage } from "../helpers.mjs";

const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];

async function readPngSummary(ctx, path) {
    return JSON.parse(await ctx.script(`
        const bytes = await app.fs.readBinary(${JSON.stringify(path)});
        return JSON.stringify({ size: bytes.length, signature: Array.from(bytes.subarray(0, 8)) });
    `));
}

async function zoomText(ctx, page) {
    return ctx.call("window.screen.evaluate", [
        `() => document.querySelector('[data-page-id="${page.id}"] [data-type="image-view"] [data-part="zoom-indicator"]')?.textContent ?? ""`,
    ]);
}

export default [
    test("Image Viewer reads dimensions and bounds a large image", async (ctx) => {
        let page;
        try {
            page = await openImagePage(ctx, "us-2049/image/read", "wide.png", makePng(64, 32));
            const full = JSON.parse(await ctx.script(`
                const image = await page.editor.read();
                return JSON.stringify({ width: image.width, height: image.height, originalWidth: image.originalWidth, originalHeight: image.originalHeight, mimeType: image.mimeType });
            `));
            ctx.expect(full.width).toBe(64);
            ctx.expect(full.height).toBe(32);
            ctx.expect(full.originalWidth).toBe(64);
            ctx.expect(full.originalHeight).toBe(32);
            ctx.expect(full.mimeType).toBe("image/png");

            const bounded = JSON.parse(await ctx.script(`
                const image = await page.editor.read({ maxDimension: 16 });
                return JSON.stringify({ width: image.width, height: image.height, originalWidth: image.originalWidth, originalHeight: image.originalHeight });
            `));
            ctx.expect(bounded.width).toBe(16);
            ctx.expect(bounded.height).toBe(8);
            ctx.expect(bounded.originalWidth).toBe(64);
            ctx.expect(bounded.originalHeight).toBe(32);
        } finally {
            await closePage(ctx, page?.id);
        }
    }),

    test("Image Viewer zooms in, zooms out and resets to fit", async (ctx) => {
        let page;
        try {
            page = await openImagePage(ctx, "us-2049/image/zoom", "graphic.png", makePng(64, 32));
            const initial = await ctx.waitFor((activeContext) => zoomText(activeContext, page), (value) => value.endsWith("%"));
            await ctx.call("window.screen.pressKey", ["=", { target: '[data-type="image-view"]' }]);
            const zoomedIn = await ctx.waitFor((activeContext) => zoomText(activeContext, page), (value) => value !== initial);
            ctx.expect(Number.parseInt(zoomedIn, 10) > Number.parseInt(initial, 10)).toBe(true);

            await ctx.call("window.screen.pressKey", ["-", { target: '[data-type="image-view"]' }]);
            const zoomedOut = await ctx.waitFor((activeContext) => zoomText(activeContext, page), (value) => value !== zoomedIn);
            ctx.expect(Number.parseInt(zoomedOut, 10) < Number.parseInt(zoomedIn, 10)).toBe(true);

            await ctx.call("window.screen.pressKey", ["=", { target: '[data-type="image-view"]' }]);
            await ctx.call("window.screen.pressKey", ["=", { target: '[data-type="image-view"]' }]);
            const zoomedFurther = await ctx.waitFor((activeContext) => zoomText(activeContext, page), (value) => Number.parseInt(value, 10) > Number.parseInt(initial, 10));
            ctx.expect(zoomedFurther).toBeTruthy();
            await ctx.call("window.screen.pressKey", ["0", { target: '[data-type="image-view"]' }]);
            ctx.expect(await ctx.waitFor((activeContext) => zoomText(activeContext, page), (value) => value === initial)).toBe(initial);
        } finally {
            await closePage(ctx, page?.id);
        }
    }),

    test("Image Viewer saves a PNG and copies the image", async (ctx) => {
        let page;
        try {
            page = await openImagePage(ctx, "us-2049/image/export", "source.png", makePng(8, 4));
            await ctx.call("window.screen.click", [`[data-page-id="${page.id}"] [data-name="image-save"]`]);
            const saveMenu = await ctx.waitFor(
                (activeContext) => activeContext.callText("window.screen.snapshot", [{ maxChars: 12000 }]),
                (snapshot) => snapshot.includes("Save as .png") && snapshot.includes("Save original"),
            );
            ctx.expect(saveMenu).toContain("Save original");
            const pngPath = ctx.fixture("us-2049/image/export/exported.png");
            ctx.expect(await ctx.call(`${page.root}.editor.savePngToFile`, [pngPath])).toBe(pngPath);
            const summary = await readPngSummary(ctx, pngPath);
            ctx.expect(summary.size > 8).toBe(true);
            ctx.expect(summary.signature).toEqual(pngSignature);
            ctx.expect(await ctx.call(`${page.root}.editor.copyImageToClipboard`, [])).toBe(null);
        } finally {
            await closePage(ctx, page?.id);
        }
    }),

    test("Image Viewer opens an HTTP image from the fixture server", async (ctx) => {
        const url = ctx.httpUrl("/image.png");
        let pageId;
        try {
            await ctx.call("pages.openUrl", [url]);
            const imagePage = await ctx.waitFor(
                async (activeContext) => {
                    const pages = await activeContext.call("pages.all");
                    return pages.find((entry) => entry.filePath === url && entry.editor === "image-view");
                },
                (entry) => entry !== undefined,
            );
            pageId = imagePage.id;
            const root = `pages[${JSON.stringify(pageId)}]`;
            ctx.expect(await ctx.waitFor(`${root}.editor.id`, (editor) => editor === "image-view")).toBe("image-view");
            const dimensions = JSON.parse(await ctx.script(`
                const image = await page.editor.read({ maxDimension: 16 });
                return JSON.stringify({ width: image.width, height: image.height, originalWidth: image.originalWidth, originalHeight: image.originalHeight });
            `));
            ctx.expect(dimensions.width).toBe(2);
            ctx.expect(dimensions.height).toBe(2);
            ctx.expect(dimensions.originalWidth).toBe(2);
            ctx.expect(dimensions.originalHeight).toBe(2);
            ctx.expect(await ctx.call(`${root}.editor.source`)).toBe(url);
        } finally {
            if (!pageId) {
                const existing = (await ctx.call("pages.all")).find((entry) => entry.filePath === url && entry.editor === "image-view");
                pageId = existing?.id;
            }
            await closePage(ctx, pageId);
        }
    }),
];
