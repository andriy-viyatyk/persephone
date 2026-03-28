# US-292: Implement ZipTreeProvider

**Status:** Complete
**Epic:** EPIC-015 (Phase 1, Task 1.3)

## Goal

Implement `ZipTreeProvider` — an `ITreeProvider` that browses contents of ZIP archives (and ZIP-based formats like `.docx`, `.xlsx`, `.epub`, etc.). Read-only initially; write operations deferred.

## Background

### archive-service.ts

The existing `archiveService` (`src/renderer/api/archive-service.ts`) provides all the low-level ZIP operations we need:

| Method | Signature | Notes |
|---|---|---|
| `listDir(archivePath, innerDir)` | `Promise<IDirEntry[]>` | Lists immediate children. Handles implicit directories. Sorted: folders first, then files. |
| `stat(archivePath, innerPath)` | `Promise<IFileStat>` | Returns `{ size, mtime (epoch ms), exists, isDirectory }` |
| `exists(archivePath, innerPath)` | `Promise<boolean>` | Checks files and directories (including implicit) |
| `listEntries(archivePath)` | `Promise<ArchiveEntry[]>` | Flat list of ALL entries with `{ path, isDirectory, size, mtime }` |
| `deleteFile(archivePath, innerPath)` | `Promise<void>` | Removes a single entry |
| `renameFile(archivePath, old, new)` | `Promise<void>` | Renames file or folder (with all children) |
| `mkdir(archivePath, innerPath)` | `Promise<void>` | Creates directory entry |
| `removeDir(archivePath, innerPath)` | `Promise<void>` | Removes directory and all contents |

