import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { test } from "../../../lib/context.mjs";
import { closeBoardPage, fixtureBoard, openBoardPage, trustFixtureBoard, untrustBoard } from "../../helpers/boards.mjs";
import { chooseTreeMenuItem } from "../../helpers/sidebar-helpers.mjs";

const BOARD = "trees/tree-board";
const WORK = "us-2256-transfer";

async function treePageIds(ctx) {
    const ids = [];
    for (const page of await ctx.app.pages.all) {
        try { if (await ctx.app.pages[page.id].panels.explorer.providerType === "test/tree") ids.push(page.id); }
        catch { /* Pages without a mounted tree are not board-tree pages. */ }
    }
    return ids;
}

async function openTree(ctx, board, connection = "a", rootPath = "/") {
    const before = new Set(await treePageIds(ctx));
    await board.editor.evaluate(`async () => await window.persephone.openTree({ type: "test/tree", config: { conn: ${JSON.stringify(connection)} }, rootPath: ${JSON.stringify(rootPath)} })`);
    const id = await ctx.waitFor(async (active) => (await treePageIds(active)).find((value) => !before.has(value)) ?? null, Boolean);
    const slot = `[data-name="page-slot"][data-page-id=${JSON.stringify(id)}]`;
    await ctx.waitFor((active) => active.app.window.screen.evaluate(`() => {
        const slot = document.querySelector(${JSON.stringify(slot)});
        return Boolean(slot?.querySelector('[role="treeitem"], [data-name="tree-provider-empty"], [data-name="tree-provider-error"]'));
    }`), Boolean);
    return id;
}

async function openLocalTree(ctx, folder) {
    const page = await ctx.app.pages.openFile(folder);
    await ctx.waitFor((active) => active.app.pages[page.id].panels.explorer.providerType, (type) => type === "file");
    await ctx.waitFor((active) => active.app.pages[page.id].panels.explorer.listItems(), (items) => items.length > 0);
    return page.id;
}

function tempFolder(ctx, name = "local") {
    const folder = ctx.fixture(`${WORK}/${name}`);
    rmSync(folder, { recursive: true, force: true });
    mkdirSync(folder, { recursive: true });
    return folder;
}

async function withTempFolder(ctx, run) {
    const folder = tempFolder(ctx);
    try {
        await run(folder);
    } finally {
        rmSync(ctx.fixture(WORK), { recursive: true, force: true });
    }
}

function treeSelector(pageId) {
    return `[data-name="page-slot"][data-page-id=${JSON.stringify(pageId)}] [data-type="tree-provider-view"]`;
}

async function treeRowRef(ctx, pageId, name) {
    const root = treeSelector(pageId);
    return ctx.waitFor(async (active) => {
        const snapshot = await active.callText("window.screen.snapshot", [{ interactive: true, root }], { dialog: true });
        const row = snapshot.split("\n").find((line) => line.includes("treeitem") && line.includes(name));
        return row?.match(/\bref=(e\d+)\b/)?.[1] ?? row?.match(/\b(e\d+)\s+treeitem\b/)?.[1] ?? null;
    }, Boolean);
}

async function openTreeContextMenu(ctx, pageId, name) {
    const ref = await treeRowRef(ctx, pageId, name);
    await ctx.call("window.screen.click", [{ ref }, { button: "right" }], { dialog: true });
    await ctx.call("menus[0].items", undefined, { dialog: true });
}

async function confirmTransfer(ctx, label = "Copy") {
    await ctx.waitFor((active) => active.call("dialogs[0].buttons", undefined, { dialog: true }).catch(() => null),
        (buttons) => Array.isArray(buttons) && buttons.includes(label));
    await ctx.call("dialogs[0].click", [label], { dialog: true });
}

async function waitForConflict(ctx) {
    await ctx.waitFor((active) => active.callText("dialogs[0].title", undefined, { dialog: true }).catch(() => null),
        (title) => title === "An item with this name already exists");
}

