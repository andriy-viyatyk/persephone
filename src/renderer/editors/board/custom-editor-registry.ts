/**
 * Custom-editor registry (EPIC-042 / US-837). Enumerates trusted and bundled boards, reads each board's
 * `board-manifest.json`, and maps files → the boards that claim them (via the manifest's
 * `fileMasks` / `editorPriority`, US-836). It answers, synchronously, "which trusted and bundled boards
 * claim this file, and at what priority" — the data source the resolution (US-838) and
 * switch-widget tasks consume.
 *
 * Mirrors `registeredTools` (EPIC-038): a `TModel` singleton over `TGlobalState`, an in-memory
 * subscription to trust and bundled-source changes (NOT a filesystem watcher — CE7), a
 * full-rebuild `refresh()`, and sync getters + reactive hooks. A source change flips associations
 * live (CE3).
 *
 * Nested boards are unsupported by design: each board lives in its own folder, so `refresh()`
 * enumerates trusted roots directly and consumes the separate app-owned bundled registry (a board
 * only via an ancestor folder is intentionally not enumerated).
 */
import { TModel } from "../../core/state/model";
import { TGlobalState } from "../../core/state/state";
import { fpBasename, fpNormalizeForCompare, isPlainLocalPath } from "../../core/utils/file-path";
import { OwnershipRegistry } from "../../../shared/ownership-registry";
import { errMessage } from "../../../shared/utils";
import { editorRegistry } from "../base/editorRegistry";
import { boardTrust } from "../../api/board-trust";
import { boardInstallRegistry } from "../../api/board-install-registry";
import { settings } from "../../api/settings";
import { bundledBoardRegistry } from "./bundled-board-registry";
import { BOARD_BRIDGE_VERSION } from "../../../shared/board-bridge-version";
import { getBoardCompatibility } from "../../../shared/version-utils";
import {
    replaceProviderDeclarations,
    boardProviderTypeRefusal,
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
    matchesBoardMasks,
    matchesContentMasks,
    matchesFolderEditorMasks,
    hostOwnsPipe,
    parseBoardManifest,
    readBoardManifest,
    type BoardContentProviderDeclaration,
    type BoardCapabilityDeclaration,
    type BoardEditorAssociation,
    type NormalizedBoardManifest,
} from "./board-manifest";
import type { BoardSettingDeclaration } from "../../api/board-settings/types";
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

/** Resolve a persisted dynamic board id while preserving the real-root id format. */
export async function resolveBoardEditorId(editorId: string): Promise<string> {
    const boardRoot = parseBoardEditorId(editorId);
    if (boardRoot === null) return editorId;

    const currentRoot = await bundledBoardRegistry.resolvePersistedRoot(boardRoot);
    return currentRoot === undefined ? editorId : boardEditorId(currentRoot);
}

/** A trusted or bundled board association resolved from its manifest. One per source board that declares
 *  usable file, content, or direct-folder claims; it may be file-only, folder-only, or both. */
export interface CustomEditorMatch extends Omit<BoardEditorAssociation, "editorName" | "editorPriority"> {
    /** Source provenance used by built-in presentation and later bundled-board controls. */
    origin: "trusted" | "bundled";
    /** Virtual editor id: `board-editor:<boardRoot>` (original-case root). */
    editorId: string;
    /** Absolute board root, original case — what BoardEditorModel loads. */
    boardRoot: string;
    /** Switch-widget display name: editorName ?? manifest.name ?? basename(root). */
    name: string;
    /** File resolution priority (>= 0) from the manifest (US-836 `editorPriority`). */
    priority: number;

}

/** A board source omitted from the editor registry because its bridge requirement is too new. */
export type CustomEditorRegistrationIssueKind = "provider" | "scheme" | "capability" | "settings" | "browser-url-mask";

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
    boardName: string;
    declaration: BoardCapabilityDeclaration;
}

interface CollectedProviderAxis {
    readonly intents: BoardRegistrationIntent[];
    readonly declarations: ProviderDeclaration[];
}

interface BoardRefreshSource {
    readonly root: string;
    readonly manifest: NormalizedBoardManifest | null;
    readonly origin: "trusted" | "bundled" | "installed";
    readonly boardName: string;
    readonly settingsNamespace?: string;
}

interface BoardUrlMaskIntent {
    readonly boardRoot: string;
    readonly boardName: string;
    readonly mask: string;
}

