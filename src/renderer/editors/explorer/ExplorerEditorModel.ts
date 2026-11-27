import { InternalEditorIds } from "../base/editor-ids";
import { TComponentState } from "../../core/state/state";
import { app } from "../../api/app";
import {
    EditorModel,
    type EditorStateBase,
    type RestoreData,
} from "../base/EditorModel";
import type { EditorDescriptor } from "../../../shared/persistence";
import type { ILink, ITreeProvider, ITreeProviderItem } from "../../api/types/io.tree";
import type { TreeProviderViewModel, TreeProviderViewSavedState } from "../../components/tree-provider/TreeProviderViewModel";
import type { FileSearchState } from "../../components/file-search";
import { createTreeProvider } from "../../content/tree-providers/tree-provider-factory";
import type { TreeProviderDescriptor } from "../../content/tree-providers/tree-provider-factory";
import { TREE_PROVIDER_HOST_TRAIT, TreeProviderHost } from "../base/tree-provider-host";
import type { IPageHost } from "../../api/pages/IPageHost";
import { fpIsInside, fpNormalizeForCompare } from "../../core/utils/file-path";
import { treeParentPath, sameTreePath } from "../../components/tree-provider/tree-provider-path";
import { isLocalFileProvider } from "../../content/tree-providers/tree-provider-capabilities";
import { createFolderIconElement } from "../../components/icons/icon-elements";
import { createLinkData } from "../../../shared/link-data";
import { hrefKey } from "../../components/tree-provider/href-utils";
import { untranslated } from "../../../shared/i18n/t";
import { ExplorerProviderRecovery } from "./ExplorerProviderRecovery";

export interface ExplorerEditorState extends EditorStateBase {
    /** Root path for the file tree. */
    rootPath: string;
    /** Factory descriptor for a provider-backed tree. */
    tree?: TreeProviderDescriptor;
    /** EX3 (c) — typed persistence extras replacing legacy `_treeState` /
     *  `_selectedHref` / `_searchState` underscore-prefixed keys. The
     *  underscore form is still read for backward compat in `applyRestoreData`
     *. */
    treeState?: TreeProviderViewSavedState;
    selectedHref?: string | null;
    searchState?: FileSearchState;
}

function stableValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(stableValue);
    if (value !== null && typeof value === "object") {
        return Object.fromEntries(Object.keys(value).sort().map(key => [
            key,
            stableValue((value as Record<string, unknown>)[key]),
        ]));
    }
    return value;
}

export function getDefaultExplorerEditorState(): ExplorerEditorState {
    return {
        id: crypto.randomUUID(),
        title: untranslated("Explorer"),
        modified: false,
        rootPath: "",
    };
}

export class ExplorerEditor extends EditorModel<ExplorerEditorState> {
    /** Editor identity. Deliberately equal to the secondary-view
     *  registration id so persistence (`EditorDescriptor.editorId`) reads the
     *  same string as the panel-component lookup. Explorer is NOT in
     *  `editorRegistry`. */
    readonly editorId = InternalEditorIds.explorer;
    readonly panelOrder = 0;
    readonly sidebarOptional = true;

    readonly treeProviderHost = new TreeProviderHost<ITreeProvider>();

    /** Tree expansion state — persisted via `ExplorerEditorState.treeState`. */
    treeState: TreeProviderViewSavedState | undefined = undefined;
    treeProviderViewModel: TreeProviderViewModel | undefined;
    private providerIdentityForCurrent = "";
    private providerRecovery: ExplorerProviderRecovery | undefined;

    get treeProvider(): ITreeProvider | null {
        return this.treeProviderHost.provider;
    }

    get selectionState() {
        return this.treeProviderHost.selectionState;
    }

    /** Search panel state. When defined, the search panel is visible. */
    searchState: FileSearchState | undefined = undefined;

