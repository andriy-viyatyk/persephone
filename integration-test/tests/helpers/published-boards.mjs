import { cp, rm } from "node:fs/promises";
import path from "node:path";
import { REPOSITORY_ROOT } from "../../lib/config.mjs";
import { trustFixtureBoard } from "../boards/helpers.mjs";

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
    await rm(copiedRoot, { recursive: true, force: true });
    await cp(source, copiedRoot, { recursive: true, force: true, errorOnExist: false });
    await trustFixtureBoard(ctx, copiedRoot);
    return copiedRoot;
}
