import { app } from "./app";
import { fs } from "./fs";
import type {
    IBoards,
    BoardListing,
    PublishedBoardResult,
    PublishedVersionResult,
    BoardUpdateInfo,
} from "./types/boards";
import type { EditorModel } from "../editors/base/EditorModel";
import { fpBasename, fpDirname, fpIsAbsolute, fpJoin, fpResolve } from "../core/utils/file-path";
import { isBoardFolder, readBoardManifest } from "./boards/board-manifest-io";
import { LEGACY_BOARD_AGENT_DEPRECATION_NOTE } from "./boards/board-permission-copy";
import { boardTrust } from "./boards/board-trust";
import { BoardGrant } from "../../shared/board/board-grant";
import { boardInstallRegistry, InstalledBoardEntry } from "./boards/board-install-registry";
import { publishedBoards } from "./boards/published-boards";
import { boardPagesForRoot } from "./boards/board-idle";
import { getBoardUpdate, listBoardUpdates, runBoardVersionInstall } from "./boards/board-updates";
import { createBoardFromTemplate } from "./boards/board-scaffold";
import { bundledBoardRegistry } from "./boards/bundled-board-registry";
import { requestBoardTrust } from "./boards/request-board-trust";
import { isBoardRootBusy } from "./boards/busy-boards";
import { downloadBoard, uninstallCatalogBoard } from "./boards/board-install";
import { encodePersephoneBoardLink } from "../content/persephone-board-link";
import { TComponentState } from "../core/state/state";
import { ui } from "./ui";
import { api } from "../../ipc/renderer/api";
import { errMessage } from "../../shared/utils";
import { type BoardServiceStatus } from "../../ipc/module-service-channels";
import { moduleServiceStatus } from "./module-service-status";
import { createLinkData } from "../../shared/link-data";
import { t } from "../../shared/i18n/t";
import { BoardRoot } from "../../shared/board/board-root";
import { asBoardHostEditor } from "./boards/board-host-editor";

export const BOARDS_ASSETS_BASE_URL =
    "https://raw.githubusercontent.com/andriy-viyatyk/persephone/main/boards-assets/";
export const BOARDS_MANIFEST_URL = BOARDS_ASSETS_BASE_URL + "manifest.json";

const BOARD_CALL_TIMEOUT_MIN_MS = 1_000;
const BOARD_CALL_TIMEOUT_MAX_MS = 3_600_000;
/** Unset until an agent assigns `boards.callTimeoutMs`. Staying `undefined` is what keeps the
 *  built-in fallback reachable as timeout level 4; a pre-seeded 30_000 would make level 3 apply
 *  to every call and level 4 unreachable. The getter still reports the effective value. */
let boardCallTimeoutMs: number | undefined;
const BOARD_CALL_TIMEOUT_DEFAULT_MS = 30_000;

/** The knob's value only when an agent actually set it — timeout level 3's input. The public
 *  `boards.callTimeoutMs` getter reports the EFFECTIVE timeout and so cannot answer this. */
export function explicitBoardCallTimeoutMs(): number | undefined {
    return boardCallTimeoutMs;
}

/**
 * `app.boards` — board lifecycle for scripts / agents.
 *
 * `createBoard` / `createDemoBoard` wrap the editor-independent
 * `createBoardFromTemplate` (which scaffolds the template, guarantees
 * `board-manifest.json`, and auto-trusts the board during user-initiated creation. `openBoard`
 * opens an existing board by its root path through the generic `app.openRawLink`
 * pipeline (encoding the `persephone-board://` link internally). Board domain
 * services are imported from `api/boards/`; editor construction and view-adjacent
 * modules remain dynamically imported to preserve code splitting.
 *
 * `registerBoard` / `unregisterBoard` / `renameBoard` are the
 * lifecycle triples for agents: register requests trust via the user's dialog (never
 * self-trusts), unregister untrusts + unpins, rename moves a trusted board to a new
 * folder carrying its trust/pin/install registration along with no dialog.
 *
 * `searchPublished` / `getPublishedVersions` / `downloadPublished` / `installPublished` /
 * `uninstallBoard` / `checkPublishedUpdates` drive the published-boards
 * catalog. The same request-vs-grant model holds: download trusts nothing (inert code on disk for
 * review), install shows the user the trust dialog, uninstall shows the delete confirmation.
 */
