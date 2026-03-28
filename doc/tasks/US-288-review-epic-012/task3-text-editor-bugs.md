# Task 3: Text Editor Pipe Bugs

## Goal

Fix five bugs in `TextFileModel` / `TextFileIOModel` where the pipe-based content delivery (EPIC-012) was not fully integrated: HTTP page restore, rename dropping transformers, Save As stale password, save error handling, and save-deleted-file behavior.

## Files Changed

| File | Change |
|------|--------|
| `src/renderer/editors/text/TextPageModel.ts` | Bug 1: pipe serialization + spelling rename |
| `src/renderer/editors/text/TextFileIOModel.ts` | Bugs 2-5: `applyRenamedPath()`, `saveFile()` + spelling rename |
| `src/renderer/editors/text/TextFileEncryptionModel.ts` | Spelling rename (`encripted`→`encrypted`, `decripted`→`decrypted`, `decript`→`decrypt`, `withEncription`→`withEncryption`) |
| `src/renderer/editors/text/EncryptionPanel.tsx` | Spelling rename |
| `src/renderer/editors/text/ActiveEditor.tsx` | Spelling rename |
| `src/renderer/ui/tabs/PageTab.tsx` | Spelling rename |
| `src/renderer/ui/tabs/PageTabs.tsx` | Spelling rename |
| `src/renderer/editors/browser/BrowserBookmarks.ts` | Spelling rename (`decript`→`decrypt`) |
| `src/renderer/editors/notebook/note-editor/NoteItemEditModel.ts` | Spelling rename |

---

## Bug 1: HTTP page restore — serialize pipe descriptor

### Problem

`TextFileModel.getRestoreData()` (line 219) and `applyRestoreData()` (line 235) override the base `PageModel` methods **without calling super**. The base class (`PageModel`, lines 88-123 in `PageModel.ts`) handles pipe serialization:

- `getRestoreData()` adds `data.pipe = this.pipe.toDescriptor()` (line 94)
- `applyRestoreData()` reconstructs pipe via `createPipeFromDescriptor(data.pipe)` (line 108)

Since `TextFileModel` never calls super, the pipe descriptor is never saved to `IPageState`. On restore, `ensurePipe()` creates a `FileProvider(filePath)` as fallback. For HTTP pages where `filePath` is a URL string, this creates a `FileProvider("https://...")` which fails.

### Current Code — `TextPageModel.ts`

**`getRestoreData()` (lines 219-233):**
```typescript
getRestoreData() {
    const {
        content,
        deleted,
        password,
        encripted,
        restored,
        detectedContentEditor,
        ...pageData
    } = this.state.get();
    if (this.navPanel) {
        pageData.hasNavPanel = true;
    }
    return pageData;
}
```

**`applyRestoreData()` (lines 235-251):**
```typescript
applyRestoreData = (data: Partial<TextFilePageModelState>): void => {
    this.needsNavPanelRestore = !!data.hasNavPanel;
    this.state.update((s) => {
        s.id = data.id || s.id;
        s.type = data.type || s.type;
        s.title = data.title || s.title;
        s.modified = data.modified || s.modified;
        s.filePath = data.filePath || s.filePath;
        s.language = data.language || s.language;
        s.encoding = data.encoding || s.encoding;
        s.editor = data.editor || s.editor;
        s.compareMode = data.compareMode || s.compareMode;
        s.temp =
            !s.filePath && (data.temp !== undefined ? data.temp : s.temp);
        s.pinned = data.pinned ?? s.pinned;
    });
};
```

### Fix — `getRestoreData()`

Add pipe descriptor serialization. The destructuring already strips runtime-only fields (`content`, `deleted`, `password`, `encripted`, `restored`, `detectedContentEditor`), and the spread `...pageData` captures remaining `IPageState` fields — including `pipe` if it were on state, but it's not on state; it's on the model instance (`this.pipe`). We must add it explicitly, same as the base class does.

**After (lines 219-234):**
```typescript
getRestoreData() {
    const {
        content,
        deleted,
        password,
        encripted,
        restored,
        detectedContentEditor,
        ...pageData
    } = this.state.get();
    if (this.navPanel) {
        pageData.hasNavPanel = true;
    }
    if (this.pipe) {
        pageData.pipe = this.pipe.toDescriptor();
    }
    return pageData;
}
```

### Fix — `applyRestoreData()`

Add pipe reconstruction from descriptor before updating state. Import `createPipeFromDescriptor` at top of file.

