import { test } from "../../../lib/context.mjs";
import { closeBoardPage, fixtureBoard, trustFixtureBoard, untrustBoard } from "../../helpers/boards.mjs";

const originalContent = "fixture-original";

async function closeOwnedPage(ctx, pageId) {
    if (!pageId) return;
    try {
        await closeBoardPage(ctx, pageId);
    } catch {
        // Cleanup must not hide the test result.
    }
}

/** A file opened in a board editor mounts its frame asynchronously; automation needs a ready frame. */
async function waitForBoardFrame(ctx, pageId) {
    await ctx.waitFor(`pages[${JSON.stringify(pageId)}].editor.frameReady`, (value) => value === true, { timeout: 15000 });
}

async function removeFixtureTrust(ctx, root) {
    try {
        await untrustBoard(ctx, root);
    } catch {
        // Cleanup must not hide the test result.
    }
}

export default [
    test("opens a matching file in the board editor and offers text switching", async (ctx) => {
        const root = fixtureBoard(ctx, "extensions/ext-board");
        const filePath = ctx.fixture("boards/extensions/files/sample.us2094");
        let pageId;
        try {
            await trustFixtureBoard(ctx, root);
            await ctx.call("fs.write", [filePath, originalContent]);
            pageId = (await ctx.app.pages.openFile(filePath)).id;

            ctx.expect(await ctx.app.pages[pageId].editor.id).toBe(`board-editor:${root}`);
            ctx.expect((await ctx.app.pages[pageId].editorSwitches.options).map((option) => option.id)).toContain("monaco");
        } finally {
            await closeOwnedPage(ctx, pageId);
            await removeFixtureTrust(ctx, root);
        }
    }),

    test("board content editor reads the associated file", async (ctx) => {
        const root = fixtureBoard(ctx, "extensions/ext-board");
        const filePath = ctx.fixture("boards/extensions/files/sample.us2094");
        let pageId;
        try {
            await trustFixtureBoard(ctx, root);
            await ctx.call("fs.write", [filePath, originalContent]);
            pageId = (await ctx.app.pages.openFile(filePath)).id;
            await waitForBoardFrame(ctx, pageId);
            const editor = ctx.handle(ctx.app.pages[pageId].editor);
            await editor.waitFor({ selector: "[data-testid='file-content']" });

            const content = await editor.evaluate("() => document.querySelector('[data-testid=file-content]').textContent");
            ctx.expect(content).toBe(originalContent);
        } finally {
            await closeOwnedPage(ctx, pageId);
            await removeFixtureTrust(ctx, root);
        }
    }),

    test("saving board edits writes the associated file", async (ctx) => {
        const root = fixtureBoard(ctx, "extensions/ext-board");
        const filePath = ctx.fixture("boards/extensions/files/sample.us2094");
        let pageId;
        try {
            await trustFixtureBoard(ctx, root);
            await ctx.call("fs.write", [filePath, originalContent]);
            pageId = (await ctx.app.pages.openFile(filePath)).id;
            await waitForBoardFrame(ctx, pageId);
            const editor = ctx.handle(ctx.app.pages[pageId].editor);
            await editor.waitFor({ selector: "#save-updated" });
            await editor.click("#save-updated");

            const saved = await ctx.waitFor(
                (activeContext) => activeContext.callText("fs.read", [filePath]),
                (content) => content === "fixture-updated",
            );
            ctx.expect(saved).toBe("fixture-updated");
        } finally {
            await closeOwnedPage(ctx, pageId);
            await removeFixtureTrust(ctx, root);
        }
    }),

    test("editor switch returns to text and back to the board", async (ctx) => {
        const root = fixtureBoard(ctx, "extensions/ext-board");
        const filePath = ctx.fixture("boards/extensions/files/sample.us2094");
        let pageId;
        try {
            await trustFixtureBoard(ctx, root);
            await ctx.call("fs.write", [filePath, originalContent]);
            pageId = (await ctx.app.pages.openFile(filePath)).id;
            const switches = ctx.app.pages[pageId].editorSwitches;

            await switches.switchTo("monaco");
            ctx.expect(await switches.current).toBe("monaco");
            await switches.switchTo(`board-editor:${root}`);
            ctx.expect(await switches.current).toBe(`board-editor:${root}`);

            await waitForBoardFrame(ctx, pageId);
            const editor = ctx.handle(ctx.app.pages[pageId].editor);
            await editor.waitFor({ selector: "[data-testid='file-content']" });
            ctx.expect(await editor.evaluate("() => document.querySelector('[data-testid=file-content]').textContent")).toBe(originalContent);
        } finally {
            await closeOwnedPage(ctx, pageId);
            await removeFixtureTrust(ctx, root);
        }
    }),

    test("opening a claimed folder selects its board editor", async (ctx) => {
        const root = fixtureBoard(ctx, "extensions/ext-board");
        const folderPath = ctx.fixture("boards/extensions/files/folder-target");
        const explorerRoot = ctx.fixture("boards/extensions/files");
        const pageIdsBefore = new Set((await ctx.app.pages.all).map((page) => page.id));
        let workspacePageId;
        try {
            await trustFixtureBoard(ctx, root);
            workspacePageId = (await ctx.app.pages.openFile(explorerRoot)).id;
            await ctx.waitFor(
                (activeContext) => activeContext.app.pages[workspacePageId].panels.explorer.listItems(),
                (items) => items.some((item) => item.title === "folder-target" && item.isDirectory),
            );
            const folderRowRef = await ctx.waitFor(
                async (activeContext) => {
                    const snapshot = await activeContext.callText("window.screen.snapshot", [{
                        interactive: true,
                        root: '[data-type="tree-provider-view"]',
                    }]);
                    const row = snapshot.split("\n").find((line) => line.includes("treeitem ") && line.includes("folder-target"));
                    return row?.match(/\bref=(e\d+)\b/)?.[1]
                        ?? row?.match(/\b(e\d+)\s+treeitem\b/)?.[1]
                        ?? null;
                },
                Boolean,
            );
            await ctx.app.window.screen.click({ ref: folderRowRef });
            await ctx.waitFor(
                `pages[${JSON.stringify(workspacePageId)}].editor.id`,
                (editorId) => editorId === `board-editor:${root}`,
            );
            await waitForBoardFrame(ctx, workspacePageId);

            ctx.expect(await ctx.app.pages[workspacePageId].editor.id).toBe(`board-editor:${root}`);
            ctx.expect(await ctx.app.pages[workspacePageId].editor.folderPath).toBe(folderPath);
            ctx.expect((await ctx.app.pages[workspacePageId].editorSwitches.options).map((option) => option.id)).toContain("category-view");
        } finally {
            let pages = [];
            try {
                pages = await ctx.app.pages.all;
            } catch {
                // Cleanup must not hide the test result.
            }
            const ownedPageIds = new Set([
                ...pages.filter((page) => !pageIdsBefore.has(page.id)).map((page) => page.id),
                ...(workspacePageId ? [workspacePageId] : []),
            ]);
            for (const pageId of ownedPageIds) await closeOwnedPage(ctx, pageId);
            await removeFixtureTrust(ctx, root);
        }
    }),

    test("pages.openFolder applies a trusted board folder claim", async (ctx) => {
        const root = fixtureBoard(ctx, "extensions/ext-board");
        const folderPath = ctx.fixture("boards/extensions/files/folder-target");
        let pageId;
        try {
            await trustFixtureBoard(ctx, root);
            pageId = (await ctx.app.pages.openFolder(folderPath)).id;
            await ctx.waitFor(
                (activeContext) => activeContext.app.pages[pageId].editor.id,
                (editorId) => editorId === `board-editor:${root}`,
            );
            await waitForBoardFrame(ctx, pageId);
            ctx.expect(await ctx.app.pages[pageId].editor.folderPath).toBe(folderPath);
        } finally {
            await closeOwnedPage(ctx, pageId);
            await removeFixtureTrust(ctx, root);
        }
    }),
];