Key properties:
- All operations go through a **per-archive sequential queue** — no concurrent corruption
- **No caching** — re-reads ZIP from disk on every operation
- Inner paths use forward slashes `/` (ZIP standard)
- Supports implicit directories (folders that don't have explicit ZIP entries)
- Supported formats: `.zip`, `.docx`, `.xlsx`, `.pptx`, `.jar`, `.war`, `.epub`, `.odt`, `.ods`, `.odp`

### Archive path syntax

The app uses `!` as separator between archive path and inner path:
- `D:\docs\archive.zip!word/document.xml`
- `parseArchivePath()` → `{ archivePath: "D:\\docs\\archive.zip", innerPath: "word/document.xml" }`
- `buildArchivePath(archive, inner)` → `"D:\\docs\\archive.zip!word/document.xml"`

### Difference from FileTreeProvider

| | FileTreeProvider | ZipTreeProvider |
|---|---|---|
| Data source | Local filesystem | ZIP archive file |
| I/O | Direct Node.js `fs` | `archiveService` |
| Path format | OS paths (`C:\dir\file`) | Archive paths (`file.zip!inner/path`) |
| Performance | Fast (OS-level) | Slower (re-reads ZIP per operation) |
| Write support | Full (mkdir, rename, delete) | Read-only initially |

## Implementation Plan

### Step 1: Create `src/renderer/content/tree-providers/ZipTreeProvider.ts`

```typescript
import type { ITreeProvider, ITreeProviderItem, ITreeStat } from "../../api/types/io.tree";
import { archiveService } from "../../api/archive-service";
import { buildArchivePath } from "../../core/utils/file-path";

const path = require("path") as typeof import("path");

export class ZipTreeProvider implements ITreeProvider {
    readonly type = "zip";
    readonly displayName: string;
    readonly writable = false;   // Read-only initially
    readonly pinnable = false;

    constructor(public readonly sourceUrl: string) {
        // sourceUrl is the archive file path, e.g., "D:\docs\archive.zip"
        this.displayName = path.basename(sourceUrl);
    }
}
```

### Step 2: Implement `list(innerDir)`

Uses `archiveService.listDir()` which already returns sorted `IDirEntry[]` (folders first, alphabetical).

```typescript
async list(innerDir: string): Promise<ITreeProviderItem[]> {
    const entries = await archiveService.listDir(this.sourceUrl, innerDir);

    const folders: ITreeProviderItem[] = [];
    const files: ITreeProviderItem[] = [];

    for (const entry of entries) {
        const innerPath = innerDir ? innerDir + "/" + entry.name : entry.name;
        const item: ITreeProviderItem = {
            name: entry.name,
            href: buildArchivePath(this.sourceUrl, innerPath),
            category: innerDir,
            tags: [],
            isDirectory: entry.isDirectory,
        };

        if (entry.isDirectory) {
            folders.push(item);
        } else {
            const ext = path.extname(entry.name).toLowerCase();
            item.tags = ext ? [ext] : [];
            files.push(item);
        }
    }

    // Folders first (alphabetical), then files by extension then name
    folders.sort((a, b) => a.name.localeCompare(b.name));
    files.sort((a, b) => {
        const extA = a.tags[0] ?? "";
        const extB = b.tags[0] ?? "";
        const extCmp = extA.localeCompare(extB);
        if (extCmp !== 0) return extCmp;
        return a.name.localeCompare(b.name);
    });

    return [...folders, ...files];
}
```

**Key decisions:**
- `category = innerDir` — the inner directory path (e.g., `"word/styles"`) not the full archive path. CategoryTree builds hierarchy from these.
- `href = buildArchivePath(sourceUrl, innerPath)` — full archive path for the open pipeline (e.g., `"D:\docs.zip!word/document.xml"`). The existing archive parser in Layer 1 handles `!` syntax.
- `innerDir` for root is empty string `""` — matches `archiveService.listDir()` convention.
- Sorting: same as FileTreeProvider — folders first (alphabetical), then files by extension then name. `archiveService.listDir()` pre-sorts, but we re-sort to apply extension-based ordering.
- Tags keep the dot (`.xml`, `.css`) — consistent with FileTreeProvider.

### Step 3: Implement `stat(innerPath)`

```typescript
async stat(innerPath: string): Promise<ITreeStat> {
    const s = await archiveService.stat(this.sourceUrl, innerPath);
    return {
        exists: s.exists,
        isDirectory: s.isDirectory,
        size: s.size,
        mtime: s.mtime ? new Date(s.mtime).toISOString() : undefined,
    };
}
```

Same mtime conversion as FileTreeProvider (epoch ms → ISO string).

### Step 4: Implement `resolveLink(innerPath)`

```typescript
resolveLink(innerPath: string): string {
    return buildArchivePath(this.sourceUrl, innerPath);
    // e.g., "D:\docs.zip!word/document.xml"
}
```

This returns the archive path syntax that the existing Layer 1 archive parser handles.

### Step 5: NOT implementing (yet)

| Method | Reason |
|---|---|
| `mkdir()` | Write operations deferred (read-only initially) |
| `rename()` | Write operations deferred |
| `deleteItem()` | Write operations deferred |
| `addItem()` | Write operations deferred |
| `updateItem()` | Write operations deferred |
| `moveToCategory()` | Write operations deferred |
| `deleteItems()` | Write operations deferred |
| `search()` | Phase 5 |
| `pin()`/`unpin()`/`getPinnedItems()` | `pinnable = false` |
| `dispose()` | No resources to release (archiveService manages its own queue) |

Write operations can be added later by delegating to `archiveService.renameFile()`, `archiveService.deleteFile()`, etc. The infrastructure exists — we just don't wire it up yet.

## Files Changed

| File | Change |
|---|---|
| `src/renderer/content/tree-providers/ZipTreeProvider.ts` | **NEW** — ITreeProvider for ZIP archives |

## Files NOT Changed

- `src/renderer/api/archive-service.ts` — no changes, existing methods are sufficient
- `src/renderer/content/tree-providers/FileTreeProvider.ts` — separate provider, no interaction
- `doc/standards/coding-style.md` — ZipTreeProvider uses `archiveService` (not direct `fs`), and `path` is only used for `basename`/`extname` on filenames (not archive-aware path operations). However, since it does `require("path")`, we should add it to the exception list.

## Resolved Concerns

1. **~~`require("path")` usage~~** — **Resolved: add to exception list.** ZipTreeProvider uses `path.basename()` and `path.extname()` on plain filenames (not archive paths). Archive-aware wrappers not needed.

2. **~~Root path convention~~** — **Resolved.** `archiveService.listDir()` expects `""` for root. ZipTreeProvider passes `innerDir` directly — root = `""`.

3. **~~Performance~~** — **Resolved: not a concern.** ZIP stores a central directory index — listing entries reads only the index, not compressed data. Tested with 200+ MB archives: listing is instant. Only extracting large individual files is slow.

4. **~~Sort order~~** — **Resolved: same as FileTreeProvider.** Folders first (alphabetical), then files by extension then name. We re-sort after receiving from `archiveService.listDir()`.

## Acceptance Criteria

- [ ] `ZipTreeProvider` class exists in `content/tree-providers/ZipTreeProvider.ts`
- [ ] Implements `ITreeProvider` interface: `list()`, `stat()`, `resolveLink()`
- [ ] `writable = false` (read-only)
- [ ] `list()` returns `ITreeProviderItem[]` with correct field mapping
- [ ] `list("")` lists root contents of the archive
- [ ] `list("word/styles")` lists contents of inner directory
- [ ] `href` uses archive path syntax (`buildArchivePath`)
- [ ] `resolveLink()` returns archive path syntax
- [ ] Sort: folders first (alphabetical), then files by extension then name
- [ ] Tags contain extensions with dot (".xml", ".css")
- [ ] `stat()` converts mtime from epoch ms to ISO string
- [ ] Added to coding-style.md exception list (for `require("path")`)
- [ ] `npm start` runs without type errors
- [ ] `npm run lint` passes
