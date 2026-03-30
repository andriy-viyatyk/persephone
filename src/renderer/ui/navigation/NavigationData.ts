import type { ITreeProvider } from "../../api/types/io.tree";
import type { IContentPipe } from "../../api/types/io.pipe";
import type { TreeProviderViewSavedState } from "../../components/tree-provider";
import type { FileSearchState } from "../../components/file-search";
import { TOneState } from "../../core/state/state";
import { fpDirname } from "../../core/utils/file-path";
import { fs } from "../../api/fs";
import { parseObject } from "../../core/utils/parse-utils";
import { debounce } from "../../../shared/utils";
import { PageNavigatorModel } from "./PageNavigatorModel";

export interface NavigationState {
    /** Currently selected item href (shared between PageNavigator and CategoryEditor). */
    selectedHref: string | null;
}

/** Descriptor for a secondary tree provider (archive, link collection). */
export interface SecondaryDescriptor {
    /** Provider type: "zip", "link" (future). */
    type: string;
    /** Source URL (path to archive or .link.json). */
    sourceUrl: string;
    /** Display label for the panel header (e.g., "Archive", "Links"). */
    label: string;
}

/** Persisted state format — backward-compatible with old NavPanelModel. */
interface NavigationSavedState {
    open: boolean;
    width: number;
    rootPath: string;
    treeState?: TreeProviderViewSavedState;
    selectedHref?: string | null;
    // Secondary provider state
    activePanel?: "explorer" | "search" | "secondary";
    secondaryDescriptor?: SecondaryDescriptor | null;
    secondarySelectedHref?: string | null;
    secondaryTreeState?: TreeProviderViewSavedState;
    // Search state
    searchState?: FileSearchState;
    // Backward compat: old NavPanelModel format
    rootFilePath?: string;
    currentFilePath?: string;
    fileExplorerState?: { expandedPaths?: string[]; selectedFilePath?: string };
}

/**
 * NavigationData — stable browsing context that survives page navigation.
 *
 * Created once when a page first opens with a navigator. Transferred
 * between page models during navigatePageTo (not recreated).
 *
 * Owns the shared ITreeProvider instance, the PageNavigator model,
 * and all persistence (save/restore to cache file).
 *
 * Both PageNavigator (sidebar) and CategoryEditor (content area) access
 * the same treeProvider through this object.
 */
export class NavigationData {
    /** Stable ID for React key — survives navigation. Keeps PageNavigator mounted. */
    readonly renderId: string;
    /** Shared tree provider (primary — FileTreeProvider). */
    treeProvider: ITreeProvider | null = null;
    /** Sidebar model — pure reactive state, no persistence. */
    pageNavigatorModel: PageNavigatorModel | null = null;
    /** Primary selection state — reactive, subscribed by PageNavigator and CategoryEditor. */
    readonly selectionState = new TOneState<NavigationState>({ selectedHref: null });
    /** Primary tree expansion state — set by PageNavigator, persisted here. */
    treeState: TreeProviderViewSavedState | undefined = undefined;

    // ── Secondary provider ────────────────────────────────────────────

    /** Descriptor for secondary panel (set when user selects archive/link file). */
    secondaryDescriptor: SecondaryDescriptor | null = null;
    /** Lazily created secondary tree provider. */
    secondaryProvider: ITreeProvider | null = null;
    /** Secondary selection state. */
    readonly secondarySelectionState = new TOneState<NavigationState>({ selectedHref: null });
    /** Secondary tree expansion state. */
    secondaryTreeState: TreeProviderViewSavedState | undefined = undefined;
    /** Which panel is currently active/expanded. */
    activePanel: "explorer" | "search" | "secondary" = "explorer";

    // ── Search ────────────────────────────────────────────────────────

    /** Persisted search state. When defined, the search panel is visible. */
    searchState: FileSearchState | undefined = undefined;

    private _rootPath: string;
    private _id: string | undefined = undefined;
    private _cacheName = "nav-panel"; // same file name for backward compat
    private _skipSave = false;
    private _unsubscribe: (() => void) | undefined = undefined;

    constructor(rootPath: string) {
        this.renderId = crypto.randomUUID();
        this._rootPath = rootPath;
    }

    // ── Active provider/selection getters ──────────────────────────────

    /** Returns the active provider based on activePanel. */
    get activeProvider(): ITreeProvider | null {
        return this.activePanel === "secondary"
            ? this.secondaryProvider
            : this.treeProvider;
    }

    /** Returns the active selection state based on activePanel. */
    get activeSelectionState(): TOneState<NavigationState> {
        return this.activePanel === "secondary"
            ? this.secondarySelectionState
            : this.selectionState;
    }

