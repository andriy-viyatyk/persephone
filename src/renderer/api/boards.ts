import { app } from "./app";
import { fs } from "./fs";
import type {
    IBoards,
    BoardListing,
    PublishedBoardResult,
    PublishedVersionResult,
    BoardUpdateInfo,
} from "./types/boards";
import { fpIsAbsolute, fpJoin, fpResolve } from "../core/utils/file-path";
import { isBoardFolder, readBoardManifest } from "./boards/board-manifest-io";
import { LEGACY_BOARD_AGENT_DEPRECATION_NOTE } from "./boards/board-permission-copy";
import { boardRegistry } from "./boards/board-registry";
import { BoardGrant } from "../../shared/board/board-grant";
import { boardInstallRegistry, InstalledBoardEntry } from "./boards/board-install-registry";
import { publishedBoards } from "./boards/published-boards";
import { getBoardUpdate, listBoardUpdates } from "./boards/board-updates";
import { createBoardFromTemplate } from "./boards/board-scaffold";
import { requestBoardTrust } from "./boards/request-board-trust";
import { downloadBoard } from "./boards/board-install";
import { boardLifecycle } from "./boards/board-lifecycle";
import { encodePersephoneBoardLink } from "../content/persephone-board-link";
import { api } from "../../ipc/renderer/api";
import { type BoardServiceStatus } from "../../ipc/module-service-channels";
import { moduleServiceStatus } from "./module-service-status";
import { createLinkData } from "../../shared/link-data";
import { BoardRoot } from "../../shared/board/board-root";
import { asBoardHostEditor } from "./boards/board-host-editor";
import { appCallTimeout } from "./ai-vision-call-timeout";
import { createBoardShortcutCore } from "../editors/board/board-shortcut";

export const BOARDS_ASSETS_BASE_URL =
    "https://raw.githubusercontent.com/andriy-viyatyk/persephone/main/boards-assets/";
export const BOARDS_MANIFEST_URL = BOARDS_ASSETS_BASE_URL + "manifest.json";

/**
 * `app.boards` — board lifecycle for scripts / agents.
 *
 * `createBoard` / `createDemoBoard` wrap the editor-independent
 * `createBoardFromTemplate` (which scaffolds the template, guarantees
 * `board-manifest.json`, and auto-trusts the board during user-initiated creation. `openBoard`
 * opens an existing board by its root path through the generic `app.openRawLink`
 * pipeline (encoding the `persephone-board://` link internally). Board domain
 * services are imported from `api/boards/`; editor construction and view-adjacent
 * Board Info page loading remains a lazy editor load through `openBoardInfoPage`.
 *
 * `registerBoard` / `unregisterBoard` / `renameBoard` are the
 * lifecycle triples for agents: register requests trust via the user's dialog (never
 * self-trusts), unregister untrusts through `BoardLifecycle`, and rename moves the folder
 * through `BoardLifecycle` while carrying trust/pin/install registration without a dialog.
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
    await assertBoardFolder(root, "Not a board folder");
    await boardRegistry.load();
    if (!boardRegistry.isPermitted(root)) {
        throw new Error("Board is not trusted; call boards.registerBoard(root) first.");
    }
    return root;
}

/** Keep the established agent-facing wording for both board-folder validation surfaces. */
async function assertBoardFolder(root: string, prefix = "Not a board"): Promise<void> {
    if (!(await isBoardFolder(root))) throw new Error(`${prefix}: "${root}" is missing or has no board-manifest.json.`);
}

interface BoardListingSource {
    readonly key: string;
    readonly root: string;
    readonly trusted: boolean;
    readonly installed?: InstalledBoardEntry;
    readonly openPageIds: string[];
}
function mergeBoardSources(): BoardListingSource[] {
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

    for (const entry of boardRegistry.list("trusted")) addRoot(entry.root);
    for (const entry of boardInstallRegistry.listInstalled()) {
        addRoot(entry.root).installed ??= entry;
    }
    for (const page of app.pages.boardPageRouter.findPagesByBoardRoot()) {
        const boardRoot = asBoardHostEditor(page.mainEditor)?.boardRoot;
        if (!boardRoot) continue;
        addRoot(boardRoot).openPageIds.push(page.id);
    }

    return [...records.entries()]
        .sort(([first], [second]) => first < second ? -1 : first > second ? 1 : 0)
        .map(([key, record]) => ({
            key,
            root: record.root,
            trusted: boardRegistry.isTrusted(record.root),
            installed: record.installed,
            openPageIds: [...record.openPageIds].sort(),
        }));
}

