# US-485: UIKit Tree — virtualized expand/collapse tree primitive

## Goal

Add a **`Tree`** primitive to UIKit (`src/renderer/uikit/Tree/`) — the hierarchical, virtualized
counterpart to UIKit `ListBox` ([US-468](../US-468-uikit-listbox/README.md) +
[US-484](../US-484-uikit-listbox-extensions/README.md)). The component is the new home for the
behavior currently spread across `src/renderer/components/TreeView/TreeView.tsx`, but rebuilt
under the UIKit authoring rules:

- **Model-view architecture** ([Rule 8](../../../src/renderer/uikit/CLAUDE.md), see also the
  standard at [`/doc/standards/model-view-pattern.md`](../../standards/model-view-pattern.md))
  — `TreeModel` (logic, state, refs, handlers) + `Tree.tsx` (pure render).
- **Trait-based items** ([Rule 3](../../../src/renderer/uikit/CLAUDE.md)) — accept
  `T[] | Traited<T[]>` for the root items prop. Resolve via `TREE_ITEM_KEY`.
- **Data attributes for state** ([Rule 1](../../../src/renderer/uikit/CLAUDE.md)) —
  `data-type="tree"` on the root, `data-state="open"|"closed"` on each row, `data-selected`,
  `data-active`, `data-disabled` on items. No CSS-class state markers.
- **Roving tabindex** ([Rule 4](../../../src/renderer/uikit/CLAUDE.md)) — single Tab stop,
  ArrowUp/Down move focus, ArrowRight/Left expand/collapse, Enter selects.