    constructor(state: TComponentState<ExplorerEditorState>) {
        super(state);
        this.searchState = state.get().searchState;
        this.traits.add(TREE_PROVIDER_HOST_TRAIT, this.treeProviderHost);
        this.ensureTreeProvider();
        this.own(this.state.subscribe(
            () => this.ensureTreeProvider(),
            (state) => this.providerIdentity(state.tree, state.rootPath),
        ));
        this.own(this.selectionState.subscribe<string | null>(
            selectedHref => this.state.update(state => { state.selectedHref = selectedHref; }),
            selection => selection.selectedHref,
        ));
        this.own(() => this.providerRecovery?.dispose());
        this.noLanguage = true;
        this.skipSave = true;
        // Folder glyph for the "Explorer" sidebar panel — the same icon the
        // explorer tree shows for folders. Explorer is sidebar-only, so this
        // essentially only ever appears on the panel header, not a page tab.
        this.getIconElement = () => createFolderIconElement();
    }

    get rootPath(): string {
        const state = this.state.get();
        return state.tree?.rootPath ?? state.rootPath;
    }

    private providerIdentity(tree: TreeProviderDescriptor | undefined, rootPath: string): string {
        const descriptor = tree ?? (rootPath ? { type: "file", rootPath } : null);
        if (descriptor && typeof descriptor === "object") {
            return JSON.stringify(stableValue({ ...descriptor, config: descriptor.config ?? null }));
        }
        return JSON.stringify(descriptor);
    }

    private ensureTreeProvider(): void {
        const state = this.state.get();
        const descriptor = state.tree ?? (state.rootPath ? { type: "file", rootPath: state.rootPath } : undefined);
        const identity = descriptor ? this.providerIdentity(descriptor, state.rootPath) : "";
        if (this.providerIdentityForCurrent === identity) return;
        this.providerIdentityForCurrent = identity;
        this.treeProvider?.dispose?.();
        const provider = descriptor ? createTreeProvider(descriptor) : null;
        this.treeProviderHost.setProvider(provider);
        if (state.tree && !this.providerRecovery) {
            this.providerRecovery = new ExplorerProviderRecovery(() => {
                const currentProvider = this.treeProvider;
                if (!currentProvider || !this.state.get().tree) return;
                this.treeProviderViewModel?.buildTree();
                this.treeProviderHost.providerState.set(currentProvider);
            });
        } else if (!state.tree && this.providerRecovery) {
            this.providerRecovery.dispose();
            this.providerRecovery = undefined;
        }
        if (provider && !isLocalFileProvider(provider) && this.searchState) {
            this.searchState = undefined;
            this.state.update(current => { current.searchState = undefined; });
            this.secondaryView = this.composeSecondaryView();
        }
        this.treeProviderViewModel?.buildTree();
    }

    async listItems(): Promise<ILink[] | undefined> {
        if (!this.page || !this.treeProvider) return undefined;
        const items = await this.treeProvider.list(this.rootPath);
        return items.slice(0, 200).map(item => ({ ...item, tags: [...item.tags] }));
    }

    // ── Selection ────────────────────────────────────────────────────

    setSelectedHref(href: string | null): void {
        this.treeProviderHost.setSelected(href);
    }

    async openItem(item: ITreeProviderItem): Promise<void> {
        if (!this.page || !this.treeProvider) throw new Error("Explorer action unavailable: no provider is attached.");
        const current = this.selectionState.get().selectedHref;
        if (current && hrefKey(current) === hrefKey(item.href)) return;
        this.setSelectedHref(item.href);
        const url = this.treeProvider.getNavigationUrl(item);
        await app.events.openRawLink.sendAsync(createLinkData(url, {
            pageId: this.page.id,
            sourceId: "explorer",
        }));
    }

