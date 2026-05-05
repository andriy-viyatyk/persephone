# US-488: UIKit Tree extensions — drag-and-drop via traits

> **Status:** Ready for implementation.
> **Epic:** EPIC-025 Phase 4 — list infrastructure.
> **Blocked on:** [US-485](../US-485-uikit-tree/README.md) — UIKit Tree V1 (shipped).

## Goal

Add trait-based drag-and-drop to UIKit `Tree`. Match the legacy `components/TreeView`
drag-drop surface (`traitTypeId`, `getDragData`, `acceptsDrop`, `canTraitDrop`,
`onTraitDrop`) but rebuilt under UIKit authoring rules — model owns drag state, View is
dumb, visual feedback flows through `data-*` attributes on the row.

After this task, every legacy `TreeView` consumer that depends on drag-drop
(`TreeProviderView`, `CategoryTree` inside `NotebookEditor`) can migrate to UIKit `Tree`
in their respective per-screen migration tasks. Phase 4 itself does not include those
migrations — they are tracked separately and depend on this task.

## Background

### V1 Tree shape (unchanged surface to extend)

V1 (US-485) is in `src/renderer/uikit/Tree/`. The relevant pieces this task extends:

- **State** — `TreeModel.ts:18-27` defines `TreeState` (currently `expanded`, `revision`).
- **Props** — `types.ts:101-192` defines `TreeProps<T>`.
- **Render-context** — `types.ts:43-64` defines `TreeItemRenderContext<T>` (passed to
  `renderItem`).
- **Per-row wrapper** — `Tree.tsx:181-191` is the `<div>` returned per row that already
  hosts `onClick`, `onMouseEnter`, `onContextMenu`. The DnD listeners attach here.
- **Default row** — `TreeItem.tsx:141-202` is the default `<TreeItem>` renderer; its
  `Root` styled element already uses `&[data-active]` / `&[data-selected]`. Adding
  `&[data-dragging]` / `&[data-drop-active]` rules slots into the same pattern.
- **Re-render trigger** — `TreeModel.ts:494-512` `init()` effect calls
  `gridRef.update({ all: true })` whenever any cell-input changes. Drag state must be
  added to its dep list, otherwise the row's drop highlight will not paint.
- **State subscription** — `Tree.tsx:123` currently subscribes only to
  `state.expanded`. To pick up drag state changes the View must subscribe more broadly
  (use the no-arg `state.use()` form).

### Trait DnD primitives (already complete — no changes)

`src/renderer/core/traits/dnd.ts` exports the four helpers this task wires up:
- `setTraitDragData(dataTransfer, typeId, data)` — call from `onDragStart`.
- `hasTraitDragData(dataTransfer)` — gate `dragenter` / `dragover` to only trait drags.
- `getTraitDragData(dataTransfer)` — read payload from `onDrop`.
- `allowDrop(e)` — preventDefault + sets `dropEffect = "move"` when payload is present.

`TraitTypeId` (`core/traits/TraitRegistry.ts:8-21`) is the enum of well-known type ids
shared across windows. Cross-window drag works as long as both windows register the same
`TraitTypeId` against a `TraitSet` at app boot — Tree itself does not need to know the
identifier.

### Legacy reference (kept until Phase 7 cleanup)

For comparison only. None of this code is reused verbatim — V2 re-models the same surface
under UIKit authoring rules.

- HTML5 wiring inside the row component:
  `src/renderer/components/TreeView/TreeView.tsx:117-234` — `TreeCell` handlers.
- Drop predicate / handler props on `TreeViewProps`:
  `src/renderer/components/TreeView/TreeView.model.ts:55-66`.
- Concrete consumer wiring:
  `src/renderer/components/tree-provider/TreeProviderView.tsx:174-202` (file/archive
  trees, `LinkTrait` payload).
- Notebook-category wiring: `src/renderer/editors/notebook/NotebookViewModel.ts:638-693`
  + `NotebookEditor.tsx:293-310`.

Two key differences from legacy:
1. Legacy stores per-row drag state (`isDragging`, `isOver`) in `useState` inside the row
   component. V2 hoists it to `TreeState` so the View is dumb and the model is the single
   source of truth — the `data-*` attributes on the row read directly from model state.
