# US-447: Convert remaining data drags to trait-based system

**Epic:** [EPIC-026 — Trait System](../../epics/EPIC-026.md)
**Status:** Active
**Created:** 2026-04-18

## Goal

Convert all remaining React-DnD "data drags" (todo items, notebook notes/categories, REST client requests, browser tabs, pinned links) to the trait-based native HTML5 drag system established in US-444. After this task, the only remaining React-DnD usages are pure UI/component-level drags (page tabs, grid column reorder, sidebar folders, pinned editors) — cleaned up in US-449.

## Background

### Trait-based drag system (US-444)

US-444 established the pattern:
- **TraitTypeId** enum in `src/renderer/core/traits/TraitRegistry.ts` — serializable type identifiers
- **TraitRegistry** — maps `TraitTypeId` → `TraitSet` for drop-side resolution
- **setTraitDragData / getTraitDragData / hasTraitDragData** — native HTML5 serialization via `dataTransfer.setData("application/persephone-trait", ...)`
- **TreeView dual path** — `TreeCellTrait` (new, native HTML5) alongside `TreeCellLegacy` (React-DnD) dispatched by `TreeCell`
- **Pilot**: link drag in TreeProviderView, LinksList, LinksTiles converted to trait-based

### Current React-DnD usages to convert

| Component | Drag Type | Data Shape | Nature |
|-----------|-----------|-----------|--------|
| `TodoItemView.tsx` | `TODO_ITEM_DRAG` | `{ id }` | Reorder (drag handle + drop zone) |
| `NoteItemView.tsx` | `NOTE_DRAG` | `{ type, noteId }` | Drag source only (drops on category tree) |
| `NotebookEditor.tsx` | `CATEGORY_DRAG` + `NOTE_DRAG` | TreeView legacy props | Category tree accepts both types |
| `RestClientEditor.tsx` | `REST_REQUEST_DRAG` | `{ type, id }` | TreeView legacy props (request tree) |
| `BrowserTabsPanel.tsx` | `BROWSER_TAB_DRAG` | `{ tabId }` | Tab reorder (drag + drop on same element) |
| `PinnedLinksPanel.tsx` | `LINK_PIN_DRAG` | `{ type, index }` | Index-based reorder with above/below feedback |

### TreeView cleanup opportunity

After this task, **no TreeView consumer uses legacy props**. The three TreeView drag consumers:
- `TreeProviderView` — converted in US-444
- `NotebookEditor` — converted here
- `RestClientEditor` — converted here

So `TreeCellLegacy`, the legacy props (`dragType`, `getDragItem`, `dropTypes`, `onDrop`, `canDrop`), and the `DragItem`/`DragType` types can be removed from TreeView. This removes `useDrag`/`useDrop` imports from TreeView.tsx entirely.

### "Explorer files/folders" from task title

Explorer file/folder drag was already converted in US-444 (`TreeProviderView.tsx`). No additional explorer work in this task. Sidebar `FolderItem.tsx` drag is a component-level drag handled in US-449.

## Implementation Plan

### Step 1: Add new TraitTypeIds

**File:** `src/renderer/core/traits/TraitRegistry.ts`

Add entries to the `TraitTypeId` enum:

```typescript
export enum TraitTypeId {
    ILink = "ILink",
    // New in US-447:
    TodoItem = "TodoItem",
    Note = "Note",
    NotebookCategory = "NotebookCategory",
    RestRequest = "RestRequest",
    BrowserTab = "BrowserTab",
    PinnedLink = "PinnedLink",
}
```

### Step 2: Convert NotebookEditor category tree to trait-based TreeView props

The notebook category tree currently accepts two legacy drag types: `NOTE_DRAG` (note dropped on category) and `CATEGORY_DRAG` (category reparenting). With traits, both resolve via `payload.typeId` in the drop handler.

**File:** `src/renderer/editors/notebook/NotebookEditor.tsx` (lines 287-293)

Before:
```typescript
dropTypes={[NOTE_DRAG, CATEGORY_DRAG]}
onDrop={vm.categoryDrop}
dragType={CATEGORY_DRAG}
getDragItem={vm.getCategoryDragItem}
```

After:
```typescript
traitTypeId={TraitTypeId.NotebookCategory}
getDragData={vm.getCategoryDragData}
acceptsDrop
onTraitDrop={vm.categoryTraitDrop}
```

