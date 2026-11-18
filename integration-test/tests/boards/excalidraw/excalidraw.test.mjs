import { test } from "../../../lib/context.mjs";
import { closeBoardPage } from "../helpers.mjs";

const drawingFixture = "boards/excalidraw/draw.excalidraw";
const seedScene = `{
  "type": "excalidraw",
  "version": 2,
  "source": "https://excalidraw.com",
  "elements": [{
    "id": "us2097-rectangle",
    "type": "rectangle",
    "x": 20,
    "y": 30,
    "width": 120,
    "height": 80,
    "angle": 0,
    "strokeColor": "#1e1e1e",
    "backgroundColor": "#ffffff",
    "fillStyle": "solid",
    "strokeWidth": 2,
    "strokeStyle": "solid",
    "roughness": 1,
    "opacity": 100,
    "groupIds": [],
    "frameId": null,
    "index": "a0",
    "roundness": { "type": 3 },
    "seed": 2097,
    "version": 1,
    "versionNonce": 2097,
    "isDeleted": false,
    "boundElements": [],
    "updated": 0,
    "link": null,
    "locked": false
  }],
  "appState": {
    "viewBackgroundColor": "#ffffff",
    "gridSize": null,
    "zoom": { "value": 1 }
  },
  "files": {}
}`;

async function resetDrawing(ctx) {
    const filePath = ctx.fixture(drawingFixture);
    await ctx.app.fs.write(filePath, seedScene);
    return filePath;
}

async function waitForBoardFrame(ctx, pageId) {
    return ctx.waitFor(
        `pages[${JSON.stringify(pageId)}].editor.frameReady`,
        (value) => value === true,
        { timeout: 15000 },
    );
}

async function waitForRemoteModelValue(ctx, pageId, member, predicate = Boolean) {
    return ctx.waitFor(
        async (activeContext) => {
            try {
                return await activeContext.app.pages[pageId].editor.app[member];
            } catch {
                return null;
            }
        },
        predicate,
        { timeout: 15000 },
    );
}

async function readImageDataUrl(ctx) {
    const imagePath = ctx.fixture("http/image.png");
    return ctx.script(`
        const bytes = await app.fs.readBinary(${JSON.stringify(imagePath)});
        return "data:image/png;base64," + bytes.toString("base64");
    `);
}

async function closePage(ctx, pageId) {
    try {
        await closeBoardPage(ctx, pageId);
    } catch {
        // Cleanup must not hide the test result.
    }
}

function samePageIds(actual, expected) {
    return actual.length === expected.length && expected.every((id) => actual.includes(id));
}

