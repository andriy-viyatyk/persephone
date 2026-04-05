# US-361: Adopt libarchive-wasm for Multi-Format Archive Support

**Epic:** EPIC-018, Phase 3, Task 3.2
**Status:** Planned
**Created:** 2026-04-05

## Goal

Replace `jszip` with `libarchive-wasm` for **reading** archives to support RAR v4/v5, 7z, TAR (+gz/bz2/lzma/xz), and other formats beyond ZIP. Keep `jszip` for **writing** archives (libarchive-wasm is read-only). Generalize naming from "Zip" to "Archive" where appropriate. Expand `ARCHIVE_EXTENSIONS` and `isArchiveFile()`.

## Background

### Current State

- **`jszip` v3.10.1** — used in 2 files for both reading and writing:
  - `src/renderer/api/archive-service.ts` — `loadArchive()` via dynamic import, all read/write operations
  - `src/renderer/content/transformers/ZipTransformer.ts` — `read()` and `write()` for content pipes
- **Write operations exist** in `archive-service.ts`: `writeFile`, `deleteFile`, `renameFile`, `mkdir`, `removeDir` — all called from `src/renderer/api/fs.ts`
- **ZipTransformer.write()** — replaces a single entry in a ZIP, used by content pipes for saving edits to files inside archives

### libarchive-wasm (v1.2.0, MIT)

- **Read-only** — supports ZIP, RAR v4/v5, 7z, TAR + gzip/bzip2/lzma/xz
- **Sequential access** — entries iterated via generator, no random access by name
- **`entry.readData()`** can only be called once per entry
- **Must call `reader.free()`** to release WASM memory
- **Works in Electron** — pure WASM + JS, no native modules
- **API:** `libarchiveWasm()` → `ArchiveReader(mod, data)` → iterate `reader.entries()` → `entry.readData()`

### Key Constraint: Read-Only

libarchive-wasm cannot write archives. The strategy is:
- **Reading:** Use `libarchive-wasm` for all formats (ZIP, RAR, 7z, TAR, etc.)
- **Writing:** Keep `jszip` for ZIP write operations only
- **Non-ZIP formats** are read-only (cannot edit files inside .rar, .7z, etc.)

### Files Involved

| File | Role | Changes |
|------|------|---------|
| `src/renderer/api/archive-service.ts` | Central archive I/O | Major — dual backend (libarchive read, jszip write) |
| `src/renderer/content/transformers/ZipTransformer.ts` | Content pipe transformer | Read via libarchive, write via jszip (ZIP only) |
| `src/renderer/core/utils/file-path.ts` | `ARCHIVE_EXTENSIONS`, `isArchiveFile()` | Add new extensions |
| `src/renderer/content/tree-providers/ZipTreeProvider.ts` | Tree provider for archives | Rename → `ArchiveTreeProvider`, update type |
| `src/renderer/editors/zip/ZipEditorModel.ts` | Editor model for archives | Rename → `ArchiveEditorModel`, update type/registry |
| `src/renderer/editors/zip/` | Folder | Rename → `src/renderer/editors/archive/` |
| `src/renderer/editors/register-editors.ts` | Editor registration | Update import path, editor ID |
| `src/renderer/editors/registry.ts` | Editor type mapping | Update archive extensions |
| `src/renderer/ui/navigation/secondary-editor-registry.ts` | Secondary panel registry | Update panel ID if renamed |
| `package.json` | Dependencies | Add `libarchive-wasm`, keep `jszip` |

## Implementation Plan

### Step 1: Install `libarchive-wasm`

```bash
npm install libarchive-wasm
```

Keep `jszip` in `package.json` — still needed for write operations.

### Step 2: Refactor `archive-service.ts` — Dual Backend

Replace the single `loadArchive()` (jszip) with two paths:

**Reading (libarchive-wasm):**
- New `readEntries(archivePath)` method — loads archive bytes, creates `ArchiveReader`, iterates entries, returns structured list. Single-pass; must collect all entries at once since sequential access only.
- New `readFileFromArchive(archivePath, innerPath)` method — loads archive, iterates until target entry found, calls `readData()`, returns Buffer.
- Always call `reader.free()` in a finally block.

