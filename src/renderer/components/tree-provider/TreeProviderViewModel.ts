import type { SlotContent } from "../../uikit/shared/fill-slot";
import { TComponentModel } from "../../core/state/model";
import type { ITreeProvider, ITreeProviderItem, ILink } from "../../api/types/io.tree";
import type { ContextMenuEvent } from "../../api/events/events";
import { ui } from "../../api/ui";
import { t } from "../../../shared/i18n/t";
import { errMessage } from "../../../shared/utils";
import { fpBasename, fpDirname, fpIsAbsolute, fpNormalizeForCompare, fpResolve } from "../../core/utils/file-path";
import type { IFileLink } from "../../core/traits/fileLinkTraits";
import { pruneNestedItems } from "./plural-actions";
import {
    dropOsFilesInto as dropOsFilesIntoTarget,
    importFilesInto,
    moveItemsInto,
    type DropTarget,
} from "./tree-drop-actions";
import { ProviderItemController } from "./provider-item-controller";
import { hrefKey, sameHref, sameHrefs } from "./href-utils";
import type { SlotText } from "../../uikit/shared/slots";
import { findNode, findParent, type TreeProviderNode } from "./tree-provider-node";
import { computeDisplayTree, getExpandedPaths } from "./tree-search-filter";
import {
    isLocalFileProvider,
    isWatchable,
    type ClassifiedTreeWatchBatch,
} from "../../content/tree-providers/tree-provider-capabilities";
import { ProviderTreeExpansion } from "./provider-tree-expansion";
import { ProviderTreeStore } from "./provider-tree-store";

// =============================================================================
// Types
// =============================================================================

export interface TreeProviderViewSavedState {
    expandedPaths: string[];
    /** Last-clicked row (the primary selection). Kept for single-select consumers
     *  and for state persisted before multi-select existed. */
    selectedHref?: string;
    /** Full selection in flat visible order. Preferred over `selectedHref` on restore. */
    selectedHrefs?: string[];
}

export interface TreeProviderViewProps {
    provider: ITreeProvider;
    /** Show leaf items in tree (true) or directories only (false). Default: true */
    showLinks?: boolean;
    onItemClick?: (item: ITreeProviderItem) => void;
    onItemDoubleClick?: (item: ITreeProviderItem) => void;
    onFolderDoubleClick?: (item: ITreeProviderItem) => void;
    /** Called after generic + event channel menu items are added. Parent can add/modify items.
     *  `selection` is the pruned set the menu acts on — `[event.target]` for a single row, N items
     *  for a multi-selection containing the right-clicked row. Handlers that add singular actions
     *  (rename-like, navigate-like) should bail out when `selection.length > 1`. */
    onContextMenu?: (
        event: ContextMenuEvent<ITreeProviderItem>,
        selection: ITreeProviderItem[],
    ) => void;
    selectedHref?: string;
    initialState?: TreeProviderViewSavedState;
    onStateChange?: (state: TreeProviderViewSavedState) => void;
    refreshKey?: string | number;
    /** Optional per-row trailing content (right-aligned action slot). Receives the row's
     *  ITreeProviderItem; return null for rows without an action. */
    renderTrailing?: (item: ITreeProviderItem) => SlotContent;
    /** Optional per-row tooltip content. Falls back to the item's href. */
    getTooltip?: (item: ITreeProviderItem) => SlotText;
    /** Optional secondary content rendered beside the primary label. */
    getSecondaryLabel?: (item: ITreeProviderItem, level: number) => SlotContent;
    /** Override root node label. When omitted, uses provider.displayName. */
    rootLabel?: string;
    /** Allow Ctrl/Shift-click multi-selection and plural actions.
     *  Explorer-only for now — every other tree stays single-select. */
    multiSelect?: boolean;
}

export type TreeProviderViewModelProps = TreeProviderViewProps;

