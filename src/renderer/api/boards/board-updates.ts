/**
 * Board update detection + safe-swap orchestration.
 *
 * Derives "a newer COMPATIBLE catalog version than what is installed" from the catalog ×
 * the install registry, and runs the update through BoardLifecycle's open-pages / busy precondition. Kept
 * separate from the toast (BoardEditorModel) and the sidebar (TrustedBoardsList) so the two
 * surfaces agree on what "an update" is and how it is applied.
 */
import { getBoardUpdateForEntry, listBoardUpdatesByRoot } from "./board-update-query";
import type { PublishedBoardInfo } from "../../../ipc/api-param-types";
import { publishedBoards } from "./published-boards";
import { boardInstallRegistry } from "./board-install-registry";
import { boardLifecycle } from "./board-lifecycle";

export interface BoardUpdate {
    /** Installed root (the board folder), original case. */
    root: string;
    /** Catalog board id. */
    id: string;
    installedVersion: string;
    latestVersion: string;
    /** The catalog entry for the latest version (fed to `updateBoard`). */
    entry: PublishedBoardInfo;
}

/**
 * Compute an update for one installed root (sync, non-reactive). Null when: the root is not
 * a catalog install, the catalog has no such id, the latest version is incompatible with the
 * running app, or the installed version is already current-or-newer.
 */
export function getBoardUpdate(root: string): BoardUpdate | null {
    const inst = boardInstallRegistry.getByRoot(root);
    if (!inst) return null;
    const cat = publishedBoards.getCatalog().find((board) => board.id === inst.id);
    return getBoardUpdateForEntry(inst, cat, publishedBoards.isCompatible(cat?.minAppVersion));
}

/**
 * All available updates (sync, non-reactive) — the script-call counterpart of `useBoardUpdates`
 * (a hook can't run in an `app.boards` call). Requires the catalog + install registry already
 * loaded (callers await `publishedBoards.load()` / `boardInstallRegistry.load()` first). Reuses
 * the shared update query so this and the reactive surface can't drift.
 */
export function listBoardUpdates(): BoardUpdate[] {
    return [...listBoardUpdatesByRoot(
        boardInstallRegistry.listInstalled(),
        publishedBoards.getCatalog(),
        (minAppVersion) => publishedBoards.isCompatible(minAppVersion),
    ).values()];
}

/** Update to the catalog-latest version through the shared board lifecycle. */
export async function runBoardUpdate(update: BoardUpdate): Promise<boolean> {
    return boardLifecycle.installVersion({
        root: update.root,
        id: update.id,
        name: update.entry.name,
        archive: update.entry.archive,
        version: update.latestVersion,
        minAppVersion: update.entry.minAppVersion,
    });
}
