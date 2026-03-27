# US-268: Migrate TextFileIOModel

## Status

**Status:** Planned
**Priority:** High
**Epic:** EPIC-012
**Started:** —
**Completed:** —

## Summary

Migrate `TextFileIOModel` to read/write content through `IContentPipe` instead of direct `app.fs` calls. Page owns two pipes: primary (source file) and cache (auto-save). FileWatcher replaced by `pipe.watch()`. Encryption migrated to clone-and-try via `DecryptTransformer`. Cache security preserved — cache pipe has same transformers as primary pipe.

## Resolved Concerns

| # | Concern | Resolution |
|---|---------|------------|
| A | Pipe assignment | **Clean approach** — pass pipe through `openFile(filePath, pipe?)` / `createPageFromFile(filePath, pipe?)`. Page receives pipe before `restore()`. |
| B | Encoding detection | **Pipe handles it** — `ContentPipe.readText()` auto-detects encoding (BOM, jschardet), stores it. `writeText()` uses stored encoding. Encoding persisted in pipe descriptor. Already implemented in `ContentPipe.ts` + `encoding.ts`. |
| C | Save As | **Fresh pipe, no transformers** — `new ContentPipe(new FileProvider(savePath), [], pipe.encoding)`. Save As saves what the user sees, no zip/encryption. |
| D | Cache security | **Dual pipe model** — `cachePipe = primaryPipe.cloneWithProvider(CacheFileProvider(pageId))`. Cache pipe has same transformers as primary (including DecryptTransformer when decrypted). Cache always encrypted when primary is encrypted. |
| E | Encryption scope | **Full migration in this task** — clone-and-try replaces `mapContentToSave`/`mapContentFromFile`. Split into phases below. |

## New Flow (After Migration)

### Dual pipe model

Page owns two pipes:
- **primaryPipe** — reads/writes the source file (FileProvider + optional transformers)
- **cachePipe** — reads/writes the cache file (CacheFileProvider + same transformers as primary)

When the transformer chain changes (encrypt/decrypt), BOTH pipes are recreated:
```
primaryPipe = newPipe;
cachePipe = primaryPipe.cloneWithProvider(new CacheFileProvider(pageId));
```

### Read (restore)
```
TextFileIOModel.restore()
  → pipe = model.pipe (from open handler or applyRestoreData)
  → if !pipe && filePath: auto-create pipe from filePath (legacy compat)
  → cachePipe = primaryPipe.cloneWithProvider(CacheFileProvider(pageId))
  → set up watch: pipe.watch?.(onFileChanged)
  → if modified && cacheExists: cachePipe.readText()        // load from cache
  → if !modified: primaryPipe.readText()                    // load from source
      → state.content = text
      → state.encripted = isEncrypted(content)              // detect encrypted content
      → encoding auto-detected by pipe
```

### Write (Ctrl+S)
```
TextFileIOModel.saveFile()
  → primaryPipe.writeText(content)                          // write through pipe (encrypts if DecryptTransformer)
  → delete cache files
  → state.modified = false
```

### Save As
```
TextFileIOModel.saveFile(saveAs=true)
  → newPipe = ContentPipe(FileProvider(savePath), [], pipe.encoding)  // fresh pipe, no transformers
  → newPipe.writeText(content)                              // write plaintext
  → dispose old primaryPipe + cachePipe
  → primaryPipe = newPipe
  → cachePipe = primaryPipe.cloneWithProvider(CacheFileProvider(pageId))
```

### Cache (auto-save)
```
TextFileIOModel.doSaveModifications()
  → cachePipe.writeText(content)                            // reverse-pipes through transformers (encrypts if needed)
```

### External change
```
pipe.watch() detects change → onFileChanged()
  → primaryPipe.readText()                                  // re-read (decrypts if DecryptTransformer)
  → state.content = text
```

### Encrypt (user clicks encrypt)
```
TextFileEncryptionModel.encript(password)
  → clone primaryPipe → add DecryptTransformer(password)
  → candidatePipe.writeText(content)                        // encrypts and writes to disk
  → dispose old primaryPipe + cachePipe
  → primaryPipe = candidatePipe
  → cachePipe = primaryPipe.cloneWithProvider(CacheFileProvider(pageId))
  → re-read: primaryPipe.readText() → shows encrypted text, 🔒
  (note: after encryption, pipe HAS DecryptTransformer but content is read as encrypted
   because we want to show the locked state — so we actually read WITHOUT DecryptTransformer)
```

Wait — encrypting is different from decrypting. Let me rethink:

**Encrypt (lock a plaintext file):**
1. User has plaintext content, no DecryptTransformer
2. Encrypt content with password → write encrypted text to file
3. After: pipe has no DecryptTransformer, content on disk is encrypted, page shows encrypted text + 🔒

```
encript(password):
  → encrypted = shell.encryption.encrypt(content, password)
  → primaryPipe.writeText(encrypted)                        // write encrypted to disk (no transformers in pipe)
  → state.content = encrypted
  → state.encripted = true
  → recreate cachePipe
```

**Decrypt (unlock an encrypted file) — clone-and-try:**
```
decript(password):
  → candidate = primaryPipe.clone()
  → candidate.addTransformer(new DecryptTransformer(password))
  → try content = await candidate.readText()
  → if success:
      dispose old primaryPipe + cachePipe
      primaryPipe = candidate
      cachePipe = primaryPipe.cloneWithProvider(CacheFileProvider(pageId))
      state.content = content (plaintext)
      state.encripted = false, state.password = password
  → if failure:
      candidate.dispose()
      show error
```

