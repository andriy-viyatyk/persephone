/** Board tree paths are opaque POSIX-style paths, independent of the host OS. */
export const MAX_BOARD_TREE_PATH_LENGTH = 4096;

export function isValidBoardTreePath(value: unknown): value is string {
    if (typeof value !== "string" || value.length === 0 || value.length > MAX_BOARD_TREE_PATH_LENGTH
        || !value.startsWith("/") || value.includes("\\") || value.includes("\0")) return false;
    if (value === "/") return true;
    const segments = value.slice(1).split("/");
    return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}
