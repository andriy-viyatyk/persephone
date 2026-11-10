import { normalizeBoardGuidesFolder } from "../guides/mounted-source";
import { normalizeCapabilityDeclarations, type CapabilityMethod } from "../capability-contract";
import { normalizeBoardLanguages, type BoardLanguages } from "../i18n/board-pack";
import { normalizeBoardServicePath, normalizeServiceInterfaces, normalizeServiceUses, type BoardServiceInterfaceDeclaration, type BoardServiceUseDeclaration } from "./board-service-declarations";
import { normalizeBrowserUrlMasks, normalizeFileMasks, normalizeFolderMasks, normalizeFolderEditorMasks, normalizeContentMasks } from "./board-masks";
import { normalizePermissions, type BoardPermissionFlags, type NormalizedBoardPermissions } from "./board-permissions";
import { normalizeBoardSettings, type BoardSettingDeclaration } from "./board-settings-declarations";
import { normalizeStringList } from "./normalize-string-list";

export const BOARD_MANIFEST_FILE = "board-manifest.json";
export const BOARD_MANIFEST_SCHEMA_VERSION = 1;

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
    representation?: string;
    version?: number;
    priority?: number;
    accepts?: string[];
    payloadSchema?: unknown;
    title?: string;
    headless?: boolean;
    alwaysOpensNewPage?: boolean;
    methods?: Record<string, CapabilityMethod>;
}


export interface RawBoardManifest {
    /** Schema version of this manifest. */
    schemaVersion: number;
    /** Optional display-name override. Falls back to the board folder name. Together with
     * `author`, this is the stable identity required by later board settings. */
    name?: string;
    /** Optional free-text description. Metadata only — does not drive behavior. */
    description?: string;
    /** Optional author / owner. Metadata generally, but together with `name` this is the stable
     * identity required by later board settings. */
    author?: string;
    /** Optional source-repository URL. Metadata only. */
    repository?: string;
    /**
     * Board version (semver string). Metadata; the installed-version side of
     * the update comparison against the published catalog. Written/bumped by the author.
     */
    version?: string;
    /**
     * Whether the board is meaningful to open with no file / to pin. Default is
     * DERIVED from normalized `fileMasks`: true when the board has no file masks
     * (tools/dashboards), false when it has masks (a file-bound board must opt in).
     */
    standalone?: boolean;
    /** Whether claimed sources should converge on one board page per renderer window. */
    singleInstance?: boolean;
    /** File-name masks that route claimed sources to the single-instance board page. */
    singleInstanceMasks?: string[];
    /**
     * Minimum Persephone version this board version requires (semver; absent = no
     * requirement). Per-version app-compatibility gate.
     */
    minAppVersion?: string;
    /** Minimum bridge version this board requires (semver; absent = no requirement). */
    minBridgeVersion?: string;
    /** Optional board-owned language packs. */
    languages?: { folder?: string; default?: string };

    /** Optional capabilities declared by the board. Values are disclosed and forward-compatible.
     * Known disclosure values include `service`, `contentProviders`, and `capabilities`; unknown
     * non-empty values remain visible so newer boards can be inspected by older Persephone builds.
     */
    permissions?: BoardPermissionFlags | string[];
    /** Board-relative Node service entry path, honored only by the service supervisor. */
    service?: string;
    serviceInterfaces?: BoardServiceInterfaceDeclaration[];
    uses?: BoardServiceUseDeclaration[];
    /** Provider types and URL schemes contributed by a trusted board. */
    contentProviders?: BoardContentProviderDeclaration[];
    /** Capability handlers contributed by a trusted board. */
    capabilities?: BoardCapabilityDeclaration[];
    settings?: unknown;

    // ── Custom Editor axis  — acted upon only when the board is TRUSTED ──
    /**
     * File masks this board is the editor for, matched against the file NAME (basename).
     * Globs: `*` = any run of chars, `?` = one char. Examples: "*.drawio", "*.grid.json".
     * `normalizeFileMasks` lowercases/trims and coerces a bare extension ("drawio",
     * ".DRAWIO") into a suffix mask ("*.drawio"). Empty/absent → not a file-associated editor.
     */
    fileMasks?: string[];
    /** Whole-URL globs for Browser downloads; independent of fileMasks. */
    browserUrlMasks?: string[];
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
     * CONTENT detection — regular-expression sources tested against the page's
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
     * viewers 100 / category 200). The board becomes the DEFAULT editor for its
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
     * How Persephone sets this board up as a file editor.
     * - absent / "simple": behavior — the board gets a filePath (`getFilePath`) and
     *   reads/writes the file DIRECTLY via `readFile`/`writeFile`. No Persephone content host.
     * - "content-host": Persephone builds the board WITH a content host (owning the pipe,
     *   encoding, encryption, auto-save cache, and dirty state) and injects `persephone.host.*`.
     * Honored only when the board is TRUSTED, like every other Custom Editor field. Inert until
     * the construction path consumes it.
     */
    editorKind?: BoardEditorKind;
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
     * Secondary (sidebar) views this board contributes. Independent of
     * `fileMasks` / the custom-editor axis — a plain board can declare them too.
     * Read from the normalized manifest field `secondaryViews`.
     */
    secondaryViews?: SecondaryViewDecl[];

    /**
     * Board-relative folder holding the board's own documentation, with optional `README.md` and `guides/` entries. When
     * present and the board is TRUSTED, every `.md` file under it is mounted into Persephone's
     * guide index at `installed-boards/<board-id>/…` — the About guide tree, `F1`,
     * `guides.search()` and `guides["installed-boards/<id>/<page>"]` over MCP all pick it up with
     * no further declaration. Pages use the app's own front-matter contract
     * (`title`, `audience`, `summary`, `screen`, `editorId`).
     *
     * A single relative folder name/path, validated by `normalizeBoardGuidesFolder`: absolute
     * paths, drive letters, `..` segments and empty segments are rejected; interior backslashes
     * are repaired to `/`. Absent → the board
     * contributes no documentation, which is what every board built before does.
     * Honored only when the board is TRUSTED, like every other capability-bearing field: an
     * untrusted board renders nothing at all, and its Markdown (which may carry raw HTML) is
     * never read into Persephone's own About page.
     */
    guides?: string;
}

