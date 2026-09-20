/**
 * Custom-editor registry (EPIC-042 / US-837). Enumerates the TRUSTED boards, reads each board's
 * `board-manifest.json`, and maps files → the boards that claim them (via the manifest's
 * `fileMasks` / `editorPriority`, US-836). It answers, synchronously, "which trusted boards
 * claim this file, and at what priority" — the data source the resolution (US-838) and
 * switch-widget tasks consume.
 *
 * Mirrors `registeredTools` (EPIC-038): a `TModel` singleton over `TGlobalState`, an in-memory
 * subscription to trust changes (NOT a filesystem watcher — CE7), a full-rebuild `refresh()`,
 * and sync getters + reactive hooks. An untrust flips associations live (CE3).
 *
 * Nested boards are unsupported by design: each board lives in its own folder, so `refresh()`
 * enumerates `boardTrust.listPaths()` directly and does NO subtree discovery (a board trusted
 * only via an ancestor folder is intentionally not enumerated).
 */
import { TModel } from "../../core/state/model";
import { TGlobalState } from "../../core/state/state";
import { fpBasename, isPlainLocalPath } from "../../core/utils/file-path";
import { editorRegistry } from "../base/editorRegistry";
import { boardTrust } from "../../api/board-trust";
import { boardInstallRegistry } from "../../api/board-install-registry";
import { BOARD_BRIDGE_VERSION } from "../../../shared/board-bridge-version";
import { getBoardCompatibility } from "../../../shared/version-utils";
import {
    replaceProviderDeclarations,
    registerProvider,
    unregisterBoardProviders,
    type ProviderDeclaration,
} from "../../content/registry";
import {
    registerScheme,
    unregisterBoardSchemes,
    type SchemeHooks,
} from "../../content/scheme-registry";
import { createBoardProvider } from "../../content/board-provider-factory";
import {
    normalizeContentProviders,
    normalizeCapabilities,
    getBoardEditorAssociation,
    matchesBoardMasks,
    matchesContentMasks,
    matchesFolderEditorMasks,
    readBoardManifest,
    type BoardContentProviderDeclaration,
    type BoardCapabilityDeclaration,
} from "./board-manifest";
import {
    registerCapability,
    unregisterBoardCapabilities,
} from "../../api/capabilities";

/** Prefix marking a virtual custom-editor id. The remainder is the board root VERBATIM
 *  (original case, may contain ':' and '\\' on Windows — parse by prefix, never by split). */
export const BOARD_EDITOR_ID_PREFIX = "board-editor:";

/** Build the virtual editor id for a board acting as a custom editor. Carries the ORIGINAL-case
 *  root (BoardEditorModel needs the real path to load); do not normalize it into the id. */
export function boardEditorId(boardRoot: string): string {
    return BOARD_EDITOR_ID_PREFIX + boardRoot;
}

/** Extract the board root from a `board-editor:<root>` id, or null if it isn't one. */
export function parseBoardEditorId(editorId: string): string | null {
    return editorId.startsWith(BOARD_EDITOR_ID_PREFIX)
        ? editorId.slice(BOARD_EDITOR_ID_PREFIX.length)
        : null;
}

/** A trusted board association resolved from its manifest. One per trusted board that declares
 *  usable file, content, or direct-folder claims; it may be file-only, folder-only, or both. */
export interface CustomEditorMatch {
    /** Virtual editor id: `board-editor:<boardRoot>` (original-case root). */
    editorId: string;
    /** Absolute board root, original case — what BoardEditorModel loads. */
    boardRoot: string;
    /** Switch-widget display name: editorName ?? manifest.name ?? basename(root). */
    name: string;
    /** File resolution priority (>= 0) from the manifest (US-836 `editorPriority`). */
    priority: number;
    /** The board's normalized glob masks (for file matching + introspection); empty for a
     *  folder-only association. */
    fileMasks: string[];
    /** The board's normalized folder globs, narrowing `fileMasks` to certain locations.
     *  Empty = any folder (the default for boards that declare no `folderMasks`). */
    folderMasks: string[];
    /** The board's normalized direct folder-claim globs, matching the folder itself. */
    folderEditorMasks: string[];
    /** Folder resolution priority from `folderEditorPriority`. */
    folderEditorPriority: number;
    /** The board's normalized content-detection regex sources (US-1404). Empty = none. Consumed
     *  ONLY by `getBoardsForContent` (the editor-switch path); content never opens a file. */
    contentMasks: string[];
    /** Board editor kind (US-843): "simple", "content-host", or the declared "stream-host"
     *  value. Consumed by the construction path (US-845 and later stream-host work). */
    editorKind: "simple" | "content-host" | "stream-host";
    /** Which sources the board accepts: "local" (plain local files only — the default) or "any"
     *  (also archive entries and `http(s)` URLs, materialized by Persephone into a local cache
     *  file). Consumed by the non-local branch of `resolveEditorIdForFile`. */
    editorSources: "local" | "any";
}