    revealItem(href: string): void {
        if (!this.page) throw new Error("Explorer reveal unavailable: no page host attached.");
        if (!this.secondaryView?.includes("explorer")) throw new Error("Explorer reveal unavailable: the Explorer panel is not present.");
        if (this.page.activePanelId !== "explorer") throw new Error("Explorer reveal unavailable: the Explorer panel is not active.");
        if (!this.treeProvider) throw new Error("Explorer reveal unavailable: no provider is attached.");
        if (!isLocalFileProvider(this.treeProvider)) {
            if (!this.treeProviderViewModel) throw new Error("Explorer tree is not mounted.");
            if (!this.treeProviderViewModel.hasLoadedHref(href)) {
                throw new Error(`Explorer item is not loaded: ${href}`);
            }
            this.setSelectedHref(href);
            void this.treeProviderViewModel.revealItem(href);
            return;
        }
        this.setSelectedHref(href);
        this.treeProviderHost.requestReveal(href);
    }

    expandPath(path: string): Promise<void> {
        if (!this.treeProviderViewModel) throw new Error("Explorer tree is not mounted.");
        return this.treeProviderViewModel.expandPath(path);
    }

    collapsePath(path: string): Promise<void> {
        if (!this.treeProviderViewModel) throw new Error("Explorer tree is not mounted.");
        return this.treeProviderViewModel.collapsePath(path);
    }

    // ── Tree state ───────────────────────────────────────────────────

    setTreeState(state: TreeProviderViewSavedState): void {
        this.treeState = state;
        this.state.update(current => { current.treeState = state; });
    }

    // ── Secondary-view composition ─────────────────────────────────────

    /** Explorer contributes Search after its tree when search state exists. */
    private composeSecondaryView(): string[] {
        const ids = ["explorer"];
        if (this.treeProvider && isLocalFileProvider(this.treeProvider) && this.searchState) ids.push("search");
        return ids;
    }

    // ── Search ───────────────────────────────────────────────────────

