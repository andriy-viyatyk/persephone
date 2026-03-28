# Task 2 Phase B — EPIC-012 Review Fixes

## Goal

Address five code-quality issues identified in the EPIC-012 review: replace sync fs calls with async, add HTTP response caching, add pipe disposal safety, validate file paths in parsers, and prevent plaintext cache leakage for encrypted files.

## Files Changed

| # | File | Change |
|---|------|--------|
| 1 | `src/renderer/content/providers/FileProvider.ts` | Replace `readFileSync`, `writeFileSync`, `statSync` with `fs.promises` equivalents |
| 2 | `src/renderer/content/providers/CacheFileProvider.ts` | Replace `readFileSync`, `writeFileSync`, `statSync` with `fs.promises` equivalents |
| 3 | `src/renderer/content/providers/HttpProvider.ts` | Add `_cachedBuffer` field; cache response on first `readBinary()` |
| 4 | `src/renderer/content/open-handler.ts` | Add try/finally for pipe disposal safety |
| 5 | `src/renderer/content/parsers.ts` | Add `isPlausibleFilePath()` validation in the file parser |
| 6 | `src/renderer/editors/text/TextFileIOModel.ts` | Skip plaintext cache fallback when file is encrypted |

## Implementation Plan

---

### 1. FileProvider — Replace sync fs with fs.promises

**File:** `src/renderer/content/providers/FileProvider.ts`

All three methods (`readBinary`, `writeBinary`, `stat`) are already `async` — the sync calls are drop-in replaceable.

**Leave `fs.watch` untouched** — it is callback-based (not sync).

#### 1a. readBinary (line 26–28)

**Before:**
```typescript
async readBinary(): Promise<Buffer> {
    return nodefs.readFileSync(this.filePath);
}
```

**After:**
```typescript
async readBinary(): Promise<Buffer> {
    return nodefs.promises.readFile(this.filePath);
}
```

#### 1b. writeBinary (line 30–32)

**Before:**
```typescript
async writeBinary(data: Buffer): Promise<void> {
    nodefs.writeFileSync(this.filePath, data);
}
```

**After:**
```typescript
async writeBinary(data: Buffer): Promise<void> {
    await nodefs.promises.writeFile(this.filePath, data);
}
```

#### 1c. stat (line 34–45)

**Before:**
```typescript
async stat(): Promise<IProviderStat> {
    try {
        const stats = nodefs.statSync(this.filePath);
        return {
            size: stats.size,
            mtime: new Date(stats.mtime).toISOString(),
            exists: true,
        };
    } catch {
        return { exists: false };
    }
}
```

**After:**
```typescript
async stat(): Promise<IProviderStat> {
    try {
        const stats = await nodefs.promises.stat(this.filePath);
        return {
            size: stats.size,
            mtime: new Date(stats.mtime).toISOString(),
            exists: true,
        };
    } catch {
        return { exists: false };
    }
}
```

---

### 2. CacheFileProvider — Replace sync fs with fs.promises

**File:** `src/renderer/content/providers/CacheFileProvider.ts`

Same pattern as FileProvider. All methods are already async.

#### 2a. readBinary (line 35–42)

**Before:**
```typescript
async readBinary(): Promise<Buffer> {
    const path = await this.getCachePath();
    try {
        return nodefs.readFileSync(path);
    } catch {
        return Buffer.alloc(0);
    }
}
```

**After:**
```typescript
async readBinary(): Promise<Buffer> {
    const path = await this.getCachePath();
    try {
        return await nodefs.promises.readFile(path);
    } catch {
        return Buffer.alloc(0);
    }
}
```

#### 2b. writeBinary (line 44–47)

**Before:**
```typescript
async writeBinary(data: Buffer): Promise<void> {
    const path = await this.getCachePath();
    nodefs.writeFileSync(path, data);
}
```

**After:**
```typescript
async writeBinary(data: Buffer): Promise<void> {
    const path = await this.getCachePath();
    await nodefs.promises.writeFile(path, data);
}
```

#### 2c. stat (line 49–61)

