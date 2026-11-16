import { test } from "../../../lib/context.mjs";
import { closeOrphanedUs2036Pages, closeOwnedPages, closePendingDialog, closeShellPage, waitForDialog } from "../../helpers/shell-helpers.mjs";

export default [
    test("toolset registration opens with its proposed tools and Cancel leaves it unregistered", async (ctx) => {
        const folder = ctx.fixture("us-2036/toolset");
        const toolsetRoot = `${folder}\\DialogProbe`;
        let beforeTools;
        try {
            await closePendingDialog(ctx);
            await closeOrphanedUs2036Pages(ctx);
            beforeTools = await ctx.call("tools.search", [""]);
            const pending = await ctx.call("tools.createToolset", ["DialogProbe", folder], { dialog: true });
            ctx.expect(pending.pending).toBe(true);
            await waitForDialog(ctx, "dialogs[0].title", (title) => title === "Register this toolset?");
            ctx.expect(await ctx.callText("dialogs[0].message", undefined, { dialog: true })).toContain("run as programs on your computer");
            ctx.expect(await ctx.callText("dialogs[0].toolsetName", undefined, { dialog: true })).toBe("DialogProbe");
            ctx.expect(await ctx.callText("dialogs[0].toolsetRoot", undefined, { dialog: true })).toBe(toolsetRoot);
            const tools = await ctx.call("dialogs[0].tools", undefined, { dialog: true });
            ctx.expect(tools.map((tool) => tool.name)).toEqual(["echo"]);
            ctx.expect(await ctx.call("dialogs[0].buttons", undefined, { dialog: true })).toEqual(["Cancel", "Register toolset"]);
            await ctx.call("dialogs[0].click", ["Cancel"], { dialog: true });
        } finally {
            await closePendingDialog(ctx);
            await ctx.call("fs.removeDir", [folder, true]).catch(() => {});
        }
        const refreshed = await ctx.call("tools.toolsets.refresh", []);
        ctx.expect(refreshed.toolCount).toBe(beforeTools.tools.length);
        ctx.expect(await ctx.call("tools.search", [""])).toEqual(beforeTools);
    }),

    test("Script Library folder opens setup and Cancel leaves it unconfigured", async (ctx) => {
        let previousPath;
        let wasMenuOpen;
        let previousMenuFolder;
        try {
            await closePendingDialog(ctx);
            await closeOrphanedUs2036Pages(ctx);
            wasMenuOpen = await ctx.call("window.menuBar.isOpen");
            previousMenuFolder = await ctx.call("window.menuBar.selected");
            previousPath = await ctx.call("settings.get", ["script-library.path"]);
            await ctx.call("settings.set", ["script-library.path", ctx.fixture("us-2036/library-precondition")]);
            await ctx.call("settings.set", ["script-library.path", ""]);
            await ctx.call("window.menuBar.open", ["script-library"]);
            await ctx.call("window.screen.click", ['[data-name="menu-bar-content"] [data-name="script-library-setup"]']);
            await waitForDialog(ctx, "dialogs[0].buttons", (buttons) => buttons.includes("Link"));
            ctx.expect(await ctx.callText("dialogs[0].folderPath", undefined, { dialog: true })).toBe("");
            ctx.expect(await ctx.call("dialogs[0].copyExamples", undefined, { dialog: true })).toBe(true);
            ctx.expect(await ctx.call("dialogs[0].buttons", undefined, { dialog: true })).toEqual(["Link", "Cancel"]);
            await ctx.call("dialogs[0].click", ["Cancel"], { dialog: true });
            ctx.expect(await ctx.call("settings.get", ["script-library.path"])).toBe("");
        } finally {
            await closePendingDialog(ctx);
            if (previousPath !== undefined) await ctx.call("settings.set", ["script-library.path", previousPath]);
            if (wasMenuOpen) {
                if (previousMenuFolder?.id) await ctx.call("window.menuBar.open", [previousMenuFolder.id]);
            } else {
                await ctx.call("window.menuBar.close", []);
            }
        }
    }),

    test("board variables storage dialog opens from first use and can be cancelled", async (ctx) => {
        const previousPath = await ctx.call("settings.get", ["board-vars.file"]);
        try {
            await closePendingDialog(ctx);
            await closeOrphanedUs2036Pages(ctx);
            await ctx.call("settings.set", ["board-vars.file", ctx.fixture("us-2036/board-vars-precondition.json")]);
            await ctx.call("settings.set", ["board-vars.file", ""]);
            const pending = await ctx.call("boardVars.listNamespaces", [], { dialog: true });
            ctx.expect(pending.pending).toBe(true);
            await waitForDialog(ctx, "dialogs[0].title", (title) => title === "Create environment variables storage");
            const path = await ctx.callText("dialogs[0].path", undefined, { dialog: true });
            ctx.expect(path.length > 0).toBe(true);
            ctx.expect(await ctx.call("dialogs[0].buttons", undefined, { dialog: true })).toEqual(["Cancel", "Create"]);
            await ctx.call("dialogs[0].click", ["Cancel"], { dialog: true });
            ctx.expect(await ctx.call("settings.get", ["board-vars.file"])).toBe("");
        } finally {
            await closePendingDialog(ctx);
            await ctx.call("settings.set", ["board-vars.file", previousPath]);
        }
    }),

    test("New board opens in its fixture workspace and Cancel creates nothing", async (ctx) => {
        const folder = ctx.fixture("us-2036/create-board-workspace");
        let pageId;
        try {
            await closePendingDialog(ctx);
            await closeOrphanedUs2036Pages(ctx);
            await ctx.call("fs.mkdir", [folder]);
            pageId = (await ctx.call("pages.openFile", [folder])).id;
            await ctx.call(`pages[${JSON.stringify(pageId)}].panels.explorer.openBoards`, []);
            const boardsPanel = await ctx.callText("window.screen.snapshot", [{ root: '[data-name="boards-create"]' }]);
            const createButton = boardsPanel.match(/button .*?\[ref=(e\d+)\]/);
            if (!createButton) throw new Error("The fixture workspace Boards panel did not expose its New board control.");
            await ctx.call("window.screen.click", [{ ref: createButton[1] }], { dialog: true });
            await waitForDialog(ctx, "dialogs[0].title", (title) => title === "Create board");
            ctx.expect(await ctx.callText("dialogs[0].folder", undefined, { dialog: true })).toBe(folder);
            ctx.expect(await ctx.callText("dialogs[0].template", undefined, { dialog: true })).toBe("board-template");
            ctx.expect(await ctx.call("dialogs[0].buttons", undefined, { dialog: true })).toEqual(["Cancel", "Create"]);
            await ctx.call("dialogs[0].click", ["Cancel"], { dialog: true });
            ctx.expect(await ctx.call("fs.listDir", [folder])).toEqual([]);
        } finally {
            await closePendingDialog(ctx);
            await closeShellPage(ctx, pageId);
            await ctx.call("fs.removeDir", [folder, true]).catch(() => {});
        }
    }),

    test("opening a fixture board shows Trust Board and Cancel leaves it untrusted", async (ctx) => {
        const folder = ctx.fixture("us-2036/foreign-board");
        const manifest = {
            schemaVersion: 1,
            name: "US-2036 Foreign Board",
            minBridgeVersion: "1.30.0",
            permissions: {
                execute: false, service: false, fileSystem: false, openExternal: false,
                appScripting: false, network: false, clipboardRead: false, camera: false,
                microphone: false, computerAudio: false, geolocation: false,
                notifications: false, themes: false,
            },
        };
        let ownedPageIds = [];
        try {
            await closePendingDialog(ctx);
            await closeOrphanedUs2036Pages(ctx);
            const staleBoardPages = (await ctx.call("pages.all")).filter((page) => page.title === manifest.name);
            await closeOwnedPages(ctx, staleBoardPages.map((page) => page.id));
            await ctx.call("fs.removeDir", [folder, true]).catch(() => {});
            await ctx.call("fs.write", [`${folder}\\board-manifest.json`, JSON.stringify(manifest, null, 2)]);
            const before = await ctx.call("pages.all");
            const pending = await ctx.call("boards.registerBoard", [folder], { dialog: true });
            ctx.expect(pending.pending).toBe(true);
            await waitForDialog(ctx, "dialogs[0].title", (title) => title === "Trust this board?");
            ctx.expect(await ctx.callText("dialogs[0].boardPath", undefined, { dialog: true })).toBe(folder);
            ctx.expect(await ctx.call("dialogs[0].permissions", undefined, { dialog: true })).toEqual({ kind: "flags", flags: manifest.permissions });
            ctx.expect(await ctx.call("dialogs[0].buttons", undefined, { dialog: true })).toEqual(["Cancel", "Trust Board"]);
            await ctx.call("dialogs[0].click", ["Cancel"], { dialog: true });
            ctx.expect((await ctx.call("boards.list", [])).some((board) => board.root === folder)).toBe(false);
            ownedPageIds = (await ctx.call("pages.all")).filter((page) => !before.some((old) => old.id === page.id)).map((page) => page.id);
            ctx.expect(ownedPageIds.length).toBe(0);
        } finally {
            await closePendingDialog(ctx);
            const fixtureBoardPages = (await ctx.call("pages.all")).filter((page) => page.title === manifest.name);
            ownedPageIds.push(...fixtureBoardPages.map((page) => page.id));
            await closeOwnedPages(ctx, ownedPageIds);
            await ctx.call("fs.removeDir", [folder, true]).catch(() => {});
        }
    }),
];
