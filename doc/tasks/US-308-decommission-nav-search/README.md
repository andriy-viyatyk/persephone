# US-308: Decommission NavigationPanel Search

**Status:** In Progress
**Epic:** EPIC-015 (Phase 4)
**Depends on:** US-307 (Search panel in PageNavigator)

## Goal

Remove old NavigationPanel and its search infrastructure. All 4 files are dead code — no imports anywhere in the codebase. Replaced by PageNavigator + FileSearch.

## Files Deleted

| File | Reason |
|---|---|
| `src/renderer/ui/navigation/NavigationPanel.tsx` | Replaced by PageNavigator.tsx |
| `src/renderer/ui/navigation/nav-panel-store.ts` | Replaced by PageNavigatorModel.ts + NavigationData persistence |
| `src/renderer/ui/navigation/NavigationSearchModel.ts` | Replaced by FileSearchModel.ts |
| `src/renderer/ui/navigation/SearchResultsPanel.tsx` | Replaced by FileSearch component |

## Files Kept

- `FileExplorerSavedState` in `file-explorer/` — still used by FileExplorer component (Phase 6 cleanup)
- `fileExplorer.itemContextMenu` event — still re-fired by tree-context-menus.tsx for script compatibility
- `file-explorer/` component — still used by sidebar MenuBar (already migrated to TreeProviderView but component files kept for Phase 6)

## Acceptance Criteria

- [ ] All 4 files deleted
- [ ] No import errors
- [ ] `npm start` runs without type errors
- [ ] `npm run lint` passes
