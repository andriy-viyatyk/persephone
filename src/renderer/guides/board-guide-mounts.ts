/**
 * Resolves the board corpora mounted into the renderer's guide index (US-1406 / EPIC-100 D7).
 *
 * Only TRUSTED boards are enumerated. Trust is the gate because a board's guides are Markdown
 * written by the board's author and rendered by Persephone's own Markdown pipeline (which permits
 * raw HTML) inside the About page: a trusted board already runs arbitrary code through
 * `persephone.execute`, so mounting its documentation adds no capability, while an untrusted board
 * must gain none. Untrusting a board therefore drops its pages from the tree and from search, the
 * same way it drops its editor associations.
 */
import { boardTrust } from "../api/board-trust";
import { fs as appFs } from "../api/fs";
import { fpJoin, fpNormalizeForCompare } from "../core/utils/file-path";
import { normalizeBoardGuidesFolder, readBoardManifest } from "../editors/board/board-manifest";
import { boardGuideIdFromRoot, uniqueMountId, type BoardGuideMount } from "../../shared/guides/mounted-source";
import { RendererGuideSource } from "./guide-source";

/** How long a resolved mount list is reused. Trust changes invalidate it immediately; this only
 *  bounds how stale a manifest edit (a board updated in place on disk) can be. */
const MOUNT_CACHE_MS = 2000;

interface ResolvedBoardGuides {
    readonly id: string;
    readonly boardRoot: string;
    readonly guidesRoot: string;
}

let cached: readonly ResolvedBoardGuides[] | undefined;
let cachedAt = 0;
let inFlight: Promise<readonly ResolvedBoardGuides[]> | undefined;

boardTrust.subscribePaths(() => {
    cached = undefined;
    cachedAt = 0;
});

async function resolve(): Promise<readonly ResolvedBoardGuides[]> {
    if (!boardTrust.isLoaded()) await boardTrust.load();
    // Deterministic order: sorted by the comparison key, so mount ids (and the duplicate-name
    // suffixes below) are stable across runs, and so are the tree and `guides.search()`.
    const roots = [...boardTrust.listPaths()].sort((left, right) =>
        fpNormalizeForCompare(left) < fpNormalizeForCompare(right) ? -1 : 1);
    const taken = new Set<string>();
    const resolved: ResolvedBoardGuides[] = [];
    for (const boardRoot of roots) {
        const folder = normalizeBoardGuidesFolder((await readBoardManifest(boardRoot))?.guides);
        if (!folder) continue;
        const baseId = boardGuideIdFromRoot(boardRoot);
        if (!baseId) continue;
        const guidesRoot = fpJoin(boardRoot, ...folder.split("/"));
        const guidesStat = await appFs.stat(guidesRoot);
        if (!guidesStat.exists || !guidesStat.isDirectory) continue;
        resolved.push({ id: uniqueMountId(baseId, taken), boardRoot, guidesRoot });
    }
    return resolved;
}

async function resolveCached(): Promise<readonly ResolvedBoardGuides[]> {
    if (cached && Date.now() - cachedAt < MOUNT_CACHE_MS) return cached;
    if (!inFlight) {
        inFlight = resolve().finally(() => { inFlight = undefined; });
    }
    const resolved = await inFlight;
    cached = resolved;
    cachedAt = Date.now();
    return resolved;
}

/** The board mounts for the renderer guide index; each source is rooted at (and contained by)
 *  that board's own guides folder. */
export async function resolveRendererBoardGuideMounts(): Promise<readonly BoardGuideMount[]> {
    return (await resolveCached()).map(({ id, guidesRoot }) => ({
        id,
        source: new RendererGuideSource(guidesRoot),
    }));
}

/** The mount id of an installed board, or undefined when it contributes no guides. Used by `F1`
 *  to find the branch a board's own guide pages live under. */
export async function getBoardGuideMountId(boardRoot: string): Promise<string | undefined> {
    const key = fpNormalizeForCompare(boardRoot);
    return (await resolveCached()).find(entry => fpNormalizeForCompare(entry.boardRoot) === key)?.id;
}
