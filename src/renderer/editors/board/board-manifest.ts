import { fs } from "../../api/fs";
import { fpBasename, fpDirname, fpJoin } from "../../core/utils/file-path";
import {
    normalizeBoardGuidesFolder,
    normalizeBoardRelativePath,
} from "../../../shared/guides/mounted-source";
import { normalizeVersionRequirement } from "../../../shared/version-utils";

export { normalizeBoardGuidesFolder, normalizeBoardRelativePath };

/** File name of the board-identity manifest, at the board folder root. */
export const BOARD_MANIFEST_FILE = "board-manifest.json";

/** Current manifest schema version. Bump on a breaking shape change. */
export const BOARD_MANIFEST_SCHEMA_VERSION = 1;

/**
 * Board-identity manifest (EPIC-035 / US-745). Its presence is what marks a folder
 * as a board (it gates enumeration; consumed further in US-746 / US-749).
 *
 * Holds `schemaVersion` + optional **descriptive metadata** (name, description, author,
 * repository) plus the **Custom Editor** fields (`fileMasks` / `editorPriority` /
 * `editorName`, EPIC-042). The Custom Editor fields register the board as an editor for
 * matching files, but are **only honored when the board is TRUSTED** — the trust gate is
 * applied by the consumer (the custom-editor registry), never here.
 * Trust is NEVER stored here (a received board must not be able to self-trust —
 * EPIC-035 C2); trust lives in the app-side registry.
 */
/**
 * One secondary (sidebar) view a board declares (EPIC-044). `id` is the stable,
 * author-supplied view key (must NOT contain "::", the sidebar composite-key
 * separator). `html` is the board-relative entry file (defaults to the main
 * entry, "index.html", so one file can serve every view and branch on
 * `persephone.view`). `title` labels the sidebar panel; the panel icon is always
 * the board's own glyph (there is no per-view icon).
 */
export interface SecondaryViewDecl {
    id: string;
    html?: string;
    title?: string;
}

export interface BoardContentProviderDeclaration {
    type: string;
    schemes?: string[];
}

export interface BoardCapabilityDeclaration {
    id: string;
    version?: number;
    priority?: number;
    accepts?: string[];
    payloadSchema?: unknown;
    title?: string;
    headless?: boolean;
}

export interface BoardManifest {
    /** Schema version of this manifest. */
    schemaVersion: number;
    /** Optional display-name override. Falls back to the board folder name. */
    name?: string;
    /** Optional free-text description. Metadata only — does not drive behavior. */
    description?: string;
    /** Optional author / owner. Metadata only. */
    author?: string;
    /** Optional source-repository URL. Metadata only. */
    repository?: string;
    /**
     * Board version (semver string, EPIC-045). Metadata; the installed-version side of
     * the update comparison against the published catalog. Written/bumped by the author.
     */
    version?: string;
    /**
     * Whether the board is meaningful to open with no file / to pin (EPIC-045). Default is
     * DERIVED (see `isBoardStandalone`): true when the board has no `fileMasks`
     * (tools/dashboards), false when it has masks (a file-bound board must opt in).
     */
    standalone?: boolean;
    /**
     * Minimum Persephone version this board version requires (semver; absent = no
     * requirement, EPIC-045). Per-version app-compatibility gate.
     */
    minAppVersion?: string;
    /** Minimum bridge version this board requires (semver; absent = no requirement). */
    minBridgeVersion?: string;

    /** Optional capabilities declared by the board. Values are disclosed and forward-compatible.
     * Known disclosure values include `service`, `contentProviders`, and `capabilities`; unknown
     * non-empty values remain visible so newer boards can be inspected by older Persephone builds.
     */
    permissions?: string[];
    /** Board-relative Node service entry path, honored only by the service supervisor. */
    service?: string;
    /** Provider types and URL schemes contributed by a trusted board. */
    contentProviders?: BoardContentProviderDeclaration[];
    /** Capability handlers contributed by a trusted board. */
    capabilities?: BoardCapabilityDeclaration[];

