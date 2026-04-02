import { TOneState } from "../../core/state/state";
import type { EditorModel } from "../../editors/base";
import type { IEditorState } from "../../../shared/types";
import type { ITreeProvider } from "../types/io.tree";
import type { TreeProviderViewSavedState } from "../../components/tree-provider";
import type { FileSearchState } from "../../components/file-search";
import { PageNavigatorModel } from "../../ui/navigation/PageNavigatorModel";
import type { IContentPipe } from "../types/io.pipe";
import { fs } from "../fs";
import { parseObject } from "../../core/utils/parse-utils";
import { debounce } from "../../../shared/utils";
import { expandSecondaryPanel } from "../../core/state/events";
import { fpDirname } from "../../core/utils/file-path";

export interface NavigationState {
    /** Currently selected item href (shared between PageNavigator and secondary editors). */
    selectedHref: string | null;
}

/** Serialized descriptor for a secondary editor model (for persistence). */
export interface SecondaryModelDescriptor {
    /** Serialized editor state (from model.getRestoreData()). */
    pageState: Partial<IEditorState>;
}

/** Persisted sidebar state (cache file). */
interface PageSidebarSavedState {
    open: boolean;
    width: number;
    rootPath: string;
    treeState?: TreeProviderViewSavedState;
    selectedHref?: string | null;
    activePanel?: string;
    secondaryModelDescriptors?: SecondaryModelDescriptor[];
    searchState?: FileSearchState;
    // Backward compat: old NavigationData format
    rootFilePath?: string;
    currentFilePath?: string;
    fileExplorerState?: { expandedPaths?: string[]; selectedFilePath?: string };
}

/**
 * PageModel — one per tab. Stable identity that survives navigation.
 *
 * Owns the browsing context (sidebar, tree, search, secondary editors)
 * and contains a mainEditor (EditorModel) as its content.
 *
 * Created as part of EPIC-017 Phase 2. Currently standalone — not yet
 * wired into PagesModel or the rendering pipeline.
 */
export class PageModel {
    /** Stable page UUID — tab identity, React key, cache key. Never changes. */
    readonly id: string;

    /** Tab pinned state. */
    pinned = false;

    /** The primary editor (content). Null = empty page with Explorer only. */
    mainEditor: EditorModel | null = null;

    // ── Sidebar state (absorbed from NavigationData) ─────────────────

    /** Shared tree provider (primary — FileTreeProvider). */
    treeProvider: ITreeProvider | null = null;
    /** Sidebar model — pure reactive state (open/close/width). */
    pageNavigatorModel: PageNavigatorModel | null = null;
    /** Primary selection state — reactive, subscribed by PageNavigator and secondary editors. */
    readonly selectionState = new TOneState<NavigationState>({ selectedHref: null });
    /** Primary tree expansion state — set by PageNavigator, persisted here. */
    treeState: TreeProviderViewSavedState | undefined = undefined;
    /** Which panel is currently active/expanded.
     *  Values: "explorer", "search", or a secondary editor's ID. */
    activePanel: string = "explorer";
    /** Persisted search state. When defined, the search panel is visible. */
    searchState: FileSearchState | undefined = undefined;

    // ── Secondary editors ────────────────────────────────────────────

    /** Editor models that act as secondary editors in the sidebar (survive navigation). */
    secondaryEditors: EditorModel[] = [];
    /** Reactive version counter — UI subscribes via .use() for re-render on add/remove. */
    readonly secondaryEditorsVersion = new TOneState({ version: 0 });
    /** Pending descriptors from restore — actual model creation deferred until restoreSecondaryEditors(). */
    pendingSecondaryDescriptors: SecondaryModelDescriptor[] | undefined = undefined;
    /** Deferred activePanel — set during restore, applied after restoreSecondaryEditors(). */
    private _pendingActivePanel: string | undefined = undefined;

    // ── Internal ─────────────────────────────────────────────────────

    private _rootPath: string;
    private _cacheName = "nav-panel"; // same file name for backward compat with NavigationData
    private _skipSave = false;
    private _unsubscribe: (() => void) | undefined = undefined;
    private _expandSub: { unsubscribe: () => void } | undefined = undefined;

    constructor(id?: string, rootPath?: string) {
        this.id = id ?? crypto.randomUUID();
        this._rootPath = rootPath ?? "";
        // Subscribe to expand requests from secondary editor models
        this._expandSub = expandSecondaryPanel.subscribe((modelId) => {
            if (modelId && this.secondaryEditors.some((m) => m.id === modelId)) {
                this.setActivePanel(modelId);
                this.secondaryEditorsVersion.update((s) => { s.version++; });
            }
        });
    }

    // ── Derived properties ───────────────────────────────────────────

    /** Display title — delegates to mainEditor, or "Empty" for empty pages. */
    get title(): string {
        return this.mainEditor?.title ?? "Empty";
    }

