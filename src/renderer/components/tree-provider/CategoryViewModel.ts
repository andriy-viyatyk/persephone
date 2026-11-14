import { TComponentModel } from "../../core/state/model";
import type { ITreeProvider, ITreeProviderItem } from "../../api/types/io.tree";
import { isLocalFileProvider, isWatchable } from "../../content/tree-providers/tree-provider-capabilities";
import {
    dropOsFilesInto,
    moveItemsInto,
    type DropTarget,
} from "./tree-drop-actions";
import { fpBasename } from "../../core/utils/file-path";
import {
    getTraitDragDataFromEvent,
    hasTraitDragData,
    isFileDrag,
} from "../../core/traits";
import { ProviderItemController } from "./provider-item-controller";
import { getTraitDropAction } from "./drop-dispatch";
import { DropTargetTracker } from "../../uikit/shared/drop-target-tracker";
import type { IMountableView } from "../../uikit/shared/vanilla-view";
import { sameHref, sameHrefs } from "./href-utils";
import type { GridModelCapability } from "../../uikit/DataGrid";
import { t } from "../../../shared/i18n/t";
import { matchesSearchWords } from "./tree-search-filter";

// =============================================================================
// Types
// =============================================================================

/** Display modes supported by CategoryView and its caller-provided item view. */
export type CategoryViewMode =
    | "list"
    | "tiles-landscape"
    | "tiles-landscape-big"
    | "tiles-portrait"
    | "tiles-portrait-big";

/** Typed projection and callbacks consumed by a Category item-view handle. */
export interface CategoryItemsViewProps {
    items: ITreeProviderItem[];
    viewMode: CategoryViewMode;
    selectedId?: string;
    selectedIds?: ReadonlySet<string>;
    searchText: string;
    onSelect: (item: ITreeProviderItem, event?: MouseEvent) => void;
    onDoubleClick: (item: ITreeProviderItem) => void;
    onEdit?: (item: ITreeProviderItem) => void;
    onDelete?: (item: ITreeProviderItem, skipConfirm: boolean) => void;
    onContextMenu: (e: MouseEvent, item: ITreeProviderItem) => void;
    onGridModel: (model: GridModelCapability | null) => void;
    onItemDragEnter?: (item: ITreeProviderItem, e: DragEvent) => void;
    onItemDragOver?: (item: ITreeProviderItem, e: DragEvent) => void;
    onItemDragLeave?: (item: ITreeProviderItem, e: DragEvent) => void;
    onItemDrop?: (item: ITreeProviderItem, e: DragEvent) => void;
    dropTargetId?: string | null;
    dragSourceId?: string;
    onDragStartOverride?: (item: ITreeProviderItem, event: DragEvent) => boolean;
}

export interface CategoryItemsViewHandle extends IMountableView {
    update(props: CategoryItemsViewProps): void;
}

export type CategoryItemsViewFactory = (
    host: HTMLElement,
    initialProps: CategoryItemsViewProps,
) => CategoryItemsViewHandle;

export interface CategoryViewProps {
    provider: ITreeProvider;
    /** Category path to display items for */
    category: string;
    /** Called when user clicks a non-directory item */
    onItemClick?: (item: ITreeProviderItem) => void;
    /** Called when user double-clicks a non-directory item */
    onItemDoubleClick?: (item: ITreeProviderItem) => void;
    /** Called when user clicks a directory item (navigate into) */
    onFolderClick?: (item: ITreeProviderItem) => void;
    /** Currently selected item href */
    selectedHref?: string;
    /** View mode. Default: "list" */
    viewMode?: CategoryViewMode;
    /** Called when view mode changes */
    onViewModeChange?: (mode: CategoryViewMode) => void;
    /** Caller-owned host for the Category search and view-mode controls. CategoryView appends and
     *  detaches its controls here; it does not own or remove the host element. */
    toolbarHost?: HTMLElement | null;
    /** Allow Ctrl/Shift-click multi-selection and plural actions. Passed only where a plural
     *  file operation is meaningful (`isLocalFileProvider`) — every other provider's folder
     *  page stays single-select. */
    multiSelect?: boolean;
    /** Caller-owned factory for the Link-style folder item view. */
    itemsView: CategoryItemsViewFactory;
}

