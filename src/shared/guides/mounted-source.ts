/**
 * Mounting a second (third, nth) guide corpus into the single guide index (US-1406 / EPIC-100 D7).
 *
 * The app's own corpus (`assets/guides`) stays the root source. Every installed, TRUSTED board that
 * declares a `guides` folder in its `board-manifest.json` is mounted as an additional `GuideSource`
 * under `installed-boards/<board-id>/`, so its pages reach the About tree, `F1`, `guides.search()`
 * and `guides["installed-boards/<id>/<page>"]` over MCP with no new mechanism — the tree is built
 * purely from slash-separated paths, and the front-matter contract is reused verbatim.
 *
 * Containment is PER MOUNT: each mount owns a `GuideSource` bound to its own root, so a board page
 * can never read outside its own guides folder and the root corpus can never be reached through a
 * board prefix. This module only routes; it never resolves a filesystem path itself.
 */
import type { GuideSource, GuideSourceEntry } from "./index";

/**
 * Top-level branch the installed boards' documentation is mounted under. Deliberately NOT `boards`:
 * `assets/guides/boards.md` already occupies that key and is about *authoring* a board, while this
 * branch is the documentation of the boards *installed on this machine*. Two nodes sharing the key
 * `boards` would collide in the About tree and make the folder unreachable through `guides.boards`.
 */
export const BOARD_GUIDES_PREFIX = "installed-boards";

/** Front-matter `editorId` token a board guide uses to claim *its own* board for `F1`. A board's
 *  real editor id embeds an absolute path (`board-editor:C:\...`), which differs per machine and
 *  so can never be written into a shipped guide. */
export const BOARD_SELF_EDITOR_ID = "board";

/**
 * Normalize a board manifest's `guides` value into a safe, board-relative folder path, or null when
 * the board declares none / declares an unusable one. Separators are unified to "/" and a leading
 * "./" plus a trailing "/" are stripped; an absolute path, a drive letter, a UNC path, or any "."
 * / ".." segment is REJECTED outright rather than repaired -- a board must not be able to point the
 * guide mount at a folder outside itself. Never throws.
 *
 * Lives here rather than in the renderer's `board-manifest.ts` because the main process resolves
 * the same mounts for the MCP guide index and cannot import renderer modules.
 */
export function normalizeBoardGuidesFolder(raw: unknown): string | null {
    if (typeof raw !== "string") return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (/^[A-Za-z]:/.test(trimmed) || trimmed.startsWith("/") || trimmed.startsWith("\\")) return null;
    const unified = trimmed.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
    if (!unified) return null;
    const segments = unified.split("/");
    if (segments.some(segment => !segment || segment === "." || segment === "..")) return null;
    return segments.join("/");
}

export type GuideEntryKind = "directory" | "file";

/** Optional sync probe used by the MCP guide node to choose a folder vs page wrapper for a path. */
export interface GuideEntryKindProbe {
    getEntryKind(relativePath: string): GuideEntryKind | undefined;
}

/** One mounted board corpus. `id` is a single, safe path segment; `source` is rooted at the
 *  board's guides folder and enforces its own containment. */
export interface BoardGuideMount {
    readonly id: string;
    readonly source: GuideSource & Partial<GuideEntryKindProbe>;
}

export type MountedGuideSource = GuideSource & GuideEntryKindProbe;

/** True for a path segment usable as a board-guide mount id. */
export function isSafeMountId(id: string): boolean {
    return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) && id !== "." && id !== "..";
}

/** Derive a mount id from a board root folder: its basename, with anything outside the safe
 *  segment alphabet folded to `-`. Returns undefined when nothing usable remains. */
export function boardGuideIdFromRoot(boardRoot: string): string | undefined {
    const segments = boardRoot.split(/[\\/]+/).filter(Boolean);
    const basename = segments[segments.length - 1] ?? "";
    const candidate = basename.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+/, "");
    return candidate && isSafeMountId(candidate) ? candidate : undefined;
}