**After (lines 235-258):**
```typescript
applyRestoreData = (data: Partial<TextFilePageModelState>): void => {
    this.needsNavPanelRestore = !!data.hasNavPanel;
    // Reconstruct pipe from descriptor if present
    if (data.pipe) {
        try {
            this.pipe = createPipeFromDescriptor(data.pipe as any);
        } catch {
            this.pipe = null;
        }
    }
    this.state.update((s) => {
        s.id = data.id || s.id;
        s.type = data.type || s.type;
        s.title = data.title || s.title;
        s.modified = data.modified || s.modified;
        s.filePath = data.filePath || s.filePath;
        s.language = data.language || s.language;
        s.encoding = data.encoding || s.encoding;
        s.editor = data.editor || s.editor;
        s.compareMode = data.compareMode || s.compareMode;
        s.temp =
            !s.filePath && (data.temp !== undefined ? data.temp : s.temp);
        s.pinned = data.pinned ?? s.pinned;
    });
};
```

**New import needed** at top of `TextPageModel.ts`:
```typescript
import { createPipeFromDescriptor } from "../../content/registry";
```

### Why not call `super`?

`TextFileModel.getRestoreData()` deliberately strips fields (`content`, `deleted`, `password`, `encripted`, `restored`, `detectedContentEditor`) that should NOT be persisted to restore data. The base class `getRestoreData()` does `JSON.parse(JSON.stringify(this.state.get()))` which would include all of those. So calling super would re-introduce them. The correct approach is to replicate only the two missing pipe-related lines from the base class.

Similarly, `applyRestoreData()` handles `TextFilePageModelState`-specific fields (`language`, `encoding`, `compareMode`, `temp`) that the base class doesn't know about. Calling super + adding extra fields would cause double state updates. Better to replicate the pipe reconstruction logic inline.

---

## Bug 2: Rename drops transformers

### Problem

`TextFileIOModel.applyRenamedPath()` (line 165) creates a new pipe with an empty transformer array:
```typescript
const newPipe = new ContentPipe(
    new FileProvider(newPath),
    [],
    this.model.pipe?.encoding,
);
```

This drops any transformers (e.g., `ZipTransformer` for archive entries, `DecryptTransformer` for encrypted files).

### Current Code — `TextFileIOModel.ts` (lines 161-183)

```typescript
applyRenamedPath = async (newPath: string) => {
    const oldPath = this.model.state.get().filePath;

    // Create new pipe for renamed path (same encoding, no transformers for plain files)
    const newPipe = new ContentPipe(
        new FileProvider(newPath),
        [],
        this.model.pipe?.encoding,
    );
    this.model.pipe?.dispose();
    this.model.pipe = newPipe;
    this.setupWatch();
    this.recreateCachePipe();

    this.model.state.update((s) => {
        s.filePath = newPath;
        s.title = fpBasename(newPath);
    });
    if (oldPath && newPath !== oldPath) {
        await recent.remove(oldPath);
        recent.add(newPath);
    }
};
```

### Fix

Use `cloneWithProvider()` when an existing pipe exists, which preserves transformers (cloning them). Fall back to creating a new simple pipe only when there's no existing pipe.

**After:**
```typescript
applyRenamedPath = async (newPath: string) => {
    const oldPath = this.model.state.get().filePath;

    // Preserve transformers from existing pipe (e.g., ZipTransformer, DecryptTransformer)
    const newProvider = new FileProvider(newPath);
    const newPipe = this.model.pipe
        ? this.model.pipe.cloneWithProvider(newProvider)
        : new ContentPipe(newProvider);
    this.model.pipe?.dispose();
    this.model.pipe = newPipe;
    this.setupWatch();
    this.recreateCachePipe();

    this.model.state.update((s) => {
        s.filePath = newPath;
        s.title = fpBasename(newPath);
    });
    if (oldPath && newPath !== oldPath) {
        await recent.remove(oldPath);
        recent.add(newPath);
    }
};
```

### Concern: Archive entry rename

If a user renames an archive entry (e.g., `archive.zip!old-name.txt` → `archive.zip!new-name.txt`), the `ZipTransformer` stores the entry path internally. `cloneWithProvider` clones the transformer, preserving the old entry path. However, `applyRenamedPath` only updates the `FileProvider` path, not the `ZipTransformer` entry path. This is an edge case that would require a separate fix (updating the entry path inside the transformer). For now, archive entries are not renameable through the UI rename flow, so this is acceptable.

---

## Bug 3: Save As stale password

### Problem

When using "Save As" to save to a new path, the `saveFile()` method creates a fresh pipe with no transformers (no `DecryptTransformer`). However, `state.password` and `state.encripted` are not cleared. This means the UI may still show the file as encrypted, and future encrypt operations may use a stale password.

### Current Code — `TextFileIOModel.ts` `saveFile()` state update (lines 120-128)

```typescript
await appFs.deleteCacheFile(id);
this.model.state.update((s) => {
    s.modified = false;
    s.temp = false;
    s.filePath = savePath;
    s.title = fpBasename(savePath);
    s.deleted = false;
    s.encoding = this.model.pipe?.encoding;
});
```