    // ── Custom Editor axis (EPIC-042) — acted upon only when the board is TRUSTED ──
    /**
     * File masks this board is the editor for, matched against the file NAME (basename).
     * Globs: `*` = any run of chars, `?` = one char. Examples: "*.drawio", "*.grid.json".
     * `normalizeFileMasks` lowercases/trims and coerces a bare extension ("drawio",
     * ".DRAWIO") into a suffix mask ("*.drawio"). Empty/absent → not a file-associated editor.
     */
    fileMasks?: string[];
    /**
     * Optional FOLDER scope for `fileMasks` — the board claims a matching file only when the
     * folder CONTAINING it also matches one of these masks. Absent/empty → any folder (the
     * default, and what every board without this field keeps doing). Narrowing only: folder
     * masks alone, with no `fileMasks`, register nothing.
     *
     * Matched against the file's parent folder, separator-agnostic (`\` and `/` both accepted)
     * and case-insensitive, anchored at the END of the path — a mask is a folder-path SUFFIX.
     * `*` and `?` stop at a separator; `**` crosses them. So `*\/tasks` (a trailing slash is
     * accepted and ignored) matches `…/dev/tasks`, `tasks` matches any folder of that name at
     * any depth, `**\/dev/tasks` spans intermediate segments, and an absolute mask
     * (`c:/projects/evergreen/**`) scopes the board to one tree.
     *
     * The gate is SKIPPED — not failed — when the caller knows only a file NAME and no path
     * (file-icon resolution). See `matchesBoardMasks`.
     */
    folderMasks?: string[];
    /**
     * Direct folder claims for the folder itself, not a file's parent folder. Unlike
     * `folderMasks`, these masks create a folder association even when `fileMasks` and
     * `contentMasks` are absent. Honored only when the board is TRUSTED.
     */
    folderEditorMasks?: string[];
    /**
     * CONTENT detection (EPIC-100 / US-1404) — regular-expression sources tested against the page's
     * text content, the board-manifest counterpart of a built-in matcher's `detectsContent`. A board
     * declaring `"contentMasks": ["\"type\"\s*:\s*\"force-graph\""]` is offered as an editor-switch
     * option for any page whose content matches, including an UNTITLED, in-memory page that no
     * `fileMasks` glob can ever claim (an agent-generated page, a script's output, pasted JSON).
     *
     * Switch-option scope ONLY, exactly like `detectsContent`: content never decides which editor
     * OPENS a file, so `editorPriority` does not apply on this path and a content match can never
     * take a file away from its built-in editor.
     *
     * Case-insensitive; a mask that fails to compile is dropped at normalization. Independent of
     * `fileMasks` — a board may declare content detection alone. Honored only when TRUSTED.
     */
    contentMasks?: string[];
    /**
     * File-open resolution priority on Persephone's editor ladder (monaco 0 / grid 20 /
     * draw 50 / viewers 100 / category 200). The board becomes the DEFAULT editor for its
     * masks when this exceeds the best built-in claimant's priority for the file.
     * Omitted/0 → switch-option-only; the built-in default is unchanged. A board is always
     * a switch option regardless of this value.
     */
    editorPriority?: number;
    /**
     * Folder-open resolution priority for `folderEditorMasks`. A folder board wins the default
     * folder editor only when this exceeds the matching built-in priority. Omitted/0 keeps the
     * built-in default, while the board remains a folder switch candidate.
     */
    folderEditorPriority?: number;
    /**
     * Display name shown on the editor-switch widget for this board. Falls back to `name`,
     * then the board folder name.
     */
    editorName?: string;
    /**
     * How Persephone sets this board up as a file editor (EPIC-043).
     * - absent / "simple": EPIC-042 behavior — the board gets a filePath (`getFilePath`) and
     *   reads/writes the file DIRECTLY via `readFile`/`writeFile`. No Persephone content host.
     * - "content-host": Persephone builds the board WITH a content host (owning the pipe,
     *   encoding, encryption, auto-save cache, and dirty state) and injects `persephone.host.*`.
     * Honored only when the board is TRUSTED, like every other Custom Editor field. Inert until
     * the construction path consumes it (US-845).
     */
    editorKind?: "simple" | "content-host" | "stream-host";
    /**
     * Which SOURCES this board's `fileMasks` association accepts.
     * - absent / "local": plain local files only.
     * - "any": also archive entries (`archive.zip!doc.pdf`) and `http(s)` URLs. Persephone
     *   materializes such a source into a local cache file, so `getFilePath()` still hands the
     *   board a readable LOCAL path and the board needs no special handling.
     * Default-closed on purpose: a board that reads via `readFile(getFilePath())` would FAIL on a
     * bang path or a URL, so an undeclared board keeps losing those files to the built-in editor
     * (a clean fallback) instead of opening and erroring.
     * Honored only when the board is TRUSTED, like every other Custom Editor field.
     */
    editorSources?: "local" | "any";

