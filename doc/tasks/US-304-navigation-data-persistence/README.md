# US-304: Move Persistence Logic from NavPanelModel to NavigationData

**Status:** Planned
**Epic:** EPIC-015 (Phase 3)
**Depends on:** —

## Goal

Move the save/restore/cache logic from NavPanelModel to NavigationData. NavigationData becomes the single owner of persistence, reading and writing the cache file directly. Switch from old `NavPanelModel` to the cleaner `PageNavigatorModel`. The cache file format stays backward-compatible.

## Background

### Current architecture (split persistence)

```
NavigationData (runtime state)
  ├── treeProvider           — runtime only
  ├── selectionState         — runtime, synced TO navModel.selectedHref
  └── pageNavigatorModel     — owns cache file (NavPanelModel)

NavPanelModel (persistence + reactive state) — nav-panel-store.ts
  ├── state: { open, width, rootFilePath, currentFilePath }
  ├── fileExplorerState      — set by PageNavigator, saved to cache
  ├── selectedHref           — synced FROM NavigationData, saved to cache
  ├── searchModel            — runtime only, for old NavigationPanel search
  ├── saveState()            — writes JSON to cache file
  └── restore()              — reads JSON from cache file
```

**Problem:** As we add secondary provider state (US-302), the sync pattern grows. Each new field requires sync methods between NavigationData and NavPanelModel.

### Two competing model files

There are two model files in the navigation folder:

| File | Class | State fields | Status |
|---|---|---|---|
| `nav-panel-store.ts` | `NavPanelModel` | `rootFilePath`, `currentFilePath`, `fileExplorerState`, `selectedHref`, `searchModel` | **Active** — used by NavigationData, PageNavigator |
| `PageNavigatorModel.ts` | `PageNavigatorModel` | `rootPath`, `treeState`, `navigateUp()`, `makeRoot()` | **Unused** — not imported anywhere. Cleaner API with backward-compat migration. |

`PageNavigatorModel` was created as a cleaner replacement but never wired in. It already handles migration from the old `NavPanelModel` cache format.

### Target architecture (unified persistence)

```
NavigationData (runtime state + persistence)
  ├── treeProvider                    — runtime only
  ├── selectionState                  — runtime, persisted by NavigationData
  ├── pageNavigatorModel              — pure reactive state (PageNavigatorModel, no persistence)
  ├── treeState                       — stored here, set by PageNavigator
  ├── save() / restore()             — reads/writes cache file
  └── (future) secondary* fields     — stored here, persisted automatically

PageNavigatorModel (reactive state only, no persistence)
  ├── state: { open, width, rootPath }
  ├── navigateUp(), makeRoot(), toggle(), close()
  └── NO saveState/restore/flushSave
```

### Cache file format (backward-compatible)

Current format (written by NavPanelModel):
```json
{
    "open": true,
    "width": 240,
    "rootFilePath": "C:/projects",
    "currentFilePath": "C:/projects/src/file.ts",
    "fileExplorerState": { "expandedPaths": [...], "selectedFilePath": "..." },
    "selectedHref": "C:/projects/src/file.ts"
}
```

New format (written by NavigationData):
```json
{
    "open": true,
    "width": 240,
    "rootPath": "C:/projects",
    "treeState": { "expandedPaths": [...], "selectedHref": "..." },
    "selectedHref": "C:/projects/src/file.ts"
}
```

`PageNavigatorModel.restore()` already handles reading both old and new formats (migrates `rootFilePath` → `rootPath`, `fileExplorerState` → `treeState`). We move this migration logic to NavigationData.

## Implementation Plan

### Phase A: Wire in PageNavigatorModel, move persistence to NavigationData

### Step 1: Move persistence to NavigationData

