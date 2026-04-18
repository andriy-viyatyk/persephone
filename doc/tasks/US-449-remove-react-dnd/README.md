# US-449: Remove React-DnD dependency — convert component-level drags to native HTML5

**Epic:** [EPIC-026 — Trait System](../../epics/EPIC-026.md)
**Status:** Active
**Created:** 2026-04-18

## Goal

Convert the 4 remaining React-DnD usages (page tabs, grid column headers, sidebar folders, pinned editors) to native HTML5 drag-and-drop using the trait system's serialization utilities. Then remove `react-dnd` and `react-dnd-html5-backend` from the project entirely.

## Background

### What remains

After US-447 converted all data drags, exactly 4 components still use React-DnD's `useDrag`/`useDrop` hooks — all for same-window UI reordering:

| Component | File | Drag Type | Purpose |
|-----------|------|-----------|---------|
| PageTab | `src/renderer/ui/tabs/PageTab.tsx` | `"COLUMN_DRAG"` | Reorder page tabs |
| HeaderCell | `src/renderer/components/data-grid/AVGrid/HeaderCell.tsx` | `"COLUMN_DRAG"` | Reorder grid columns |
| FolderItem | `src/renderer/ui/sidebar/FolderItem.tsx` | `"FOLDER_DRAG"` | Reorder sidebar folders |
| PinnedItem | `src/renderer/ui/sidebar/ToolsEditorsPanel.tsx` | `"PINNED_EDITOR_DRAG"` | Reorder pinned editors |

The `DndProvider` wrapper lives in `src/renderer/index.tsx` and must be removed last.

### Shared drag type: COLUMN_DRAG

PageTab and HeaderCell both use `"COLUMN_DRAG"`. This means a tab drag could theoretically land on a grid header (or vice versa). This is unintentional — the type name was likely copy-pasted. After conversion, each gets its own `TraitTypeId`, cleanly separating them.

### Dead code: FREEZE_DRAG

Both PageTab and HeaderCell accept `["COLUMN_DRAG", "FREEZE_DRAG"]`, but **no component ever drags with type `"FREEZE_DRAG"`**. It is dead code — not carried forward.

### PageTab dual-drag complexity

PageTab is the most complex because it uses **both** React-DnD and native HTML5 drag on the same element:
- **React-DnD** (`useDrag`/`useDrop`): same-window tab reorder via `"COLUMN_DRAG"` type
- **Native** (`onDragStart`/`onDragEnd`/`onDrop`): cross-window tab movement via `"application/persephone-tab"` MIME type, plus "drag outside all windows" to create a new window

After conversion, both behaviors use native HTML5 events exclusively. The trait MIME type (`"application/persephone-trait"`) handles same-window reorder, while the existing `"application/persephone-tab"` MIME type continues to handle cross-window movement. Both data types are set on the same `DataTransfer` in `onDragStart`.

**Pinned tabs:** Currently, React-DnD makes pinned tabs draggable for reorder (it overrides `draggable={false}` internally), but they have no native drag handlers (no cross-window support). After conversion, pinned tabs get `draggable` for reorder but do NOT set `"application/persephone-tab"` data (preventing cross-window movement and the "drag outside" new-window behavior).

### PinnedItem live-reorder pattern

`PinnedItem` uses React-DnD's `hover` callback (fires continuously during drag-over) to trigger `onMove(dragIndex, hoverIndex)` for live reordering — items swap positions as the mouse moves, not on drop. The native HTML5 equivalent uses `onDragOver` (also fires continuously). A module-level variable tracks the current drag index, updated after each move to prevent duplicate calls.

### Trait system consistency

All 4 components use `setTraitDragData`/`getTraitDragData`/`hasTraitDragData` for serialization, matching the pattern established in US-444 and US-447. This keeps drag serialization uniform across the entire app, even for same-window-only reorders.

### Comments referencing react-dnd

4 files have comments mentioning `react-dnd` (the `e.stopPropagation()` calls added to prevent HTML5Backend from cancelling native drags). These comments need updating since the HTML5Backend is removed. The `stopPropagation()` calls themselves remain — they prevent parent elements from interfering with nested drags, which is still good defensive practice.