**Writing (jszip, ZIP only):**
- Keep existing `writeFile`, `deleteFile`, `renameFile`, `mkdir`, `removeDir` using jszip.
- Add a guard: if the archive extension is not ZIP-based, throw an error for write operations.

**Before (reading with jszip):**
```typescript
private async loadArchive(archivePath: string): Promise<any> {
    const JSZip = (await import("jszip")).default;
    const data = nodefs.readFileSync(archivePath);
    return JSZip.loadAsync(data);
}
```

**After (reading with libarchive-wasm):**
```typescript
private async readAllEntries(archivePath: string): Promise<ArchiveEntry[]> {
    const { libarchiveWasm, ArchiveReader } = await import("libarchive-wasm");
    const mod = await this.getWasmModule();
    const data = nodefs.readFileSync(archivePath);
    const reader = new ArchiveReader(mod, new Int8Array(data.buffer, data.byteOffset, data.byteLength));
    try {
        const entries: ArchiveEntry[] = [];
        for (const entry of reader.entries()) {
            entries.push({
                path: entry.getPathname(),
                isDirectory: entry.getFiletype() === "Directory",
                size: entry.getSize() ?? 0,
                mtime: entry.getModificationTime() ?? 0,
            });
        }
        return entries;
    } finally {
        reader.free();
    }
}

private async readEntryData(archivePath: string, innerPath: string): Promise<Buffer> {
    const mod = await this.getWasmModule();
    const data = nodefs.readFileSync(archivePath);
    const reader = new ArchiveReader(mod, new Int8Array(data.buffer, data.byteOffset, data.byteLength));
    try {
        for (const entry of reader.entries()) {
            if (entry.getPathname() === innerPath) {
                const content = entry.readData();
                if (!content) throw new Error(`Empty entry: ${innerPath}`);
                return Buffer.from(content.buffer, content.byteOffset, content.byteLength);
            }
        }
        throw new Error(`Entry not found in archive: ${innerPath}`);
    } finally {
        reader.free();
    }
}
```

**WASM module caching:** Cache the initialized WASM module (call `libarchiveWasm()` once, reuse):
```typescript
private wasmModule: any = null;
private async getWasmModule() {
    if (!this.wasmModule) {
        const { libarchiveWasm } = await import("libarchive-wasm");
        this.wasmModule = await libarchiveWasm();
    }
    return this.wasmModule;
}
```

**Refactored public methods:**
- `listEntries()` — use `readAllEntries()` instead of jszip
- `listDir()` — use `readAllEntries()`, filter by prefix (same logic, different data source)
- `readFile()` — use `readEntryData()` instead of jszip
- `stat()` — use `readAllEntries()`, find matching entry
- `exists()` — use `readAllEntries()`, check if entry exists
- `writeFile()`, `deleteFile()`, `renameFile()`, `mkdir()`, `removeDir()` — keep jszip, add ZIP-only guard

**ZIP-only guard for writes:**
```typescript
private assertZipFormat(archivePath: string): void {
    if (!isZipBasedArchive(archivePath)) {
        throw new Error(`Write operations are only supported for ZIP-based archives: ${archivePath}`);
    }
}
```

### Step 3: Add `writable` to `ITransformer` + Refactor `ZipTransformer.ts`

**Problem:** `ContentPipe.writable` only checks `provider.writable`, not transformers. A RAR file opened via `FileProvider` (writable) + `ZipTransformer` would appear writable but fail on save.

**Fix in `ITransformer` (`src/renderer/api/types/io.transformer.d.ts`):**
```typescript
export interface ITransformer {
    // ... existing fields ...
    /** Whether this transformer supports write (reverse-transform). Default: true.
     *  False for read-only archive formats (RAR, 7z, TAR). */
    readonly writable?: boolean;  // optional, defaults to true for backward compat
}
```

