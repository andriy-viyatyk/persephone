/**
 * Resolves the board corpora mounted into the MAIN-process guide index,
 * the one `guides.*` over MCP is served from.
 *
 * Trust eligibility is provided by the main-owned board trust snapshot.
 */
import fs from "node:fs";
import path from "node:path";

import { boardTrustService } from "../../board-trust-service";
import { readBoardManifest } from "../../board-manifest-reader";
import { errMessage } from "../../../shared/utils";
import {
    boardGuideIdFromRoot,
    uniqueMountId,
    type BoardGuideMount,
} from "../../../shared/guides/mounted-source";
import { MainGuideSource } from "./guide-source";
import { BoardRoot } from "../../../shared/board/board-root";

/** How long a resolved mount list is reused. Bounds how stale trust and manifest changes can be;
 *  an MCP guide call is far rarer than this, so in practice every call re-resolves. */
const MOUNT_CACHE_MS = 1000;

let cached: readonly BoardGuideMount[] = [];
let cachedAt = 0;

/** The board mounts for the main-process guide index; each source is a `MainGuideSource` rooted at
 *  (and contained by) that board's own guides folder. */
export async function resolveMainBoardGuideMounts(): Promise<readonly BoardGuideMount[]> {
    if (Date.now() - cachedAt < MOUNT_CACHE_MS) return cached;
    try {
        // Deterministic order: sorted by comparison key, so mount ids (and the duplicate-name
        // suffixes) are stable, and so are the tree and `guides.search()`.
        const grantedRoots = await boardTrustService.getGrantedRootsFromSnapshot();
        const roots = [...new Map(grantedRoots.map(root => [BoardRoot.from(root).key, root])).values()].sort((left, right) =>
            BoardRoot.from(left).key < BoardRoot.from(right).key ? -1 : 1);
        const taken = new Set<string>();
        const mounts: BoardGuideMount[] = [];
        for (const boardRoot of roots) {
            const folder = (await readBoardManifest(BoardRoot.from(boardRoot)))?.guides;
            if (!folder) continue;
            const baseId = boardGuideIdFromRoot(boardRoot);
            if (!baseId) continue;
            const guidesRoot = path.join(boardRoot, ...folder.split("/"));
            if (!fs.existsSync(guidesRoot) || !fs.statSync(guidesRoot).isDirectory()) continue;
            mounts.push({ id: uniqueMountId(baseId, taken), source: new MainGuideSource(guidesRoot) });
        }
        cached = mounts;
    } catch (error) {
        console.warn("Failed to resolve board guide mounts:", errMessage(error));
        cached = [];
    }
    cachedAt = Date.now();
    return cached;
}