    /**
     * Secondary (sidebar) views this board contributes (EPIC-044). Independent of
     * `fileMasks` / the custom-editor axis — a plain board can declare them too.
     * Read via `readBoardSecondaryViews` (NOT `getBoardEditorAssociation`).
     */
    secondaryViews?: SecondaryViewDecl[];

    /**
     * Board-relative folder holding the board's own documentation (EPIC-100 D7 / US-1406). When
     * present and the board is TRUSTED, every `.md` file under it is mounted into Persephone's
     * guide index at `installed-boards/<board-id>/…` — the About guide tree, `F1`,
     * `guides.search()` and `guides["installed-boards/<id>/<page>"]` over MCP all pick it up with
     * no further declaration. Pages use the app's own front-matter contract
     * (`title`, `audience`, `summary`, `screen`, `editorId`).
     *
     * A single relative folder name/path, validated by `normalizeBoardGuidesFolder`: absolute
     * paths, drive letters, `..` segments and empty segments are rejected; interior backslashes
     * are repaired to `/`. Absent → the board
     * contributes no documentation, which is what every board built before US-1406 does.
     * Honored only when the board is TRUSTED, like every other capability-bearing field: an
     * untrusted board renders nothing at all, and its Markdown (which may carry raw HTML) is
     * never read into Persephone's own About page.
     */
    guides?: string;
}

/** Absolute path to a board's manifest. */
export function boardManifestPath(boardRoot: string): string {
    return fpJoin(boardRoot, BOARD_MANIFEST_FILE);
}

/** A fresh, minimal manifest. */
export function defaultBoardManifest(): BoardManifest {
    return { schemaVersion: BOARD_MANIFEST_SCHEMA_VERSION };
}

/** True iff the folder carries a `board-manifest.json`. Cheap existence check —
 *  does not parse. (Enumeration / Explorer gating consume this in US-746 / US-749.) */
export async function isBoardFolder(boardRoot: string): Promise<boolean> {
    return fs.exists(boardManifestPath(boardRoot));
}

/** Read + parse a board's manifest. Returns null if absent or unparseable — callers
 *  treat a malformed / missing manifest as "no metadata", never throw. A manifest with
 *  an unknown (higher) schemaVersion is still returned (best-effort forward-compat). */
export async function readBoardManifest(boardRoot: string): Promise<BoardManifest | null> {
    const p = boardManifestPath(boardRoot);
    try {
        if (!(await fs.exists(p))) return null;
        const file = await fs.readFile(p);
        const parsed = JSON.parse(file.content);
        if (!parsed || typeof parsed !== "object") return null;
        return parsed as BoardManifest;
    } catch {
        return null;
    }
}

/** Normalize a manifest version requirement. Invalid values are treated as absent. */
export function normalizeBoardVersionRequirement(raw: unknown): string | undefined {
    return normalizeVersionRequirement(raw);
}

/** Normalize a raw permissions declaration into ordered, unique strings. */
export function normalizePermissions(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    const out: string[] = [];
    for (const entry of raw) {
        if (typeof entry !== "string") continue;
        const permission = entry.trim();
        if (!permission || out.includes(permission)) continue;
        out.push(permission);
    }
    return out;
}

/** Normalize provider declarations while retaining non-empty, un-namespaced types for refusal
 * diagnostics. Blank declarations and blank schemes are unusable and are omitted. */
export function normalizeContentProviders(raw: unknown): BoardContentProviderDeclaration[] {
    if (!Array.isArray(raw)) return [];
    const out: BoardContentProviderDeclaration[] = [];
    for (const entry of raw) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
        const candidate = entry as { type?: unknown; schemes?: unknown };
        const type = typeof candidate.type === "string" ? candidate.type.trim() : "";
        if (!type) continue;
        const schemes: string[] = [];
        if (Array.isArray(candidate.schemes)) {
            for (const schemeEntry of candidate.schemes) {
                if (typeof schemeEntry !== "string") continue;
                const scheme = schemeEntry.trim().toLowerCase().replace(/:$/, "");
                if (scheme && !schemes.includes(scheme)) schemes.push(scheme);
            }
        }
        out.push({ type, schemes });
    }
    return out;
}

