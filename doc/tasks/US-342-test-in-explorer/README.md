# US-342: Test in Explorer — Fixes and Adjustments

**Epic:** EPIC-018 (Phase 0, Task 0.6)
**Status:** Done

## Goal

Manual testing of Phase 0 tile mode implementation. Fix discrepancies and adjustments found during testing.

## Fixes Applied

1. **Toolbar layout** — ExplorerFolderEditor portal target changed from `width: 200` to flex row with gap, so search input and view mode button sit inline.

2. **Root node collapse disabled** — Added guard in `TreeViewModel.toggleExpanded()`: when `rootCollapsible` is false and item is at level 0, toggle is skipped. Affects Explorer, Zip, and Link category panels.

3. **Click behavior** — CategoryViewModel `onItemClick` now always calls `props.onItemClick` (for both files and folders). ExplorerFolderEditor: single click selects, double click navigates. Folders also require double click to enter.

4. **".." parent navigation** — `FileTreeProvider.list()` prepends a `".."` directory entry pointing to the parent folder, except when listing the root path.

5. **First tile switch column fix** — Added `onResize={setGridSize}` to list-mode RenderGrid in CategoryView, so grid width is known before switching to tile mode.

## Files Changed

| File | Change |
|------|--------|
| `src/renderer/editors/category/ExplorerFolderEditor.tsx` | Toolbar flex layout, split select/navigate handlers, pass selectedHref |
| `src/renderer/components/TreeView/TreeView.model.ts` | Guard root node toggle |
| `src/renderer/components/tree-provider/CategoryViewModel.tsx` | Single click always calls onItemClick |
| `src/renderer/components/tree-provider/CategoryView.tsx` | onResize on list-mode grid |
| `src/renderer/content/tree-providers/FileTreeProvider.ts` | ".." parent entry |