async function chooseConflict(ctx, action, applyToAll = false) {
    await waitForConflict(ctx);
    if (applyToAll) {
        await ctx.call("dialogs[0].setApplyToAll", [true], { dialog: true });
    }
    const button = { overwrite: "Overwrite", "keep-both": "Keep Both", skip: "Skip" }[action];
    await ctx.call("dialogs[0].click", [button], { dialog: true });
}

async function closeResultDialog(ctx) {
    const buttons = await ctx.waitFor((active) => active.call("dialogs[0].buttons", undefined, { dialog: true }).catch(() => null),
        (value) => Array.isArray(value) && value.length > 0);
    const closing = buttons.find((value) => ["Close", "OK", "Done"].includes(value));
    if (closing) await ctx.call("dialogs[0].click", [closing], { dialog: true });
}

async function copyFromMenu(ctx, pageId, name, cut = false) {
    await openTreeContextMenu(ctx, pageId, name);
    await chooseTreeMenuItem(ctx, cut ? "cut" : "copy");
}

async function activatePage(ctx, pageId) {
    await ctx.app.window.screen.click(`[data-page-id=${JSON.stringify(pageId)}][data-name="page-tab"]`);
}

async function pasteInto(ctx, pageId, name, mode = "Copy") {
    await openTreeContextMenu(ctx, pageId, name);
    await chooseTreeMenuItem(ctx, "paste");
    await confirmTransfer(ctx, mode);
}

async function waitForItem(ctx, pageId, name, present = true) {
    return ctx.waitFor((active) => active.app.pages[pageId].panels.explorer.listItems(),
        (items) => items.some((item) => item.title === name) === present);
}

async function withBoard(ctx, run) {
    const root = fixtureBoard(ctx, BOARD);
    let board;
    try {
        await trustFixtureBoard(ctx, root);
        board = await openBoardPage(ctx, root);
        await run(root, board);
    } finally {
        for (let attempt = 0; attempt < 4; attempt++) {
            const title = await ctx.callText("dialogs[0].title", undefined, { dialog: true }).catch(() => undefined);
            if (title === undefined) break;
            await ctx.call("dialogs[0].cancel", [], { dialog: true }).catch(() => undefined);
        }
        for (const id of await treePageIds(ctx)) await ctx.app.pages.closePage(id).catch(() => undefined);
        await closeBoardPage(ctx, board?.id);
        await untrustBoard(ctx, root);
    }
}

