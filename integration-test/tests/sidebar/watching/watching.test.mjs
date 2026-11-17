import { promises as nodeFs } from "node:fs";
import JSZip from "jszip";
import { test } from "../../../lib/context.mjs";
import { closePages, openExplorerFixture } from "../../helpers/sidebar-helpers.mjs";
import { shellPagePath } from "../../helpers/shell-helpers.mjs";

export default [
    test("Explorer refreshes an expanded folder after outside create, delete, and rename", async (ctx) => {
        const folder = "us-2042-watching/outside-changes";
        const folderPath = ctx.fixture(folder);
        const originalPath = ctx.fixture(`${folder}/watched/original.txt`);
        const createdPath = ctx.fixture(`${folder}/watched/created.txt`);
        const renamedPath = ctx.fixture(`${folder}/watched/renamed.txt`);
        await ctx.app.fs.removeDir(folderPath, true);

        const fixture = await openExplorerFixture(ctx, folder, {
            "watched/original.txt": "Present before the external changes.\n",
        });
        try {
            const watchedFolder = ctx.fixture(`${folder}/watched`);
            await fixture.pageRoot.panels.explorer.expand(watchedFolder);
            const initialTree = await ctx.waitFor(
                (activeContext) => activeContext.callText("window.screen.snapshot", [{ interactive: true }]),
                (snapshot) => snapshot.includes('treeitem "original.txt"'),
            );
            ctx.expect(initialTree).toContain('treeitem "original.txt"');
            ctx.expect(initialTree.includes('treeitem "created.txt"')).toBe(false);

            await ctx.app.fs.write(createdPath, "Created outside Persephone.\n");
            const afterCreate = await ctx.waitFor(
                (activeContext) => activeContext.callText("window.screen.snapshot", [{ interactive: true }]),
                (snapshot) => snapshot.includes('treeitem "created.txt"'),
            );
            ctx.expect(afterCreate).toContain('treeitem "created.txt"');

            await ctx.app.fs.delete(createdPath);
            const afterDelete = await ctx.waitFor(
                (activeContext) => activeContext.callText("window.screen.snapshot", [{ interactive: true }]),
                (snapshot) => !snapshot.includes('treeitem "created.txt"'),
            );
            ctx.expect(afterDelete.includes('treeitem "created.txt"')).toBe(false);

            await ctx.app.fs.rename(originalPath, renamedPath);
            const afterRename = await ctx.waitFor(
                (activeContext) => activeContext.callText("window.screen.snapshot", [{ interactive: true }]),
                (snapshot) => snapshot.includes('treeitem "renamed.txt"')
                    && !snapshot.includes('treeitem "original.txt"'),
            );
            ctx.expect(afterRename).toContain('treeitem "renamed.txt"');
            ctx.expect(afterRename.includes('treeitem "original.txt"')).toBe(false);
            ctx.expect(await ctx.app.fs.exists(renamedPath)).toBe(true);
        } finally {
            await closePages(ctx, [fixture.pageId]);
        }
    }),

    test("ZIP archive opens as a browsable tree and an entry opens with its content", async (ctx) => {
        const folder = "us-2042-watching/archive-browse";
        const folderPath = ctx.fixture(folder);
        const archivePath = ctx.fixture(`${folder}/notes.zip`);
        const expectedContent = "Text from inside the ZIP archive.\n";
        await ctx.app.fs.removeDir(folderPath, true);
        await ctx.app.fs.mkdir(folderPath);

        const zip = new JSZip();
        zip.file("hello.txt", expectedContent);
        await nodeFs.writeFile(archivePath, await zip.generateAsync({ type: "nodebuffer" }));

        let archivePageId;
        try {
            const archivePage = await ctx.app.pages.openFile(archivePath);
            archivePageId = archivePage.id;
            const archiveRoot = ctx.app.pages[archivePageId];
            ctx.expect(await ctx.waitFor((activeContext) => activeContext.app.pages[archivePageId].editor.id, (id) => id === "archive-view")).toBe("archive-view");

            const entries = await archiveRoot.editor.listEntries();
            ctx.expect(entries.some((entry) => entry.path === "hello.txt" && !entry.isDirectory)).toBe(true);
            const archiveTree = await ctx.waitFor(
                (activeContext) => activeContext.callText("window.screen.snapshot", [{
                    root: '[data-name="archive-root"]',
                    interactive: true,
                }]),
                (snapshot) => snapshot.includes('treeitem "hello.txt"'),
            );
            ctx.expect(archiveTree).toContain('treeitem "hello.txt"');

            const entryLine = archiveTree.split("\n").find((line) => line.includes('treeitem "hello.txt"'));
            const entryRef = entryLine?.match(/\bref=(e\d+)\b/)?.[1] ?? entryLine?.match(/\b(e\d+)\s+treeitem\b/)?.[1];
            if (!entryRef) throw new Error("Could not find the ZIP entry's window-screen ref.");
            await ctx.app.window.screen.click({ ref: entryRef });
            ctx.expect(await ctx.waitFor((activeContext) => activeContext.app.pages[archivePageId].editor.id, (id) => id === "monaco")).toBe("monaco");
            ctx.expect(await ctx.callText(shellPagePath(archivePageId, "content"))).toBe(expectedContent);
        } finally {
            await closePages(ctx, [archivePageId]);
        }
    }),
];