Remove imports: `NOTE_DRAG`, `CATEGORY_DRAG` from `notebookTypes`.
Add imports: `TraitTypeId` from `../../core/traits`.

**File:** `src/renderer/editors/notebook/NotebookViewModel.ts`

Replace `categoryDrop` and `getCategoryDragItem`:

Before (`getCategoryDragItem`, ~line 649):
```typescript
getCategoryDragItem = (item: CategoryTreeItem): DragItem | null => {
    if (!item.category) return null;
    return { type: CATEGORY_DRAG, category: item.category };
};
```

After:
```typescript
getCategoryDragData = (item: CategoryTreeItem): { category: string } | null => {
    if (!item.category) return null;
    return { category: item.category };
};
```

Before (`categoryDrop`, ~line 635):
```typescript
categoryDrop = (dropItem: CategoryTreeItem, dragItem: DragItem) => {
    if (dragItem.type === NOTE_DRAG) {
        this.updateNoteCategory(dragItem.noteId, dropItem.category);
    } else if (dragItem.type === CATEGORY_DRAG) {
        this.moveCategory(dragItem.category, dropItem.category);
    }
};
```

After:
```typescript
categoryTraitDrop = (dropItem: CategoryTreeItem, payload: TraitDragPayload) => {
    if (payload.typeId === TraitTypeId.Note) {
        const data = payload.data as { noteId: string };
        this.updateNoteCategory(data.noteId, dropItem.category);
    } else if (payload.typeId === TraitTypeId.NotebookCategory) {
        const data = payload.data as { category: string };
        this.moveCategory(data.category, dropItem.category);
    }
};
```

Remove imports: `DragItem` from TreeView, `NOTE_DRAG`, `CATEGORY_DRAG` from notebookTypes.
Add imports: `TraitTypeId` from `../../core/traits`, `type { TraitDragPayload }` from `../../core/traits`.

### Step 3: Convert NoteItemView drag to native HTML5

**File:** `src/renderer/editors/notebook/NoteItemView.tsx`

NoteItemView uses `useDrag` with a drag handle on `.note-indicator`. With native HTML5, set `draggable` on the handle element and attach `onDragStart`/`onDragEnd` there.

Before (lines 367-373, 386):
```typescript
const [{ isDragging }, drag] = useDrag({
    type: NOTE_DRAG,
    item: { type: NOTE_DRAG, noteId: note.id },
    collect: (monitor) => ({ isDragging: monitor.isDragging() }),
});
// ...
<div className="note-indicator" ref={(node) => { drag(node); }}>
```

After:
```typescript
const [isDragging, setIsDragging] = useState(false);

const handleDragStart = useCallback((e: React.DragEvent) => {
    e.stopPropagation();
    setTraitDragData(e.dataTransfer, TraitTypeId.Note, { noteId: note.id });
    setIsDragging(true);
}, [note.id]);

const handleDragEnd = useCallback(() => {
    setIsDragging(false);
}, []);
// ...
<div
    className="note-indicator"
    draggable
    onDragStart={handleDragStart}
    onDragEnd={handleDragEnd}
>
```

Remove imports: `useDrag` from `react-dnd`, `NOTE_DRAG` from `notebookTypes`.
Add imports: `useState, useCallback` (if not present), `TraitTypeId, setTraitDragData` from `../../core/traits`.

### Step 4: Convert RestClientEditor TreeView to trait-based props

**File:** `src/renderer/editors/rest-client/RestClientEditor.tsx`

Before (lines 685-721):
```typescript
const REST_REQUEST_DRAG = "rest-request-drag"; // line 26 — local const

const getDragItem = useCallback(
    (item: RequestTreeItem) => {
        if (item.isRoot || item.isCollection) return null;
        return { type: REST_REQUEST_DRAG, id: item.id };
    },
    [],
);

const onDrop = useCallback(
    (dropItem: RequestTreeItem, dragItem: { type: string; id: string }) => {
        if (dropItem.isRoot) return;
        if (dropItem.isCollection) {
            vm.moveRequest(dragItem.id, dropItem.id, dropItem.collectionName ?? "");
        } else {
            vm.moveRequest(dragItem.id, dropItem.id, dropItem.request?.collection);
        }
    },
    [vm],
);
// TreeView props:
dragType={REST_REQUEST_DRAG}
getDragItem={getDragItem}
dropTypes={[REST_REQUEST_DRAG]}
onDrop={onDrop}
```

