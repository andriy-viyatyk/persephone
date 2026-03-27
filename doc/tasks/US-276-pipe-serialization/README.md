# US-276: Pipe Serialization

## Status

**Status:** Planned
**Priority:** High
**Epic:** EPIC-012
**Started:** —
**Completed:** —

## Summary

Add `pipe` property to `PageModel` and `IPageState`. Implement save/restore of pipe descriptors so content pipes survive app restart.

## Why

- US-268 (TextFileIOModel migration) needs pages to own pipes and restore them
- Pipe descriptor must be saved in `WindowState` alongside existing page state
- Legacy pages (no pipe descriptor, only `filePath`) must still restore correctly

## Acceptance Criteria

- [ ] `IPageState.pipe?: IPipeDescriptor` added to shared types
- [ ] `PageModel.pipe?: IContentPipe` property added
- [ ] `getRestoreData()` includes `pipe.toDescriptor()` when pipe exists
- [ ] `applyRestoreData()` reconstructs pipe from descriptor via `createPipeFromDescriptor()`
- [ ] `dispose()` disposes pipe
- [ ] Legacy restore (filePath only, no pipe) still works
- [ ] No regressions in existing functionality

## Files to Modify

| File | Change |
|------|--------|
| `src/shared/types.ts` | Add `pipe?` to `IPageState` |
| `src/renderer/editors/base/PageModel.ts` | Add `pipe` property, update `getRestoreData`/`applyRestoreData`/`dispose` |

## Related

- Epic: [EPIC-012](../../epics/EPIC-012.md)
- Depends on: US-262 (ContentPipe, createPipeFromDescriptor)
- Needed by: US-268 (TextFileIOModel migration)