### Fix

Clear `password` and `encripted` when saving to a different path (Save As creates a fresh pipe without `DecryptTransformer`). Only clear when `savePath !== filePath` — if the user does "Save As" to the same path, the existing pipe is used (line 97 branch), so encryption state is preserved.

**After (lines 120-130):**
```typescript
await appFs.deleteCacheFile(id);
this.model.state.update((s) => {
    s.modified = false;
    s.temp = false;
    s.filePath = savePath;
    s.title = fpBasename(savePath);
    s.deleted = false;
    s.encoding = this.model.pipe?.encoding;
    // Save As to a new path creates a fresh pipe without DecryptTransformer
    if (savePath !== filePath) {
        s.password = undefined;
        s.encripted = false;
    }
});
```

### Concern: Save As to same path via dialog

If user triggers Save As (`saveAs=true`) but picks the same file path in the dialog, the code takes the `savePath === filePath && this.model.pipe?.writable` branch (line 97), which writes through the existing pipe preserving encryption. So `password`/`encripted` should NOT be cleared. The condition `savePath !== filePath` correctly handles this — no issue.

---

## Bug 4: Save error handling

### Problem

Both write operations in `saveFile()` have no try/catch:
- Line 99: `await this.model.pipe.writeText(text)` (save to same file)
- Line 107: `await newPipe.writeText(text)` (Save As to new path)

If write fails (disk full, permissions, network error for HTTP), the error propagates unhandled. Worse, in the Save As branch, the pipe swap happens at line 110 *after* the write, so if write fails, the old pipe is still intact — but the error is unhandled.

### Current Code — `TextFileIOModel.ts` `saveFile()` (lines 97-118)

```typescript
if (savePath === filePath && this.model.pipe?.writable) {
    // Save to same file — write through existing pipe (preserves transformers)
    await this.model.pipe.writeText(text);
} else {
    // Save As — create fresh pipe (no transformers, just the file + encoding)
    const newPipe = new ContentPipe(
        new FileProvider(savePath),
        [],
        this.model.pipe?.encoding,
    );
    await newPipe.writeText(text);

    // Swap to new pipe
    this.model.pipe?.dispose();
    this.model.pipe = newPipe;
    this.setupWatch();
    this.recreateCachePipe();

    if (savePath !== filePath) {
        recent.add(savePath);
    }
}
```

### Fix

