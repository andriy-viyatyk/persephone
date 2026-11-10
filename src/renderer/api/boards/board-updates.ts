/**
 * Board update detection + safe-swap orchestration.
 *
 * Derives "a newer COMPATIBLE catalog version than what is installed" from the catalog ×
 * the install registry, and runs the update via board-install's `updateBoard` behind the
 * open-pages / busy precondition (close-pages dialog) required by the epic Design. Kept
 * separate from the toast (BoardEditorModel) and the sidebar (TrustedBoardsList) so the two
 * surfaces agree on what "an update" is and how it is applied.
 */
import { compareVersions } from "../../../shared/version-utils";
import type { PublishedBoardArchive, PublishedBoardInfo } from "../../../ipc/api-param-types";
import { ui } from "../ui";
import { publishedBoards } from "./published-boards";
import { boardInstallRegistry } from "./board-install-registry";
import { ensureBoardIdle, isBoardIdle } from "./board-idle";
import { installVersion } from "./board-install";
import { errMessage } from "../../../shared/utils";
import { t } from "../../../shared/i18n/t";
import { getActiveLocale } from "../../../shared/i18n/active-locale";
import { publishedBoardDisplayText } from "./published-board-display-text";

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
    if (!cat) return null;
    if (!publishedBoards.isCompatible(cat.minAppVersion)) return null;
    // `compareVersions(current, latest)` returns 1 when `latest` (2nd arg) is newer. An update
    // exists iff the catalog version is newer than the installed one -> installed as current.
    if (compareVersions(inst.version, cat.version) <= 0) return null;
    return {
        root: inst.root,
        id: inst.id,
        installedVersion: inst.version,
        latestVersion: cat.version,
        entry: cat,
    };
}

/**
 * All available updates (sync, non-reactive) — the script-call counterpart of `useBoardUpdates`
 * (a hook can't run in an `app.boards` call). Requires the catalog + install registry already
 * loaded (callers await `publishedBoards.load()` / `boardInstallRegistry.load()` first). Reuses
 * `getBoardUpdate` verbatim so this and the reactive surface can't drift.
 */
export function listBoardUpdates(): BoardUpdate[] {
    return boardInstallRegistry
        .listInstalled()
        .map((entry) => getBoardUpdate(entry.root))
        .filter((update): update is BoardUpdate => !!update);
}

/**
 * Preconditioned, user-consented install of a SPECIFIC version into `root` (update, rollback, or
 * forward): ensure idle (close-pages dialog if needed) → swap via `installVersion`, re-checking
 * idleness right before the swap (a page could reopen during the download). Returns whether the
 * swap happened. Never throws — surfaces via toasts.
 */
export async function runBoardVersionInstall(args: {
    root: string;
    id: string;
    name: string;
    archive: PublishedBoardArchive;
    version: string;
}): Promise<boolean> {
    if (!(await ensureBoardIdle(args.root))) return false;
    const catalogEntry = publishedBoards.getCatalog().find((board) => board.id === args.id);
    const displayName = catalogEntry
        ? publishedBoardDisplayText(catalogEntry, getActiveLocale()).name
        : args.name;
    try {
        await ui.showProgress(
            installVersion(args.id, args.archive, args.version, {
                preSwap: async () => isBoardIdle(args.root),
            }),
            t("api.installingBoard", { name: displayName, version: args.version }),
        );
        void ui.notify(t("api.boardInstalled", { name: displayName, version: args.version }), "success");
        return true;
    } catch (err) {
        void ui.notify(t("api.boardInstallFailed", { error: errMessage(err) }), "error");
        return false;
    }
}

/** Update to the catalog-latest version (thin wrapper over `runBoardVersionInstall`). */
export async function runBoardUpdate(update: BoardUpdate): Promise<boolean> {
    return runBoardVersionInstall({
        root: update.root,
        id: update.id,
        name: update.entry.name,
        archive: update.entry.archive,
        version: update.latestVersion,
    });
}
