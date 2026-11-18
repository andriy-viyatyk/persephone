import { test } from "../../../lib/context.mjs";
import { closeBoardPage, fixtureBoard, openBoardPage, resetBoardFile, trustFixtureBoard, untrustBoard } from "../../helpers/boards.mjs";

const INFO_MANIFEST = {
    schemaVersion: 1,
    name: "US-2092 Info Board",
    description: "Fixture board for Board Info properties.",
    author: "Fixture Author",
    version: "1.2.3",
    minBridgeVersion: "1.30.0",
    standalone: false,
    permissions: {
        execute: false,
        service: false,
        fileSystem: "board",
        openExternal: false,
        appScripting: false,
        network: "full",
        clipboardRead: false,
        camera: false,
        microphone: false,
        computerAudio: false,
        geolocation: false,
        notifications: false,
        themes: true,
    },
    fileMasks: ["*.fake"],
};

const INFO_MANIFEST_TEXT = `${JSON.stringify(INFO_MANIFEST, null, 2)}\n`;

async function bestEffort(action) {
    try { await action(); } catch { /* Cleanup must not hide the test result. */ }
}

async function activatePage(ctx, id) {
    await ctx.app.pages.showPage(id);
    await ctx.waitFor((activeContext) => activeContext.app.pages.activePage.id, (activeId) => activeId === id);
}

export default [
    test("Board Info exposes normalized manifest properties", async (ctx) => {
        const root = fixtureBoard(ctx, "permissions/info-board");
        let page;
        try {
            await resetBoardFile(ctx, root, "board-manifest.json", INFO_MANIFEST_TEXT);
            await trustFixtureBoard(ctx, root);
            page = await openBoardPage(ctx, root);
            await activatePage(ctx, page.id);
            await ctx.app.window.screen.click('[data-name="board-toolbar-more"]');
            await ctx.app.window.screen.click('text="Board properties"');
            await ctx.waitFor(
                (activeContext) => activeContext.app.pages[page.id].editor.id,
                (editorId) => editorId === "board-info",
            );

            const properties = await ctx.app.pages[page.id].editor.properties;
            ctx.expect({
                name: properties.name,
                description: properties.description,
                author: properties.author,
                manifestVersion: properties.manifestVersion,
                minBridgeVersion: properties.minBridgeVersion,
                standalone: properties.standalone,
                permissions: properties.permissions,
                permissionLines: properties.permissionLines,
                fileMasks: properties.fileMasks,
                root: properties.root,
                trusted: properties.trusted,
            }).toEqual({
                name: INFO_MANIFEST.name,
                description: INFO_MANIFEST.description,
                author: INFO_MANIFEST.author,
                manifestVersion: "1.2.3",
                minBridgeVersion: INFO_MANIFEST.minBridgeVersion,
                standalone: false,
                permissions: { kind: "flags", flags: INFO_MANIFEST.permissions },
                permissionLines: [
                    "Read and write files in this board's folder (including its own code) and files you pick in its dialogs.",
                    "Connect to the internet, this computer, and your local network.",
                    "Full access",
                    "Can reach everything your user account can.",
                    "Create, change, delete, and apply app themes.",
                ],
                fileMasks: INFO_MANIFEST.fileMasks,
                root,
                trusted: true,
            });
        } finally {
            await bestEffort(() => closeBoardPage(ctx, page?.id));
            await bestEffort(() => resetBoardFile(ctx, root, "board-manifest.json", INFO_MANIFEST_TEXT));
            await bestEffort(() => untrustBoard(ctx, root));
        }
    }),

    test("Board Info unregisters a local fixture board", async (ctx) => {
        const root = fixtureBoard(ctx, "permissions/info-board");
        let page;
        try {
            await resetBoardFile(ctx, root, "board-manifest.json", INFO_MANIFEST_TEXT);
            await trustFixtureBoard(ctx, root);
            page = await openBoardPage(ctx, root);
            await activatePage(ctx, page.id);
            await ctx.app.window.screen.click('[data-name="board-toolbar-more"]');
            await ctx.app.window.screen.click('text="Board properties"');
            await ctx.waitFor(
                (activeContext) => activeContext.app.pages[page.id].editor.id,
                (editorId) => editorId === "board-info",
            );

            await ctx.app.window.screen.click('[data-name="board-info-unregister"]');
            await ctx.waitFor(
                async (activeContext) => {
                    try { return await activeContext.call("dialogs[0].title", undefined, { dialog: true }); }
                    catch { return null; }
                },
                (title) => title === "Remove board",
            );
            ctx.expect(await ctx.call("dialogs[0].buttons", undefined, { dialog: true })).toEqual(["Remove", "Cancel"]);
            await ctx.call("dialogs[0].click", ["Remove"], { dialog: true });
            const boards = await ctx.waitFor(
                (activeContext) => activeContext.app.boards.list(),
                (items) => !items.some((board) => board.root === root),
            );
            ctx.expect(boards.some((board) => board.root === root)).toBe(false);
        } finally {
            await bestEffort(() => ctx.call("dialogs[0].cancel", [], { dialog: true }));
            await bestEffort(() => closeBoardPage(ctx, page?.id));
            await bestEffort(() => resetBoardFile(ctx, root, "board-manifest.json", INFO_MANIFEST_TEXT));
            await bestEffort(() => untrustBoard(ctx, root));
        }
    }),
];
