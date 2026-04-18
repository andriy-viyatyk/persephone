# US-444: Trait-based drag-drop infrastructure + link pilot

**Epic:** [EPIC-026 — Trait System](../../epics/EPIC-026.md)
**Status:** Active
**Created:** 2026-04-18

## Goal

Build the trait-based drag-and-drop infrastructure (TraitRegistry, serialization helpers, native HTML5 DnD utilities) and convert the **link drag** as the pilot — proving the pattern works for same-window and cross-window scenarios before expanding to other data types.

## Background

### Current state

Link drag uses React-DnD with `useDrag`/`useDrop` hooks. The drag payload is a `LinkDragEvent`:

```typescript
// src/renderer/editors/link-editor/linkTypes.ts:8-17
export const LINK_DRAG_TYPE = "link-drag";
export interface LinkDragEvent {
    type: typeof LINK_DRAG_TYPE;
    items: ILink[];
    sourceId?: string;
}
```

Three components create link drag sources:
- **TreeView.tsx** (generic) — `useDrag`/`useDrop` in `TreeCell` (lines 123-146), configured by props from `TreeProviderView.tsx`
- **LinksList.tsx** — `useDrag` per row (lines 128-135), drag-only
- **LinksTiles.tsx** — `useDrag` per tile (lines 177-184), drag-only

One component handles link drops:
- **TreeProviderView.tsx** — passes `onDrop` callback (lines 193-198) that calls `model.moveItems()`

### Cross-window reference pattern

PageTab.tsx already uses native HTML5 drag for cross-window tab moves (lines 447-480):
```typescript
// Drag start: serialize to dataTransfer
e.dataTransfer.setData("application/persephone-tab", JSON.stringify(dragData));
e.dataTransfer.effectAllowed = "move";

// Drop: read from dataTransfer
const dataStr = e.dataTransfer?.getData("application/persephone-tab");
```

This proves the pattern: HTML5 `dataTransfer.setData()` string data is mediated by the OS between Electron windows. We'll use the same approach for trait-based drag.

### Trait system core (US-428)

Already implemented in `src/renderer/core/traits/traits.ts`:
- `TraitKey<T>` — typed key with phantom type for type safety
- `TraitSet` — `Map<symbol, unknown>` with typed `add`/`get`/`has`
- `Traited<V>` — data bundled with traits
- `traited()`, `isTraited()` — helpers

### Why React-DnD can't be removed yet

React-DnD is used by 11 components. This task converts only the 4 link-related ones to native HTML5. The remaining 7 (PageTab, HeaderCell, FolderItem, TodoItemView, NoteItemView, ToolsEditorsPanel, PinnedLinksPanel) stay on React-DnD until US-447/US-449. The `DndProvider` wrapper in `index.tsx` must remain.

## Implementation Plan

### Step 1: TraitRegistry

Create `src/renderer/core/traits/TraitRegistry.ts`:

```typescript
import { TraitSet } from "./traits";

/**
 * Well-known type identifiers for the trait registry.
 * Each value is a serializable string used in drag-drop payloads.
 * New types are added here as they are registered.
 */
export enum TraitTypeId {
    ILink = "ILink",
}

/**
 * Maps type identifier strings to TraitSets.
 * Enables cross-window drag-drop: drag payload carries serializable { typeId, data },
 * drop target resolves TraitSet from registry by typeId.
 */
class TraitRegistry {
    private map = new Map<string, TraitSet>();

    register(typeId: TraitTypeId, traits: TraitSet): void {
        this.map.set(typeId, traits);
    }

    get(typeId: string): TraitSet | undefined {
        return this.map.get(typeId);
    }

    has(typeId: string): boolean {
        return this.map.has(typeId);
    }
}

/** Global singleton trait registry. */
export const traitRegistry = new TraitRegistry();
```

`register()` accepts `TraitTypeId` (enum) to force all registrations to go through the enum. `get()`/`has()` accept `string` because drag payloads arrive as deserialized strings — the caller compares against enum values.

Export from `src/renderer/core/traits/index.ts`:
```typescript
export { TraitTypeId, TraitRegistry, traitRegistry } from './TraitRegistry';
```

Re-export from `src/renderer/core/index.ts` (already exports `'./traits'`).