/** A trusted board omitted from the editor registry because its bridge requirement is too new. */
export interface CustomEditorIncompatibility {
    boardRoot: string;
    reason: string;
}

export type CustomEditorRegistrationIssueKind = "provider" | "scheme" | "capability";

export interface CustomEditorRegistrationIssue {
    boardRoot: string;
    kind: CustomEditorRegistrationIssueKind;
    name: string;
    reason: string;
    owner?: string;
}

interface BoardRegistrationIntent {
    boardRoot: string;
    declaration: BoardContentProviderDeclaration;
}

interface BoardCapabilityRegistrationIntent {
    boardRoot: string;
    declaration: BoardCapabilityDeclaration;
}

interface CustomEditorRegistryState {
    /** Every trusted board association, in trusted-list (registration) order. */
    entries: CustomEditorMatch[];
    /** Compatibility diagnostics retained for Board Info and future board listings. */
    incompatibilities: CustomEditorIncompatibility[];
    /** Provider and scheme declarations refused during the latest trusted-board rebuild. */
    registrationIssues: CustomEditorRegistrationIssue[];
}

const defaultState: CustomEditorRegistryState = {
    entries: [],
    incompatibilities: [],
    registrationIssues: [],
};

function createBoardSchemeHooks(providerType: string): SchemeHooks {
    return {
        async parse(data, context) {
            data.url = data.href;
            data.handled = false;
            await context.delegate();
            data.handled = true;
        },
        async resolve(data, context) {
            data.target ||= "monaco";
            data.pipeDescriptor = {
                provider: {
                    type: providerType,
                    config: { url: data.url },
                },
                transformers: [],
            };
            data.pipe = context.createPipe(data.pipeDescriptor);
            if (context.phase === "source-path") return;
            data.handled = false;
            await context.delegate();
            data.handled = true;
        },
    };
}

function addRegistrationIssue(
    issues: CustomEditorRegistrationIssue[],
    boardRoot: string,
    kind: CustomEditorRegistrationIssueKind,
    name: string,
    reason: string | undefined,
    owner: string | undefined,
): void {
    issues.push({
        boardRoot,
        kind,
        name,
        reason: reason ?? `The ${kind} registration was refused.`,
        ...(owner !== undefined ? { owner } : {}),
    });
}

class CustomEditorRegistry extends TModel<CustomEditorRegistryState> {
    private initialized = false;
    private pathsSub: (() => void) | undefined;
    /** Generation counter guarding refresh() against stale overwrites: overlapping refreshes
     *  (a rapid untrust+trust pair, e.g. renaming a board folder, fires one per mutation) can
     *  finish out of order, and an earlier refresh landing last would clobber the newer entry
     *  list — leaving a just-trusted board unregistered. Only the newest generation may write. */
    private refreshGen = 0;

    constructor() {
        super(new TGlobalState(defaultState));
        // In-memory reactive subscription (NOT a filesystem watcher): re-enumerate on any
        // trust/untrust — this is what makes an untrust drop the association live (CE3/CE7).
        this.pathsSub = boardTrust.subscribePaths(() => {
            void this.refresh();
        });
    }

    /** Idempotent: load the trusted list then enumerate. Call before reading state. */
    async ensureInitialized(): Promise<void> {
        if (this.initialized) return;
        this.initialized = true;
        await boardTrust.load();
        await boardInstallRegistry.load();
        await this.refresh();
    }