/** Normalize capability declaration shape while leaving registry validation to the consumer. */
export function normalizeCapabilities(raw: unknown): BoardCapabilityDeclaration[] {
    if (!Array.isArray(raw)) return [];
    const out: BoardCapabilityDeclaration[] = [];
    for (const entry of raw) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
        const candidate = entry as {
            id?: unknown;
            version?: unknown;
            priority?: unknown;
            accepts?: unknown;
            payloadSchema?: unknown;
            title?: unknown;
            headless?: unknown;
        };
        const accepts: string[] = [];
        if (Array.isArray(candidate.accepts)) {
            for (const acceptEntry of candidate.accepts) {
                if (typeof acceptEntry !== "string") continue;
                const value = acceptEntry.trim();
                if (value && !accepts.includes(value)) accepts.push(value);
            }
        }
        const declaration: BoardCapabilityDeclaration = {
            id: typeof candidate.id === "string" ? candidate.id.trim() : "",
            ...(typeof candidate.version === "number" ? { version: candidate.version } : {}),
            ...(typeof candidate.priority === "number" ? { priority: candidate.priority } : {}),
            ...(accepts.length > 0 ? { accepts } : {}),
            ...("payloadSchema" in candidate ? { payloadSchema: candidate.payloadSchema } : {}),
            ...(typeof candidate.title === "string" ? { title: candidate.title.trim() } : {}),
            ...(typeof candidate.headless === "boolean" ? { headless: candidate.headless } : {}),
        };
        out.push(declaration);
    }
    return out;
}

/** Normalize the board-relative service entry path, or return null for an unsafe declaration. */
export function normalizeBoardServicePath(raw: unknown): string | null {
    return normalizeBoardRelativePath(raw);
}

/**
 * Normalize a raw `fileMasks` value into lowercase, trimmed, de-duplicated glob masks.
 * An explicit glob ("*.grid.json") is kept as-is. A wildcard-free entry is interpreted
 * by shape:
 *
 * - starts with "." → an extension: ".DRAWIO" → "*.drawio", ".grid.json" → "*.grid.json"
 * - no dot at all   → an extension: "drawio" → "*.drawio"
 * - a dot inside it → a whole FILE NAME, kept exact: "DASHBOARD.md" → "dashboard.md",
 *   "package.json" → "package.json"
 *
 * The last case is what lets a board claim one specific file rather than a file type
 * (the case `folderMasks` exists to narrow further). Coercing it to "*.dashboard.md" —
 * as an extension-only reading does — yields a mask that matches nothing at all.
 *
 * Known limit: an extension-less name ("Makefile") is genuinely ambiguous and is read as
 * an extension, since that is overwhelmingly the common intent for a bare word. Spell such
 * a mask with a wildcard if you need it.
 *
 * Non-string / empty entries are dropped. Non-array input → [].
 */
