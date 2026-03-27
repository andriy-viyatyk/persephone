# US-266: Open Handler

## Status

**Status:** Planned
**Priority:** High
**Epic:** EPIC-012
**Started:** —
**Completed:** —

## Summary

Implement Layer 3 handler on `app.events.openContent`. The handler creates or navigates a page based on the event's pipe, target, and metadata.

## Why

- Layer 3 is the final step of the link pipeline — it opens content in the editor
- Without this handler, the pipeline produces events but nothing opens

## Background

### Phase B bridge approach

At this stage, pages still use `filePath`-based I/O (via `TextFileIOModel.restore()`). The handler is a bridge:
1. Extract `filePath` from `pipe.provider.sourceUrl`
2. Delegate to existing `pagesModel.openFile()` or `pagesModel.navigatePageTo()`
3. Dispose the pipe (not yet used for content loading — that's US-268)

When US-268 migrates TextFileIOModel to pipe-based I/O, the handler will pass the pipe directly to the page.

### Handler behavior

- If `metadata.pageId` exists → navigate existing page to the file path
- Else → check for already-open page with same filePath → show it, or create new page

## Acceptance Criteria

- [ ] Open handler registered on `openContent`
- [ ] New pages created when no `metadata.pageId` and file not already open
- [ ] Existing page navigated when `metadata.pageId` provided
- [ ] Already-open files shown (not duplicated)
- [ ] Pipe disposed after use (bridge — content still loaded via filePath)
- [ ] Registered during bootstrap (before scripts)
- [ ] No regressions in existing functionality

## Implementation Plan

### Step 1: Create open handler

File: `src/renderer/content/open-handler.ts`

### Step 2: Register during bootstrap

Add `registerOpenHandler()` call in `app.ts` alongside parsers and resolvers.

## Files to Create/Modify

| File | Change |
|------|--------|
| `src/renderer/content/open-handler.ts` | **NEW** — `registerOpenHandler()` |
| `src/renderer/api/app.ts` | Call `registerOpenHandler()` during bootstrap |

## Related

- Epic: [EPIC-012](../../epics/EPIC-012.md)
- Depends on: US-263 (link event channels)
- Needed by: US-267 (migrate entry points)