After:
```typescript
// Remove REST_REQUEST_DRAG const

const getDragData = useCallback(
    (item: RequestTreeItem) => {
        if (item.isRoot || item.isCollection) return null;
        return { id: item.id };
    },
    [],
);

const onTraitDrop = useCallback(
    (dropItem: RequestTreeItem, payload: TraitDragPayload) => {
        if (dropItem.isRoot) return;
        const data = payload.data as { id: string };
        if (dropItem.isCollection) {
            vm.moveRequest(data.id, dropItem.id, dropItem.collectionName ?? "");
        } else {
            vm.moveRequest(data.id, dropItem.id, dropItem.request?.collection);
        }
    },
    [vm],
);
// TreeView props:
traitTypeId={TraitTypeId.RestRequest}
getDragData={getDragData}
acceptsDrop
onTraitDrop={onTraitDrop}
```

Add imports: `TraitTypeId` from `../../core/traits`, `type { TraitDragPayload }` from `../../core/traits`.

### Step 5: Convert BrowserTabsPanel to native HTML5

**File:** `src/renderer/editors/browser/BrowserTabsPanel.tsx`

TabItem uses `useDrag`/`useDrop` with chained refs `drag(drop(node))` on the same element. Convert to native HTML5 events.

Before (lines 185-216):
```typescript
const BROWSER_TAB_DRAG = "BROWSER_TAB_DRAG"; // line 12

const [{ isDragging }, drag] = useDrag({
    type: BROWSER_TAB_DRAG,
    item: { tabId: tab.id },
    collect: (monitor) => ({ isDragging: monitor.isDragging() }),
});

const [{ isOver }, drop] = useDrop({
    accept: BROWSER_TAB_DRAG,
    drop(item: { tabId: string }) { model.moveTab(item.tabId, tab.id); },
    collect: (monitor) => ({ isOver: monitor.isOver() }),
});
// ...
<div ref={(node) => { drag(drop(node)); }} className={cls}>
```

After:
```typescript
// Remove BROWSER_TAB_DRAG const

const [isDragging, setIsDragging] = useState(false);
const [isOver, setIsOver] = useState(false);

const handleDragStart = useCallback((e: React.DragEvent) => {
    e.stopPropagation();
    setTraitDragData(e.dataTransfer, TraitTypeId.BrowserTab, { tabId: tab.id });
    setIsDragging(true);
}, [tab.id]);

const handleDragEnd = useCallback(() => {
    setIsDragging(false);
}, []);

const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (hasTraitDragData(e.dataTransfer)) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setIsOver(true);
    }
}, []);

const handleDragOver = useCallback((e: React.DragEvent) => {
    if (hasTraitDragData(e.dataTransfer)) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
    }
}, []);

const handleDragLeave = useCallback(() => {
    setIsOver(false);
}, []);

const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsOver(false);
    const payload = getTraitDragData(e.dataTransfer);
    if (!payload || payload.typeId !== TraitTypeId.BrowserTab) return;
    const data = payload.data as { tabId: string };
    model.moveTab(data.tabId, tab.id);
}, [model, tab.id]);
// ...
<div
    draggable
    onDragStart={handleDragStart}
    onDragEnd={handleDragEnd}
    onDragEnter={handleDragEnter}
    onDragOver={handleDragOver}
    onDragLeave={handleDragLeave}
    onDrop={handleDrop}
    className={cls}
>
```

Remove imports: `useDrag, useDrop` from `react-dnd`.
Add imports: `useState, useCallback`, `TraitTypeId, setTraitDragData, getTraitDragData, hasTraitDragData` from `../../core/traits`.

### Step 6: Convert TodoItemView to native HTML5

**File:** `src/renderer/editors/todo/components/TodoItemView.tsx`

TodoItemView has separate drag handle (`.drag-handle` span) and drop zone (entire root element). Convert both to native HTML5.

