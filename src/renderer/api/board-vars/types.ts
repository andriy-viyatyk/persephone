// =============================================================================
// Board environment-variables schema + load-result types.
//
// The `.env.json` file maps a per-board NAMESPACE ("author/name", "bundled:<folder-id>", or a board root
// path) to PROFILES ("default", "dev", "qa", …), each a flat key→value map of
// string values (connection strings, API keys, passwords). The file may be plain
// JSON or password-encrypted with the app's existing mechanism (ENC-v001: prefix).
// =============================================================================

/** One profile's flat key→value map. Values are strings (connection strings, keys, passwords). */
export type BoardVarsProfile = Record<string, string>;

/** A namespace's profiles. The `default` profile is used when `env` is omitted. */
export type BoardVarsNamespace = Record<string, BoardVarsProfile>;

/** The whole `.env.json`: namespace ("author/name", "bundled:<folder-id>", or a board root path) → profiles. */
export type BoardVarsFile = Record<string, BoardVarsNamespace>;

/** Profile used when a caller omits `env`. */
export const DEFAULT_PROFILE = "default";

/** Outcome of loading the store. */
export type BoardVarsLoadStatus = "ok" | "not-configured" | "locked" | "error";

export interface BoardVarsLoadResult {
    status: BoardVarsLoadStatus;
    /** Present when `status === "error"` (read / JSON.parse failure) — for logging, not the user. */
    message?: string;
}

/** Parse `.env.json` text without imposing a shape policy on the caller. */
export function parseBoardVarsText(text: string): unknown {
    return text.trim() ? JSON.parse(text) as unknown : {};
}

/** Validate the strict editor shape: namespace → profile → key → string. */
export function validateBoardVarsFile(parsed: unknown): asserts parsed is BoardVarsFile {
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Expected a JSON object mapping namespace → profile → key → value.");
    }
    for (const namespace of Object.values(parsed as Record<string, unknown>)) {
        if (!namespace || typeof namespace !== "object" || Array.isArray(namespace)) {
            throw new Error("Expected each namespace to be an object mapping profile → key → value.");
        }
        for (const profile of Object.values(namespace as Record<string, unknown>)) {
            if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
                throw new Error("Expected each profile to be an object mapping key → value.");
            }
            for (const value of Object.values(profile as Record<string, unknown>)) {
                if (typeof value !== "string") {
                    throw new Error("Expected each variable value to be a string.");
                }
            }
        }
    }
}