function installedListing(
    source: BoardListingSource,
): BoardListing["installed"] {
    if (!source.installed) return undefined;
    if (!publishedBoards.isLoaded()) {
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
    return mergeBoardSources().map((source) =>
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
    await Promise.all([boardRegistry.load(), boardInstallRegistry.load()]);
    const merged = mergeBoardSources();
    return Promise.all(merged.map(async (source) => {
        const manifest = await readBoardManifest(source.root);
        // After Phase 2 extraction, UI uses t(key) and this agent-facing note uses englishMessage(key) with that same key.
        const deprecationNote = (manifest ? BoardGrant.from(manifest.permissions) : BoardGrant.fromManifest(undefined)).isLegacy()
            && !boardRegistry.isBundled(source.root)
            ? LEGACY_BOARD_AGENT_DEPRECATION_NOTE
            : undefined;
        return toBoardListing(source, manifest ?? undefined, moduleServiceStatus.getStatus(source.root), deprecationNote);
    }));
}

export const boards: IBoards = {
    get callTimeoutMs(): number {
        return appCallTimeout.get();
    },
    set callTimeoutMs(value: number) {
        appCallTimeout.set(value);
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
        const result = await createBoardShortcutCore(root, shortcutOptions);
        return result ? { linkPath: result.linkPath } : null;
    },
    openBoardWindow: async (boardRoot) => {
        const root = await resolveTrustedBoardRoot(boardRoot);
        await api.openBoardWindow(root);
    },
    openBoard: async (boardRoot: string) => {
        await assertBoardFolder(boardRoot);
        // Encode the persephone-board:// link in one tested place and open it via
        // the generic pipeline. The agent never builds the link by hand.
        await app.events.openRawLink.sendAsync(createLinkData(encodePersephoneBoardLink(boardRoot), {
            sourceId: "app-api",
        }));
    },

    // ── Board lifecycle — trust / untrust / rename  ──────────
    // Security invariant: the API requests, the user's trust dialog grants. `boardRegistry`
    // is never touched here without either a user dialog (registerBoard), a same-content path
    // move (renameBoard — no privilege gain), or a privilege reduction (unregisterBoard).

    registerBoard: async (boardRoot: string): Promise<boolean> => {
        const normalizedRoot = fpIsAbsolute(boardRoot) ? fpResolve(boardRoot) : boardRoot;
        await assertBoardFolder(normalizedRoot);
        return requestBoardTrust(normalizedRoot);
    },

    unregisterBoard: async (boardRoot: string): Promise<void> => {
        if (!(await boardLifecycle.unregister(boardRoot, { consented: true }))) {
            throw new Error("Board was not unregistered: closing its open page was cancelled.");
        }
    },

    renameBoard: async (boardRoot: string, newName: string): Promise<string> => {
        await assertBoardFolder(boardRoot);
        return boardLifecycle.rename(boardRoot, newName);
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
            const ok = await boardLifecycle.installVersion({
                root: reg.root,
                id,
                name: entry.name,
                archive: v.archive,
                version: v.version,
                minAppVersion: v.minAppVersion,
            });
            return ok ? reg.root : undefined;
        }

        // Already installed AND trusted, no version → nothing to do; return the root (opening the
        // page would just hang until the user closes it). A downloaded-but-unregistered board
        // (reg present, not trusted) falls through so the user can Register it.
        if (reg) {
            await boardRegistry.load();
            if (boardRegistry.isTrusted(reg.root)) return reg.root;
        }

        // Fresh install → open the Board Info page prefilled and let the user walk Download →
        // Register. Resolve the root when registration succeeds, or undefined if the page closes
        // first. (A fresh install installs the catalog-latest; opts.version is not honored here.)
        const { openBoardInfoPage } = await import("../editors/board-info/open-board-info");
        const handle = await openBoardInfoPage({ catalogId: id, installDir: opts?.dir });

        return await new Promise<string | undefined>((resolve) => {
            let settled = false;
            const settle = (root: string | undefined) => {
                if (settled) return;
                settled = true;
                installedUnsub();
                pagesUnsub();
                resolve(root);
            };
            const installedUnsub = handle.onInstalled((root) => settle(root));
            const pagesUnsub = app.pages.state.subscribe(() => {
                if (!app.pages.query.pages.some((p) => p.id === handle.pageId)) settle(undefined);
            });
        });
    },

    uninstallBoard: async (id: string): Promise<boolean> => {
        await ensureCatalog();
        return boardLifecycle.uninstall(id);
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