async function create(name: string, dir: string, template: string): Promise<string> {
    // Ensure the container exists (recursive; no-op if present) so creating into a
    // not-yet-existing path works without a separate mkdir call.
    await fs.mkdir(dir);
    return createBoardFromTemplate(name, dir, template);
}

/** Load the catalog + install registry so the sync catalog helpers below have data. */
async function ensureCatalog(): Promise<void> {
    await publishedBoards.load();
    await boardInstallRegistry.load();
}

/** Default install container when the caller passes no `dir`. */
async function defaultInstallDir(): Promise<string> {
    return fpJoin(await api.getCommonFolder("userData"), "data", "boards");
}

async function resolveTrustedBoardRoot(boardRoot: string): Promise<string> {
    if (!fpIsAbsolute(boardRoot)) throw new Error("boardRoot must be absolute.");
    const root = fpResolve(boardRoot);
    if (!(await isBoardFolder(root))) {
        throw new Error(`Not a board folder: "${root}" is missing or has no board-manifest.json.`);
    }
    await boardTrust.load();
    await bundledBoardRegistry.ensureInitialized();
    if (!boardTrust.isTrusted(root) && !bundledBoardRegistry.isBundled(root)) {
        throw new Error("Board is not trusted; call boards.registerBoard(root) first.");
    }
    return root;
}

interface BoardListingSource {
    readonly key: string;
    readonly root: string;
    readonly trusted: boolean;
    readonly installed?: InstalledBoardEntry;
    readonly installedFromMemory: boolean;
    readonly openPageIds: string[];
}

interface BoardSourceSnapshot {
    readonly trustPaths: string[];
    readonly installedEntries: InstalledBoardEntry[];
    readonly installedFromMemory: boolean;
}

let cachedTrustPaths: string[] | undefined;
let cachedInstalledEntries: InstalledBoardEntry[] | undefined;

function currentTrustPaths(): string[] {
    const paths = boardTrust.listPaths();
    return paths.length || boardTrust.isLoaded() ? paths : [...(cachedTrustPaths ?? [])];
}

function currentInstalledEntries(): { entries: InstalledBoardEntry[]; fromMemory: boolean } {
    const entries = boardInstallRegistry.listInstalled();
    return entries.length || boardInstallRegistry.isLoaded()
        ? { entries, fromMemory: true }
        : { entries: [...(cachedInstalledEntries ?? [])], fromMemory: false };
}

function currentBoardSources(): BoardSourceSnapshot {
    const installed = currentInstalledEntries();
    return {
        trustPaths: currentTrustPaths(),
        installedEntries: installed.entries,
        installedFromMemory: installed.fromMemory,
    };
}

async function readBoardSources(): Promise<BoardSourceSnapshot> {
    const inMemoryTrustPaths = boardTrust.listPaths();
    const trustPaths = inMemoryTrustPaths.length
        ? inMemoryTrustPaths
        : await boardTrust.readPaths();
    if (!inMemoryTrustPaths.length) cachedTrustPaths = [...trustPaths];

    const inMemoryInstalledEntries = boardInstallRegistry.listInstalled();
    const installedFromMemory = inMemoryInstalledEntries.length > 0;
    const installedEntries = installedFromMemory
        ? inMemoryInstalledEntries
        : await boardInstallRegistry.readInstalled();
    if (!installedFromMemory) cachedInstalledEntries = [...installedEntries];

    return { trustPaths, installedEntries, installedFromMemory };
}

function isTrustedRoot(root: string, trustPaths: readonly string[]): boolean {
    const key = BoardRoot.from(root).key;
    return trustPaths.some((path) => BoardRoot.from(path).key === key);
}

function mergeBoardSources(sources: BoardSourceSnapshot): BoardListingSource[] {
    const records = new Map<string, {
        root: string;
        installed?: InstalledBoardEntry;
        openPageIds: string[];
    }>();

    const addRoot = (root: string): { root: string; installed?: InstalledBoardEntry; openPageIds: string[] } => {
        const key = BoardRoot.from(root).key;
        const existing = records.get(key);
        if (existing) return existing;
        const record = { root, openPageIds: [] as string[] };
        records.set(key, record);
        return record;
    };

    for (const root of sources.trustPaths) addRoot(root);
    for (const entry of sources.installedEntries) {
        addRoot(entry.root).installed ??= entry;
    }
    for (const page of boardPagesForRoot()) {
        const boardRoot = (page.mainEditorInstance as { boardRoot?: string } | undefined)?.boardRoot;
        if (!boardRoot) continue;
        addRoot(boardRoot).openPageIds.push(page.id);
    }

    return [...records.entries()]
        .sort(([first], [second]) => first < second ? -1 : first > second ? 1 : 0)
        .map(([key, record]) => ({
            key,
            root: record.root,
            trusted: isTrustedRoot(record.root, sources.trustPaths),
            installed: record.installed,
            installedFromMemory: sources.installedFromMemory,
            openPageIds: [...record.openPageIds].sort(),
        }));
}

