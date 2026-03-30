# US-310: Remove Old FileExplorer Component

**Status:** Planned
**Epic:** EPIC-015 (Phase 6)

## Goal

Delete the old `FileExplorer` component (4 files). It has been fully replaced by `TreeProviderView` + `FileTreeProvider` since US-300.

## Files to Delete

| File | Lines | Reason |
|---|---|---|
| `src/renderer/components/file-explorer/FileExplorer.tsx` | ~260 | Replaced by TreeProviderView |
| `src/renderer/components/file-explorer/FileExplorerModel.tsx` | ~800 | Replaced by FileTreeProvider + tree-context-menus |
| `src/renderer/components/file-explorer/file-tree-builder.ts` | ~200 | Replaced by ITreeProvider.list() |
| `src/renderer/components/file-explorer/index.ts` | ~4 | Barrel export |

**No external imports** — confirmed via grep. Only internal cross-references within the 4 files.

## Cleanup in Other Files

### 1. MenuBar.tsx — rename `fileExplorerRef`

The field `fileExplorerRef` and method `setFileExplorerRef` in `MenuBarModel` still use the old name but already hold `TreeProviderViewRef`. Rename to `treeViewRef` / `setTreeViewRef`.

- `src/renderer/ui/sidebar/MenuBar.tsx` lines 188, 194, 487, 497

### 2. Keep: `app.events.fileExplorer` event channel

**Do NOT remove.** This is a public script API — scripts subscribe to `app.events.fileExplorer.itemContextMenu` to add custom context menu items. The compatibility bridge in `tree-context-menus.tsx` (line 70-82) re-fires TreeProviderView context menu events to this channel. Must keep:

- `src/renderer/api/events/AppEvents.ts` — `FileExplorerEvents` class, `app.events.fileExplorer`
- `src/renderer/api/types/events.d.ts` — `IFileExplorerEvents` interface, examples
- `src/renderer/content/tree-context-menus.tsx` — compatibility bridge (lines 70-82)
- `src/renderer/api/events/events.ts` — `"file-explorer-item"` / `"file-explorer-background"` target kinds

### 3. Keep: NavigationData backward-compat migration

`NavigationData.ts` line 44 and lines 295-301 read old `fileExplorerState` from persisted cache and convert to `treeState`. This is a one-time migration for users upgrading — safe to keep for now.

## Concerns

None. The component has zero external imports. The event channel and migration code are intentionally kept for backward compatibility.

## Acceptance Criteria

- [ ] All 4 files deleted
- [ ] `fileExplorerRef` renamed to `treeViewRef` in MenuBar.tsx
- [ ] No import errors (`npm start` runs)
- [ ] `npm run lint` passes