    /** Aggregate modified flag: true if mainEditor OR any secondary editor is modified. */
    get modified(): boolean {
        if (this.mainEditor?.modified) return true;
        return this.secondaryEditors.some((m) => m.modified);
    }

    /** Whether this page has an active sidebar (navigator panel created). */
    get hasSidebar(): boolean {
        return this.pageNavigatorModel !== null;
    }

    // ── Selection ────────────────────────────────────────────────────

    /** Update the selected item href. */
    setSelectedHref(href: string | null): void {
        this.selectionState.update((s) => { s.selectedHref = href; });
        this._saveStateDebounced();
    }

    // ── Tree state ───────────────────────────────────────────────────

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

    // ── Search ───────────────────────────────────────────────────────

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

    // ── Root path ────────────────────────────────────────────────────

    /** Root path (from PageNavigatorModel state or constructor). */
    get rootPath(): string {
        return this.pageNavigatorModel?.state.get().rootPath || this._rootPath;
    }

    // ── PageNavigatorModel ───────────────────────────────────────────

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

    // ── Navigator toggle ─────────────────────────────────────────────

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

    // ── Secondary editor lifecycle ───────────────────────────────────

    /** Add an editor model as a secondary editor in the sidebar. */
    addSecondaryEditor(model: EditorModel): void {
        if (this.secondaryEditors.includes(model)) return;
        this.secondaryEditors.push(model);
        model.setPage(this);
        this.secondaryEditorsVersion.update((s) => { s.version++; });
        this._saveStateDebounced();
    }

    /** Remove and dispose a secondary editor (panel closed by user). */
    removeSecondaryEditor(model: EditorModel): void {
        const idx = this.secondaryEditors.indexOf(model);
        if (idx < 0) return;
        this.secondaryEditors.splice(idx, 1);
        if (this.activePanel === model.id) {
            this.activePanel = "explorer";
        }
        model.setPage(null);
        model.dispose();
        this.secondaryEditorsVersion.update((s) => { s.version++; });
        this._saveStateDebounced();
    }

    /** Remove a secondary editor WITHOUT disposing (model cleared its secondaryEditor). */
    removeSecondaryEditorWithoutDispose(model: EditorModel): void {
        const idx = this.secondaryEditors.indexOf(model);
        if (idx < 0) return;
        this.secondaryEditors.splice(idx, 1);
        if (this.activePanel === model.id) {
            this.activePanel = "explorer";
        }
        model.setPage(null);
        this.secondaryEditorsVersion.update((s) => { s.version++; });
        this._saveStateDebounced();
    }

    /** Find a secondary editor by its editor ID. */
    findSecondaryEditor(editorId: string): EditorModel | undefined {
        return this.secondaryEditors.find((m) => m.id === editorId);
    }

    /** Check secondary editors for unsaved changes. Returns false if user cancels. */
    async confirmSecondaryRelease(): Promise<boolean> {
        for (const model of this.secondaryEditors) {
            if (!model.modified) continue;
            const released = await model.confirmRelease();
            if (!released) return false;
        }
        return true;
    }

    /**
     * Notify secondary editors that the main editor changed (after navigation).
     * Calls onMainEditorChanged() on each secondary editor.
     * Secondary editors may clear their secondaryEditor to opt out of survival.
     */
    notifyMainEditorChanged(): void {
        // Clear Explorer selection if the new editor wasn't opened from Explorer
        const sourceId = this.mainEditor?.state.get().sourceLink?.metadata?.sourceId;
        if (sourceId !== "explorer") {
            this.selectionState.update((s) => { s.selectedHref = null; });
        }
        // Notify secondary editors — they may clear their secondaryEditor
        for (const m of [...this.secondaryEditors]) {
            m.onMainEditorChanged(this.mainEditor);
        }
        // Clean up models that cleared their secondaryEditor during notification
        const removed = this.secondaryEditors.filter((m) => !m.secondaryEditor);
        if (removed.length > 0) {
            for (const m of removed) {
                const idx = this.secondaryEditors.indexOf(m);
                if (idx >= 0) this.secondaryEditors.splice(idx, 1);
                if (this.activePanel === m.id) {
                    this.activePanel = "explorer";
                }
                m.dispose();
            }
            this.secondaryEditorsVersion.update((s) => { s.version++; });
        }
    }

