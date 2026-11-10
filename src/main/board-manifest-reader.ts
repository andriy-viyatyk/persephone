import fs from "node:fs";
import path from "node:path";
import { BOARD_MANIFEST_FILE, parseBoardManifest, type NormalizedBoardManifest } from "../shared/board/board-manifest-schema";
import type { BoardRoot } from "../shared/board/board-root";

interface CacheEntry { signature: string; manifest: Promise<NormalizedBoardManifest | null> }
const cache = new Map<string, CacheEntry>();

/** The normalized manifest of a board folder, or null when missing, unreadable or not an object.
 *  Re-stats on every call, so a manifest edited on disk is seen by the next call. Returns a private copy. */
export async function readBoardManifest(root: BoardRoot): Promise<NormalizedBoardManifest | null> {
    const file = path.join(root.path, BOARD_MANIFEST_FILE);
    let signature: string;
    try {
        const stat = await fs.promises.stat(file);
        signature = `${stat.mtimeMs}:${stat.size}`;
    } catch {
        cache.delete(root.key);
        return null;
    }
    let entry = cache.get(root.key);
    if (!entry || entry.signature !== signature) {
        entry = { signature, manifest: loadManifest(file) };
        cache.set(root.key, entry);
    }
    const manifest = await entry.manifest;
    return manifest ? structuredClone(manifest) : null;
}

async function loadManifest(file: string): Promise<NormalizedBoardManifest | null> {
    try {
        return parseBoardManifest(JSON.parse(await fs.promises.readFile(file, "utf8")));
    } catch {
        return null;
    }
}

/** Manifest `name` (trimmed) or the folder name. */
export function boardDisplayName(root: BoardRoot, manifest: Pick<NormalizedBoardManifest, "name"> | null): string {
    return manifest?.name?.trim() || path.basename(root.path) || root.path;
}