- **Virtualization via `RenderGrid`** — same engine `ListBox` and the legacy `TreeView` use.
- **No drag-and-drop** and **no lazy children loading** in V1 — both deferred to a follow-up
  task (see Concern #1). V1 covers the static-tree use case and the four "extension" features
  matched to ListBox V2: per-row tooltip, per-row + container context menu, predicate
  selection, section rows.

After this task lands, three legacy consumers (`TreeProviderView`, `CategoryTree`,
`RestClientEditor.RequestTree`) can begin migrating to UIKit Tree in their respective
per-screen migration tasks. Those migrations are NOT part of US-485 — they happen in later
tasks (see Concern #2).

## Background

### Why this task exists

EPIC-025 Phase 4 builds out UIKit list/tree infrastructure. `Tree` is named in the
[US-438 naming table](../US-438-pattern-research/README.md) (`TreeView → Tree`) and has
been on the dashboard as a Phase 4 primitive. Three current consumers depend on
`components/TreeView/TreeView.tsx`:

| Consumer | Path | Role |
|----------|------|------|
| `TreeProviderView` | `src/renderer/components/tree-provider/TreeProviderView.tsx` | Generic file-system / archive / link-provider tree (used by sidebar, browser security panel, archive browser). Needs lazy loading + drag-drop. |
| `CategoryTree` | `src/renderer/components/TreeView/CategoryTree.tsx` (used by `NotebookEditor`) | Static category tree. Needs drag-drop. |
| `RestClientEditor` direct usage | `src/renderer/editors/rest-client/RestClientEditor.tsx` | Two-level tree (collections → requests). Static, no drag-drop, no lazy load. |

V1 of UIKit Tree targets the **static** subset (RestClientEditor) and the **search /
selection / context-menu / tooltip** subset (CategoryTree, minus drag-drop). Drag-drop and
lazy loading are V2, in a follow-up task — same playbook ListBox followed (US-468 V1 →
US-484 V2 extensions → US-479 sidebar migration).

### Why model-view from day one

`TreeView` already lives in a model-view-ish shape (`TreeView.model.ts` is a
`TComponentModel` subclass, `TreeView.tsx` is mostly render), but the model is dense
(~300 lines, mutates state via `set`/`setProps` callbacks with implicit ordering) and the
View still owns a `useState`/`useRef`/`useCallback` chain inside `TreeCell`. UIKit Tree
collapses both halves into the canonical `TreeModel` + thin View shape, matching ListBox
and the standard doc.

This is a from-scratch implementation, not a refactor of the legacy `TreeView` — the legacy
file stays in place as a behavioral reference until Phase 7 cleanup.

### How `Tree` differs from `ListBox`

`ListBox` is flat: `items: T[] | Traited<T[]>` resolves to `IListBoxItem[]`, RenderGrid
renders rows by index. Tree adds **structure**:

| Concern | ListBox | Tree |
|---------|---------|------|
| Items shape | flat array | one root array, each item may have children |
| Expansion state | n/a | per-node `expanded: boolean`, owned by model |
| Indentation | n/a | rendered per-row based on `level` |
| Keyboard nav | Up/Down/Home/End | Up/Down/Home/End **+** Right (expand or first child), Left (collapse or jump to parent) |
| Selection | identity vs predicate | identity vs predicate (same) |
| Tooltips / context menu / sections | optional | optional (same) |
| Virtualization | `RenderGrid` over `resolved[]` | `RenderGrid` over the *flattened visible-rows array* the model maintains |
| Trait shape | `TraitType<IListBoxItem>` | `TraitType<ITreeItem>` — same per-row attrs, plus `items` accessor for children |
| Children navigation | n/a | resolved by the trait OR by an explicit `getChildren?(t)` prop fallback when items are NOT traited (see Concern #5) |

The core data-flow concept matches: `model.resolved.value` is a memoized
`{ resolved: ITreeItem[][hierarchical], rows: TreeRow[], sources: T[] }` tuple. `rows` is
the flattened visible-rows array RenderGrid actually iterates over; it's recomputed when
items or expansion state changes.

### Files involved

| File | Role | Action |
|------|------|--------|
| `src/renderer/uikit/Tree/Tree.tsx` | View — pure render over `TreeModel` | **Create** |
| `src/renderer/uikit/Tree/TreeModel.ts` | Model — `TComponentModel<TreeState, TreeProps<T>>` subclass | **Create** |
| `src/renderer/uikit/Tree/TreeItem.tsx` | Default per-row renderer (icon + label + chevron + indent) | **Create** |
| `src/renderer/uikit/Tree/SectionItem.tsx` | Section-row renderer for `section: true` items | **Create** (~40 lines, mirrors `ListBox/SectionItem.tsx`) |
| `src/renderer/uikit/Tree/types.ts` | `ITreeItem`, `TREE_ITEM_KEY`, `TreeProps`, `TreeRef`, `TreeRow`, render-context type | **Create** |
| `src/renderer/uikit/Tree/index.ts` | Barrel export | **Create** |
| `src/renderer/uikit/Tree/Tree.story.tsx` | Storybook story | **Create** |
| [`src/renderer/uikit/index.ts`](../../../src/renderer/uikit/index.ts) | UIKit public exports | **Modify** — add Tree exports |
| [`doc/active-work.md`](../../active-work.md) | Dashboard | **Modify** — convert US-485 line to a link to this README |

### Files NOT changed

- `src/renderer/components/TreeView/*` — legacy stays in place as a behavioral reference.
  Removed during Phase 7 of EPIC-025 once all consumers migrate.
- `src/renderer/components/tree-provider/*` — migrated in a future per-screen task, not
  here.
- `src/renderer/editors/rest-client/RestClientEditor.tsx`, `notebook/NotebookEditor.tsx` —
  consumers migrated separately.
- `src/renderer/components/virtualization/RenderGrid/*` — used as-is.
- `src/renderer/uikit/Tooltip/Tooltip.tsx`, `src/renderer/uikit/Menu/*` — composed as-is.
- `src/renderer/api/events/events.ts` — `ContextMenuEvent` and `MenuItem` are imported, not
  modified.
- `src/renderer/uikit/CLAUDE.md` — no rule changes; the new component follows existing
  rules.

## Implementation plan

### Step 1 — `types.ts`

Path: `src/renderer/uikit/Tree/types.ts`. Public types and the trait key.

```ts
import React from "react";
import {
    TraitKey,
    Traited,
    TraitType,
} from "../../core/traits/traits";
import { RowAlign } from "../../components/virtualization/RenderGrid/types";
import type { MenuItem } from "../Menu";

// =============================================================================
// Item shape
// =============================================================================

export interface ITreeItem {
    /** Stable identifier — what `value` / `onChange` refer to. Unique within the whole tree. */
    value: string | number;
    /** Display label. Strings are eligible for `searchText` highlighting. */
    label: React.ReactNode;
    /** Leading icon (rendered between the chevron and the label). */
    icon?: React.ReactNode;
    /** Disables this item — no click, no selection styling, but children still render. */
    disabled?: boolean;
    /**
     * When true, the row renders as a non-interactive section header. Hover, click, active
     * highlight, selection styling, and keyboard navigation all skip the row. Section rows
     * MAY have children — they then act as ungrabbable group containers.
     */
    section?: boolean;
    /**
     * Children. When omitted or empty, the row has no chevron. When set, the chevron toggles
     * expansion. The model walks this field recursively via `getChildren` (see TreeProps).
     */
    items?: ITreeItem[];
}

export const TREE_ITEM_KEY = new TraitKey<TraitType<ITreeItem>>("tree-item");

// =============================================================================
// Render context (for custom renderItem)
// =============================================================================

export interface TreeItemRenderContext<T> {
    /** Resolved item shape (post-trait). */
    item: ITreeItem;
    /** Original source item (pre-trait). Equal to `item` when `T = ITreeItem`. */
    source: T;
    /** Depth — 0 for root rows, +1 per level. */
    level: number;
    /** True when this row is currently expanded. */
    expanded: boolean;
    /** True when the row has children (chevron should render). */
    hasChildren: boolean;
    /** Index inside the FLAT visible-rows array (what RenderGrid uses). */
    rowIndex: number;
    /** True when the row is the current selection (per `value` or `isSelected`). */
    selected: boolean;
    /** True when the row is the current `activeIndex`. */
    active: boolean;
    /** Stable DOM id — must be set on the rendered row when callers want `aria-activedescendant`. */
    id: string;
    /** Imperative API: toggle this row's expansion. */
    toggleExpanded: () => void;
}

// =============================================================================
// Imperative ref
// =============================================================================

export interface TreeRef {
    /** Scroll to make a row visible by its source `value`. Use `revealItem` first if the row may be collapsed. */
    scrollToItem: (value: string | number, align?: RowAlign) => void;
    /**
     * Expand every ancestor of `value`, then scroll the row into view. Synchronous over
     * already-loaded source data; async (lazy-load) variant lives in US-489.
     */
    revealItem: (value: string | number, align?: RowAlign) => void;
    /** Expand a single node. No-op when already expanded or not found. */
    expandItem: (value: string | number) => void;
    /** Toggle a single node by value. */
    toggleItem: (value: string | number) => void;
    /** Expand every node. */
    expandAll: () => void;
    /** Collapse every node. */
    collapseAll: () => void;
    /**
     * Snapshot of the current expansion state, keyed by the source `value`. Use to persist
     * across mounts. Pair with `defaultExpandedValues` to restore.
     */
    getExpandedMap: () => Record<string | number, boolean>;
}

// =============================================================================
// Props
// =============================================================================

export interface TreeProps<T = ITreeItem>
    extends Omit<React.HTMLAttributes<HTMLDivElement>, "style" | "className" | "onChange"> {
    /** Root items — when `T = ITreeItem`, children are read from `item.items`. */
    items: T[] | Traited<T[]>;
    /**
     * Override how the model walks to children. Defaults to `(it) => it.items` after the
     * per-row trait is applied. Provide this when `T` carries children under a different
     * field name (e.g. `node.children`).
     *
     * Receives the SOURCE item (pre-trait), not the resolved `ITreeItem`, so consumers can
     * type the accessor against their own shape.
     */
    getChildren?: (source: T) => T[] | undefined;

    /**
     * Currently-selected item. `null` when nothing is selected. May reference an item not
     * present in the tree — the selection styling simply doesn't render.
     *   • Plain `T` — used when `T = ITreeItem`. Reads `.value` directly.
     *   • `Traited<T>` — used with custom `T`. Reads accessor from `value.traits.get(TREE_ITEM_KEY)`.
     *
     * Ignored when `isSelected` is provided.
     */
    value?: T | Traited<T> | null;
    /** Fires when the user selects (clicks or hits Enter on) a row. Emits the source `T`. */
    onChange?: (item: T) => void;
    /**
     * Predicate that overrides `value`-based identity. When supplied, `value` is ignored.
     * Mirrors `ListBox.isSelected` (US-484). Single-select only — multi-select is out of
     * scope for V1 (see Concern #4).
     */
    isSelected?: (item: T, level: number) => boolean;

    /** Index of the highlighted row (across the flat visible list). Controlled. */
    activeIndex?: number | null;
    /** Fires when the active row changes — mouse hover or internal keyboard nav. */
    onActiveChange?: (index: number) => void;

    /** Plain-string label highlight passed to the default `<TreeItem>`. */
    searchText?: string;
    /**
     * Per-row tooltip. Returning `null`, `undefined`, `false`, or empty string suppresses the
     * tooltip on that row. Forwarded to the default `<TreeItem>` via the `tooltip` prop.
     * When a custom `renderItem` is supplied, the caller is responsible for wiring the
     * tooltip themselves — `getTooltip` is not invoked by `Tree` in that path.
     */
    getTooltip?: (item: T, level: number) => React.ReactNode;
    /**
     * Per-row context menu items. Returning `undefined` or an empty array suppresses the
     * menu for that row. Items dispatch via `ContextMenuEvent.fromNativeEvent(e, "generic")` —
     * they bubble to the global handler which renders the actual menu.
     */
    getContextMenu?: (item: T, level: number) => MenuItem[] | undefined;
    /**
     * Container-level context menu — invoked when the user right-clicks on the empty area of
     * the tree (no row hit, OR the row's `getContextMenu` returned nothing).
     */
    onContextMenu?: (e: React.MouseEvent<HTMLDivElement>) => void;

    /** Custom row renderer. Receives a context with the resolved item + flags. */
    renderItem?: (ctx: TreeItemRenderContext<T>) => React.ReactNode;

    /**
     * Initial expansion state when the component mounts. Keys are source `value`s; values
     * are booleans. Items not present in the map use `defaultExpandAll` (top-level rows
     * default to expanded under that flag). After mount the model owns the state — pass a
     * fresh map across remounts to restore.
     */
    defaultExpandedValues?: Record<string | number, boolean>;
    /** When true, every node is expanded on first build. Default: false. */
    defaultExpandAll?: boolean;
    /** Fires whenever a node's expansion changes. Use to persist across remounts. */
    onExpandChange?: (value: string | number, expanded: boolean) => void;

    /** Pixel height of each row. Default: 22. */
    rowHeight?: number;
    /** When set, the tree grows to fit content up to this max height. */
    growToHeight?: React.CSSProperties["height"];
    /** Top/bottom whitespace padding inside the scroll container. */
    whiteSpaceY?: number;

    /** Indentation step in pixels per `level`. Default: 16. */
    indentSize?: number;

    /** Replaces row rendering with a centered spinner. */
    loading?: boolean;
    /** Renders when the tree resolves to zero rows and not `loading`. */
    emptyMessage?: React.ReactNode;
    /** When true, the Tree handles ArrowUp/Down/Left/Right/Home/End/Enter on its root. Default: false. */
    keyboardNav?: boolean;
}

// =============================================================================
// Internal flat-row shape (exported for custom renderItem callers and tests)
// =============================================================================

export interface TreeRow<T = ITreeItem> {
    /** Resolved item shape. */
    item: ITreeItem;
    /** Source item. */
    source: T;
    /** Depth, root rows = 0. */
    level: number;
    /** True when the user has expanded this row. */
    expanded: boolean;
    /** True when the row has any children (chevron renders). */
    hasChildren: boolean;
    /** Source `value` — same as `item.value`, hoisted for fast lookups. */
    value: string | number;
}
```

### Step 2 — `TreeModel.ts`

Path: `src/renderer/uikit/Tree/TreeModel.ts`. The whole model.

```ts
import React from "react";
import { TComponentModel } from "../../core/state/model";
import { isTraited, resolveTraited, Traited, TraitType } from "../../core/traits/traits";
import RenderGridModel from "../../components/virtualization/RenderGrid/RenderGridModel";
import { RowAlign } from "../../components/virtualization/RenderGrid/types";
import { ContextMenuEvent } from "../../api/events/events";
import {
    ITreeItem,
    TREE_ITEM_KEY,
    TreeProps,
    TreeRow,
} from "./types";

// =============================================================================
// State
// =============================================================================

export interface TreeState {
    /**
     * Per-source-value expansion state. Bumped imperatively (not via React diff) so that
     * RenderGrid re-renders the cells via `model.gridRef?.update({ all: true })`.
     */
    expanded: Record<string | number, boolean>;
    /** Bumped to force the View to re-read derived data when needed. */
    revision: number;
}

export const defaultTreeState: TreeState = { expanded: {}, revision: 0 };

// =============================================================================
// Helpers
// =============================================================================

function runAccessor<R>(source: unknown, accessor: TraitType<R>): R {
    return Object.fromEntries(
        (Object.keys(accessor) as (keyof TraitType<R>)[]).map((k) => [k, accessor[k](source)]),
    ) as R;
}

// =============================================================================
// Model
// =============================================================================

export class TreeModel<T = ITreeItem> extends TComponentModel<
    TreeState,
    TreeProps<T>
> {
    // --- refs ---
    gridRef: RenderGridModel | null = null;
    setGridRef = (ref: RenderGridModel | null) => {
        this.gridRef = ref;
    };

    // --- ids ---
    private _reactId = "";
    setReactId = (reactId: string) => {
        this._reactId = reactId;
    };
    get rootId(): string {
        return this.props.id ?? `tree-${this._reactId}`;
    }
    itemId = (rowIndex: number): string => {
        const row = this.rows.value[rowIndex];
        return row ? `${this.rootId}-item-${row.value}` : "";
    };

    // --- core derivations ---

    /**
     * Resolve a raw T (from items array OR `value` prop) to its ITreeItem shape via traits.
     * Returns the resolved item AND the children sources array for further recursion.
     */
    private resolveOne(
        source: T | Traited<T>,
        traits: ReadonlyMap<symbol, TraitType<ITreeItem>> | null,
    ): { item: ITreeItem; children: T[] | undefined } {
        let target: T;
        let item: ITreeItem;
        if (isTraited<T>(source)) {
            target = source.target;
            const acc = source.traits.get(TREE_ITEM_KEY);
            item = acc ? runAccessor<ITreeItem>(target, acc) : (target as unknown as ITreeItem);
        } else if (traits) {
            target = source as T;
            const acc = traits.get(TREE_ITEM_KEY as unknown as symbol);
            item = acc ? runAccessor<ITreeItem>(target, acc) : (target as unknown as ITreeItem);
        } else {
            target = source as T;
            item = target as unknown as ITreeItem;
        }
        const children =
            this.props.getChildren?.(target) ?? (item.items as unknown as T[] | undefined);
        return { item, children };
    }

    /**
     * Memoized flat list of visible rows. Each render-relevant input (items prop, expansion
     * map) appears in the deps factory. RenderGrid iterates over rows.length.
     */
    rows = this.memo<TreeRow<T>[]>(
        () => {
            const items = this.props.items;
            const traits = isTraited<unknown[]>(items) ? items.traits : null;
            const sources = (isTraited<unknown[]>(items) ? items.target : items) as T[];
            const expanded = this.state.get().expanded;
            const expandAll = !!this.props.defaultExpandAll;

            const rows: TreeRow<T>[] = [];
            const walk = (src: T, level: number) => {
                const { item, children } = this.resolveOne(src, traits);
                const hasChildren = !!children && children.length > 0;
                // Expansion default per node:
                //  - explicit user toggle wins
                //  - otherwise defaultExpandedValues hint wins
                //  - otherwise defaultExpandAll
                const fromState = expanded[item.value];
                const fromHint = this.props.defaultExpandedValues?.[item.value];
                const isExpanded =
                    fromState !== undefined
                        ? fromState
                        : fromHint !== undefined
                            ? fromHint
                            : expandAll;
                rows.push({
                    item,
                    source: src,
                    level,
                    expanded: isExpanded,
                    hasChildren,
                    value: item.value,
                });
                if (hasChildren && isExpanded) {
                    for (const child of children!) walk(child, level + 1);
                }
            };
            for (const src of sources) walk(src, 0);
            return rows;
        },
        () => [
            this.props.items,
            this.props.getChildren,
            this.props.defaultExpandAll,
            this.props.defaultExpandedValues,
            this.state.get().expanded,
        ],
    );

    /** Lookup of source `value` → row index (for imperative expand/scroll/toggle). */
    indexByValue = this.memo<Map<string | number, number>>(
        () => {
            const map = new Map<string | number, number>();
            this.rows.value.forEach((r, i) => map.set(r.value, i));
            return map;
        },
        () => [this.rows.value],
    );

    /** Resolved selected `value` from `value` prop (only used when `isSelected` is absent). */
    selectedKey = this.memo<string | number | null>(
        () => {
            const v = this.props.value;
            if (v == null) return null;
            return this.resolveOne(v, null).item.value;
        },
        () => [this.props.value],
    );

    // --- selection / interaction predicates ---

    isSelectedAt = (rowIndex: number): boolean => {
        const r = this.rows.value[rowIndex];
        if (!r || r.item.section) return false;
        if (this.props.isSelected) return this.props.isSelected(r.source, r.level);
        const key = this.selectedKey.value;
        return key != null && r.value === key;
    };

    isInteractive = (rowIndex: number): boolean => {
        const r = this.rows.value[rowIndex];
        return !!r && !r.item.section && !r.item.disabled;
    };

    findNextInteractive = (start: number, dir: 1 | -1): number => {
        const rows = this.rows.value;
        let i = start;
        while (i >= 0 && i < rows.length) {
            if (this.isInteractive(i)) return i;
            i += dir;
        }
        return -1;
    };

    findParentIndex = (rowIndex: number): number => {
        const rows = this.rows.value;
        const cur = rows[rowIndex];
        if (!cur || cur.level === 0) return -1;
        for (let i = rowIndex - 1; i >= 0; i--) {
            if (rows[i].level < cur.level) return i;
        }
        return -1;
    };

    // --- handlers ---

    onItemClick = (rowIndex: number) => {
        const r = this.rows.value[rowIndex];
        if (!r || r.item.disabled || r.item.section) return;
        // Click selects; chevron click (separate handler below) toggles expansion.
        this.props.onChange?.(r.source);
    };

    onChevronClick = (e: React.MouseEvent, rowIndex: number) => {
        e.stopPropagation();
        this.toggleAt(rowIndex);
    };

    onItemMouseEnter = (rowIndex: number) => {
        if (!this.isInteractive(rowIndex)) return;
        if (rowIndex !== this.props.activeIndex) this.props.onActiveChange?.(rowIndex);
    };

    onItemContextMenu = (e: React.MouseEvent<HTMLDivElement>, rowIndex: number) => {
        const r = this.rows.value[rowIndex];
        if (!r || r.item.section) return;
        const items = this.props.getContextMenu?.(r.source, r.level);
        if (!items || items.length === 0) return;
        const ctxEvent = ContextMenuEvent.fromNativeEvent(e, "generic");
        ctxEvent.items.push(...items);
    };

    onRootContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
        if (e.nativeEvent.contextMenuEvent?.items.length) return;
        this.props.onContextMenu?.(e);
    };

    onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (!this.props.keyboardNav) return;
        const rows = this.rows.value;
        const n = rows.length;
        if (n === 0) return;
        const cur = this.props.activeIndex ?? -1;
        const apply = (target: number) => {
            if (target < 0) return;
            this.props.onActiveChange?.(target);
            this.gridRef?.scrollToRow(target);
        };
        switch (e.key) {
            case "ArrowDown":
                e.preventDefault();
                apply(this.findNextInteractive(Math.min(n - 1, cur + 1), 1));
                break;
            case "ArrowUp":
                e.preventDefault();
                apply(this.findNextInteractive(Math.max(0, cur - 1), -1));
                break;
            case "Home":
                e.preventDefault();
                apply(this.findNextInteractive(0, 1));
                break;
            case "End":
                e.preventDefault();
                apply(this.findNextInteractive(n - 1, -1));
                break;
            case "ArrowRight": {
                e.preventDefault();
                if (cur < 0) break;
                const r = rows[cur];
                if (!r) break;
                if (r.hasChildren && !r.expanded) {
                    this.toggleAt(cur);
                } else if (r.hasChildren && r.expanded) {
                    // Move to first child (which is cur + 1 by construction of the flat list).
                    apply(this.findNextInteractive(cur + 1, 1));
                }
                break;
            }
            case "ArrowLeft": {
                e.preventDefault();
                if (cur < 0) break;
                const r = rows[cur];
                if (!r) break;
                if (r.hasChildren && r.expanded) {
                    this.toggleAt(cur);
                } else {
                    apply(this.findParentIndex(cur));
                }
                break;
            }
            case "Enter":
                if (cur >= 0) {
                    e.preventDefault();
                    this.onItemClick(cur);
                }
                break;
        }
    };

    // --- imperative API ---

    toggleAt = (rowIndex: number) => {
        const r = this.rows.value[rowIndex];
        if (!r || !r.hasChildren) return;
        const next = !r.expanded;
        this.state.update((s) => {
            s.expanded[r.value] = next;
        });
        this.props.onExpandChange?.(r.value, next);
        this.gridRef?.update({ all: true });
    };

    expandItem = (value: string | number) => {
        const idx = this.indexByValue.value.get(value);
        if (idx == null) return;
        const r = this.rows.value[idx];
        if (!r || r.expanded) return;
        this.toggleAt(idx);
    };

    toggleItem = (value: string | number) => {
        const idx = this.indexByValue.value.get(value);
        if (idx != null) this.toggleAt(idx);
    };

    expandAll = () => {
        const map: Record<string | number, boolean> = {};
        const walk = (rows: TreeRow<T>[]) => {
            for (const r of rows) {
                if (r.hasChildren) map[r.value] = true;
            }
        };
        // Walk via a one-shot pass over the materialized rows (only currently-visible
        // ancestors are present, but expanding visible ancestors will reveal the rest;
        // we run the pass in a loop until stable).
        let prev = -1;
        while (this.rows.value.length !== prev) {
            prev = this.rows.value.length;
            walk(this.rows.value);
            this.state.update((s) => {
                Object.assign(s.expanded, map);
            });
        }
        this.gridRef?.update({ all: true });
    };

    collapseAll = () => {
        this.state.update((s) => {
            for (const k of Object.keys(s.expanded)) s.expanded[k] = false;
        });
        this.gridRef?.update({ all: true });
    };

    getExpandedMap = (): Record<string | number, boolean> => {
        return { ...this.state.get().expanded };
    };

    scrollToItem = (value: string | number, align?: RowAlign) => {
        const idx = this.indexByValue.value.get(value);
        if (idx != null) this.gridRef?.scrollToRow(idx, align);
    };

    // --- lifecycle ---

    init() {
        // Force RenderGrid to re-render cells when display inputs change.
        this.effect(
            () => {
                this.gridRef?.update({ all: true });
            },
            () => [
                this.rows.value,
                this.selectedKey.value,
                this.props.activeIndex,
                this.props.searchText,
                this.props.renderItem,
                this.props.rowHeight,
                this.props.indentSize,
                this.props.isSelected,
                this.props.getTooltip,
                this.props.getContextMenu,
            ],
        );

        // Keep active row visible when activeIndex changes externally — same pattern as
        // ListBoxModel (see ListBoxModel.ts:253-271 for the timing rationale).
        this.effect(
            () => {
                const ai = this.props.activeIndex;
                if (ai == null || ai < 0) return;
                const grid = this.gridRef;
                if (!grid) return;
                const measured = !!(grid.size.width && grid.size.height);
                if (measured) {
                    grid.scrollToRow(ai);
                } else {
                    setTimeout(() => {
                        if (!this.isLive) return;
                        this.gridRef?.scrollToRow(ai);
                    }, 0);
                }
            },
            () => [this.props.activeIndex],
        );
    }
}
```

### Step 3 — `TreeItem.tsx` (default per-row renderer)

Path: `src/renderer/uikit/Tree/TreeItem.tsx`. ~120 lines.

Key responsibilities:
- Render indent strips (one `<div className="level">` per level, like the legacy
  `TreeView.tsx:208-212`).
- Render chevron when `hasChildren` (Down when expanded, Right when collapsed; empty stub
  when no children — keeps alignment).
- Render icon + highlighted label.
- Apply `data-type="tree-item"`, `data-state`, `data-selected`, `data-active`,
  `data-disabled`.
- Wrap row in UIKit `<Tooltip>` when `tooltip` truthy (mirrors `ListItem.tsx:111-112`).
- `forwardRef` on the row element.

Public props:

```ts
export interface TreeItemProps
    extends Omit<React.HTMLAttributes<HTMLDivElement>, "style" | "className"> {
    id?: string;
    level: number;
    expanded: boolean;
    hasChildren: boolean;
    icon?: React.ReactNode;
    label: React.ReactNode;
    searchText?: string;
    selected?: boolean;
    active?: boolean;
    disabled?: boolean;
    tooltip?: React.ReactNode;
    indentSize?: number; // default 16
    /** Called when the user clicks the chevron. The component does NOT toggle on its own —
     *  the model owns expansion state. Pass `model.onChevronClick(e, idx)` from the View. */
    onChevronClick?: (e: React.MouseEvent) => void;
}
```

DOM shape:

```tsx
<Root
    ref={ref}
    id={id}
    data-type="tree-item"
    data-state={expanded ? "open" : "closed"}
    data-selected={selected || undefined}
    data-active={active || undefined}
    data-disabled={disabled || undefined}
    role="treeitem"
    aria-selected={selected ? "true" : "false"}
    aria-expanded={hasChildren ? expanded : undefined}
    aria-level={level + 1}
    aria-disabled={disabled ? "true" : undefined}
    {...rest}
>
    {Array.from({ length: level }).map((_, i) => <Indent key={i} />)}
    {hasChildren ? (
        <Chevron onClick={onChevronClick}>
            {expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
        </Chevron>
    ) : (
        <ChevronStub />
    )}
    {icon}
    <span className="label">{labelNode}</span>
</Root>
```

Use `color.text.default` / `color.background.selection` / `color.background.message` /
`color.border.light` / `color.icon.dark` from `theme/color.ts`. All sizing via tokens
(`gap`, `height`, `spacing`).

The default styling must match the legacy `TreeView` look closely enough that side-by-side
visual diff in Storybook does not surface regressions. Key visual rules:

- Indent strip: `width: indentSize`, `border-left: 1px solid color.border.light`, except
  level 0 (no border).
- Chevron: `width: indentSize`, no border, hover background.
- `&[data-selected] { background: color.background.light; }`
- `&[data-active]:not([data-selected]) { background: color.background.message; }`

(Visual parity is a smoke-test gate, not a bit-for-bit match.)

### Step 4 — `SectionItem.tsx`

Path: `src/renderer/uikit/Tree/SectionItem.tsx`. Mirrors
`src/renderer/uikit/ListBox/SectionItem.tsx` but accepts a `level` prop for indentation.

```tsx
export interface SectionItemProps
    extends Omit<React.HTMLAttributes<HTMLDivElement>, "style" | "className"> {
    id?: string;
    level: number;
    label: React.ReactNode;
    indentSize?: number;
}
```

`role="presentation"`, `data-type="tree-section"`. Indent strips render the same way as in
`TreeItem`, but no chevron, icon, hover, or click. Centered, dim label
(`color.text.light`).

### Step 5 — `Tree.tsx` (View)

Path: `src/renderer/uikit/Tree/Tree.tsx`. Pure render over `TreeModel`.

```tsx
import React, { forwardRef, useCallback, useId, useImperativeHandle } from "react";
import styled from "@emotion/styled";
import color from "../../theme/color";
import { spacing } from "../tokens";
import { useComponentModel } from "../../core/state/model";
import RenderGrid from "../../components/virtualization/RenderGrid/RenderGrid";
import {
    ElementLength,
    Percent,
    RenderCellFunc,
} from "../../components/virtualization/RenderGrid/types";
import { Spinner } from "../Spinner";
import { TreeItem } from "./TreeItem";
import { SectionItem } from "./SectionItem";
import { TreeModel, defaultTreeState } from "./TreeModel";
import { ITreeItem, TreeProps, TreeRef } from "./types";

// --- Styled ---
const Root = styled.div(/* … */);
const EmptyRoot = styled.div(/* … */);

// --- Constants ---
const columnWidth: ElementLength = (() => "100%" as Percent) as ElementLength;
const defaultRowHeight = 22;
const defaultIndentSize = 16;

function TreeView<T = ITreeItem>(
    props: TreeProps<T>,
    ref: React.ForwardedRef<TreeRef>,
) {
    const reactId = useId();
    const model = useComponentModel(
        props,
        TreeModel as unknown as TreeModel<T>,
        defaultTreeState,
    );
    model.setReactId(reactId);

    useImperativeHandle(
        ref,
        () => ({
            scrollToItem: model.scrollToItem,
            expandItem: model.expandItem,
            toggleItem: model.toggleItem,
            expandAll: model.expandAll,
            collapseAll: model.collapseAll,
            getExpandedMap: model.getExpandedMap,
        }),
        [model],
    );

    const {
        searchText,
        renderItem,
        keyboardNav = false,
        rowHeight = defaultRowHeight,
        indentSize = defaultIndentSize,
        growToHeight,
        whiteSpaceY,
        activeIndex,
        getTooltip,
        loading,
        emptyMessage,
        // captured (not forwarded)
        items: _items,
        value: _value,
        onChange: _onChange,
        isSelected: _isSelected,
        onActiveChange: _onActiveChange,
        onContextMenu: _onContextMenu,
        getContextMenu: _getContextMenu,
        getChildren: _getChildren,
        defaultExpandedValues: _defaultExpandedValues,
        defaultExpandAll: _defaultExpandAll,
        onExpandChange: _onExpandChange,
        id: _id,
        ...rest
    } = props;

    const rows = model.rows.value;

    const renderCell: RenderCellFunc = ({ row: idx, key, style }) => {
        const r = rows[idx];
        if (!r) return null;
        const id = model.itemId(idx);

        if (r.item.section) {
            return (
                <div key={key} style={style}>
                    <SectionItem
                        id={id}
                        level={r.level}
                        label={r.item.label}
                        indentSize={indentSize}
                    />
                </div>
            );
        }

        const selected = model.isSelectedAt(idx);
        const active = idx === activeIndex;
        const tooltip = getTooltip?.(r.source, r.level);

        const content = renderItem
            ? renderItem({
                item: r.item,
                source: r.source,
                level: r.level,
                expanded: r.expanded,
                hasChildren: r.hasChildren,
                rowIndex: idx,
                selected,
                active,
                id,
                toggleExpanded: () => model.toggleAt(idx),
            })
            : (
                <TreeItem
                    id={id}
                    level={r.level}
                    expanded={r.expanded}
                    hasChildren={r.hasChildren}
                    icon={r.item.icon}
                    label={r.item.label}
                    searchText={searchText}
                    selected={selected}
                    active={active}
                    disabled={r.item.disabled}
                    tooltip={tooltip}
                    indentSize={indentSize}
                    onChevronClick={(e) => model.onChevronClick(e, idx)}
                />
            );

        return (
            <div
                key={key}
                style={style}
                onClick={() => model.onItemClick(idx)}
                onMouseEnter={() => model.onItemMouseEnter(idx)}
                onContextMenu={(e) => model.onItemContextMenu(e, idx)}
            >
                {content}
            </div>
        );
    };

    if (loading) {
        return (
            <Root id={model.rootId} data-type="tree" data-loading="" onContextMenu={model.onRootContextMenu} {...rest}>
                <EmptyRoot><Spinner size={16} /> loading…</EmptyRoot>
            </Root>
        );
    }
    if (rows.length === 0) {
        return (
            <Root id={model.rootId} data-type="tree" data-empty="" onContextMenu={model.onRootContextMenu} {...rest}>
                <EmptyRoot>{emptyMessage ?? "no items"}</EmptyRoot>
            </Root>
        );
    }

    const activeId =
        activeIndex != null && activeIndex >= 0 && activeIndex < rows.length
            ? model.itemId(activeIndex)
            : undefined;

    return (
        <Root
            id={model.rootId}
            data-type="tree"
            role="tree"
            tabIndex={keyboardNav ? 0 : -1}
            aria-activedescendant={activeId}
            onKeyDown={model.onKeyDown}
            onContextMenu={model.onRootContextMenu}
            {...rest}
        >
            <RenderGrid
                ref={model.setGridRef}
                columnCount={1}
                rowCount={rows.length}
                columnWidth={columnWidth}
                rowHeight={rowHeight}
                renderCell={renderCell}
                overscanRow={2}
                fitToWidth
                growToHeight={growToHeight}
                whiteSpaceY={whiteSpaceY}
            />
        </Root>
    );
}

export const Tree = forwardRef(TreeView) as <T = ITreeItem>(
    props: TreeProps<T> & { ref?: React.Ref<TreeRef> },
) => React.ReactElement | null;

export {
    TREE_ITEM_KEY,
} from "./types";
export type {
    ITreeItem,
    TreeProps,
    TreeRef,
    TreeRow,
    TreeItemRenderContext,
} from "./types";
```

### Step 6 — `index.ts` barrel

```ts
export { Tree, TREE_ITEM_KEY } from "./Tree";
export type {
    ITreeItem,
    TreeProps,
    TreeRef,
    TreeRow,
    TreeItemRenderContext,
} from "./Tree";
export { TreeItem } from "./TreeItem";
export type { TreeItemProps } from "./TreeItem";
export { SectionItem as TreeSectionItem } from "./SectionItem";
export type { SectionItemProps as TreeSectionItemProps } from "./SectionItem";
```

(Renamed in re-export to `TreeSectionItem` to avoid colliding with `ListBox`'s
`SectionItem` — both are exported from `uikit/index.ts`.)

### Step 7 — `uikit/index.ts` updates

Add to the "Lists" block:

```ts
// Lists
export { ListBox, LIST_ITEM_KEY } from "./ListBox";
export type { ListBoxProps, ListBoxRef, IListBoxItem, ListItemRenderContext } from "./ListBox";
export { ListItem, SectionItem } from "./ListBox";
export type { ListItemProps, SectionItemProps } from "./ListBox";
export { Select } from "./Select";
export type { SelectProps, ItemsSource, SelectItemsResult } from "./Select";
export { Tree, TREE_ITEM_KEY } from "./Tree";
export type {
    TreeProps,
    TreeRef,
    ITreeItem,
    TreeItemRenderContext,
    TreeRow,
} from "./Tree";
export { TreeItem, TreeSectionItem } from "./Tree";
export type { TreeItemProps, TreeSectionItemProps } from "./Tree";
```

### Step 8 — Storybook story

Path: `src/renderer/uikit/Tree/Tree.story.tsx`.

Story structure (mirrors `ListBox.story.tsx`):

```ts
const TREE: ITreeItem[] = [
    {
        value: "root-1", label: "src", icon: <FolderIcon />, items: [
            {
                value: "src/uikit", label: "uikit", icon: <FolderIcon />, items: [
                    { value: "src/uikit/Tree.tsx", label: "Tree.tsx", icon: <FileTypeIcon fileName="Tree.tsx" /> },
                    { value: "src/uikit/ListBox.tsx", label: "ListBox.tsx", icon: <FileTypeIcon fileName="ListBox.tsx" /> },
                    // ... ~30 more leaves (long enough that virtualization kicks in)
                ],
            },
            { value: "src/index.ts", label: "index.ts", icon: <FileTypeIcon fileName="index.ts" /> },
        ],
    },
    // ... Group 2, Group 3 — total 60+ rows when fully expanded
];

const SECTIONED_TREE: ITreeItem[] = [
    { value: "section-recent", label: "Recent", section: true, items: [/* 5 leaves */] },
    { value: "section-pinned", label: "Pinned", section: true, items: [/* 5 leaves */] },
    { value: "section-all", label: "All Files", section: true, items: TREE },
];
```

Toggleable props:
- `searchText: string` — default `""`.
- `keyboardNav: boolean` — default `true`.
- `loading: boolean` — default `false`.
- `tooltip: boolean` — when true, set `getTooltip={(it) => `Tooltip: ${it.label}`}`.
- `contextMenu: boolean` — when true, set `getContextMenu` and `onContextMenu`
  (mirrors ListBox story, lines 107-130).
- `predicateSelection: boolean` — when true, replace `value`/`onChange` with
  `isSelected={(it) => typeof it.value === "string" && it.value.endsWith(".tsx")}`.
- `sections: boolean` — when true, render `SECTIONED_TREE` instead of `TREE`.
- `defaultExpandAll: boolean` — default `false`.
- `customRow: boolean` — when true, supply a `renderItem` that wraps `<TreeItem>` and adds
  a trailing `<IconButton icon={<CloseIcon />}>` (matches ListBox custom-row demo, lines
  73-100).

### Step 9 — Dashboard update

In [`doc/active-work.md`](../../active-work.md):

Replace the existing line:

```
- [ ] US-485: UIKit Tree — virtualized expand/collapse tree primitive *(Phase 4 — list infrastructure)*
```

with a link to this README:

```
- [ ] [US-485: UIKit Tree — virtualized expand/collapse tree primitive](tasks/US-485-uikit-tree/README.md) *(Phase 4 — list infrastructure)*
```

Status remains "Active" / unchecked — implementation begins after the user reviews this
document.

### Step 10 — TypeScript and lint check

`npx tsc --noEmit` — no new errors introduced.
`npm run lint` — no new ESLint errors.

### Step 11 — Manual smoke test (Storybook)

Run `npm start`, open Storybook editor, navigate to "Tree" under "Lists":

- **Rendering & virtualization:** with `defaultExpandAll: true`, scroll the grid through
  all rows. No row jitter, no missing chevrons, indentation aligns.
- **Expand / collapse:** click chevron → row toggles. ArrowRight on collapsed row →
  expands. ArrowRight on expanded row → moves to first child. ArrowLeft on expanded row →
  collapses. ArrowLeft on collapsed/leaf row → moves to parent.
- **Selection (value-based):** click a leaf → it becomes selected (background highlight,
  `data-selected` in DevTools). Click another leaf → previous deselects.
- **Selection (predicate):** with `predicateSelection: true`, every `.tsx` row shows
  selected; clicks do not change selection.
- **Active highlight + keyboard:** ArrowDown/Up/Home/End move the active row (background
  hover-style). Section rows skipped. Disabled rows skipped.
- **Tooltip:** with `tooltip: true`, hover a row → after ~600ms, tooltip appears. Toggle
  off → no tooltip.
- **Per-row context menu:** with `contextMenu: true`, right-click a row → global popup
  menu opens with "Copy …" / "Remove". Right-click empty area → "Tree background action".
- **Sections:** with `sections: true`, three group headers render dim and centered. Hover
  skips them. ArrowDown across groups skips them. Clicking a section does nothing.
- **Custom row:** with `customRow: true`, each row has a trailing close button. Clicking
  the button does NOT trigger row click (event.stopPropagation in the renderer).
- **Themes:** default-dark, light-modern, monokai — all colors come from `color.ts` via
  `data-*` selectors.
- **DevTools:**
  - Root: `<div data-type="tree" role="tree" aria-activedescendant="…">`
  - Items: `<div data-type="tree-item" data-state="open"|"closed" role="treeitem"
    aria-expanded="…" aria-level="…">`
  - Sections: `<div data-type="tree-section" role="presentation">`
- **Imperative ref:** wire a Storybook button to `treeRef.current.expandAll()` /
  `collapseAll()` / `scrollToItem("src/uikit/Tree.tsx")` and verify each works.

## Concerns / Open questions

All resolved before implementation.

### 1. Drag-and-drop and lazy children loading — RESOLVED: deferred to V2

V1 explicitly excludes:

| Feature | Reason for deferral |
|---------|---------------------|
| Drag-and-drop (`traitTypeId`, `getDragData`, `acceptsDrop`, `canTraitDrop`, `onTraitDrop`) | The legacy `TreeView` uses HTML5 native drag-drop with `setTraitDragData` / `getTraitDragData`. UIKit Tree should use the same trait-based dnd, but the wiring per row + drop highlighting + reorder semantics are non-trivial — folding them into V1 risks landing two big features at once and slowing review. Tracked as [US-488](../US-488-uikit-tree-dnd/README.md). |
| Lazy children loading (`getHasChildren` predicate, async `loadChildren`) + async `revealItem` | Required by `TreeProviderView` (file-system / archive / link-provider). Same shape as the legacy implementation but the model needs a "children unresolved" branch in `rows.value` plus per-row loading state, and `revealItem` becomes async to await ancestor loading. V1 ships a sync `revealItem` for already-loaded trees. Tracked as [US-489](../US-489-uikit-tree-lazy-load/README.md). |

V1 covers static trees (RestClientEditor, NotebookEditor's CategoryTree without drag-drop)
and the "extension" features identical to ListBox V2 (tooltip, context menu, predicate
selection, sections). This pacing matches the precedent
US-468 → US-484 → US-479 (ListBox V1 → V2 extensions → migration).

### 2. Per-screen migration tasks for current TreeView consumers — RESOLVED: separate tasks

After US-485 lands, the three consumers migrate via separate per-screen tasks (Phase 4):

- **TreeProviderView** — needs V2 (lazy + drag-drop). Migration is blocked on the V2 task.
- **CategoryTree (NotebookEditor)** — needs drag-drop. Blocked on V2.
- **RestClientEditor RequestTree** — V1 sufficient. Can migrate as soon as US-485 lands —
  but its migration is part of the rest-client editor migration task, not this one.

This task does not modify any consumer file. The single dashboard change is the US-485
line itself.

### 3. Recursive trait shape — RESOLVED: trait carries per-row attrs only; children via `getChildren`

`TraitType<ITreeItem>` auto-derives an `items?: (source) => ITreeItem[] | undefined`
accessor — but that signature returns *resolved* `ITreeItem[]`, while the model needs the
*source* `T[]` to recurse with traits applied per child.

Resolution: `ITreeItem.items` is documented as the resolved-shape children (used when
`T = ITreeItem` directly, no traits). For trait users, the model walks children via
`props.getChildren?.(source)` instead of via the trait. This keeps the trait shape
focused on per-row attributes and avoids the "trait returns its own type" recursion
problem.

When `T = ITreeItem` and `getChildren` is omitted, the model defaults to
`(it) => it.items` (see `resolveOne` body in Step 2). Storybook stories use that default;
custom-T consumers (e.g. `RequestTreeItem`) supply `getChildren`.

### 4. Multi-select — RESOLVED: out of scope for V1

UIKit `MultiSelect` (per US-438 naming table) is the multi-select counterpart to
`ListBox`. There is no plan for a multi-select tree variant — when one becomes necessary,
it ships as a separate `MultiTree` component or as additive props on `Tree`. V1 supports
the same single-select model as `ListBox` V1: `value` + `onChange`, OR `isSelected`
predicate. They are mutually exclusive at the prop level (predicate wins when both are
provided — same as ListBox).

### 5. `getChildren` vs `items` accessor on the trait — RESOLVED: explicit prop wins

When the `TREE_ITEM_KEY` trait declares an `items` accessor (e.g. `(node) =>
node.children`) AND the consumer also passes `getChildren`, the explicit prop wins. This
mirrors the React-table escape hatch where a column-level callback overrides the global
accessor.

In practice, V1 ignores any `items` accessor on the trait — children navigation goes
exclusively through `props.getChildren ?? (item) => item.items`. The trait's `items`
field is documented as "use only for the resolved shape, not the navigation". Removing
the accessor entirely is a future cleanup; keeping it as part of `TraitType<ITreeItem>`
auto-derivation is harmless because nothing reads it.

### 6. Roving tabindex vs `tabIndex={keyboardNav ? 0 : -1}` — RESOLVED: single Tab stop

`Tree` is a composite widget; per [Rule 4](../../../src/renderer/uikit/CLAUDE.md), only one
item gets focus from Tab. The simplest implementation: the root `<div>` gets `tabIndex={0}`
when `keyboardNav: true`; arrow keys move the highlighted (`activeIndex`) row. Items
themselves never receive `tabIndex={0}` — focus stays on the root, with
`aria-activedescendant` pointing at the active item id.

This matches `ListBox`'s implementation (no per-item focus), so screen readers experience
both as composite widgets with a single focus stop. Genuine per-item focus (one row
`tabIndex={0}`, others `-1`, focus moves on arrow) is more accessible but more complex —
deferred. Both ListBox and Tree adopt the same pattern simultaneously when adopted (out
of scope for V1).

### 7. `data-state` on the row vs on the chevron — RESOLVED: on the row

Putting `data-state="open"|"closed"` on the row (instead of on the chevron) makes a single
selector `[data-type="tree-item"][data-state="open"]` reachable from CSS and DevTools
queries — and matches the convention from
[CLAUDE.md Rule 1](../../../src/renderer/uikit/CLAUDE.md) ("expandable or floating
element"). The chevron itself rotates via `aria-expanded` on its parent, no `data-state`
attribute needed on the icon.

### 8. Recursive items resolution cost — RESOLVED: memoized once per items / expanded change

`model.rows = memo(...)` recomputes only when `props.items`, `props.getChildren`,
`state.expanded`, or expansion-default props change. Walking a 1k-node tree once per
expansion toggle is on the order of a millisecond — same cost the legacy `TreeView`
already pays in `buildRows`. No incremental update path needed for V1.

Future optimization (deferred): keep an incremental cache keyed by node value, invalidate
only the subtree of a toggled node. Not worth the V1 complexity.

### 9. Custom `renderItem` and indent strips — RESOLVED: caller responsibility

When `renderItem` is supplied, the default `<TreeItem>` is bypassed entirely. The custom
renderer receives `level`, `expanded`, `hasChildren`, `toggleExpanded` in
`TreeItemRenderContext` — enough to render its own indent strips and chevron. `Tree` does
NOT pre-pad the cell with indent strips; the row's full width belongs to the custom
content.

This keeps `<TreeItem>` responsible for visual parity with the legacy look and lets custom
rows implement very different shapes (e.g. inline-edit name, status badges, contextual
hover icons). Documented on `renderItem` JSDoc.

### 10. Value uniqueness — RESOLVED: required, not enforced

`item.value` must be unique within the entire tree (used for selection identity, expansion
state keying, and `indexByValue` lookups). Duplicates produce undefined selection /
expansion behavior — but `Tree` does NOT runtime-validate uniqueness. UIKit components
don't emit `console.warn` per existing convention.

The doc on `ITreeItem.value` says "Unique within the whole tree".

### 11. Empty-tree right-click and section clicks — RESOLVED: container handler fires

When `items.length === 0` (or the tree resolves to zero rows), the empty-state `<Root>`
still gets `onContextMenu={model.onRootContextMenu}`. Right-clicking the empty state
fires `props.onContextMenu`. Same behavior as `ListBox` empty state.

Section rows always skip per-row context-menu dispatch — right-clicking them falls through
to the container handler.

### 12. RowAlign on `scrollToItem` — RESOLVED: default `"nearest"`

`scrollToItem(value)` calls `gridRef.scrollToRow(idx, align ?? "nearest")`. Default
`"nearest"` matches the legacy `TreeView.scrollToItemById` (line 236 of `TreeView.model.ts`),
which is the right behavior for "reveal" actions — no jarring scroll if already visible.

### 13. `aria-tree` semantics for sections — RESOLVED: `role="presentation"`

Per WAI-ARIA 1.2, a `role="tree"` may have non-treeitem descendants if they declare
`role="presentation"` (or `none`). Section rows opt out of treeitem semantics by setting
`role="presentation"`, the same approach as ListBox sections. Screen readers report only
real `treeitem` rows; the section dividers act as silent visual separators.

### 14. Imperative ref on the root vs on the model — RESOLVED: ref exposes a thin facade

The model has every imperative method already; the `useImperativeHandle` in the View just
re-exposes a five-method interface (`scrollToItem`, `expandItem`, `toggleItem`,
`expandAll`, `collapseAll`, `getExpandedMap`). That keeps the model's full surface
internal (subject to refactor) while giving consumers a stable public API.

### 15. `defaultExpandedValues` vs initial state — RESOLVED: hint, not seed

`defaultExpandedValues` is consulted *every render* via the `rows` memo's deps factory —
it is not seeded once into `state.expanded` and forgotten. This means changing
`defaultExpandedValues` between renders takes effect immediately for nodes the user has
NOT explicitly toggled. After a user toggles a node, `state.expanded[value]` overrides the
hint for that node forever (until the model is unmounted).

This matches how URL-suggestions / sidebar consumers want to restore state on remount: pass
the stored map; the model consults it on mount and on every props change. Persist via
`onExpandChange`.

## Acceptance criteria

1. **File layout:** `src/renderer/uikit/Tree/` contains `Tree.tsx`, `TreeModel.ts`,
   `TreeItem.tsx`, `SectionItem.tsx`, `types.ts`, `index.ts`, `Tree.story.tsx`.
2. **Model-view shape:** `Tree.tsx` is a thin View — zero `useState`, zero `useCallback`,
   exactly one `useImperativeHandle` and one `useId`. `useEffect` only inside
   `useComponentModel`. `TreeModel` extends `TComponentModel<TreeState, TreeProps<T>>`.
3. **Trait integration:** `TREE_ITEM_KEY: TraitKey<TraitType<ITreeItem>>` exported. `Tree`
   accepts `T[] | Traited<T[]>`. The trait registry call lives in `types.ts` (one key per
   component, [Rule 3](../../../src/renderer/uikit/CLAUDE.md)).
4. **Children navigation:** `getChildren` prop is honored when supplied; falls back to
   `item.items` when absent. Trait-side `items` accessor is ignored.
5. **Expansion state:** model owns expansion. `defaultExpandAll`, `defaultExpandedValues`,
   `onExpandChange` all work as documented in `types.ts`.
6. **Imperative API:** `TreeRef` exposes `scrollToItem`, `revealItem`, `expandItem`,
   `toggleItem`, `expandAll`, `collapseAll`, `getExpandedMap`. Each works in Storybook.
7. **Selection:** `value` + `onChange` works for single-select; `isSelected` predicate
   wins when both are passed.
8. **Keyboard nav:** ArrowDown/Up/Home/End/PageUp/PageDown/Enter/ArrowRight/ArrowLeft all
   produce the documented behavior (see Step 11). Section and disabled rows are skipped on
   ArrowDown/Up/Home/End/PageUp/PageDown.
9. **Tooltip:** `getTooltip` wraps the default `<TreeItem>` in UIKit `<Tooltip>` when
   truthy. Custom `renderItem` is responsible for its own tooltip (documented).
10. **Per-row context menu:** `getContextMenu` populates
    `ContextMenuEvent.fromNativeEvent(e, "generic")` with the returned items. Empty
    return is a no-op.
11. **Container context menu:** `onContextMenu` fires only when the right-click does not
    hit a row that produced a non-empty menu (same guard as ListBox).
12. **Section rows:** `item.section: true` renders via `SectionItem` (`data-type="tree-section"`,
    `role="presentation"`), skips hover/click/selection/active, and is skipped by keyboard
    nav.
13. **Data attributes:** root has `data-type="tree"` (`data-loading=""` / `data-empty=""`
    in those states); items have `data-type="tree-item"`, `data-state="open"|"closed"`,
    `data-selected`, `data-active`, `data-disabled` per their flags.
14. **ARIA:** root has `role="tree"`, `aria-activedescendant`. Items have
    `role="treeitem"`, `aria-expanded` (only when `hasChildren`), `aria-level`,
    `aria-selected`. Sections have `role="presentation"`.
15. **Virtualization:** with 200+ rows, only ~20 cells appear in DevTools at a time
    (RenderGrid window size). Scrolling is smooth.
16. **Storybook:** `Tree.story.tsx` registered under section "Lists", appears in the
    Storybook editor, every toggleable prop in Step 8 is wired.
17. **`uikit/index.ts`** re-exports `Tree`, `TREE_ITEM_KEY`, types, `TreeItem`,
    `TreeSectionItem` (renamed to avoid colliding with ListBox `SectionItem`).
18. **Theme parity:** all three themes (`default-dark`, `light-modern`, `monokai`) render
    correctly. No hardcoded colors anywhere in the new files (only `color.*` lookups).
19. **`npx tsc --noEmit`** reports no new errors.
20. **`npm run lint`** reports no new ESLint errors.
21. **Dashboard updated:** US-485 entry in [`doc/active-work.md`](../../active-work.md)
    becomes a markdown link to this README.

## Files Changed summary

| File | Action | Notes |
|------|--------|-------|
| `src/renderer/uikit/Tree/Tree.tsx` | Create | View — pure render over `TreeModel` |
| `src/renderer/uikit/Tree/TreeModel.ts` | Create | Model — `TComponentModel<TreeState, TreeProps<T>>` subclass |
| `src/renderer/uikit/Tree/TreeItem.tsx` | Create | Default per-row renderer; tooltip + indent + chevron + icon + label |
| `src/renderer/uikit/Tree/SectionItem.tsx` | Create | Section-row renderer (`role="presentation"`) |
| `src/renderer/uikit/Tree/types.ts` | Create | `ITreeItem`, `TREE_ITEM_KEY`, `TreeProps`, `TreeRef`, `TreeRow`, `TreeItemRenderContext` |
| `src/renderer/uikit/Tree/index.ts` | Create | Barrel export |
| `src/renderer/uikit/Tree/Tree.story.tsx` | Create | Storybook story under section "Lists" |
| [`src/renderer/uikit/index.ts`](../../../src/renderer/uikit/index.ts) | Modify | Re-export Tree primitives + types |
| [`doc/active-work.md`](../../active-work.md) | Modify | Convert US-485 line to a link to this README |

## Links

- Epic: [EPIC-025](../../epics/EPIC-025.md) — Phase 4 list infrastructure
- Sibling primitives: [US-468](../US-468-uikit-listbox/README.md) — UIKit ListBox V1;
  [US-484](../US-484-uikit-listbox-extensions/README.md) — UIKit ListBox extensions
- Composes: [US-467](../US-467-uikit-tooltip/README.md) — UIKit Tooltip;
  [US-481](../US-481-uikit-menu-with-menu/README.md) — `MenuItem` re-export only (the
  legacy popper renders the actual menu, same as ListBox V2)
- Legacy reference (kept until Phase 7 cleanup):
  `src/renderer/components/TreeView/TreeView.tsx`,
  `src/renderer/components/TreeView/TreeView.model.ts`
- Future V2 tasks (NOT this task):
  [US-488](../US-488-uikit-tree-dnd/README.md) — drag-and-drop via traits;
  [US-489](../US-489-uikit-tree-lazy-load/README.md) — lazy children loading + reveal-item
  imperative API
- Future migration tasks (NOT this task): TreeProviderView migration, CategoryTree
  migration, RestClientEditor RequestTree migration — each tracked separately on the
  dashboard