    /** Re-read every trusted board's manifest and rebuild the reactive state. Full rebuild
     *  (cheap at registry scale; a manifest edit can change masks/priority). Enumerates all
     *  trusted roots directly — nested boards are unsupported by design, so no subtree walk. */
    async refresh(): Promise<void> {
        const gen = ++this.refreshGen;
        const roots = boardTrust.listPaths();
        const entries: CustomEditorMatch[] = [];
        const incompatibilities: CustomEditorIncompatibility[] = [];
        const registrationIntents: BoardRegistrationIntent[] = [];
        const capabilityRegistrationIntents: BoardCapabilityRegistrationIntent[] = [];
        const registrationIssues: CustomEditorRegistrationIssue[] = [];
        const providerDeclarations: ProviderDeclaration[] = [];
        for (const root of roots) {
            const manifest = await readBoardManifest(root);
            const bridgeCompatibility = getBoardCompatibility(
                { minBridgeVersion: manifest?.minBridgeVersion },
                { bridgeVersion: BOARD_BRIDGE_VERSION },
            );
            if (!bridgeCompatibility.compatible) {
                if (bridgeCompatibility.reason) {
                    incompatibilities.push({ boardRoot: root, reason: bridgeCompatibility.reason });
                }
                continue;
            }
            for (const declaration of normalizeCapabilities(manifest?.capabilities)) {
                capabilityRegistrationIntents.push({ boardRoot: root, declaration });
            }
            for (const declaration of normalizeContentProviders(manifest?.contentProviders)) {
                if (!declaration.type.includes("/")) {
                    addRegistrationIssue(
                        registrationIssues,
                        root,
                        "provider",
                        declaration.type,
                        `Provider type "${declaration.type}" must contain "/"; un-namespaced provider types are reserved for the platform.`,
                        undefined,
                    );
                    continue;
                }
                registrationIntents.push({ boardRoot: root, declaration });
                providerDeclarations.push({
                    type: declaration.type,
                    boardRoot: root,
                    boardName: (manifest?.name && manifest.name.trim()) || fpBasename(root),
                    trusted: true,
                    source: "trusted",
                });
            }
            const assoc = getBoardEditorAssociation(manifest);
            if (!assoc) continue; // neither fileMasks nor contentMasks → not a custom editor
            const name =
                assoc.editorName ||
                (manifest && typeof manifest.name === "string" && manifest.name.trim()) ||
                fpBasename(root);
            entries.push({
                editorId: boardEditorId(root),
                boardRoot: root,
                name,
                priority: assoc.editorPriority,
                fileMasks: assoc.fileMasks,
                folderMasks: assoc.folderMasks,
                folderEditorMasks: assoc.folderEditorMasks,
                folderEditorPriority: assoc.folderEditorPriority,
                contentMasks: assoc.contentMasks,
                editorKind: assoc.editorKind,
                editorSources: assoc.editorSources,
            });
        }
        for (const installed of boardInstallRegistry.listInstalled()) {
            if (boardTrust.isTrusted(installed.root)) continue;
            const manifest = await readBoardManifest(installed.root);
            const bridgeCompatibility = getBoardCompatibility(
                { minBridgeVersion: manifest?.minBridgeVersion },
                { bridgeVersion: BOARD_BRIDGE_VERSION },
            );
            if (!bridgeCompatibility.compatible) continue;
            for (const declaration of normalizeContentProviders(manifest?.contentProviders)) {
                if (!declaration.type.includes("/")) continue;
                providerDeclarations.push({
                    type: declaration.type,
                    boardRoot: installed.root,
                    boardName: (manifest?.name && manifest.name.trim()) || fpBasename(installed.root),
                    trusted: false,
                    source: "installed",
                });
            }
        }
        if (gen !== this.refreshGen) return; // superseded by a newer refresh — discard

        // Registry maps and reactive state are committed synchronously as one rebuild. In
        // particular, clear every board-origin registration, including boards no longer in the
        // trust list after an untrust, uninstall, or folder rename.
        unregisterBoardProviders(roots);
        unregisterBoardSchemes(roots);
        // `roots` is only the next rebuild snapshot. Release the complete board-origin set so an
        // already-untrusted board, absent from `roots`, cannot leave a stale capability behind.
        unregisterBoardCapabilities(roots);
        replaceProviderDeclarations(providerDeclarations);
        for (const { boardRoot, declaration } of capabilityRegistrationIntents) {
            const result = registerCapability(declaration, {
                boardRoot,
                handlerKey: boardEditorId(boardRoot),
                origin: "board",
            });
            if (!result.accepted) {
                addRegistrationIssue(
                    registrationIssues,
                    boardRoot,
                    "capability",
                    declaration.id || "<empty id>",
                    result.reason,
                    result.owner,
                );
            }
        }
        for (const { boardRoot, declaration } of registrationIntents) {
            const providerResult = registerProvider(
                declaration.type,
                (config) => createBoardProvider(boardRoot, declaration.type, config),
                { origin: "board", owner: boardRoot },
            );
            if (!providerResult.accepted) {
                addRegistrationIssue(
                    registrationIssues,
                    boardRoot,
                    "provider",
                    declaration.type,
                    providerResult.reason,
                    providerResult.owner,
                );
                // A declaration whose provider type was refused must NOT claim its schemes.
                // Registering them anyway would point this board's scheme at a provider type it
                // does not own — on a collision, at the WINNING board's provider — so a link in
                // one board's scheme would silently read through another board's provider.
                for (const scheme of declaration.schemes ?? []) {
                    addRegistrationIssue(
                        registrationIssues,
                        boardRoot,
                        "scheme",
                        scheme,
                        `Not registered because provider type "${declaration.type}" was refused.`,
                        providerResult.owner,
                    );
                }
                continue;
            }
            for (const scheme of declaration.schemes ?? []) {
                const schemeResult = registerScheme(
                    scheme,
                    createBoardSchemeHooks(declaration.type),
                    { origin: "board", owner: boardRoot },
                );
                if (!schemeResult.accepted) {
                    addRegistrationIssue(
                        registrationIssues,
                        boardRoot,
                        "scheme",
                        scheme,
                        schemeResult.reason,
                        schemeResult.owner,
                    );
                }
            }
        }
        this.state.update((s) => {
            s.entries = entries;
            s.incompatibilities = incompatibilities;
            s.registrationIssues = registrationIssues;
        });
    }

