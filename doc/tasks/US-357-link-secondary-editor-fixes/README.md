# US-357: LinkEditor as Secondary Editor — Fixes and Adjustments

**Epic:** EPIC-018 (Phase 2)
**Status:** Done
**Created:** 2026-04-05

## Goal

Fix issues discovered after US-355 (standalone link collection page) and US-356 (multi-file drop handler).

## Issues Fixed

### 1. Link collection content lost after app restart (cache write)

**Root cause:** In `openLinks()`, `changeContent(content)` was called before `restore()`. The `cachePipe` is created during `restore()`, so the debounced cache write was a no-op.

**Fix:** Swap `changeContent()` and `restore()` order in `openLinks()`.

### 2. Secondary editors not restored for pages without mainEditor

**Root cause:** `PagesPersistenceModel.restoreState()` called `restoreSidebar()` but never `restoreSecondaryEditors()` for sidebar-only pages (no mainEditor). Also, `restoreSecondaryEditors(ownerEditor)` required non-null parameter.

**Fix:** Made `ownerEditor` nullable. Added `restoreSecondaryEditors(null)` call. Removed guard in `movePageIn()`.

### 3. Page-level cache files not cleaned up on close

**Root cause:** `PageModel.dispose()` disposed editors (which clean their own cache) but never deleted page-level cache (`{pageId}_nav-panel.txt`).

**Fix:** Added `fs.deleteCacheFiles(this.id)` to `PageModel.dispose()`.

### 4. Clicked link not highlighted in "Links" panel

**Root cause:** `LinkCategoryPanel` only tracked `selectedCategory` (folder selection). Individual link items were never highlighted.

**Fix:** Added `selectedItemHref` local state. When `categoriesOnly=false`, tracks clicked item href and passes it as `selectedHref` to TreeProviderView.

### 5. CategoryEditor shows "Please select a category" for link collections

**Root cause:** `CategoryEditor.findTreeProviderHost()` scans secondary editors for `treeProvider` and `selectionState` properties. TextFileModel doesn't have these — the `LinkTreeProvider` lives inside `LinkViewModel` (a ContentViewModel created on-demand).

**Fix:** `LinkCategorySecondaryEditor` now exposes `treeProvider` and `selectionState` on the TextFileModel via duck-typing when it's a secondary editor (not mainEditor). CategoryEditor discovers it.

## Files Changed

| File | Change |
|------|--------|
| `src/renderer/api/pages/PagesLifecycleModel.ts` | Fix #1: swap changeContent/restore. Fix #2: remove guard in movePageIn() |
| `src/renderer/api/pages/PageModel.ts` | Fix #2: nullable ownerEditor. Fix #3: cache cleanup in dispose() |
| `src/renderer/api/pages/PagesPersistenceModel.ts` | Fix #2: call restoreSecondaryEditors(null) for sidebar-only pages |
| `src/renderer/editors/link-editor/panels/LinkCategoryPanel.tsx` | Fix #4: selectedItemHref state + highlight |
| `src/renderer/editors/link-editor/panels/LinkCategorySecondaryEditor.tsx` | Fix #5: expose treeProvider/selectionState duck-type |