2. Legacy uses an enter-counter ref (`dragEnterCount`) to handle nested
   `dragenter`/`dragleave` storms. V2 keeps the same approach but stores the counter as a
   private model field keyed by source `value` — survives row index changes during a
   drag (e.g. when expand-on-hover fires mid-drag).

## Implementation plan

Five files change. All changes are additive — V1 consumers that supply none of the new
props see the V1 behavior unchanged.

### Step 1 — extend `TreeState` (`src/renderer/uikit/Tree/TreeModel.ts`)

Add two fields to `TreeState` and `defaultTreeState`:

```ts
export interface TreeState {
    expanded: Record<string | number, boolean>;
    revision: number;

    /** Source `value` of the row currently being dragged. Null when no drag in progress. */
    draggingValue: string | number | null;
    /** Source `value` of the row currently under the drag cursor. Null when none. */
    dragOverValue: string | number | null;
}

export const defaultTreeState: TreeState = {
    expanded: {},
    revision: 0,
    draggingValue: null,
    dragOverValue: null,
};
```

The model also keeps two private fields (NOT in state — purely transient):
- `private dragEnterCounts = new Map<string | number, number>();` — per-row enter counter
  keyed by source `value`.
- `private dragHoverExpandTimer: number | null = null;` — timer id for expand-on-hover.

### Step 2 — extend `TreeProps<T>` (`src/renderer/uikit/Tree/types.ts`)

Append after the existing keyboardNav prop:

```ts
import type { TraitDragPayload } from "../../core/traits/dnd";
import type { TraitTypeId } from "../../core/traits/TraitRegistry";

// inside TreeProps<T>, after `keyboardNav?:`

/**
 * Trait type id registered in `traitRegistry`. Required for drag to be enabled.
 * Together with `getDragData`, makes rows draggable. Section and disabled rows are
 * never draggable, regardless of this prop.
 */
traitTypeId?: TraitTypeId;
/**
 * Per-row drag-data resolver. Returning `null` aborts the drag (e.g. when the source
 * row is the tree's root and shouldn't be moved). The returned value is JSON-
 * serialized into `dataTransfer` — keep it serializable.
 */
getDragData?: (source: T, level: number) => unknown | null;
/**
 * When true, rows accept trait drops. Section and disabled rows are never drop
 * targets, regardless of this prop. Container-level drop (no row hit) is out of
 * scope for V1 of DnD.
 */
acceptsDrop?: boolean;
/**
 * Per-row drop predicate. Invoked on `dragenter` and again on `drop`. When omitted,
 * defaults to `true`. Use to reject self-drop and ancestor-into-descendant moves.
 */
canTraitDrop?: (target: T, payload: TraitDragPayload, level: number) => boolean;
/**
 * Drop handler. Invoked after `canTraitDrop` returns truthy. Consumer is responsible
 * for mutating the source data and firing whatever side effects the drop entails.
 */
onTraitDrop?: (target: T, payload: TraitDragPayload, level: number) => void;
/**
 * Auto-expand a collapsed-with-children row that the cursor hovers over during a drag
 * after this many milliseconds. Set to 0 to disable. Default: 500.
 */
expandOnDragHoverDelay?: number;
```

### Step 3 — extend `TreeItemRenderContext<T>` (`src/renderer/uikit/Tree/types.ts`)

Add two optional flags to `TreeItemRenderContext`:

```ts
// inside TreeItemRenderContext<T>, after `id`

/** True when the row is the source of an active drag. Default false. */
dragging?: boolean;
/** True when the row is the current drop target under the drag cursor. Default false. */
dropActive?: boolean;
```

### Step 4 — DnD handlers on `TreeModel` (`src/renderer/uikit/Tree/TreeModel.ts`)

Add the following methods. Match the existing convention: state writes wrapped in
`queueMicrotask`, liveness re-checked inside the microtask, ref-driven re-renders
through `gridRef.update({ all: true })` triggered by the `init()` effect (Step 5).

Computed gates (no state touch):

