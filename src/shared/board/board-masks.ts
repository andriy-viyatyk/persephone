import { normalizeStringList } from "./normalize-string-list";

export function normalizeFileMasks(raw: unknown): string[] {
    return normalizeStringList(raw, {
        map: (entry) => {
            let mask = entry.trim().toLowerCase();
            if (!mask) return "";
            if (!mask.includes("*") && !mask.includes("?")) {
                if (mask.startsWith(".")) mask = "*" + mask;
                else if (!mask.includes(".")) mask = "*." + mask;
            }
            return mask;
        },
    });
}

/** Compile a single glob mask into a case-insensitive, whole-name RegExp.
 *  `*` → any run, `?` → one char; every other glob char is literal. */
function maskToRegExp(mask: string): RegExp {
    // Escape regex specials EXCEPT the glob wildcards `*` and `?`, then expand those.
    const escaped = mask.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    const body = escaped.replace(/\*/g, ".*").replace(/\?/g, ".");
    return new RegExp(`^${body}$`, "i");
}

/** True iff `fileName` (a basename — caller strips the directory) matches the glob mask.
 *  `mask` is assumed already normalized (lowercase) by `normalizeFileMasks`. */
export function matchesFileMask(fileName: string, mask: string): boolean {
    return maskToRegExp(mask).test(fileName);
}

/**
 * Normalize a raw `folderMasks` value into lowercase, trimmed, de-duplicated folder globs.
 * Separators are unified to "/", a leading "./" and any leading/trailing slashes are stripped
 * (so "*\/tasks/" and "*\/tasks" are the same mask). Unlike `normalizeFileMasks` there is NO
 * bare-name coercion — a plain "tasks" is already a meaningful folder mask. Non-string /
 * empty entries are dropped. Non-array input → [].
 */
export function normalizeFolderMasks(raw: unknown): string[] {
    return normalizeStringList(raw, {
        map: (entry) => entry.trim().toLowerCase().replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "").replace(/\/+$/, ""),
    });
}

/** Normalize direct folder-claim masks with the same separator and glob rules as `folderMasks`.
 * This is a separate manifest axis; callers must not use it as a file-association gate. */
export function normalizeFolderEditorMasks(raw: unknown): string[] {
    return normalizeFolderMasks(raw);
}

/** Stands in for `**` while the single-`*` pass runs. NUL cannot occur in a path (nor in any
 *  sane mask), so it can never collide with authored text — unlike a printable stand-in such
 *  as a space, which is perfectly legal in a folder name. */
const GLOB_SENTINEL = "\u0000";

/** Compile a folder glob into a case-insensitive RegExp anchored at the END of the path
 *  (a folder mask is a path SUFFIX, so it need not spell out the drive/root). `**` crosses
 *  separators; `*` and `?` do not — which is what makes "*\/tasks" mean exactly one segment
 *  above "tasks". */
function folderMaskToRegExp(mask: string): RegExp {
    // Escape regex specials EXCEPT the glob wildcards, then expand those. `**` is parked on
    // the sentinel first so the single-`*` pass cannot chew through it.
    const escaped = mask.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    const body = escaped
        .replace(/\*\*/g, GLOB_SENTINEL)
        .replace(/\*/g, "[^/]*")
        .replace(/\?/g, "[^/]")
        .replace(new RegExp(GLOB_SENTINEL, "g"), ".*");
    return new RegExp(`(?:^|/)${body}$`, "i");
}

/** True iff `folderPath` (a file's parent folder) matches the folder glob `mask`.
 *  `mask` is assumed already normalized (lowercase, "/"-separated) by `normalizeFolderMasks`;
 *  `folderPath` may use either separator and may carry a trailing one. */
export function matchesFolderMask(folderPath: string, mask: string): boolean {
    const normalized = folderPath.replace(/\\/g, "/").replace(/\/+$/, "");
    if (!normalized) return false;
    return folderMaskToRegExp(mask).test(normalized);
}

/** True iff the absolute folder being resolved matches one of the direct folder claims. */
export function matchesFolderEditorMasks(
    folderPath: string,
    folderEditorMasks: string[],
): boolean {
    if (!folderPath) return false;
    return folderEditorMasks.some((mask) => matchesFolderMask(folderPath, mask));
}