**Fix in `ContentPipe.ts` (`src/renderer/content/ContentPipe.ts`):**
```typescript
get writable(): boolean {
    return this.provider.writable
        && this._transformers.every(t => t.writable !== false);
}
```

This makes the existing save logic in `TextFileIOModel` naturally show "Save As" for non-ZIP archives.

**Refactor `ZipTransformer.ts` → `ArchiveTransformer.ts`:**
- Rename class to `ArchiveTransformer`, rename file
- Change `type = "archive"`
- `read()` — use libarchive-wasm (via archive-service or direct)
- `write()` — keep jszip (ZIP format only), throw for non-ZIP
- Add `get writable(): boolean` — returns `isZipBasedArchive(this.entryPath)` based on the archive path
  - **Issue:** transformer only has `entryPath` (inner path), not the archive file path. Need to also store `archivePath` in the constructor/config so `writable` can check the format.

**Before:**
```typescript
constructor(private readonly entryPath: string) {
    this.config = { entryPath };
}
```

**After:**
```typescript
constructor(
    private readonly archivePath: string,
    private readonly entryPath: string,
) {
    this.config = { archivePath, entryPath };
}

get writable(): boolean {
    return isZipBasedArchive(this.archivePath);
}
```

**Update creation sites to pass `archivePath`:**
- `src/renderer/editors/text/TextFileIOModel.ts:42` — `archivePath` available at line 38
- `src/renderer/api/pages/PagesLifecycleModel.ts:53` — split by `!`, archivePath available
- `src/renderer/editors/pdf/PdfViewer.tsx:52` — split by `!`, archivePath available
- `src/renderer/editors/image/ImageViewer.tsx:81` — split by `!`, archivePath available
- `src/renderer/content/registry.ts:62` — factory: `new ArchiveTransformer(config.archivePath as string, config.entryPath as string)`
- `src/renderer/scripting/api-wrapper/IoNamespace.ts:22` — script API constructor, update signature
- `src/renderer/api/types/io.d.ts:34` — update `IZipTransformerConstructor` → `IArchiveTransformerConstructor(archivePath: string, entryPath: string)`

### Step 4: Expand `ARCHIVE_EXTENSIONS` in `file-path.ts`

**Before:**
```typescript
const ARCHIVE_EXTENSIONS = new Set([
    ".zip", ".docx", ".xlsx", ".pptx",
    ".jar", ".war", ".epub",
    ".odt", ".ods", ".odp",
]);
```

**After:**
```typescript
const ARCHIVE_EXTENSIONS = new Set([
    // ZIP-based
    ".zip", ".docx", ".xlsx", ".pptx",
    ".jar", ".war", ".epub",
    ".odt", ".ods", ".odp",
    // RAR
    ".rar",
    // 7-Zip
    ".7z",
    // TAR and compressed TAR
    ".tar", ".tar.gz", ".tgz", ".tar.bz2", ".tbz2", ".tar.xz", ".txz", ".tar.lz",
    // Other
    ".cab", ".iso",
]);
```

**Concern:** `.tar.gz` is a double extension — `path.extname()` returns `.gz`, not `.tar.gz`. Need a helper function that checks for compound extensions. See Concern #1 below.

Add a helper:
```typescript
const ZIP_BASED_EXTENSIONS = new Set([
    ".zip", ".docx", ".xlsx", ".pptx",
    ".jar", ".war", ".epub",
    ".odt", ".ods", ".odp",
]);

export function isZipBasedArchive(filePath: string): boolean {
    const ext = getArchiveExtension(filePath);
    return ZIP_BASED_EXTENSIONS.has(ext);
}

export function getArchiveExtension(filePath: string): string {
    const lower = filePath.toLowerCase();
    // Check compound extensions first
    for (const compound of [".tar.gz", ".tar.bz2", ".tar.xz", ".tar.lz"]) {
        if (lower.endsWith(compound)) return compound;
    }
    return path.extname(lower);
}
```

Update `isArchiveFile()` to use `getArchiveExtension()` instead of `path.extname()`.

### Step 5: Rename ZipTreeProvider → ArchiveTreeProvider