```ts
/** Whether DnD is enabled (drag source AND/OR drop target). */
get isDndEnabled(): boolean {
    return (
        (!!this.props.traitTypeId && !!this.props.getDragData) ||
        !!this.props.acceptsDrop
    );
}

/** Whether row at idx is allowed to start a drag. */
canDragRow = (rowIndex: number): boolean => {
    if (!this.props.traitTypeId || !this.props.getDragData) return false;
    const r = this.rows.value[rowIndex];
    return !!r && !r.item.section && !r.item.disabled;
};

/** Whether row at idx is allowed to receive drops. */
canDropRow = (rowIndex: number): boolean => {
    if (!this.props.acceptsDrop) return false;
    const r = this.rows.value[rowIndex];
    return !!r && !r.item.section && !r.item.disabled;
};

isDraggingAt = (rowIndex: number): boolean => {
    const r = this.rows.value[rowIndex];
    const v = this.state.get().draggingValue;
    return !!r && v != null && r.value === v;
};

isDropTargetAt = (rowIndex: number): boolean => {
    const r = this.rows.value[rowIndex];
    const v = this.state.get().dragOverValue;
    return !!r && v != null && r.value === v;
};
```

Drag-source handlers:

```ts
onDragStart = (e: React.DragEvent<HTMLDivElement>, rowIndex: number) => {
    const { traitTypeId, getDragData } = this.props;
    if (!traitTypeId || !getDragData) { e.preventDefault(); return; }
    const r = this.rows.value[rowIndex];
    if (!r || r.item.section || r.item.disabled) { e.preventDefault(); return; }
    const data = getDragData(r.source, r.level);
    if (data == null) { e.preventDefault(); return; }
    e.stopPropagation();
    setTraitDragData(e.dataTransfer, traitTypeId, data);
    queueMicrotask(() => {
        if (!this.isLive) return;
        this.state.update((s) => { s.draggingValue = r.value; });
    });
};

onDragEnd = () => {
    this.dragEnterCounts.clear();
    this.cancelHoverExpandTimer();
    queueMicrotask(() => {
        if (!this.isLive) return;
        this.state.update((s) => {
            s.draggingValue = null;
            s.dragOverValue = null;
        });
    });
};
```

Drop-target handlers:

```ts
onDragEnter = (e: React.DragEvent<HTMLDivElement>, rowIndex: number) => {
    if (!this.canDropRow(rowIndex)) return;
    if (!hasTraitDragData(e.dataTransfer)) return;
    const r = this.rows.value[rowIndex];
    if (!r) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";

    const cur = this.dragEnterCounts.get(r.value) ?? 0;
    this.dragEnterCounts.set(r.value, cur + 1);
    if (cur === 0) {
        queueMicrotask(() => {
            if (!this.isLive) return;
            this.state.update((s) => { s.dragOverValue = r.value; });
        });
        this.scheduleHoverExpand(r);
    }
};

onDragOver = (e: React.DragEvent<HTMLDivElement>, rowIndex: number) => {
    if (!this.canDropRow(rowIndex)) return;
    if (!hasTraitDragData(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
};

onDragLeave = (_e: React.DragEvent<HTMLDivElement>, rowIndex: number) => {
    const r = this.rows.value[rowIndex];
    if (!r) return;
    const cur = this.dragEnterCounts.get(r.value) ?? 0;
    const next = cur - 1;
    if (next <= 0) {
        this.dragEnterCounts.delete(r.value);
        this.cancelHoverExpandTimer();
        queueMicrotask(() => {
            if (!this.isLive) return;
            this.state.update((s) => {
                if (s.dragOverValue === r.value) s.dragOverValue = null;
            });
        });
    } else {
        this.dragEnterCounts.set(r.value, next);
    }
};

onDrop = (e: React.DragEvent<HTMLDivElement>, rowIndex: number) => {
    if (!this.canDropRow(rowIndex)) return;
    e.preventDefault();
    e.stopPropagation();
    this.dragEnterCounts.clear();
    this.cancelHoverExpandTimer();

    const payload = getTraitDragData(e.dataTransfer);
    queueMicrotask(() => {
        if (!this.isLive) return;
        this.state.update((s) => {
            s.dragOverValue = null;
            s.draggingValue = null;
        });
    });
    if (!payload) return;

    const r = this.rows.value[rowIndex];
    if (!r) return;
    const allowed = this.props.canTraitDrop?.(r.source, payload, r.level) ?? true;
    if (allowed) this.props.onTraitDrop?.(r.source, payload, r.level);
};
```

Expand-on-hover helpers (private):