### Step 2: LINK trait key and interface

Create `src/renderer/editors/link-editor/linkTraits.ts`:

```typescript
import type { ILink } from "../../api/types/io.tree";
import { TraitKey, TraitSet, TraitTypeId, traitRegistry } from "../../core/traits";

// ── Trait interface ──────────────────────────────────────────────────────────

/** Trait for data that can be represented as ILink items. */
export interface LinkTrait {
    /** Get the draggable ILink items from the source data. */
    getItems(data: unknown): ILink[];
    /** Optional source identifier for same-source detection. */
    getSourceId?(data: unknown): string | undefined;
}

/** Trait key for link data. */
export const LINK = new TraitKey<LinkTrait>("Link");

// ── ILink trait registration ─────────────────────────────────────────────────

/** Data shape for ILink drag payload. */
export interface LinkDragData {
    items: ILink[];
    sourceId?: string;
}

const linkTraits = new TraitSet()
    .add(LINK, {
        getItems: (data: unknown) => (data as LinkDragData).items,
        getSourceId: (data: unknown) => (data as LinkDragData).sourceId,
    });

traitRegistry.register(TraitTypeId.ILink, linkTraits);
```

**Key decision:** The trait interface uses `(data: unknown)` because after deserialization the type is erased. The `TraitKey<LinkTrait>` provides type safety at the call site (`traits.get(LINK)!.getItems(data)`).

### Step 3: Native HTML5 drag-drop utilities

Create `src/renderer/core/traits/dnd.ts`:

```typescript
import { TraitSet } from "./traits";
import { TraitTypeId, traitRegistry } from "./TraitRegistry";

const MIME_TYPE = "application/persephone-trait";

// ── Serialization ────────────────────────────────────────────────────────────

/** Drag payload shape — serialized into dataTransfer. */
export interface TraitDragPayload {
    typeId: string;
    data: unknown;
}

/** Set trait drag data on a native drag event. */
export function setTraitDragData(
    dataTransfer: DataTransfer,
    typeId: TraitTypeId,
    data: unknown,
): void {
    const payload: TraitDragPayload = { typeId, data };
    dataTransfer.setData(MIME_TYPE, JSON.stringify(payload));
    dataTransfer.effectAllowed = "move";
}

/** Read trait drag data from a native drag event. Returns null if not a trait drag. */
export function getTraitDragData(dataTransfer: DataTransfer): TraitDragPayload | null {
    const raw = dataTransfer.getData(MIME_TYPE);
    if (!raw) return null;
    try {
        return JSON.parse(raw) as TraitDragPayload;
    } catch {
        return null;
    }
}

/** Check if a drag event carries trait data (for dragover/dragenter). */
export function hasTraitDragData(dataTransfer: DataTransfer): boolean {
    return dataTransfer.types.includes(MIME_TYPE);
}

/** Resolve TraitSet from registry by typeId. */
export function resolveTraits(typeId: string): TraitSet | undefined {
    return traitRegistry.get(typeId);
}

// ── Visual feedback CSS class helpers ────────────────────────────────────────

/** Prevent default to allow drop. Call from onDragOver and onDragEnter handlers. */
export function allowDrop(e: React.DragEvent): void {
    if (hasTraitDragData(e.dataTransfer)) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
    }
}
```

Add exports to `src/renderer/core/traits/index.ts`:
```typescript
export {
    setTraitDragData,
    getTraitDragData,
    hasTraitDragData,
    resolveTraits,
    allowDrop,
} from './dnd';
export type { TraitDragPayload } from './dnd';
```

(Note: `TraitTypeId` is already exported via `TraitRegistry.ts` re-export added in Step 1.)

### Step 4: Convert TreeView.tsx drag to native HTML5

This is the biggest change — TreeView's `TreeCell` currently uses `useDrag`/`useDrop`. We replace with native HTML5 events.

**File:** `src/renderer/components/TreeView/TreeView.tsx`