- Rename file: `ZipTreeProvider.ts` → `ArchiveTreeProvider.ts`
- Rename class: `ZipTreeProvider` → `ArchiveTreeProvider`
- Keep `type = "zip"` for backward compatibility with serialized state (tree-category URLs, pipe descriptors)
  - **Or** change to `type = "archive"` and handle migration — see Concern #2
- Update import in `ZipEditorModel.ts`

### Step 6: Rename ZipEditorModel → ArchiveEditorModel

- Rename folder: `src/renderer/editors/zip/` → `src/renderer/editors/archive/`
- Rename files and classes
- Update `register-editors.ts` import path
- Keep editor type `"zipFile"` for backward compatibility with serialized `IEditorState`
  - **Or** change to `"archiveFile"` and add migration — see Concern #2
- Update secondary editor panel ID if needed

### Step 7: Update editor registry

In `src/renderer/editors/registry.ts`, add new extensions to the archive editor mapping so opening `.rar`, `.7z`, `.tar.gz` etc. triggers the archive editor.

### Step 8: Verify & Test

- Open a `.zip` file → browse entries, open files, edit and save back
- Open a `.rar` file → browse entries, open files (read-only)
- Open a `.7z` file → browse entries, open files (read-only)
- Open a `.tar.gz` file → browse entries, open files (read-only)
- Open `.docx`, `.epub` → existing functionality unchanged
- Try to edit a file inside `.rar` → should show error / read-only indication
- Archive panel in sidebar works for all formats

## Concerns

### 1. Compound Extensions (`.tar.gz`, `.tar.bz2`, etc.)

`path.extname("file.tar.gz")` returns `".gz"`, not `".tar.gz"`. The current `isArchiveFile()` uses `path.extname()`. Need a `getArchiveExtension()` helper that checks compound extensions first. This affects `isArchiveFile()`, `isZipBasedArchive()`, and the editor registry extension mapping.

**Resolution approach:** Add `getArchiveExtension()` in `file-path.ts` (see Step 4).

### 2. Backward Compatibility — Type/ID Renaming

**Decision:** Rename all IDs freely. App has very few users; reopening a page fixes any stale state. No migration needed.

- `type: "zip"` → `"archive"`
- `editorType: "zipFile"` → `"archiveFile"`
- `IPipeDescriptor` transformer `type: "zip"` → `"archive"`
- Secondary editor panel `"zip-tree"` → `"archive-tree"`
- `tree-category://` URL `type=zip` → `type=archive`

### 3. Performance — Sequential vs Random Access

jszip loads the entire ZIP into memory and provides random access (`zip.file("name")`). libarchive-wasm is sequential — must iterate from the start to find an entry. For `readFile()` and `stat()`, this means scanning all entries until the target is found.

**Mitigation:** For operations like `listDir()` + `readFile()` in sequence, consider caching the full archive entry list briefly. The current queue-based design already serializes operations per archive path, so a short-lived cache is safe.

### 4. Read-Only UX for Non-ZIP Archives

**Resolved.** The fix is adding `writable?: boolean` to `ITransformer` and checking it in `ContentPipe.writable`. See Step 3 for details. `ArchiveTransformer.writable` returns `isZipBasedArchive(archivePath)`. The existing `TextFileIOModel.saveFile()` logic already shows "Save As" when `pipe.writable === false` — no UI changes needed.

### 5. WASM File Bundling

`libarchive-wasm` ships a `.wasm` file in `node_modules/libarchive-wasm/dist/`. In production builds (electron-builder), this file must be included. Dynamic `import("libarchive-wasm")` should handle this if Vite is configured correctly, but needs verification.

**Mitigation:** Test the production build. May need to add the WASM file to electron-builder's `extraResources` or configure Vite's `optimizeDeps` to handle it.

### 6. `.asar` Files

`isArchiveFile()` currently has special handling for `.asar` (Electron archive format). This is NOT handled by libarchive-wasm. `.asar` uses a separate code path in `fs.ts` via Node.js's built-in `original-fs`. No changes needed for `.asar` — just ensure the refactoring doesn't break it.

