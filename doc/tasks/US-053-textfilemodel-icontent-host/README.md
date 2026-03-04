# US-053: TextFileModel implements IContentHost

## Status

**Status:** Complete
**Priority:** High
**Started:** 2026-03-04
**Completed:** 2026-03-04

## Summary

Make `TextFileModel` implement the `IContentHost` interface from US-052. This is a small, additive change — add `ContentViewModelHost` composition, delegate `acquireViewModel`/`releaseViewModel`, add `stateStorage` property, and clean up view models on dispose.

## Why

- US-052 created the `IContentHost` interface and `ContentViewModelHost` infrastructure
- TextFileModel is the primary content host — it holds text content that content-view editors (Grid, Markdown, Notebook, etc.) operate on
- Without this, the content view model system has no host to connect to
- This is a prerequisite for migrating any editor to the new ContentViewModel pattern

## Architecture Reference

- [9.content-view-models.md](../../future-architecture/migration/9.content-view-models.md) — full architecture document
- [US-052 task](../US-052-content-view-models-foundation/) — foundation infrastructure

## Acceptance Criteria

- [x] `TextFileModel` implements `IContentHost`
- [x] `acquireViewModel(editorId)` delegates to `ContentViewModelHost.acquire()`
- [x] `releaseViewModel(editorId)` delegates to `ContentViewModelHost.release()`
- [x] `stateStorage` property provides default file-based `EditorStateStorage`
- [x] `dispose()` calls `_vmHost.disposeAll()` before existing cleanup
- [x] `isTextFileModel()` type guard still works
- [x] App compiles with no errors
- [ ] All existing functionality works unchanged (see test checklist)

## Technical Approach

### What TextFileModel already has (no changes needed)

These `IContentHost` members already exist on TextFileModel:
- `id` — getter returning `state.get().id`
- `state` — `IState<TextFilePageModelState>` (extends `IContentHostState` — has `content`, `language`, `editor`)
- `changeContent(content, byUser?)` — updates state
- `changeEditor(editor)` — updates state
- `changeLanguage(language)` — updates state (inherited from `PageModel`)

### What needs to be added

```typescript
class TextFileModel extends PageModel<TextFilePageModelState> implements IContentHost {
    private _vmHost = new ContentViewModelHost();

    // Default file-based state storage (same as EditorStateStorageContext default)
    readonly stateStorage: EditorStateStorage = {
        getState: async (id, name) => fs.getCacheFile(id, name),
        setState: async (id, name, state) => { await fs.saveCacheFile(id, state, name); },
    };

    acquireViewModel(editorId: PageEditor) {
        return this._vmHost.acquire(editorId, this);
    }

    releaseViewModel(editorId: PageEditor) {
        this._vmHost.release(editorId);
    }

    async dispose() {
        this._vmHost.disposeAll();
        // ... existing dispose logic ...
    }
}
```

### IState variance note

`IContentHost.state` is typed as `IState<IContentHostState>`, but TextFileModel's state is `IState<TextFilePageModelState>` (wider type). This works because `strictFunctionTypes` is disabled. ContentViewModel only uses `get()` and `subscribe()` (covariant operations). Accepted risk — documented in US-052.

## Files to Modify

| File | Changes |
|------|---------|
| `src/renderer/editors/text/TextPageModel.ts` | Add `implements IContentHost`, `_vmHost`, `stateStorage`, `acquireViewModel`, `releaseViewModel`, update `dispose()` |

## Implementation Steps

### Step 1: Add IContentHost implementation
- [x] Import `IContentHost`, `ContentViewModelHost`, `EditorStateStorage`
- [x] Add `implements IContentHost` to class declaration
- [x] Add `private _vmHost = new ContentViewModelHost()`
- [x] Add `stateStorage` property (default file-based storage)
- [x] Add `acquireViewModel()` delegate
- [x] Add `releaseViewModel()` delegate

### Step 2: Update dispose
- [x] Call `this._vmHost.disposeAll()` at the start of `dispose()`

### Step 3: Verify
- [x] `npx tsc --noEmit` — zero errors
- [ ] Manual test checklist (see below)

## Test Checklist

### File Operations
- [ ] Create new file, type content, save with Ctrl+S
- [ ] Save As with Ctrl+Shift+S
- [ ] Open existing file — content loads correctly
- [ ] Modify file externally — content refreshes in editor
- [ ] Close modified file — "Save changes?" dialog appears
- [ ] Rename file via tab context menu

### Editor Switching
- [ ] Open JSON file — switch between Monaco and Grid view
- [ ] Open Markdown file — switch between Monaco and Preview
- [ ] Switch back and forth — content preserved each time
- [ ] Language auto-detection works on file open

### Encryption
- [ ] Encrypt a file (lock icon in tab)
- [ ] Decrypt an encrypted file
- [ ] Save/reopen encrypted file — prompts for password

### Scripts
- [ ] F5 runs current file as JavaScript
- [ ] F5 with script panel open runs the related script
- [ ] Ctrl+S saves during script execution

### Tabs & Navigation
- [ ] Pin/unpin tab
- [ ] Drag tab to reorder
- [ ] Ctrl+Shift+F opens search in navigation panel
- [ ] Close tab — proper cleanup, no errors in console

### General
- [ ] No errors in DevTools console during all operations
- [ ] Ctrl+Mouse Wheel zoom works
- [ ] Multiple windows work correctly

## Related

- Foundation: [US-052](../US-052-content-view-models-foundation/)
- Next: [US-054](../US-054-textfilemodel-decomposition/) (TextFileModel decomposition)
- Architecture: [9.content-view-models.md](../../future-architecture/migration/9.content-view-models.md)