Add to NavigationData:
```typescript
private id: string | undefined;
private name = "nav-panel";  // same cache file name for compatibility
treeState: TreeProviderViewSavedState | undefined;

async restore(pageId: string): Promise<void> {
    this.id = pageId;
    const data = await fs.getCacheFile(pageId, this.name);
    const saved = parseObject(data);
    if (saved) {
        // Backward compat: migrate old format
        const rootPath = saved.rootPath || saved.rootFilePath || "";
        const treeState = saved.treeState || (saved.fileExplorerState?.expandedPaths
            ? { expandedPaths: saved.fileExplorerState.expandedPaths }
            : undefined);
        const selectedHref = saved.selectedHref ?? null;

        // Restore model state
        const navModel = this.ensurePageNavigatorModel();
        navModel.setStateQuiet({ open: saved.open ?? true, width: saved.width ?? 240, rootPath });
        // Restore NavigationData state
        this.treeState = treeState;
        this.selectionState.set({ selectedHref });
        this._rootPath = rootPath;
    }
}

private saveState = async (): Promise<void> => {
    if (!this.id) return;
    const navState = this.pageNavigatorModel?.state.get();
    const saved = {
        open: navState?.open ?? true,
        width: navState?.width ?? 240,
        rootPath: navState?.rootPath ?? this._rootPath,
        treeState: this.treeState,
        selectedHref: this.selectionState.get().selectedHref,
    };
    await fs.saveCacheFile(this.id, JSON.stringify(saved), this.name);
};

private saveStateDebounced = debounce(this.saveState, 300);
```

Subscribe to `navModel.state` changes to trigger saves (open/width/rootPath changes).

### Step 2: Switch NavigationData from NavPanelModel to PageNavigatorModel

Change:
```typescript
// Before
import { NavPanelModel } from "./nav-panel-store";
pageNavigatorModel: NavPanelModel | null = null;

// After
import { PageNavigatorModel } from "./PageNavigatorModel";
pageNavigatorModel: PageNavigatorModel | null = null;
```

`PageNavigatorModel` already has `toggle()`, `close()`, `setWidth()`, `navigateUp()`, `makeRoot()`, `reinitIfEmpty()`.

Remove persistence methods from `PageNavigatorModel`: `saveState()`, `saveStateDebounced`, `flushSave()`, `restore()`, state subscription for auto-save. Add `setStateQuiet()` for restore without triggering saves.

### Step 3: Update PageNavigator.tsx

Replace field names:
- `navModel.state.use()` — `rootFilePath` → `rootPath` (from PageNavigatorModel)
- `navModel.fileExplorerState` → `navigationData.treeState`
- `navModel.setFileExplorerState(...)` → `navigationData.setTreeState(...)`
- `navModel.navigateUp` / `navModel.makeRoot` — already on PageNavigatorModel

Remove `handleNavigateUp` and `handleMakeRoot` logic from PageNavigator — delegate to `navModel.navigateUp()` and `navModel.makeRoot(newRoot)`.

### Step 4: Update NavigationData methods

```typescript
setSelectedHref(href: string | null): void {
    this.selectionState.update((s) => { s.selectedHref = href; });
    this.saveStateDebounced();
}

setTreeState(state: TreeProviderViewSavedState): void {
    this.treeState = state;
    this.saveStateDebounced();
}

updateId(newPageId: string): void {
    this.id = newPageId;
    this.pageNavigatorModel?.updateId(newPageId);
    this.saveStateDebounced();
}

flushSave(): Promise<void> {
    return this.saveState();
}
```

### Step 5: Update PagesLifecycleModel references

- Line 269: `p.navigationData?.pageNavigatorModel?.state.get().rootFilePath` → `.rootPath`
- Line 456: `navigationData.pageNavigatorModel?.setCurrentFilePath(newFilePath)` → remove (legacy, replaced by `selectedHref`)

### Step 6: Update PageModel.ensureNavigationData

Currently calls `navModel.flushSave()`. After refactoring, call `navigationData.flushSave()`.

### Phase B: Clean up old NavPanelModel