interface BoardUrlMaskIssue {
    readonly intent: BoardUrlMaskIntent;
    readonly owner: string;
}

export interface BoardSettingsRegistration {
    boardRoot: string;
    name: string;
    /** The board's portable `<author>/<name>` identity. Addressable UI names key on this rather
     *  than on `boardRoot`, which differs between dev and packaged builds and changes on a
     *  reinstall elsewhere (EPIC-109 D5). */
    namespace: string;
    origin: "trusted" | "bundled";
    declarations: BoardSettingDeclaration[];
    editorAssociation: BoardEditorAssociation | null;
}

interface CustomEditorRegistryState {
    /** Every trusted and bundled board association, in trusted-list then bundled order. */
    entries: CustomEditorMatch[];
    /** Active trusted and bundled boards with normalized Settings declarations. */
    settingsBoards: BoardSettingsRegistration[];
    /** Provider and scheme declarations refused during the latest board-source rebuild. */
    registrationIssues: CustomEditorRegistrationIssue[];
}

const defaultState: CustomEditorRegistryState = {
    entries: [],
    settingsBoards: [],
    registrationIssues: [],
};

/** Last path segment of a registered-scheme URL — decoded, without query or fragment. This is the
 *  file name `resolveEditorIdForFile` matches on; the ORIGINAL url stays its `filePath` argument so
 *  the locality gate still judges the real source. Mirrors `extractEffectivePath` in
 *  `content/resolvers.ts`, which does the same for http(s). */
function schemeEffectivePath(url: string): string {
    try {
        return decodeURIComponent(new URL(url).pathname.split("/").pop() || "");
    } catch {
        return "";
    }
}

/** The claiming board's display name, for titling a page opened on a link that carries none. */
function boardDisplayName(boardRoot: string): string | undefined {
    return customEditorRegistry.entries.find((e) => e.boardRoot === boardRoot)?.name;
}