export default [
    test("opening an Excalidraw fixture loads its drawing without a trust prompt", async (ctx) => {
        const filePath = await resetDrawing(ctx);
        let pageId;
        try {
            pageId = (await ctx.app.pages.openFile(filePath)).id;
            const editor = ctx.app.pages[pageId].editor;
            const boardRoot = await editor.boardRoot;

            ctx.expect(await editor.id).toBe(`board-editor:${boardRoot}`);
            ctx.expect(await editor.renderState).toBe("bundled");
            ctx.expect(await waitForBoardFrame(ctx, pageId)).toBe(true);
            ctx.expect(await waitForRemoteModelValue(ctx, pageId, "elementCount", (count) => count === 1)).toBe(1);

            let dialogTitle = null;
            try {
                dialogTitle = await ctx.callText("dialogs[0].title", undefined, { dialog: true });
            } catch {
                // No dialogs, or no first dialog, is the expected bundled-board behavior.
            }
            ctx.expect(dialogTitle).toBe(null);
        } finally {
            await closePage(ctx, pageId);
        }
    }),

    test("adding an image marks the drawing dirty and save writes it to the fixture", async (ctx) => {
        const filePath = await resetDrawing(ctx);
        const dataUrl = await readImageDataUrl(ctx);
        let pageId;
        try {
            pageId = (await ctx.app.pages.openFile(filePath)).id;
            await waitForBoardFrame(ctx, pageId);
            await waitForRemoteModelValue(ctx, pageId, "editorIsMounted", (mounted) => mounted === true);

            const editor = ctx.app.pages[pageId].editor;
            ctx.expect(await waitForRemoteModelValue(ctx, pageId, "elementCount", (count) => count === 1)).toBe(1);
            await editor.app.addImage(dataUrl, { x: 40, y: 60 });
            ctx.expect(await waitForRemoteModelValue(ctx, pageId, "elementCount", (count) => count === 2)).toBe(2);
            await ctx.waitFor(`pages[${JSON.stringify(pageId)}].modified`, (modified) => modified === true);

            await ctx.app.pages[pageId].editorSwitches.switchTo("monaco");
            await ctx.app.pages[pageId].editor.saveFile();
            await ctx.waitFor(`pages[${JSON.stringify(pageId)}].modified`, (modified) => modified === false);
            ctx.expect(await ctx.app.pages[pageId].modified).toBe(false);

            const savedScene = JSON.parse(await ctx.callText("fs.read", [filePath]));
            ctx.expect(savedScene.elements.length).toBe(2);
            const savedTypes = savedScene.elements.map((element) => element.type);
            ctx.expect(savedTypes).toContain("rectangle");
            ctx.expect(savedTypes).toContain("image");
            ctx.expect(Object.keys(savedScene.files).length > 0).toBe(true);
        } finally {
            await closePage(ctx, pageId);
        }
    }),

    test("switching an edited drawing to text and back preserves its scene", async (ctx) => {
        const filePath = await resetDrawing(ctx);
        const dataUrl = await readImageDataUrl(ctx);
        let pageId;
        try {
            pageId = (await ctx.app.pages.openFile(filePath)).id;
            await waitForBoardFrame(ctx, pageId);
            await waitForRemoteModelValue(ctx, pageId, "editorIsMounted", (mounted) => mounted === true);

            const editor = ctx.app.pages[pageId].editor;
            const boardRoot = await editor.boardRoot;
            await editor.app.addImage(dataUrl, { x: 40, y: 60 });
            await ctx.waitFor(`pages[${JSON.stringify(pageId)}].modified`, (modified) => modified === true);
            await ctx.app.pages[pageId].editorSwitches.switchTo("monaco");

            const textScene = JSON.parse(await ctx.callText(`pages[${JSON.stringify(pageId)}].content`));
            ctx.expect(textScene.elements.length).toBe(2);
            const textTypes = textScene.elements.map((element) => element.type);
            ctx.expect(textTypes).toContain("rectangle");
            ctx.expect(textTypes).toContain("image");
            ctx.expect(Object.keys(textScene.files).length > 0).toBe(true);

            await ctx.app.pages[pageId].editorSwitches.switchTo(`board-editor:${boardRoot}`);
            ctx.expect(await waitForBoardFrame(ctx, pageId)).toBe(true);
            ctx.expect(await waitForRemoteModelValue(ctx, pageId, "elementCount", (count) => count === 2)).toBe(2);
        } finally {
            // The edited drawing is unsaved: the runner's per-test cleanup closes it and answers Don't Save.
        }
    }),

    test("opening the bundled board creates a mounted empty drawing", async (ctx) => {
        const filePath = await resetDrawing(ctx);
        let filePageId;
        let boardPageId;
        try {
            filePageId = (await ctx.app.pages.openFile(filePath)).id;
            await waitForBoardFrame(ctx, filePageId);
            const boardRoot = await ctx.app.pages[filePageId].editor.boardRoot;
            await closePage(ctx, filePageId);
            filePageId = null;

            await ctx.app.boards.openBoard(boardRoot);
            boardPageId = await ctx.app.pages.activePage.id;
            await waitForBoardFrame(ctx, boardPageId);
            ctx.expect(await waitForRemoteModelValue(ctx, boardPageId, "editorIsMounted", (mounted) => mounted === true)).toBe(true);
            ctx.expect(await waitForRemoteModelValue(ctx, boardPageId, "elementCount", (count) => count === 0)).toBe(0);
        } finally {
            await closePage(ctx, filePageId);
            await closePage(ctx, boardPageId);
        }
    }),

    test("image.edit opens the fixture PNG in a new Excalidraw page", async (ctx) => {
        const dataUrl = await readImageDataUrl(ctx);
        const capability = ctx.app.capabilities["image.edit"];
        ctx.expect(await capability.$help).toContain("open");
        const result = await capability.open({ dataUrl, title: "US-2097 fixture image", mimeType: "image/png" });
        const pageId = result.pageId;

        // Runner cleanup closes this untitled drawing and handles its unsaved-changes prompt.
        await waitForBoardFrame(ctx, pageId);
        await waitForRemoteModelValue(ctx, pageId, "editorIsMounted", (mounted) => mounted === true);
        ctx.expect(await waitForRemoteModelValue(ctx, pageId, "elementCount", (count) => count === 1)).toBe(1);
    }),

    test("diagram.edit converts valid Mermaid source into editable Excalidraw elements", async (ctx) => {
        await resetDrawing(ctx);
        const capability = ctx.app.capabilities["diagram.edit"];
        ctx.expect(await capability.$help).toContain("open");
        const result = await capability.open({
            source: "flowchart LR\nA[Start] --> B[Finish]",
            title: "US-2097 fixture diagram",
        });
        ctx.expect(result.result.status).toBe("opened");
        ctx.expect(result.result.imageOnly).toBe(false);
        ctx.expect(typeof result.pageId === "string" && result.pageId.length > 0).toBe(true);
        const pageId = result.pageId;

        // Runner cleanup closes this untitled drawing and handles its unsaved-changes prompt.
        await waitForBoardFrame(ctx, pageId);
        await waitForRemoteModelValue(ctx, pageId, "editorIsMounted", (mounted) => mounted === true);
        ctx.expect(await waitForRemoteModelValue(ctx, pageId, "elementCount", (count) => count > 0)).toBeTruthy();
    }),

    test("diagram.edit reports malformed Mermaid as conversion-failed and discards the page", async (ctx) => {
        await resetDrawing(ctx);
        const pagesBefore = (await ctx.app.pages.all).map((page) => page.id);
        let pageId;
        try {
            const result = await ctx.app.capabilities["diagram.edit"].open({
                source: "flowchart LR\nA[Broken -->",
                title: "US-2097 broken diagram",
            });
            ctx.expect(result.result.status).toBe("conversion-failed");
            ctx.expect(result.result.message.length > 0).toBe(true);

            const pagesAfter = await ctx.waitFor(
                async (activeContext) => (await activeContext.app.pages.all).map((page) => page.id),
                (pageIds) => samePageIds(pageIds, pagesBefore),
                { timeout: 15000 },
            );
            ctx.expect(samePageIds(pagesAfter, pagesBefore)).toBe(true);
        } finally {
            await closePage(ctx, pageId);
        }
    }),
];
