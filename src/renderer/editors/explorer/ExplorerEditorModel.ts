import { TComponentState, TOneState } from "../../core/state/state";
import { EditorModel, getDefaultEditorModelState } from "../base";
import type { IEditorState } from "../../../shared/types";
import type { ITreeProvider } from "../../api/types/io.tree";
import type { TreeProviderViewSavedState } from "../../components/tree-provider";
import type { FileSearchState } from "../../components/file-search";
import type { NavigationState } from "../../api/pages/PageModel";
import { fpDirname } from "../../core/utils/file-path";

export interface ExplorerEditorModelState extends IEditorState {
    type: "fileExplorer";
    /** Root path for the file tree. */
    rootPath: string;
}

export function getDefaultExplorerEditorModelState(): ExplorerEditorModelState {
    return {
        ...getDefaultEditorModelState(),
        type: "fileExplorer",
        title: "Explorer",
        rootPath: "",
    } as ExplorerEditorModelState;
}

export class ExplorerEditorModel extends EditorModel<ExplorerEditorModelState> {
    /** File tree data source. Created lazily when rootPath is available. */
    treeProvider: ITreeProvider | null = null;

    /** Tree expansion state — persisted, restored from cache. */
    treeState: TreeProviderViewSavedState | undefined = undefined;

    /** Selection state — reactive. Explorer component subscribes for highlight. */
    readonly selectionState = new TOneState<NavigationState>({ selectedHref: null });

    /** Reveal request — reactive counter. When bumped, the component should call revealItem(selectedHref). */
    readonly revealVersion = new TOneState({ version: 0 });

    /** Search panel state. When defined, the search panel is visible. */
    searchState: FileSearchState | undefined = undefined;

    constructor(rootPath?: string) {
        super(new TComponentState(getDefaultExplorerEditorModelState()));
        this.noLanguage = true;
        this.skipSave = true;
        if (rootPath) {
            this.state.update((s) => { s.rootPath = rootPath; });
        }
    }

    get rootPath(): string {
        return this.state.get().rootPath;
    }

    // ── Selection ────────────────────────────────────────────────────

    setSelectedHref(href: string | null): void {
        this.selectionState.update((s) => { s.selectedHref = href; });
    }

    // ── Tree state ───────────────────────────────────────────────────

    setTreeState(state: TreeProviderViewSavedState): void {
        this.treeState = state;
    }

    // ── Search ───────────────────────────────────────────────────────

    openSearch(folder?: string): void {
        const rootPath = this.rootPath;
        const searchFolder = folder || rootPath;
        if (!this.searchState || (folder && this.searchState.searchFolder !== folder)) {
            this.searchState = {
                query: this.searchState?.query ?? "",
                includePattern: this.searchState?.includePattern ?? "",
                excludePattern: this.searchState?.excludePattern ?? "",
                showFilters: this.searchState?.showFilters ?? false,
                searchFolder,
                results: [],
                totalMatches: 0,
                totalFiles: 0,
            };
        }
        if (!this.secondaryEditor?.includes("search")) {
            this.secondaryEditor = ["explorer", "search"];
        }
        setTimeout(() => this.page?.expandPanel("search"), 0);
    }

    closeSearch(): void {
        this.searchState = undefined;
        if (this.secondaryEditor?.includes("search")) {
            this.secondaryEditor = ["explorer"];
        }
        setTimeout(() => this.page?.expandPanel("explorer"), 0);
    }

    setSearchState = (state: FileSearchState): void => {
        this.searchState = state;
    };

    // ── Root navigation ──────────────────────────────────────────────

    navigateUp(): void {
        const rootPath = this.rootPath;
        const parent = fpDirname(rootPath);
        if (parent === rootPath) return;
        this.treeState = undefined;
        this.state.update((s) => { s.rootPath = parent; });
    }

    makeRoot(newRoot: string): void {
        if (newRoot.toLowerCase() === this.rootPath.toLowerCase()) return;
        this.treeState = undefined;
        this.state.update((s) => { s.rootPath = newRoot; });
    }

    // ── Highlight + reveal ─────────────────────────────────────────

    /** Update selection and request reveal if the "explorer" panel is active. */
    private _selectAndReveal(href: string | null): void {
        this.selectionState.update((s) => { s.selectedHref = href; });
        if (href && this.page?.activePanel === "explorer") {
            this.revealVersion.update((s) => { s.version++; });
        }
    }

    // ── Lifecycle ────────────────────────────────────────────────────

    /** Explorer never navigates away — always survives as secondary. */
    beforeNavigateAway(_newModel: EditorModel): void {
        // No-op: Explorer always stays
    }

    /** React to main editor changes — highlight and reveal file if within root. */
    onMainEditorChanged(newMainEditor: EditorModel | null): void {
        if (!newMainEditor) {
            this._selectAndReveal(null);
            return;
        }
        const filePath = newMainEditor.state.get().filePath;
        if (filePath && filePath.toLowerCase().startsWith(this.rootPath.toLowerCase())) {
            this._selectAndReveal(filePath);
        } else {
            this._selectAndReveal(null);
        }
    }

    /** React to panel expansion — reveal current file when "explorer" panel becomes active. */
    onPanelExpanded(panelId: string): void {
        if (panelId === "explorer") {
            const href = this.selectionState.get().selectedHref;
            if (href) {
                setTimeout(() => this.revealVersion.update((s) => { s.version++; }), 0);
            }
        }
    }

    // ── Persistence ──────────────────────────────────────────────────

    getRestoreData(): Partial<ExplorerEditorModelState> {
        const data: any = { // eslint-disable-line @typescript-eslint/no-explicit-any
            ...super.getRestoreData(),
            rootPath: this.rootPath,
        };
        if (this.treeState) data._treeState = this.treeState;
        const selectedHref = this.selectionState.get().selectedHref;
        if (selectedHref) data._selectedHref = selectedHref;
        if (this.searchState) data._searchState = this.searchState;
        return data;
    }

    applyRestoreData(data: Partial<ExplorerEditorModelState>): void {
        super.applyRestoreData(data as any); // eslint-disable-line @typescript-eslint/no-explicit-any
        if (data.rootPath) {
            this.state.update((s) => { s.rootPath = data.rootPath!; });
        }
        const extra = data as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        if (extra._treeState) this.treeState = extra._treeState;
        if (extra._selectedHref) this.selectionState.set({ selectedHref: extra._selectedHref });
        if (extra._searchState) this.searchState = extra._searchState;
    }

    async restore(): Promise<void> {
        await super.restore();
        if (this.rootPath && this.page) {
            this.secondaryEditor = this.searchState
                ? ["explorer", "search"]
                : ["explorer"];
        }
    }

    setPage(page: import("../../api/pages/PageModel").PageModel | null): void {
        super.setPage(page);
        if (page && this.rootPath && !this.secondaryEditor?.length) {
            this.secondaryEditor = this.searchState
                ? ["explorer", "search"]
                : ["explorer"];
        }
    }

    async dispose(): Promise<void> {
        this.treeProvider?.dispose?.();
        this.treeProvider = null;
        await super.dispose();
    }
}