## Implementation Plan

### Step 1: Add new TraitTypeIds

**File:** `src/renderer/core/traits/TraitRegistry.ts`

Add 4 entries to the `TraitTypeId` enum:

```typescript
export enum TraitTypeId {
    ILink = "ILink",
    TodoItem = "TodoItem",
    Note = "Note",
    NotebookCategory = "NotebookCategory",
    RestRequest = "RestRequest",
    BrowserTab = "BrowserTab",
    PinnedLink = "PinnedLink",
    // New in US-449:
    PageTab = "PageTab",
    GridColumn = "GridColumn",
    MenuFolder = "MenuFolder",
    PinnedEditor = "PinnedEditor",
}
```

### Step 2: Convert PageTab.tsx

**File:** `src/renderer/ui/tabs/PageTab.tsx`

**Imports — remove:**
```typescript
import { useDrag, useDrop } from "react-dnd";
```

**Imports — add:**
```typescript
import { useState, useCallback, useRef } from "react";  // merge with existing "useMemo" import
import { TraitTypeId, setTraitDragData, getTraitDragData, hasTraitDragData } from "../../core/traits";
```

**Remove** the `useDrag` and `useDrop` hook calls (lines 546-565):
```typescript
// DELETE these blocks:
const [{ isDragging }, drag] = useDrag({ ... });
const [{ isOver }, drop] = useDrop({ ... });
```

**Add** state and handlers in the `PageTab` function component (after the `id` line):
```typescript
const [isOver, setIsOver] = useState(false);
const dragEnterCount = useRef(0);

const handleDragEnter = useCallback((e: React.DragEvent) => {
    dragEnterCount.current++;
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
    dragEnterCount.current--;
    if (dragEnterCount.current <= 0) {
        dragEnterCount.current = 0;
        setIsOver(false);
    }
}, []);
```

**Modify `handleDragStart`** in PageTabModel (line 447-453):

Before:
```typescript
handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData(
        "application/persephone-tab",
        JSON.stringify(this.getDragData())
    );
    e.dataTransfer.effectAllowed = "move";
};
```

After:
```typescript
handleDragStart = (e: React.DragEvent) => {
    const page = this.props.model;
    // Trait data for same-window tab reorder (all tabs)
    setTraitDragData(e.dataTransfer, TraitTypeId.PageTab, { key: page.id });
    // Persephone-tab data for cross-window movement (non-pinned only)
    if (!page.pinned) {
        e.dataTransfer.setData(
            "application/persephone-tab",
            JSON.stringify(this.getDragData())
        );
    }
};
```
Note: `setTraitDragData` already sets `effectAllowed = "move"`.

**Modify `handleDragEnd`** in PageTabModel (line 455-466) — add early return for pinned:

Before:
```typescript
handleDragEnd = (e: React.DragEvent) => {
    const droppedOutside = ...
    if (droppedOutside) { ... }
};
```

After:
```typescript
handleDragEnd = (e: React.DragEvent) => {
    if (this.props.model.pinned) return;
    const droppedOutside =
        e.clientX < 0 ||
        e.clientX > window.innerWidth ||
        e.clientY < 0 ||
        e.clientY > window.innerHeight;
    if (droppedOutside) {
        const dropData: PageDragData = this.getDragData();
        dropData.dropPosition = { x: e.screenX, y: e.screenY };
        api.addDragEvent(dropData);
    }
};
```

**Modify `handleDrop`** in PageTabModel (line 468-480) — add same-window reorder:

Before:
```typescript
handleDrop = (e: React.DragEvent) => {
    const dataStr = e.dataTransfer?.getData("application/persephone-tab");
    const data = parseObject(dataStr);
    if (
        data &&
        data.sourceWindowIndex !== undefined &&
        data.sourceWindowIndex !== appWindow.windowIndex
    ) {
        api.addDragEvent(this.getDragData(true));
        e.preventDefault();
        e.stopPropagation();
    }
};
```