function installedListing(
    source: BoardListingSource,
): BoardListing["installed"] {
    if (!source.installed) return undefined;
    if (!source.installedFromMemory || !publishedBoards.isLoaded()) {
        // Update availability is UNKNOWN until the catalog is in memory. The key is omitted
        // rather than set to `undefined` (which would reach the agent as `null`) so that
        // "cannot tell yet" stays distinguishable from the real answer `updateAvailable: false`.
        return { id: source.installed.id, version: source.installed.version };
    }
    const update = getBoardUpdate(source.installed.root);
    return update
        ? {
            id: source.installed.id,
            version: source.installed.version,
            updateAvailable: true,
            latestVersion: update.latestVersion,
        }
        : { id: source.installed.id, version: source.installed.version, updateAvailable: false };
}

function toBoardListing(
    source: BoardListingSource,
    manifest: { name?: string; description?: string } | undefined,
    serviceStatus: BoardServiceStatus | undefined,
    deprecationNote?: string,
): BoardListing {
    // Absent optionals are OMITTED, never set to `undefined`: a key explicitly holding
    // `undefined` crosses the MCP/IPC boundary as `null`, which is exactly the falsy
    // stand-in forbids an agent from seeing. An omitted key reads as
    // "unavailable"; a present one always carries a real value.
    const installed = installedListing(source);
    return {
        root: source.root,
        ...(manifest?.name !== undefined ? { name: manifest.name } : {}),
        ...(manifest?.description !== undefined ? { description: manifest.description } : {}),
        ...(deprecationNote !== undefined ? { deprecationNote } : {}),
        trusted: source.trusted,
        ...(installed !== undefined ? { installed } : {}),
        openPageIds: [...source.openPageIds],
        ...(serviceStatus
            ? {
                service: {
                    state: serviceStatus.state,
                    ...(serviceStatus.reason !== undefined ? { reason: serviceStatus.reason } : {}),
                    restartCount: serviceStatus.restartCount,
                    ...(serviceStatus.pid !== undefined ? { pid: serviceStatus.pid } : {}),
                    ...(serviceStatus.startedAt !== undefined ? { startedAt: serviceStatus.startedAt } : {}),
                },
            }
            : {}),
    };
}

function currentBoardListings(): BoardListing[] {
    return mergeBoardSources(currentBoardSources()).map((source) =>
        toBoardListing(source, undefined, moduleServiceStatus.getStatus(source.root)));
}

/** Current local board inventory without disk or network access. */
export function getCurrentBoardListings(): BoardListing[] {
    return currentBoardListings();
}

/** Current local board inventory item for a numeric AiVision child index. */
export function getCurrentBoardListingAt(index: number): BoardListing | undefined {
    if (!Number.isInteger(index) || index < 0) return undefined;
    return currentBoardListings()[index];
}

async function enumerateBoardListings(): Promise<BoardListing[]> {
    await moduleServiceStatus.refresh();
    await bundledBoardRegistry.ensureInitialized();
    const sources = await readBoardSources();
    const merged = mergeBoardSources(sources);
    return Promise.all(merged.map(async (source) => {
        const manifest = await readBoardManifest(source.root);
        // After Phase 2 extraction, UI uses t(key) and this agent-facing note uses englishMessage(key) with that same key.
        const deprecationNote = (manifest ? BoardGrant.from(manifest.permissions) : BoardGrant.fromManifest(undefined)).isLegacy()
            && !bundledBoardRegistry.isBundled(source.root)
            ? LEGACY_BOARD_AGENT_DEPRECATION_NOTE
            : undefined;
        return toBoardListing(source, manifest ?? undefined, moduleServiceStatus.getStatus(source.root), deprecationNote);
    }));
}