Before (lines 210-250, 337-357):
```typescript
const [{ isDragging }, drag] = useDrag({
    type: TODO_ITEM_DRAG,
    item: { id: item.id },
    collect: (monitor) => ({ isDragging: monitor.isDragging() }),
    canDrag: () => isDraggable,
});

const [{ isOver }, drop] = useDrop({
    accept: TODO_ITEM_DRAG,
    drop(dragItem: { id: string }) {
        if (dragItem.id !== item.id) { pageModel.moveItem(dragItem.id, item.id); }
    },
    collect: (monitor) => ({ isOver: monitor.isOver() && monitor.canDrop() }),
    canDrop: () => isDraggable,
});

// Combine cellRef with drop ref
const setNodeRef = useCallback(
    (node: HTMLDivElement | null) => {
        drop(node);
        nodeRef.current = node;
        if (cellRef) { (cellRef as { current: HTMLDivElement | null }).current = node; }
    },
    [drop, cellRef],
);

const setDragRef = useCallback((node: HTMLSpanElement | null) => { drag(node); }, [drag]);
// ...
<TodoItemRoot ref={setNodeRef} className={clsx(isDragging && "dragging", isOver && "drop-over")}>
    // ...
    <span ref={setDragRef} className="drag-handle" title="Drag to reorder">
```

After:
```typescript
const [isDragging, setIsDragging] = useState(false);
const [isOver, setIsOver] = useState(false);

const handleDragStart = useCallback((e: React.DragEvent) => {
    if (!isDraggable) { e.preventDefault(); return; }
    e.stopPropagation();
    setTraitDragData(e.dataTransfer, TraitTypeId.TodoItem, { id: item.id });
    setIsDragging(true);
}, [item.id, isDraggable]);

const handleDragEnd = useCallback(() => {
    setIsDragging(false);
}, []);

const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (!isDraggable) return;
    if (hasTraitDragData(e.dataTransfer)) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setIsOver(true);
    }
}, [isDraggable]);

const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!isDraggable) return;
    if (hasTraitDragData(e.dataTransfer)) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
    }
}, [isDraggable]);

const handleDragLeave = useCallback(() => {
    setIsOver(false);
}, []);

const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsOver(false);
    if (!isDraggable) return;
    const payload = getTraitDragData(e.dataTransfer);
    if (!payload || payload.typeId !== TraitTypeId.TodoItem) return;
    const data = payload.data as { id: string };
    if (data.id !== item.id) {
        pageModel.moveItem(data.id, item.id);
    }
}, [item.id, isDraggable, pageModel]);

// Combine cellRef with drop zone (no longer needs drop ref)
const setNodeRef = useCallback(
    (node: HTMLDivElement | null) => {
        nodeRef.current = node;
        if (cellRef) { (cellRef as { current: HTMLDivElement | null }).current = node; }
    },
    [cellRef],
);
// ...
<TodoItemRoot
    ref={setNodeRef}
    className={clsx(isDragging && "dragging", isOver && "drop-over")}
    onDragEnter={handleDragEnter}
    onDragOver={handleDragOver}
    onDragLeave={handleDragLeave}
    onDrop={handleDrop}
>
    // ...
    <span
        className="drag-handle"
        title="Drag to reorder"
        draggable={isDraggable}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
    >
```

Remove imports: `useDrag, useDrop` from `react-dnd`, `TODO_ITEM_DRAG` from `todoTypes`.
Add imports: `useState` (if not present), `TraitTypeId, setTraitDragData, getTraitDragData, hasTraitDragData` from `../../../../core/traits`.

### Step 7: Convert PinnedLinksPanel to native HTML5

**File:** `src/renderer/editors/link-editor/PinnedLinksPanel.tsx`

PinnedItem uses index-based reorder with above/below visual feedback. The `dropPosition` logic (determining if drag source index is above or below the hover target) needs special handling since native HTML5 `dragover` doesn't expose payload data.

**Key difference from React-DnD:** During `dragover`, we cannot read `dataTransfer.getData()` (browser security). So we cannot determine `dropPosition` (above/below) based on the drag source index during hover. However, we can track this via module-level state since this is same-component-only drag.

