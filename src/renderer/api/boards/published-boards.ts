/**
 * Renderer-side mirror of the published-boards catalog.
 * Subscribes to main's `ePublishedBoardsUpdated` broadcast and pulls the catalog
 * via `getPublishedBoards`. Compatibility (`minAppVersion` vs the running app) is checked
 * with the shared `compareVersions`.
 *
 * No download / install here — + own that. This model only surfaces catalog data.
 */
import { api } from "../../../ipc/renderer/api";
import rendererEvents from "../../../ipc/renderer/renderer-events";
import { EventEndpoint } from "../../../ipc/api-types";
import { PublishedBoardInfo, PublishedBoardsCatalog, PublishedBoardVersions } from "../../../ipc/api-param-types";
import { MainSnapshotMirror } from "../../core/state/MainSnapshotMirror";
import { getBoardCompatibility } from "../../../shared/version-utils";
import { normalizeFileMasks, normalizeFolderMasks, matchesFolderEditorMasks } from "../../../shared/board/board-masks";
import { matchesBoardMasks } from "./board-file-masks";

/** Does an UNINSTALLED catalog board claim this file? Same predicate as a trusted board's
 *  (`matchesBoardMasks`), but over the catalog entry's raw manifest-copied masks — the catalog
 *  carries them unnormalized, so normalize per call (the lists are tiny and the call sites are
 *  filters over a small catalog). */
function matchesCatalogMasks(board: PublishedBoardInfo, fileName: string): boolean {
    return matchesBoardMasks(
        fileName,
        normalizeFileMasks(board.fileMasks),
        normalizeFolderMasks(board.folderMasks),
    );
}

/** Normalize copied association fields at every catalog ingress. The direct folder axis stays
 * separate from `folderMasks`, which remains the file predicate's narrowing-only field. */
function normalizeCatalog(catalog: PublishedBoardsCatalog | null): PublishedBoardsCatalog | null {
    if (!catalog) return null;
    return {
        ...catalog,
        boards: catalog.boards.map((board) => {
            const rawFolderEditorPriority = board.folderEditorPriority;
            const folderEditorPriority =
                typeof rawFolderEditorPriority === "number"
                && Number.isFinite(rawFolderEditorPriority)
                && rawFolderEditorPriority > 0
                    ? rawFolderEditorPriority
                    : 0;
            return {
                ...board,
                folderEditorMasks: normalizeFolderMasks(board.folderEditorMasks),
                folderEditorPriority,
            };
        }),
    };
}

class PublishedBoards extends MainSnapshotMirror<PublishedBoardsCatalog | null> {
    /** Running app version, cached at load() so the sync compatibility check needs no await
     *  (and to avoid an import cycle with `app`). */
    private appVersion = "";

    constructor() { super(null); }

    protected async fetch(): Promise<PublishedBoardsCatalog | null> {
        return (await api.getPublishedBoards()).catalog;
    }

    protected subscribeToMain(): void {
        this.attach(rendererEvents[EventEndpoint.ePublishedBoardsUpdated], (catalog) => this.apply(catalog));
    }

    protected override normalize(catalog: PublishedBoardsCatalog | null): PublishedBoardsCatalog | null {
        return normalizeCatalog(catalog);
    }

    /** Re-pulls on every call so main can run its 24-hour catalog check. */
    async load(): Promise<void> {
        if (!this.appVersion) {
            this.appVersion = await api.getAppVersion();
        }
        await this.reload();
    }

    /** A board's full version history (on demand — no caching; the properties view calls this on
     *  open). Returns null on network/parse failure. */
    async getVersions(id: string): Promise<PublishedBoardVersions | null> {
        return api.getBoardVersions(id);
    }

    /** Force a fresh network check (bypasses the 24h gate). */
    async refresh(): Promise<void> {
        const result = await api.getPublishedBoards(true);
        this.apply(result.catalog);
    }

    /** All catalog boards (sync, non-reactive). */
    getCatalog(): PublishedBoardInfo[] {
        return this.selectCatalogBoards(this.snapshot);
    }

    subscribeCatalog(listener: () => void): () => void {
        return this.state.subscribe(listener, (state) => this.selectCatalogBoards(state.snapshot));
    }

    /**
     * Whether a board version is compatible with the running app. `compareVersions(app,
     * min)` returns 1 when `min > app` (incompatible); compatible ⟺ result <= 0.
     */
    isCompatible(minAppVersion?: string): boolean {
        if (!minAppVersion) return true;
        if (!this.appVersion) return true; // not yet loaded — don't hide boards
        return getBoardCompatibility(
            { minAppVersion },
            { appVersion: this.appVersion },
        ).compatible;
    }

    /** Compatible catalog boards whose masks match the given file name (sync, non-reactive).
     *  Used by model code (e.g. the Board Info editor) that computes matches directly. */
    catalogBoardsForFile(fileName: string): PublishedBoardInfo[] {
        return this.selectCatalogBoardsForFile(this.snapshot, fileName);
    }

    subscribeCatalogBoardsForFile(
        fileName: string,
        listener: () => void,
    ): () => void {
        return this.state.subscribe(
            listener,
            (state) => this.selectCatalogBoardsForFile(state.snapshot, fileName),
        );
    }

    /** Compatible catalog boards whose direct folder masks match the given absolute folder. */
    catalogBoardsForFolder(folderPath: string): PublishedBoardInfo[] {
        return this.selectCatalogBoardsForFolder(this.snapshot, folderPath);
    }

    subscribeCatalogBoardsForFolder(
        folderPath: string,
        listener: () => void,
    ): () => void {
        return this.state.subscribe(
            listener,
            (state) => this.selectCatalogBoardsForFolder(state.snapshot, folderPath),
        );
    }

    private selectCatalogBoardsForFile(
        catalog: PublishedBoardsCatalog | null,
        fileName: string,
    ): PublishedBoardInfo[] {
        const boards = catalog?.boards ?? [];
        return boards.filter((board) => {
            if (!this.isCompatible(board.minAppVersion)) return false;
            return matchesCatalogMasks(board, fileName);
        });
    }

    private selectCatalogBoardsForFolder(
        catalog: PublishedBoardsCatalog | null,
        folderPath: string,
    ): PublishedBoardInfo[] {
        const boards = catalog?.boards ?? [];
        return boards.filter((board) => {
            if (!this.isCompatible(board.minAppVersion)) return false;
            return matchesFolderEditorMasks(folderPath, board.folderEditorMasks ?? []);
        });
    }

    private selectCatalogBoards(catalog: PublishedBoardsCatalog | null): PublishedBoardInfo[] {
        return catalog?.boards ?? [];
    }
}

export const publishedBoards = new PublishedBoards();