```ts
private scheduleHoverExpand(r: TreeRow<T>) {
    this.cancelHoverExpandTimer();
    const delay = this.props.expandOnDragHoverDelay ?? 500;
    if (delay <= 0) return;
    if (!r.hasChildren || r.expanded) return;
    this.dragHoverExpandTimer = window.setTimeout(() => {
        if (!this.isLive) return;
        // Re-check the row is still hovered and still collapsed before expanding —
        // the user may have moved to a sibling between schedule and fire.
        const stillOver = this.state.get().dragOverValue === r.value;
        if (!stillOver) return;
        const idx = this.indexByValue.value.get(r.value);
        if (idx == null) return;
        const cur = this.rows.value[idx];
        if (!cur || cur.expanded) return;
        this.toggleAt(idx);
    }, delay);
}

private cancelHoverExpandTimer() {
    if (this.dragHoverExpandTimer != null) {
        window.clearTimeout(this.dragHoverExpandTimer);
        this.dragHoverExpandTimer = null;
    }
}
```

Required imports at the top of `TreeModel.ts`:

```ts
import { setTraitDragData, getTraitDragData, hasTraitDragData } from "../../core/traits/dnd";
```

Add `dispose()` (or extend it if present) to clear the timer:

```ts
dispose() {
    this.cancelHoverExpandTimer();
    super.dispose?.();
}
```

### Step 5 — extend the `init()` effect deps (`src/renderer/uikit/Tree/TreeModel.ts:494-512`)

Add the two new state fields to the existing `init()` re-render effect dep list so
RenderGrid repaints rows when `draggingValue` / `dragOverValue` flip:

```ts
this.effect(
    () => { this.gridRef?.update({ all: true }); },
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
        // ── NEW
        this.state.get().draggingValue,
        this.state.get().dragOverValue,
    ],
);
```

### Step 6 — wire the View (`src/renderer/uikit/Tree/Tree.tsx`)

Replace the narrow `state.use((s) => s.expanded)` subscription with a no-arg
`state.use()` so the view re-renders on drag state changes too:

```tsx
// before (line ~123)
model.state.use((s) => s.expanded);

// after
model.state.use();
```

Update `renderCell` to attach DnD handlers and forward the flags. The legacy code passed
`canDrag` per row; V2 reads the same gate from the model.

```tsx
const renderCell: RenderCellFunc = ({ row: idx, key, style }) => {
    const r = rows[idx];
    if (!r) return null;
    const id = model.itemId(idx);

    if (r.item.section) {
        // section branch unchanged
        return (
            <div key={key} style={style}>
                <SectionItem id={id} level={r.level} label={r.item.label} indentSize={indentSize} />
            </div>
        );
    }

    const selected = model.isSelectedAt(idx);
    const active = idx === activeIndex;
    const dragging = model.isDraggingAt(idx);
    const dropActive = model.isDropTargetAt(idx);
    const tooltip = getTooltip?.(r.source, r.level);

    const dndEnabled = model.isDndEnabled;
    const canDrag = dndEnabled && model.canDragRow(idx);
    const canDrop = dndEnabled && model.canDropRow(idx);

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
            dragging,
            dropActive,
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
                dragging={dragging}
                dropActive={dropActive}
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
            draggable={canDrag || undefined}
            onClick={() => model.onItemClick(idx)}
            onMouseEnter={() => model.onItemMouseEnter(idx)}
            onContextMenu={(e) => model.onItemContextMenu(e, idx)}
            onDragStart={canDrag ? (e) => model.onDragStart(e, idx) : undefined}
            onDragEnd={canDrag ? () => model.onDragEnd() : undefined}
            onDragEnter={canDrop ? (e) => model.onDragEnter(e, idx) : undefined}
            onDragOver={canDrop ? (e) => model.onDragOver(e, idx) : undefined}
            onDragLeave={canDrop ? (e) => model.onDragLeave(e, idx) : undefined}
            onDrop={canDrop ? (e) => model.onDrop(e, idx) : undefined}
        >
            {content}
        </div>
    );
};
```

### Step 7 — extend `TreeItem` (`src/renderer/uikit/Tree/TreeItem.tsx`)

Add two optional flags to `TreeItemProps`, project them as `data-dragging` /
`data-drop-active` on the root, and add the matching style rules.