Wrap both write operations in try/catch. On failure, show notification and return `false`. For Save As, if `writeText` fails, dispose the new pipe (don't swap).

**After:**
```typescript
if (savePath === filePath && this.model.pipe?.writable) {
    // Save to same file — write through existing pipe (preserves transformers)
    try {
        await this.model.pipe.writeText(text);
    } catch (err) {
        const { ui } = await import("../../api/ui");
        ui.notify(err.message || "Failed to save file.", "warning");
        return false;
    }
} else {
    // Save As — create fresh pipe (no transformers, just the file + encoding)
    const newPipe = new ContentPipe(
        new FileProvider(savePath),
        [],
        this.model.pipe?.encoding,
    );
    try {
        await newPipe.writeText(text);
    } catch (err) {
        newPipe.dispose();
        const { ui } = await import("../../api/ui");
        ui.notify(err.message || "Failed to save file.", "warning");
        return false;
    }

    // Swap to new pipe
    this.model.pipe?.dispose();
    this.model.pipe = newPipe;
    this.setupWatch();
    this.recreateCachePipe();

    if (savePath !== filePath) {
        recent.add(savePath);
    }
}
```

### State rollback

No state rollback is needed. The state update block (lines 120-128) runs *after* the write succeeds. If the write fails and we return `false`, the state remains unchanged. The only concern is in the Save As branch — but since we return before swapping pipes on failure, the old pipe is preserved.

---

## Bug 5: Save deleted file — show Save As dialog

### Problem

When `state.deleted === true`, the user clicks Save. The current code proceeds to write to the deleted file path, silently recreating it. The expected behavior is to show a "Save As" dialog so the user can choose where to save, with the original path as the default.

### Current Code — `TextFileIOModel.ts` `saveFile()` (lines 80-84)

```typescript
saveFile = async (saveAs?: boolean): Promise<boolean> => {
    const { filePath, title, id } = this.model.state.get();
    const pipeWritable = this.model.pipe?.writable ?? false;
    // Force "Save As" dialog if pipe is read-only (e.g., HttpProvider) or no file path
    let savePath: string | undefined = (saveAs || !pipeWritable) ? undefined : filePath;
```

### Fix

Add `state.deleted` to the condition that forces the Save As dialog. Use `filePath` as the `defaultPath` so the user can recreate the file at the original location by just clicking Save.

**After:**
```typescript
saveFile = async (saveAs?: boolean): Promise<boolean> => {
    const { filePath, title, id, deleted } = this.model.state.get();
    const pipeWritable = this.model.pipe?.writable ?? false;
    // Force "Save As" dialog if pipe is read-only, no file path, or file was deleted
    const forceSaveAs = saveAs || !pipeWritable || deleted;
    let savePath: string | undefined = forceSaveAs ? undefined : filePath;
    if (!savePath) {
        savePath = await api.showSaveFileDialog({
            title: forceSaveAs ? "Save File As" : "Save File",
            defaultPath: filePath || title,
        });
    }
```

Note: `defaultPath` changes from `title` to `filePath || title`. When the file was deleted, `filePath` is the full original path (e.g., `C:\docs\myfile.txt`), which is a better default — the Save As dialog will open in the correct directory with the correct filename pre-filled. For non-deleted cases where `saveAs` is true, using `filePath` is also better than `title` (title is just the basename).

### Post-save cleanup

The existing code at line 126 already clears `deleted`:
```typescript
s.deleted = false;
```
This is correct — after a successful save (whether to same path or new path), the file exists again.

Also, when saving a deleted file to a new path, we need to recreate the pipe for the new path. The existing Save As branch (lines 100-118) already handles this: it creates a new `ContentPipe(new FileProvider(savePath))`, writes, and swaps. When saving to the *same* deleted path, we take the `savePath === filePath && writable` branch (line 97), which writes through the existing pipe. But wait — the pipe's provider is `FileProvider(filePath)`, and the file was deleted. `FileProvider.writeBinary()` uses `fs.writeFile()` which creates the file. So writing to the deleted path through the existing pipe will correctly recreate the file. This is fine.

---

## All Changes Summary

### `src/renderer/editors/text/TextPageModel.ts`

1. **Add import** for `createPipeFromDescriptor` from `../../content/registry`
2. **`getRestoreData()`** — add `if (this.pipe) { pageData.pipe = this.pipe.toDescriptor(); }` before return
3. **`applyRestoreData()`** — add pipe reconstruction block before `this.state.update()`

### `src/renderer/editors/text/TextFileIOModel.ts`

4. **`applyRenamedPath()`** — use `this.model.pipe.cloneWithProvider(newProvider)` instead of `new ContentPipe(newProvider, [])`
5. **`saveFile()`** — clear `password`/`encripted` when `savePath !== filePath` in state update block
6. **`saveFile()`** — wrap both `writeText()` calls in try/catch with `ui.notify()` and `return false`
7. **`saveFile()`** — add `deleted` to force-Save-As condition; use `filePath || title` for `defaultPath`

---

## Concerns

1. **Archive entry rename** — `cloneWithProvider()` preserves `ZipTransformer` with the old entry path. If archive entries become renameable in the future, the entry path inside the transformer must also be updated. Not a problem now since archive entries aren't renamed through the UI.

2. **DecryptTransformer in rename** — `cloneWithProvider()` calls `t.clone()` on each transformer. `DecryptTransformer.clone()` works because the key is held in memory. However, `DecryptTransformer.persistent` is `false`, so it won't appear in pipe descriptors. This is correct behavior — encrypted files can't be restored without the password anyway.

3. **Error message quality** — `err.message` from `writeText()` is a raw Node.js error (e.g., `EACCES: permission denied`). This is preferred for a developer notepad — raw messages are more informative than generic user-friendly wrappers.

4. **`encripted` spelling** — Fix misspellings as part of this task: `encripted` → `encrypted`, `decripted` → `decrypted`, `decript` → `decrypt`, `withEncription` → `withEncryption`. ~62 replacements across 10 files. Safe rename — no logic changes.

---

## Testing Notes

1. **Bug 1 — HTTP restore:** Open a URL (http page), close and reopen the app. Verify the page restores correctly and content loads from the HTTP provider, not a file provider.

2. **Bug 2 — Rename with transformers:** Open an encrypted file, rename it. Verify the file can still be saved (DecryptTransformer preserved). Open a ZIP archive entry, rename the parent archive — verify the entry is still accessible.

3. **Bug 3 — Save As password:** Open an encrypted file, decrypt it, then Save As to a new unencrypted path. Verify `state.password` and `state.encripted` are cleared (check via script: `page.model.state.get()`).

4. **Bug 4 — Save error:** Make a file read-only on disk, try to save. Verify a warning notification appears and the editor state is unchanged (still shows modified).

5. **Bug 5 — Save deleted file:** Open a file, delete it externally, then press Ctrl+S. Verify a Save As dialog appears with the original path as default. Verify saving clears the `deleted` state.
