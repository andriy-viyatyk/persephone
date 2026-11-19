import type { BoardRoot } from "./board-root";

/** Whether a board id is safe to use as one path segment. */
export function isSafeBoardId(id: string): boolean {
    return /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(id);
}

/**
 * Resolve a board's persistent data identity without changing its folder name.
 * Bundled boards use their registered id; other boards use the exact root basename.
 */
export function boardDataIdFromRoot(root: BoardRoot, bundledId?: string): string | undefined {
    const id = bundledId ?? root.path.split(/[\\/]/).pop();
    return id && isSafeBoardId(id) ? id : undefined;
}