## Acceptance Criteria

- [ ] `libarchive-wasm` installed as dependency
- [ ] `archive-service.ts` uses libarchive-wasm for all read operations
- [ ] `archive-service.ts` uses jszip for write operations (ZIP only)
- [ ] Write operations throw for non-ZIP archives
- [ ] `ArchiveTransformer` read uses libarchive-wasm, write uses jszip
- [ ] `ITransformer.writable` added; `ContentPipe.writable` checks both provider and transformers
- [ ] `ArchiveTransformer.writable` returns false for non-ZIP formats
- [ ] `ARCHIVE_EXTENSIONS` includes `.rar`, `.7z`, `.tar.gz`, `.tgz`, `.tar.bz2`, `.tbz2`, `.tar.xz`, `.txz`, `.cab`, `.iso`
- [ ] `getArchiveExtension()` handles compound extensions
- [ ] `isZipBasedArchive()` helper distinguishes writable vs read-only formats
- [ ] All type IDs renamed: `"zip"` → `"archive"`, `"zipFile"` → `"archiveFile"`, `"zip-tree"` → `"archive-tree"`
- [ ] Class/file renamed: ZipTreeProvider → ArchiveTreeProvider
- [ ] Class/file renamed: ZipEditorModel → ArchiveEditorModel
- [ ] Folder renamed: `editors/zip/` → `editors/archive/`
- [ ] Editor registry maps new extensions to archive editor
- [ ] Existing ZIP/DOCX/EPUB functionality unchanged
- [ ] New formats (RAR, 7z, TAR) can be browsed and files extracted
- [ ] WASM loads correctly in dev and production builds

## Files Changed Summary

| File | Change |
|------|--------|
| `package.json` | Add `libarchive-wasm` dependency |
| `src/renderer/api/archive-service.ts` | Major refactor — dual backend |
| `src/renderer/content/transformers/ZipTransformer.ts` | Rename → `ArchiveTransformer.ts`, read via libarchive, keep jszip write, add `writable` |
| `src/renderer/api/types/io.transformer.d.ts` | Add `writable?: boolean` to `ITransformer` |
| `src/renderer/content/ContentPipe.ts` | `writable` checks transformers too |
| `src/renderer/core/utils/file-path.ts` | New extensions, `getArchiveExtension()`, `isZipBasedArchive()` |
| `src/renderer/content/tree-providers/ZipTreeProvider.ts` | Rename → `ArchiveTreeProvider.ts` |
| `src/renderer/editors/zip/` → `editors/archive/` | Folder + file rename |
| `src/renderer/editors/register-editors.ts` | Update import path |
| `src/renderer/editors/registry.ts` | Add new extension mappings |
| `src/renderer/editors/text/TextFileIOModel.ts` | Pass `archivePath` to ArchiveTransformer |
| `src/renderer/api/pages/PagesLifecycleModel.ts` | Pass `archivePath` to ArchiveTransformer |
| `src/renderer/editors/pdf/PdfViewer.tsx` | Pass `archivePath` to ArchiveTransformer |
| `src/renderer/editors/image/ImageViewer.tsx` | Pass `archivePath` to ArchiveTransformer |
| `src/renderer/content/registry.ts` | Update transformer factory + type name |
| `src/renderer/scripting/api-wrapper/IoNamespace.ts` | Rename export, update constructor |
| `src/renderer/api/types/io.d.ts` | Rename script API type definitions |

## Files NOT Changed

| File | Reason |
|------|--------|
| `src/renderer/api/fs.ts` | Calls `archiveService.*` — interface unchanged |
| `src/renderer/ui/navigation/secondary-editor-registry.ts` | Panel ID stays `"zip-tree"` |
| `src/renderer/theme/icons.tsx` | Archive icon already exists and is generic |
| `src/shared/types.ts` | No type changes needed |
| `src/renderer/content/resolvers.ts` | Uses archive path parsing, not archive-service directly |
| `.asar` handling in `fs.ts` | Separate code path, untouched |