**Before:**
```typescript
async stat(): Promise<IProviderStat> {
    const path = await this.getCachePath();
    try {
        const stats = nodefs.statSync(path);
        return {
            size: stats.size,
            mtime: new Date(stats.mtime).toISOString(),
            exists: true,
        };
    } catch {
        return { exists: false };
    }
}
```

**After:**
```typescript
async stat(): Promise<IProviderStat> {
    const path = await this.getCachePath();
    try {
        const stats = await nodefs.promises.stat(path);
        return {
            size: stats.size,
            mtime: new Date(stats.mtime).toISOString(),
            exists: true,
        };
    } catch {
        return { exists: false };
    }
}
```

---

### 3. HttpProvider — Cache response buffer after first fetch

**File:** `src/renderer/content/providers/HttpProvider.ts`

Add a private `_cachedBuffer` field. On first `readBinary()`, fetch and cache. On subsequent calls, return cached buffer. The `clone()` is not present on HttpProvider (it has no `clone()` method — cloning happens at the pipe level via `createProviderFromDescriptor`, which creates a fresh instance from the descriptor). So cached data is naturally not shared.

#### 3a. Add private field (after line 20)

Add after `private readonly body`:
```typescript
private _cachedBuffer: Buffer | null = null;
```

#### 3b. Modify readBinary (lines 40–52)

**Before:**
```typescript
async readBinary(): Promise<Buffer> {
    const { nodeFetch } = await import("../../api/node-fetch");
    const response = await nodeFetch(this.url, {
        method: this.method,
        headers: this.headers,
        body: this.body,
    });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
}
```

**After:**
```typescript
async readBinary(): Promise<Buffer> {
    if (this._cachedBuffer) {
        return this._cachedBuffer;
    }
    const { nodeFetch } = await import("../../api/node-fetch");
    const response = await nodeFetch(this.url, {
        method: this.method,
        headers: this.headers,
        body: this.body,
    });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    this._cachedBuffer = Buffer.from(arrayBuffer);
    return this._cachedBuffer;
}
```

---

### 4. open-handler.ts — Add try/finally for pipe disposal on error

**File:** `src/renderer/content/open-handler.ts`

Two branches need different treatment:

- **`pageId` branch:** `navigatePageTo` always results in pipe disposal (the page creates its own pipe). Wrap in try/finally so pipe is disposed even if `navigatePageTo` throws.
- **`else` branch:** `openFile` takes ownership of the pipe on success. Only dispose on error. Wrap in try/catch, dispose pipe on catch, then rethrow.

#### 4a. Full handler replacement (lines 13–33)

**Before:**
```typescript
export function registerOpenHandler(): void {
    app.events.openContent.subscribe(async (event) => {
        const filePath = event.pipe.provider.sourceUrl;
        const metadata = event.metadata as Record<string, unknown> | undefined;
        const pageId = metadata?.pageId as string | undefined;

        if (pageId) {
            // Navigate existing page to the new file
            await pagesModel.lifecycle.navigatePageTo(pageId, filePath, {
                revealLine: metadata?.revealLine as number | undefined,
                highlightText: metadata?.highlightText as string | undefined,
            });
            // navigatePageTo creates its own page model — dispose this pipe
            event.pipe.dispose();
        } else {
            // Open file in new or existing tab — pass pipe through
            await pagesModel.lifecycle.openFile(filePath, event.pipe);
        }

        event.handled = true;
    });
}
```

**After:**
```typescript
export function registerOpenHandler(): void {
    app.events.openContent.subscribe(async (event) => {
        const filePath = event.pipe.provider.sourceUrl;
        const metadata = event.metadata as Record<string, unknown> | undefined;
        const pageId = metadata?.pageId as string | undefined;

        if (pageId) {
            // Navigate existing page to the new file
            // navigatePageTo creates its own page model — always dispose this pipe
            try {
                await pagesModel.lifecycle.navigatePageTo(pageId, filePath, {
                    revealLine: metadata?.revealLine as number | undefined,
                    highlightText: metadata?.highlightText as string | undefined,
                });
            } finally {
                event.pipe.dispose();
            }
        } else {
            // Open file in new or existing tab — pass pipe through
            // On success the page owns the pipe; on error we must dispose it
            try {
                await pagesModel.lifecycle.openFile(filePath, event.pipe);
            } catch (err) {
                event.pipe.dispose();
                throw err;
            }
        }

        event.handled = true;
    });
}
```