**Before (lines 123-168):**
```typescript
const [{ isOver }, drop] = useDrop({
    accept: model.props.dropTypes ?? [],
    canDrop(dragItem: DragItem) { ... },
    drop(dragItem: DragItem) { ... },
    collect: (monitor) => ({ isOver: monitor.isOver() && monitor.canDrop() }),
});
const [{ isDragging }, drag] = useDrag({
    type: model.props.dragType || "__NONE__",
    item: () => model.props.getDragItem?.(item.item),
    collect: (monitor) => ({ isDragging: monitor.isDragging() }),
    canDrag: () => { ... },
});
// ...
<div ref={(node) => { drag(drop(node)); }} className={clsx("tree-cell", { dragOver: isOver, dragging: isDragging })}>
```

**After:** Replace React-DnD hooks with native events + local state:

```typescript
const [isDragging, setIsDragging] = useState(false);
const [isOver, setIsOver] = useState(false);

const handleDragStart = useCallback((e: React.DragEvent) => {
    const dragItem = model.props.getDragItem?.(item.item);
    if (!dragItem) { e.preventDefault(); return; }
    // Store drag payload using trait system
    if (model.props.traitTypeId) {
        setTraitDragData(e.dataTransfer, model.props.traitTypeId, model.props.getDragData?.(item.item));
    }
    setIsDragging(true);
}, [item.item, model.props]);

const handleDragEnd = useCallback(() => {
    setIsDragging(false);
}, []);

const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!model.props.dropTypes?.length) return;
    if (hasTraitDragData(e.dataTransfer)) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setIsOver(true);
    }
}, [model.props.dropTypes]);

const handleDragLeave = useCallback(() => {
    setIsOver(false);
}, []);

const handleDrop = useCallback((e: React.DragEvent) => {
    setIsOver(false);
    const payload = getTraitDragData(e.dataTransfer);
    if (!payload) return;
    const canDrop = model.props.canDrop?.(item.item, payload) ?? true;
    if (canDrop) {
        e.preventDefault();
        model.props.onDrop?.(item.item, payload);
    }
}, [item.item, model.props]);
```

**TreeViewProps changes** (`TreeView.model.ts`):

Replace React-DnD-specific props with trait-aware props:

```typescript
// REMOVE:
dragType?: DragType;
getDragItem?: (item: T) => DragItem | null;
dropTypes?: DragType[];
onDrop?: (dropItem: T, dragItem: DragItem) => void;
canDrop?: (dropItem: T, dragItem: DragItem) => boolean;

// ADD:
/** Trait type ID for making tree cells draggable (registered in traitRegistry). */
traitTypeId?: TraitTypeId;
/** Get serializable drag data for a tree node. Return null to prevent dragging. */
getDragData?: (item: T) => unknown | null;
/** Whether this tree accepts trait drops. */
acceptsDrop?: boolean;
/** Check if a specific drop is allowed on this node. */
canDrop?: (dropItem: T, payload: TraitDragPayload) => boolean;
/** Handle a trait drop on a tree node. */
onDrop?: (dropItem: T, payload: TraitDragPayload) => void;
```

Also remove the `DragType` and `DragItem` type exports from `TreeView.model.ts` — they are no longer needed by TreeView. (Keep them temporarily if other non-link components still reference them. Check at implementation time.)

**Remove** the `useDrag`/`useDrop` imports from TreeView.tsx. Add imports for trait dnd utilities.

### Step 5: Convert TreeProviderView.tsx

**File:** `src/renderer/components/tree-provider/TreeProviderView.tsx`

**Before (lines 175-198, 274-278):**
```typescript
const getDragItem = useCallback((node: TreeProviderNode) => {
    if (!writable) return null;
    if (node.data.href === props.provider.rootPath) return null;
    return { type: LINK_DRAG_TYPE, items: [node.data], sourceId: props.provider.sourceUrl } as LinkDragEvent;
}, [...]);

const canDrop = useCallback((dropNode: TreeProviderNode, dragItem: DragItem) => {
    const linkDrag = dragItem as unknown as LinkDragEvent;
    if (linkDrag.items?.length === 1 && linkDrag.items[0].href === dropNode.data.href) return false;
    return true;
}, [...]);

const onDrop = useCallback((dropNode: TreeProviderNode, dragItem: DragItem) => {
    const linkDrag = dragItem as unknown as LinkDragEvent;
    if (linkDrag.items?.length) { model.moveItems(linkDrag.items, dropNode); }
}, [...]);

// TreeView props:
dragType={writable ? LINK_DRAG_TYPE : undefined}
getDragItem={writable ? getDragItem : undefined}
dropTypes={writable ? [LINK_DRAG_TYPE] : undefined}
canDrop={writable ? canDrop : undefined}
onDrop={writable ? onDrop : undefined}
```

