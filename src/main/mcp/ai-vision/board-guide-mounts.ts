/**
 * Resolves the board corpora mounted into the MAIN-process guide index (US-1406 / EPIC-100 D7),
 * the one `guides.*` over MCP is served from.
 *
 * The trusted-board list is renderer-owned state, but it is persisted as a plain line-delimited
 * file (`<userData>/data/trustedBoards.txt`, see `renderer/api/board-trust.ts`), so the main
 * process reads it directly rather than round-tripping to a window that may not be open. Only
 * TRUSTED boards are mounted — an untrusted board contributes no documentation, exactly as it
 * contributes no editor association.
 */
import fs from "node:fs";
import path from "node:path";

import { getDataFolder } from "../../utils";
import { errMessage } from "../../../shared/utils";
import {
    boardGuideIdFromRoot,
    normalizeBoardGuidesFolder,
    uniqueMountId,
    type BoardGuideMount,
} from "../../../shared/guides/mounted-source";
import { MainGuideSource } from "./guide-source";

const TRUSTED_BOARDS_FILE = "trustedBoards.txt";
const BOARD_MANIFEST_FILE = "board-manifest.json";

/** How long a resolved mount list is reused. Bounds how stale trust and manifest changes can be;
 *  an MCP guide call is far rarer than this, so in practice every call re-resolves. */
const MOUNT_CACHE_MS = 1000;

let cached: readonly BoardGuideMount[] = [];
let cachedAt = 0;

function comparisonKey(boardRoot: string): string {
    return boardRoot.replace(/[\\/]+/g, "/").replace(/\/+$/, "").toLowerCase();
}

function readTrustedRoots(): readonly string[] {
    try {
        const file = path.join(getDataFolder(), TRUSTED_BOARDS_FILE);
        const text = fs.readFileSync(file, "utf-8");
        return text.split("\n").map(line => line.trim()).filter(Boolean);
    } catch {
        return [];
    }
}

function readGuidesFolder(boardRoot: string): string | null {
    try {
        const manifest = JSON.parse(fs.readFileSync(path.join(boardRoot, BOARD_MANIFEST_FILE), "utf-8"));
        return manifest && typeof manifest === "object"
            ? normalizeBoardGuidesFolder((manifest as { guides?: unknown }).guides)
            : null;
    } catch {
        return null;
    }
}

/** The board mounts for the main-process guide index; each source is a `MainGuideSource` rooted at
 *  (and contained by) that board's own guides folder. */
export async function resolveMainBoardGuideMounts(): Promise<readonly BoardGuideMount[]> {
    if (Date.now() - cachedAt < MOUNT_CACHE_MS) return cached;
    try {
        // Deterministic order: sorted by comparison key, so mount ids (and the duplicate-name
        // suffixes) are stable, and so are the tree and `guides.search()`.
        const roots = [...readTrustedRoots()].sort((left, right) =>
            comparisonKey(left) < comparisonKey(right) ? -1 : 1);
        const taken = new Set<string>();
        const mounts: BoardGuideMount[] = [];
        for (const boardRoot of roots) {
            const folder = readGuidesFolder(boardRoot);
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