    // ── Selection ─────────────────────────────────────────────────────

    /** Update the selected item href (primary/explorer). */
    setSelectedHref(href: string | null): void {
        this.selectionState.update((s) => { s.selectedHref = href; });
        this._saveStateDebounced();
    }

    /** Update the selected item href (secondary). */
    setSecondarySelectedHref(href: string | null): void {
        this.secondarySelectionState.update((s) => { s.selectedHref = href; });
        this._saveStateDebounced();
    }

    // ── Tree state ────────────────────────────────────────────────────

    /** Update tree expansion state from PageNavigator (primary). */
    setTreeState(state: TreeProviderViewSavedState): void {
        this.treeState = state;
        this._saveStateDebounced();
    }

    /** Update tree expansion state from PageNavigator (secondary). */
    setSecondaryTreeState(state: TreeProviderViewSavedState): void {
        this.secondaryTreeState = state;
        this._saveStateDebounced();
    }

    // ── Secondary provider management ─────────────────────────────────

    /** Set or clear the secondary provider descriptor. */
    setSecondaryDescriptor(desc: SecondaryDescriptor | null): void {
        if (this.secondaryDescriptor?.sourceUrl === desc?.sourceUrl) return; // same file
        this.secondaryProvider?.dispose?.();
        this.secondaryProvider = null;
        this.secondaryDescriptor = desc;
        this.secondarySelectionState.set({ selectedHref: null });
        this.secondaryTreeState = undefined;
        if (!desc && this.activePanel === "secondary") {
            this.activePanel = "explorer";
        }
        this._saveStateDebounced();
    }

    /** Clear the secondary provider. */
    clearSecondary(): void {
        this.setSecondaryDescriptor(null);
    }

    /** Lazily create the secondary provider from the descriptor. */
    async createSecondaryProvider(): Promise<ITreeProvider | null> {
        const desc = this.secondaryDescriptor;
        if (!desc) return null;
        if (this.secondaryProvider) return this.secondaryProvider;

        switch (desc.type) {
            case "zip": {
                const { ZipTreeProvider } = await import("../../content/tree-providers/ZipTreeProvider");
                this.secondaryProvider = new ZipTreeProvider(desc.sourceUrl);
                return this.secondaryProvider;
            }
            case "link":
                // Phase 4 — not implemented yet
                return null;
            default:
                return null;
        }
    }

    /** Set the active panel. */
    setActivePanel(panel: "explorer" | "search" | "secondary"): void {
        this.activePanel = panel;
        this._saveStateDebounced();
    }

    // ── Search ────────────────────────────────────────────────────────

    /** Open the search panel, optionally scoped to a folder. */
    openSearch(folder?: string): void {
        this.activePanel = "search";
        if (!this.searchState || (folder && this.searchState.searchFolder !== folder)) {
            this.searchState = {
                query: this.searchState?.query ?? "",
                includePattern: this.searchState?.includePattern ?? "",
                excludePattern: this.searchState?.excludePattern ?? "",
                showFilters: this.searchState?.showFilters ?? false,
                searchFolder: folder ?? "",
                results: [],
                totalMatches: 0,
                totalFiles: 0,
            };
        }
        this._saveStateDebounced();
    }

    /** Close the search panel and clear state. */
    closeSearch(): void {
        this.searchState = undefined;
        if (this.activePanel === "search") {
            this.activePanel = "explorer";
        }
        this._saveStateDebounced();
    }

    /** Update search state from FileSearch component. */
    setSearchState = (state: FileSearchState): void => {
        this.searchState = state;
        this._saveStateDebounced();
    };

    // ── Root path ─────────────────────────────────────────────────────

    /** Root path (from model state or constructor). */
    get rootPath(): string {
        return this.pageNavigatorModel?.state.get().rootPath || this._rootPath;
    }

    // ── Model management ──────────────────────────────────────────────

    /** Lazy-create PageNavigatorModel on first access. */
    ensurePageNavigatorModel(): PageNavigatorModel {
        if (!this.pageNavigatorModel) {
            this.pageNavigatorModel = new PageNavigatorModel(this._rootPath);
            // Subscribe to model state changes for auto-save
            this._unsubscribe = this.pageNavigatorModel.state.subscribe(() => {
                if (!this._skipSave) {
                    this._saveStateDebounced();
                }
            });
        }
        return this.pageNavigatorModel;
    }

    // ── Navigator toggle ──────────────────────────────────────────────

