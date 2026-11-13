import { EditorId } from "../../../shared/editor-ids";
import { boardEditorId, parseBoardEditorId } from "../../../shared/board/board-editor-id";
/**
 * Custom-editor registry. Enumerates trusted and bundled boards, reads each board's
 * `board-manifest.json`, and maps files → the boards that claim them (via the manifest's
 * `fileMasks` / `editorPriority`). It answers, synchronously, "which trusted and bundled boards
 * claim this file, and at what priority" — the data source the resolution and
 * switch-widget tasks consume.
 *
 * Mirrors `registeredTools`: a `TModel` singleton over `TGlobalState`, an in-memory
 * subscription to registry membership changes (NOT a filesystem watcher — CE7), a
 * full-rebuild `refresh()`, and sync getters + reactive hooks. A source change flips associations
 * live (CE3).
 *
 * Nested boards are unsupported by design: each board lives in its own folder, so `refresh()`
 * enumerates trusted roots directly and consumes enabled bundled entries from BoardRegistry (a board
 * only via an ancestor folder is intentionally not enumerated).
 */
import { TModel } from "../../core/state/model";
import { TGlobalState } from "../../core/state/state";
import { fpBasename } from "../../core/utils/file-path";
import { BoardRoot } from "../../../shared/board/board-root";
import { OwnershipRegistry } from "../../../shared/ownership-registry";
import { errMessage } from "../../../shared/utils";
import { editorCatalog } from "../../editors/base/editor-catalog";
import { boardRegistry } from "./board-registry";
import { boardInstallRegistry } from "./board-install-registry";
import { invalidateBoardDisplayText } from "./board-display-text";
import { urlPathFileName } from "../../content/link-utils";
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
import { matchesBoardMasks } from "./board-file-masks";
import { matchesFileMask, matchesContentMasks, matchesFolderEditorMasks } from "../../../shared/board/board-masks";
import { boardManifestCompatibility } from "../../../shared/board/board-manifest-queries";
import { type BoardContentProviderDeclaration, type BoardCapabilityDeclaration, type BoardEditorAssociation, type NormalizedBoardManifest } from "../../../shared/board/board-manifest-schema";
import { readBoardManifest } from "./board-manifest-io";
import { stableBoardIdentity } from "../../../shared/board/board-stable-identity";
import type { BoardSettingDeclaration } from "../../../shared/board/board-settings-declarations";
import { validateLegacyCapabilityDeclaration } from "../../../shared/capability-contract";