After:
```typescript
handleDrop = (e: React.DragEvent) => {
    const id = this.props.model.id;
    // Cross-window tab movement (check first — has priority)
    const dataStr = e.dataTransfer?.getData("application/persephone-tab");
    const tabData = parseObject(dataStr);
    if (
        tabData &&
        tabData.sourceWindowIndex !== undefined &&
        tabData.sourceWindowIndex !== appWindow.windowIndex
    ) {
        api.addDragEvent(this.getDragData(true));
        e.preventDefault();
        e.stopPropagation();
        return;
    }
    // Same-window tab reorder
    const payload = getTraitDragData(e.dataTransfer);
    if (payload?.typeId === TraitTypeId.PageTab) {
        const data = payload.data as { key: string };
        if (data.key !== id) {
            pagesModel.moveTab(data.key, id);
        }
        e.preventDefault();
        e.stopPropagation();
    }
};
```

**Update JSX** (lines 577-599):

Before:
```tsx
<PageTabRoot
    ref={(node) => {
        drag(node);
        drop(node);
    }}
    className={clsx("page-tab", {
        ...
        isDraggOver: isOver,
        ...
    })}
    ...
    draggable={!pinned}
    onDragStart={pinned ? undefined : tabModel.handleDragStart}
    onDragEnd={pinned ? undefined : tabModel.handleDragEnd}
    onDrop={pinned ? undefined : tabModel.handleDrop}
>
```

After:
```tsx
<PageTabRoot
    className={clsx("page-tab", {
        ...
        isDraggOver: isOver,
        ...
    })}
    ...
    draggable
    onDragStart={tabModel.handleDragStart}
    onDragEnd={tabModel.handleDragEnd}
    onDrop={tabModel.handleDrop}
    onDragEnter={handleDragEnter}
    onDragOver={handleDragOver}
    onDragLeave={handleDragLeave}
>
```

Key changes: remove `ref` callback (React-DnD refs no longer needed), always `draggable`, always attach all handlers (no pinned conditional).

### Step 3: Convert HeaderCell.tsx

**File:** `src/renderer/components/data-grid/AVGrid/HeaderCell.tsx`

**Imports — remove:**
```typescript
import { useDrag, useDrop } from "react-dnd";
```

**Imports — add:**
```typescript
import { useState } from "react";  // merge with existing useCallback, useRef
import { TraitTypeId, setTraitDragData, getTraitDragData, hasTraitDragData } from "../../../../core/traits";
```

**Remove** the `useDrag` and `useDrop` hook calls (lines 165-186).

**Add** state and handlers:
```typescript
const [isDragging, setIsDragging] = useState(false);
const [isOver, setIsOver] = useState(false);
const dragEnterCount = useRef(0);

const handleDragStart = useCallback((e: React.DragEvent) => {
    if (column.isStatusColumn || resizingRef.current) {
        e.preventDefault();
        return;
    }
    setTraitDragData(e.dataTransfer, TraitTypeId.GridColumn, { key: column.key });
    setIsDragging(true);
}, [column.key, column.isStatusColumn]);

const handleDragEnd = useCallback(() => {
    setIsDragging(false);
}, []);

const handleDragEnter = useCallback((e: React.DragEvent) => {
    dragEnterCount.current++;
    if (!column.isStatusColumn && hasTraitDragData(e.dataTransfer)) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setIsOver(true);
    }
}, [column.isStatusColumn]);

const handleGridDragOver = useCallback((e: React.DragEvent) => {
    if (!column.isStatusColumn && hasTraitDragData(e.dataTransfer)) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
    }
}, [column.isStatusColumn]);

const handleDragLeave = useCallback(() => {
    dragEnterCount.current--;
    if (dragEnterCount.current <= 0) {
        dragEnterCount.current = 0;
        setIsOver(false);
    }
}, []);

const handleGridDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragEnterCount.current = 0;
    setIsOver(false);
    if (column.isStatusColumn) return;
    const payload = getTraitDragData(e.dataTransfer);
    if (payload?.typeId === TraitTypeId.GridColumn) {
        const data = payload.data as { key: string };
        model.actions.columnsReorder(data.key, column.key as string);
    }
}, [column.key, column.isStatusColumn, model]);
```

