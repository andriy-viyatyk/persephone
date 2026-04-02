# US-324: Clean up EditorModel

**Epic:** [EPIC-017](../../epics/EPIC-017.md) Phase 4
**Status:** Planned
**Created:** 2026-04-03

## Goal

Final cleanup pass for EPIC-017. Remove deprecated methods, update stale comments referencing `NavigationData`, and mark remaining Phase 4 items as done in the epic (they were completed during US-322/US-323).

## Background

EPIC-017 Phase 4 was planned as 5 tasks (4.1–4.5), but most work was already completed during Phase 2 (US-322) and Phase 3 (US-323):

| Phase 4 item | Original plan | Actual status |
|---|---|---|
| 4.1 Clean up EditorModel | Remove `navigationData`, `ownerPage`, etc. | **Done in US-322** — all fields removed |
| 4.2 Update script API wrappers | `page.id` returns page ID, content proxies | **Done in US-322** — PageWrapper/PageCollectionWrapper adapted |
| 4.3 Update MCP handler | `pageId` = page ID | **Done in US-322** — mcp-handler uses PageModel IDs |
| 4.4 Remove workarounds | `renderId`, `getStableKey`, `updateId()`, NavigationData | **Done in US-322/US-323** — all removed |
| 4.5 Update documentation | pages-architecture.md, diagrams, CLAUDE.md | **Done in US-322/US-323** — docs updated in completion steps |

What remains is minor cleanup that wasn't caught during those larger tasks:

1. **Stale `NavigationData` comments** in `PageNavigatorModel.ts`
2. **Deprecated `createPageFromFile`** method — no callers, just delegates to `createEditorFromFile`
3. **Stale `NavigationData` backward-compat comment** in `PageModel.ts` sidebar cache name
4. **EPIC-017 task table** — mark Phase 4 items as Done

## Implementation Plan

### Step 1: Update stale comments in PageNavigatorModel.ts

**File:** [src/renderer/ui/navigation/PageNavigatorModel.ts](../../../src/renderer/ui/navigation/PageNavigatorModel.ts)

Line 25 — Change:
```
 * Persistence is owned by NavigationData (not this model).
```
To:
```
 * Persistence is owned by PageModel (not this model).
```

Line 38 — Change:
```
 * Set state without triggering subscriptions. Used by NavigationData.restore().
```
To:
```
 * Set state without triggering subscriptions. Used by PageModel.restoreSidebar().
```

### Step 2: Remove deprecated `createPageFromFile`

**File:** [src/renderer/api/pages/PagesLifecycleModel.ts](../../../src/renderer/api/pages/PagesLifecycleModel.ts#L102)

Remove lines 102-105:
```typescript
/** @deprecated Use createEditorFromFile. Kept for backward compat of public delegate. */
createPageFromFile = async (filePath: string, pipe?: IContentPipe): Promise<EditorModel> => {
    return this.createEditorFromFile(filePath, pipe);
};
```

**File:** [src/renderer/api/pages/PagesModel.ts](../../../src/renderer/api/pages/PagesModel.ts#L189)

Remove the delegate (lines 189-190):
```typescript
createPageFromFile = (filePath: string) =>
    this.lifecycle.createPageFromFile(filePath);
```

No callers exist — verified: not in script API types (`assets/`), not in any source files except the definition and delegate.

### Step 3: Clean up backward-compat comment in PageModel.ts

**File:** [src/renderer/api/pages/PageModel.ts](../../../src/renderer/api/pages/PageModel.ts#L107)

Line 107 — Change:
```typescript
private _cacheName = "nav-panel"; // same file name for backward compat with NavigationData
```
To:
```typescript
private _cacheName = "nav-panel";
```

Also in `PageSidebarSavedState` interface, lines 36-39 — Remove backward-compat fields and comment:
```typescript
// Backward compat: old NavigationData format
rootFilePath?: string;
currentFilePath?: string;
fileExplorerState?: { expandedPaths?: string[]; selectedFilePath?: string };
```

And update `restoreSidebar()` (line 433-438) to remove the old-format migration:
```typescript
// Backward compat: migrate old NavigationData/NavPanelModel format
const rootPath = saved.rootPath || saved.rootFilePath || "";
const treeState = saved.treeState || (saved.fileExplorerState?.expandedPaths
    ? { ... }
    : undefined);
```
Simplify to:
```typescript
const rootPath = saved.rootPath || "";
```

Since v3.0.1 is a breaking change with no migration (per EPIC-017 Decision D), old NavigationData cache files are already ignored on first launch. Any user who has upgraded and opened files will have new-format cache. The backward-compat code was never needed.

### Step 4: Update EPIC-017 Phase 4 task table

**File:** [doc/epics/EPIC-017.md](../../epics/EPIC-017.md#L220)

Mark all Phase 4 items as Done, referencing US-322/US-323/US-324:

```
| 4.1–4.5 | [US-324](../tasks/US-324-clean-up-editor-model/README.md) | Phase 4 cleanup | Stale comments updated, deprecated `createPageFromFile` removed, backward-compat code removed. Phase 4 items (4.1–4.4) were already completed in US-322/US-323. | Done |
```

## Concerns / Open Questions

None — this is straightforward cleanup.

## Acceptance Criteria

- [ ] No `NavigationData` references in source code comments (except historical doc/ files)
- [ ] `createPageFromFile` removed from PagesLifecycleModel and PagesModel
- [ ] Backward-compat fields removed from `PageSidebarSavedState`
- [ ] `restoreSidebar()` no longer has old-format migration code
- [ ] EPIC-017 Phase 4 marked as Done
- [ ] TypeScript compiles clean (only pre-existing WorkerRunner errors)

## Files Changed Summary

| File | Change |
|------|--------|
| `src/renderer/ui/navigation/PageNavigatorModel.ts` | Update 2 stale comments |
| `src/renderer/api/pages/PagesLifecycleModel.ts` | Remove `createPageFromFile` |
| `src/renderer/api/pages/PagesModel.ts` | Remove `createPageFromFile` delegate |
| `src/renderer/api/pages/PageModel.ts` | Remove backward-compat comment, old-format fields, migration code |
| `doc/epics/EPIC-017.md` | Mark Phase 4 as Done |