/**
 * The single mask predicate for the Custom Editor axis: the board claims `filePathOrName`
 * iff its BASENAME matches one of `fileMasks` **and** (no folder masks, or its parent FOLDER
 * matches one of `folderMasks`).
 *
 * `filePathOrName` may legitimately be a bare file name rather than a path — a page title, or
 * a tree row's display name in the file-icon surfaces. With no directory to inspect, the
 * folder gate cannot be evaluated, and it is SKIPPED rather than failed: a folder-scoped board
 * still lends its icon to every name-matching file. That is a deliberate trade — the icon
 * carries no path, and an icon is cosmetic, whereas the two paths that DECIDE which editor
 * opens a file (merged editor resolution and the editor-switch widget) always hold a full path
 * and so always honor the folder scope.
 */

/** Longest accepted `contentMasks` entry. A content marker is a short regex; anything longer is
 *  a mistake, and an unbounded author-supplied pattern is not worth compiling. */
const MAX_CONTENT_MASK_CHARS = 500;

/** How much of a page's content a content mask is tested against. Markers live at the top of a
 *  document, and the built-in `detectsContent` matchers are documented as fast marker regexes — so
 *  a huge page costs a bounded scan, not a full one. */
const CONTENT_MATCH_LIMIT = 64 * 1024;

/**
 * Normalize a raw `contentMasks` value into usable regex sources: trimmed, non-empty,
 * de-duplicated, length-capped, and **compilable** (an entry `new RegExp(mask, "i")` rejects is
 * dropped, so an author's typo degrades to "no content detection" instead of breaking the
 * registry). Non-array / absent → []. Never throws.
 */
export function normalizeContentMasks(raw: unknown): string[] {
    return normalizeStringList(raw, {
        map: (entry) => entry.trim(),
        accept: (value) => value.length <= MAX_CONTENT_MASK_CHARS && compileContentMask(value) !== null,
    });
}

/** Derive a safe untitled filename from the first normalized literal suffix mask. */
export function untitledFileNameForMasks(fileMasks: readonly string[] | undefined): string {
    for (const mask of fileMasks ?? []) {
        const match = /^\*\.([a-z0-9_-]+(?:\.[a-z0-9_-]+)*)$/.exec(mask);
        if (match) return `untitled.${match[1]}`;
    }
    return "untitled";
}

/** Compiled-mask cache, keyed by the mask source. A board's masks are stable for the life of its
 *  trust, and the switch-options path runs on every toolbar render. `null` marks an uncompilable
 *  source so a bad mask is never re-attempted. */
const contentMaskCache = new Map<string, RegExp | null>();

function compileContentMask(mask: string): RegExp | null {
    const cached = contentMaskCache.get(mask);
    if (cached !== undefined) return cached;
    let compiled: RegExp | null;
    try {
        compiled = new RegExp(mask, "i");
    } catch {
        compiled = null;
    }
    contentMaskCache.set(mask, compiled);
    return compiled;
}

/** True iff any mask matches the leading {@link CONTENT_MATCH_LIMIT} characters of `content`.
 *  `masks` is assumed already normalized (and therefore compilable) by `normalizeContentMasks`. */
export function matchesContentMasks(content: string, masks: string[]): boolean {
    if (!content || masks.length === 0) return false;
    const head = content.length > CONTENT_MATCH_LIMIT ? content.slice(0, CONTENT_MATCH_LIMIT) : content;
    return masks.some((mask) => compileContentMask(mask)?.test(head) ?? false);
}


export const MAX_BROWSER_URL_MASK_CHARS = 512;
export const MAX_BROWSER_URL_MASKS = 64;

export function normalizeBrowserUrlMasks(raw: unknown): string[] {
    return normalizeStringList(raw, {
        map: (entry) => entry.trim().toLowerCase(),
        max: MAX_BROWSER_URL_MASKS,
        accept: (value) => value.length <= MAX_BROWSER_URL_MASK_CHARS,
    });
}

/** A board claims a file iff its name matches and its parent passes any folder gate. */
export function matchesBoardMaskParts(
    fileName: string,
    folder: string | undefined,
    fileMasks: readonly string[],
    folderMasks: readonly string[],
): boolean {
    if (!fileMasks.some((mask) => matchesFileMask(fileName, mask))) return false;
    if (folderMasks.length === 0 || folder === undefined) return true;
    return folderMasks.some((mask) => matchesFolderMask(folder, mask));
}