export function normalizeFileMasks(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    const out: string[] = [];
    for (const entry of raw) {
        if (typeof entry !== "string") continue;
        let mask = entry.trim().toLowerCase();
        if (!mask) continue;
        if (!mask.includes("*") && !mask.includes("?")) {
            if (mask.startsWith(".")) {
                mask = "*" + mask;             // ".drawio" / ".grid.json" → extension
            } else if (!mask.includes(".")) {
                mask = "*." + mask;            // "drawio" → extension
            }
            // else: a dot inside a wildcard-free entry → an exact file name; keep as-is.
        }
        if (!out.includes(mask)) out.push(mask);
    }
    return out;
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
    if (!Array.isArray(raw)) return [];
    const out: string[] = [];
    for (const entry of raw) {
        if (typeof entry !== "string") continue;
        const mask = entry
            .trim()
            .toLowerCase()
            .replace(/\\/g, "/")
            .replace(/^\.\//, "")
            .replace(/^\/+/, "")
            .replace(/\/+$/, "");
        if (!mask) continue;
        if (!out.includes(mask)) out.push(mask);
    }
    return out;
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
 * opens a file (`resolveEditorIdForFile`, the editor-switch widget) always hold a full path
 * and so always honor the folder scope.
 */
export function matchesBoardMasks(
    filePathOrName: string,
    fileMasks: string[],
    folderMasks: string[] = [],
): boolean {
    if (!filePathOrName) return false;
    if (!fileMasks.some((m) => matchesFileMask(fpBasename(filePathOrName), m))) return false;
    if (folderMasks.length === 0) return true;
    if (!/[\\/]/.test(filePathOrName)) return true; // a bare name — nothing to gate on
    const folder = fpDirname(filePathOrName);
    return folderMasks.some((m) => matchesFolderMask(folder, m));
}

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
    if (!Array.isArray(raw)) return [];
    const out: string[] = [];
    for (const entry of raw) {
        if (typeof entry !== "string") continue;
        const mask = entry.trim();
        if (!mask || mask.length > MAX_CONTENT_MASK_CHARS) continue;
        if (out.includes(mask)) continue;
        if (!compileContentMask(mask)) continue;
        out.push(mask);
    }
    return out;
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

/** A board's parsed, validated custom-editor association, which may be file-only, folder-only,
 * or both. */
export interface BoardEditorAssociation {
    /** Normalized, lowercase glob masks (e.g. "*.drawio", "*.grid.json"). Empty only for a
     * folder-only association; whenever the file axis is used, this remains non-empty. */
    fileMasks: string[];
    /** Normalized folder globs narrowing `fileMasks` to certain locations. Empty = any folder. */
    folderMasks: string[];
    /** Normalized, compilable content-detection regex sources (US-1404). Empty = no content
     *  detection. Switch-option scope only — never consulted when opening a file. */
    contentMasks: string[];
    /** Resolution priority (>= 0). Non-finite / negative input → 0. */
    editorPriority: number;
    /** Normalized folder globs matching the folder itself for direct folder resolution. */
    folderEditorMasks: string[];
    /** Folder resolution priority (>= 0). Non-finite / non-positive input → 0. */
    folderEditorPriority: number;
    /** Optional switch-widget display name (trimmed; empty → undefined). */
    editorName?: string;
    /** Normalized board editor kind. Unknown values → "simple". */
    editorKind: "simple" | "content-host" | "stream-host";
    /** Normalized accepted sources. Any value other than "any" → "local". */
    editorSources: "local" | "any";
}

/**
 * Extract a custom-editor association from a manifest, or null if the board declares no usable
 * `fileMasks`, `contentMasks`, or `folderEditorMasks`. The result may be file-only, folder-only,
 * or both. Pure — does NOT check trust (the caller gates on trust). This is the single source of
 * truth for how a manifest maps to an editor association.
 */
export function getBoardEditorAssociation(
    manifest: BoardManifest | null | undefined,
): BoardEditorAssociation | null {
    if (!manifest) return null;
    const fileMasks = normalizeFileMasks(manifest.fileMasks);
    const contentMasks = normalizeContentMasks(manifest.contentMasks);
    const folderEditorMasks = normalizeFolderEditorMasks(manifest.folderEditorMasks);
    // `folderMasks` only NARROW file masks, so it alone still creates nothing. `folderEditorMasks`
    // deliberately creates a folder association on its own.
    // `contentMasks` DO (US-1404): a board may detect its format by content alone and appear as a
    // switch option on untitled pages without claiming any file name. `matchesBoardMasks` still
    // requires a file-mask hit, so an empty `fileMasks` can never take a file from a built-in.
    if (
        fileMasks.length === 0
        && contentMasks.length === 0
        && folderEditorMasks.length === 0
    ) return null;
    const folderMasks = normalizeFolderMasks(manifest.folderMasks);
    const rawPriority = manifest.editorPriority;
    const editorPriority =
        typeof rawPriority === "number" && Number.isFinite(rawPriority) && rawPriority > 0
            ? rawPriority
            : 0;
    const rawFolderEditorPriority = manifest.folderEditorPriority;
    const folderEditorPriority =
        typeof rawFolderEditorPriority === "number"
        && Number.isFinite(rawFolderEditorPriority)
        && rawFolderEditorPriority > 0
            ? rawFolderEditorPriority
            : 0;
    const name = typeof manifest.editorName === "string" ? manifest.editorName.trim() : "";
    const editorKind = manifest.editorKind === "content-host" || manifest.editorKind === "stream-host"
        ? manifest.editorKind
        : "simple";
    const editorSources = manifest.editorSources === "any" ? "any" : "local";
    return {
        fileMasks,
        folderMasks,
        contentMasks,
        editorPriority,
        folderEditorMasks,
        folderEditorPriority,
        editorName: name || undefined,
        editorKind,
        editorSources,
    };
}

/**
 * Normalize a raw secondary-views value into validated decls. Forgiving: drops
 * non-object entries, entries with a missing/empty `id`, ids containing "::" (the
 * `<editorId>::<panelId>` composite-key separator), and duplicate ids (first wins);
 * trims `html`/`title` (empty → undefined). Non-array / absent → []. Never throws.
 * Shared by the manifest seed (`readBoardSecondaryViews`) and the runtime
 * `persephone.setSecondaryViews` path (`BoardEditorModel.setSecondaryViews`).
 */
export function normalizeSecondaryViews(raw: unknown): SecondaryViewDecl[] {
    if (!Array.isArray(raw)) return [];
    const out: SecondaryViewDecl[] = [];
    const seen = new Set<string>();
    for (const entry of raw) {
        if (!entry || typeof entry !== "object") continue;
        const d = entry as SecondaryViewDecl;
        const id = typeof d.id === "string" ? d.id.trim() : "";
        if (!id || id.includes("::") || seen.has(id)) continue;
        seen.add(id);
        const html = typeof d.html === "string" && d.html.trim() ? d.html.trim() : undefined;
        const title = typeof d.title === "string" && d.title.trim() ? d.title.trim() : undefined;
        out.push({ id, html, title });
    }
    return out;
}

/**
 * Extract the declared secondary views from a manifest. Independent of `fileMasks`
 * (EPIC-044 O1). Delegates to `normalizeSecondaryViews`.
 */
export function readBoardSecondaryViews(
    manifest: BoardManifest | null | undefined,
): SecondaryViewDecl[] {
    return normalizeSecondaryViews(manifest?.secondaryViews);
}

/** Derived usage group for a board, for UI grouping / pin gating (EPIC-045). */
export type BoardUsageGroup = "file-viewer" | "file-editor" | "tool";

/**
 * Whether a board is standalone — openable with no file and eligible for pinning /
 * the "+" new-page dropdown (EPIC-045). Default when `standalone` is absent: no masks →
 * true (tools/dashboards are inherently standalone), masks → false (a file-bound board
 * must opt in). An explicit boolean always wins.
 */
export function isBoardStandalone(manifest: BoardManifest | null | undefined): boolean {
    if (typeof manifest?.standalone === "boolean") return manifest.standalone;
    return normalizeFileMasks(manifest?.fileMasks).length === 0;
}

/**
 * Derived usage group: **File viewer** (masks, not standalone — e.g. drawio-viewer),
 * **File editor** (masks + standalone — e.g. todo), **Tool / App** (no masks). Used by
 * the hub / pin surfaces to group boards.
 */
export function boardUsageGroup(manifest: BoardManifest | null | undefined): BoardUsageGroup {
    const hasMasks = normalizeFileMasks(manifest?.fileMasks).length > 0;
    if (!hasMasks) return "tool";
    return isBoardStandalone(manifest) ? "file-editor" : "file-viewer";
}

/** Write a manifest (2-space JSON + trailing newline for human-editability). */
export async function writeBoardManifest(boardRoot: string, manifest: BoardManifest): Promise<void> {
    await fs.write(boardManifestPath(boardRoot), JSON.stringify(manifest, null, 2) + "\n");
}

/** Write a default manifest only if the folder doesn't already have one. Used by the
 *  create flow so every new board — including the template-copy-failure fallback —
 *  is a valid, identifiable board. No-op when the template already supplied one. */
export async function ensureBoardManifest(boardRoot: string): Promise<void> {
    if (await isBoardFolder(boardRoot)) return;
    await writeBoardManifest(boardRoot, defaultBoardManifest());
}
