# US-330: Search as Explorer panel

**Status:** Planned
**Epic:** [EPIC-019](../../epics/EPIC-019.md) — Explorer as Secondary Editor + Multi-Panel Support (Phase 2, Task 2.3)

## Goal

Fix the remaining gaps so that search works correctly as a secondary panel of ExplorerEditorModel. The core mechanism (openSearch/closeSearch modifying `secondaryEditor[]`, SearchSecondaryEditor component) was implemented in US-328/US-329, but several integration issues remain: activePanel doesn't switch when search opens/closes, search state and tree state aren't persisted across restarts, and the search panel needs to expand automatically when opened.

## Background

### What already works (from US-328/US-329)

- `ExplorerEditorModel.openSearch(folder?)` — creates `searchState`, adds `"search"` to `secondaryEditor[]`
- `ExplorerEditorModel.closeSearch()` — clears `searchState`, removes `"search"` from `secondaryEditor[]`
- `SearchSecondaryEditor` — portals header (title + close button), renders `FileSearch` component
- `ExplorerSecondaryEditor` — has Search button in header, context menu "Search in Folder"
- Registration: `"search"` → `SearchSecondaryEditor` in SecondaryEditorRegistry

### What's missing

1. **`activePanel` not updated** — When search opens, `activePanel` should switch to `"search"` so the search panel expands. When search closes, it should switch back to `"explorer"`. Currently `openSearch()`/`closeSearch()` only modify `secondaryEditor[]` but don't touch `page.activePanel`.

2. **Search state not persisted** — `searchState`, `treeState`, and `selectionState` are plain fields on ExplorerEditorModel, not part of `getRestoreData()`. They're lost on app restart. The old PageModel persisted them in the sidebar cache. ExplorerEditorModel should persist them too.

3. **`expandSecondaryPanel` for search** — When search opens, the "search" panel should expand. The `expandSecondaryPanel` event (used by ZipEditorModel to auto-expand "zip-tree") could be used here. Or `openSearch()` could set `page.activePanel` directly.

### Key files

- **ExplorerEditorModel:** [src/renderer/editors/explorer/ExplorerEditorModel.ts](../../src/renderer/editors/explorer/ExplorerEditorModel.ts)
- **SearchSecondaryEditor:** [src/renderer/editors/explorer/SearchSecondaryEditor.tsx](../../src/renderer/editors/explorer/SearchSecondaryEditor.tsx)
- **ExplorerSecondaryEditor:** [src/renderer/editors/explorer/ExplorerSecondaryEditor.tsx](../../src/renderer/editors/explorer/ExplorerSecondaryEditor.tsx)
- **PageModel:** [src/renderer/api/pages/PageModel.ts](../../src/renderer/api/pages/PageModel.ts) — `activePanel`, `setActivePanel()`
- **expandSecondaryPanel event:** [src/renderer/core/state/events.ts:60](../../src/renderer/core/state/events.ts)

### How `expandSecondaryPanel` works

`expandSecondaryPanel.send(panelId)` → PageModel subscription checks if `panelId` is in any secondary editor's `secondaryEditor[]` → sets `activePanel` and bumps `secondaryEditorsVersion`. This is used by ZipEditorModel to auto-expand "zip-tree" after navigation.

ExplorerEditorModel can use the same mechanism: after adding "search" to `secondaryEditor[]`, fire `expandSecondaryPanel.send("search")` to expand the search panel.

### How persistence worked before (old PageModel)

In old `PageSidebarSavedState`:
```typescript
{
    treeState?: TreeProviderViewSavedState;   // tree expansion
    selectedHref?: string | null;             // selection
    searchState?: FileSearchState;            // search query + results
}
```

These were saved in `_saveState()` and restored in `restoreSidebar()`. Now they need to be in ExplorerEditorModel's `getRestoreData()`/`applyRestoreData()`.