/** Make every id unique and deterministic: first occurrence keeps the bare id, later ones get a
 *  numeric suffix. Callers pass roots in a stable (sorted) order. */
export function uniqueMountId(id: string, taken: Set<string>): string {
    if (!taken.has(id)) {
        taken.add(id);
        return id;
    }
    for (let index = 2; ; index++) {
        const candidate = `${id}-${index}`;
        if (!taken.has(candidate)) {
            taken.add(candidate);
            return candidate;
        }
    }
}

/**
 * Compose the root corpus with a dynamic set of board mounts. `resolveBoardMounts` is awaited on
 * every directory read, so installing, updating, untrusting or removing a board is picked up by
 * the next `getTree()` / `search()` without an app restart — the index caches pages by mtime, not
 * the directory structure.
 */
export function createMountedGuideSource(
    root: GuideSource & Partial<GuideEntryKindProbe>,
    resolveBoardMounts: () => Promise<readonly BoardGuideMount[]>,
): MountedGuideSource {
    /** Last resolved mounts, kept only so the SYNC `getEntryKind` probe can answer for a board
     *  that a previous async read already discovered. Never used for reading content. */
    let lastMounts: readonly BoardGuideMount[] = [];

    async function mounts(): Promise<readonly BoardGuideMount[]> {
        lastMounts = await resolveBoardMounts();
        return lastMounts;
    }

    function split(relativePath: string): { id: string; rest: string } | undefined {
        if (relativePath === BOARD_GUIDES_PREFIX) return { id: "", rest: "" };
        if (!relativePath.startsWith(`${BOARD_GUIDES_PREFIX}/`)) return undefined;
        const remainder = relativePath.slice(BOARD_GUIDES_PREFIX.length + 1);
        const slash = remainder.indexOf("/");
        return slash === -1
            ? { id: remainder, rest: "" }
            : { id: remainder.slice(0, slash), rest: remainder.slice(slash + 1) };
    }

    async function readDirectory(relativeDirectory: string): Promise<readonly GuideSourceEntry[]> {
        const parsed = split(relativeDirectory);
        if (!parsed) {
            const entries = await root.readDirectory(relativeDirectory);
            if (relativeDirectory !== "") return entries;
            const boards = await mounts();
            if (boards.length === 0) return entries;
            const withoutCollision = entries.filter(entry => entry.name !== BOARD_GUIDES_PREFIX);
            return [...withoutCollision, { name: BOARD_GUIDES_PREFIX, kind: "directory" }];
        }
        const boards = await mounts();
        if (parsed.id === "") {
            return boards.map(mount => ({ name: mount.id, kind: "directory" as const }));
        }
        const mount = boards.find(candidate => candidate.id === parsed.id);
        // A board that is gone (untrusted, removed, deleted between resolve and read) reads as an
        // empty folder rather than throwing; its pages simply leave the tree on the next scan.
        if (!mount) return [];
        try {
            return await mount.source.readDirectory(parsed.rest);
        } catch {
            return [];
        }
    }

    async function readFile(relativePath: string): Promise<string> {
        const parsed = split(relativePath);
        if (!parsed) return root.readFile(relativePath);
        if (!parsed.id || !parsed.rest) throw new Error(`Guide page "${relativePath}" was not found.`);
        const mount = (await mounts()).find(candidate => candidate.id === parsed.id);
        if (!mount) throw new Error(`Guide page "${relativePath}" was not found.`);
        return mount.source.readFile(parsed.rest);
    }

    function getEntryKind(relativePath: string): GuideEntryKind | undefined {
        const parsed = split(relativePath);
        if (!parsed) return root.getEntryKind?.(relativePath);
        // The branch itself and any single segment under it are folders: an unknown board id then
        // fails as a clean "guide not found" from the folder node rather than as an exception.
        if (!parsed.id || !parsed.rest) return "directory";
        const mount = lastMounts.find(candidate => candidate.id === parsed.id);
        return mount?.source.getEntryKind?.(parsed.rest);
    }

    return { readDirectory, readFile, getEntryKind };
}
