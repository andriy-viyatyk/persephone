import type { NormalizedBoardPermissions } from "../shared/board/board-permissions";
import type { BoardServiceUseDeclaration } from "../shared/board/board-service-declarations";

export interface BoardFileAccessGrants {
    folderGrants: string[];
    fileGrants: string[];
}

interface BoardSnapshotEntryBase {
    /** `BoardRoot.path`. The renderer derives the key with `BoardRoot.from(root).key`. */
    root: string;
    /** What the board may do now. Wrap with `BoardGrant.from` to ask questions. Bundled: the manifest's own. */
    permissions: NormalizedBoardPermissions;
    manifestPermissions: NormalizedBoardPermissions;
    /** Main's verdict: a stored grant exists and differs from the manifest's permissions or uses. */
    manifestChanged: boolean;
    uses: BoardServiceUseDeclaration[];
    manifestUses: BoardServiceUseDeclaration[];
    /** Remembered folder and file grants. Empty for bundled boards. */
    fileAccess: BoardFileAccessGrants;
}

export type BoardSnapshotEntry = BoardSnapshotEntryBase
    & ({ origin: "trusted" } | { origin: "bundled"; bundledId: string });

export interface DisabledBundledBoard {
    bundledId: string;
    root: string;
}

export interface BoardSnapshot {
    /** Starts at 1 for the first publish; rises by one for each publish whose content differs. */
    revision: number;
    /** Every permitted board: trusted first, then enabled bundled. Never contains a disabled bundled board. */
    boards: BoardSnapshotEntry[];
    /** Bundled boards the user disabled. Not permitted, but still known to be bundled. */
    disabledBundled: DisabledBundledBoard[];
}
