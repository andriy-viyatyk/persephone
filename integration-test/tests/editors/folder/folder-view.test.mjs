import { promises as nodeFs } from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { isLinux, isWindows } from "../../../../src/shared/platform.ts";
import { test } from "../../../lib/context.mjs";
import { answerInputDialog } from "../../helpers/sidebar-helpers.mjs";
import { closePage } from "../helpers.mjs";

async function removeFixtureDirectory(ctx, folder) {
    try {
        await ctx.app.fs.removeDir(folder, true);
    } catch {
        // A missing fixture directory is already clean.
    }
}

function rowLine(snapshot, name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    // Tile mode names a row by its full path, so a name right after a path separator also matches.
    const pattern = new RegExp(`(?:treeitem "${escaped}"|generic "(?:[^"\\s]+ )?${escaped}"|"[^"]*[\\\\/]${escaped}")`, "u");
    return snapshot.split("\n").find((entry) => pattern.test(entry) && /\bref=e\d+\b/u.test(entry));
}

function rowRef(snapshot, name) {
    const ref = rowLine(snapshot, name)?.match(/\bref=(e\d+)\b/u)?.[1];
    if (!ref) throw new Error(`Could not find the Folder View row for ${name}.`);
    return ref;
}

async function snapshotRowRef(ctx, root, name) {
    const snapshot = await ctx.waitFor(
        (activeContext) => activeContext.app.window.screen.snapshot({ interactive: true, root }),
        (value) => Boolean(rowLine(value, name)),
    );
    return rowRef(snapshot, name);
}

async function openFolderView(ctx, workspaceParent, folderName) {
    const page = await ctx.app.pages.openFile(workspaceParent);
    const pageId = page.id;
    await ctx.waitFor(
        (activeContext) => activeContext.app.pages[pageId].panels.explorer,
        Boolean,
    );
    const ref = await snapshotRowRef(ctx, '[data-type="tree-provider-view"]', folderName);
    await ctx.app.window.screen.click({ ref }, { clickCount: 2 });
    await ctx.waitFor(
        (activeContext) => activeContext.app.pages[pageId].editor.id,
        (id) => id === "category-view",
    );
    return pageId;
}

async function openContextMenu(ctx, root, name) {
    const ref = await snapshotRowRef(ctx, root, name);
    // ctx.call remains because the app stand-in cannot pass call options such as { dialog: true }.
    await ctx.call("window.screen.click", [{ ref }, { button: "right" }], { dialog: true });
    await ctx.waitFor(
        // ctx.call remains because the app stand-in cannot pass call options such as { dialog: true }.
        (activeContext) => activeContext.call("menus[0].items", undefined, { dialog: true }),
        (items) => Array.isArray(items),
    );
}

async function chooseMenuAction(ctx, actionId) {
    // ctx.call remains because the app stand-in cannot pass call options such as { dialog: true }.
    return ctx.call("menus[0].click", [actionId], { dialog: true });
}

async function chooseViewMode(ctx, pageId, mode) {
    // ctx.call remains because opening the popup menu requires call options such as { dialog: true }.
    await ctx.call("window.screen.click", ['[data-name="folder-view-mode"]'], { dialog: true });
    await ctx.waitFor(
        // ctx.call remains because the app stand-in cannot pass call options such as { dialog: true }.
        (activeContext) => activeContext.call("menus[0].items", undefined, { dialog: true }),
        (items) => items.some((item) => item.id === mode),
    );
    // ctx.call remains because the popup menu requires call options such as { dialog: true }.
    await ctx.call("menus[0].click", [mode], { dialog: true });
    await ctx.waitFor(
        (activeContext) => activeContext.app.pages[pageId].editor.viewMode,
        (viewMode) => viewMode === mode,
    );
}

async function closeOpenMenu(ctx) {
    try {
        // ctx.call remains because the app stand-in cannot pass call options such as { dialog: true }.
        await ctx.call("menus[0].close", [], { dialog: true });
    } catch {
        // No menu is open.
    }
}

