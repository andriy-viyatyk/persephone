import { TComponentModel } from "../../core/state/model";
import { isTraited, Traited, TraitType } from "../../core/traits/traits";
import type { RenderGridModel, RerenderInfo, RowAlign } from "../DataGrid";
import { ContextMenuEvent } from "../../core/events/context-menu";
import {
    ITreeItem,
    TREE_ITEM_KEY,
    TreeProps,
    TreeRow,
} from "./types";
import { TreeDndModel } from "./TreeDndModel";
import { TreeKeyboardHandler } from "./TreeKeyboardHandler";
import { applyExpandedChanges, resolveExpandedValue } from "./tree-expansion-map";
import { createRepaintTracker } from "../shared/repaint-tracker";

// =============================================================================
// State
// =============================================================================

export interface TreeState {
    /**
     * Per-source-value expansion state for uncontrolled Trees. Controlled Trees derive from
     * `props.expanded` and leave this map untouched; uncontrolled rows fall back to
     * `defaultExpandedValues` and `defaultExpandAll` for keys not yet present here.
     */
    expanded: Record<string | number, boolean>;
    /** Source `value` of the row currently being dragged. Null when no drag in progress. */
    draggingValue: string | number | null;
    /** Source `value` of the row currently under the drag cursor. Null when none. */
    dragOverValue: string | number | null;
}

export const defaultTreeState: TreeState = {
    expanded: {},
    draggingValue: null,
    dragOverValue: null,
};

export interface TreeStateChange {
    rows: number[];
}

// =============================================================================
// Helpers
// =============================================================================

function runAccessor<R>(source: unknown, accessor: TraitType<R>): R {
    return Object.fromEntries(
        (Object.keys(accessor) as (keyof TraitType<R>)[]).map((k) => [k, accessor[k](source)]),
    ) as R;
}

/**
 * These groups cover inputs that can change emitted row content. Geometry such as `rowHeight`
 * belongs to the grid, while event-time callbacks such as `getContextMenu` do not repaint cells.
 * State-derived expansion and drag values reach cells through `mutate()` instead.
 */
const treeRowRepaintKeys = [
    "items", "getChildren", "getHasChildren", "defaultExpandAll", "defaultExpandedValues", "expanded",
] as const satisfies readonly (keyof TreeProps<unknown>)[];

const treeGlobalRepaintKeys = [
    "searchText", "indentSize", "isSelected", "getTooltip", "getName", "getSecondaryLabel",
    "getIconElement", "getHideChevron", "getTrailingVisibility", "renderTrailing", "trailingElement",
    "id", "traitTypeId", "getDragData", "acceptsDrop", "onDragStartOverride",
] as const satisfies readonly (keyof TreeProps<unknown>)[];

const treeLocalRepaintKeys = ["value", "activeIndex"] as const satisfies readonly (keyof TreeProps<unknown>)[];

interface TreePropUpdateResult {
    readonly repaint: RerenderInfo | undefined;
    readonly contentChanged: boolean;
}

// =============================================================================
// Model
// =============================================================================

export class TreeModel<T = ITreeItem> extends TComponentModel<
    TreeState,
    TreeProps<T>
