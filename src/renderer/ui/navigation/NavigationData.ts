import type { ITreeProvider } from "../../api/types/io.tree";
import type { IContentPipe } from "../../api/types/io.pipe";
import type { TreeProviderViewSavedState } from "../../components/tree-provider";
import type { FileSearchState } from "../../components/file-search";
import type { EditorModel } from "../../editors/base";
import type { IEditorState } from "../../../shared/types";
import { TOneState } from "../../core/state/state";
import { fpDirname } from "../../core/utils/file-path";
import { fs } from "../../api/fs";
import { parseObject } from "../../core/utils/parse-utils";
import { debounce } from "../../../shared/utils";
import { expandSecondaryPanel } from "../../core/state/events";
import { PageNavigatorModel } from "./PageNavigatorModel";

export interface NavigationState {
    /** Currently selected item href (shared between PageNavigator and CategoryEditor). */
    selectedHref: string | null;
}

/** Serialized descriptor for a secondary editor model (for persistence). */
export interface SecondaryModelDescriptor {
    /** Serialized page state (from model.getRestoreData()). */
    pageState: Partial<IEditorState>;
}

/** Persisted state format — backward-compatible with old NavPanelModel. */
interface NavigationSavedState {
    open: boolean;
    width: number;
    rootPath: string;
    treeState?: TreeProviderViewSavedState;
    selectedHref?: string | null;
    activePanel?: string; // "explorer", "search", or a secondary model ID
    // Secondary editor models (EPIC-016)
    secondaryModelDescriptors?: SecondaryModelDescriptor[];
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

    /** The active page model that owns this NavigationData. Updated on navigation. */
    ownerModel: EditorModel | null = null;

    /** Which panel is currently active/expanded.
     *  Values: "explorer", "search", or a secondary model's page ID. */
    activePanel: string = "explorer";

    // ── Secondary editor models (EPIC-016) ────────────────────────────

    /** Page models that act as secondary editors (survive page navigation). */
    secondaryModels: EditorModel[] = [];
    /** Reactive version counter — PageNavigator subscribes via .use() for re-render on add/remove. */
    readonly secondaryModelsVersion = new TOneState({ version: 0 });
    /** Pending descriptors from restore — actual model creation deferred to registry (task 1.2). */
    pendingSecondaryDescriptors: SecondaryModelDescriptor[] | undefined = undefined;
    /** Deferred activePanel — set during restore, applied after restoreSecondaryModels(). */
    private _pendingActivePanel: string | undefined = undefined;

    /** Update the owner model reference and propagate to secondary models.
     *  Called after NavigationData is transferred during navigation.
     *  Secondary models may clear their secondaryEditor during setOwnerPage
     *  (e.g., ZipPageModel checks sourceLink). Their setter is a no-op because
     *  navigationData is null (only the active page holds the reference), so
     *  NavigationData handles the cleanup after notification. */
    setOwnerModel(model: EditorModel): void {
        this.ownerModel = model;
        // Clear Explorer selection if the new page wasn't opened from Explorer
        const sourceId = model.state.get().sourceLink?.metadata?.sourceId;
        if (sourceId !== "explorer") {
            this.selectionState.update((s) => { s.selectedHref = null; });
        }
        // Notify secondary models — they may clear their secondaryEditor
        for (const m of [...this.secondaryModels]) {
            m.setOwnerPage(model);
        }
        // Clean up models that cleared their secondaryEditor during setOwnerPage
        const removed = this.secondaryModels.filter((m) => !m.secondaryEditor);
        if (removed.length > 0) {
            for (const m of removed) {
                const idx = this.secondaryModels.indexOf(m);
                if (idx >= 0) this.secondaryModels.splice(idx, 1);
                if (this.activePanel === m.id) {
                    this.activePanel = "explorer";
                }
                m.dispose();
            }
            this.secondaryModelsVersion.update((s) => { s.version++; });
        }
    }

    /** Add a page model as a secondary editor. */
    addSecondaryModel(model: EditorModel): void {
        if (this.secondaryModels.includes(model)) return;
        this.secondaryModels.push(model);
        model.setOwnerPage(this.ownerModel);
        this.secondaryModelsVersion.update((s) => { s.version++; });
        this._saveStateDebounced();
    }

    /** Remove and dispose a secondary editor model (panel closed by user). */
    removeSecondaryModel(model: EditorModel): void {
        const idx = this.secondaryModels.indexOf(model);
        if (idx < 0) return;
        this.secondaryModels.splice(idx, 1);
        if (this.activePanel === model.id) {
            this.activePanel = "explorer";
        }
        model.dispose();
        this.secondaryModelsVersion.update((s) => { s.version++; });
        this._saveStateDebounced();
    }

    /** Remove a secondary editor model WITHOUT disposing (model cleared its secondaryEditor). */
    removeSecondaryModelWithoutDispose(model: EditorModel): void {
        const idx = this.secondaryModels.indexOf(model);
        if (idx < 0) return;
        this.secondaryModels.splice(idx, 1);
        if (this.activePanel === model.id) {
            this.activePanel = "explorer";
        }
        this.secondaryModelsVersion.update((s) => { s.version++; });
        this._saveStateDebounced();
    }

    /** Find a secondary model by its page ID. */
    findSecondaryModel(pageId: string): EditorModel | undefined {
        return this.secondaryModels.find((m) => m.state.get().id === pageId);
    }

    /** Check secondary models for unsaved changes. Returns false if user cancels. */
    async confirmSecondaryRelease(): Promise<boolean> {
        for (const model of this.secondaryModels) {
            if (!model.state.get().modified) continue;
            const released = await model.confirmRelease();
            if (!released) return false;
        }
        return true;
    }