**After:**
```typescript
import { LINK } from "../../editors/link-editor/linkTraits";
import { TraitTypeId, resolveTraits } from "../../core/traits";
import type { TraitDragPayload } from "../../core/traits";

const getDragData = useCallback((node: TreeProviderNode) => {
    if (!writable) return null;
    if (node.data.href === props.provider.rootPath) return null;
    return { items: [node.data], sourceId: props.provider.sourceUrl };
}, [...]);

const canDrop = useCallback((dropNode: TreeProviderNode, payload: TraitDragPayload) => {
    if (!writable) return false;
    const traits = resolveTraits(payload.typeId);
    const linkTrait = traits?.get(LINK);
    if (!linkTrait) return false;
    const items = linkTrait.getItems(payload.data);
    if (items.length === 1 && items[0].href === dropNode.data.href) return false;
    return true;
}, [writable]);

const onDrop = useCallback((dropNode: TreeProviderNode, payload: TraitDragPayload) => {
    const traits = resolveTraits(payload.typeId);
    const linkTrait = traits?.get(LINK);
    if (!linkTrait) return;
    const items = linkTrait.getItems(payload.data);
    if (items.length) { model.moveItems(items, dropNode); }
}, [model]);

// TreeView props:
traitTypeId={writable ? TraitTypeId.ILink : undefined}
getDragData={writable ? getDragData : undefined}
acceptsDrop={writable}
canDrop={writable ? canDrop : undefined}
onDrop={writable ? onDrop : undefined}
```

**Remove** `LINK_DRAG_TYPE` import from this file and `DragItem` import from TreeView.model.

### Step 6: Convert LinksList.tsx drag to native HTML5

**File:** `src/renderer/editors/link-editor/LinksList.tsx`

**Before (lines 128-135, 141-145):**
```typescript
const [{ isDragging }, drag] = useDrag({
    type: LINK_DRAG_TYPE,
    item: { type: LINK_DRAG_TYPE, items: [link], sourceId: dragSourceId } as LinkDragEvent,
    canDrag: !!dragSourceId,
    collect: (monitor) => ({ isDragging: monitor.isDragging() }),
});
// ...
<div ref={(node) => { drag(node); }} style={isDragging ? { opacity: 0.4 } : undefined}>
```

**After:**
```typescript
import { TraitTypeId, setTraitDragData } from "../../core/traits";

const [isDragging, setIsDragging] = useState(false);

const handleDragStart = useCallback((e: React.DragEvent) => {
    if (!dragSourceId) { e.preventDefault(); return; }
    setTraitDragData(e.dataTransfer, TraitTypeId.ILink, { items: [link], sourceId: dragSourceId });
    setIsDragging(true);
}, [link, dragSourceId]);

const handleDragEnd = useCallback(() => {
    setIsDragging(false);
}, []);
// ...
<div
    draggable={!!dragSourceId}
    onDragStart={handleDragStart}
    onDragEnd={handleDragEnd}
    style={isDragging ? { opacity: 0.4 } : undefined}
>
```

**Remove** `useDrag` import from react-dnd, `LINK_DRAG_TYPE` import from linkTypes.

### Step 7: Convert LinksTiles.tsx drag to native HTML5

**File:** `src/renderer/editors/link-editor/LinksTiles.tsx`

Same pattern as LinksList.tsx:

**Before (lines 177-184, 192-194):**
```typescript
const [{ isDragging }, drag] = useDrag({
    type: LINK_DRAG_TYPE,
    item: { type: LINK_DRAG_TYPE, items: [link], sourceId: dragSourceId } as LinkDragEvent,
    canDrag: !!dragSourceId,
    collect: (monitor) => ({ isDragging: monitor.isDragging() }),
});
// ...
<div ref={(node) => { drag(node); }} style={isDragging ? { opacity: 0.4 } : undefined}>
```