---

### 5. parsers.ts — Add isPlausibleFilePath() validation

**File:** `src/renderer/content/parsers.ts`

The file parser (first `subscribe` call, lines 35–42) is the fallback — it accepts anything not handled by earlier parsers. Add validation to reject strings that don't look like Windows file paths.

**Validation rules (Windows-only app):**
- Drive letter path: matches `/^[A-Za-z]:[/\\]/` (e.g., `C:\foo`, `D:/bar`)
- UNC path: starts with `\\` (e.g., `\\server\share`)
- `file://` URLs are already normalized before this check, so they become drive-letter paths

If validation fails, show a notification and mark handled (so it doesn't fall through to other parsers — there are none below this one, but marking handled is correct behavior).

#### 5a. Add helper function (before `registerRawLinkParsers`, after line 23)

```typescript
/**
 * Check if a string looks like a valid Windows file path.
 * Accepts drive-letter paths (C:\..., C:/...) and UNC paths (\\...).
 */
function isPlausibleFilePath(path: string): boolean {
    // Drive letter: X:\ or X:/
    if (/^[A-Za-z]:[/\\]/.test(path)) return true;
    // UNC path: \\server\share
    if (path.startsWith("\\\\")) return true;
    return false;
}
```

#### 5b. Modify file parser subscriber (lines 35–42)

**Before:**
```typescript
    // File parser — fallback for plain file paths and file:// URLs
    app.events.openRawLink.subscribe(async (event) => {
        let filePath = event.raw;
        if (isFileUrl(filePath)) {
            filePath = normalizeFileUrl(filePath);
        }
        await app.events.openLink.sendAsync(new OpenLinkEvent(filePath));
        event.handled = true;
    });
```

**After:**
```typescript
    // File parser — fallback for plain file paths and file:// URLs
    app.events.openRawLink.subscribe(async (event) => {
        let filePath = event.raw;
        if (isFileUrl(filePath)) {
            filePath = normalizeFileUrl(filePath);
        }
        if (!isPlausibleFilePath(filePath)) {
            const { ui } = await import("../api/ui");
            ui.notify(`Invalid file path: ${filePath}`, "warning");
            event.handled = true;
            return;
        }
        await app.events.openLink.sendAsync(new OpenLinkEvent(filePath));
        event.handled = true;
    });
```

---

### 6. TextFileIOModel.doSaveModifications — Skip plaintext cache fallback when encrypted

**File:** `src/renderer/editors/text/TextFileIOModel.ts`

The `doSaveModifications` method (lines 302–325) has a catch block that falls back to `appFs.saveCacheFile(id, text)`. This writes plaintext directly — if the file is encrypted (has a DecryptTransformer in the pipe chain), this leaks unencrypted content to the cache file.

**Detection:** Check if the `cachePipe` has a `decrypt` transformer. The `cachePipe` is cloned from the primary pipe and includes the same transformers (including DecryptTransformer). We can check `this.cachePipe.transformers.some(t => t.type === "decrypt")`.

#### 6a. Modify doSaveModifications (lines 302–325)

**Before:**
```typescript
private doSaveModifications = async () => {
    if (this.modificationSaved) return;
    this.modificationSaved = true;
    this.isSavingModifications = true;

    // Content from state — cachePipe.writeText handles encryption via DecryptTransformer if present
    const text = this.model.state.get().content;

    if (this.cachePipe) {
        try {
            await this.cachePipe.writeText(text);
        } catch {
            // Cache write failed — fall back to direct cache save
            const { id } = this.model.state.get();
            await appFs.saveCacheFile(id, text);
        }
    } else {
        console.log("[doSaveModifications] no cachePipe — using appFs.saveCacheFile fallback");
        const { id } = this.model.state.get();
        await appFs.saveCacheFile(id, text);
    }

    this.isSavingModifications = false;
};
```

**After:**
```typescript
private doSaveModifications = async () => {
    if (this.modificationSaved) return;
    this.modificationSaved = true;
    this.isSavingModifications = true;

    // Content from state — cachePipe.writeText handles encryption via DecryptTransformer if present
    const text = this.model.state.get().content;

    if (this.cachePipe) {
        try {
            await this.cachePipe.writeText(text);
        } catch {
            // Cache write failed — fall back to direct cache save ONLY if not encrypted.
            // If encrypted, the cachePipe has a DecryptTransformer that handles encryption.
            // Falling back to appFs.saveCacheFile would write plaintext, leaking the content.
            const isEncrypted = this.cachePipe.transformers.some(t => t.type === "decrypt");
            if (!isEncrypted) {
                const { id } = this.model.state.get();
                await appFs.saveCacheFile(id, text);
            }
        }
    } else {
        console.log("[doSaveModifications] no cachePipe — using appFs.saveCacheFile fallback");
        const { id } = this.model.state.get();
        await appFs.saveCacheFile(id, text);
    }

    this.isSavingModifications = false;
};
```

---

## Concerns

### 1. fs.promises error behavior differences
`fs.readFileSync` throws synchronously; `fs.promises.readFile` rejects the promise. Both are caught by the existing try/catch blocks in `stat()` and `CacheFileProvider.readBinary()`. The `FileProvider.readBinary()` and `writeBinary()` do NOT have try/catch — they propagate errors to the caller, same as before. **No concern — behavior is equivalent.**

### 2. HttpProvider cache invalidation
The cached buffer is never invalidated within the same HttpProvider instance. This is intentional — the page-level cache pipe handles freshness. If the user wants to re-fetch, they would reload the page (which creates a new provider via `createProviderFromDescriptor`). The comment "Re-fetches on each readBinary() call" in the class doc (line 8) should be updated to reflect the new caching behavior.

### 3. open-handler: rethrow in else branch
After `event.pipe.dispose()` in the catch block, we rethrow the error. The `event.handled = true` line on line 31 won't execute for the error case, which is correct — the event should not be marked as handled if opening failed. The EventChannel will see the rejection and propagate it.

### 4. isPlausibleFilePath and file:// URLs
After `normalizeFileUrl`, a `file:///C:/foo/bar.txt` URL becomes `C:/foo/bar.txt`, which passes the drive-letter check. This is correct. Edge case: `file://localhost/C:/foo` would become `localhost/C:/foo` after normalization — this would fail validation and show a notification. This is acceptable (non-standard URL format).

### 5. isPlausibleFilePath — relative paths
The app is Windows-only. Relative paths like `foo.txt` or `./bar.txt` would fail validation. This is intentional — the file parser fallback shouldn't try to open random text as a relative path. If relative path support is needed later, it can be added.

### 6. Encrypted cache fallback — silent failure
When cache write fails AND the file is encrypted, we silently skip the fallback. This means unsaved encrypted content may be lost on crash. However, this is the safer choice — leaking plaintext to disk is worse than losing unsaved changes. A future improvement could retry the cachePipe write or log a warning.

## Testing Notes

1. **FileProvider/CacheFileProvider async:** Open a file, edit it, save it. Verify save works. Close and reopen the app — verify cache restore works. Open a file inside a ZIP archive — verify read/write through ZipTransformer still works.
2. **HttpProvider caching:** Open a URL (Ctrl+O → paste HTTP URL). Check that the content loads. Switch tabs and return — content should still be there without a re-fetch. Reload the page — should re-fetch (new provider instance).
3. **open-handler disposal:** Simulate by opening a file that fails to load (e.g., a corrupt zip entry). Verify no pipe/resource leak (check DevTools memory if needed).
4. **parsers.ts validation:** Paste random text into "Open URL" dialog (not a valid path). Should see "Invalid file path" notification. Paste a valid path — should open normally. Paste a `file://` URL — should open normally.
5. **Encrypted cache fallback:** Open an encrypted file, enter password, edit content. Kill the process (to trigger cache save failure scenario). Restart — verify no plaintext cache file was written for encrypted files.