export default [
    test("Folder View keeps case-distinct filenames separate through rename", async (ctx) => {
        const folder = ctx.fixture("us-2205/folder-case-identity");
        const workspaceParent = path.join(folder, "workspace");
        const projectPath = path.join(workspaceParent, "project");
        const useCaseOnlyNames = isLinux && !isWindows;
        const firstName = useCaseOnlyNames ? "Case.txt" : "first.txt";
        const secondName = useCaseOnlyNames ? "case.txt" : "second.txt";
        const renamedName = useCaseOnlyNames ? "Renamed.txt" : "renamed-first.txt";
        const filePath = (name) => path.join(projectPath, name);
        const openedPageIds = [];
        let pageId;
        try {
            await removeFixtureDirectory(ctx, folder);
            await nodeFs.mkdir(projectPath, { recursive: true });
            await nodeFs.writeFile(filePath(firstName), "First file contents.\n");
            await nodeFs.writeFile(filePath(secondName), "Second file contents.\n");
            pageId = await openFolderView(ctx, workspaceParent, "project");

            const items = await ctx.app.pages[pageId].editor.items;
            ctx.expect(items.some((item) => item.title === firstName)).toBe(true);
            ctx.expect(items.some((item) => item.title === secondName)).toBe(true);

            await openContextMenu(ctx, '[data-type="category-view"]', firstName);
            await chooseMenuAction(ctx, "rename");
            await answerInputDialog(ctx, renamedName, "Rename");
            await ctx.waitFor((activeContext) => activeContext.app.fs.exists(filePath(renamedName)), Boolean);
            ctx.expect(await nodeFs.readFile(filePath(renamedName), "utf8")).toBe("First file contents.\n");
            ctx.expect(await nodeFs.readFile(filePath(secondName), "utf8")).toBe("Second file contents.\n");
            ctx.expect(await ctx.app.fs.exists(filePath(firstName))).toBe(false);
            await ctx.waitFor(
                (activeContext) => activeContext.app.pages[pageId].editor.items,
                (currentItems) => currentItems.some((item) => item.title === renamedName)
                    && currentItems.some((item) => item.title === secondName)
                    && !currentItems.some((item) => item.title === firstName),
            );

            const firstPage = await ctx.app.pages.openFile(filePath(renamedName));
            openedPageIds.push(firstPage.id);
            const secondPage = await ctx.app.pages.openFile(filePath(secondName));
            openedPageIds.push(secondPage.id);
            ctx.expect(await ctx.waitFor(
                (activeContext) => activeContext.app.pages[firstPage.id].content,
                (content) => content === "First file contents.\n",
            )).toBe("First file contents.\n");
            ctx.expect(await ctx.waitFor(
                (activeContext) => activeContext.app.pages[secondPage.id].content,
                (content) => content === "Second file contents.\n",
            )).toBe("Second file contents.\n");
        } finally {
            await closeOpenMenu(ctx);
            for (const openedPageId of openedPageIds) await closePage(ctx, openedPageId);
            await closePage(ctx, pageId);
            await removeFixtureDirectory(ctx, folder);
        }
    }),

    test("pages.openFolder uses Folder View routing and editorless pages cannot be saved", async (ctx) => {
        const fixture = ctx.fixture("us-2124/open-folder");
        const projectPath = path.join(fixture, "project");
        const filePath = path.join(projectPath, "notes.txt");
        let folderPageId;
        let workspacePageId;
        try {
            await removeFixtureDirectory(ctx, fixture);
            await ctx.app.fs.mkdir(projectPath);
            await ctx.app.fs.write(filePath, "Folder open fixture.\n");

            const page = await ctx.app.pages.openFolder(projectPath);
            folderPageId = page?.id;
            ctx.expect(Boolean(folderPageId)).toBe(true);
            ctx.expect(await ctx.app.pages[folderPageId].editor.id).toBe("category-view");

            let fileError = "";
            try {
                await ctx.app.pages.openFolder(filePath);
            } catch (error) {
                fileError = String(error);
            }
            ctx.expect(fileError).toContain("pages.openFile");

            workspacePageId = (await ctx.app.pages.openFile(projectPath)).id;
            let saveError = "";
            try {
                await ctx.app.pages[workspacePageId].save();
            } catch (error) {
                saveError = String(error);
            }
            ctx.expect(saveError).toContain("no file content to save");
        } finally {
            await closePage(ctx, workspacePageId);
            await closePage(ctx, folderPageId);
            await removeFixtureDirectory(ctx, fixture);
        }
    }),

    test("Folder View lists a fixture folder and supports breadcrumb, Back, and Forward", async (ctx) => {
        const folder = ctx.fixture("us-2072/folder-navigation");
        const workspaceParent = ctx.fixture("us-2072/folder-navigation/workspace");
        const projectPath = ctx.fixture("us-2072/folder-navigation/workspace/project");
        const nestedPath = ctx.fixture("us-2072/folder-navigation/workspace/project/nested");
        let pageId;
        try {
            await removeFixtureDirectory(ctx, folder);
            await ctx.app.fs.mkdir(projectPath);
            await ctx.app.fs.mkdir(path.join(nestedPath, "deeper"));
            await ctx.app.fs.write(path.join(projectPath, "top.txt"), "Top level fixture.\n");
            await ctx.app.fs.write(path.join(nestedPath, "inside.txt"), "Nested fixture.\n");
            await ctx.app.fs.write(path.join(nestedPath, "deeper", "leaf.txt"), "Deep fixture.\n");

            pageId = await openFolderView(ctx, workspaceParent, "project");
            const editor = ctx.app.pages[pageId].editor;
            ctx.expect(await editor.providerType).toBe("file");
            ctx.expect(await editor.rootPath).toBe(workspaceParent);
            ctx.expect(await editor.categoryPath).toBe(projectPath);
            const rootItems = await editor.items;
            ctx.expect(rootItems.map((item) => [item.title, item.isDirectory])).toEqual([
                ["..", true], // FileTreeProvider adds a parent row below the provider root
                ["nested", true],
                ["top.txt", false],
            ]);
            ctx.expect(await editor.viewMode).toBe("list");

            const breadcrumb = await ctx.waitFor(
                (activeContext) => activeContext.app.window.screen.snapshot({ root: '[data-name="category-breadcrumb"]' }),
                (snapshot) => snapshot.includes("project"),
            );
            ctx.expect(breadcrumb).toContain("project");
            const breadcrumbParts = await ctx.app.window.screen.evaluate(
                "() => Array.from(document.querySelectorAll('[data-name=category-breadcrumb] [data-part]')).map((part) => ({ part: part.dataset.part, text: part.textContent, current: part.dataset.current !== undefined }))",
            );
            ctx.expect(breadcrumbParts.some((part) => part.part === "root" && !part.current)).toBe(true);
            ctx.expect(breadcrumbParts.some((part) => part.part === "segment" && part.text === "project" && part.current)).toBe(true);
            await ctx.app.window.screen.click('[data-name="category-breadcrumb"] [data-part="root"]');
            await ctx.waitFor((activeContext) => activeContext.app.pages[pageId].editor.categoryPath, (path) => path === workspaceParent);

            const projectRef = await snapshotRowRef(ctx, '[data-type="category-view"]', "project");
            await ctx.app.window.screen.click({ ref: projectRef }, { clickCount: 2 });
            await ctx.waitFor((activeContext) => activeContext.app.pages[pageId].editor.categoryPath, (path) => path === projectPath);
            const nestedRef = await snapshotRowRef(ctx, '[data-type="category-view"]', "nested");
            await ctx.app.window.screen.click({ ref: nestedRef }, { clickCount: 2 });
            await ctx.waitFor((activeContext) => activeContext.app.pages[pageId].editor.categoryPath, (path) => path === nestedPath);
            ctx.expect((await editor.items).map((item) => [item.title, item.isDirectory])).toEqual([
                ["..", true], // FileTreeProvider adds a parent row below the provider root
                ["deeper", true],
                ["inside.txt", false],
            ]);
            await ctx.app.pages[pageId].history.back();
            await ctx.waitFor((activeContext) => activeContext.app.pages[pageId].editor.categoryPath, (path) => path === projectPath);
            await ctx.app.pages[pageId].history.forward();
            await ctx.waitFor((activeContext) => activeContext.app.pages[pageId].editor.categoryPath, (path) => path === nestedPath);
        } finally {
            await closeOpenMenu(ctx);
            await closePage(ctx, pageId);
            await removeFixtureDirectory(ctx, folder);
        }
    }),

    test("Folder View switches list and tile layouts and remembers each folder mode", async (ctx) => {
        const folder = ctx.fixture("us-2072/folder-view-modes");
        const workspaceParent = ctx.fixture("us-2072/folder-view-modes/workspace");
        const projectPath = ctx.fixture("us-2072/folder-view-modes/workspace/project");
        const nestedPath = ctx.fixture("us-2072/folder-view-modes/workspace/project/nested");
        let pageId;
        let projectMode;
        let nestedMode;
        try {
            await removeFixtureDirectory(ctx, folder);
            await ctx.app.fs.mkdir(nestedPath);
            await ctx.app.fs.write(path.join(projectPath, "first.txt"), "First fixture.\n");
            await ctx.app.fs.write(path.join(nestedPath, "second.txt"), "Second fixture.\n");
            pageId = await openFolderView(ctx, workspaceParent, "project");
            projectMode = await ctx.app.pages[pageId].editor.viewMode;

            await chooseViewMode(ctx, pageId, "tiles-landscape");
            const nestedRef = await snapshotRowRef(ctx, '[data-type="category-view"]', "nested");
            await ctx.app.window.screen.click({ ref: nestedRef }, { clickCount: 2 });
            await ctx.waitFor((activeContext) => activeContext.app.pages[pageId].editor.categoryPath, (path) => path === nestedPath);
            nestedMode = await ctx.app.pages[pageId].editor.viewMode;
            // A subfolder without its own choice inherits the nearest parent folder's mode (FolderViewModeService).
            ctx.expect(nestedMode).toBe("tiles-landscape");

            await chooseViewMode(ctx, pageId, "list");
            await ctx.app.pages[pageId].history.back();
            await ctx.waitFor((activeContext) => activeContext.app.pages[pageId].editor.categoryPath, (path) => path === projectPath);
            ctx.expect(await ctx.app.pages[pageId].editor.viewMode).toBe("tiles-landscape");
            await ctx.app.pages[pageId].history.forward();
            await ctx.waitFor((activeContext) => activeContext.app.pages[pageId].editor.categoryPath, (path) => path === nestedPath);
            ctx.expect(await ctx.app.pages[pageId].editor.viewMode).toBe("list");
        } finally {
            if (pageId) {
                try {
                    const currentPath = await ctx.app.pages[pageId].editor.categoryPath;
                    if (currentPath === nestedPath && nestedMode) await chooseViewMode(ctx, pageId, nestedMode);
                    if (currentPath !== projectPath) {
                        await ctx.app.pages[pageId].history.back();
                        await ctx.waitFor((activeContext) => activeContext.app.pages[pageId].editor.categoryPath, (path) => path === projectPath);
                    }
                    if (projectMode) await chooseViewMode(ctx, pageId, projectMode);
                } catch {
                    // Keep cleanup from replacing the test's original assertion or error.
                }
            }
            await closeOpenMenu(ctx);
            await closePage(ctx, pageId);
            await removeFixtureDirectory(ctx, folder);
        }
    }),

    test("Folder View creates, renames, and deletes local fixture items", async (ctx) => {
        const folder = ctx.fixture("us-2072/folder-operations");
        const workspaceParent = ctx.fixture("us-2072/folder-operations/workspace");
        const projectPath = ctx.fixture("us-2072/folder-operations/workspace/project");
        const filePath = (name) => path.join(projectPath, name);
        let pageId;
        try {
            await removeFixtureDirectory(ctx, folder);
            await ctx.app.fs.write(filePath("source.txt"), "Copy this fixture.\n");
            pageId = await openFolderView(ctx, workspaceParent, "project");

            await openContextMenu(ctx, '[data-type="category-view"]', "source.txt");
            await chooseMenuAction(ctx, "new-file");
            await ctx.waitFor(
                // ctx.callText remains because the app stand-in cannot pass call options such as { dialog: true }.
                (activeContext) => activeContext.callText("window.screen.snapshot", [{ interactive: true }], { dialog: true }),
                (snapshot) => snapshot.includes("textbox"),
            );
            await answerInputDialog(ctx, "created.txt", "Create");
            await ctx.waitFor((activeContext) => activeContext.app.fs.exists(filePath("created.txt")), Boolean);
            await ctx.waitFor((activeContext) => activeContext.app.pages[pageId].editor.items, (items) => items.some((item) => item.title === "created.txt"));

            await openContextMenu(ctx, '[data-type="category-view"]', "source.txt");
            await chooseMenuAction(ctx, "new-folder");
            await ctx.waitFor(
                // ctx.callText remains because the app stand-in cannot pass call options such as { dialog: true }.
                (activeContext) => activeContext.callText("window.screen.snapshot", [{ interactive: true }], { dialog: true }),
                (snapshot) => snapshot.includes("textbox"),
            );
            await answerInputDialog(ctx, "created-folder", "Create");
            await ctx.waitFor((activeContext) => activeContext.app.fs.stat(filePath("created-folder")), (stat) => stat.exists && stat.isDirectory);
            await ctx.waitFor(
                (activeContext) => activeContext.app.pages[pageId].editor.items,
                (items) => items.some((item) => item.title === "created-folder" && item.isDirectory),
            );

            await openContextMenu(ctx, '[data-type="category-view"]', "created-folder");
            await chooseMenuAction(ctx, "rename");
            await ctx.waitFor(
                // ctx.callText remains because the app stand-in cannot pass call options such as { dialog: true }.
                (activeContext) => activeContext.callText("window.screen.snapshot", [{ interactive: true }], { dialog: true }),
                (snapshot) => snapshot.includes("textbox"),
            );
            await answerInputDialog(ctx, "renamed-folder", "Rename");
            await ctx.waitFor((activeContext) => activeContext.app.fs.stat(filePath("renamed-folder")), (stat) => stat.exists && stat.isDirectory);
            ctx.expect((await ctx.app.fs.stat(filePath("created-folder"))).exists).toBe(false);
            await ctx.waitFor(
                (activeContext) => activeContext.app.pages[pageId].editor.items,
                (items) => items.some((item) => item.title === "renamed-folder" && item.isDirectory)
                    && !items.some((item) => item.title === "created-folder"),
            );

            await openContextMenu(ctx, '[data-type="category-view"]', "created.txt");
            await chooseMenuAction(ctx, "rename");
            await ctx.waitFor(
                // ctx.callText remains because the app stand-in cannot pass call options such as { dialog: true }.
                (activeContext) => activeContext.callText("window.screen.snapshot", [{ interactive: true }], { dialog: true }),
                (snapshot) => snapshot.includes("textbox"),
            );
            await answerInputDialog(ctx, "renamed.txt", "Rename");
            await ctx.waitFor((activeContext) => activeContext.app.fs.exists(filePath("renamed.txt")), Boolean);
            ctx.expect(await ctx.app.fs.exists(filePath("created.txt"))).toBe(false);
            await ctx.waitFor(
                (activeContext) => activeContext.app.pages[pageId].editor.items,
                (items) => items.some((item) => item.title === "renamed.txt" && !item.isDirectory)
                    && !items.some((item) => item.title === "created.txt"),
            );

            await openContextMenu(ctx, '[data-type="category-view"]', "renamed.txt");
            await chooseMenuAction(ctx, "delete");
            await ctx.waitFor(
                // ctx.callText remains because the app stand-in cannot pass call options such as { dialog: true }.
                (activeContext) => activeContext.callText("dialogs[0].title", undefined, { dialog: true }),
                (title) => title.length > 0,
            );
            // ctx.call remains because the app stand-in cannot pass call options such as { dialog: true }.
            const deleteButtons = await ctx.call("dialogs[0].buttons", undefined, { dialog: true });
            ctx.expect(deleteButtons).toContain("Delete");
            // ctx.call remains because the app stand-in cannot pass call options such as { dialog: true }.
            await ctx.call("dialogs[0].click", ["Delete"], { dialog: true });
            await ctx.waitFor((activeContext) => activeContext.app.fs.exists(filePath("renamed.txt")), (exists) => exists === false);
            await ctx.waitFor(
                (activeContext) => activeContext.app.pages[pageId].editor.items,
                (items) => !items.some((item) => item.title === "renamed.txt"),
            );

        } finally {
            await closeOpenMenu(ctx);
            await closePage(ctx, pageId);
            await removeFixtureDirectory(ctx, folder);
        }
    }),

    test("Folder View copies and moves local fixture items with the OS file clipboard", async (ctx) => {
        const folder = ctx.fixture("us-2072/folder-clipboard-operations");
        const workspaceParent = ctx.fixture("us-2072/folder-clipboard-operations/workspace");
        const projectPath = ctx.fixture("us-2072/folder-clipboard-operations/workspace/project");
        const destinationPath = path.join(projectPath, "destination");
        const filePath = (name) => path.join(projectPath, name);
        let pageId;
        try {
            await removeFixtureDirectory(ctx, folder);
            await ctx.app.fs.mkdir(destinationPath);
            await ctx.app.fs.write(filePath("source.txt"), "Copy this fixture.\n");
            await ctx.app.fs.write(filePath("move.txt"), "Move this fixture.\n");
            pageId = await openFolderView(ctx, workspaceParent, "project");

            await openContextMenu(ctx, '[data-type="category-view"]', "source.txt");
            await chooseMenuAction(ctx, "copy");
            await openContextMenu(ctx, '[data-type="category-view"]', "destination");
            await chooseMenuAction(ctx, "paste");
            await ctx.waitFor((activeContext) => activeContext.app.fs.exists(path.join(destinationPath, "source.txt")), Boolean);
            ctx.expect(await ctx.app.fs.exists(filePath("source.txt"))).toBe(true);

            await openContextMenu(ctx, '[data-type="category-view"]', "move.txt");
            await chooseMenuAction(ctx, "cut");
            await openContextMenu(ctx, '[data-type="category-view"]', "destination");
            await chooseMenuAction(ctx, "paste");
            await ctx.waitFor((activeContext) => activeContext.app.fs.exists(path.join(destinationPath, "move.txt")), Boolean);
            await ctx.waitFor((activeContext) => activeContext.app.fs.exists(filePath("move.txt")), (exists) => exists === false);
        } finally {
            await closeOpenMenu(ctx);
            await closePage(ctx, pageId);
            await removeFixtureDirectory(ctx, folder);
        }
    }, { requires: ["desktop", "windows"] }),

    test("Archive Folder View lists a nested category and exposes no write actions", async (ctx) => {
        const folder = ctx.fixture("us-2072/archive-folder-view");
        const archivePath = ctx.fixture("us-2072/archive-folder-view/sample.zip");
        let pageId;
        try {
            await removeFixtureDirectory(ctx, folder);
            await ctx.app.fs.mkdir(folder);
            const zip = new JSZip();
            zip.file("nested/inside.txt", "Archive fixture.\n");
            await nodeFs.writeFile(archivePath, await zip.generateAsync({ type: "nodebuffer" }));

            const page = await ctx.app.pages.openFile(archivePath);
            pageId = page.id;
            await ctx.waitFor((activeContext) => activeContext.app.pages[pageId].editor.id, (id) => id === "archive-view");
            const nestedRef = await snapshotRowRef(ctx, '[data-name="archive-root"]', "nested");
            await ctx.app.window.screen.click({ ref: nestedRef });
            await ctx.waitFor((activeContext) => activeContext.app.pages[pageId].editor.id, (id) => id === "category-view");
            const editor = ctx.app.pages[pageId].editor;
            ctx.expect(await editor.providerType).toBe("archive");
            ctx.expect(await editor.categoryPath).toContain("nested");
            ctx.expect((await editor.items).map((item) => [item.title, item.isDirectory])).toEqual([["inside.txt", false]]);

            await openContextMenu(ctx, '[data-type="category-view"]', "inside.txt");
            // ctx.call remains because the popup menu requires call options such as { dialog: true }.
            const menuItems = await ctx.call("menus[0].items", undefined, { dialog: true });
            const mutatingActions = ["rename", "delete", "new-file", "new-folder", "cut", "copy", "paste"];
            ctx.expect(menuItems.some((item) => mutatingActions.includes(item.id))).toBe(false);
            // ctx.call remains because the popup menu requires call options such as { dialog: true }.
            await ctx.call("menus[0].close", [], { dialog: true });
        } finally {
            await closeOpenMenu(ctx);
            await closePage(ctx, pageId);
            await removeFixtureDirectory(ctx, folder);
        }
    }),
];