**After:**
```typescript
import { TraitTypeId, setTraitDragData } from "../../core/traits";

const [isDragging, setIsDragging] = useState(false);

const handleDragStart = useCallback((e: React.DragEvent) => {
    if (!dragSourceId) { e.preventDefault(); return; }
    setTraitDragData(e.dataTransfer, TraitTypeId.ILink, { items: [link], sourceId: dragSourceId });
    setIsDragging(true);
}, [link, dragSourceId]);

const handleDragEnd = useCallback(() => {
    setIsDragging(false);
}, []);
// ...
<div
    draggable={!!dragSourceId}
    onDragStart={handleDragStart}
    onDragEnd={handleDragEnd}
    style={isDragging ? { opacity: 0.4 } : undefined}
>
```

**Remove** `useDrag` import from react-dnd, `LINK_DRAG_TYPE` import from linkTypes.

### Step 8: Ensure linkTraits.ts is imported at startup

The `traitRegistry.register("ILink", ...)` call in `linkTraits.ts` needs to run before any drag-drop interaction. Import it from a module that loads at startup.

**Option A:** Import in `src/renderer/editors/link-editor/linkTypes.ts` (already imported by all link components):
```typescript
// At top of linkTypes.ts
import "./linkTraits";
```

**Option B:** Import in `src/renderer/editors/register-editors.ts`.

Prefer Option A — co-locates trait registration with the types it serves.

### Step 9: Verify and test

1. **Same-window link drag:** Open a .link.json file, drag a link between categories in the tree → should move
2. **Same-window list/tile drag:** Switch to list or tile view, drag a link item to the tree → should move
3. **Cross-window link drag:** Open two Persephone windows with .link.json files, drag a link from one window's tree to the other → should work via HTML5 dataTransfer serialization
4. **No-drop visual feedback:** Drag over a non-drop target → cursor should show "not allowed"
5. **Self-drop prevention:** Drag a link onto itself → should not highlight, should not trigger move
6. **Read-only tree:** Open a file explorer (non-writable provider) → links should not be draggable
7. **React-DnD still works:** Verify other drags (tab reorder, grid columns, todo reorder, folder reorder, pinned editors) still function correctly via React-DnD

### Step 10: Clean up linkTypes.ts

After conversion, `LINK_DRAG_TYPE` and `LinkDragEvent` are no longer used by any link component. Check if any non-link code references them. If not, remove both from `linkTypes.ts`. `LINK_PIN_DRAG` stays — it's used by PinnedLinksPanel which is not converted in this task.

## Concerns / Open Questions

### 1. TreeView backward compatibility (RESOLVED)

TreeView is used by non-link trees (notebook categories, REST client tree). Those still use React-DnD types (`DragType`, `DragItem`) through TreeView props.

**Resolution:** TreeView needs to support **both** the old React-DnD props (for non-link trees) and the new trait-based props (for link trees) during the transitional period. After US-447 converts all data drags, the old props can be removed.

**Approach:** Keep both sets of props in TreeViewProps. In TreeCell, check which set is provided:
- If `traitTypeId` is set → use native HTML5 handlers
- If `dragType` is set → use React-DnD hooks (existing code)

This avoids touching notebook, REST client, or any other TreeView consumer in this task.

### 2. DragItem/DragType exports

`DragItem` and `DragType` from `TreeView.model.ts` are referenced by `TreeProviderView.tsx` and potentially other files. Keep these types until US-447/US-449 removes all React-DnD usage. Mark them with `/** @deprecated — use trait-based drag props instead */`.

### 3. Cross-window drop in tree — canDrop timing

During `dragover`, the browser does NOT expose `getData()` — only `dataTransfer.types` is available (security restriction). This means `canDrop` cannot inspect the payload during hover. Only on actual `drop` can we read the data.

**Resolution:** During `dragover`, we can only check `hasTraitDragData()` (type list check). The detailed `canDrop` check (e.g., not self-drop) runs on the actual drop event. If the check fails, we silently ignore the drop. Visual feedback during hover will show "droppable" for all trait drags on writable trees. This is acceptable — it matches how clipboard paste works (you can paste anywhere; the handler decides what to do).

### 4. dataTransfer MIME type naming

Using `application/persephone-trait` as the MIME type. This is an application-specific type that won't collide with standard MIME types or other Electron apps.

## Acceptance Criteria

