import crypto from "node:crypto";
import path from "node:path";

/**
 * Return the canonical board-root string used for board identity.
 *
 * The root itself is the identity input: it is never resolved through the
 * filesystem, and no board-controlled path segment is accepted here.
 */
export function normalizeBoardRoot(boardRoot: string): string {
    if (typeof boardRoot !== "string" || !path.isAbsolute(boardRoot)) {
        throw new TypeError("A board root must be an absolute path.");
    }

    const resolved = path.resolve(boardRoot);
    const slashNormalized = process.platform === "win32"
        ? resolved.replace(/\\/g, "/").toLowerCase()
        : resolved;
    return slashNormalized;
}

/** Return the full lowercase SHA-256 digest for a canonical board root. */
export function boardRootKey(boardRoot: string): string {
    const digest = crypto.createHash("sha256").update(normalizeBoardRoot(boardRoot)).digest("hex");
    if (!/^[0-9a-f]{64}$/.test(digest)) {
        throw new Error("Failed to derive a valid board storage key.");
    }
    return digest;
}

/** Return the stable SHA-256 digest for a bundled board folder id. */
export function bundledBoardKey(boardId: string): string {
    const digest = crypto.createHash("sha256").update(`bundled:${boardId}`).digest("hex");
    if (!/^[0-9a-f]{64}$/.test(digest)) {
        throw new Error("Failed to derive a valid bundled board storage key.");
    }
    return digest;
}