    /** All file-associated boards (sync, non-reactive). */
    get entries(): CustomEditorMatch[] {
        return this.state.get().entries;
    }

    /** Trusted boards excluded by the bridge compatibility gate, with a readable reason. */
    get incompatibilities(): readonly CustomEditorIncompatibility[] {
        return this.state.get().incompatibilities;
    }

    /** Registration refusals for one board, retained for the Board Info properties view. */
    getRegistrationIssues(boardRoot: string): readonly CustomEditorRegistrationIssue[] {
        return this.state.get().registrationIssues.filter((issue) => issue.boardRoot === boardRoot);
    }

    /**
     * Boards claiming `fileName`, in trusted-list order (SYNC — safe for resolveId). Matching is
     * `matchesBoardMasks`: the BASENAME against each board's file masks (a mask like "*.drawio"
     * must not match a directory segment), plus the parent FOLDER against its folder masks when
     * it declares any. Pass a full path whenever one is available — a bare name cannot satisfy
     * the folder gate, so `matchesBoardMasks` skips it (see its doc). Returns [] before
     * `ensureInitialized()` completes → graceful built-in fallback. Local-file gating (CE4: hide
     * the option for https/archive) is the CALLER's job, not here.
     */
    getBoardsForFile(fileName: string): CustomEditorMatch[] {
        if (!fileName) return [];
        return this.state
            .get()
            .entries.filter((e) => matchesBoardMasks(fileName, e.fileMasks, e.folderMasks));
    }

    /** Boards whose distinct direct folder claims match `folderPath`, in trusted-list order. */
    getBoardsForFolder(folderPath: string): CustomEditorMatch[] {
        if (!folderPath) return [];
        return this.state
            .get()
            .entries.filter((e) => matchesFolderEditorMasks(folderPath, e.folderEditorMasks));
    }

    /**
     * Boards whose `contentMasks` match this page's CONTENT (SYNC — safe for a toolbar render).
     *
     * The board counterpart of a built-in matcher's `detectsContent`, and scoped identically: this
     * feeds the editor-SWITCH widget only, so a board can claim an untitled, in-memory page (an
     * agent-generated graph, a script's output, pasted JSON) that no file mask can ever match.
     * Nothing here participates in `resolveEditorIdForFile`, so content can never take a file away
     * from the editor that would otherwise open it.
     */
    getBoardsForContent(content: string): CustomEditorMatch[] {
        if (!content) return [];
        return this.state
            .get()
            .entries.filter((e) => matchesContentMasks(content, e.contentMasks));
    }