function createBoardSchemeHooks(providerType: string, boardRoot: string): SchemeHooks {
    return {
        async parse(data, context) {
            data.url = data.href;
            data.handled = false;
            await context.delegate();
            data.handled = true;
        },
        async resolve(data, context) {
            data.pipeDescriptor = {
                provider: {
                    type: providerType,
                    config: { url: data.url },
                },
                transformers: [],
            };
            data.pipe = context.createPipe(data.pipeDescriptor);
            if (context.phase === "source-path") return;
            // Target resolution is an OPEN-phase concern: `source-path` rebuilds a pipe for a page
            // that already exists and discards `data.target` (EPIC-113 D15).
            const effectivePath = schemeEffectivePath(data.url);
            // Evaluate the empty-name branch BEFORE resolveEditorIdForFile: it substitutes the
            // whole URL via `matchPath || filePath` when effectivePath is empty, then Monaco's
            // unconditional `acceptFile: () => 0` returns "monaco". Every arm after that call is
            // unreachable for a non-empty url, so do not fold this branch into the `||` chain.
            data.target = data.target
                || (effectivePath ? resolveEditorIdForFile(data.url, effectivePath) : boardEditorId(boardRoot))
                || "monaco";
            // Without this the tab is titled with the raw percent-encoded href — for a torrent
            // link, the whole magnet inside the query string. A named link is titled by its file;
            // a nameless one (a magnet) by the claiming board, since there is nothing else to say.
            data.title = data.title
                || (effectivePath ? fpBasename(effectivePath) : boardDisplayName(boardRoot));
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
): CustomEditorRegistrationIssue {
    const issue: CustomEditorRegistrationIssue = {
        boardRoot,
        kind,
        name,
        reason: reason ?? `The ${kind} registration was refused.`,
        ...(owner !== undefined ? { owner } : {}),
    };
    issues.push(issue);
    return issue;
}

function collectProviderAxis(sources: readonly BoardRefreshSource[]): CollectedProviderAxis {
    const intents: BoardRegistrationIntent[] = [];
    const declarations: ProviderDeclaration[] = [];
    for (const source of sources) {
        if (source.origin === "installed") continue;
        const boardName = source.boardName;
        for (const declaration of source.manifest?.contentProviders ?? []) {
            const intent = { boardRoot: source.root, declaration };
            intents.push(intent);
            if (boardProviderTypeRefusal(declaration.type)) continue;
            declarations.push({
                type: declaration.type,
                boardRoot: source.root,
                boardName,
                trusted: true,
            });
        }
    }
    for (const source of sources) {
        if (source.origin !== "installed") continue;
        const boardName = source.boardName;
        for (const declaration of source.manifest?.contentProviders ?? []) {
            if (boardProviderTypeRefusal(declaration.type)) continue;
            declarations.push({ type: declaration.type, boardRoot: source.root, boardName, trusted: false });
        }
    }
    return { intents, declarations };
}

function commitProviderAxis(
    axis: CollectedProviderAxis,
    issues: CustomEditorRegistrationIssue[],
    dependentSchemeIssues: Set<CustomEditorRegistrationIssue>,
): void {
    for (const intent of axis.intents) {
        const result = registerProvider(
            intent.declaration.type,
            (config) => createBoardProvider(intent.boardRoot, intent.declaration.type, config),
            { origin: "board", owner: intent.boardRoot },
        );
        if (!result.accepted) {
            addRegistrationIssue(
                issues,
                intent.boardRoot,
                "provider",
                intent.declaration.type,
                result.reason,
                result.owner,
            );
            for (const scheme of intent.declaration.schemes ?? []) {
                const issue = addRegistrationIssue(
                    issues,
                    intent.boardRoot,
                    "scheme",
                    scheme,
                    `Not registered because provider type "${intent.declaration.type}" was refused.`,
                    result.owner,
                );
                dependentSchemeIssues.add(issue);
            }
            continue;
        }

        for (const scheme of intent.declaration.schemes ?? []) {
            const schemeResult = registerScheme(
                scheme,
                createBoardSchemeHooks(intent.declaration.type, intent.boardRoot),
                { origin: "board", owner: intent.boardRoot },
            );
            if (!schemeResult.accepted) {
                addRegistrationIssue(
                    issues,
                    intent.boardRoot,
                    "scheme",
                    scheme,
                    schemeResult.reason,
                    schemeResult.owner,
                );
            }
        }
    }
}

function collectCapabilityAxis(
    sources: readonly BoardRefreshSource[],
    issues: CustomEditorRegistrationIssue[],
): BoardCapabilityRegistrationIntent[] {
    const intents: BoardCapabilityRegistrationIntent[] = [];
    for (const source of sources) {
        if (source.origin === "installed") continue;
        const boardName = source.boardName;
        for (const issue of source.manifest?.issues ?? []) {
            if (issue.kind === "capability") addRegistrationIssue(issues, source.root, issue.kind, issue.name, issue.reason, undefined);
        }
        for (const declaration of source.manifest?.capabilities ?? []) intents.push({ boardRoot: source.root, boardName, declaration });
    }
    return intents;
}

function commitCapabilityAxis(
    intents: readonly BoardCapabilityRegistrationIntent[],
    issues: CustomEditorRegistrationIssue[],
): void {
    for (const { boardRoot, boardName, declaration } of intents) {
        const result = registerCapability(declaration, {
            boardRoot,
            boardName,
            handlerKey: boardEditorId(boardRoot),
            origin: "board",
        });
        if (!result.accepted) {
            addRegistrationIssue(
                issues,
                boardRoot,
                "capability",
                declaration.id || "<empty id>",
                result.reason,
                undefined,
            );
        }
    }
}

function commitUrlMaskAxis(
    maskIssues: readonly BoardUrlMaskIssue[],
    issues: CustomEditorRegistrationIssue[],
): void {
    for (const { intent, owner } of maskIssues) {
        addRegistrationIssue(
            issues,
            intent.boardRoot,
            "browser-url-mask",
            intent.mask,
            `Browser URL mask "${intent.mask}" is already owned by board "${owner}".`,
            owner,
        );
    }
}

function collectUrlMaskAxis(sources: readonly BoardRefreshSource[]): BoardUrlMaskIssue[] {
    const ownership = new OwnershipRegistry<BoardUrlMaskIntent>();
    const issues: BoardUrlMaskIssue[] = [];
    for (const source of sources) {
        if (source.origin === "installed") continue;
        const boardName = source.boardName;
        for (const mask of source.manifest?.browserUrlMasks ?? []) {
            const intent = { boardRoot: source.root, boardName, mask };
            const result = ownership.claim(mask, intent, { origin: "board", owner: source.root });
            if ("existing" in result) {
                issues.push({ intent, owner: result.existing.owner ?? result.existing.value.boardRoot });
            }
        }
    }
    return issues;
}

function registrationIssueKey(issue: CustomEditorRegistrationIssue): string {
    return JSON.stringify([
        fpNormalizeForCompare(issue.boardRoot),
        issue.kind,
        issue.name,
        issue.reason,
    ]);
}

function reportNewRegistrationIssues(
    previous: readonly CustomEditorRegistrationIssue[],
    current: readonly CustomEditorRegistrationIssue[],
    dependentSchemeIssues: ReadonlySet<CustomEditorRegistrationIssue>,
): void {
    const previousKeys = new Set(previous.map(registrationIssueKey));
    const reportedKeys = new Set<string>();
    for (const issue of current) {
        const key = registrationIssueKey(issue);
        if (previousKeys.has(key) || reportedKeys.has(key)) continue;
        reportedKeys.add(key);
        if (dependentSchemeIssues.has(issue)) continue;
        const message = `Rejected ${issue.kind} registration: "${issue.name}". ${issue.reason}`;
        void import("../../api/ui")
            .then(({ ui }) => ui.notify(message, "error"))
            .catch((error: unknown) => {
                console.error(`Failed to report board registration issue: ${errMessage(error)}`);
            });
    }
}

class CustomEditorRegistry extends TModel<CustomEditorRegistryState> {
    private initialized = false;
    private initialization: Promise<void> | undefined;
    private pathsSub: (() => void) | undefined;
    private bundledSub: (() => void) | undefined;
    private settingsSub: (() => void) | undefined;
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
        this.bundledSub = bundledBoardRegistry.subscribe(() => {
            void this.refresh();
        });
        this.settingsSub = settings.onChanged.subscribe(({ key }) => {
            if (key === "disabled-bundled-boards") void this.refresh();
        });
    }

    /** Idempotent: load board sources then enumerate. Call before reading state. */
    async ensureInitialized(): Promise<void> {
        if (this.initialized) return;
        if (!this.initialization) {
            this.initialization = (async () => {
                await boardTrust.load();
                await boardInstallRegistry.load();
                await bundledBoardRegistry.ensureInitialized();
                await this.refresh();
                this.initialized = true;
            })().finally(() => {
                this.initialization = undefined;
            });
        }
        await this.initialization;
    }

    /** Re-read trusted manifests and rebuild the reactive state, then add cached bundled manifests.
     *  Full rebuild (cheap at registry scale; a manifest edit can change masks/priority).
     *  Enumerates trusted roots directly — nested boards are unsupported by design, so no subtree walk. */
    async refresh(): Promise<void> {
        const gen = ++this.refreshGen;
        await bundledBoardRegistry.ensureInitialized();
        const roots = boardTrust.listPaths();
        const disabledBundledBoards = new Set(settings.get("disabled-bundled-boards"));
        const installedBoards = boardInstallRegistry.listInstalled()
            .filter((installed) => !boardTrust.isTrusted(installed.root));
        const makeSource = (root: string, raw: unknown, origin: BoardRefreshSource["origin"]): BoardRefreshSource => {
            const manifest = parseBoardManifest(raw);
            const boardName = manifest?.name?.trim() || fpBasename(root);
            const settingsNamespace = manifest
                && typeof manifest.author === "string" && manifest.author.trim()
                && typeof manifest.name === "string" && manifest.name.trim()
                ? `${manifest.author.trim()}/${manifest.name.trim()}`
                : undefined;
            return { root, manifest, origin, boardName, settingsNamespace };
        };
        const [trustedSources, installedSources] = await Promise.all([
            Promise.all(roots.map(async (root) => makeSource(root, await readBoardManifest(root), "trusted"))),
            Promise.all(installedBoards.map(async (installed) => makeSource(installed.root, await readBoardManifest(installed.root), "installed"))),
        ]);
        const sources: BoardRefreshSource[] = [
            ...trustedSources,
            ...bundledBoardRegistry.list()
                .filter((bundled) => !disabledBundledBoards.has(bundled.id))
                .map((bundled) => makeSource(bundled.root, bundled.manifest, "bundled")),
            ...installedSources,
        ];
        const compatibleSources = sources.filter((source) => getBoardCompatibility(
            { minBridgeVersion: source.manifest?.minBridgeVersion },
            { bridgeVersion: BOARD_BRIDGE_VERSION },
        ).compatible);
        const boardSources = compatibleSources.filter(
            (source): source is BoardRefreshSource & { origin: "trusted" | "bundled" } =>
                source.origin !== "installed",
        );
        const entries: CustomEditorMatch[] = [];
        const settingsBoards: BoardSettingsRegistration[] = [];
        const registrationIssues: CustomEditorRegistrationIssue[] = [];

        for (const source of boardSources) {
            const { root, manifest, origin } = source;
            const boardName = source.boardName;
            for (const issue of manifest?.issues ?? []) {
                if (issue.kind === "settings") addRegistrationIssue(registrationIssues, root, issue.kind, issue.name, issue.reason, undefined);
            }
            const settingsDeclarations = manifest?.settings ?? [];
            const assoc = manifest?.association ?? null;
            if (settingsDeclarations.length > 0) {
                settingsBoards.push({
                    boardRoot: root,
                    name: boardName,
                    namespace: source.settingsNamespace ?? "",
                    origin,
                    declarations: settingsDeclarations,
                    editorAssociation: assoc,
                });
            }
            if (!assoc) continue; // Neither fileMasks nor contentMasks means this is not a custom editor.
            entries.push({
                origin,
                editorId: boardEditorId(root),
                boardRoot: root,
                name: assoc.editorName || boardName,
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

        const providerAxis = collectProviderAxis(compatibleSources);
        const capabilityAxis = collectCapabilityAxis(compatibleSources, registrationIssues);
        const urlMaskIssues = collectUrlMaskAxis(boardSources);
        if (gen !== this.refreshGen) return;

        const previousIssues = this.state.get().registrationIssues;
        const dependentSchemeIssues = new Set<CustomEditorRegistrationIssue>();
        unregisterBoardProviders();
        unregisterBoardSchemes();
        unregisterBoardCapabilities();
        replaceProviderDeclarations(providerAxis.declarations);
        commitUrlMaskAxis(urlMaskIssues, registrationIssues);
        commitCapabilityAxis(capabilityAxis, registrationIssues);
        commitProviderAxis(providerAxis, registrationIssues, dependentSchemeIssues);

        this.state.update((state) => {
            state.entries = entries;
            state.settingsBoards = settingsBoards;
            state.registrationIssues = registrationIssues;
        });
        reportNewRegistrationIssues(previousIssues, registrationIssues, dependentSchemeIssues);
    }

    /** All file-associated boards (sync, non-reactive). */
    get entries(): CustomEditorMatch[] {
        return this.state.get().entries;
    }

    /** Active trusted and bundled boards with normalized user-facing settings. */
    get settingsBoards(): readonly BoardSettingsRegistration[] {
        return this.state.get().settingsBoards;
    }

    /** Registration refusals for one board, retained for the Board Info properties view. */
    getRegistrationIssues(boardRoot: string): readonly CustomEditorRegistrationIssue[] {
        return this.state.get().registrationIssues.filter((issue) => issue.boardRoot === boardRoot);
    }

    /**
     * Boards claiming `fileName`, in trusted-list then bundled order (SYNC — safe for resolveId). Matching is
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

    /** Boards whose distinct direct folder claims match `folderPath`, in source order. */
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
        this.bundledSub?.();
        this.bundledSub = undefined;
        this.settingsSub?.();
        this.settingsSub = undefined;
        // Drain the model's DisposableStore after existing teardown.
        super.dispose();
    }
}

export const customEditorRegistry = new CustomEditorRegistry();

/**
 * Resolve the winning editor id for opening a file, merging the built-in registry with
 * trusted or bundled file-associated boards (EPIC-042 / EPIC-109). A board wins when it can handle the SOURCE (see the
 * capability gate below) and its `editorPriority` is STRICTLY greater than the best built-in
 * claimant (built-ins win exact ties; among boards, source order — `getBoardsForFile`
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
            && !hostOwnsPipe(b.editorKind)
            && b.editorSources !== "any"
        ) continue;
        // Strict `>` so the FIRST (earliest-trusted) board wins ties among boards.
        if (!best || b.priority > best.priority) best = b;
    }
    if (best && best.priority > builtinPriority) return best.editorId;
    return builtinId;
}

/** Resolve the winning editor id for a folder, merging built-ins with trusted direct-folder
 * board claims. Built-ins win exact priority ties; source order wins board ties. */
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

/** Return built-in folder candidates in registry order, followed by every matching board source.
 * Priority affects only the default resolver, never this list. */
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
