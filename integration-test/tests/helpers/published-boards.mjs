import { cp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { REPOSITORY_ROOT } from "../../lib/config.mjs";
import { trustFixtureBoard } from "./boards.mjs";

function boardsDirectory() {
    return process.env.PERSEPHONE_BOARDS_DIR !== undefined
        ? path.resolve(process.env.PERSEPHONE_BOARDS_DIR)
        : path.resolve(REPOSITORY_ROOT, "..", "persephone-boards", "boards");
}

export async function registerPublishedBoard(ctx, id) {
    if (typeof id !== "string" || !/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(id)) {
        throw new TypeError("Published board id must be a safe folder name.");
    }

    const copiedRoot = ctx.fixture(`boards/published-checkout/${id}`);
    const source = path.join(boardsDirectory(), id);
    // A board process from the previous test (e.g. sqlite-viewer's db-server) is killed asynchronously
    // when its page closes and can hold a file in the old copy for a moment; let rm retry.
    await rm(copiedRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    // Copy only what the board publishes: git-ignored runtime files (the bridge's ui.log, a board's
    // cache) come from the user's own sessions and must never enter the test profile (EPIC-195).
    const ignoreText = await readFile(path.join(source, ".gitignore"), "utf8").catch((error) => {
        if (error?.code === "ENOENT") return "";
        throw error;
    });
    const ignoreEntries = ignoreText
        .split(/\r?\n/)
        .map((entry) => entry.trim())
        .filter((entry) => entry && !entry.startsWith("#") && !entry.startsWith("!")
            && !entry.includes("*") && !entry.includes("?") && !entry.includes("\\") && !entry.startsWith("/")
            && (!entry.includes("/") || (entry.endsWith("/") && !entry.slice(0, -1).includes("/"))));
    const ignoredNames = new Set(ignoreEntries.filter((entry) => !entry.endsWith("/")));
    const ignoredDirectories = new Set(ignoreEntries
        .filter((entry) => entry.endsWith("/"))
        .map((entry) => entry.slice(0, -1)));
    const filter = (entryPath) => {
        const relative = path.relative(source, entryPath);
        if (!relative) return true;
        const parts = relative.split(path.sep);
        const name = parts.at(-1);
        return !parts.includes(".git")
            && !parts.includes("node_modules")
            && name !== "ui.log"
            && !name.endsWith(".zip")
            && !parts.some((part) => ignoredNames.has(part) || ignoredDirectories.has(part));
    };
    await cp(source, copiedRoot, {
        recursive: true,
        force: true,
        errorOnExist: false,
        filter,
    });
    await trustFixtureBoard(ctx, copiedRoot);
    return copiedRoot;
}