**Update JSX ref callback** (lines 222-226):

Before:
```tsx
ref={(ref) => {
    headerRef.current = ref as HTMLElement;
    drag(ref);
    drop(ref);
}}
```

After:
```tsx
ref={(ref) => {
    headerRef.current = ref as HTMLElement;
}}
```

**Add native handlers and `draggable` to the `HeaderCellRoot` element:**
```tsx
<HeaderCellRoot
    ref={...}
    draggable={!column.isStatusColumn}
    onDragStart={handleDragStart}
    onDragEnd={handleDragEnd}
    onDragEnter={handleDragEnter}
    onDragOver={handleGridDragOver}
    onDragLeave={handleDragLeave}
    onDrop={handleGridDrop}
    className={clsx("header-cell", {
        "header-resizible": column.resizible,
        "is-dragging": isDragging,
        "is-over": isOver,
    })}
    ...
>
```

### Step 4: Convert FolderItem.tsx

**File:** `src/renderer/ui/sidebar/FolderItem.tsx`

**Imports — remove:**
```typescript
import { useDrag, useDrop } from "react-dnd";
```

**Remove constant:**
```typescript
const FOLDER_DRAG_TYPE = "FOLDER_DRAG";  // DELETE
```

**Imports — add:**
```typescript
import { useState } from "react";  // merge with existing
import { TraitTypeId, setTraitDragData, getTraitDragData, hasTraitDragData } from "../../core/traits";
```

**Remove** the `useDrag` and `useDrop` hook calls (lines 77-97) and the `drag(drop(ref))` call (line 99).

**Add** state and handlers:
```typescript
const [isDragging, setIsDragging] = useState(false);
const [isOver, setIsOver] = useState(false);
const dragEnterCount = useRef(0);

const handleFolderDragStart = useCallback((e: React.DragEvent) => {
    if (!canDrag) { e.preventDefault(); return; }
    e.stopPropagation();
    setTraitDragData(e.dataTransfer, TraitTypeId.MenuFolder, { id: folder.id });
    setIsDragging(true);
}, [canDrag, folder.id]);

const handleDragEnd = useCallback(() => {
    setIsDragging(false);
}, []);

const handleDragEnter = useCallback((e: React.DragEvent) => {
    dragEnterCount.current++;
    if (canDrop && hasTraitDragData(e.dataTransfer)) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setIsOver(true);
    }
}, [canDrop]);

const handleDragOver = useCallback(
    (e: React.DragEvent) => {
        if (!canDrop) {
            e.dataTransfer.dropEffect = "none";
            return;
        }
        if (hasTraitDragData(e.dataTransfer)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
        }
    },
    [canDrop],
);

const handleDragLeave = useCallback(() => {
    dragEnterCount.current--;
    if (dragEnterCount.current <= 0) {
        dragEnterCount.current = 0;
        setIsOver(false);
    }
}, []);

const handleFolderDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragEnterCount.current = 0;
    setIsOver(false);
    if (!canDrop) return;
    const payload = getTraitDragData(e.dataTransfer);
    if (payload?.typeId === TraitTypeId.MenuFolder) {
        const data = payload.data as { id: string };
        if (data.id !== folder.id && folder.id) {
            menuFolders.move(data.id, folder.id);
        }
    }
}, [canDrop, folder.id]);
```

**Update JSX** — change `ref` usage:

Before:
```tsx
<FolderItemRoot
    ref={ref}
    ...
    onDragOver={handleDragOver}
>
```

After:
```tsx
<FolderItemRoot
    ref={ref}
    draggable={canDrag}
    onDragStart={handleFolderDragStart}
    onDragEnd={handleDragEnd}
    onDragEnter={handleDragEnter}
    onDragOver={handleDragOver}
    onDragLeave={handleDragLeave}
    onDrop={handleFolderDrop}
    className={clsx("list-item", {
        selected,
        dragging: isDragging,
        "drag-over": isOver,
    })}
    ...
>
```

