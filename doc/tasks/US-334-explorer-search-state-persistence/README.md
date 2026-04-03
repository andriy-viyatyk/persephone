# US-334: Explorer/Search state persistence

**Status:** Planned
**Epic:** [EPIC-019](../../epics/EPIC-019.md) — Explorer as Secondary Editor + Multi-Panel Support (Phase 4, Task 4.2)

## Goal

Persist ExplorerEditorModel's `treeState` (folder expansion), `selectionState` (highlighted item), and `searchState` (query, filters, results) across app restarts. Currently these are lost when the app closes.

## Background

### What's persisted today

`ExplorerEditorModel.getRestoreData()` currently serializes only `rootPath` (via `ExplorerEditorModelState`). The three additional state fields are plain instance fields, not part of `IEditorState`:

| Field | Type | Current persistence |
|-------|------|---|
| `rootPath` | `ExplorerEditorModelState.rootPath` | Persisted (in IEditorState) |
| `treeState` | `TreeProviderViewSavedState` (`{ expandedPaths: string[], selectedHref?: string }`) | **Lost** |
| `selectionState` | `TOneState<NavigationState>` (`{ selectedHref: string \| null }`) | **Lost** |
| `searchState` | `FileSearchState` (`{ query, includePattern, excludePattern, showFilters, searchFolder, results[], totalMatches, totalFiles }`) | **Lost** |

### How persistence works

1. `PageModel._saveState()` calls `model.getRestoreData()` on each secondary editor → serializes to JSON → saved as `SecondaryModelDescriptor` in sidebar cache
2. On restore: `PageModel.restoreSecondaryEditors()` calls `model.applyRestoreData(data)` → reconstructs state from JSON
3. `model.restore()` is called after `applyRestoreData()` → registers secondary panels based on state

### Approach

Add extra fields to `getRestoreData()` output using `_` prefix convention (they're not part of `IEditorState` but travel in the same JSON). `applyRestoreData()` reads them back.

### Key file

- **ExplorerEditorModel:** [src/renderer/editors/explorer/ExplorerEditorModel.ts](../../src/renderer/editors/explorer/ExplorerEditorModel.ts) — the only file to change

## Implementation Plan

### Step 1: Update `getRestoreData()`

**File:** [src/renderer/editors/explorer/ExplorerEditorModel.ts:131-136](../../src/renderer/editors/explorer/ExplorerEditorModel.ts)

```typescript
// Before:
getRestoreData(): Partial<ExplorerEditorModelState> {
    return {
        ...super.getRestoreData(),
        rootPath: this.rootPath,
    };
}

// After:
getRestoreData(): Partial<ExplorerEditorModelState> {
    const data: any = { // eslint-disable-line @typescript-eslint/no-explicit-any
        ...super.getRestoreData(),
        rootPath: this.rootPath,
    };
    if (this.treeState) data._treeState = this.treeState;
    const selectedHref = this.selectionState.get().selectedHref;
    if (selectedHref) data._selectedHref = selectedHref;
    if (this.searchState) data._searchState = this.searchState;
    return data;
}
```

### Step 2: Update `applyRestoreData()`

**File:** [src/renderer/editors/explorer/ExplorerEditorModel.ts:138-143](../../src/renderer/editors/explorer/ExplorerEditorModel.ts)

```typescript
// Before:
applyRestoreData(data: Partial<ExplorerEditorModelState>): void {
    super.applyRestoreData(data as any);
    if (data.rootPath) {
        this.state.update((s) => { s.rootPath = data.rootPath!; });
    }
}

// After:
applyRestoreData(data: Partial<ExplorerEditorModelState>): void {
    super.applyRestoreData(data as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    if (data.rootPath) {
        this.state.update((s) => { s.rootPath = data.rootPath!; });
    }
    const extra = data as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (extra._treeState) this.treeState = extra._treeState;
    if (extra._selectedHref) this.selectionState.set({ selectedHref: extra._selectedHref });
    if (extra._searchState) this.searchState = extra._searchState;
}
```

## Concerns

None. The `_` prefix pattern for extra serialized fields is consistent with how `ZipEditorModel` adds `archiveUrl` outside of `IEditorState`. The data is JSON-serializable (plain objects, strings, arrays).

## Acceptance Criteria

- [ ] Tree expansion state (expanded folders) survives app restart
- [ ] Selection state (highlighted file) survives app restart
- [ ] Search state (query, filters, folder scope, results) survives app restart
- [ ] Search panel reappears after restart if it was open
- [ ] No TypeScript compilation errors

## Files Changed

| File | Change |
|------|--------|
| `src/renderer/editors/explorer/ExplorerEditorModel.ts` | `getRestoreData` serializes treeState/selectionState/searchState, `applyRestoreData` restores them |

## Files That Need NO Changes

| File | Reason |
|------|--------|
| `src/renderer/api/pages/PageModel.ts` | Already calls getRestoreData/applyRestoreData on secondary editors |
| `src/renderer/editors/explorer/ExplorerSecondaryEditor.tsx` | Already reads treeState/selectionState |
| `src/renderer/editors/explorer/SearchSecondaryEditor.tsx` | Already reads searchState |
