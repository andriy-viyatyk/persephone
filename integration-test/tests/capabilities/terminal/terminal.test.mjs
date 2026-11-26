import { rm } from "node:fs/promises";
import { test } from "../../../lib/context.mjs";
import { samePath } from "../../helpers/path-comparison.mjs";

const FOLDER_NAME = "US-2117 terminal fixture folder";
const MARKER_NAME = "us-2117-terminal-working-directory.txt";

function terminalTest(name, run) {
    return test(name, run, { requires: ["launch", "windows"] });
}

async function removeNamedFolder(ctx, folderPath) {
    for (const folder of await ctx.app.menuFolders.folders) {
        if (folder.name === FOLDER_NAME && folder.path === folderPath) {
            await ctx.app.menuFolders.remove(folder.id);
        }
    }
}

async function openFolderContextMenu(ctx, folderId, label) {
    await ctx.app.window.menuBar.open(folderId);
    const rowId = await ctx.waitFor(
        (active) => active.app.window.screen.evaluate(`() => {
            const list = document.querySelector('[data-name="menubar-folders"]');
            const rows = Array.from(list?.querySelectorAll('[data-type="list-item"]') ?? []);
            return rows.find((item) => item.textContent.trim().endsWith(${JSON.stringify(label)}))?.id ?? null;
        }`),
        (value) => typeof value === "string" && value.length > 0,
    );
    const selector = `[data-name="menubar-folders"] [id=${JSON.stringify(rowId)}]`;
    await ctx.app.window.screen.click(selector);
    await ctx.waitFor((active) => active.app.window.menuBar.selected.id, (id) => id === folderId);
    await ctx.call("window.screen.click", [selector, { button: "right" }], { dialog: true });
}

async function closeTerminalMenu(ctx) {
    await ctx.call("menus[0].close", [], { dialog: true }).catch(() => undefined);
}

async function restoreMenuBar(ctx, wasOpen, selectedId) {
    if (!wasOpen) {
        await ctx.app.window.menuBar.close();
        return;
    }
    try { await ctx.app.window.menuBar.open(selectedId); }
    catch { await ctx.app.window.menuBar.open(); }
}

async function cleanupTerminalTest(ctx, { originalCommand, wasOpen, selectedId, workDir }) {
    await closeTerminalMenu(ctx);
    try { await ctx.app.settings.set("terminal.command", originalCommand); }
    finally {
        try { await removeNamedFolder(ctx, workDir); }
        finally {
            try { await restoreMenuBar(ctx, wasOpen, selectedId); }
            finally { await ctx.app.fs.removeDir(workDir, true); }
        }
    }
}

export default [
    terminalTest("Open terminal here uses the selected folder and exits", async (ctx) => {
        const workDir = ctx.fixture("us-2117/terminal/work");
        const commandPath = ctx.fixture("us-2117/terminal/work/open-here.cmd");
        const fixtureCommand = ctx.fixture("capabilities/terminal/open-here.cmd");
        const originalCommand = await ctx.app.settings.get("terminal.command");
        const wasOpen = await ctx.app.window.menuBar.isOpen;
        const selectedId = await ctx.app.window.menuBar.selected.id;
        let folderId;
        try {
            await ctx.app.fs.removeDir(workDir, true);
            await ctx.app.fs.mkdir(workDir);
            const commandText = await ctx.app.fs.read(fixtureCommand);
            await ctx.app.fs.write(commandPath, commandText);
            folderId = await ctx.app.menuFolders.add({ name: FOLDER_NAME, path: workDir });
            await ctx.app.settings.set("terminal.command", commandPath);

            await openFolderContextMenu(ctx, folderId, FOLDER_NAME);
            await ctx.call("menus[0].click", ["open-terminal-here"], { dialog: true });
            const marker = `${workDir}/${MARKER_NAME}`;
            const recordedDirectory = await ctx.waitFor(
                async () => {
                    try { return await ctx.app.fs.read(marker); }
                    catch { return null; }
                },
                (value) => typeof value === "string" && value.trim().length > 0,
            );
            ctx.expect(samePath(recordedDirectory.trim(), workDir)).toBe(true);
        } finally {
            await cleanupTerminalTest(ctx, { originalCommand, wasOpen, selectedId, workDir });
        }
    }),

    terminalTest("Open terminal here warns when the folder disappears", async (ctx) => {
        const workDir = ctx.fixture("us-2117/terminal/missing-folder");
        const originalCommand = await ctx.app.settings.get("terminal.command");
        const wasOpen = await ctx.app.window.menuBar.isOpen;
        const selectedId = await ctx.app.window.menuBar.selected.id;
        let folderId;
        let warning;
        try {
            await ctx.app.fs.removeDir(workDir, true);
            await ctx.app.fs.mkdir(workDir);
            folderId = await ctx.app.menuFolders.add({ name: FOLDER_NAME, path: workDir });
            await ctx.app.settings.set("terminal.command", "fixture-terminal-command-never-launched");
            await openFolderContextMenu(ctx, folderId, FOLDER_NAME);
            // A call while the popup menu is open returns attention, so remove the folder from the test host.
            await rm(workDir, { recursive: true, force: true });
            await ctx.call("menus[0].click", ["open-terminal-here"], { dialog: true });
            const isFolderWarning = (alert) => alert.type === "warning" && alert.message.includes("Not a folder") && alert.message.includes(workDir);
            // waitFor returns the polled list, not the element the predicate found.
            const alerts = await ctx.waitFor(
                (active) => active.app.ui.alerts.list(),
                (list) => Array.isArray(list) && list.some(isFolderWarning),
            );
            warning = alerts.find(isFolderWarning);
            ctx.expect(warning.type).toBe("warning");
            ctx.expect(warning.message).toContain("Not a folder");
            ctx.expect(warning.message).toContain(workDir);
        } finally {
            if (warning?.key) {
                try { await ctx.app.ui.alerts.close(warning.key); }
                catch { /* The toast may have expired before cleanup. */ }
            }
            await cleanupTerminalTest(ctx, { originalCommand, wasOpen, selectedId, workDir });
        }
    }),
];