/** Resolve a persisted dynamic board id while preserving the real-root id format. */
export async function resolveBoardEditorId(editorId: string): Promise<string> {
    const boardRoot = parseBoardEditorId(editorId);
    if (boardRoot === null) return editorId;

    const currentRoot = await boardRegistry.resolvePersistedRoot(boardRoot);
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
    /** Reserved metadata key used only by renderer presentation; `name` remains English. */
    displayNameKey: "manifest.name" | "manifest.editorName";
    /** File resolution priority (>= 0) from the manifest's `editorPriority` field. */
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
     *  reinstall elsewhere. */
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

/** The claiming board's display name, for titling a page opened on a link that carries none. */
function boardDisplayName(boardRoot: string): string | undefined {
    return customEditorRegistry.findByRoot(boardRoot)?.name;
}

function createBoardSchemeHooks(providerType: string, boardRoot: string): SchemeHooks {
    return {
        async parse(data, context) {
            data.url = data.href;
            await context.handoff();
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
            // Source-path reconstruction discards target and title after rebuilding the pipe.
            const effectivePath = urlPathFileName(data.url);
            // Evaluate the empty-name branch before catalog resolution: it substitutes the
            // whole URL via `matchPath || filePath` when effectivePath is empty, then Monaco's
            // unconditional file fallback tier returns "monaco". Every arm after that call is
            // unreachable for a non-empty url, so do not fold this branch into the `||` chain.
            data.target = data.target
                || (effectivePath ? editorCatalog.resolveFile(data.url, effectivePath) : boardEditorId(boardRoot))
                || EditorId.monaco;
            // Without this the tab is titled with the raw percent-encoded href — for a torrent
            // link, the whole magnet inside the query string. A named link is titled by its file;
            // a nameless one (a magnet) by the claiming board, since there is nothing else to say.
            data.title = data.title
                || (effectivePath ? fpBasename(effectivePath) : boardDisplayName(boardRoot));
            await context.handoff();
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
        for (const declaration of source.manifest?.capabilities ?? []) {
            if (!declaration.methods || Object.values(declaration.methods).some((method) => method.kind === "open")) intents.push({ boardRoot: source.root, boardName, declaration });
        }
    }
    return intents;
}

function commitCapabilityIssues(
    intents: readonly BoardCapabilityRegistrationIntent[],
    issues: CustomEditorRegistrationIssue[],
): void {
    for (const { boardRoot, declaration } of intents) {
        const reason = validateLegacyCapabilityDeclaration(declaration);
        if (reason) addRegistrationIssue(issues, boardRoot, "capability", declaration.id || "<empty id>", reason, undefined);
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
        BoardRoot.from(issue.boardRoot).key,
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
        void import("../ui")
            .then(({ ui }) => ui.notify(message, "error"))
            .catch((error: unknown) => {
                console.error(`Failed to report board registration issue: ${errMessage(error)}`);
            });
    }
}

class CustomEditorRegistry extends TModel<CustomEditorRegistryState> {
    private entriesByRootKey = new Map<string, CustomEditorMatch>();
    private initialized = false;
    private initialization: Promise<void> | undefined;
    private membershipSub: (() => void) | undefined;
    /** Generation counter guarding refresh() against stale overwrites: overlapping refreshes
     *  (a rapid untrust+trust pair, e.g. renaming a board folder, fires one per mutation) can
     *  finish out of order, and an earlier refresh landing last would clobber the newer entry
     *  list — leaving a just-trusted board unregistered. Only the newest generation may write. */
    private refreshGen = 0;

    constructor() {
        super(new TGlobalState(defaultState));
        // In-memory reactive subscription (NOT a filesystem watcher): re-enumerate on any
        // trust/untrust — this is what makes an untrust drop the association live (CE3/CE7).
        this.membershipSub = boardRegistry.subscribeMembership(() => { void this.refresh(); });
    }

    /** Idempotent: load board sources then enumerate. Call before reading state. */
    async ensureInitialized(): Promise<void> {
        if (this.initialized) return;
        if (!this.initialization) {
            this.initialization = (async () => {
                await boardRegistry.load();
                await boardInstallRegistry.load();
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
        invalidateBoardDisplayText();
        const gen = ++this.refreshGen;
        await boardRegistry.load();
        const bundledManifests = new Map(boardRegistry.bundled().map((board) => [BoardRoot.from(board.root).key, board.manifest]));
        const installedBoards = boardInstallRegistry.listInstalled()
            .filter((installed) => !boardRegistry.isTrusted(installed.root));
        const makeSource = (root: string, manifest: NormalizedBoardManifest | null, origin: BoardRefreshSource["origin"]): BoardRefreshSource => {
            const boardName = manifest?.name?.trim() || fpBasename(root);
            const settingsNamespace = stableBoardIdentity(manifest);
            return { root, manifest, origin, boardName, settingsNamespace };
        };
        const [permittedSources, installedSources] = await Promise.all([
            Promise.all(boardRegistry.list().map(async (entry) => makeSource(
                entry.root,
                entry.origin === "bundled" ? bundledManifests.get(entry.key) ?? null : await readBoardManifest(entry.root),
                entry.origin,
            ))),
            Promise.all(installedBoards.map(async (installed) => makeSource(installed.root, await readBoardManifest(installed.root), "installed"))),
        ]);
        const sources: BoardRefreshSource[] = [...permittedSources, ...installedSources];
        const compatibleSources = sources.filter((source) => boardManifestCompatibility(source.manifest).compatible);
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
                displayNameKey: assoc.editorName ? "manifest.editorName" : "manifest.name",
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

        this.entriesByRootKey = new Map(entries.flatMap((entry) => {
            const root = BoardRoot.tryFrom(entry.boardRoot);
            return root ? [[root.key, entry] as const] : [];
        }));

        const previousIssues = this.state.get().registrationIssues;
        const dependentSchemeIssues = new Set<CustomEditorRegistrationIssue>();
        unregisterBoardProviders();
        unregisterBoardSchemes();
        replaceProviderDeclarations(providerAxis.declarations);
        commitUrlMaskAxis(urlMaskIssues, registrationIssues);
        commitCapabilityIssues(capabilityAxis, registrationIssues);
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

    /** Find the custom-editor association for a board root, ignoring path casing. */
    findByRoot(root: string | null | undefined): CustomEditorMatch | undefined {
        const key = root ? BoardRoot.tryFrom(root)?.key : undefined;
        return key ? this.entriesByRootKey.get(key) : undefined;
    }

    /** Return the registry's original-case spelling of a root when it has an association. */
    canonicalRoot(root: string): string {
        return this.findByRoot(root)?.boardRoot ?? root;
    }

    /** Find a board association only when it also claims the given folder. */
    findFolderClaim(root: string, folderPath: string): CustomEditorMatch | undefined {
        const match = this.findByRoot(root);
        if (!match) return undefined;
        const matchKey = BoardRoot.tryFrom(match.boardRoot)?.key;
        if (!matchKey) return undefined;
        return this.getBoardsForFolder(folderPath).find((entry) =>
            BoardRoot.tryFrom(entry.boardRoot)?.key === matchKey
        );
    }

    /** Resolve a persisted board editor id to its current custom-editor association. */
    findByEditorId(editorId: string): CustomEditorMatch | undefined {
        const root = parseBoardEditorId(editorId);
        return root === null ? undefined : this.findByRoot(root);
    }

    /** Active trusted and bundled boards with normalized user-facing settings. */
    get settingsBoards(): readonly BoardSettingsRegistration[] {
        return this.state.get().settingsBoards;
    }

    /** Registration refusals for one board, retained for the Board Info properties view. */
    getRegistrationIssues(boardRoot: string): readonly CustomEditorRegistrationIssue[] {
        const normalizedRoot = BoardRoot.from(boardRoot);
        return this.state.get().registrationIssues.filter((issue) =>
            normalizedRoot.equals(issue.boardRoot)
        );
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

    /** File-mask claims for an explicit file-open choice, independent of folder scope. */
    getBoardsForFileName(filePathOrName: string): CustomEditorMatch[] {
        if (!filePathOrName) return [];
        const fileName = fpBasename(filePathOrName);
        return this.state.get().entries.filter((entry) =>
            entry.fileMasks.some((mask) => matchesFileMask(fileName, mask))
        );
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
     * The board counterpart of a built-in matcher's `content` rule, and scoped identically: this
     * feeds the editor-SWITCH widget only, so a board can claim an untitled, in-memory page (an
     * agent-generated graph, a script's output, pasted JSON) that no file mask can ever match.
     * Nothing here participates in merged file resolution, so content can never take a file away
     * from the editor that would otherwise open it.
     */
    getBoardsForContent(content: string): CustomEditorMatch[] {
        if (!content) return [];
        return this.state
            .get()
            .entries.filter((e) => matchesContentMasks(content, e.contentMasks));
    }

    dispose(): void {
        this.membershipSub?.();
        this.membershipSub = undefined;
        // Drain the model's DisposableStore after existing teardown.
        super.dispose();
    }
}

export const customEditorRegistry = new CustomEditorRegistry();