export interface TreeProviderViewState {
    tree: TreeProviderNode | null;
    displayTree: TreeProviderNode | null;
    searchText: string;
    searchVisible: boolean;
    /** Controlled expansion for the current display-tree projection. */
    expandedValues: Readonly<Record<string | number, boolean>>;
    error: string | null;
    /**
     * The tree's own selection (hrefs of the selected rows — files OR folders), in flat
     * visible order; the LAST entry is the primary (last-clicked) row. Single-select trees
     * simply never hold more than one. Synced FROM `props.selectedHref` when it changes to
     * a non-null value (main-editor navigation), but never cleared by a null — selection is
     * sticky, VS Code style. (`props.selectedHref` goes null right after a folder click
     * because the folder view carries no `filePath`; adopting that null was why folders
     * lost highlight.)
     */
    selectedValues: string[];
}

export const defaultTreeProviderViewState: TreeProviderViewState = {
    tree: null,
    displayTree: null,
    searchText: "",
    searchVisible: false,
    expandedValues: {},
    error: null,
    selectedValues: [],
};

// =============================================================================
// Model
// =============================================================================

export class TreeProviderViewModel extends TComponentModel<
    TreeProviderViewState,
    TreeProviderViewModelProps
> {
    private readonly expansion = new ProviderTreeExpansion();
    // Props are assigned after construction (`TComponentModel.setPropsInternal`), so the store
    // receives its provider in the first `setProps`, not here.
    private readonly store = new ProviderTreeStore(
        (node, provider) => this.getItemListPath(node.data, provider),
    );
    private revealRequest: ((href: string) => Promise<void>) | undefined;
    private watchSubscription?: () => void;
    private watchOwnerRegistered = false;
    private previousProvider: ITreeProvider | undefined;
    private previousShowLinks: boolean | undefined;
    private previousSelectedHref: string | undefined;
    private readonly itemController = new ProviderItemController({
        provider: () => this.props.provider,
        getItemPath: (item) => this.getItemListPath(item),
        refresh: () => this.buildTree(),
        getSelectedItems: () => this.selectedNodes.map((node) => node.data),
        isMultiSelect: () => !!this.props.multiSelect,
        setOutsideRightClickSelection: (item) => {
            if (!this.props.multiSelect) this.setSelection([item.href]);
        },
        clearSelection: () => this.setSelection([]),
        resolvePasteTarget: (item) => !item
            ? this.props.provider.rootPath
            : item.isDirectory
                ? this.getItemListPath(item)
                : item.category || this.props.provider.rootPath,
        resolveFileDirectory: (item) => item.category || this.props.provider.rootPath,
        resolveFolderDirectory: (item) => this.getItemListPath(item),
        isRoot: (item) => sameHref(item.href, this.props.provider.rootPath),
        canStartOsDrag: (item) => !!item.href && !sameHref(item.href, this.props.provider.rootPath),
        excludeRootFromDrag: true,
        onContextMenu: (event, selection) => this.props.onContextMenu?.(event, selection),
    });

    setProps = () => {
        const props = this.props;
        const previousProvider = this.previousProvider;
        const previousShowLinks = this.previousShowLinks;
        const previousSelectedHref = this.previousSelectedHref;
        const first = previousProvider === undefined;
        const providerChanged = !first && previousProvider !== props.provider;
        const showLinksChanged = previousShowLinks !== props.showLinks;
        const selectedHrefChanged = props.selectedHref !== previousSelectedHref;

        this.previousProvider = props.provider;
        this.previousShowLinks = props.showLinks;
        this.previousSelectedHref = props.selectedHref;

        if (first) {
            this.store.adoptProvider(props.provider);
            if (props.initialState?.expandedPaths?.length) {
                this.expansion.adoptExpandedPaths(props.initialState.expandedPaths);
            }
            // Restore the persisted plural selection when it is consistent with the incoming
            // `selectedHref` (the Explorer seeds that from its own navigation state, which on
            // restart is normally the primary row of the very same set). When navigation points
            // somewhere the restored set doesn't contain, navigation wins — it reflects what the
            // main editor is actually showing. Pre-epic state carries only `selectedHref` and so
            // restores as a one-item selection.
            const restored = props.initialState?.selectedHrefs;
            const seed = props.selectedHref ?? props.initialState?.selectedHref;
            if (restored?.length && (!seed || restored.some((h) => sameHref(h, seed)))) {
                this.adoptSelection(restored);
            } else if (seed) {
                this.adoptSelection([seed]);
            }
            this.initializeTree();
            this.subscribeWatch();
        } else if (providerChanged) {
            this.store.adoptProvider(props.provider);
            this.subscribeWatch();
            this.buildTree();
        } else if (showLinksChanged) {
            this.recomputeDisplayTree();
        }

        // Adopt an external selection change (main-editor navigation). A null
        // selectedHref never clears — see TreeProviderViewState.selectedValues.
        if (
            !first &&
            props.selectedHref &&
            selectedHrefChanged
        ) {
            this.adoptSelection([props.selectedHref]);
        }
    };

    /** External navigation always collapses the selection to the navigated item. */
    private adoptSelection = (hrefs: string[]) => {
        if (sameHrefs(this.state.get().selectedValues, hrefs)) return;
        this.state.update((s) => { s.selectedValues = hrefs; });
    };

    // ── Selection ────────────────────────────────────────────────────────

    /** Selected hrefs resolved to live nodes. Misses are dropped — a refresh can
     *  delete a file that is still in `selectedValues`. */
    get selectedNodes(): TreeProviderNode[] {
        const { tree, selectedValues } = this.state.get();
        if (!tree) return [];
        return selectedValues
            .map((href) => findNode(tree, href))
            .filter((n): n is TreeProviderNode => !!n);
    }

    /** The primary row — what paste targeting operates on when several rows are selected.
     *  The Tree emits selections in flat visible order, so with a multi-selection
     *  this is the bottom-most selected row rather than literally the last-clicked one.
     *  Exact for a single selection, which is the case that matters for Ctrl+V. */
    private primaryNode = (): TreeProviderNode | null => {
        const { tree, selectedValues } = this.state.get();
        if (!tree || !selectedValues.length) return null;
        return findNode(tree, selectedValues[selectedValues.length - 1]);
    };

    /** Nested-selection pruning — see `pruneNestedItems`, which both views share. */
    private operationItems = <T extends Pick<ILink, "href" | "isDirectory">>(items: T[]): T[] =>
        pruneNestedItems(items);

    /** Sink for the UIKit Tree's `onSelectionChange` (multiSelect mode). */
    setSelection = (hrefs: string[]) => {
        if (sameHrefs(this.state.get().selectedValues, hrefs)) return;
        this.state.update((s) => { s.selectedValues = hrefs; });
        this.props.onStateChange?.(this.getState());
    };

    private subscribeWatch = () => {
        if (!this.watchOwnerRegistered) {
            this.watchOwnerRegistered = true;
            this.own(() => this.watchSubscription?.());
        }
        this.watchSubscription?.();
        this.watchSubscription = undefined;
        const provider = this.props.provider;
        if (isWatchable(provider)) {
            const unsubscribe = provider.watch((batch) => this.queueWatchRefresh(batch));
            this.watchSubscription = unsubscribe;
        }
    };

    dispose = () => {
        this.store.dispose();
        this.watchSubscription?.();
        this.watchSubscription = undefined;
        // Release watch resources when the owner disposes this model.
    };

    private queueWatchRefresh = (batch?: ClassifiedTreeWatchBatch) => {
        const provider = this.props.provider;
        this.store.enqueueWatch(provider, async (operation, currentBatch) => {
            const original = this.store.snapshot;
            if (!original) { await this.buildTree(); return; }
            try {
                const result = await this.store.refreshWatchBatch(
                    original,
                    currentBatch,
                    () => operation.isCurrent() && this.store.snapshot === original,
                );
                if (!result) { await this.buildTree(); return; }
                if (result.shouldPublish) {
                    const next = result.tree;
                    const searchText = this.state.get().searchText;
                    const displayTree = computeDisplayTree(
                        next,
                        searchText,
                        this.props.showLinks !== false,
                        getExpandedPaths(this.expansion.normalExpansionRecord()),
                    );
                    const expandedValues = this.expansion.getDisplayExpansion(displayTree, searchText);
                    this.store.setSnapshot(next);
                    this.state.update(state => {
                        state.tree = next;
                        state.displayTree = displayTree;
                        state.expandedValues = expandedValues;
                        // Keep every selected href that still exists in the patched tree (watch paths
                        // compare with the filesystem key), as the pre-split watch patch did.
                        state.selectedValues = state.selectedValues.filter(href => !!findNode(
                            next,
                            fpNormalizeForCompare(href),
                            (nodeHref, target) => fpNormalizeForCompare(nodeHref) === target,
                        ));
                    });
                }
            } catch {
                await this.buildTree();
            }
        }, batch);
    };

    private initializeTree = async () => {
        // buildTree seeds the canonical map before publishing the first display tree, so its
        // projection already keeps the root open and can include restored-but-unloaded entries.
        await this.buildTree();

        // Pre-load children for restored expanded paths.
        if (this.props.initialState?.expandedPaths?.length) {
            await this.loadChildrenForPaths(this.props.initialState.expandedPaths);
        }
    };

    private publishExpansionChange = (pruneSelection = false): void => {
        this.expansion.invalidateProjection();
        const { displayTree, searchText } = this.state.get();
        const expandedValues = this.expansion.getDisplayExpansion(displayTree, searchText);
        const selectedValues = pruneSelection
            ? this.selectionVisibleValues()
            : this.state.get().selectedValues;
        this.state.update((state) => {
            state.expandedValues = expandedValues;
            state.selectedValues = selectedValues;
        });
        this.props.onStateChange?.(this.getState());
    };

    setRevealRequest = (request: ((href: string) => Promise<void>) | undefined): void => {
        this.revealRequest = request;
    };

    collapseAll = () => {
        const { displayTree, searchText } = this.state.get();
        this.expansion.collapseAll(this.props.provider.rootPath, displayTree, searchText);
        this.publishExpansionChange(true);
    };

    // ── Tree building ────────────────────────────────────────────────────

    buildTree = async () => {
        const operation = this.store.beginBuild();
        const { provider } = operation;

        // Read the canonical map, including restored paths whose nodes are not loaded yet. The
        // loaded Tree projection cannot represent those entries, but refresh must still reload
        // their descendants before publishing the rebuilt tree.
        const { displayTree, searchText } = this.state.get();
        const expandedPaths = this.expansion.expandedPaths(displayTree, searchText);

        try {
            const workingTree = await this.store.buildTree(expandedPaths, this.props.rootLabel, operation);
            if (!workingTree) return;
            this.expansion.seedTree(workingTree, provider.rootPath);

            const displayTree = computeDisplayTree(
                workingTree,
                searchText,
                this.props.showLinks !== false,
                getExpandedPaths(this.expansion.normalExpansionRecord()),
            );
            const expandedValues = this.expansion.getDisplayExpansion(displayTree, searchText);
            const visible = this.expansion.visibleHrefs(workingTree, searchText);

            this.store.setSnapshot(workingTree);
            this.state.update((s) => {
                s.tree = workingTree;
                s.displayTree = displayTree;
                s.expandedValues = expandedValues;
                s.selectedValues = s.selectedValues.filter((href) => visible.has(hrefKey(href)));
                s.error = null;
            });
        } catch (err) {
            if (!operation.isCurrent()) return;
            this.store.setSnapshot(null);
            const expandedValues = this.expansion.getDisplayExpansion(null, this.state.get().searchText);
            this.state.update((s) => {
                s.tree = null;
                s.displayTree = null;
                s.expandedValues = expandedValues;
                s.error = errMessage(err, "Failed to list directory");
            });
        }
    };

    private loadChildrenIfNeeded = async (href: string) => {
        const { tree } = this.state.get();
        const operation = this.store.currentOperation();
        const { provider, generation } = operation;
        if (!tree) return;

        const node = findNode(tree, href);
        if (!node || !node.data.isDirectory || node.items !== undefined) return;

        const newTree = await this.store.loadChildren(
            tree,
            [href],
            "load-unloaded",
            () => operation.isCurrent() && this.state.get().tree === tree,
        );
        if (!newTree) {
            if (!this.store.isProviderActive(provider)) return;
            if (!this.store.isGenerationCurrent(generation) || this.state.get().tree !== tree) {
                this.queueWatchRefresh();
            }
            return;
        }
        const { searchText } = this.state.get();
        const displayTree = computeDisplayTree(
            newTree,
            searchText,
            this.props.showLinks !== false,
            getExpandedPaths(this.expansion.normalExpansionRecord()),
        );
        const expandedValues = this.expansion.getDisplayExpansion(displayTree, searchText);
        this.store.setSnapshot(newTree);
        this.state.update((s) => {
            s.tree = newTree;
            s.displayTree = displayTree;
            s.expandedValues = expandedValues;
        });
    };

    // ── Lazy loading ─────────────────────────────────────────────────────

    private loadChildrenForPaths = async (paths: string[]) => {
        const { tree } = this.state.get();
        if (!tree) return;
        const original = tree;
        const operation = this.store.currentOperation();
        const { provider, generation } = operation;
        const next = await this.store.loadChildren(
            tree,
            paths,
            "load-unloaded",
            () => operation.isCurrent() && this.state.get().tree === original,
        );
        if (!next) {
            if (!this.store.isProviderActive(provider)) return;
            if (!this.store.isGenerationCurrent(generation) || this.state.get().tree !== original) {
                this.queueWatchRefresh();
            }
            return;
        }
        if (next === original) return;
        const { searchText } = this.state.get();
        const displayTree = computeDisplayTree(
            next,
            searchText,
            this.props.showLinks !== false,
            getExpandedPaths(this.expansion.normalExpansionRecord()),
        );
        const expandedValues = this.expansion.getDisplayExpansion(displayTree, searchText);
        this.store.setSnapshot(next);
        this.state.update((s) => {
            s.tree = next;
            s.displayTree = displayTree;
            s.expandedValues = expandedValues;
        });
    };

    /** Get the path to pass to provider.list() for a given node. */
    private getListPath = (node: TreeProviderNode): string => {
        return this.getItemListPath(node.data);
    };

    /** Path flavor expected by provider list/create/rename calls. Archive hrefs include the
     * archive prefix, so non-root items are rebuilt from category plus title. */
    private getItemListPath = (item: ITreeProviderItem, provider = this.props.provider): string => {
        if (sameHref(item.href, provider.rootPath)) {
            return provider.rootPath;
        }
        // For FileTreeProvider: href is the absolute path, use it directly
        // For ArchiveTreeProvider: href is "archive.zip!inner/path", we need inner path
        // The category of children = the directory path the provider understands
        // For root node, category is "" and we use provider.rootPath
        // For child directories, build the inner path from category + name
        const category = item.category;
        return category
            ? category + "/" + item.title
            : item.title;
    };

    // ── State persistence ────────────────────────────────────────────────

    getState = (): TreeProviderViewSavedState => {
        const expandedPaths = this.expansion.getSavedExpandedPaths();
        const selectedValues = this.state.get().selectedValues;
        return {
            expandedPaths,
            selectedHref: selectedValues.length
                ? selectedValues[selectedValues.length - 1]
                : this.props.selectedHref,
            selectedHrefs: selectedValues,
        };
    };

    onExpandedChange = (proposed: Readonly<Record<string | number, boolean>>): void => {
        const searchText = this.state.get().searchText;
        const currentProjection = this.expansion.getDisplayExpansion(
            this.state.get().displayTree,
            searchText,
        );
        const result = this.expansion.applyProposal(proposed, currentProjection, searchText);
        if (!result.changed) return;
        for (const href of result.expandedHrefs) this.loadChildrenIfNeeded(href);
        this.publishExpansionChange(result.collapsed);
    };

    // ── Visible-row selection pruning ────────────────────────────────────

    /** Resolve current visibility from the provider-owned normal map or the active deep-search
     *  collapsed-key set. The root remains open in both projections. */
    private selectionVisibleValues = (): string[] => {
        const { tree, searchText } = this.state.get();
        const visible = this.expansion.visibleHrefs(tree, searchText);
        return this.state.get().selectedValues.filter((href) => visible.has(hrefKey(href)));
    };

    // ── Search ───────────────────────────────────────────────────────────

    showSearch = () => {
        this.state.update((s) => { s.searchVisible = true; });
    };

    hideSearch = () => {
        const wasDeep = this.state.get().searchText.length >= 3;
        if (wasDeep) this.expansion.enterSearchBoundary(false);
        const displayTree = computeDisplayTree(
            this.state.get().tree,
            "",
            this.props.showLinks !== false,
            getExpandedPaths(this.expansion.normalExpansionRecord()),
        );
        const expandedValues = this.expansion.getDisplayExpansion(displayTree, "");
        this.state.update((s) => {
            s.searchText = "";
            s.searchVisible = false;
            s.displayTree = displayTree;
            s.expandedValues = expandedValues;
        });
        if (wasDeep) this.props.onStateChange?.(this.getState());
    };

    setSearchText = (text: string) => {
        const { searchText: prevText, tree } = this.state.get();
        const wasDeep = prevText.length >= 3;
        const isDeep = text.length >= 3;

        if (wasDeep !== isDeep) this.expansion.enterSearchBoundary(isDeep);

        const displayTree = computeDisplayTree(
            tree,
            text,
            this.props.showLinks !== false,
            getExpandedPaths(this.expansion.normalExpansionRecord()),
        );
        const expandedValues = this.expansion.getDisplayExpansion(displayTree, text);
        this.state.update((s) => {
            s.searchText = text;
            s.displayTree = displayTree;
            s.expandedValues = expandedValues;
        });
        if (wasDeep && !isDeep) this.props.onStateChange?.(this.getState());
    };

    /** Recompute displayTree from the current raw tree (e.g., after showLinks changes). */
    private recomputeDisplayTree = () => {
        const { tree, searchText } = this.state.get();
        const displayTree = computeDisplayTree(
            tree,
            searchText,
            this.props.showLinks !== false,
            getExpandedPaths(this.expansion.normalExpansionRecord()),
        );
        const expandedValues = this.expansion.getDisplayExpansion(displayTree, searchText);
        this.state.update((s) => {
            s.displayTree = displayTree;
            s.expandedValues = expandedValues;
        });
    };

    // ── Reveal item ───────────────────────────────────────────────────────

    /**
     * Expand ancestors, load children if needed, and scroll to make an item visible.
     * Uses provider.rootPath and path-based ancestor computation (works for FileTreeProvider).
     */
    revealItem = async (href: string) => {
        const { provider } = this.props;
        const { tree } = this.state.get();
        if (!tree) return;

        // Compute ancestor directory paths from href to rootPath.
        const rootLower = provider.rootPath.toLowerCase();
        const ancestors: string[] = [];
        let current = href;
        let parent = fpDirname(current);
        while (parent !== current && parent.toLowerCase() !== rootLower) {
            ancestors.unshift(parent);
            current = parent;
            parent = fpDirname(current);
        }

        // Load children for all ancestor paths (no-op for already loaded).
        const allPaths = [provider.rootPath, ...ancestors];
        await this.loadChildrenForPaths(allPaths);

        const changed = this.expansion.openPaths([provider.rootPath, ...ancestors]);
        if (changed) {
            this.publishExpansionChange();
        }
        // The controlled map is published synchronously before this one-way request so Tree's
        // reveal fast path sees the newly visible ancestors and only needs to scroll.
        await this.revealRequest?.(href);
    };

    /** Tree items are keyed by the provider's href, so an agent's "C:/a/b" must become "C:\a\b". */
    private toItemHref = (path: string): string => (fpIsAbsolute(path) ? fpResolve(path) : path);

    expandPath = async (path: string): Promise<void> => {
        const href = this.toItemHref(path);
        await this.revealItem(href);
        // revealItem loads the ancestors' children only; the folder's own children load here.
        await this.loadChildrenForPaths([href]);
        if (this.expansion.expandPath(href, this.state.get().searchText.length >= 3)) {
            this.publishExpansionChange();
        }
    };

    collapsePath = async (path: string): Promise<void> => {
        const href = this.toItemHref(path);
        await this.revealItem(href);
        const deep = this.state.get().searchText.length >= 3;
        if (this.expansion.collapsePath(href, this.state.get().tree, deep)) {
            this.publishExpansionChange(true);
        }
    };

    // ── Click handlers ───────────────────────────────────────────────────

    onItemClick = (node: TreeProviderNode) => {
        // In multiSelect mode the Tree's gesture path already published the new selection
        // through `setSelection` — writing it again here would fight the plural emit.
        if (!this.props.multiSelect) {
            this.setSelection([node.data.href]);
        }
        // Expansion is handled by the Tree's chevron and ArrowRight/ArrowLeft callbacks —
        // clicking the label selects + navigates without toggling.
        // Fire onItemClick for all items (files and folders).
        // Parent decides whether to navigate based on selection state.
        this.props.onItemClick?.(node.data);
    };

    onItemDoubleClick = (node: TreeProviderNode) => {
        if (node.data.isDirectory) {
            this.props.onFolderDoubleClick?.(node.data);
        } else {
            this.props.onItemDoubleClick?.(node.data);
        }
    };

    // ── Keyboard actions ─────────────────────────────────────────────────

    /**
     * Ctrl+C / Ctrl+X / Ctrl+V (OS file clipboard, file provider only), Delete
     * (confirm dialog), and F2 (rename dialog) on the selected row. Returns true
     * when the key was consumed. Wired from TreeProviderView's wrapper onKeyDown,
     * which sees keys bubbled from the Tree.
     */
    onTreeKeyDown = (e: KeyboardEvent): boolean => {
        // The search input (or any editable element) keeps native key behavior.
        if (ProviderItemController.isEditableTarget(e)) return false;

        const { provider } = this.props;
        const nodes = this.selectedNodes;
        const node = this.primaryNode();
        const hasRoot = nodes.some((n) => sameHref(n.data.href, provider.rootPath));
        const consume = () => {
            e.preventDefault();
            e.stopPropagation();
            return true;
        };

        // Delete → confirm dialog over the whole (pruned) selection; F2 → rename dialog, which
        // stays singular. Same gating as the context-menu items: writable provider capability,
        // never on the root.
        if (!e.ctrlKey && !e.altKey && !e.shiftKey && nodes.length && !hasRoot) {
            if (e.key === "Delete" && provider.writable && provider.deleteItem) {
                void this.itemController.deleteItems(nodes.map((selectedNode) => selectedNode.data));
                return consume();
            }
            if (
                e.key === "F2"
                && nodes.length === 1
                && node
                && provider.writable
                && provider.rename
            ) {
                void this.itemController.renameItem(node.data);
                return consume();
            }
        }

        // OS file clipboard actions — file provider only.
        if (!e.ctrlKey || e.altKey || e.shiftKey) return false;
        const key = e.key.toLowerCase();
        if (key !== "c" && key !== "x" && key !== "v") return false;
        if (!isLocalFileProvider(provider)) return false;

        if (key === "v") {
            // The primary row decides the target: folder → into it; file → its parent;
            // nothing selected → root.
            const targetDir = !node
                ? provider.rootPath
                : node.data.isDirectory
                    ? this.getListPath(node)
                    : (node.data.category || provider.rootPath);
            void this.itemController.paste(targetDir);
            return consume();
        }
        // Copy is allowed on the root (mirrors the context menu); Cut is not.
        if (!nodes.length) return false;
        if (hasRoot && key === "x") return false;
        const targets = this.operationItems(nodes.map((n) => n.data));
        void this.itemController.copyItemsToClipboard(targets, key === "x");
        return consume();
    };

    // ── Context menus ────────────────────────────────────────────────────

    onItemContextMenu = (node: TreeProviderNode, e: MouseEvent) =>
        this.itemController.onItemContextMenu(node.data, e);

    onBackgroundContextMenu = (e: MouseEvent) =>
        this.itemController.onBackgroundContextMenu(e);

    // ── Drag-drop ────────────────────────────────────────────────────────

    dragItemsFor = (node: TreeProviderNode): ITreeProviderItem[] => this.itemController.dragItemsFor(node.data);

    handleOsDragStart = (node: TreeProviderNode, event: DragEvent): boolean =>
        this.itemController.handleOsDragStart(node.data, event);
    // ── Drop targets ─────────────────────────────────────────────────────
    //
    // The tree's only tree-specific job in a drop is turning "where did this land" into a
    // target the shared actions understand. Two flavors, deliberately not unified — see
    // `DropTarget.path`:

    /** Move target: the provider's list path for the folder, plus its name for the confirm.
     *  Drop on a folder → into it; drop on a file → its parent folder. */
    private moveTargetFor = (node: TreeProviderNode): DropTarget | null => {
        const dir = node.data.isDirectory
            ? node
            : findParent(this.state.get().tree, node.data.href);
        if (!dir) return null;
        return { path: this.getListPath(dir), title: dir.data.title };
    };

    /** Import target: the category href written into. Drop on a folder → the folder itself;
     *  drop on a file → its parent category. */
    private importCategoryFor = (node: TreeProviderNode): string =>
        node.data.isDirectory
            ? node.data.href
            : (node.data.category || this.props.provider.rootPath);

    moveItems = async (sourceItems: ILink[], targetNode: TreeProviderNode) => {
        const target = this.moveTargetFor(targetNode);
        if (!target) return;
        if (await moveItemsInto(this.props.provider, sourceItems, target)) {
            await this.buildTree();
        }
    };

    /** Import dropped file-like items (IFileLink) into the drop target's folder. */
    importFiles = async (items: IFileLink[], dropNode: TreeProviderNode) => {
        const target = this.importCategoryFor(dropNode);
        if (await importFilesInto(this.props.provider, items, target)) {
            await this.buildTree();
        }
    };

    /** OS-file drop into a file-tree folder — Move / Copy choice, then a batch copy. File
     *  providers only; non-file providers route to `importFiles` (see TreeProviderView). */
    dropOsFilesInto = async (items: IFileLink[], dropNode: TreeProviderNode) => {
        const path = this.importCategoryFor(dropNode);
        const target: DropTarget = {
            path,
            title: dropNode.data.isDirectory ? dropNode.data.title : fpBasename(path),
        };
        if (await dropOsFilesIntoTarget(this.props.provider, items, target)) {
            await this.buildTree();
        }
    };

    /** Import links dragged from another collection into the drop target's category.
     *  Catalog providers only (those implementing `importLinks`). */
    importLinksTo = async (items: ILink[], dropNode: TreeProviderNode) => {
        const { provider } = this.props;
        if (!provider.importLinks || !items.length) return;

        const targetCategory = dropNode.data.isDirectory
            ? dropNode.data.href
            : (dropNode.data.category || provider.rootPath);

        try {
            await provider.importLinks(items, targetCategory);
        } catch (err) {
            ui.notify(errMessage(err, t("menus.failedToImportLinks")), "warning");
            return;
        }
        await this.buildTree();
    };
}
