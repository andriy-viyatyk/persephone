import { api } from "../../ipc/renderer/api";
import type { TrustedBoardSnapshotEntry } from "../../ipc/module-service-channels";
import { errMessage } from "../../shared/utils";
import {
    normalizeBoardServicePath,
    normalizePermissions,
    readBoardManifest,
} from "../editors/board/board-manifest";
import { canStartBoardService } from "../editors/board/board-service-permission";
import { boardTrust } from "./board-trust";

let refreshToken = 0;
let snapshotGeneration = 0;

async function refreshTrustedBoardSnapshot(): Promise<void> {
    const token = ++refreshToken;
    const roots = boardTrust.listPaths();
    const boards = await Promise.all(roots.map(async (boardRoot): Promise<TrustedBoardSnapshotEntry> => {
        const manifest = await readBoardManifest(boardRoot);
        const service = normalizeBoardServicePath(manifest?.service);
        // Keep normalization here as the single renderer-side disclosure/contract
        // read; the predicate remains the one US-1466 trust-plus-permission gate.
        normalizePermissions(manifest?.permissions);
        return {
            boardRoot,
            ...(service ? { service } : {}),
            canStartService: canStartBoardService(boardRoot, manifest),
        };
    }));
    if (token !== refreshToken) return;
    await api.syncTrustedBoardSnapshot({
        generation: ++snapshotGeneration,
        boards,
    });
}

/** Keep main's service registry synchronized for the renderer lifetime. */
export async function initBoardTrustSync(): Promise<void> {
    await boardTrust.load();
    boardTrust.subscribePaths(() => {
        void refreshTrustedBoardSnapshot().catch((error: unknown) => {
            console.error(`Board service trust refresh failed: ${errMessage(error)}`);
        });
    });
    await refreshTrustedBoardSnapshot();
}

