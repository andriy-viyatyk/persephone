import { test } from "../../../lib/context.mjs";
import {
    chooseTreeMenuItem,
    answerInputDialog,
    closeExplorerFixture,
    explorerItems,
    explorerRowRef,
    explorerRowRefs,
    openExplorerFixture,
    openTreeContextMenu,
    selectedExplorerRows,
    waitForExplorerEntry,
} from "../../helpers/sidebar-helpers.mjs";
import { shellPagePath } from "../../helpers/shell-helpers.mjs";

export default [
    test("Explorer lists fixture entries, expands folders, navigates in place, and reveals the active file", async (ctx) => {
        const fixture = await openExplorerFixture(ctx, "us-2039/explorer-navigation", {
            "top.txt": "Top level.\n",
            "nested/inside.txt": "Nested file.\n",
        });
        try {
            const pageRoot = shellPagePath(fixture.pageId, "");
            const initialItems = await explorerItems(ctx, fixture.pageId);
            ctx.expect(initialItems.some((item) => item.title === "top.txt")).toBe(true);
            ctx.expect(initialItems.some((item) => item.title === "nested" && item.isDirectory)).toBe(true);

            const initialSnapshot = await ctx.callText("window.screen.snapshot", [{ interactive: true }]);
            ctx.expect(initialSnapshot).toContain('treeitem "top.txt"');
            ctx.expect(initialSnapshot.includes('treeitem "inside.txt"')).toBe(false);

            await ctx.call(`${pageRoot}panels.explorer.expand`, [ctx.fixture("us-2039/explorer-navigation/nested")]);
            const expandedSnapshot = await ctx.waitFor(
                (activeContext) => activeContext.callText("window.screen.snapshot", [{ interactive: true }]),
                (snapshot) => snapshot.includes('treeitem "inside.txt"'),
            );
            ctx.expect(expandedSnapshot).toContain('treeitem "inside.txt"');

            const topRowRef = await explorerRowRef(ctx, "top.txt");
            await ctx.call("window.screen.click", [{ ref: topRowRef }]);
            await ctx.waitFor(shellPagePath(fixture.pageId, "filePath"), (filePath) => filePath === ctx.fixture("us-2039/explorer-navigation/top.txt"));
            ctx.expect((await ctx.call("pages.all")).some((page) => page.id !== fixture.pageId && page.title === "top.txt")).toBe(false);

            await ctx.call(`${pageRoot}panels.explorer.collapse`, [ctx.fixture("us-2039/explorer-navigation/nested")]);
            const hiddenBeforeNavigation = await ctx.callText("window.screen.snapshot", [{ interactive: true }]);
            ctx.expect(hiddenBeforeNavigation.includes('treeitem "inside.txt"')).toBe(false);

            await ctx.call("pages.navigatePageTo", [fixture.pageId, ctx.fixture("us-2039/explorer-navigation/nested/inside.txt")]);
            await ctx.waitFor(shellPagePath(fixture.pageId, "filePath"), (filePath) => filePath === ctx.fixture("us-2039/explorer-navigation/nested/inside.txt"));
            const revealedSnapshot = await ctx.waitFor(
                (activeContext) => activeContext.callText("window.screen.snapshot", [{ interactive: true }]),
                (snapshot) => snapshot.includes('treeitem "inside.txt"'),
            );
            ctx.expect(revealedSnapshot).toContain('treeitem "inside.txt"');
            const selectedRows = await ctx.waitFor(
                (activeContext) => selectedExplorerRows(activeContext),
                (rows) => rows.some((row) => row.includes("inside.txt")),
            );
            ctx.expect(selectedRows.some((row) => row.includes("inside.txt"))).toBe(true);
        } finally {
            await closeExplorerFixture(ctx, fixture);
        }
    }),

    test("Explorer context menu creates, renames, deletes, copies, and moves fixture entries", async (ctx) => {
        const fixtureFolder = "us-2039/explorer-file-operations-reviewed";
        const fixture = await openExplorerFixture(ctx, fixtureFolder, {
            "source.txt": "Copy and move me.\n",
            "move.txt": "Move me without replacing another file.\n",
            "open-before-rename.txt": "This page should follow its file rename.\n",
            "keyboard-rename.txt": "Rename this row with F2.\n",
            "keyboard-delete.txt": "Delete this row from the keyboard.\n",
            "destination/.keep": "placeholder\n",
        });
        const filePath = (name) => ctx.fixture(`${fixtureFolder}/${name}`);
        try {
            await ctx.call(`${fixture.pageRoot}panels.explorer.expand`, [filePath("destination")]);
            await openTreeContextMenu(ctx, "source.txt");
            await chooseTreeMenuItem(ctx, "new-file");
            const inputSnapshot = await ctx.callText("window.screen.snapshot", [{ interactive: true }], { dialog: true });
            ctx.expect(inputSnapshot).toContain("textbox");
            await answerInputDialog(ctx, "created.txt", "Create");
            await ctx.waitFor((activeContext) => activeContext.call("fs.exists", [filePath("created.txt")]), Boolean);
            await waitForExplorerEntry(ctx, fixture.pageId, "created.txt");

            await openTreeContextMenu(ctx, "source.txt");
            await chooseTreeMenuItem(ctx, "new-folder");
            await answerInputDialog(ctx, "created-folder", "Create");
            await ctx.waitFor((activeContext) => activeContext.call("fs.stat", [filePath("created-folder")]), (stat) => stat.exists && stat.isDirectory);
            await waitForExplorerEntry(ctx, fixture.pageId, "created-folder");

            await openTreeContextMenu(ctx, "created-folder");
            await chooseTreeMenuItem(ctx, "rename");
            await answerInputDialog(ctx, "renamed-folder", "Rename");
            await ctx.waitFor((activeContext) => activeContext.call("fs.stat", [filePath("renamed-folder")]), (stat) => stat.exists && stat.isDirectory);
            ctx.expect((await ctx.call("fs.stat", [filePath("created-folder")])).exists).toBe(false);
            await waitForExplorerEntry(ctx, fixture.pageId, "renamed-folder");
            await waitForExplorerEntry(ctx, fixture.pageId, "created-folder", false);

            await ctx.call("pages.navigatePageTo", [fixture.pageId, filePath("open-before-rename.txt")]);
            await ctx.waitFor(shellPagePath(fixture.pageId, "filePath"), (path) => path === filePath("open-before-rename.txt"));
            await openTreeContextMenu(ctx, "open-before-rename.txt");
            await chooseTreeMenuItem(ctx, "rename");
            await answerInputDialog(ctx, "renamed-open.txt", "Rename");
            await ctx.waitFor((activeContext) => activeContext.call("fs.exists", [filePath("renamed-open.txt")]), Boolean);
            ctx.expect(await ctx.call("fs.exists", [filePath("open-before-rename.txt")])).toBe(false);
            await waitForExplorerEntry(ctx, fixture.pageId, "renamed-open.txt");
            await waitForExplorerEntry(ctx, fixture.pageId, "open-before-rename.txt", false);
            await ctx.waitFor(shellPagePath(fixture.pageId, "filePath"), (path) => path === filePath("renamed-open.txt"));
            ctx.expect(await ctx.callText(shellPagePath(fixture.pageId, "title"))).toBe("renamed-open.txt");

            await openTreeContextMenu(ctx, "created.txt");
            await chooseTreeMenuItem(ctx, "rename");
            await answerInputDialog(ctx, "renamed.txt", "Rename");
            await ctx.waitFor((activeContext) => activeContext.call("fs.exists", [filePath("renamed.txt")]), Boolean);
            ctx.expect(await ctx.call("fs.exists", [filePath("created.txt")])).toBe(false);
            await waitForExplorerEntry(ctx, fixture.pageId, "renamed.txt");
            await waitForExplorerEntry(ctx, fixture.pageId, "created.txt", false);

            await openTreeContextMenu(ctx, "renamed.txt");
            await chooseTreeMenuItem(ctx, "delete");
            await ctx.call("window.screen.click", ['text="Delete"'], { dialog: true });
            await ctx.waitFor((activeContext) => activeContext.call("fs.exists", [filePath("renamed.txt")]), (exists) => exists === false);
            await waitForExplorerEntry(ctx, fixture.pageId, "renamed.txt", false);

            const renameRowRef = await explorerRowRef(ctx, "keyboard-rename.txt");
            await ctx.call("window.screen.pressKey", ["F2", { target: { ref: renameRowRef } }], { dialog: true });
            await answerInputDialog(ctx, "keyboard-renamed.txt", "Rename");
            await ctx.waitFor((activeContext) => activeContext.call("fs.exists", [filePath("keyboard-renamed.txt")]), Boolean);
            await waitForExplorerEntry(ctx, fixture.pageId, "keyboard-renamed.txt");
            await waitForExplorerEntry(ctx, fixture.pageId, "keyboard-rename.txt", false);

            const deleteRowRef = await explorerRowRef(ctx, "keyboard-delete.txt");
            await ctx.call("window.screen.click", [{ ref: deleteRowRef }]);
            await ctx.waitFor(
                (activeContext) => activeContext.call("window.screen.evaluate", ["document.activeElement.closest('[data-type=tree-provider-view]')!==null"]),
                Boolean,
            );
            await ctx.call("window.screen.pressKey", ["Delete"], { dialog: true });
            await ctx.call("dialogs[0].click", ["Delete"], { dialog: true });
            await ctx.waitFor((activeContext) => activeContext.call("fs.exists", [filePath("keyboard-delete.txt")]), (exists) => exists === false);
            await waitForExplorerEntry(ctx, fixture.pageId, "keyboard-delete.txt", false);

            // Copy and cut use the Explorer's real OS file clipboard; paste into the destination folder.
            await openTreeContextMenu(ctx, "source.txt");
            await chooseTreeMenuItem(ctx, "copy");
            await openTreeContextMenu(ctx, "destination");
            await chooseTreeMenuItem(ctx, "paste");
            await ctx.waitFor((activeContext) => activeContext.call("fs.exists", [filePath("destination/source.txt")]), Boolean);
            const copiedSnapshot = await ctx.waitFor(
                (activeContext) => activeContext.callText("window.screen.snapshot", [{ interactive: true }]),
                (snapshot) => (snapshot.match(/treeitem "source\.txt"/g) ?? []).length === 2,
            );
            ctx.expect((copiedSnapshot.match(/treeitem "source\.txt"/g) ?? []).length).toBe(2);
            ctx.expect(await ctx.call("fs.exists", [filePath("source.txt")])).toBe(true);

            await openTreeContextMenu(ctx, "move.txt");
            await chooseTreeMenuItem(ctx, "cut");
            await openTreeContextMenu(ctx, "destination");
            await chooseTreeMenuItem(ctx, "paste");
            await ctx.waitFor((activeContext) => activeContext.call("fs.exists", [filePath("destination/move.txt")]), Boolean);
            await ctx.waitFor((activeContext) => activeContext.call("fs.exists", [filePath("move.txt")]), (exists) => exists === false);
            const movedSnapshot = await ctx.waitFor(
                (activeContext) => activeContext.callText("window.screen.snapshot", [{ interactive: true }]),
                (snapshot) => snapshot.includes('treeitem "move.txt" [level=3]')
                    && !snapshot.includes('treeitem "move.txt" [level=2]'),
            );
            ctx.expect(movedSnapshot).toContain('treeitem "move.txt" [level=3]');
            await waitForExplorerEntry(ctx, fixture.pageId, "move.txt", false);

            await openTreeContextMenu(ctx, "renamed-folder");
            await chooseTreeMenuItem(ctx, "delete");
            await ctx.call("window.screen.click", ['text="Delete"'], { dialog: true });
            const folderDeletion = await ctx.waitFor(
                async (activeContext) => ({
                    stat: await activeContext.call("fs.stat", [filePath("renamed-folder")]),
                    items: await explorerItems(activeContext, fixture.pageId),
                }),
                (state) => !state.stat.exists && !state.items.some((item) => item.title === "renamed-folder"),
            );
            ctx.expect(folderDeletion.stat.exists).toBe(false);
            ctx.expect(folderDeletion.items.some((item) => item.title === "renamed-folder")).toBe(false);

        } finally {
            await closeExplorerFixture(ctx, fixture);
        }
    }),

    test("dragging an Explorer file row fails safely without moving the file or wedging the app", async (ctx) => {
        const fixture = await openExplorerFixture(ctx, "us-2039/explorer-drag-cancel", {
            "drag.txt": "The guarded drag must leave this file here.\n",
            "destination/.keep": "placeholder\n",
        });
        const sourcePath = ctx.fixture("us-2039/explorer-drag-cancel/drag.txt");
        const destinationPath = ctx.fixture("us-2039/explorer-drag-cancel/destination/drag.txt");
        try {
            const rowRefs = await explorerRowRefs(ctx, ["drag.txt", "destination"]);
            let dragError;
            try {
                await ctx.call("window.screen.drag", [
                    { ref: rowRefs["drag.txt"] },
                    { ref: rowRefs.destination },
                ]);
            } catch (error) {
                dragError = error;
            }

            ctx.expect(dragError?.message ?? "").toContain("drag cannot perform HTML5 drag-and-drop in the app window");
            ctx.expect(await ctx.call("fs.exists", [sourcePath])).toBe(true);
            ctx.expect(await ctx.call("fs.exists", [destinationPath])).toBe(false);
            await waitForExplorerEntry(ctx, fixture.pageId, "drag.txt");

            const pages = await ctx.call("pages.all");
            ctx.expect(pages.some((page) => page.id === fixture.pageId)).toBe(true);
        } finally {
            await closeExplorerFixture(ctx, fixture);
        }
    }),
];
