import { test } from "../../../lib/context.mjs";
import { closeEditorPage, closePage, openHtmlPage, waitForDrawingToastToClear } from "../helpers.mjs";

const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];

async function renderedSnapshot(ctx) {
    return ctx.callText("window.screen.snapshot", [{ maxChars: 12000 }]);
}

async function readPngSummary(ctx, path) {
    return JSON.parse(await ctx.script(`
        const bytes = await app.fs.readBinary(${JSON.stringify(path)});
        return JSON.stringify({ size: bytes.length, signature: Array.from(bytes.subarray(0, 8)) });
    `));
}

export default [
    test("HTML Preview runs scripts and reflects source edits", async (ctx) => {
        const initial = [
            "<!doctype html>",
            "<html><body><h1>Original heading</h1><p id=\"result\">Before script</p>",
            "<script>document.querySelector('#result').textContent = 'Script ran';</script>",
            "</body></html>",
            "",
        ].join("\n");
        const updated = initial.replace("Original heading", "Updated heading");
        let page;
        try {
            page = await openHtmlPage(ctx, "us-2048/html/live-edit", "page.html", initial);
            ctx.expect(await ctx.call(`${page.root}.editor.id`)).toBe("html-view");
            ctx.expect(await ctx.call(`${page.root}.editor.viewMounted`)).toBe(true);
            ctx.expect(await ctx.call(`${page.root}.editor.html`)).toBe(initial);

            const scriptSnapshot = await ctx.waitFor(
                (activeContext) => activeContext.callText("window.screen.snapshot", [{ maxChars: 12000 }]),
                (snapshot) => snapshot.includes("Script ran"),
            );
            ctx.expect(scriptSnapshot).toContain("Original heading");

            await ctx.call(`${page.root}.editorSwitches.switchTo`, ["monaco"]);
            await ctx.waitFor(`${page.root}.editor.id`, (editor) => editor === "monaco");
            await ctx.call("window.screen.pressKey", ["Control+a", { target: ".monaco-editor-host-root .monaco-editor" }]);
            await ctx.call(`${page.root}.editor.replaceSelection`, [updated]);
            ctx.expect(await ctx.waitFor(
                (activeContext) => activeContext.callText(`${page.root}.content`),
                (content) => content === updated,
            )).toBe(updated);

            await ctx.call(`${page.root}.editorSwitches.switchTo`, ["html-view"]);
            await ctx.waitFor(`${page.root}.editor.id`, (editor) => editor === "html-view");
            const updatedSnapshot = await ctx.waitFor(
                (activeContext) => renderedSnapshot(activeContext),
                (snapshot) => snapshot.includes("Updated heading"),
            );
            ctx.expect(updatedSnapshot).toContain("Script ran");
            ctx.expect(await ctx.call(`${page.root}.modified`)).toBe(true);
        } finally {
            await closeEditorPage(ctx, page);
        }
    }),

    test("plain local HTML loads a relative image resource", async (ctx) => {
        const folder = "us-2048/html/local-resources";
        const image = [
            '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">',
            '<title>Local resource graphic</title><rect width="24" height="24" fill="green"/>',
            "</svg>",
            "",
        ].join("\n");
        const html = [
            '<!doctype html><html><body><img id="graphic" src="./graphic.svg" alt="Relative graphic">',
            '<p id="status">Waiting for relative image</p>',
            '<script>const image=document.querySelector("#graphic");const status=document.querySelector("#status");',
            'const report=()=>{status.textContent=image.naturalWidth>0?"Relative image loaded":"Relative image failed"};',
            'image.addEventListener("load",report);image.addEventListener("error",report);if(image.complete)report();</script>',
            "</body></html>",
            "",
        ].join("\n");
        await ctx.call("fs.write", [ctx.fixture(`${folder}/graphic.svg`), image]);
        let page;
        try {
            page = await openHtmlPage(ctx, folder, "page.html", html);
            const snapshot = await ctx.waitFor(
                (activeContext) => renderedSnapshot(activeContext),
                (value) => value.includes("Relative image loaded"),
            );
            ctx.expect(snapshot).toContain("Relative graphic");
            ctx.expect(snapshot).toContain("Relative image loaded");
        } finally {
            await closeEditorPage(ctx, page);
        }
    }),

    test("Show Resources opens a collection containing page resources", async (ctx) => {
        const folder = "us-2048/html/resources";
        const source = [
            '<!doctype html><html><head><link rel="stylesheet" href="styles/site.css">',
            '<script src="scripts/page.js"></script></head><body>',
            '<img src="images/logo.svg" alt="Logo"><a href="https://example.invalid/docs">Docs</a>',
            "</body></html>",
            "",
        ].join("\n");
        let page;
        const existingIds = new Set((await ctx.call("pages.all")).map((entry) => entry.id));
        let pageIds = new Set();
        try {
            page = await openHtmlPage(ctx, folder, "index.html", source);
            pageIds.add(page.id);
            await ctx.call(`${page.root}.editorSwitches.switchTo`, ["monaco"]);
            await ctx.waitFor(`${page.root}.editor.id`, (editor) => editor === "monaco");
            const countBefore = (await ctx.call("pages.all")).length;
            const resourceButton = (await ctx.call(`${page.root}.editor.elements`))
                .find((element) => element.name === "text-show-resources");
            ctx.expect(resourceButton.visible).toBe(true);
            await waitForDrawingToastToClear(ctx);
            await ctx.call("window.screen.click", [`[data-page-id="${page.id}"] [data-name="text-show-resources"]`]);
            const pagesAfterClick = await ctx.waitFor(
                async (activeContext) => {
                    const pages = await activeContext.call("pages.all");
                    pageIds = new Set([...pageIds, ...pages.filter((entry) => !existingIds.has(entry.id)).map((entry) => entry.id)]);
                    return pages;
                },
                (pages) => pages.some((entry) => entry.title.includes("Resources") && entry.editor === "link-view"),
            );
            const collection = pagesAfterClick.find((entry) => !existingIds.has(entry.id)
                && entry.title.includes("Resources") && entry.editor === "link-view");
            ctx.expect(collection).toBeTruthy();
            ctx.expect(collection.title).toContain("Resources");
            ctx.expect(collection.editor).toBe("link-view");
            const snapshot = await ctx.callText("window.screen.snapshot", [{ maxChars: 12000 }]);
            ctx.expect(snapshot).toContain("Stylesheets 1");
            ctx.expect(snapshot).toContain("Scripts 1");
            ctx.expect(snapshot).toContain("Images 1");
            ctx.expect(snapshot).toContain("Links 1");
            ctx.expect(snapshot).toContain("site.css");
            ctx.expect(snapshot).toContain("page.js");
            ctx.expect(snapshot).toContain("Logo");
            ctx.expect(snapshot).toContain("Docs");
        } finally {
            for (const pageId of pageIds) {
                if (pageId !== page?.id) await closePage(ctx, pageId);
            }
            await closeEditorPage(ctx, page);
        }
    }),

    test("HTML capture saves a PNG and copy completes", async (ctx) => {
        let page;
        try {
            page = await openHtmlPage(ctx, "us-2048/html/capture", "page.html", "<!doctype html><h1>Capture this page</h1>\n");
            await ctx.waitFor(`${page.root}.editor.viewMounted`, (mounted) => mounted === true);
            const pngPath = ctx.fixture("us-2048/html/capture/page.png");
            ctx.expect(await ctx.call(`${page.root}.editor.savePngToFile`, [pngPath])).toBe(pngPath);
            const summary = await readPngSummary(ctx, pngPath);
            ctx.expect(summary.size > 8).toBe(true);
            ctx.expect(summary.signature).toEqual(pngSignature);
            ctx.expect(await ctx.call(`${page.root}.editor.copyImageToClipboard`, [])).toBe(null);
        } finally {
            await closeEditorPage(ctx, page);
        }
    }),
];