```ts
// inside TreeItemProps, after `disabled?:`
/** True when this row is the source of an active drag. */
dragging?: boolean;
/** True when this row is the drop target under the drag cursor. */
dropActive?: boolean;
```

```tsx
// inside the Root element, alongside the existing data-* attributes:
data-dragging={dragging || undefined}
data-drop-active={dropActive || undefined}
```

Style rules in `Root` (additions inline alongside the existing
`&[data-active]:not([data-selected])` rule):

```ts
"&[data-dragging]": {
    opacity: 0.5,
},
"&[data-drop-active]": {
    backgroundColor: color.background.selection,
    color: color.text.dark,
},
```

`color.background.selection` and `color.text.dark` already exist in the token table —
the legacy `.dragOver` rule uses both (`TreeView.tsx:46-48`).

### Step 8 — Storybook demo (`src/renderer/uikit/Tree/Tree.story.tsx`)

Add a `dnd?: boolean` toggle to `DemoProps` and the `props` array. When enabled:

1. Register a one-off `TraitSet` at module scope keyed by an existing `TraitTypeId`
   (use `TraitTypeId.NotebookCategory` — already enumerated and not registered at app
   boot in the storybook context, so a local `traitRegistry.register` is appropriate
   for the demo).

   ```ts
   import { traitRegistry, TraitTypeId } from "../../core/traits/TraitRegistry";
   import { TraitSet } from "../../core/traits/traits";
   import type { TraitDragPayload } from "../../core/traits/dnd";

   const TREE_DEMO_TRAIT_KEY: TraitTypeId = TraitTypeId.NotebookCategory;
   if (!traitRegistry.has(TREE_DEMO_TRAIT_KEY)) {
       traitRegistry.register(TREE_DEMO_TRAIT_KEY, new TraitSet());
   }
   ```

2. Wire DnD props on the `<Tree>` when `dnd` is true:

   ```tsx
   traitTypeId={dnd ? TREE_DEMO_TRAIT_KEY : undefined}
   getDragData={dnd ? (it: ITreeItem) => ({ value: it.value, label: it.label }) : undefined}
   acceptsDrop={dnd}
   canTraitDrop={dnd
       ? (target: ITreeItem, payload: TraitDragPayload) => {
           // forbid self-drop
           const data = payload.data as { value: string | number };
           return data.value !== target.value;
       }
       : undefined}
   onTraitDrop={dnd
       ? (target: ITreeItem, payload: TraitDragPayload) => {
           // demo: just log — full move semantics belong to consumer migration tasks
           const data = payload.data as { value: string | number; label: string };
           console.log(`drop ${String(data.label)} on ${String(target.value)}`);
       }
       : undefined}
   ```

3. Document in the story description that the demo intentionally does NOT mutate the
   tree (move is consumer-side responsibility) and that hover-on-collapsed-folder
   triggers expand-on-hover after 500ms.

### Step 9 — verify barrel re-exports

`src/renderer/uikit/Tree/index.ts` and `src/renderer/uikit/index.ts` already re-export
`Tree`, `TreeProps`, `TreeRef`, `TreeItem`, `TreeItemProps`, `ITreeItem`,
`TreeItemRenderContext`. The new optional fields ride along — no new exports required.

`TraitDragPayload` and `TraitTypeId` are already public via `src/renderer/core/traits`
— consumers import them directly. Verify the barrel `core/traits/index.ts` re-exports
both (it should already).

## Concerns — resolved

**C1 — Where does drop-target state live? Per-row useState (legacy) or model state (UIKit)?**
Model state. `TreeState.dragOverValue` (single nullable source `value`). The View becomes
dumb; the per-row `&[data-drop-active]` selector reads from a model-derived flag
(`isDropTargetAt`).

**C2 — Per-row enter counter — state or private model field?**
Private model field (`Map<string|number, number>`), keyed by source `value`. Re-renders
aren't needed for the counter itself, only for the `dragOverValue` it ultimately drives.
Keying by `value` (not `rowIndex`) survives row index changes during the drag — for
example, if expand-on-hover fires mid-drag and the rows rebuild.

**C3 — Should section / disabled rows participate in DnD?**
No. Both `canDragRow` and `canDropRow` filter them out at the model level — the View
simply doesn't attach `draggable` or `onDrag*` handlers to those rows. Consumers cannot
override this with a permissive `canTraitDrop` because the row never reaches that branch.