    dispose(): void {
        this.pathsSub?.();
        this.pathsSub = undefined;
        // Drain the model's DisposableStore after existing teardown.
        super.dispose();
    }
}

export const customEditorRegistry = new CustomEditorRegistry();

/**
 * Resolve the winning editor id for opening a file, merging the built-in registry with
 * trusted file-associated boards (EPIC-042). A board wins when it can handle the SOURCE (see the
 * capability gate below) and its `editorPriority` is STRICTLY greater than the best built-in
 * claimant (built-ins win exact ties; among boards, trusted-list order — `getBoardsForFile`
 * preserves it). Returns the built-in id otherwise.
 *
 * Consumed by the two file-open decision points — `PagesLifecycleModel.newEditorModel`
 * (direct open) and the Layer 2 file resolver (`content/resolvers.ts`, openRawLink). Both
 * registries stay separate data structures; this only READS both.
 *
 * `matchPath` exists because those two callers hold different strings for a non-local source. The
 * openRawLink path matches on the source's EFFECTIVE path (`extractEffectivePath` — the entry name
 * inside an archive, the last URL segment without its query), while locality — the capability gate —
 * must still be judged on the ORIGINAL url. Passing the effective path as `filePath` would read as
 * "plain local file" and hand every simple board a source it cannot read.
 */
export function resolveEditorIdForFile(
    filePath?: string,
    matchPath?: string,
): string | undefined {
    const match = matchPath || filePath;
    const builtinDef = match ? editorRegistry.resolve(match) : undefined;
    const builtinId = builtinDef?.id;
    if (!filePath || !match) return builtinId;
    // A simple board reads the file itself, so by default it is offered real local files only
    // (EPIC-042 CE4); a content-host board also handles https/archive/encrypted (EPIC-043 CH4).
    // So the local-path gate filters the board scan by capability rather than short-circuiting it.
    const local = isPlainLocalPath(filePath);
    const builtinPriority = builtinDef?.match?.acceptFile?.(match) ?? 0;
    let best: CustomEditorMatch | undefined;
    for (const b of customEditorRegistry.getBoardsForFile(match)) {
        // Non-local source (archive entry / URL): a content-host board reads through the host, and
        // a board declaring `editorSources: "any"` still gets a readable local path out of
        // `getFilePath()` because Persephone materializes the pipe into a cache file for it. Any
        // OTHER simple board would fail inside `readFile`, so it stays unoffered and the built-in
        // editor keeps the file — a clean fallback beats a board that opens and errors.
        if (
            !local
            && b.editorKind !== "content-host"
            && b.editorKind !== "stream-host"
            && b.editorSources !== "any"
        ) continue;
        // Strict `>` so the FIRST (earliest-trusted) board wins ties among boards.
        if (!best || b.priority > best.priority) best = b;
    }
    if (best && best.priority > builtinPriority) return best.editorId;
    return builtinId;
}

/** Resolve the winning editor id for a folder, merging built-ins with trusted direct-folder
 * board claims. Built-ins win exact priority ties; trusted-list order wins board ties. */
export function resolveEditorIdForFolder(folderPath: string): string {
    const builtinId = editorRegistry.resolveForFolder(folderPath);
    const builtinPriority =
        editorRegistry.getById(builtinId)?.match?.acceptFolder?.(folderPath) ?? 0;
    let best: CustomEditorMatch | undefined;
    for (const board of customEditorRegistry.getBoardsForFolder(folderPath)) {
        if (!best || board.folderEditorPriority > best.folderEditorPriority) best = board;
    }
    if (best && best.folderEditorPriority > builtinPriority) return best.editorId;
    return builtinId;
}

/** Return built-in folder candidates in registry order, followed by every matching trusted board
 * in trusted-list order. Priority affects only the default resolver, never this list. */
export function getFolderEditorsForFolder(folderPath: string): string[] {
    return [
        ...editorRegistry.getFolderEditors(folderPath),
        ...customEditorRegistry.getBoardsForFolder(folderPath).map((board) => board.editorId),
    ];
}

/**
 * True for either board editor id form — the plain `board-view` (a board opened as a
 * page) or a custom-editor `board-editor:<root>` (a board editing a file). Used by the
 * MCP / automation board-detection sites so a custom-editor board stays automatable.
 */
export function isBoardEditorId(id: string | undefined): boolean {
    return id === "board-view" || (!!id && parseBoardEditorId(id) !== null);
}