### Step 5: Convert ToolsEditorsPanel.tsx (PinnedItem)

**File:** `src/renderer/ui/sidebar/ToolsEditorsPanel.tsx`

**Imports — remove:**
```typescript
import { useDrag, useDrop } from "react-dnd";
```

**Remove constant:**
```typescript
const PINNED_DRAG_TYPE = "PINNED_EDITOR_DRAG";  // DELETE
```

**Imports — add:**
```typescript
import { useState } from "react";  // merge with existing
import { TraitTypeId, setTraitDragData, hasTraitDragData, getTraitDragData } from "../../core/traits";
```

**Add module-level variable** (before PinnedItem function):
```typescript
/** Tracks which index is being dragged. Only one drag at a time. */
let draggingPinnedEditorIndex = -1;
```

**Replace** PinnedItem's hook calls (lines 134-154) with native handlers:

```typescript
function PinnedItem({ item, index, onUnpin, onClick, onMove }: {
    item: CreatableItem;
    index: number;
    onUnpin: (id: string) => void;
    onClick: (item: CreatableItem) => void;
    onMove: (dragIndex: number, hoverIndex: number) => void;
}) {
    const ref = useRef<HTMLDivElement>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [isOver, setIsOver] = useState(false);

    const handleDragStart = useCallback((e: React.DragEvent) => {
        e.stopPropagation();
        draggingPinnedEditorIndex = index;
        setTraitDragData(e.dataTransfer, TraitTypeId.PinnedEditor, { index });
        setIsDragging(true);
    }, [index]);

    const handleDragEnd = useCallback(() => {
        draggingPinnedEditorIndex = -1;
        setIsDragging(false);
        setIsOver(false);
    }, []);

    const handleDragEnter = useCallback((e: React.DragEvent) => {
        if (hasTraitDragData(e.dataTransfer) && draggingPinnedEditorIndex >= 0 && draggingPinnedEditorIndex !== index) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            setIsOver(true);
        }
    }, [index]);

    // Live reorder on dragOver — matches React-DnD's hover() behavior
    const handleDragOver = useCallback((e: React.DragEvent) => {
        if (draggingPinnedEditorIndex >= 0 && draggingPinnedEditorIndex !== index) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            onMove(draggingPinnedEditorIndex, index);
            draggingPinnedEditorIndex = index; // Update after swap
        }
    }, [index, onMove]);

    const handleDragLeave = useCallback(() => {
        setIsOver(false);
    }, []);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsOver(false);
    }, []);

    // ... rest of PinnedItem (handleUnpin, JSX)
```

**Update JSX:**

Before:
```tsx
<div
    ref={ref}
    className={`item-row${isDragging ? " dragging" : ""}${isOver ? " drag-over" : ""}`}
    onClick={() => onClick(item)}
>
    <span className="drag-handle">&#x22EE;&#x22EE;</span>
    ...
```

After:
```tsx
<div
    ref={ref}
    draggable
    onDragStart={handleDragStart}
    onDragEnd={handleDragEnd}
    onDragEnter={handleDragEnter}
    onDragOver={handleDragOver}
    onDragLeave={handleDragLeave}
    onDrop={handleDrop}
    className={`item-row${isDragging ? " dragging" : ""}${isOver ? " drag-over" : ""}`}
    onClick={() => onClick(item)}
>
    <span className="drag-handle">&#x22EE;&#x22EE;</span>
    ...
```

### Step 6: Remove DndProvider from index.tsx

**File:** `src/renderer/index.tsx`

**Remove imports:**
```typescript
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
```

**Remove wrapper:**

Before:
```tsx
<DndProvider backend={HTML5Backend}>
    <GlobalStyles />
    <MainPage />
    <Dialogs />
    <Progress />
    <AlertsBar />
    <Poppers />
</DndProvider>
```

After:
```tsx
<>
    <GlobalStyles />
    <MainPage />
    <Dialogs />
    <Progress />
    <AlertsBar />
    <Poppers />
</>
```