**Challenge:** `getRestoreData()` returns `Partial<ExplorerEditorModelState>` which extends `IEditorState`. But `treeState`, `searchState`, and `selectionState` are not part of `IEditorState` — they're plain fields. We need to include them as extra fields in the serialized data (using `as any` cast like ZipEditorModel does for `archiveUrl`).

## Implementation Plan

**Note:** Persistence of treeState, selectionState, and searchState is deferred to a separate task (added to epic Phase 4). This task only fixes the panel expand/collapse behavior.

### Step 1: Update `openSearch` to expand the search panel

**File:** [src/renderer/editors/explorer/ExplorerEditorModel.ts:65-83](../../src/renderer/editors/explorer/ExplorerEditorModel.ts)

```typescript
// Before:
openSearch(folder?: string): void {
    // ... create searchState ...
    if (!this.secondaryEditor?.includes("search")) {
        this.secondaryEditor = ["explorer", "search"];
    }
}

// After:
openSearch(folder?: string): void {
    // ... create searchState ...
    if (!this.secondaryEditor?.includes("search")) {
        this.secondaryEditor = ["explorer", "search"];
    }
    // Expand the search panel
    expandSecondaryPanel.send("search");
}
```

Import `expandSecondaryPanel` from `../../core/state/events`.

### Step 2: Update `closeSearch` to switch back to explorer

**File:** [src/renderer/editors/explorer/ExplorerEditorModel.ts:85-90](../../src/renderer/editors/explorer/ExplorerEditorModel.ts)

```typescript
// Before:
closeSearch(): void {
    this.searchState = undefined;
    if (this.secondaryEditor?.includes("search")) {
        this.secondaryEditor = ["explorer"];
    }
}

// After:
closeSearch(): void {
    this.searchState = undefined;
    if (this.secondaryEditor?.includes("search")) {
        this.secondaryEditor = ["explorer"];
    }
    // Switch back to explorer panel
    expandSecondaryPanel.send("explorer");
}
```

### Step 3: Persistence — deferred

Persistence of `treeState`, `selectionState`, and `searchState` is tracked in a separate task (Phase 4). For now, these are lost on app restart.

## Concerns

### 1. Persistence — RESOLVED: Separate task

Persistence of treeState, selectionState, and searchState (including results) is deferred to a separate task in Phase 4. This task focuses only on panel expand/collapse behavior.

### 2. `expandSecondaryPanel` timing — RESOLVED: Use setTimeout like ZipEditorModel

ZipEditorModel wraps the event in `setTimeout(() => expandSecondaryPanel.send("zip-tree"), 0)` to defer until after the panel is registered. ExplorerEditorModel should do the same for search — but since `openSearch()` modifies `secondaryEditor[]` synchronously before firing the event, the panel registration (via the setter) happens first. A `setTimeout` may still be needed if the PageModel subscription fires before the version counter bumps. Use `setTimeout` for safety.

## Acceptance Criteria

- [ ] Clicking Search button in Explorer header opens search panel AND expands it
- [ ] Clicking Close in Search header closes search panel AND switches back to Explorer
- [ ] Context menu "Search in Folder" opens scoped search AND expands it

## Files Changed

| File | Change |
|------|--------|
| `src/renderer/editors/explorer/ExplorerEditorModel.ts` | `openSearch`/`closeSearch` fire `expandSecondaryPanel`, `getRestoreData`/`applyRestoreData` persist treeState/selectionState/searchState |

## Files That Need NO Changes

| File | Reason |
|------|--------|
| `src/renderer/editors/explorer/SearchSecondaryEditor.tsx` | Already complete |
| `src/renderer/editors/explorer/ExplorerSecondaryEditor.tsx` | Already complete |
| `src/renderer/api/pages/PageModel.ts` | `expandSecondaryPanel` subscription already handles panel ID expansion |
| `src/renderer/ui/navigation/PageNavigator.tsx` | Already syncs activePanel from PageModel |
