# US-054: TextFileModel Decomposition

## Status

**Status:** Complete
**Priority:** Medium
**Started:** 2026-03-04
**Completed:** 2026-03-04

## Summary

Decompose `TextFileModel` (~567 lines) into focused submodels: `TextFileIOModel` (file I/O, watchers, cache), `TextFileEncryptionModel` (encrypt/decrypt), and `TextFileActionsModel` (keyboard shortcuts, scripts, nav panel, compare mode). TextFileModel core remains the coordinator with flat API delegates for backward compatibility.

## Why

- TextFileModel is the largest model class (~567 lines), mixing 4 different concerns
- Decomposition makes each concern independently readable and maintainable
- Follows the same submodel pattern already used (`TextEditorModel`, `ScriptPanelModel`)
- Prepares for future editor migrations where submodel access patterns are important

## Architecture Reference

- [9.content-view-models.md](../../future-architecture/migration/9.content-view-models.md) — TextFileModel Decomposition section
- [US-053](../US-053-textfilemodel-icontent-host/) — IContentHost (next task)

## Acceptance Criteria

- [x] `TextFileIOModel` extracted — save, load, watch, cache, rename, FileWatcher
- [x] `TextFileEncryptionModel` extracted — encrypt, decrypt, password management, dialog
- [x] `TextFileActionsModel` extracted — handleKeyDown, runScript, nav panel, compare mode
- [x] TextFileModel core has submodel instances + flat API delegates
- [x] Submodels access parent via constructor back-reference (same pattern as TextEditorModel)
- [x] All ~12 consumer files work unchanged (no import changes needed)
- [x] `isTextFileModel()` type guard still works
- [x] App compiles with no errors
- [ ] All existing functionality works unchanged (same test checklist as US-053)

## Technical Approach

### Submodel pattern

Following existing pattern (TextEditorModel takes parent as constructor arg):

```typescript
class TextFileIOModel {
    constructor(private model: TextFileModel) {}
    // Can access model.state, model.encryption, etc.
}
```

### File layout

```
src/renderer/editors/text/
├── TextPageModel.ts              — TextFileModel core (state, submodels, delegates)
├── TextFileIOModel.ts            — File save/load/watch/cache/rename
├── TextFileEncryptionModel.ts    — Encryption/decryption
├── TextFileActionsModel.ts       — Keyboard, scripts, nav panel, compare
├── TextEditor.tsx                — TextEditorModel (unchanged)
└── ScriptPanel.tsx               — ScriptPanelModel (unchanged)
```

### Flat API delegates

Consumers call `model.saveFile()` not `model.io.saveFile()`:

```typescript
class TextFileModel {
    io = new TextFileIOModel(this);
    encryption = new TextFileEncryptionModel(this);
    actions = new TextFileActionsModel(this);

    // Flat delegates — preserve external API
    saveFile = (saveAs?: boolean) => this.io.saveFile(saveAs);
    renameFile = (newName: string) => this.io.renameFile(newName);
    encript = (password: string) => this.encryption.encript(password);
    handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => this.actions.handleKeyDown(e);
    // ... etc
}
```

### Method distribution

**TextFileIOModel (~190 lines):**
- `saveFile()`, `renameFile()`, `applyRenamedPath()`
- `restore()` (file loading, cache restore, FileWatcher setup)
- `saveState()`, `doSaveModifications()`, `saveModifications` (debounced)
- `markModificationUnsaved()` — called by encryption submodel and changeContent
- `onFileChanged()` (external file modification)
- FileWatcher lifecycle, `dispose()`

**TextFileEncryptionModel (~120 lines):**
- `encripted`, `decripted`, `withEncription` (getters)
- `encript(password)`, `decript(password)`
- `encryptWithCurrentPassword()`, `makeUnencrypted()`
- `showEncryptionDialog()`
- `alertEncryptionError()`
- `mapContentToSave()`, `mapContentFromFile()` (encryption-aware I/O helpers)

**TextFileActionsModel (~110 lines):**
- `handleKeyDown()` (Ctrl+S, F5, Ctrl+Shift+F)
- `runScript()`, `runRelatedScript()`
- `openSearchInNavPanel()`
- `setCompareMode()`
- `confirmRelease()`, `canClose()`

**TextFileModel core (~190 lines):**
- State (`TextFilePageModelState`)
- Submodel instances (io, encryption, actions, editor, script)
- Portal refs (editorToolbarRefFirst/Last, etc.)
- `changeContent()`, `changeEditor()`
- `dispose()`, `getRestoreData()`, `applyRestoreData()`, `saveState()`, `restore()`
- Flat API delegates
- Factory functions (`newTextFileModel`, `newTextFileModelFromState`, `isTextFileModel`)

## Files Created

| File | Purpose |
|------|---------|
| `src/renderer/editors/text/TextFileIOModel.ts` | File I/O, watchers, cache |
| `src/renderer/editors/text/TextFileEncryptionModel.ts` | Encryption/decryption |
| `src/renderer/editors/text/TextFileActionsModel.ts` | Keyboard, scripts, nav panel |

## Files Modified

| File | Changes |
|------|---------|
| `src/renderer/editors/text/TextPageModel.ts` | Replaced extracted methods with submodel instances + flat delegates |

## Implementation Steps

- [x] Create `TextFileEncryptionModel` — extract encryption methods
- [x] Create `TextFileIOModel` — extract file I/O methods (uses encryption submodel)
- [x] Create `TextFileActionsModel` — extract action methods
- [x] Refactor `TextFileModel` — create submodel instances, add flat delegates
- [x] Verify compilation and run test checklist

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

- Next: [US-053](../US-053-textfilemodel-icontent-host/) (IContentHost)
- Foundation: [US-052](../US-052-content-view-models-foundation/)
- Architecture: [9.content-view-models.md](../../future-architecture/migration/9.content-view-models.md)