    openSearch(folder?: string): void {
        if (!this.treeProvider || !isLocalFileProvider(this.treeProvider)) {
            this.searchState = undefined;
            this.state.update(state => { state.searchState = undefined; });
            this.secondaryView = this.composeSecondaryView();
            throw new Error("Search is unavailable for this Explorer provider.");
        }
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
            this.state.update(state => { state.searchState = this.searchState; });
        }
        this.secondaryView = this.composeSecondaryView();
        this.page?.expandPanel("search");
    }

    closeSearch(): void {
        this.searchState = undefined;
        this.state.update(state => { state.searchState = undefined; });
        this.secondaryView = this.composeSecondaryView();
        this.page?.expandPanel("explorer");
    }

    setSearchState = (state: FileSearchState): void => {
        if (!this.treeProvider || !isLocalFileProvider(this.treeProvider)) {
            this.searchState = undefined;
            this.state.update(current => { current.searchState = undefined; });
            return;
        }
        this.searchState = state;
        this.state.update(current => { current.searchState = state; });
    };

    async openSearchResult(path: string, lineNumber?: number): Promise<void> {
        if (!this.treeProvider || !isLocalFileProvider(this.treeProvider)) {
            throw new Error("Search is unavailable for this Explorer provider.");
        }
        if (!this.page) throw new Error("Search action unavailable: no page host attached.");
        this.setSelectedHref(path);
        await app.events.openRawLink.sendAsync(createLinkData(path, {
            pageId: this.page.id,
            ...(lineNumber ? {
                revealLine: lineNumber,
                highlightText: this.searchState?.query,
            } : undefined),
        }));
    }

    // ── Boards ─────────────────────────────────────────────────────────

    // ── Root navigation ──────────────────────────────────────────────

    navigateUp(): void {
        const rootPath = this.rootPath;
        const provider = this.treeProvider;
        if (!provider?.navigable) return;
        const parent = treeParentPath(provider, rootPath);
        if (parent === rootPath) return;
        this.treeState = undefined;
        this.state.update((s) => {
            if (s.tree) s.tree.rootPath = parent;
            else s.rootPath = parent;
        });
    }

    makeRoot(newRoot: string): void {
        const provider = this.treeProvider;
        if (provider && !provider.navigable) return;
        if (provider
            ? sameTreePath(provider, newRoot, this.rootPath)
            : fpNormalizeForCompare(newRoot) === fpNormalizeForCompare(this.rootPath)) return;
        this.treeState = undefined;
        this.state.update((s) => {
            if (s.tree) s.tree.rootPath = newRoot;
            else s.rootPath = newRoot;
        });
    }

    // ── Highlight + reveal ─────────────────────────────────────────

    /** Update selection and request reveal if the "explorer" panel is active. */
    private _selectAndReveal(href: string | null): void {
        this.treeProviderHost.setSelected(href);
        if (href && this.page?.activePanelId === "explorer") {
            this.treeProviderHost.requestReveal(href);
        }
    }

    // ── Lifecycle hooks ───────────────────────────────────────────────

    /** Explorer ALWAYS survives navigation — it's a sidebar-only EditorModel.
     *  The base default clears `secondaryView` (which would trigger
     *  detach + dispose via the slice subscription); override to a no-op so
     *  Explorer stays attached when the main editor changes. */
    beforeNavigateAway(_newModel: EditorModel): void {
        // No-op: Explorer always stays.
    }

    /** React to main editor changes — highlight and reveal file if within root. */
    onMainEditorChanged(newMainEditor: EditorModel | null): void {
        if (!newMainEditor) {
            this._selectAndReveal(null);
            return;
        }
        if (this.treeProvider && !isLocalFileProvider(this.treeProvider)) {
            // A file opened from a board tree keeps its item href as the source link. Select it
            // without a reveal: a non-local tree can reveal only items it has already loaded.
            this.treeProviderHost.setSelected(newMainEditor.sourceLink?.href ?? null);
            return;
        }
        const filePath = newMainEditor.filePath;
        if (filePath && this.treeProvider && isLocalFileProvider(this.treeProvider)
            && fpIsInside(this.rootPath, filePath)) {
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
                this.treeProviderHost.requestReveal(href);
            }
        }
    }

    // ── Persistence ──────────────────────────────────────────────────

    getRestoreData(): EditorDescriptor {
        const s = this.state.get();
        return {
            editorId: this.editorId,
            id: s.id,
            state: {
                ...s,
                rootPath: this.rootPath,
                tree: s.tree,
                treeState: this.treeState,
                selectedHref: this.selectionState.get().selectedHref ?? undefined,
                searchState: this.searchState,
            } as unknown as Record<string, unknown>,
        };
    }

    applyRestoreData(data: RestoreData<ExplorerEditorState>): void {
        super.applyRestoreData(data);
        const extra = data as Partial<ExplorerEditorState> & {
            _treeState?: TreeProviderViewSavedState;
            _selectedHref?: string;
            _searchState?: FileSearchState;
        };
        this.state.update((s) => {
            if (data.tree) s.tree = data.tree;
            if (data.rootPath !== undefined) s.rootPath = data.rootPath;
        });
        // EX3 (c) — typed extras (new format).
        if (data.treeState) this.treeState = data.treeState;
        if (data.selectedHref !== undefined) {
            this.selectionState.set({ selectedHref: data.selectedHref ?? null });
        }
        if (data.searchState) this.searchState = data.searchState;
        if (extra._treeState && !data.treeState) this.treeState = extra._treeState;
        if (extra._selectedHref && data.selectedHref === undefined) {
            this.selectionState.set({ selectedHref: extra._selectedHref });
        }
        if (extra._searchState && !data.searchState) this.searchState = extra._searchState;
    }

    async restore(): Promise<void> {
        await super.restore();
        if (this.page && (this.state.get().tree || this.rootPath)) {
            this.secondaryView = this.composeSecondaryView();
        }
    }

    setPage(page: IPageHost | null): void {
        super.setPage(page);
        if (page && (this.state.get().tree || this.rootPath) && !this.secondaryView?.length) {
            this.secondaryView = this.composeSecondaryView();
        }
    }

    async dispose(): Promise<void> {
        const provider: ITreeProvider | null = this.treeProvider;
        provider?.dispose?.();
        this.treeProviderHost.dispose();
        await super.dispose();
    }
}