export const BOARD_EDITOR_KINDS = ["simple", "content-host", "stream-host"] as const;

export type BoardEditorKind = typeof BOARD_EDITOR_KINDS[number];

export function isBoardEditorKind(value: unknown): value is BoardEditorKind {
    return typeof value === "string" && BOARD_EDITOR_KINDS.includes(value as BoardEditorKind);
}

export interface NormalizedBoardManifest {
    schemaVersion: unknown;
    name?: string;
    description?: string;
    author?: string;
    repository?: string;
    version?: string;
    standalone?: boolean;
    singleInstance?: boolean;
    singleInstanceMasks?: string[];
    minAppVersion?: string;
    minBridgeVersion?: string;
    languages?: BoardLanguages;
    permissions: NormalizedBoardPermissions;
    service?: string;
    serviceInterfaces?: BoardServiceInterfaceDeclaration[];
    uses?: BoardServiceUseDeclaration[];
    contentProviders?: BoardContentProviderDeclaration[];
    capabilities?: BoardCapabilityDeclaration[];
    settings?: BoardSettingDeclaration[];
    fileMasks?: string[];
    browserUrlMasks?: string[];
    folderMasks?: string[];
    folderEditorMasks?: string[];
    contentMasks?: string[];
    editorPriority?: number;
    folderEditorPriority?: number;
    editorName?: string;
    editorKind?: BoardEditorKind;
    editorSources?: "local" | "any";
    secondaryViews?: SecondaryViewDecl[];
    guides?: string;
    association: BoardEditorAssociation | null;
    issues: { kind: "capability" | "settings" | "service-interface"; name: string; reason: string }[];
}

export function normalizeContentProviders(raw: unknown): BoardContentProviderDeclaration[] {
    if (!Array.isArray(raw)) return [];
    const out: BoardContentProviderDeclaration[] = [];
    for (const entry of raw) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
        const candidate = entry as { type?: unknown; schemes?: unknown };
        const type = typeof candidate.type === "string" ? candidate.type.trim() : "";
        if (!type) continue;
        const schemes = normalizeStringList(candidate.schemes, {
            map: (entry) => entry.trim().toLowerCase().replace(/:$/, ""),
        });
        out.push({ type, schemes });
    }
    return out;
}

/** Normalize the board-relative service entry path, or return null for an unsafe declaration. */

/** A board's parsed, validated custom-editor association, which may be file-only, folder-only,
 * or both. */
export interface BoardEditorAssociation {
    /** Normalized, lowercase glob masks (e.g. "*.drawio", "*.grid.json"). Empty only for a
     * folder-only association; whenever the file axis is used, this remains non-empty. */
    fileMasks: string[];
    /** Normalized folder globs narrowing `fileMasks` to certain locations. Empty = any folder. */
    folderMasks: string[];
    /** Normalized, compilable content-detection regex sources. Empty = no content
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
    editorKind: BoardEditorKind;
    /** Normalized accepted sources. Any value other than "any" → "local". */
    editorSources: "local" | "any";
}

/**
 * Extract a custom-editor association from a manifest, or null if the board declares no usable
 * `fileMasks`, `contentMasks`, or `folderEditorMasks`. The result may be file-only, folder-only,
 * or both. Pure — does NOT check trust (the caller gates on trust). This is the single source of
 * truth for how a manifest maps to an editor association.
 */