> {
    // --- refs ---

    /**
     * The engine, used only for scrolling. Repaints are requested by `mutate()` and by the host
     * view's prop-update result, never from a state-write site directly.
     */
    gridRef: RenderGridModel | null = null;
    setGridRef = (ref: RenderGridModel | null) => {
        this.gridRef = ref;
    };
    focusRootRef: (() => void) | null = null;
    setFocusRootRef = (ref: (() => void) | null) => {
        this.focusRootRef = ref;
    };

    /**
     * Registered by the host view. Called after every state write, and the only thing that carries
     * a state change into the DOM — see `mutate`.
     */
    onStateApplied: ((change: TreeStateChange) => void) | null = null;

    /**
     * The only place in `uikit/Tree/` that writes state.
     *
     * A vanilla driver pumps props through the view's `update()`, so a state write reaches nothing
     * on its own: there is no re-render to re-evaluate anything. Every write therefore carries its
     * own consequence, and this is where it is carried.
     *
     * Do not call `this.state.update` anywhere else in this folder — `grep "state.update"
     * uikit/Tree/` must return exactly one hit, which is what makes the convention checkable.
     * Controlled expansion proposals go through `onExpandedChange`; the funnel also preserves the
     * existing expansion-map identity when other transient state changes are written.
     */
    private mutate(updater: (state: TreeState) => void, deriveRows = true): void {
        const current = this.state.get();
        const previousRows = this.rows;
        const next = {
            ...current,
            expanded: this.props.expanded === undefined
                ? { ...current.expanded }
                : current.expanded,
        };
        updater(next);
        if (deriveRows) this.deriveRows(next.expanded);
        const rows = [
            ...this.diffRows(previousRows, this.rows),
            ...this.transientRows(previousRows, this.rows, current, next),
        ];
        this.state.update(updater);
        this.onStateApplied?.({ rows: [...new Set(rows)] });
    }

    /** `TreeDndModel`'s narrow entry to the funnel, so it never touches `tree.state` directly. */
    mutateState = (updater: (state: TreeState) => void): void => {
        this.mutate(updater, false);
    };

    // Composed interaction models retain transient gesture state outside TreeState.
    readonly keyboard = new TreeKeyboardHandler(this);

    readonly dnd = new TreeDndModel(this);

    // --- ids ---
    private _elementId = "";
    /** Fed by the view from `nextElementId("tree")` — replaces the former generated-ID source. */
    setElementId = (elementId: string) => {
        this._elementId = elementId;
    };
    get rootId(): string {
        return this.props.id ?? this._elementId;
    }
    itemId = (rowIndex: number): string => {
        const row = this.rows[rowIndex];
        return row ? `${this.rootId}-item-${row.value}` : "";
    };

    // --- core derivations ---

    /**
     * Resolve a raw source (from items array OR `value` prop) to its ITreeItem shape via the
     * supplied trait accessor (or, when none, by treating the source as already shaped).
     */
    private resolveOne(
        source: T,
        accessor: TraitType<ITreeItem> | undefined,
    ): { item: ITreeItem; children: T[] | undefined } {
        const item = accessor
            ? runAccessor<ITreeItem>(source, accessor)
            : (source as unknown as ITreeItem);
        const children =
            this.props.getChildren?.(source) ?? (item.items as unknown as T[] | undefined);
        return { item, children };
    }

    /**
     * Resolve a single Traited<T> | T value (from the `value` prop). Selects the trait
     * accessor when the value is wrapped, falls back to the items-prop accessor when
     * passed plain.
     */
    private resolveSelectionValue(v: T | Traited<T>): ITreeItem {
        if (isTraited<T>(v)) {
            const acc = v.traits.get(TREE_ITEM_KEY);
            return acc
                ? runAccessor<ITreeItem>(v.target, acc)
                : (v.target as unknown as ITreeItem);
        }
        const itemsAccessor = this.itemsAccessor;
        return itemsAccessor
            ? runAccessor<ITreeItem>(v, itemsAccessor)
            : (v as unknown as ITreeItem);
    }

    /** Trait accessor for the items prop, or undefined when items is a plain array. */
    private get itemsAccessor(): TraitType<ITreeItem> | undefined {
        const items = this.props.items;
        if (!isTraited<unknown[]>(items)) return undefined;
        return items.traits.get(TREE_ITEM_KEY);
    }

    private readonly repaintTracker = createRepaintTracker<TreeProps<T>>({
        rows: treeRowRepaintKeys as readonly (keyof TreeProps<T>)[],
        global: treeGlobalRepaintKeys as readonly (keyof TreeProps<T>)[],
        local: treeLocalRepaintKeys as readonly (keyof TreeProps<T>)[],
    });
    private previousProps: TreeProps<T> | undefined;
    private propUpdateResult: TreePropUpdateResult | undefined;

    rows: TreeRow<T>[] = [];
    indexByValue = new Map<string | number, number>();
    selectedKey: string | number | null = null;

    setProps = (): void => {
        const previousProps = this.previousProps;
        const nextProps = this.props;
        const diff = this.repaintTracker.diff(previousProps, nextProps);
        this.previousProps = nextProps;

        if (!previousProps) {
            this.deriveRows(this.state.get().expanded);
            this.selectedKey = nextProps.value == null
                ? null
                : this.resolveSelectionValue(nextProps.value).value;
            this.propUpdateResult = undefined;
            return;
        }

        const previousRows = this.rows;
        const previousSelectedIndex = this.selectedRowIndex();
        const previousActiveIndex = previousProps.activeIndex;
        const rowsChanged = diff?.rows ?? false;
        const globalChanged = diff?.global ?? false;
        const selectionInputsChanged = previousProps.value !== nextProps.value
            || previousProps.items !== nextProps.items;
        const previousSelectedKey = this.selectedKey;

        if (rowsChanged) this.deriveRows(this.state.get().expanded);
        if (selectionInputsChanged) {
            this.selectedKey = nextProps.value == null
                ? null
                : this.resolveSelectionValue(nextProps.value).value;
        }

        const selectedKeyChanged = !Object.is(previousSelectedKey, this.selectedKey);
        const activeChanged = previousActiveIndex !== nextProps.activeIndex;
        const changedRows = rowsChanged ? this.diffRows(previousRows, this.rows) : [];
        let repaint: RerenderInfo | undefined;
        if (globalChanged) {
            repaint = { all: true };
        } else if (rowsChanged || selectedKeyChanged || activeChanged) {
            const rows = [...changedRows];
            if (selectedKeyChanged || activeChanged) {
                rows.push(
                    ...[
                        previousActiveIndex,
                        nextProps.activeIndex,
                        previousSelectedIndex,
                        this.selectedRowIndex(),
                    ].filter((row): row is number => row !== undefined && row !== null && row >= 0),
                );
            }
            repaint = { rows: [...new Set(rows)] };
        }
        this.propUpdateResult = { repaint, contentChanged: repaint !== undefined };
    };

    /** Consume the result produced synchronously by the latest prop pump. */
    takePropUpdateResult(): TreePropUpdateResult | undefined {
        const result = this.propUpdateResult;
        this.propUpdateResult = undefined;
        return result;
    }

    private diffRows(previous: TreeRow<T>[], next: TreeRow<T>[]): number[] {
        const limit = Math.max(previous.length, next.length);
        let firstChanged = -1;
        for (let index = 0; index < limit; index++) {
            const before = previous[index];
            const after = next[index];
            if (!before || !after || !this.sameRow(before, after)) {
                firstChanged = index;
                break;
            }
        }
        if (firstChanged < 0) return [];
        return Array.from(
            { length: Math.max(0, next.length - firstChanged) },
            (_, offset) => firstChanged + offset,
        );
    }

    private sameRow(previous: TreeRow<T>, next: TreeRow<T>): boolean {
        return previous.value === next.value
            && previous.level === next.level
            && previous.expanded === next.expanded
            && previous.hasChildren === next.hasChildren
            && previous.lazyChildren === next.lazyChildren
            && previous.item.label === next.item.label
            && previous.item.icon === next.item.icon
            && previous.item.section === next.item.section
            && previous.item.disabled === next.item.disabled;
    }

    private transientRows(
        previousRows: TreeRow<T>[],
        nextRows: TreeRow<T>[],
        previous: TreeState,
        next: TreeState,
    ): number[] {
        const changedValues = new Set<string | number>();
        for (const row of previousRows) {
            if ((previous.draggingValue === row.value) !== (next.draggingValue === row.value)
                || (previous.dragOverValue === row.value) !== (next.dragOverValue === row.value)) {
                changedValues.add(row.value);
            }
        }
        for (const row of nextRows) {
            if ((previous.draggingValue === row.value) !== (next.draggingValue === row.value)
                || (previous.dragOverValue === row.value) !== (next.dragOverValue === row.value)) {
                changedValues.add(row.value);
            }
        }
        return nextRows
            .map((row, index) => changedValues.has(row.value) ? index : -1)
            .filter((index) => index >= 0);
    }

    /** Derive the visible rows and its lookup together, before a state notification can run. */
    private deriveRows(stateExpanded: Readonly<Record<string | number, boolean>>): void {
        const items = this.props.items;
        const accessor = this.itemsAccessor;
        const sources = (isTraited<unknown[]>(items) ? items.target : items) as T[];
        const expanded = this.props.expanded;
        const rows: TreeRow<T>[] = [];
        const walk = (src: T, level: number) => {
            const { item, children } = this.resolveOne(src, accessor);
            const hasChildren = !!children && children.length > 0;
            const lazyChildren = !hasChildren && !!this.props.getHasChildren?.(src);
            const isExpanded = resolveExpandedValue(
                item.value,
                expanded,
                stateExpanded,
                this.props.defaultExpandedValues,
                !!this.props.defaultExpandAll,
            );
            rows.push({
                item,
                source: src,
                level,
                expanded: isExpanded,
                hasChildren,
                lazyChildren,
                value: item.value,
            });
            if (hasChildren && isExpanded && children) {
                for (const child of children) walk(child, level + 1);
            }
        };
        for (const src of sources) walk(src, 0);
        this.rows = rows;
        this.indexByValue = new Map(rows.map((row, index) => [row.value, index]));
    }

    // --- selection / interaction predicates ---

    isSelectedAt = (rowIndex: number): boolean => {
        const r = this.rows[rowIndex];
        if (!r || r.item.section) return false;
        if (this.props.isSelected) return this.props.isSelected(r.source, r.level);
        const key = this.selectedKey;
        return key != null && r.value === key;
    };

    isInteractive = (rowIndex: number): boolean => {
        const r = this.rows[rowIndex];
        return !!r && !r.item.section && !r.item.disabled;
    };

    /** Row index of the current selection, or -1. Keyboard fallback origin when no row
     *  is active (e.g. the mouse just left the tree). */
    selectedRowIndex = (): number => {
        const rows = this.rows;
        for (let i = 0; i < rows.length; i++) {
            if (this.isSelectedAt(i)) return i;
        }
        return -1;
    };

    findNextInteractive = (start: number, dir: 1 | -1): number => {
        const rows = this.rows;
        let i = start;
        while (i >= 0 && i < rows.length) {
            if (this.isInteractive(i)) return i;
            i += dir;
        }
        return -1;
    };

    // --- multi-selection ---

    /**
     * Indices of the rows currently selected, read through the consumer's selection (predicate or
     * `value` prop). O(visible rows), called once per gesture -- never per render.
     */
    private currentSelectionIndices = (): number[] => {
        const out: number[] = [];
        for (let i = 0; i < this.rows.length; i++) {
            if (this.isSelectedAt(i)) out.push(i);
        }
        return out;
    };

    /** De-dupe, drop non-interactive rows, sort into visible order, emit. */
    emitSelection = (indices: number[]) => {
        const handler = this.props.onSelectionChange;
        if (!handler) return;
        const unique = [...new Set(indices)]
            .filter((i) => this.isInteractive(i))
            .sort((a, b) => a - b);
        const rows = this.rows;
        handler(
            unique.map((i) => rows[i].source),
            unique.map((i) => rows[i].value),
        );
    };

    /** Inclusive index range between two rows, in either direction. */
    rangeIndices = (from: number, to: number): number[] => {
        const [lo, hi] = from <= to ? [from, to] : [to, from];
        const out: number[] = [];
        for (let i = lo; i <= hi; i++) out.push(i);
        return out;
    };

    findParentIndex = (rowIndex: number): number => {
        const rows = this.rows;
        const cur = rows[rowIndex];
        if (!cur || cur.level === 0) return -1;
        for (let i = rowIndex - 1; i >= 0; i--) {
            if (rows[i].level < cur.level) return i;
        }
        return -1;
    };

    // --- handlers ---

    /**
     * Row click. In single-select mode (the default) this is unchanged: fire `onChange`.
     *
     * In `multiSelect` mode the modifier decides. Shift is tested BEFORE Ctrl deliberately -- that
     * ordering is what makes Ctrl+Shift+click a range extend rather than needing a third rule; a
     * disjoint-range add is not a gesture we support.
     */
    onItemClick = (rowIndex: number, e?: MouseEvent) => {
        const r = this.rows[rowIndex];
        if (!r || r.item.disabled || r.item.section) return;

        if (!this.props.multiSelect) {
            this.props.onChange?.(r.source);
            return;
        }

        if (e?.shiftKey) {
            this.emitSelection(this.rangeIndices(this.keyboard.anchorIndex() ?? rowIndex, rowIndex));
            return; // anchor unchanged -- successive Shift+clicks pivot on the same row
        }
        if (e?.ctrlKey) {
            const current = this.currentSelectionIndices();
            const next = current.includes(rowIndex)
                ? current.filter((i) => i !== rowIndex)
                : [...current, rowIndex];
            this.keyboard.setAnchor(r.value);
            this.emitSelection(next);
            return;
        }
        this.keyboard.setAnchor(r.value);
        this.emitSelection([rowIndex]);
        this.props.onChange?.(r.source);
    };

    onItemDoubleClick = (rowIndex: number) => {
        const r = this.rows[rowIndex];
        if (!r || r.item.disabled || r.item.section) return;
        this.props.onItemDoubleClick?.(r.source, r.level);
    };

    onChevronClick = (e: MouseEvent, rowIndex: number) => {
        e.stopPropagation();
        this.toggleAt(rowIndex);
    };

    onItemMouseEnter = (rowIndex: number) => {
        if (!this.isInteractive(rowIndex)) return;
        if (rowIndex !== this.props.activeIndex) this.props.onActiveChange?.(rowIndex);
    };

    /** Clear the active highlight when the mouse leaves the tree container. */
    onRootMouseLeave = () => {
        if (this.props.activeIndex != null) this.props.onActiveChange?.(null);
    };

    onItemContextMenu = (e: MouseEvent, rowIndex: number) => {
        const r = this.rows[rowIndex];
        if (!r || r.item.section) return;

        // Right-click moves the selection to this row ONLY when the row is outside the current
        // selection. Right-clicking one of N selected rows must keep all N, so the menu it opens
        // can act on the whole set (Windows Explorer / VS Code behavior). No `onChange` -- a
        // right-click never navigates.
        if (this.props.multiSelect && this.isInteractive(rowIndex) && !this.isSelectedAt(rowIndex)) {
            this.keyboard.setAnchor(r.value);
            this.emitSelection([rowIndex]);
        }

        const items = this.props.getContextMenu?.(r.source, r.level);
        if (!items || items.length === 0) return;
        const ctxEvent = ContextMenuEvent.fromNativeEvent(e, "generic");
        ctxEvent.items.push(...items);
    };

    /**
     * Container-level context-menu handler. Skipped when a row already populated
     * `ContextMenuEvent.items` -- the row's menu wins.
     */
    onRootContextMenu = (e: MouseEvent) => {
        if (e.contextMenuEvent?.items.length) return;
        this.props.onContextMenu?.(e);
    };

    onKeyDown = this.keyboard.onKeyDown;

    // --- drag-and-drop compatibility delegates ---

    get isDndEnabled(): boolean {
        return this.dnd.isEnabled;
    }

    canDragRow = this.dnd.canDragRow;
    canDropRow = this.dnd.canDropRow;
    isDraggingAt = this.dnd.isDraggingAt;
    isDropTargetAt = this.dnd.isDropTargetAt;
    onDragStart = this.dnd.onDragStart;
    onDragEnd = this.dnd.onDragEnd;
    onDragEnter = this.dnd.onDragEnter;
    onDragOver = this.dnd.onDragOver;
    onDragLeave = this.dnd.onDragLeave;
    onDrop = this.dnd.onDrop;

    // --- imperative API ---

    toggleAt = (rowIndex: number) => {
        const r = this.rows[rowIndex];
        if (!r) return;
        if (!r.hasChildren && !r.lazyChildren) return;

        // Collapse guard -- e.g. a permanent chevron-less root that keyboard ArrowLeft
        // could otherwise collapse with no way to re-open it. Expansion never blocks.
        if (r.expanded && this.props.canCollapse && !this.props.canCollapse(r.source, r.level)) {
            return;
        }

        const next = !r.expanded;
        // Collapsing with `collapseDescendants`: close the whole subtree in the same state
        // write, so re-expanding this row reveals a fully-closed subtree.
        const descendants =
            !next && this.props.collapseDescendants
                ? this.collectDescendantValues(r.source)
                : null;
        // In uncontrolled mode, write before `onExpandChange` so a consumer that reads
        // `getExpandedMap()` from that callback sees the new map. Controlled mode proposes the
        // complete next map to its owner; the owner synchronously publishes new props.
        if (this.props.expanded !== undefined) {
            const changes: Record<string | number, boolean> = { [r.value]: next };
            if (descendants) for (const value of descendants) changes[value] = false;
            this.props.onExpandedChange?.(applyExpandedChanges(this.props.expanded, changes));
            this.props.onExpandChange?.(r.value, next);
        } else {
            this.mutate((s) => {
                s.expanded[r.value] = next;
                if (descendants) {
                    for (const v of descendants) s.expanded[v] = false;
                }
            });
            this.props.onExpandChange?.(r.value, next);
        }
    };

    /**
     * Every descendant `value` under `source`, excluding `source` itself. Walks the SOURCE
     * tree, so it reaches collapsed-but-loaded descendants; a lazy descendant with no loaded
     * children contributes only itself. Leaves are included -- writing `false` for a leaf is
     * harmless and clears any stale flag it picked up while it still had children.
     */
    private collectDescendantValues = (source: T): (string | number)[] => {
        const accessor = this.itemsAccessor;
        const values: (string | number)[] = [];
        const walk = (src: T) => {
            const { item, children } = this.resolveOne(src, accessor);
            values.push(item.value);
            if (children) for (const child of children) walk(child);
        };
        const { children } = this.resolveOne(source, accessor);
        if (children) for (const child of children) walk(child);
        return values;
    };

    expandItem = (value: string | number) => {
        const idx = this.indexByValue.get(value);
        if (idx == null) return;
        const r = this.rows[idx];
        if (!r || r.expanded) return;
        this.toggleAt(idx);
    };

    toggleItem = (value: string | number) => {
        const idx = this.indexByValue.get(value);
        if (idx != null) this.toggleAt(idx);
    };

    /**
     * Expand every node that currently has loaded children. Advertised but unloaded children
     * remain expandable through the ordinary row toggle and caller-owned loading callback.
     */
    expandAll = () => {
        const items = this.props.items;
        const accessor = this.itemsAccessor;
        const sources = (isTraited<unknown[]>(items) ? items.target : items) as T[];
        const map: Record<string | number, boolean> = {};
        const walk = (src: T) => {
            const { item, children } = this.resolveOne(src, accessor);
            if (children && children.length > 0) {
                map[item.value] = true;
                for (const child of children) walk(child);
            }
        };
        for (const src of sources) walk(src);

        // Walk the SOURCE tree (not the visible-rows view) so collapsed subtrees are also
        // proposed as expanded. Otherwise expandAll would only expand currently-visible nodes,
        // requiring multiple invocations to fully open the tree.
        if (this.props.expanded !== undefined) {
            this.props.onExpandedChange?.(applyExpandedChanges(this.props.expanded, map));
        } else {
            this.mutate((s) => {
                Object.assign(s.expanded, map);
            });
        }
    };

    collapseAll = () => {
        const items = this.props.items;
        const accessor = this.itemsAccessor;
        const sources = (isTraited<unknown[]>(items) ? items.target : items) as T[];
        const map: Record<string | number, boolean> = {};
        const walk = (src: T) => {
            const { item, children } = this.resolveOne(src, accessor);
            if (children && children.length > 0) {
                map[item.value] = false;
                for (const child of children) walk(child);
            }
        };
        for (const src of sources) walk(src);

        // Set expanded[value] = false for every node that has children, INCLUDING those
        // currently collapsed (so subsequent defaultExpandAll / hints don't re-expand them).
        if (this.props.expanded !== undefined) {
            this.props.onExpandedChange?.(applyExpandedChanges(this.props.expanded, map));
        } else {
            this.mutate((s) => {
                Object.assign(s.expanded, map);
            });
        }
    };

    getExpandedMap = (): Record<string | number, boolean> => {
        return { ...(this.props.expanded ?? this.state.get().expanded) };
    };

    scrollToItem = (value: string | number, align?: RowAlign) => {
        const idx = this.indexByValue.get(value);
        if (idx != null) this.gridRef?.scrollToRow(idx, align);
    };

    /** Focus the tree root through the callback installed by `TreeView`; no-op outside its view lifetime. */
    focusRoot = () => {
        this.focusRootRef?.();
    };

    /**
     * Walk the SOURCE tree to find the chain of ancestors of `target`. Returns the chain
     * in root-to-parent order (excluding the target itself), or null when the target
     * value is not present in the tree.
     */
    private findAncestorChain = (
        target: string | number,
    ): (string | number)[] | null => {
        const items = this.props.items;
        const accessor = this.itemsAccessor;
        const sources = (isTraited<unknown[]>(items) ? items.target : items) as T[];
        const path: (string | number)[] = [];

        const walk = (src: T): boolean => {
            const { item, children } = this.resolveOne(src, accessor);
            if (item.value === target) return true;
            if (children) {
                for (const child of children) {
                    if (walk(child)) {
                        path.unshift(item.value);
                        return true;
                    }
                }
            }
            return false;
        };

        for (const src of sources) {
            if (walk(src)) return path;
        }
        return null;
    };

    /**
     * Expand the loaded ancestor chain of `value`, then scroll the row into view. Unknown
     * values are ignored. Sync callers may ignore the returned promise.
     */
    revealItem = async (value: string | number, align?: RowAlign): Promise<void> => {
        // Fast path 1 -- already-visible value with all ancestors expanded: just scroll.
        const expandedNow = this.props.expanded ?? this.state.get().expanded;
        const chainNow = this.findAncestorChain(value);
        if (chainNow != null && chainNow.every((a) => expandedNow[a])) {
            const idx = this.indexByValue.get(value);
            if (idx != null) this.gridRef?.scrollToRow(idx, align ?? "nearest");
            return;
        }

        // Fast path 2 -- value loaded but some ancestors collapsed: synchronously propose
        // expansion to the controlled owner, then scroll after the resulting row update.
        if (chainNow != null) {
            await this.expandAncestorsThenScroll(chainNow, value, align);
            return;
        }

        return;
    };

    /**
     * Internal: ensure all ancestors in `chain` are expanded, then scroll to `value`.
     * Used by both fast paths in revealItem; collapses to one queued state update for
     * the "all already loaded" case, mirroring V1. In controlled mode the owner applies
     * the ancestor proposal synchronously before this method waits for row derivation.
     */
    private expandAncestorsThenScroll = async (
        chain: (string | number)[],
        value: string | number,
        align?: RowAlign,
    ): Promise<void> => {
        let expandedRows = false;
        if (chain.length > 0) {
            if (this.props.expanded !== undefined) {
                const changes: Record<string | number, boolean> = {};
                for (const ancestor of chain) {
                    if (!this.props.expanded[ancestor]) changes[ancestor] = true;
                }
                if (Object.keys(changes).length) {
                    this.props.onExpandedChange?.(applyExpandedChanges(this.props.expanded, changes));
                    expandedRows = true;
                }
            } else {
                const expanded = this.state.get().expanded;
                if (chain.some((ancestor) => !expanded[ancestor])) {
                    this.mutate((s) => {
                        for (const ancestor of chain) s.expanded[ancestor] = true;
                    });
                    expandedRows = true;
                }
            }
        }
        if (!this.isLive) return;
        const idx = this.indexByValue.get(value);
        if (idx == null) return;
        if (expandedRows) {
            // The row set just grew, so the scrollable extent is stale until the paint that
            // `mutate` scheduled writes it. `scrollTop` clamps to the current extent, so scrolling
            // now would land short with nothing re-issuing the request — the one deferral on this
            // path that was not a framework workaround. See `scrollToRowAfterPaint`.
            this.gridRef?.scrollToRowAfterPaint(idx, align ?? "nearest");
            return;
        }
        void this.gridRef?.scrollToRow(idx, align ?? "nearest");
    };

    // --- change detection ---

    // --- lifecycle ---

    /**
     * Prop changes are classified synchronously in `setProps()` and consumed by the host view.
     * State changes flow through `mutate()`; active-row scrolling is synchronized by the host
     * after the same prop pump, with the unmeasured case handled by the engine pending-scroll
     * register rather than a `setTimeout(0)` that could not test the actual condition.
     */
    dispose() {
        this.dnd.dispose();
    }
}