**C4 — Container-level drop (no row hit)?**
Out of scope for this task. Legacy doesn't support it either. If a consumer needs it
later, it's an additive `onContainerDrop` prop on `TreeProps` and a `<Root onDragOver/Drop>`
wiring in `Tree.tsx` — small follow-up.

**C5 — Drop targets between rows (reorder semantics)?**
Out of scope. Legacy supports only "drop on row" — V2 keeps the same. Reorder ("between
rows") is a meaningful follow-up that needs a separate target-position state slice
(`dropPosition: "before" | "on" | "after"`) and a horizontal indicator line. Defer to a
later task if a consumer needs reorder.

**C6 — Drag-handle visibility — always-on (legacy) or hover-revealed (VSCode)?**
Always-on, matching legacy. The full row is the drag handle. A hover-revealed handle
would need a separate UIKit slot/affordance and is out of scope.

**C7 — Custom `renderItem` — does it need new flags?**
Yes. `TreeItemRenderContext` gains optional `dragging` and `dropActive` flags so a custom
renderer can paint its own drag styles. Default `<TreeItem>` reads them via props and
applies the data attributes itself.

**C8 — Drop-on-collapsed-folder expand-on-hover?**
Included with a configurable delay (`expandOnDragHoverDelay`, default 500ms, 0 disables).
Implemented via a `setTimeout` started on `dragenter` and cancelled on `dragleave` /
`drop` / `dragend`. Re-checks state when it fires (the user may have moved off the row
in the interim).

**C9 — Cross-window dragging?**
Already supported by `core/traits/dnd.ts`. The payload is a `JSON.stringify`-ed
`{ typeId, data }` written to a single MIME type. Both windows must register the same
`TraitTypeId` against a `TraitSet` at app boot. Tree itself is unaware of cross-window —
it just passes `payload` to `canTraitDrop` and `onTraitDrop`. No new code in this task.

**C10 — Drag preview customization?**
Out of scope. The browser's default preview (the source DOM element) is used. A
`setDragImage` API surface can be added later if a consumer needs a different preview.

**C11 — Auto-scroll while dragging at the edge of a long tree?**
Out of scope. The browser's edge-of-scrollable-area auto-scroll behaviour works
acceptably for most cases. Programmatic auto-scroll would need a `dragover`-driven
edge-detection loop on the `<Root>` — a meaningful follow-up only when a consumer
proves it's necessary.

**C12 — `onTraitDrop` signature — `(target, payload)` or `(target, payload, level)`?**
`(target, payload, level)` — symmetrical with V1's `getTooltip(item, level)` /
`getContextMenu(item, level)`. The level is cheap to surface and consumers occasionally
need it (e.g. CategoryTree's notebook drop logic checks "is target a top-level
category").

**C13 — `getDragData` — `(source)` or `(source, level)`?**
`(source, level)` — same reasoning as C12.

**C14 — Effect deps for re-render on drag state change?**
The existing `init()` effect has the only `gridRef.update({ all: true })` call. Adding
`state.get().draggingValue` and `state.get().dragOverValue` to its dep list ensures
RenderGrid re-renders cells when drag state flips. (The View also subscribes to state
broadly — the effect is what forces RenderGrid's overscan window to re-run renderCell.)

**C15 — `state.use((s) => s.expanded)` is too narrow once drag state matters.**
Replace with no-arg `state.use()`. The state object has four scalar fields total; the
broader subscription is equivalent in cost to the narrow one.

**C16 — Backwards compatibility?**
All new props on `TreeProps` are optional. `TreeItemRenderContext` gains optional
`dragging` / `dropActive` fields — V1 renderItem callers see them as `undefined`, which
falsy-coerces correctly. `TreeItem` gains optional `dragging` / `dropActive` props with
default `undefined`. V1 consumers that supply zero DnD props see the V1 behavior
unchanged.

## Acceptance criteria

- Dragging a regular leaf row sets `dataTransfer` with the trait payload (verified via
  DevTools Network/Application tab → drag inspector or by `console.log` in
  `onDragStart`).
- Dragging onto a writable target row paints the drop highlight (`data-drop-active` on
  the row's `Root`).
- Drop fires `onTraitDrop` with `(target, payload, level)` — verified via console log in
  the storybook demo.
- `canTraitDrop` returning `false` suppresses both the highlight and the `onTraitDrop`
  invocation.
- Section rows never accept drops, never start drags. Verified by configuring the
  `sections` toggle in the story together with the `dnd` toggle.
- Disabled rows never accept drops, never start drags.
- Self-drop is rejected by the demo's `canTraitDrop`.
- Drop highlight clears when the cursor leaves the row, AND when the drag ends without a
  drop (escape key or drop on a non-target).
- A custom `renderItem` receives `ctx.dragging` and `ctx.dropActive` flags. Verified by
  toggling the existing `customRow` story toggle together with `dnd`.
- A drag held over a collapsed-with-children row for 500ms expands it. The drag is not
  interrupted; the user can drop on the now-expanded row or move into a child.
- Cross-window: drag from one Persephone window to another with the same Tree
  configuration produces the correct `payload.typeId` / `payload.data`. (Storybook
  cannot easily exercise this — verify via a quick manual integration in
  TreeProviderView migration.)
- All V1 acceptance criteria from US-485 still pass when DnD props are not supplied
  (regression).
- TypeScript build passes (`npm run lint`).
- Storybook `Tree` story has a working `dnd` toggle that demonstrates: valid drag, valid
  drop, rejected self-drop, drop highlight, and expand-on-hover.

## Dependencies

- **Blocked on:** [US-485](../US-485-uikit-tree/README.md) — UIKit Tree V1 (shipped).
- **Coordinates with:** [US-489](../US-489-uikit-tree-lazy-load/README.md) — lazy
  children loading. Independent feature; no shared API surface, so the two V2 tasks may
  land in either order. If lazy load lands first, drop-on-collapsed-folder with unloaded
  children should trigger `loadChildren` then expand — a small additive interaction
  documented in that task's plan.

## Files Changed (planned)

| File | Change |
|---|---|
| `src/renderer/uikit/Tree/types.ts` | Extend `TreeProps` (6 new optional props); extend `TreeItemRenderContext` (2 new optional flags). |
| `src/renderer/uikit/Tree/TreeModel.ts` | Extend `TreeState` (2 fields); add DnD handlers and helpers; extend `init()` effect deps; add `dispose()`. |
| `src/renderer/uikit/Tree/Tree.tsx` | Broaden `state.use()` subscription; attach DnD handlers in `renderCell`; pass `dragging` / `dropActive` flags to `TreeItem` and to custom `renderItem`. |
| `src/renderer/uikit/Tree/TreeItem.tsx` | Accept `dragging` / `dropActive` props; project as `data-*` attributes; add Emotion rules for both states. |
| `src/renderer/uikit/Tree/Tree.story.tsx` | Add `dnd` story toggle; demo TraitSet registration; wire DnD props. |

## Files NOT changed (avoid investigating)

| File | Reason |
|---|---|
| `src/renderer/core/traits/dnd.ts` | Helpers (`setTraitDragData`, `getTraitDragData`, `hasTraitDragData`, `allowDrop`) already complete. |
| `src/renderer/core/traits/TraitRegistry.ts` | No new `TraitTypeId` needed; storybook reuses an existing enum member. |
| `src/renderer/uikit/Tree/SectionItem.tsx` | Section rows never participate in DnD. |
| `src/renderer/uikit/Tree/index.ts` | Existing re-exports cover the additive types. |
| `src/renderer/uikit/index.ts` | Existing re-exports cover the additive types. |
| `doc/tasks/US-485-uikit-tree/README.md` | V1 already shipped; V2 is purely additive. |

## Future migration tasks (not this task)

After US-488 lands, two consumer migration tasks become unblocked. They are tracked
separately and are NOT part of this task:

- **TreeProviderView migration** — sidebar / browser security panel / archive browser.
  Wires `LinkTrait` payload to `traitTypeId={TraitTypeId.ILink}` + `getDragData` /
  `canTraitDrop` / `onTraitDrop` and removes the legacy `<TreeView>` import.
- **CategoryTree migration** — `NotebookEditor`. Wires
  `traitTypeId={TraitTypeId.NotebookCategory}` and the existing
  `vm.categoryTraitDrop` / `vm.getCategoryDragData` handlers.

Both will be created when this task lands.