function createBoardEditorAssociation(
    manifest: Pick<RawBoardManifest, "editorPriority" | "folderEditorPriority" | "editorName" | "editorKind" | "editorSources">,
    fileMasks: string[],
    folderMasks: string[],
    contentMasks: string[],
    folderEditorMasks: string[],
): BoardEditorAssociation | null {
    if (fileMasks.length === 0 && contentMasks.length === 0 && folderEditorMasks.length === 0) return null;
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
    const editorKind: BoardEditorKind = isBoardEditorKind(manifest.editorKind)
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

export function parseBoardManifest(raw: unknown): NormalizedBoardManifest | null {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const source = raw as Record<string, unknown>;
    const has = (key: string) => Object.prototype.hasOwnProperty.call(source, key);
    const issues: NormalizedBoardManifest["issues"] = [];
    const normalized: NormalizedBoardManifest = {
        schemaVersion: source.schemaVersion,
        permissions: normalizePermissions(source.permissions),
        association: null,
        issues,
    };
    const copyString = (key: keyof RawBoardManifest) => {
        const value = source[key];
        if (typeof value === "string") (normalized as unknown as Record<string, unknown>)[key] = value;
    };
    for (const key of ["name", "description", "author", "repository", "version", "minAppVersion", "minBridgeVersion"] as const) {
        copyString(key);
    }
    if (has("languages")) {
        const languages = normalizeBoardLanguages(source.languages);
        if (languages) normalized.languages = languages;
    }
    if (typeof source.standalone === "boolean") normalized.standalone = source.standalone;
    if (typeof source.singleInstance === "boolean") normalized.singleInstance = source.singleInstance;
    if (has("singleInstanceMasks") && Array.isArray(source.singleInstanceMasks)) {
        normalized.singleInstanceMasks = normalizeFileMasks(source.singleInstanceMasks);
    }
    if (typeof source.service === "string") {
        const service = normalizeBoardServicePath(source.service);
        if (service !== null) normalized.service = service;
    }
    if (has("serviceInterfaces")) {
        normalized.serviceInterfaces = normalizeServiceInterfaces(source.serviceInterfaces, (name, reason) => {
            issues.push({ kind: "service-interface", name, reason });
        });
    }
    if (has("uses")) {
        normalized.uses = normalizeServiceUses(source.uses, (name, reason) => {
            issues.push({ kind: "service-interface", name, reason });
        });
    }
    if (has("contentProviders") && Array.isArray(source.contentProviders)) {
        normalized.contentProviders = normalizeContentProviders(source.contentProviders);
    }
    if (has("capabilities") && Array.isArray(source.capabilities)) {
        normalized.capabilities = normalizeCapabilityDeclarations(source.capabilities, (name, reason) => {
            issues.push({ kind: "capability", name, reason });
        }, { service: source.service, permissions: source.permissions });
    }
    if (has("settings")) {
        const declarations = normalizeBoardSettings(raw, (name, reason) => {
            issues.push({ kind: "settings", name, reason });
        });
        if (Array.isArray(source.settings)) normalized.settings = declarations;
    }
    if (has("fileMasks") && Array.isArray(source.fileMasks)) normalized.fileMasks = normalizeFileMasks(source.fileMasks);
    if (has("browserUrlMasks") && Array.isArray(source.browserUrlMasks)) normalized.browserUrlMasks = normalizeBrowserUrlMasks(source.browserUrlMasks);
    if (has("folderMasks") && Array.isArray(source.folderMasks)) normalized.folderMasks = normalizeFolderMasks(source.folderMasks);
    if (has("folderEditorMasks") && Array.isArray(source.folderEditorMasks)) normalized.folderEditorMasks = normalizeFolderEditorMasks(source.folderEditorMasks);
    if (has("contentMasks") && Array.isArray(source.contentMasks)) normalized.contentMasks = normalizeContentMasks(source.contentMasks);
    if (typeof source.editorPriority === "number") normalized.editorPriority = Number.isFinite(source.editorPriority) && source.editorPriority > 0 ? source.editorPriority : 0;
    if (typeof source.folderEditorPriority === "number") normalized.folderEditorPriority = Number.isFinite(source.folderEditorPriority) && source.folderEditorPriority > 0 ? source.folderEditorPriority : 0;
    if (typeof source.editorName === "string" && source.editorName.trim()) normalized.editorName = source.editorName.trim();
    if (isBoardEditorKind(source.editorKind)) normalized.editorKind = source.editorKind;
    if (source.editorSources === "local" || source.editorSources === "any") normalized.editorSources = source.editorSources;
    if (has("secondaryViews") && Array.isArray(source.secondaryViews)) normalized.secondaryViews = normalizeSecondaryViews(source.secondaryViews);
    if (typeof source.guides === "string") {
        const guides = normalizeBoardGuidesFolder(source.guides);
        if (guides !== null) normalized.guides = guides;
    }
    const fileMasks = normalized.fileMasks ?? [];
    const folderMasks = normalized.folderMasks ?? [];
    const contentMasks = normalized.contentMasks ?? [];
    const folderEditorMasks = normalized.folderEditorMasks ?? [];
    normalized.association = createBoardEditorAssociation(normalized, fileMasks, folderMasks, contentMasks, folderEditorMasks);
    return normalized;
}

/**
 * Normalize a raw secondary-views value into validated decls. Forgiving: drops
 * non-object entries, entries with a missing/empty `id`, ids containing "::" (the
 * `<editorId>::<panelId>` composite-key separator), and duplicate ids (first wins);
 * trims `html`/`title` (empty → undefined). Non-array / absent → []. Never throws.
 * Used by the runtime
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