### Step 7: Remove react-dnd packages

**File:** `package.json`

Remove these two entries from `dependencies`:
```json
"react-dnd": "^16.0.1",
"react-dnd-html5-backend": "^16.0.1",
```

Run `npm install` to update `package-lock.json`.

### Step 8: Update comments referencing react-dnd

4 files have `e.stopPropagation()` calls with comments about react-dnd. Update the comments (keep the calls — they're defensive).

**File:** `src/renderer/components/TreeView/TreeView.tsx` (line 134)

Before: `e.stopPropagation(); // Prevent react-dnd HTML5Backend from cancelling native drag`
After: `e.stopPropagation(); // Prevent parent elements from interfering with this drag`

**File:** `src/renderer/editors/link-editor/LinksList.tsx` (line 130)

Before: `e.stopPropagation(); // Prevent react-dnd HTML5Backend from cancelling native drag`
After: `e.stopPropagation(); // Prevent parent elements from interfering with this drag`

**File:** `src/renderer/editors/link-editor/LinksTiles.tsx` (line 181)

Before: `e.stopPropagation(); // Prevent react-dnd HTML5Backend from cancelling native drag`
After: `e.stopPropagation(); // Prevent parent elements from interfering with this drag`

**File:** `src/renderer/editors/browser/BrowserTabsPanel.tsx` (line 155)

Before: `// Tab Item (extracted for react-dnd hooks)`
After: `// Tab Item`

### Step 9: Verify and test

1. **Tab reorder (same-window)**: Drag a tab to another position in the tab bar. Both pinned and non-pinned.
2. **Tab detach (new window)**: Drag a non-pinned tab outside the window. Should create a new window.
3. **Tab cross-window**: Drag a non-pinned tab from window A to window B's tab bar. Should move the page.
4. **Grid column reorder**: Open a grid editor, drag column headers to reorder. Status columns should not be draggable.
5. **Folder reorder**: In the sidebar, drag folders to reorder (when `canDrag`/`canDrop` are true).
6. **Pinned editor reorder**: Open the tools/editors panel, drag pinned items. Live reorder during drag.
7. **Existing trait drags (regression)**: Link drag, note drag, todo drag, REST request drag, browser tab drag, pinned link drag — all should still work.
8. **File drops (regression)**: Drop a file from OS explorer onto the app. Should still open.
9. **TypeScript**: `npm run lint` passes with no new errors.

## Concerns / Open Questions

### 1. PageTab pinned state and draggable attribute (RESOLVED)

Currently, React-DnD overrides the `draggable={false}` attribute on pinned tabs — they're still draggable via React-DnD for same-window reorder, just not via native HTML5 for cross-window. After conversion, pinned tabs get `draggable` (always true) with `handleDragStart` that only sets trait data (no persephone-tab data). `handleDragEnd` returns early for pinned tabs, preventing the "drag outside → new window" behavior.

### 2. PinnedItem live-reorder via dragOver (RESOLVED)

React-DnD's `hover` callback fires continuously. The native equivalent is `onDragOver`. After each `onMove(dragIndex, hoverIndex)`, we update `draggingPinnedEditorIndex = hoverIndex` so subsequent dragOver events on the same element don't re-trigger. The check `draggingPinnedEditorIndex !== index` prevents duplicate calls.

### 3. GlobalEventService.handleDragOver interference (RESOLVED)

GlobalEventService calls `e.preventDefault()` on ALL dragover events at the document level. This is benign — it just tells the browser "this is a drop target." Our component-level handlers also call `preventDefault` for trait drags. Both are needed; they don't conflict. The global handler uses `stopPropagation` but that only affects handlers higher than `document` (none exist).

### 4. Cross-window reorder detection (RESOLVED)

When a tab is dragged cross-window, the drop handler sees both `"application/persephone-trait"` AND `"application/persephone-tab"` data (both set in `handleDragStart`). We check `persephone-tab` FIRST for cross-window detection (using `sourceWindowIndex !== appWindow.windowIndex`). If it's a cross-window drop, we handle it via `addDragEvent` and return. Only if it's NOT cross-window do we check trait data for same-window reorder.

## Acceptance Criteria

- [ ] `TraitTypeId` enum includes: `PageTab`, `GridColumn`, `MenuFolder`, `PinnedEditor`
- [ ] PageTab uses native HTML5 with `setTraitDragData(TraitTypeId.PageTab)` for same-window reorder
- [ ] PageTab non-pinned tabs also set `"application/persephone-tab"` for cross-window
- [ ] PageTab pinned tabs are draggable (reorder) but do NOT detach or move cross-window
- [ ] PageTab drop handles both cross-window (persephone-tab) and same-window (trait) cases
- [ ] HeaderCell uses native HTML5 with `setTraitDragData(TraitTypeId.GridColumn)` for column reorder
- [ ] HeaderCell respects `canDrag` (`!isStatusColumn && !resizing`) and `canDrop` (`!isStatusColumn`)
- [ ] FolderItem uses native HTML5 with `setTraitDragData(TraitTypeId.MenuFolder)` for folder reorder
- [ ] FolderItem respects `canDrag`/`canDrop` props
- [ ] PinnedItem uses native HTML5 with live reorder during drag (matching React-DnD hover behavior)
- [ ] `DndProvider` removed from `src/renderer/index.tsx`
- [ ] `react-dnd` and `react-dnd-html5-backend` removed from `package.json`
- [ ] No `useDrag`/`useDrop`/`DndProvider` imports remain in source code
- [ ] Comments referencing `react-dnd` updated
- [ ] `FREEZE_DRAG` dead code not carried forward
- [ ] Existing trait-based drags still work (link, note, todo, REST, browser tab, pinned link)
- [ ] File drops from OS still work
- [ ] TypeScript compiles with no new errors
- [ ] ESLint passes with no new warnings

## Files Changed Summary

| File | Action | Description |
|------|--------|-------------|
| `src/renderer/core/traits/TraitRegistry.ts` | **Modify** | Add 4 new TraitTypeIds |
| `src/renderer/ui/tabs/PageTab.tsx` | **Modify** | Replace useDrag/useDrop with native HTML5; merge with existing cross-window handlers |
| `src/renderer/components/data-grid/AVGrid/HeaderCell.tsx` | **Modify** | Replace useDrag/useDrop with native HTML5 |
| `src/renderer/ui/sidebar/FolderItem.tsx` | **Modify** | Replace useDrag/useDrop with native HTML5; remove FOLDER_DRAG_TYPE |
| `src/renderer/ui/sidebar/ToolsEditorsPanel.tsx` | **Modify** | Replace useDrag/useDrop with native HTML5; module-level dragging index; remove PINNED_DRAG_TYPE |
| `src/renderer/index.tsx` | **Modify** | Remove DndProvider wrapper and imports |
| `package.json` | **Modify** | Remove react-dnd and react-dnd-html5-backend |
| `src/renderer/components/TreeView/TreeView.tsx` | **Modify** | Update comment (line 134) |
| `src/renderer/editors/link-editor/LinksList.tsx` | **Modify** | Update comment (line 130) |
| `src/renderer/editors/link-editor/LinksTiles.tsx` | **Modify** | Update comment (line 181) |
| `src/renderer/editors/browser/BrowserTabsPanel.tsx` | **Modify** | Update comment (line 155) |

### Files NOT changed

| File | Reason |
|------|--------|
| `src/renderer/core/traits/dnd.ts` | No changes needed — existing utilities sufficient |
| `src/renderer/core/traits/index.ts` | No changes needed — TraitTypeId already exported |
| `src/renderer/api/internal/GlobalEventService.ts` | No changes needed — global drag handlers stay as-is |
| `src/renderer/editors/todo/components/TodoItemView.tsx` | Already converted in US-447 |
| `src/renderer/editors/notebook/NoteItemView.tsx` | Already converted in US-447 |
| `src/renderer/editors/link-editor/PinnedLinksPanel.tsx` | Already converted in US-447 |