Before (lines 122-183):
```typescript
const [{ isDragging }, drag] = useDrag({
    type: LINK_PIN_DRAG,
    item: { type: LINK_PIN_DRAG, index },
    collect: (monitor) => ({ isDragging: monitor.isDragging() }),
});

const [{ isOver, dropPosition }, drop] = useDrop({
    accept: LINK_PIN_DRAG,
    drop(dragItem: { index: number }) {
        if (dragItem.index !== index) {
            const toIndex = dragItem.index < index ? index : index;
            model.reorderPinnedLink(dragItem.index, toIndex);
        }
    },
    collect: (monitor) => {
        if (!monitor.isOver()) return { isOver: false, dropPosition: "" };
        const dragItem = monitor.getItem<{ index: number }>();
        if (!dragItem || dragItem.index === index) return { isOver: false, dropPosition: "" };
        return {
            isOver: true,
            dropPosition: dragItem.index < index ? "below" : "above",
        };
    },
});
```

After — use a module-level variable to track the dragging index (safe because only one drag at a time):
```typescript
// Module-level: track which index is being dragged (only one drag at a time)
let draggingPinIndex = -1;

function PinnedItem({ ... }: PinnedItemProps) {
    const [isDragging, setIsDragging] = useState(false);
    const [isOver, setIsOver] = useState(false);

    const handleDragStart = useCallback((e: React.DragEvent) => {
        e.stopPropagation();
        draggingPinIndex = index;
        setTraitDragData(e.dataTransfer, TraitTypeId.PinnedLink, { index });
        setIsDragging(true);
    }, [index]);

    const handleDragEnd = useCallback(() => {
        draggingPinIndex = -1;
        setIsDragging(false);
    }, []);

    const handleDragEnter = useCallback((e: React.DragEvent) => {
        if (hasTraitDragData(e.dataTransfer) && draggingPinIndex >= 0 && draggingPinIndex !== index) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            setIsOver(true);
        }
    }, [index]);

    const handleDragOver = useCallback((e: React.DragEvent) => {
        if (hasTraitDragData(e.dataTransfer) && draggingPinIndex >= 0 && draggingPinIndex !== index) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
        }
    }, [index]);

    const handleDragLeave = useCallback(() => {
        setIsOver(false);
    }, []);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsOver(false);
        const payload = getTraitDragData(e.dataTransfer);
        if (!payload || payload.typeId !== TraitTypeId.PinnedLink) return;
        const data = payload.data as { index: number };
        if (data.index !== index) {
            const toIndex = data.index < index ? index : index;
            model.reorderPinnedLink(data.index, toIndex);
        }
    }, [index, model]);

    // dropPosition from module-level draggingPinIndex
    const dropPosition = isOver && draggingPinIndex >= 0 && draggingPinIndex !== index
        ? (draggingPinIndex < index ? "below" : "above")
        : "";

    let className = "pinned-item";
    if (isSelected) className += " selected";
    if (isDragging) className += " dragging";
    if (isOver && dropPosition === "above") className += " drop-above";
    if (isOver && dropPosition === "below") className += " drop-below";
    // ...
    <div
        draggable
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={className}
    >
```

Remove imports: `useDrag, useDrop` from `react-dnd`, `LINK_PIN_DRAG` from `linkTypes`.
Add imports: `useState, useCallback`, `TraitTypeId, setTraitDragData, getTraitDragData, hasTraitDragData` from `../../core/traits`.

### Step 8: Clean up TreeView — remove legacy DnD path

After Steps 2 and 4, no TreeView consumer uses legacy props. Remove the legacy code path.

**File:** `src/renderer/components/TreeView/TreeView.tsx`

1. Remove `TreeCellLegacy` function entirely (lines 119-199)
2. Remove `TreeCell` dispatcher (lines 317-323)
3. Rename `TreeCellTrait` → `TreeCell`
4. Remove `import { useDrag, useDrop } from "react-dnd"` (line 4)
5. Keep all other imports (`setTraitDragData`, `getTraitDragData`, `hasTraitDragData`)

**File:** `src/renderer/components/TreeView/TreeView.model.ts`

1. Remove legacy prop group (lines 66-76): `dropTypes`, `onDrop`, `canDrop`, `dragType`, `getDragItem`
2. Remove `DragType` type alias (lines 6-7)
3. Remove `DragItem` interface (lines 9-13)
4. Keep trait-based props (lines 78-88)

**File:** `src/renderer/components/TreeView/index.ts` (if barrel exports DragItem/DragType)

Check and remove re-exports of `DragItem`/`DragType`.

### Step 9: Clean up unused drag type constants

After all conversions:

| Constant | File | Action |
|----------|------|--------|
| `TODO_ITEM_DRAG` | `todoTypes.ts:73` | Remove |
| `NOTE_DRAG` | `notebookTypes.ts:66` | Remove |
| `CATEGORY_DRAG` | `notebookTypes.ts:69` | Remove |
| `LINK_PIN_DRAG` | `linkTypes.ts:7` | Remove |
| `REST_REQUEST_DRAG` | `RestClientEditor.tsx:26` | Remove (local const) |
| `BROWSER_TAB_DRAG` | `BrowserTabsPanel.tsx:12` | Remove (local const) |

### Step 10: Verify DragItem/DragType imports are gone

After removing from TreeView.model.ts, grep for any remaining imports of `DragItem` or `DragType` from TreeView. If `NotebookViewModel.ts` still imports `DragItem` from TreeView (line 4: `import { CategoryTreeItem, DragItem } from "../../components/TreeView"`), remove that import since `categoryDrop` no longer uses `DragItem`.

### Step 11: Verify and test

1. **Todo reorder**: Open a .todo.json file, drag an undone item by its handle to reorder → should work
2. **Todo done items**: Done items should NOT be draggable
3. **Note drag to category**: Open a .notebook.json, drag a note's indicator dot onto a category in the tree → note should move to that category
4. **Category reparent**: Drag a category onto another category in the notebook tree → should reparent
5. **REST request move**: Open a .rest.json, drag a request onto another collection → should move
6. **Browser tab reorder**: Open the browser editor, drag tabs to reorder → should work
7. **Pinned link reorder**: In link editor, drag pinned links to reorder → above/below visual feedback should show
8. **Link drag (regression)**: Verify link drag in tree, list, and tile views still works (converted in US-444)
9. **React-DnD still works**: Page tabs (Ctrl+Tab reorder), grid column reorder, sidebar folder drag, pinned editor reorder should still function

## Concerns / Open Questions

### 1. PinnedLinksPanel dropPosition during hover (RESOLVED)

Native HTML5 `dragover` cannot read `dataTransfer.getData()` — only `dataTransfer.types` is available. PinnedLinksPanel needs the drag source index to determine above/below visual feedback during hover.

**Resolution:** Use a module-level variable `draggingPinIndex` set during `dragStart`, read during `dragEnter`. This is safe because only one drag operation happens at a time. Same pattern can be used if other components need hover-time payload inspection.

### 2. TreeView cleanup scope (RESOLVED)

Removing legacy TreeView DnD props overlaps with US-449's scope.

**Resolution:** Since ALL legacy prop consumers are converted in this task, it's natural to clean up TreeView here. US-449 then focuses on non-TreeView React-DnD usages (PageTab, HeaderCell, FolderItem, ToolsEditorsPanel) and removing the `react-dnd` dependency from package.json.

### 3. Trait registration at startup

Unlike the LINK trait (which needs cross-type resolution in US-448), the new trait types in US-447 are only used for same-type serialization. They don't need TraitSet registrations in the trait registry — only the TraitTypeId enum values are needed for `setTraitDragData`/`getTraitDragData`. If cross-type drops are added in US-448, trait registrations can be added then.

### 4. Note drag handle ghost image

When `draggable` is set on the small `.note-indicator` element, the browser's default drag ghost will be just that small dot. This matches the current React-DnD behavior (React-DnD HTML5Backend also uses the drag source element as the ghost). No change in visual behavior.

## Acceptance Criteria

