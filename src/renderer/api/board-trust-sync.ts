import { api } from "../../ipc/renderer/api";
import type { TrustedBoardSnapshotEntry } from "../../ipc/module-service-channels";
import { errMessage } from "../../shared/utils";
import {
    normalizeBoardServicePath,
    normalizePermissions,
    readBoardManifest,
    type BoardManifest,
} from "../editors/board/board-manifest";
import { canStartBoardService } from "../editors/board/board-service-permission";
import { bundledBoardRegistry } from "../editors/board/bundled-board-registry";
import { boardTrust } from "./board-trust";

let refreshToken = 0;
/**
 * Seeded from the clock, NOT from zero, because main keeps the highest generation it has seen
 * and drops anything lower (`module-service-supervisor.ts`). This counter lives in renderer module
 * scope, so it resets on every renderer reload while main's does not: starting at zero meant that
 * after one reload every snapshot looked stale and was discarded, and trust changes — including
 * UNTRUST, which must stop a running service — silently stopped reaching main until the whole app
 * restarted. A clock seed keeps generations monotonic across reloads and windows while preserving
 * the strictly-increasing ordering the guard relies on within a session. Found by live
 * verification; it is invisible to typecheck, lint and build.
 */
let snapshotGeneration = Date.now();

async function refreshTrustedBoardSnapshot(): Promise<void> {
    const token = ++refreshToken;
    const sources: Array<{ root: string; manifest?: BoardManifest }> = [
        ...boardTrust.listPaths().map((root) => ({ root })),
        ...bundledBoardRegistry.list().map((board) => ({ root: board.root, manifest: board.manifest })),
    ];
    const boards = await Promise.all(sources.map(async ({ root: boardRoot, manifest: cachedManifest }): Promise<TrustedBoardSnapshotEntry> => {
        const manifest = cachedManifest ?? await readBoardManifest(boardRoot);
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
    bundledBoardRegistry.subscribe(() => {
        void refreshTrustedBoardSnapshot().catch((error: unknown) => {
            console.error(`Board service bundled refresh failed: ${errMessage(error)}`);
        });
    });
    await bundledBoardRegistry.ensureInitialized();
    await refreshTrustedBoardSnapshot();
}