### Step 7: Keep NavPanelModel as reference (do NOT delete)

`NavPanelModel` in `nav-panel-store.ts` is kept for Phase 8 cleanup. It contains:
- `searchModel: NavigationSearchModel` — used by old NavigationPanel search (will be reimplemented in CategoryView)
- Old file explorer patterns — useful as reference

Old NavigationPanel.tsx (dead code) still references NavPanelModel. Both are removed together in Phase 8.

### Step 8: Verify all persistence scenarios

- App restart: state restores correctly (test with both old and new cache formats)
- Page navigation (navigatePageTo): NavigationData transfers, id updates, saves with new pageId
- Panel open/close: triggers save
- Tree expand/collapse: triggers save via `setTreeState`
- Selection change: triggers save
- Navigate up / make root: triggers save

## Resolved Concerns

### 1. Two competing model files — switch to PageNavigatorModel

Switch from `NavPanelModel` to `PageNavigatorModel`. The newer model has a cleaner API (`rootPath` vs `rootFilePath`, `treeState` vs `fileExplorerState`, built-in `navigateUp`/`makeRoot`). It already handles backward-compatible migration from old cache format.

### 2. NavPanelModel.searchModel — keep on old NavPanelModel

`searchModel` is used only by the old NavigationPanel (dead code). All search functionality will be reimplemented in CategoryView (Phase 5). Keep `NavPanelModel` as reference — removed in Phase 8 along with NavigationPanel.

### 3. setCurrentFilePath — legacy, remove

`currentFilePath` on NavPanelModel is the old version of `selectedHref`. Used only by:
- Old NavigationPanel (dead code) — for FileExplorer `selectedFilePath` prop
- `PagesLifecycleModel.navigatePageTo` (line 456) — sets it on navigation

The new PageNavigator uses `navigationData.selectionState.selectedHref` instead. Remove the `setCurrentFilePath` call in PagesLifecycleModel. `currentFilePath` is not persisted in the new format.

### 4. NavPanelModel state subscription triggers saves — NavigationData subscribes

NavigationData subscribes to `navModel.state` changes and calls `saveStateDebounced`. This way when PageNavigator updates open/width/rootPath via the model, NavigationData auto-saves.

## Files Changed

| File | Change |
|---|---|
| `src/renderer/ui/navigation/NavigationData.ts` | Add save/restore logic, treeState, subscribe to navModel state, switch to PageNavigatorModel |
| `src/renderer/ui/navigation/PageNavigatorModel.ts` | Remove persistence (saveState, restore, flushSave), add setStateQuiet() |
| `src/renderer/ui/navigation/PageNavigator.tsx` | Use `navigationData.treeState`, `navModel.rootPath`, delegate navigateUp/makeRoot to model |
| `src/renderer/api/pages/PagesLifecycleModel.ts` | Update `rootFilePath` → `rootPath`, remove `setCurrentFilePath` call |
| `src/renderer/editors/base/PageModel.ts` | Update `ensureNavigationData` to call `navigationData.flushSave()` |

## Files NOT Changed (kept for Phase 8 cleanup)

- `src/renderer/ui/navigation/nav-panel-store.ts` — kept as reference for search model
- `src/renderer/ui/navigation/NavigationPanel.tsx` — dead code, kept as reference
- `src/renderer/ui/navigation/NavigationSearchModel.ts` — used by old NavigationPanel

## Acceptance Criteria

- [ ] NavigationData handles save/restore to cache file
- [ ] PageNavigatorModel has no persistence logic
- [ ] NavPanelModel kept as reference (not deleted)
- [ ] Cache file format backward-compatible (old app can still read, new app reads old format)
- [ ] App restart restores all navigation state correctly
- [ ] Page navigation (navigatePageTo) preserves state
- [ ] Panel open/close persists
- [ ] Tree expansion state persists
- [ ] Selection state persists
- [ ] `npm start` runs without type errors
- [ ] `npm run lint` passes