export const boards: IBoards = {
    get callTimeoutMs(): number {
        return boardCallTimeoutMs ?? BOARD_CALL_TIMEOUT_DEFAULT_MS;
    },
    set callTimeoutMs(value: number) {
        if (!Number.isFinite(value) || !Number.isInteger(value)
            || value < BOARD_CALL_TIMEOUT_MIN_MS || value > BOARD_CALL_TIMEOUT_MAX_MS) {
            throw new TypeError(`boards.callTimeoutMs must be an integer from ${BOARD_CALL_TIMEOUT_MIN_MS} to ${BOARD_CALL_TIMEOUT_MAX_MS}.`);
        }
        boardCallTimeoutMs = value;
        void api.setBoardCallTimeout(value).catch((error: unknown) => {
            console.error(`Failed to apply boards.callTimeoutMs: ${errMessage(error)}`);
        });
    },
    createBoard: (name, dir) => create(name, dir, "board-template"),
    createDemoBoard: (name, dir) => create(name, dir, "demo-board"),
    createShortcut: async (boardRoot, options) => {
        const root = await resolveTrustedBoardRoot(boardRoot);
        let shortcutOptions = options;
        if (options?.linkPath !== undefined) {
            if (!fpIsAbsolute(options.linkPath)) throw new Error("linkPath must be absolute.");
            shortcutOptions = { ...options, linkPath: fpResolve(options.linkPath) };
        }
        const { createBoardShortcutCore } = await import("../editors/board/board-shortcut");
        const result = await createBoardShortcutCore(root, shortcutOptions);
        return result ? { linkPath: result.linkPath } : null;
    },
    openBoardWindow: async (boardRoot) => {
        const root = await resolveTrustedBoardRoot(boardRoot);
        await api.openBoardWindow(root);
    },
    openBoard: async (boardRoot: string) => {
        if (!(await isBoardFolder(boardRoot))) {
            throw new Error(`Not a board: "${boardRoot}" is missing or has no board-manifest.json.`);
        }
        // Encode the persephone-board:// link in one tested place and open it via
        // the generic pipeline. The agent never builds the link by hand.
        await app.events.openRawLink.sendAsync(createLinkData(encodePersephoneBoardLink(boardRoot), {
            sourceId: "app-api",
        }));
    },

    // ── Board lifecycle — trust / untrust / rename  ──────────
    // Security invariant: the API requests, the user's trust dialog grants. `boardTrust`
    // is never touched here without either a user dialog (registerBoard) or a same-content
    // path move (renameBoard — no privilege gain) / a privilege reduction (unregisterBoard).

    registerBoard: async (boardRoot: string): Promise<boolean> => {
        const normalizedRoot = fpIsAbsolute(boardRoot) ? fpResolve(boardRoot) : boardRoot;
        if (!(await isBoardFolder(normalizedRoot))) {
            throw new Error(`Not a board: "${normalizedRoot}" is missing or has no board-manifest.json.`);
        }
        return requestBoardTrust(normalizedRoot);
    },

    unregisterBoard: async (boardRoot: string): Promise<void> => {
        await bundledBoardRegistry.ensureInitialized();
        if (bundledBoardRegistry.isBundled(boardRoot)) return;
        await boardTrust.untrust(boardRoot);
        const { removePin } = await import("../ui/sidebar/pinned-items");
        removePin({ kind: "board", root: boardRoot });
    },

    renameBoard: async (boardRoot: string, newName: string): Promise<string> => {
        if (!(await isBoardFolder(boardRoot))) {
            throw new Error(`Not a board: "${boardRoot}" is missing or has no board-manifest.json.`);
        }
        await bundledBoardRegistry.ensureInitialized();
        if (bundledBoardRegistry.isBundled(boardRoot)) return boardRoot;
        if (isBoardRootBusy(boardRoot)) {
            throw new Error("Cannot rename a board while it is running (busy). Stop it first.");
        }
        const newRoot = fpJoin(fpDirname(boardRoot), newName);
        if (BoardRoot.from(newRoot).equals(boardRoot)) return boardRoot; // no-op
        if (await fs.exists(newRoot)) {
            throw new Error(`Cannot rename: "${newRoot}" already exists.`);
        }

        // Capture trust / pin / install state BEFORE the rename — the install registry's
        // load() prunes entries whose root no longer holds a manifest, which the rename
        // would trigger for the old root.
        await boardTrust.load();
        const wasTrusted = boardTrust.isTrusted(boardRoot);
        const { getCategoryForRef, removeCategoryMembership, moveEditorToCategory } = await import("../ui/sidebar/pinned-items");
        const previousCategory = getCategoryForRef({ kind: "board", root: boardRoot });
        await boardInstallRegistry.load();
        const installEntry = boardInstallRegistry.getByRoot(boardRoot);

        // Rename the folder on disk.
        await fs.rename(boardRoot, newRoot);

        // Transfer trust with no dialog (same content, new path — no privilege gain).
        // untrust(old) is a no-op for inherited trust; trust(new) is a no-op if still
        // covered by an ancestor — correct in every case.
        if (wasTrusted) {
            await boardTrust.untrust(boardRoot);
            await boardTrust.trust(newRoot);
        }
        // Pins.
        if (previousCategory) {
            removeCategoryMembership({ kind: "board", root: boardRoot });
            moveEditorToCategory({ kind: "board", root: newRoot }, previousCategory.id);
        }
        // Install-registry root (catalog-installed boards). record() replaces by id.
        if (installEntry) {
            await boardInstallRegistry.record({ ...installEntry, root: newRoot });
        }

        // Re-point any open page running the old root to the new root (same tab).
        const oldRoot = BoardRoot.from(boardRoot);
        for (const page of app.pages.pages) {
            const editor = page.mainEditorInstance;
            const host = asBoardHostEditor(editor);
            if (host?.boardRoot && oldRoot.equals(host.boardRoot)) {
                await app.events.openRawLink.sendAsync(
                    createLinkData(encodePersephoneBoardLink(newRoot), {
                        pageId: page.id,
                        sourceId: "app-api",
                        explorerRoot: fpDirname(newRoot),
                    }),
                );
            }
        }

        return newRoot;
    },

    /** Return the merged local trust, install, and open-page inventory. */
    list: (): Promise<BoardListing[]> => enumerateBoardListings(),

    /** Request a reply through main's parent channel, starting the declared service if needed. */
    requestService: (boardRoot: string, message: unknown): Promise<unknown> =>
        api.requestModuleService(boardRoot, message),

    /** Explicitly start a declared service and reset its restart budget. */
    startService: (boardRoot: string): Promise<void> => api.startModuleService(boardRoot),

    /** Explicitly stop a running service. */
    stopService: (boardRoot: string): Promise<void> => api.stopModuleService(boardRoot),

    // ── Published catalog — discover / install / update  ──────

    searchPublished: async (query?: string): Promise<PublishedBoardResult[]> => {
        await ensureCatalog();
        const q = query?.trim().toLowerCase();
        const catalog = publishedBoards.getCatalog();
        return catalog
            .filter((b) => {
                if (!q) return true;
                const hay = [b.name, b.description ?? "", ...(b.fileMasks ?? [])]
                    .join(" ")
                    .toLowerCase();
                return hay.includes(q);
            })
            .map((b): PublishedBoardResult => {
                const inst = boardInstallRegistry.getById(b.id);
                const update = inst ? getBoardUpdate(inst.root) : null;
                return {
                    id: b.id,
                    name: b.name,
                    description: b.description,
                    version: b.version,
                    fileMasks: b.fileMasks,
                    folderMasks: b.folderMasks,
                    folderEditorMasks: b.folderEditorMasks,
                    folderEditorPriority: b.folderEditorPriority,
                    editorName: b.editorName,
                    editorKind: b.editorKind,
                    standalone: b.standalone,
                    minAppVersion: b.minAppVersion,
                    size: b.archive.size,
                    compatible: publishedBoards.isCompatible(b.minAppVersion),
                    installed: !!inst,
                    installedRoot: inst?.root,
                    installedVersion: inst?.version,
                    updateAvailable: !!update,
                };
            });
    },

    getPublishedVersions: async (id: string): Promise<PublishedVersionResult[]> => {
        await ensureCatalog();
        const vm = await publishedBoards.getVersions(id);
        if (!vm) return [];
        const installedVersion = boardInstallRegistry.getById(id)?.version;
        return vm.versions.map((v): PublishedVersionResult => ({
            version: v.version,
            date: v.date,
            notes: v.notes,
            minAppVersion: v.minAppVersion,
            compatible: publishedBoards.isCompatible(v.minAppVersion),
            installed: v.version === installedVersion,
        }));
    },

    downloadPublished: async (
        id: string,
        opts?: { dir?: string; version?: string },
    ): Promise<string> => {
        await ensureCatalog();
        const entry = publishedBoards.getCatalog().find((b) => b.id === id);
        if (!entry) throw new Error(`Board not in catalog: "${id}"`);

        // Resolve the archive + version to fetch: the catalog-latest, or a specific version from
        // the version history.
        let resolved = entry;
        if (opts?.version && opts.version !== entry.version) {
            const vm = await publishedBoards.getVersions(id);
            const v = vm?.versions.find((x) => x.version === opts.version);
            if (!v) throw new Error(`Version not found for "${id}": ${opts.version}`);
            resolved = { ...entry, version: v.version, minAppVersion: v.minAppVersion, archive: v.archive };
        }
        if (!publishedBoards.isCompatible(resolved.minAppVersion)) {
            throw new Error(`This board version requires Persephone ≥ ${resolved.minAppVersion}.`);
        }

        const dir = opts?.dir ?? (await defaultInstallDir());
        return downloadBoard(resolved, dir);
    },

    installPublished: async (
        id: string,
        opts?: { dir?: string; version?: string },
    ): Promise<string | undefined> => {
        await ensureCatalog();
        const entry = publishedBoards.getCatalog().find((b) => b.id === id);
        if (!entry) throw new Error(`Board not in catalog: "${id}"`);

        // Already installed + a target version → version change (update/rollback): auto-run the
        // swap (no page, no button — the board is already trusted, the call is the intent).
        const reg = boardInstallRegistry.getById(id);
        if (reg && opts?.version) {
            const vm = await publishedBoards.getVersions(id);
            const v = vm?.versions.find((x) => x.version === opts.version);
            if (!v) throw new Error(`Version not found for "${id}": ${opts.version}`);
            if (!publishedBoards.isCompatible(v.minAppVersion)) {
                void ui.notify(t("api.boardVersionRequiresApp", { version: v.minAppVersion }), "warning");
                return undefined;
            }
            const ok = await runBoardVersionInstall({
                root: reg.root,
                id,
                name: entry.name,
                archive: v.archive,
                version: v.version,
            });
            return ok ? reg.root : undefined;
        }

        // Already installed AND trusted, no version → nothing to do; return the root (opening the
        // page would just hang until the user closes it). A downloaded-but-unregistered board
        // (reg present, not trusted) falls through so the user can Register it.
        if (reg) {
            await boardTrust.load();
            if (boardTrust.isTrusted(reg.root)) return reg.root;
        }

        // Fresh install → open the Board Info page prefilled and let the user walk Download →
        // Register. Resolve the root when registration succeeds, or undefined if the page closes
        // first. (A fresh install installs the catalog-latest; opts.version is not honored here.)
        const { BoardInfoEditorModel, getDefaultBoardInfoEditorState } = await import(
            "../editors/board-info/BoardInfoEditorModel"
        );
        const model = new BoardInfoEditorModel(
            new TComponentState({
                ...getDefaultBoardInfoEditorState(),
                catalogId: id,
                installDir: opts?.dir,
            }),
        );
        await model.restore();
        const page = app.pages.addPage(model as unknown as EditorModel);

        return await new Promise<string | undefined>((resolve) => {
            let settled = false;
            const settle = (root: string | undefined) => {
                if (settled) return;
                settled = true;
                installedSub();
                pagesUnsub();
                resolve(root);
            };
            const installedSub = model.installed.subscribe((root) => settle(root));
            const pagesUnsub = app.pages.state.subscribe(() => {
                if (!app.pages.pages.some((p) => p.id === page.id)) settle(undefined);
            });
        });
    },

    uninstallBoard: async (id: string): Promise<boolean> => {
        await ensureCatalog();
        const reg = boardInstallRegistry.getById(id);
        if (!reg) throw new Error(`Board not installed: "${id}"`);
        const manifest = await readBoardManifest(reg.root);
        const name = manifest?.name?.trim() || fpBasename(reg.root);
        return uninstallCatalogBoard({ root: reg.root, name, catalogId: id });
    },

    checkPublishedUpdates: async (force?: boolean): Promise<BoardUpdateInfo[]> => {
        if (force) await publishedBoards.refresh();
        else await publishedBoards.load();
        await boardInstallRegistry.load();
        return listBoardUpdates().map((u) => ({
            id: u.id,
            root: u.root,
            installedVersion: u.installedVersion,
            latestVersion: u.latestVersion,
        }));
    },
};