export interface CategoryViewState {
    items: ITreeProviderItem[];
    filteredItems: ITreeProviderItem[];
    searchText: string;
    loading: boolean;
    error: string | null;
    /**
     * The view's own selection, as hrefs. Transient: cleared when the category or provider
     * changes, never persisted — a folder page is re-listed from scratch each time it opens.
     * `props.selectedHref` remains the *primary* item and is what the Explorer tree shares;
     * this set is local to the content view.
     */
    selectedHrefs: string[];
    /** href of the row/tile currently under a drag, or null. */
    dropTargetHref: string | null;
    /** True while a drag the view accepts is anywhere inside it. Paired with a null
     *  `dropTargetHref` this is the whitespace-drop highlight — "the open folder". */
    dropOverView: boolean;
}

export const defaultCategoryViewState: CategoryViewState = {
    items: [],
    filteredItems: [],
    searchText: "",
    loading: false,
    error: null,
    selectedHrefs: [],
    dropTargetHref: null,
    dropOverView: false,
};

// =============================================================================
// Model
// =============================================================================

export class CategoryViewModel extends TComponentModel<
    CategoryViewState,
    CategoryViewProps
> {
    private previousProvider: ITreeProvider | undefined;
    private previousCategory: string | undefined;
    private previousSelectedHref: string | undefined;
    private readonly itemController = new ProviderItemController({
        provider: () => this.props.provider,
        getItemPath: (item) => this.getItemListPath(item),
        refresh: () => this.loadItems(),
        getSelectedItems: () => this.selectionItems(),
        isMultiSelect: () => !!this.props.multiSelect,
        setOutsideRightClickSelection: (item) => {
            if (
                this.props.multiSelect
                && !this.state.get().selectedHrefs.some((href) => sameHref(href, item.href))
            ) {
                this.anchorHref = item.href;
                this.setSelection([item.href]);
            }
        },
        clearSelection: () => this.setSelection([]),
        resolvePasteTarget: () => this.props.category,
        resolveFileDirectory: () => this.props.category,
        resolveFolderDirectory: (item) => this.getItemListPath(item),
        isRoot: () => false,
        onOpenFolder: (item) => this.props.onFolderClick?.(item),
        canStartOsDrag: () => !!this.props.provider.writable,
        excludeRootFromDrag: false,
    });

    /** Shift+click / Shift-range anchor, held as an href rather than an index — the visible
     *  order changes with the search filter, which would silently move an index anchor.
     *  Transient on purpose: it must not trigger a render. */
    private anchorHref: string | null = null;

    /** Live-refresh subscription on the provider's optional `watch`. See `subscribeWatch`. */
    private watchSubscription?: () => void;
    private watchOwnerRegistered = false;

    setProps = () => {
        const props = this.props;
        const previousProvider = this.previousProvider;
        const previousCategory = this.previousCategory;
        const previousSelectedHref = this.previousSelectedHref;
        const { selectedHref, multiSelect } = props;
        const first = previousProvider === undefined;
        const providerChanged = first || previousProvider !== props.provider;
        const navigated = !first && (
            previousCategory !== props.category
            || previousProvider !== props.provider
        );
        // The primary item changed from the outside: first render, a new folder, or the
        // Explorer tree navigating. Ctrl/Shift gestures never trigger this — a plain click
        // sets the local set to exactly `[selectedHref]`, so the seed below finds it present
        // and leaves the set alone (which is what keeps Ctrl-deselecting the primary from
        // snapping it back).
        const seed = multiSelect
            && !!selectedHref
            && (first || navigated || previousSelectedHref !== selectedHref);

        this.previousProvider = props.provider;
        this.previousCategory = props.category;
        this.previousSelectedHref = selectedHref;

        if (!first && !navigated && !seed) return;

        // Prop pumping is explicit and synchronous; apply prop-derived model changes at this boundary.
        if (providerChanged) this.subscribeWatch();
        if (navigated) this.resetSelection();
        if (seed
            && selectedHref
            && !this.state.get().selectedHrefs.some((h) => sameHref(h, selectedHref))
        ) {
            this.anchorHref = selectedHref;
            this.setSelection([selectedHref]);
        }
        if (first || navigated) void this.loadItems();
    };

    // ── Data loading ─────────────────────────────────────────────────────

    /**
     * Subscribe to the provider's optional `watch` so the listing tracks changes made
     * anywhere else — the Explorer tree, another window, Windows Explorer, or an agent.
     * Without it the folder page keeps showing whatever `list` returned when it opened,
     * even though the tree beside it refreshes.
     *
     * `watch` is an opt-in provider capability rather than part of `ITreeProvider`, hence
     * the duck-typed check (same as the tree's). Providers that implement it: file (a
     * recursive `fs.watch`, debounced 500ms), mneme (`resources/list_changed`) and link
     * collections (the editor's `links` array identity). Archive providers have none, so
     * their folder pages behave exactly as before.
     *
     * Re-listing is cheap and never flashes: `loadItems` keeps the old items on screen
     * (the loading placeholder is gated on an empty listing) and re-validates the
     * selection against what still exists.
     */
    private subscribeWatch = () => {
        if (!this.watchOwnerRegistered) {
            this.watchOwnerRegistered = true;
            this.own(() => this.watchSubscription?.());
        }
        this.watchSubscription?.();
        this.watchSubscription = undefined;
        const provider = this.props.provider;
        if (isWatchable(provider)) {
            const unsubscribe = provider.watch(() => {
                // A debounced callback can still arrive after the page closed.
                if (this.isLive) void this.loadItems();
            });
            this.watchSubscription = unsubscribe;
        }
    };

    dispose = () => {
        this.watchSubscription?.();
        this.watchSubscription = undefined;
    };

    loadItems = async () => {
        this.state.update((s) => { s.loading = true; s.error = null; });

        try {
            const items = await this.props.provider.list(this.props.category);
            const { searchText, selectedHrefs } = this.state.get();
            const filteredItems = filterItems(items, searchText);
            // Drop anything that no longer exists — a file deleted here or removed
            // externally must not stay selected and be acted on by the next batch action.
            const kept = selectedHrefs.filter(
                (href) => items.some((i) => sameHref(i.href, href)),
            );

            this.state.update((s) => {
                s.items = items;
                s.filteredItems = filteredItems;
                s.loading = false;
                s.error = null;
                if (kept.length !== selectedHrefs.length) s.selectedHrefs = kept;
            });
        } catch (err: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
            this.state.update((s) => {
                s.items = [];
                s.filteredItems = [];
                s.loading = false;
                s.error = err.message || t("menus.failedToLoadItems");
            });
        }
    };

    // ── Selection ────────────────────────────────────────────────────────

    private resetSelection = () => {
        this.anchorHref = null;
        if (this.state.get().selectedHrefs.length) {
            this.state.update((s) => { s.selectedHrefs = []; });
        }
    };

    setSelection = (hrefs: string[]) => {
        if (sameHrefs(this.state.get().selectedHrefs, hrefs)) return;
        this.state.update((s) => { s.selectedHrefs = hrefs; });
    };

    /**
     * The items a plural action operates on: the selection intersected with what is currently
     * visible, in visible order. Rows hidden by the search filter never participate — the
     * content view's form of "only visible items can be acted on". Not pruned; each action
     * prunes at its own entry point.
     */
    selectionItems = (): ITreeProviderItem[] => {
        const { filteredItems, selectedHrefs } = this.state.get();
        return filteredItems.filter(
            (i) => selectedHrefs.some((href) => sameHref(href, i.href)),
        );
    };

    /** The anchor as an index into the visible items, or null when it no longer resolves
     *  (search changed, file deleted). Callers fall back to the clicked row. */
    private anchorIndex = (): number | null => {
        // Captured into a local so the closure below narrows without a `!` — TS cannot narrow
        // a mutable class property across a callback boundary.
        const anchor = this.anchorHref;
        if (!anchor) return null;
        const idx = this.state.get().filteredItems
            .findIndex((i) => sameHref(i.href, anchor));
        return idx < 0 ? null : idx;
    };

    // ── Search ───────────────────────────────────────────────────────────

    setSearchText = (text: string) => {
        const { items } = this.state.get();
        const filteredItems = filterItems(items, text);
        this.state.update((s) => {
            s.searchText = text;
            s.filteredItems = filteredItems;
        });
    };

    // ── Click handlers ───────────────────────────────────────────────────

    /**
     * Row / tile click. Single-select (the default) is unchanged: notify the parent, which
     * navigates.
     *
     * In `multiSelect` mode the modifier decides, and Shift is tested BEFORE Ctrl — that
     * ordering is what makes Ctrl+Shift+click a range extend rather than needing a third rule.
     * A Ctrl or Shift click builds the set only: it must not navigate, or a five-item selection
     * would open five tabs.
     *
     * `e` is optional because the row's own action buttons call this to mean "select this row"
     * without forwarding their own modifiers.
     */
    onItemClick = (item: ITreeProviderItem, e?: MouseEvent) => {
        if (!this.props.multiSelect) {
            this.props.onItemClick?.(item);
            return;
        }

        const { filteredItems, selectedHrefs } = this.state.get();
        const index = filteredItems.findIndex((i) => sameHref(i.href, item.href));
        if (index < 0) return;

        if (e?.shiftKey) {
            const from = this.anchorIndex() ?? index;
            const [lo, hi] = from <= index ? [from, index] : [index, from];
            this.setSelection(filteredItems.slice(lo, hi + 1).map((i) => i.href));
            return; // anchor unchanged — successive Shift+clicks pivot on the same row
        }
        if (e?.ctrlKey) {
            const isSelected = selectedHrefs.some((h) => sameHref(h, item.href));
            this.anchorHref = item.href;
            // Append rather than rebuild from the visible order: rebuilding would drop hrefs
            // hidden by the search filter, and they must survive so clearing the search brings
            // them back highlighted. Set order carries no meaning here — the primary item is
            // `props.selectedHref`, and `selectionItems()` re-derives visible order anyway.
            this.setSelection(
                isSelected
                    ? selectedHrefs.filter((h) => !sameHref(h, item.href))
                    : [...selectedHrefs, item.href],
            );
            return;
        }
        this.anchorHref = item.href;
        this.setSelection([item.href]);
        this.props.onItemClick?.(item);
    };

    /** Keys handled while the item grid has focus. No-op unless multiSelect is on, so
     *  single-select folder pages keep native behavior. */
    onKeyDown = (e: KeyboardEvent) => {
        if (!this.props.multiSelect) return;
        // The search input (or any editable element) keeps native key behavior.
        if (ProviderItemController.isEditableTarget(e)) return;

        const { provider } = this.props;

        if (e.ctrlKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "a") {
            e.preventDefault();
            this.setSelection(this.state.get().filteredItems.map((i) => i.href));
            return;
        }
        if (e.ctrlKey || e.altKey || e.shiftKey) return;

        if (e.key === "Delete" && provider.writable && provider.deleteItem) {
            const items = this.selectionItems();
            if (!items.length) return;
            e.preventDefault();
            void this.itemController.deleteItems(items);
            return;
        }
        if (e.key === "Escape") {
            const { selectedHref } = this.props;
            if (this.state.get().selectedHrefs.length <= 1) return;
            e.preventDefault();
            this.anchorHref = selectedHref ?? null;
            this.setSelection(selectedHref ? [selectedHref] : []);
        }
    };

    onItemDoubleClick = (item: ITreeProviderItem) => {
        if (item.isDirectory) {
            this.props.onFolderClick?.(item);
        } else {
            this.props.onItemDoubleClick?.(item);
        }
    };

    // ── Drag out  ────────────────────────────────────────────────

    /** Whether rows can be dragged out. Same gate as `acceptsDrops`: the drag-out path is a
     *  native OS file drag, which needs hrefs that are absolute local paths. */
    get allowsDrag(): boolean {
        const { provider } = this.props;
        return !!provider.writable && isLocalFileProvider(provider);
    }

    /**
     * The items a drag starting on `item` should carry: the whole selection when the row is part
     * of it, otherwise just that row — Windows Explorer behavior, where dragging an unselected
     * row does not silently carry the selection. Pruned, so a folder dragged together with items
     * inside it carries the folder only. Deliberately does NOT write the selection.
     */
    dragItemsFor = (item: ITreeProviderItem): ITreeProviderItem[] => this.itemController.dragItemsFor(item);

    /**
     * Replace the HTML5 drag with a native OS file drag. `webContents.startDrag` is the only
     * payload both Windows Explorer and Teams accept cleanly, and a native drag dropped back
     * inside a Persephone window re-enters as an ordinary OS file drop — so this one gesture
     * serves external and internal targets alike, with no modifier and no second code path.
     *
     * Returns false when there is nothing to drag, letting the caller fall back to the
     * in-process trait drag.
     */
    handleOsDragStart = (item: ITreeProviderItem, e: DragEvent): boolean =>
        this.itemController.handleOsDragStart(item, e);

    // ── Drop  ────────────────────────────────────────────────────
    //
    // Two kinds of target: a folder row/tile, and the view itself (whitespace, the
    // "Empty folder" placeholder, the gaps between tiles) which means the open folder.
    // A file row is the same target as whitespace — a file's parent IS the open folder.
    //
    // dragenter/dragleave are counted per target rather than tracked with a boolean: child
    // elements fire spurious dragleave as the pointer crosses them, so a boolean flickers.
    // Row events are NOT stopped, so the view's own counter stays positive for the whole
    // time the drag is inside it; the whitespace highlight is then "inside the view AND no
    // row targeted". Only `drop` stops propagation.

    // Keyed by the target's href, with `null` for the view itself. A `Map` takes `null` as a
    // key perfectly well, which is better than manufacturing an "impossible href" sentinel
    // string — there is no such thing, and the question of whether some path could collide
    // with it simply does not arise this way.
    private readonly dropTargetTracker = new DropTargetTracker<string | null>();

    /** Whether this view takes drops at all. Gated to the local file provider: the drop
     *  actions below are the file-move / file-import pair, and a catalog provider would need
     *  the `importLinks` branch the Explorer tree has. */
    get acceptsDrops(): boolean {
        const { provider } = this.props;
        return !!provider.writable && isLocalFileProvider(provider);
    }

    /**
     * Whether to accept the drag *at hover time*. Type-level only: `dataTransfer` will not
     * release its data during dragenter/dragover (Chrome's protected mode), so the payload —
     * and with it the folder-into-itself check — can only be inspected at drop time. Mirrors
     * `TreeModel.acceptsDrag`.
     */
    private acceptsDrag = (dataTransfer: DataTransfer): boolean => {
        if (!this.acceptsDrops) return false;
        if (hasTraitDragData(dataTransfer)) return true;
        return !!this.props.provider.importFiles && isFileDrag(dataTransfer);
    };

    /** The drag target's key: a folder row's href, or `null` for the view itself (whitespace,
     *  and any non-folder row — a file's parent IS the open folder). */
    private dropKey = (item: ITreeProviderItem | null): string | null =>
        item?.isDirectory ? item.href : null;

    private setDragState = (
        update: (s: CategoryViewState) => void,
    ) => {
        // Drag handlers run outside state dispatch; publish hover state immediately.
        this.state.update(update);
    };

    onDragEnter = (item: ITreeProviderItem | null, e: DragEvent) => {
        if (!this.acceptsDrag(e.dataTransfer)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = isFileDrag(e.dataTransfer) ? "copy" : "move";

        const key = this.dropKey(item);
        if (!this.dropTargetTracker.enter(key)) return;
        this.setDragState((s) => {
            if (key === null) s.dropOverView = true;
            else s.dropTargetHref = key;
        });
    };

    /** The target is irrelevant here — dragover exists only to keep re-asserting that the drop
     *  is allowed (the browser cancels it otherwise). The signature mirrors the others so the
     *  view can wire all four the same way. */
    onDragOver = (_item: ITreeProviderItem | null, e: DragEvent) => {
        if (!this.acceptsDrag(e.dataTransfer)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = isFileDrag(e.dataTransfer) ? "copy" : "move";
    };

    onDragLeave = (item: ITreeProviderItem | null, _e: DragEvent) => {
        const key = this.dropKey(item);
        if (!this.dropTargetTracker.leave(key)) return;
        this.setDragState((s) => {
            if (key === null) {
                s.dropOverView = false;
                // Leaving the view outright — no row can still be hovered.
                s.dropTargetHref = null;
            } else if (s.dropTargetHref === key) {
                s.dropTargetHref = null;
            }
        });
    };

    private clearDragState = () => {
        this.dropTargetTracker.clear();
        this.setDragState((s) => {
            s.dropTargetHref = null;
            s.dropOverView = false;
        });
    };

    /**
     * Handle a drop. `stopPropagation` is essential and applies to the whitespace case too:
     * `GlobalEventService` installs a bubble-phase fallback that opens dropped paths as tabs,
     * which is what a folder page did with dropped files before this existed.
     */
    onDrop = (item: ITreeProviderItem | null, e: DragEvent) => {
        if (!this.acceptsDrops) return;
        e.preventDefault();
        e.stopPropagation();
        this.clearDragState();

        const payload = getTraitDragDataFromEvent(e);
        if (!payload) return;
        if (!this.canDropOn(item, payload)) return;
        void this.performDrop(item, payload);
    };

    /** The directory a drop on `item` writes into, as an href — for the self-drop guards. */
    private dropDirHref = (item: ITreeProviderItem | null): string =>
        item?.isDirectory ? item.href : this.props.category;

    /** Where a drop on `item` lands. A folder targets itself; everything else (a file row,
     *  whitespace, the empty-folder placeholder) targets the open folder. */
    private dropTargetFor = (item: ITreeProviderItem | null): DropTarget => {
        // `href` rather than `getItemListPath` — drops are gated to the file provider, where the
        // href IS the absolute path the provider lists and `copyPathsInto` writes into. The
        // reconstructed list path (`category + "/" + title`) would work too but yields mixed
        // separators, and the tree's own drop paths use the href for the same reason.
        if (item?.isDirectory) {
            return { path: item.href, title: item.title };
        }
        const { category, provider } = this.props;
        return { path: category, title: fpBasename(category) || provider.displayName };
    };

    /** Drop-time acceptance, with the payload in hand. Ported from
     *  `TreeProviderView.canTraitDrop` with the tree node swapped for a drop target. */
    private canDropOn = (
        item: ITreeProviderItem | null,
        payload: import("../../core/traits").TraitDragPayload,
    ): boolean => {
        return !!getTraitDropAction(this.props.provider, this.dropDirHref(item), payload, false);

    };

    private performDrop = async (
        item: ITreeProviderItem | null,
        payload: import("../../core/traits").TraitDragPayload,
    ) => {
        const action = getTraitDropAction(
            this.props.provider,
            this.dropDirHref(item),
            payload,
            false,
        );
        if (!action) return;
        const target = this.dropTargetFor(item);

        let changed = false;
        if (action.kind === "move") {
            changed = await moveItemsInto(this.props.provider, action.items, target);
        } else if (action.kind === "import-files") {
            changed = await dropOsFilesInto(this.props.provider, action.files, target);
        }
        if (changed) await this.loadItems();
    };

    // ── Context menus ────────────────────────────────────────────────────

    onItemContextMenu = (item: ITreeProviderItem, event: MouseEvent) =>
        this.itemController.onItemContextMenu(item, event);

    onBackgroundContextMenu = (event: MouseEvent) =>
        this.itemController.onBackgroundContextMenu(event);

    renameItem = (item: ITreeProviderItem): Promise<void> => this.itemController.renameItem(item);

    deleteItemAction = (item: ITreeProviderItem): Promise<void> => this.itemController.deleteItem(item);

    private getItemListPath = (item: ITreeProviderItem): string => {
        return item.category ? item.category + "/" + item.title : item.title;
    };
}

// =============================================================================
// Pure utility functions
// =============================================================================

function filterItems(items: ITreeProviderItem[], searchText: string): ITreeProviderItem[] {
    if (!searchText) return items;
    const words = searchText.toLowerCase().split(" ").filter(Boolean);
    if (words.length === 0) return items;
    return items.filter((item) => matchesSearchWords(item.title, words));
}