export default [
    test("local files copy into a writable board tree through Copy and Paste menus", async (ctx) => {
        await withTempFolder(ctx, async (folder) => {
        let localId;
        await withBoard(ctx, async (_root, board) => {
            let boardId;
            try {
                writeFileSync(ctx.fixture(`${WORK}/local/send.txt`), "local source bytes\n");
                localId = await openLocalTree(ctx, folder);
                await copyFromMenu(ctx, localId, "send.txt");
                boardId = await openTree(ctx, board, "a", "/data");
                await pasteInto(ctx, boardId, "sample.json");
                await closeResultDialog(ctx);
                await ctx.waitFor((active) => active.app.pages[boardId].panels.explorer.listItems(),
                    (items) => items.some((item) => item.title === "send.txt"));
                ctx.expect(readFileSync(`${folder}/send.txt`, "utf8")).toBe("local source bytes\n");
            } finally {
                if (localId) await ctx.app.pages.closePage(localId).catch(() => undefined);
            }
        });
        });
    }, { requires: ["launch"] }),

    test("board files copy to a local folder through Copy and Paste menus", async (ctx) => {
        await withTempFolder(ctx, async (folder) => {
        mkdirSync(`${folder}/destination`);
        let localId;
        await withBoard(ctx, async (_root, board) => {
            try {
                const boardId = await openTree(ctx, board);
                localId = await openLocalTree(ctx, folder);
                await activatePage(ctx, boardId);
                await copyFromMenu(ctx, boardId, "Readme.md");
                await activatePage(ctx, localId);
                await pasteInto(ctx, localId, "destination");
                await closeResultDialog(ctx);
                await ctx.waitFor(() => existsSync(`${folder}/destination/Readme.md`), Boolean);
                ctx.expect(readFileSync(`${folder}/destination/Readme.md`, "utf8")).toBe("Uppercase sibling.\n");
                ctx.expect((await ctx.app.pages[boardId].panels.explorer.listItems()).some((item) => item.title === "Readme.md")).toBe(true);
            } finally {
                if (localId) await ctx.app.pages.closePage(localId).catch(() => undefined);
            }
        });
        });
    }, { requires: ["launch"] }),

    test("board items copy between connections a and b", async (ctx) => {
        await withBoard(ctx, async (_root, board) => {
            const source = await openTree(ctx, board, "a");
            const target = await openTree(ctx, board, "b", "/data");
            await activatePage(ctx, source);
            await copyFromMenu(ctx, source, "Readme.md");
            await activatePage(ctx, target);
            await pasteInto(ctx, target, "sample.json");
            await closeResultDialog(ctx);
            await waitForItem(ctx, target, "Readme.md");
            ctx.expect((await ctx.app.pages[source].panels.explorer.listItems()).some((item) => item.title === "Readme.md")).toBe(true);
        });
    }, { requires: ["launch"] }),

    test("same-board copy pastes a root item into a subfolder", async (ctx) => {
        await withBoard(ctx, async (_root, board) => {
            const source = await openTree(ctx, board);
            const target = await openTree(ctx, board, "a", "/data");
            await activatePage(ctx, source);
            await copyFromMenu(ctx, source, "Readme.md");
            await activatePage(ctx, target);
            await pasteInto(ctx, target, "sample.json");
            await closeResultDialog(ctx);
            await waitForItem(ctx, target, "Readme.md");
            ctx.expect((await ctx.app.pages[source].panels.explorer.listItems()).some((item) => item.title === "Readme.md")).toBe(true);
        });
    }, { requires: ["launch"] }),

    test("a cut board item is deleted only after its local copy completes", async (ctx) => {
        await withTempFolder(ctx, async (folder) => {
        mkdirSync(`${folder}/destination`);
        let localId;
        await withBoard(ctx, async (_root, board) => {
            try {
                const source = await openTree(ctx, board);
                localId = await openLocalTree(ctx, folder);
                await activatePage(ctx, source);
                await copyFromMenu(ctx, source, "Readme.md", true);
                await activatePage(ctx, localId);
                await pasteInto(ctx, localId, "destination", "Move");
                await closeResultDialog(ctx);
                await waitForItem(ctx, source, "Readme.md", false);
                ctx.expect(readFileSync(`${folder}/destination/Readme.md`, "utf8")).toBe("Uppercase sibling.\n");
            } finally {
                if (localId) await ctx.app.pages.closePage(localId).catch(() => undefined);
            }
        });
        });
    }, { requires: ["launch"] }),

    test("a failed item in a cut and paste keeps its source", async (ctx) => {
        await withTempFolder(ctx, async (folder) => {
        mkdirSync(`${folder}/destination`);
        let localId;
        await withBoard(ctx, async (_root, board) => {
            try {
                const source = await openTree(ctx, board, "a", "/_test");
                localId = await openLocalTree(ctx, folder);
                await activatePage(ctx, source);
                await copyFromMenu(ctx, source, "read-fails.bin", true);
                await activatePage(ctx, localId);
                await pasteInto(ctx, localId, "destination", "Move");
                await closeResultDialog(ctx);
                await waitForItem(ctx, source, "read-fails.bin");
                ctx.expect(existsSync(`${folder}/destination/read-fails.bin`)).toBe(false);
            } finally {
                if (localId) await ctx.app.pages.closePage(localId).catch(() => undefined);
            }
        });
        });
    }, { requires: ["launch"] }),

    test("empty and multi-chunk board files arrive byte-for-byte intact", async (ctx) => {
        await withTempFolder(ctx, async (folder) => {
        mkdirSync(`${folder}/destination`);
        let localId;
        await withBoard(ctx, async (_root, board) => {
            try {
                const expected = Buffer.alloc(5 * 1024 * 1024 + 37);
                for (let index = 0; index < expected.length; index++) expected[index] = (index * 31 + 17) % 256;
                writeFileSync(`${folder}/large-upload.bin`, expected);
                localId = await openLocalTree(ctx, folder);
                await copyFromMenu(ctx, localId, "large-upload.bin");
                const dataTree = await openTree(ctx, board, "a", "/data");
                await pasteInto(ctx, dataTree, "sample.json");
                await closeResultDialog(ctx);
                await waitForItem(ctx, dataTree, "large-upload.bin");

                await copyFromMenu(ctx, dataTree, "large-upload.bin");
                await activatePage(ctx, localId);
                await pasteInto(ctx, localId, "destination");
                await closeResultDialog(ctx);
                await ctx.waitFor(() => existsSync(`${folder}/destination/large-upload.bin`), Boolean);
                const uploaded = readFileSync(`${folder}/destination/large-upload.bin`);
                ctx.expect(uploaded.byteLength).toBe(expected.length);
                ctx.expect(createHash("sha256").update(uploaded).digest("hex")).toBe(createHash("sha256").update(expected).digest("hex"));

                const source = await openTree(ctx, board, "a", "/_test");
                await copyFromMenu(ctx, source, "large.bin");
                await activatePage(ctx, localId);
                await pasteInto(ctx, localId, "destination");
                await closeResultDialog(ctx);
                await ctx.waitFor(() => existsSync(`${folder}/destination/large.bin`), Boolean);
                const actual = readFileSync(`${folder}/destination/large.bin`);
                ctx.expect(actual.byteLength).toBe(expected.length);
                ctx.expect(createHash("sha256").update(actual).digest("hex")).toBe(createHash("sha256").update(expected).digest("hex"));

                await activatePage(ctx, source);
                await copyFromMenu(ctx, source, "empty.bin");
                await activatePage(ctx, localId);
                await pasteInto(ctx, localId, "destination");
                await closeResultDialog(ctx);
                await ctx.waitFor(() => existsSync(`${folder}/destination/empty.bin`), Boolean);
                ctx.expect(readFileSync(`${folder}/destination/empty.bin`).byteLength).toBe(0);
            } finally {
                if (localId) await ctx.app.pages.closePage(localId).catch(() => undefined);
            }
        });
        });
    }, { requires: ["launch"] }),

    ...["overwrite", "skip", "keep-both"].map((choice) => test(`transfer conflict supports ${choice}`, async (ctx) => {
        await withTempFolder(ctx, async (folder) => {
        mkdirSync(`${folder}/destination`);
        writeFileSync(`${folder}/destination/Readme.md`, "keep this original\n");
        let localId;
        await withBoard(ctx, async (_root, board) => {
            try {
                const source = await openTree(ctx, board);
                localId = await openLocalTree(ctx, folder);
                await activatePage(ctx, source);
                await copyFromMenu(ctx, source, "Readme.md");
                await activatePage(ctx, localId);
                await openTreeContextMenu(ctx, localId, "destination");
                await chooseTreeMenuItem(ctx, "paste");
                await confirmTransfer(ctx, "Copy");
                await chooseConflict(ctx, choice);
                await closeResultDialog(ctx);
                if (choice === "overwrite") {
                    ctx.expect(readFileSync(`${folder}/destination/Readme.md`, "utf8")).toBe("Uppercase sibling.\n");
                } else {
                    ctx.expect(readFileSync(`${folder}/destination/Readme.md`, "utf8")).toBe("keep this original\n");
                    if (choice === "keep-both") ctx.expect(readFileSync(`${folder}/destination/Readme (1).md`, "utf8")).toBe("Uppercase sibling.\n");
                }
                ctx.expect((await ctx.app.pages[source].panels.explorer.listItems()).some((item) => item.title === "Readme.md")).toBe(true);
            } finally {
                if (localId) await ctx.app.pages.closePage(localId).catch(() => undefined);
            }
        });
        });
    }, { requires: ["launch"] })),

    test("apply to all carries an overwrite choice through nested file conflicts", async (ctx) => {
        await withTempFolder(ctx, async (folder) => {
        mkdirSync(`${folder}/destination/payload`, { recursive: true });
        writeFileSync(`${folder}/destination/payload/first.txt`, "old first\n");
        writeFileSync(`${folder}/destination/payload/second.txt`, "old second\n");
        let localId;
        await withBoard(ctx, async (_root, board) => {
            try {
                const payloadSource = await openTree(ctx, board, "a", "/_test/conflicts");
                localId = await openLocalTree(ctx, folder);
                await activatePage(ctx, payloadSource);
                await copyFromMenu(ctx, payloadSource, "payload");
                await activatePage(ctx, localId);
                await openTreeContextMenu(ctx, localId, "destination");
                await chooseTreeMenuItem(ctx, "paste");
                await confirmTransfer(ctx, "Copy");
                await chooseConflict(ctx, "overwrite", true);
                await closeResultDialog(ctx);
                ctx.expect(readFileSync(`${folder}/destination/payload/first.txt`, "utf8")).toBe("fixture first source\n");
                ctx.expect(readFileSync(`${folder}/destination/payload/second.txt`, "utf8")).toBe("fixture second source\n");
            } finally {
                if (localId) await ctx.app.pages.closePage(localId).catch(() => undefined);
            }
        });
        });
    }, { requires: ["launch"] }),

    test("cancelling a slow multi-chunk transfer leaves no partial file and keeps its source", async (ctx) => {
        await withBoard(ctx, async (_root, board) => {
            const source = await openTree(ctx, board, "a", "/_test");
            const target = await openTree(ctx, board, "b", "/_test");
            await activatePage(ctx, source);
            await copyFromMenu(ctx, source, "large.bin", true);
            await activatePage(ctx, target);
            await openTreeContextMenu(ctx, target, "slow");
            await chooseTreeMenuItem(ctx, "paste");
            await confirmTransfer(ctx, "Move");
            await ctx.waitFor((active) => active.app.window.screen.evaluate('() => Boolean(document.querySelector(\'[data-name="progress-cancel"]\'))'), Boolean);
            await ctx.app.window.screen.click('[data-name="progress-cancel"]');
            await closeResultDialog(ctx);
            const slowTarget = await openTree(ctx, board, "b", "/_test/slow");
            await waitForItem(ctx, slowTarget, "large.bin", false);
            await waitForItem(ctx, source, "large.bin");
        });
    }, { requires: ["launch"] }),

    test("read-only trees offer Copy and Download to… but no write actions", async (ctx) => {
        await withBoard(ctx, async (_root, board) => {
            const readOnly = await openTree(ctx, board, "ro", "/_test");
            await openTreeContextMenu(ctx, readOnly, "readonly-target");
            const menu = await ctx.call("menus[0].items", undefined, { dialog: true });
            await ctx.call("menus[0].close", [], { dialog: true });
            const serializedMenu = JSON.stringify(menu).toLowerCase();
            for (const available of ['"copy"', '"download-to"']) ctx.expect(serializedMenu).toContain(available);
            for (const unavailable of ['"cut"', '"paste"', '"rename"', '"delete"', '"new-file"', '"new-folder"']) {
                ctx.expect(serializedMenu).not.toContain(unavailable);
            }
        });
    }, { requires: ["launch"] }),

    test("board item menus expose Download to…", async (ctx) => {
        await withBoard(ctx, async (_root, board) => {
            const id = await openTree(ctx, board);
            await openTreeContextMenu(ctx, id, "Readme.md");
            const menu = await ctx.call("menus[0].items", undefined, { dialog: true });
            ctx.expect(JSON.stringify(menu)).toContain("download-to");
            await ctx.call("menus[0].close", [], { dialog: true });
            ctx.expect(await ctx.app.pages[id].panels.explorer.providerType).toBe("test/tree");
        });
    }, { requires: ["launch"] }),
];