    /**
     * Restore secondary editor models from pending descriptors.
     * @param ownerEditor — the main editor. If a descriptor has the same ID,
     *   reuse it (deduplication for self-referencing archives).
     */
    async restoreSecondaryEditors(ownerEditor: EditorModel): Promise<void> {
        const descriptors = this.pendingSecondaryDescriptors;
        if (!descriptors?.length) {
            this._pendingActivePanel = undefined;
            return;
        }
        this.pendingSecondaryDescriptors = undefined;

        const { pagesModel } = await import("../pages");

        for (const desc of descriptors) {
            // Deduplicate: if this descriptor matches the owner editor, reuse it
            if (desc.pageState.id === ownerEditor.id) {
                this.secondaryEditors.push(ownerEditor);
                continue;
            }

            try {
                const model = await pagesModel.lifecycle.newEditorModelFromState(desc.pageState);
                model.applyRestoreData(desc.pageState as any); // eslint-disable-line @typescript-eslint/no-explicit-any
                await model.restore();
                this.secondaryEditors.push(model);
            } catch (err) {
                console.warn("[PageModel] Failed to restore secondary editor:", err);
            }
        }

        // Re-check the deferred activePanel now that models are restored
        if (this._pendingActivePanel) {
            const modelExists = this.secondaryEditors.some((m) => m.id === this._pendingActivePanel);
            if (modelExists) {
                this.activePanel = this._pendingActivePanel;
            }
            this._pendingActivePanel = undefined;
        }

        this.secondaryEditorsVersion.update((s) => { s.version++; });
    }

    // ── Persistence ──────────────────────────────────────────────────

    /** Restore sidebar state from cache (on app restart or page creation). */
    async restoreSidebar(): Promise<void> {
        const data = await fs.getCacheFile(this.id, this._cacheName);
        const saved = parseObject(data) as PageSidebarSavedState | undefined;
        if (saved) {
            // Backward compat: migrate old NavigationData/NavPanelModel format
            const rootPath = saved.rootPath || saved.rootFilePath || "";
            const treeState = saved.treeState || (saved.fileExplorerState?.expandedPaths
                ? {
                    expandedPaths: saved.fileExplorerState.expandedPaths,
                    selectedHref: saved.fileExplorerState.selectedFilePath,
                }
                : undefined);

            // Restore model state (skip save for this batch)
            this._skipSave = true;
            const navModel = this.ensurePageNavigatorModel();
            navModel.setStateQuiet({
                open: saved.open ?? true,
                width: saved.width ?? 240,
                rootPath,
            });
            this._skipSave = false;

            // Restore PageModel state
            this.treeState = treeState;
            this.selectionState.set({ selectedHref: saved.selectedHref ?? null });
            this._rootPath = rootPath;

            // Restore search state
            this.searchState = saved.searchState;

            // Restore secondary editor model descriptors (actual creation deferred)
            if (saved.secondaryModelDescriptors?.length) {
                this.pendingSecondaryDescriptors = saved.secondaryModelDescriptors;
            }

            // Restore activePanel: explorer/search are safe as-is.
            // Secondary model panels defer until models are restored.
            const restoredPanel = saved.activePanel ?? "explorer";
            if (restoredPanel === "search" && !this.searchState) {
                this.activePanel = "explorer"; // search state lost — fall back
            } else if (restoredPanel !== "explorer" && restoredPanel !== "search") {
                // Secondary model panel ID — defer until models are restored
                this.activePanel = "explorer";
                this._pendingActivePanel = restoredPanel;
            } else {
                this.activePanel = restoredPanel;
            }
        }
    }

    /** Save sidebar state to cache. */
    private _saveState = async (): Promise<void> => {
        // Flush secondary editor caches before saving their descriptors
        for (const model of this.secondaryEditors) {
            await model.saveState?.();
        }
        const navState = this.pageNavigatorModel?.state.get();
        const saved: PageSidebarSavedState = {
            open: navState?.open ?? true,
            width: navState?.width ?? 240,
            rootPath: navState?.rootPath ?? this._rootPath,
            treeState: this.treeState,
            selectedHref: this.selectionState.get().selectedHref,
            activePanel: this.activePanel,
            secondaryModelDescriptors: this.secondaryEditors.length > 0
                ? this.secondaryEditors.map((m) => ({ pageState: m.getRestoreData() }))
                : undefined,
            searchState: this.searchState,
        };
        await fs.saveCacheFile(this.id, JSON.stringify(saved), this._cacheName);
    };

    private _saveStateDebounced = debounce(this._saveState, 300);

    /** Flush pending saves immediately. */
    async flushSave(): Promise<void> {
        await this._saveState();
    }

    /** Save all state (sidebar + editor caches). Called before app quit. */
    async saveState(): Promise<void> {
        await this._saveState();
        await this.mainEditor?.saveState();
    }

    // ── Cleanup ──────────────────────────────────────────────────────

    async dispose(): Promise<void> {
        this._expandSub?.unsubscribe();
        this._expandSub = undefined;
        this._unsubscribe?.();
        this._unsubscribe = undefined;
        this.treeProvider?.dispose?.();
        this.treeProvider = null;
        // Dispose all secondary editors
        for (const model of this.secondaryEditors) {
            model.setPage(null);
            model.dispose();
        }
        this.secondaryEditors = [];
        this.pageNavigatorModel?.dispose();
        this.pageNavigatorModel = null;
        // Dispose main editor
        if (this.mainEditor) {
            this.mainEditor.setPage(null);
            await this.mainEditor.dispose();
            this.mainEditor = null;
        }
    }
}