    /** Restore secondary editor models from pending descriptors.
     *  @param ownerModel — the primary page that owns this NavigationData.
     *    If a descriptor has the same ID as ownerModel, reuse it (no duplicate). */
    async restoreSecondaryModels(ownerModel: EditorModel): Promise<void> {
        const descriptors = this.pendingSecondaryDescriptors;
        if (!descriptors?.length) {
            // Even with no descriptors, check _pendingActivePanel (edge case)
            this._pendingActivePanel = undefined;
            return;
        }
        this.pendingSecondaryDescriptors = undefined;

        const { pagesModel } = await import("../../api/pages");

        for (const desc of descriptors) {
            // Deduplicate: if this descriptor matches the owner page, reuse it
            if (desc.pageState.id === ownerModel.id) {
                this.secondaryModels.push(ownerModel);
                continue;
            }

            try {
                const model = await pagesModel.lifecycle.newPageModelFromState(desc.pageState);
                model.applyRestoreData(desc.pageState as any); // eslint-disable-line @typescript-eslint/no-explicit-any
                await model.restore();
                this.secondaryModels.push(model);
            } catch (err) {
                console.warn("[NavigationData] Failed to restore secondary model:", err);
            }
        }

        // Re-check the deferred activePanel now that models are restored
        if (this._pendingActivePanel) {
            const modelExists = this.secondaryModels.some((m) => m.id === this._pendingActivePanel);
            if (modelExists) {
                this.activePanel = this._pendingActivePanel;
            }
            this._pendingActivePanel = undefined;
        }

        this.secondaryModelsVersion.update((s) => { s.version++; });
    }

    // ── Search ────────────────────────────────────────────────────────

    /** Persisted search state. When defined, the search panel is visible. */
    searchState: FileSearchState | undefined = undefined;

    private _rootPath: string;
    private _id: string | undefined = undefined;
    private _cacheName = "nav-panel"; // same file name for backward compat
    private _skipSave = false;
    private _unsubscribe: (() => void) | undefined = undefined;
    private _expandSub: { unsubscribe: () => void } | undefined = undefined;

    constructor(rootPath: string) {
        this.renderId = crypto.randomUUID();
        this._rootPath = rootPath;
        // Subscribe to expand requests from secondary editor models
        this._expandSub = expandSecondaryPanel.subscribe((modelId) => {
            if (modelId && this.secondaryModels.some((m) => m.id === modelId)) {
                this.setActivePanel(modelId);
                // Bump version so PageNavigator re-renders and syncs activePanel
                this.secondaryModelsVersion.update((s) => { s.version++; });
            }
        });
    }

    // ── Selection ─────────────────────────────────────────────────────

    /** Update the selected item href. */
    setSelectedHref(href: string | null): void {
        this.selectionState.update((s) => { s.selectedHref = href; });
        this._saveStateDebounced();
    }

    // ── Tree state ────────────────────────────────────────────────────

    /** Update tree expansion state from PageNavigator. */
    setTreeState(state: TreeProviderViewSavedState): void {
        this.treeState = state;
        this._saveStateDebounced();
    }

    /** Set the active panel. */
    setActivePanel(panel: string): void {
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

            // Restore search state
            this.searchState = saved.searchState;

            // Restore secondary editor model descriptors (actual creation deferred to registry)
            if (saved.secondaryModelDescriptors?.length) {
                this.pendingSecondaryDescriptors = saved.secondaryModelDescriptors;
            }

            // Restore activePanel: explorer/search are safe to restore as-is.
            // Secondary model panels defer until models are restored.
            const restoredPanel = saved.activePanel ?? "explorer";
            if (restoredPanel === "search" && !this.searchState) {
                this.activePanel = "explorer"; // search state lost — fall back
            } else if (restoredPanel !== "explorer" && restoredPanel !== "search") {
                // Secondary model panel ID (or legacy "secondary") — defer until models are restored
                this.activePanel = "explorer";
                this._pendingActivePanel = restoredPanel;
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
        // Flush secondary model caches before saving their descriptors.
        // Skip models whose navigationData is this (owner page) — avoids infinite recursion.
        for (const model of this.secondaryModels) {
            if (model.navigationData === this) continue;
            await model.saveState?.();
        }
        const navState = this.pageNavigatorModel?.state.get();
        const saved: NavigationSavedState = {
            open: navState?.open ?? true,
            width: navState?.width ?? 240,
            rootPath: navState?.rootPath ?? this._rootPath,
            treeState: this.treeState,
            selectedHref: this.selectionState.get().selectedHref,
            activePanel: this.activePanel,
            // Secondary editor models (EPIC-016)
            secondaryModelDescriptors: this.secondaryModels.length > 0
                ? this.secondaryModels.map((m) => ({ pageState: m.getRestoreData() }))
                : undefined,
            // Search state
            searchState: this.searchState,
        };
        await fs.saveCacheFile(this._id, JSON.stringify(saved), this._cacheName);
    };

    private _saveStateDebounced = debounce(this._saveState, 300);

    // ── Cleanup ───────────────────────────────────────────────────────

    dispose(): void {
        this._expandSub?.unsubscribe();
        this._expandSub = undefined;
        this._unsubscribe?.();
        this._unsubscribe = undefined;
        this.treeProvider?.dispose?.();
        this.treeProvider = null;
        // Dispose all secondary editor models
        for (const model of this.secondaryModels) {
            model.dispose();
        }
        this.secondaryModels = [];
        this.pageNavigatorModel?.dispose();
        this.pageNavigatorModel = null;
    }
}
