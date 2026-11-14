import { BoardRoot } from "../../../shared/board/board-root";
import { compareVersions } from "../../../shared/version-utils";
import type { PublishedBoardInfo } from "../../../ipc/api-param-types";
import type { InstalledBoardEntry } from "./board-install-registry";
import type { BoardUpdate } from "./board-updates";

/** Derive an available update from one installed entry and its catalog entry. */
export function getBoardUpdateForEntry(
    installed: InstalledBoardEntry | undefined,
    catalogEntry: PublishedBoardInfo | undefined,
    compatible: boolean,
): BoardUpdate | null {
    if (!installed || !catalogEntry || !compatible) return null;
    if (compareVersions(installed.version, catalogEntry.version) <= 0) return null;
    return {
        root: installed.root,
        id: installed.id,
        installedVersion: installed.version,
        latestVersion: catalogEntry.version,
        entry: catalogEntry,
    };
}

/** Build updates keyed by the canonical board-root key, preserving installed iteration order. */
export function listBoardUpdatesByRoot(
    installedEntries: InstalledBoardEntry[],
    catalog: PublishedBoardInfo[],
    isCompatible: (minAppVersion?: string) => boolean,
): Map<string, BoardUpdate> {
    const catalogById = new Map(catalog.map((entry) => [entry.id, entry]));
    const updates = new Map<string, BoardUpdate>();
    for (const installed of installedEntries) {
        const catalogEntry = catalogById.get(installed.id);
        const update = getBoardUpdateForEntry(
            installed,
            catalogEntry,
            catalogEntry ? isCompatible(catalogEntry.minAppVersion) : false,
        );
        if (update) updates.set(BoardRoot.from(update.root).key, update);
    }
    return updates;
}