- [ ] `TraitRegistry` class exists with `register`/`get`/`has` methods, exported from `core/traits`
- [ ] `traitRegistry` global singleton exists and is exported
- [ ] `LINK` TraitKey and `LinkTrait` interface defined in `linkTraits.ts`
- [ ] ILink trait registered in `traitRegistry` under typeId `"ILink"`
- [ ] `setTraitDragData`, `getTraitDragData`, `hasTraitDragData`, `resolveTraits`, `allowDrop` utilities exist in `core/traits/dnd.ts`
- [ ] TreeView supports trait-based drag via `traitTypeId`/`getDragData`/`acceptsDrop` props (alongside existing React-DnD props for backward compat)
- [ ] TreeProviderView uses trait-based drag props instead of React-DnD props
- [ ] LinksList uses native HTML5 drag with `setTraitDragData` instead of `useDrag`
- [ ] LinksTiles uses native HTML5 drag with `setTraitDragData` instead of `useDrag`
- [ ] Same-window link drag-drop works (tree, list, tile sources)
- [ ] Cross-window link drag-drop works between two Persephone windows
- [ ] Non-link drags (tabs, grid columns, folders, todos, notes, pinned editors) still work via React-DnD
- [ ] `LINK_DRAG_TYPE` and `LinkDragEvent` removed from linkTypes.ts (if no remaining references)
- [ ] TypeScript compiles with no new errors
- [ ] ESLint passes with no new warnings

## Files Changed Summary

| File | Action | Description |
|------|--------|-------------|
| `src/renderer/core/traits/TraitRegistry.ts` | **Create** | TraitRegistry class + singleton |
| `src/renderer/core/traits/dnd.ts` | **Create** | Native HTML5 drag serialization utilities |
| `src/renderer/core/traits/index.ts` | **Modify** | Add exports for TraitRegistry + dnd |
| `src/renderer/editors/link-editor/linkTraits.ts` | **Create** | LINK trait key, LinkTrait interface, ILink registration |
| `src/renderer/editors/link-editor/linkTypes.ts` | **Modify** | Import linkTraits; remove LINK_DRAG_TYPE + LinkDragEvent if unused |
| `src/renderer/components/TreeView/TreeView.tsx` | **Modify** | Add native HTML5 drag path alongside React-DnD path |
| `src/renderer/components/TreeView/TreeView.model.ts` | **Modify** | Add trait-based props to TreeViewProps; deprecate DragItem/DragType |
| `src/renderer/components/tree-provider/TreeProviderView.tsx` | **Modify** | Switch to trait-based TreeView props |
| `src/renderer/editors/link-editor/LinksList.tsx` | **Modify** | Replace useDrag with native HTML5 + setTraitDragData |
| `src/renderer/editors/link-editor/LinksTiles.tsx` | **Modify** | Replace useDrag with native HTML5 + setTraitDragData |

### Files NOT changed

| File | Reason |
|------|--------|
| `src/renderer/index.tsx` | DndProvider stays — other components still use React-DnD |
| `src/renderer/editors/link-editor/PinnedLinksPanel.tsx` | Uses LINK_PIN_DRAG (positional reorder), stays React-DnD |
| `src/renderer/editors/browser/BrowserTabsPanel.tsx` | Separate drag type, stays React-DnD |
| `src/renderer/editors/todo/components/TodoItemView.tsx` | Converted in US-447 |
| `src/renderer/editors/notebook/NoteItemView.tsx` | Converted in US-447 |
| `src/renderer/ui/tabs/PageTab.tsx` | Tab drag stays React-DnD + existing native HTML5 |
| `src/renderer/ui/sidebar/FolderItem.tsx` | Folder reorder stays React-DnD |
| `src/renderer/ui/sidebar/ToolsEditorsPanel.tsx` | Pinned editor reorder stays React-DnD |
| `src/renderer/components/data-grid/AVGrid/HeaderCell.tsx` | Column reorder stays React-DnD |
| `src/renderer/editors/rest-client/RestClientEditor.tsx` | REST request tree converted in US-447 |
| `src/renderer/editors/notebook/NotebookEditor.tsx` | Category tree converted in US-447 |
| `src/renderer/components/tree-provider/TreeProviderViewModel.tsx` | `moveItems()` unchanged — receives ILink[] |