- [ ] `TraitTypeId` enum includes: `TodoItem`, `Note`, `NotebookCategory`, `RestRequest`, `BrowserTab`, `PinnedLink`
- [ ] Todo item drag uses native HTML5 with `setTraitDragData(TraitTypeId.TodoItem)`
- [ ] Todo item drop uses `getTraitDragData` and checks `typeId === TraitTypeId.TodoItem`
- [ ] Done todo items are not draggable and not drop targets
- [ ] Note drag uses native HTML5 with `setTraitDragData(TraitTypeId.Note)` on handle
- [ ] Notebook category tree uses trait-based TreeView props (`traitTypeId`, `getDragData`, `acceptsDrop`, `onTraitDrop`)
- [ ] Notebook category tree accepts drops of both `TraitTypeId.Note` and `TraitTypeId.NotebookCategory`
- [ ] REST client request tree uses trait-based TreeView props
- [ ] Browser tab drag uses native HTML5 with `setTraitDragData(TraitTypeId.BrowserTab)`
- [ ] Pinned link drag uses native HTML5 with above/below visual feedback preserved
- [ ] TreeView legacy DnD path removed: no `TreeCellLegacy`, no `useDrag`/`useDrop` imports, no legacy props
- [ ] `DragItem` and `DragType` types removed from TreeView.model.ts
- [ ] Old drag type constants removed: `TODO_ITEM_DRAG`, `NOTE_DRAG`, `CATEGORY_DRAG`, `LINK_PIN_DRAG`, `REST_REQUEST_DRAG`, `BROWSER_TAB_DRAG`
- [ ] React-DnD still works for non-converted components (PageTab, HeaderCell, FolderItem, ToolsEditorsPanel)
- [ ] TypeScript compiles with no new errors
- [ ] ESLint passes with no new warnings

## Files Changed Summary

| File | Action | Description |
|------|--------|-------------|
| `src/renderer/core/traits/TraitRegistry.ts` | **Modify** | Add 6 new TraitTypeId entries |
| `src/renderer/editors/notebook/NotebookEditor.tsx` | **Modify** | Switch TreeView from legacy to trait-based props |
| `src/renderer/editors/notebook/NotebookViewModel.ts` | **Modify** | Replace `categoryDrop`/`getCategoryDragItem` with trait-based versions |
| `src/renderer/editors/notebook/NoteItemView.tsx` | **Modify** | Replace `useDrag` with native HTML5 + `setTraitDragData` |
| `src/renderer/editors/rest-client/RestClientEditor.tsx` | **Modify** | Switch TreeView from legacy to trait-based props; remove `REST_REQUEST_DRAG` |
| `src/renderer/editors/browser/BrowserTabsPanel.tsx` | **Modify** | Replace `useDrag`/`useDrop` with native HTML5; remove `BROWSER_TAB_DRAG` |
| `src/renderer/editors/todo/components/TodoItemView.tsx` | **Modify** | Replace `useDrag`/`useDrop` with native HTML5 (split drag handle + drop zone) |
| `src/renderer/editors/link-editor/PinnedLinksPanel.tsx` | **Modify** | Replace `useDrag`/`useDrop` with native HTML5; module-level `draggingPinIndex` for above/below |
| `src/renderer/components/TreeView/TreeView.tsx` | **Modify** | Remove `TreeCellLegacy`, `useDrag`/`useDrop` imports; rename `TreeCellTrait` → `TreeCell` |
| `src/renderer/components/TreeView/TreeView.model.ts` | **Modify** | Remove legacy props, `DragItem`, `DragType` |
| `src/renderer/editors/todo/todoTypes.ts` | **Modify** | Remove `TODO_ITEM_DRAG` |
| `src/renderer/editors/notebook/notebookTypes.ts` | **Modify** | Remove `NOTE_DRAG`, `CATEGORY_DRAG` |
| `src/renderer/editors/link-editor/linkTypes.ts` | **Modify** | Remove `LINK_PIN_DRAG` |

### Files NOT changed

| File | Reason |
|------|--------|
| `src/renderer/index.tsx` | `DndProvider` stays — PageTab, HeaderCell, FolderItem, ToolsEditorsPanel still use React-DnD |
| `src/renderer/ui/tabs/PageTab.tsx` | US-449 |
| `src/renderer/components/data-grid/AVGrid/HeaderCell.tsx` | US-449 |
| `src/renderer/ui/sidebar/FolderItem.tsx` | US-449 |
| `src/renderer/ui/sidebar/ToolsEditorsPanel.tsx` | US-449 |
| `src/renderer/core/traits/dnd.ts` | No changes needed — existing utilities sufficient |
| `src/renderer/core/traits/index.ts` | No changes needed — TraitTypeId already exported |
| `src/renderer/editors/link-editor/linkTraits.ts` | No changes needed |
| `src/renderer/editors/link-editor/LinksList.tsx` | Already converted in US-444 |
| `src/renderer/editors/link-editor/LinksTiles.tsx` | Already converted in US-444 |
| `src/renderer/components/tree-provider/TreeProviderView.tsx` | Already converted in US-444 |
