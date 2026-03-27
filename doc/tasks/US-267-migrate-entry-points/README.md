# US-267: Migrate Entry Points

## Status

**Status:** Planned
**Priority:** High
**Epic:** EPIC-012
**Started:** —
**Completed:** —

## Summary

Replace all `pagesModel.openFile()` call sites with `app.events.openRawLink.sendAsync()` so that all file opening flows through the link pipeline. `PagesModel.openFile()` becomes a thin redirect to the pipeline (for backward compatibility with scripts).

## Call sites to migrate

| # | File | Line | Current call | Action |
|---|------|------|-------------|--------|
| 1 | `RendererEventsService.ts` | 37 | `pagesModel.openFile(filePath)` | → `openRawLink` |
| 2 | `PagesPersistenceModel.ts` | 101 | `this.model.lifecycle.openFile(fileToOpen)` | → `openRawLink` |
| 3 | `RecentFileList.tsx` | 37 | `pagesModel.openFile(item.filePath)` | → `openRawLink` |
| 4 | `RecentFileList.tsx` | 49 | `pagesModel.openFile(item.filePath)` | → `openRawLink` |
| 5 | `MenuBar.tsx` | 486 | `pagesModel.openFile(filePath)` | → `openRawLink` |
| 6 | `ScriptLibraryPanel.tsx` | 95 | `pagesModel.openFile(filePath)` | → `openRawLink` |
| 7 | `FileExplorerModel.tsx` | 530 | `pagesModel.openFile(item.filePath)` | → `openRawLink` |
| 8 | `SettingsPage.tsx` | 1307 | `pagesModel.openFile(filePath)` | → `openRawLink` |
| 9 | `ScriptPanel.tsx` | 335 | `pagesModel.openFile(selectedScript)` | → `openRawLink` |
| 10 | `PagesModel.ts` | 163 | `openFile` method definition | → redirect to `openRawLink` |

**NOT changed:**
- `open-handler.ts:27` — Bridge handler (calls `lifecycle.openFile`, the internal method)
- `PagesLifecycleModel.ts:269` — Inside `openFileWithDialog` (internal, called after file dialog)
- `PageCollectionWrapper.ts:54` — Delegates to PagesModel which now goes through pipeline

## Acceptance Criteria

- [ ] All 9 external entry points fire `openRawLink` instead of `pagesModel.openFile()`
- [ ] `PagesModel.openFile()` redirects to `openRawLink` (scripts still work)
- [ ] `PagesLifecycleModel.openFile()` remains as internal method (used by bridge handler)
- [ ] All file opening flows through the three-layer pipeline
- [ ] No regressions in existing functionality

## Related

- Epic: [EPIC-012](../../epics/EPIC-012.md)
- Depends on: US-264, US-265, US-266 (full pipeline wired)