    /**
     * Toggle the PageNavigator panel. If no treeProvider exists yet,
     * attempts to create a FileTreeProvider from the pipe's file provider.
     */
    toggleNavigator(pipe?: IContentPipe | null, filePath?: string): void {
        if (this.treeProvider || this.pageNavigatorModel) {
            if (filePath) {
                this.pageNavigatorModel?.reinitIfEmpty(fpDirname(filePath));
            }
            this.ensurePageNavigatorModel().toggle();
            return;
        }

        let rootPath = this._rootPath;
        if (pipe?.provider.type === "file" && pipe.provider.sourceUrl) {
            rootPath = fpDirname(pipe.provider.sourceUrl);
        } else if (filePath) {
            rootPath = fpDirname(filePath);
        }

        if (!rootPath) return;

        this._rootPath = rootPath;
        this.ensurePageNavigatorModel().toggle();
    }

    /** Whether the navigator can be opened. */
    canOpenNavigator(pipe?: IContentPipe | null, filePath?: string): boolean {
        if (this.treeProvider) return true;
        if (this.pageNavigatorModel) return true;
        if (pipe?.provider.type === "file") return true;
        if (filePath) return true;
        return false;
    }

    // ── Persistence ───────────────────────────────────────────────────

    /** Restore from cache (on app restart). */
    async restore(pageId: string): Promise<void> {
        this._id = pageId;
        const data = await fs.getCacheFile(pageId, this._cacheName);
        const saved = parseObject(data) as NavigationSavedState | undefined;
        if (saved) {
            // Backward compat: migrate old NavPanelModel format
            const rootPath = saved.rootPath || saved.rootFilePath || "";
            const treeState = saved.treeState || (saved.fileExplorerState?.expandedPaths
                ? {
                    expandedPaths: saved.fileExplorerState.expandedPaths,
                    selectedHref: saved.fileExplorerState.selectedFilePath,
                }
                : undefined);
            const selectedHref = saved.selectedHref ?? null;

            // Restore model state (skip save for this batch)
            this._skipSave = true;
            const navModel = this.ensurePageNavigatorModel();
            navModel.setStateQuiet({
                open: saved.open ?? true,
                width: saved.width ?? 240,
                rootPath,
            });
            this._skipSave = false;

            // Restore NavigationData state
            this.treeState = treeState;
            this.selectionState.set({ selectedHref });
            this._rootPath = rootPath;

            // Restore secondary state (descriptor only — provider created lazily)
            if (saved.secondaryDescriptor) {
                this.secondaryDescriptor = saved.secondaryDescriptor;
                this.secondaryTreeState = saved.secondaryTreeState;
                this.secondarySelectionState.set({
                    selectedHref: saved.secondarySelectedHref ?? null,
                });
            }
            // Restore search state
            this.searchState = saved.searchState;

            // Restore activePanel: explorer/search are safe to restore as-is.
            // Secondary panels require async provider creation — fall back to explorer.
            const restoredPanel = saved.activePanel ?? "explorer";
            if (restoredPanel === "secondary") {
                this.activePanel = "explorer";
            } else if (restoredPanel === "search" && !this.searchState) {
                this.activePanel = "explorer"; // search state lost — fall back
            } else {
                this.activePanel = restoredPanel;
            }
        }
    }

    /** Update page ID after navigation transfer. */
    updateId(newPageId: string): void {
        this._id = newPageId;
        this._saveStateDebounced();
    }

    /** Flush pending saves immediately. */
    async flushSave(): Promise<void> {
        await this._saveState();
    }

    private _saveState = async (): Promise<void> => {
        if (!this._id) return;
        const navState = this.pageNavigatorModel?.state.get();
        const saved: NavigationSavedState = {
            open: navState?.open ?? true,
            width: navState?.width ?? 240,
            rootPath: navState?.rootPath ?? this._rootPath,
            treeState: this.treeState,
            selectedHref: this.selectionState.get().selectedHref,
            // Secondary state
            activePanel: this.activePanel,
            secondaryDescriptor: this.secondaryDescriptor,
            secondarySelectedHref: this.secondarySelectionState.get().selectedHref,
            secondaryTreeState: this.secondaryTreeState,
            // Search state
            searchState: this.searchState,
        };
        await fs.saveCacheFile(this._id, JSON.stringify(saved), this._cacheName);
    };

    private _saveStateDebounced = debounce(this._saveState, 300);

    // ── Cleanup ───────────────────────────────────────────────────────

    dispose(): void {
        this._unsubscribe?.();
        this._unsubscribe = undefined;
        this.treeProvider?.dispose?.();
        this.treeProvider = null;
        this.secondaryProvider?.dispose?.();
        this.secondaryProvider = null;
        this.pageNavigatorModel?.dispose();
        this.pageNavigatorModel = null;
    }
}