**Re-encrypt (lock back — user clicks 🔓):**
```
encryptWithCurrentPassword():
  → candidate = primaryPipe.clone()
  → candidate.removeTransformer("decrypt")
  → dispose old primaryPipe + cachePipe
  → primaryPipe = candidate
  → cachePipe = primaryPipe.cloneWithProvider(CacheFileProvider(pageId))
  → content = primaryPipe.readText()  → encrypted text (no DecryptTransformer)
  → state.content = content
  → state.encripted = true, state.password = undefined
```

**Make unencrypted (permanently remove encryption):**
```
makeUnencrypted():
  → plaintext is in state.content (user had decrypted it)
  → candidate pipe without DecryptTransformer
  → candidate.writeText(plaintext)  → writes plaintext to disk
  → dispose old primaryPipe + cachePipe
  → primaryPipe = candidate
  → cachePipe = primaryPipe.cloneWithProvider(CacheFileProvider(pageId))
  → state.password = undefined
```

## Implementation Phases

### Phase 1: CacheFileProvider + pipe plumbing

**Goal:** Add CacheFileProvider, wire pipe through lifecycle methods. No I/O migration yet.

- [ ] Create `CacheFileProvider` in `src/renderer/content/providers/CacheFileProvider.ts`
- [ ] Register `"cache"` provider type in registry
- [ ] Modify `PagesLifecycleModel.createPageFromFile(filePath, pipe?)` to accept optional pipe
- [ ] Modify `PagesLifecycleModel.openFile(filePath, pipe?)` to pass pipe through
- [ ] Update `open-handler.ts` to pass pipe to page instead of disposing
- [ ] Add `cachePipe: IContentPipe | null` to `TextFileIOModel` (created in restore)

### Phase 2: Migrate read/write to pipe

**Goal:** TextFileIOModel reads/writes through pipe. FileWatcher replaced by pipe.watch().

- [ ] Migrate `restore()` — use `primaryPipe.readText()` and `cachePipe.readText()` instead of FileWatcher/appFs
- [ ] Legacy fallback: auto-create pipe from `filePath` if no pipe restored
- [ ] Migrate `saveFile()` — use `primaryPipe.writeText()` instead of `appFs.write()`
- [ ] Migrate `saveFile(saveAs)` — create fresh pipe for new path
- [ ] Migrate `doSaveModifications()` — use `cachePipe.writeText()` instead of `appFs.saveCacheFile()`
- [ ] Migrate `onFileChanged()` — use `primaryPipe.readText()` instead of `fileWatcher.getTextContent()`
- [ ] Remove `FileWatcher` usage — replace with `pipe.watch()`
- [ ] Migrate `renameFile()` / `applyRenamedPath()` — create new pipe for renamed path
- [ ] Update `dispose()` — dispose both pipes

### Phase 3: Migrate encryption to clone-and-try

**Goal:** Replace `TextFileEncryptionModel` encrypt/decrypt methods with pipe-based clone-and-try. Remove `mapContentToSave`/`mapContentFromFile`.

- [ ] Migrate `decript()` — clone-and-try with DecryptTransformer
- [ ] Migrate `encript()` — write encrypted content through pipe
- [ ] Migrate `encryptWithCurrentPassword()` — clone without DecryptTransformer
- [ ] Migrate `makeUnencrypted()` — clone without DecryptTransformer, write plaintext
- [ ] Remove `mapContentToSave()` — no longer needed (pipe handles encryption)
- [ ] Remove `mapContentFromFile()` — no longer needed (pipe handles decryption)
- [ ] Update `onFileChanged()` — remove mapContentFromFile call (pipe.readText already decrypts)
- [ ] Recreate cachePipe whenever primaryPipe's transformer chain changes

## Backward Compatibility: Legacy State Migration

Old Persephone versions save page state with `filePath` only (no `pipe` field). The restore flow handles both:

```
TextFileIOModel.restore():
  if model.pipe exists → use it (new format, reconstructed by applyRestoreData)
  else if filePath exists → auto-create pipe from filePath:
    - if filePath contains "!" → FileProvider(archivePath) + ZipTransformer(entryPath)
    - else → FileProvider(filePath)
```

No explicit version field needed — presence/absence of `pipe` in JSON is the signal.

## Files to Create/Modify

| File | Change | Phase |
|------|--------|-------|
| `src/renderer/content/providers/CacheFileProvider.ts` | **NEW** — cache file I/O by page ID | 1 |
| `src/renderer/content/registry.ts` | Register `"cache"` provider type | 1 |
| `src/renderer/content/open-handler.ts` | Pass pipe to page instead of disposing | 1 |
| `src/renderer/api/pages/PagesLifecycleModel.ts` | Accept pipe in `openFile`/`createPageFromFile` | 1 |
| `src/renderer/editors/text/TextFileIOModel.ts` | Replace FileWatcher/appFs with pipe reads/writes, dual pipe model | 2 |
| `src/renderer/editors/text/TextPageModel.ts` | Update restore, dispose for pipes | 2 |
| `src/renderer/editors/text/TextFileEncryptionModel.ts` | Clone-and-try, remove mapContent methods | 3 |

## Related

- Epic: [EPIC-012](../../epics/EPIC-012.md)
- Depends on: US-267, US-269, US-275, US-276
- CacheFileProvider pattern: [EPIC-012 Caching Strategy](../../epics/EPIC-012.md#caching-strategy-clonewithprovider)
