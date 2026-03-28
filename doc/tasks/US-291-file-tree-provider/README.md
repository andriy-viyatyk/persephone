# US-291: Implement FileTreeProvider

**Status:** Complete
**Epic:** EPIC-015 (Phase 1, Task 1.2)

## Goal

Implement `FileTreeProvider` — an `ITreeProvider` that wraps `app.fs` calls to browse local directories. This is the primary tree provider that replaces the data layer of the current `FileExplorer` component.

## Background

### Current FileExplorer data layer

The current `FileExplorer` uses `file-tree-builder.ts` which:
- Calls `fs.listDirWithTypes(dirPath)` to get `{ name, isDirectory }[]` entries
- Builds `FileTreeItem` objects with `{ label, filePath, isFolder, extension, items }`
- Loads depth 1 only (root's children); deeper folders have `items: undefined` (lazy)
- On expand, calls `loadFolderChildren()` → `readDirectoryItems()` → `fs.listDirWithTypes()`
- Sorts: folders first (alphabetical), then files (by extension+name or name only)
- Ignores: `.git`, `node_modules`, `.DS_Store`, `Thumbs.db`, `desktop.ini`
- Handles archive paths transparently (`fs.listDirWithTypes` delegates to `archiveService.listDir()`)

### fs methods available

| Method | Signature | Notes |
|---|---|---|
| `fs.listDirWithTypes(dirPath)` | `Promise<IDirEntry[]>` where `IDirEntry = { name, isDirectory }` | Handles archives via `archiveService`. Returns `[]` on error. |
| `fs.stat(filePath)` | `Promise<IFileStat>` where `IFileStat = { size, mtime, exists, isDirectory }` | `mtime` is epoch ms (number). Handles archives. |
| `fs.exists(filePath)` | `Promise<boolean>` | Handles archives. |
| `fs.mkdir(dirPath)` | `Promise<void>` | Creates recursively. Handles archives. |
| `fs.rename(oldPath, newPath)` | `Promise<void>` | Handles archives (inner path rename). |
| `fs.delete(filePath)` | `Promise<void>` | Handles archives. |
| `fs.removeDir(dirPath, recursive?)` | `Promise<void>` | Not available for archives. |

### Important: Archive path transparency

`app.fs` methods handle archive paths (`C:\file.zip#inner/path`) transparently. This means `FileTreeProvider` does NOT need special archive handling — it just calls `fs.listDirWithTypes()` and the same code works for both directories and archives. The separate `ZipTreeProvider` (US-292) is for when the user wants to browse an archive from its root — it will use `archiveService` directly.

However, for this task, `FileTreeProvider` should focus on local filesystem directories only. Archive paths within `fs` will work, but the provider's `type` is `"file"` and `sourceUrl` is a local directory path.

## Implementation Plan

### Step 1: Create `src/renderer/content/tree-providers/FileTreeProvider.ts`

```typescript
import type { ITreeProvider, ITreeProviderItem, ITreeStat } from "../../api/types/io.tree";

// Direct Node.js imports — bypasses app.fs archive transparency.
// Listed in coding-style.md exceptions.
const nodefs = require("fs") as typeof import("fs");
const path = require("path") as typeof import("path");

export class FileTreeProvider implements ITreeProvider {
    readonly type = "file";
    readonly displayName: string;
    readonly writable = true;
    readonly pinnable = false;

    constructor(public readonly sourceUrl: string) {
        this.displayName = fpBasename(sourceUrl);
    }

    async list(path: string): Promise<ITreeProviderItem[]> { /* ... */ }
    async stat(path: string): Promise<ITreeStat> { /* ... */ }
    resolveLink(path: string): string { /* ... */ }

    // Write operations
    async mkdir(path: string): Promise<void> { /* ... */ }
    async rename(oldPath: string, newPath: string): Promise<void> { /* ... */ }
    async deleteItem(href: string): Promise<void> { /* ... */ }
}
```

### Step 2: Implement `list(path)`

Core method. Must return `ITreeProviderItem[]` for direct children of `path`:

```typescript
async list(path: string): Promise<ITreeProviderItem[]> {
    let entries: { name: string; isDirectory: boolean }[];
    try {
        entries = await fs.listDirWithTypes(path);
    } catch {
        return [];
    }

    const folders: ITreeProviderItem[] = [];
    const files: ITreeProviderItem[] = [];

    for (const entry of entries) {
        const fullPath = fpJoin(path, entry.name);

        if (entry.isDirectory) {
            folders.push({
                name: entry.name,
                href: fullPath,
                category: path,
                tags: [],
                isDirectory: true,
            });
        } else {
            const ext = fpExtname(entry.name).toLowerCase();
            files.push({
                name: entry.name,
                href: fullPath,
                category: path,
                tags: ext ? [ext] : [],  // ".ts" — keep the dot
                isDirectory: false,
            });
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
- `category = path` (the parent directory) — matches how CategoryTree builds hierarchy from "/" paths
- `tags = [ext]` — keep the dot: `".ts"`. Natural for a developer notepad, simpler (no stripping logic).
- `href = fullPath` — the full file path IS the resolved link
- Sort: folders first (alphabetical), then files by extension then name — same as current FileExplorer "type" sort. Provider defines the sort order; TreeProviderView displays as received.
- Empty tags for directories (no extension)

### Step 3: Implement `stat(path)`

```typescript
async stat(path: string): Promise<ITreeStat> {
    const s = await fs.stat(path);
    return {
        exists: s.exists,
        isDirectory: s.isDirectory,
        size: s.size,
        mtime: s.mtime ? new Date(s.mtime).toISOString() : undefined,
    };
}
```

Note: `fs.stat()` returns `mtime` as epoch ms (number). `ITreeStat.mtime` is ISO string. Convert here.

### Step 4: Implement `resolveLink(path)`

```typescript
resolveLink(path: string): string {
    return path;  // Local file path is already a valid raw link
}
```

### Step 5: Implement write operations

```typescript
async mkdir(path: string): Promise<void> {
    await fs.mkdir(path);
}

async rename(oldPath: string, newPath: string): Promise<void> {
    await fs.rename(oldPath, newPath);
}

async deleteItem(href: string): Promise<void> {
    const s = await fs.stat(href);
    if (s.isDirectory) {
        await fs.removeDir(href, true);
    } else {
        await fs.delete(href);
    }
}
```

### Step 6: NOT implementing (yet)

These optional `ITreeProvider` methods are **not implemented** in this task:

| Method | Reason |
|---|---|
| `addItem()` | File creation UX not defined yet (Phase 4+) |
| `updateItem()` | Use `rename()` for path changes |
| `moveToCategory()` | Bulk move = single `fs.rename()` on folder. Implement when TreeProviderView drag-drop is built (Phase 2+) |
| `deleteItems()` | Implement when CategoryView multi-select is built (Phase 2+) |
| `search()` | Implement in Phase 5 |
| `pin()` / `unpin()` / `getPinnedItems()` | `pinnable = false` for files |
| `dispose()` | No resources to release (no file watchers) |

## Files Changed

| File | Change |
|---|---|
| `src/renderer/content/tree-providers/FileTreeProvider.ts` | **NEW** — ITreeProvider implementation for local directories |

## Files NOT Changed

- `src/renderer/components/file-explorer/` — untouched (old component kept as reference)
- `src/renderer/api/fs.ts` — no changes needed, existing methods are sufficient
- `src/renderer/content/registry.ts` — tree provider registry comes later (when needed by resolvers)

## Resolved Concerns

1. **~~Tag format: with or without dot?~~** — **Resolved: keep the dot.** `".ts"` not `"ts"`. Natural for a developer notepad, simpler code (no stripping logic).

2. **~~Sort order~~** — **Resolved: provider defines sort order.** FileTreeProvider uses current FileExplorer sorting: folders first (alphabetical), then files by extension then name. TreeProviderView displays items as received — no re-sorting planned.

3. **~~DEFAULT_IGNORE list~~** — **Resolved: no ignore list.** The old FileExplorer hides `.git`, `node_modules`, etc. with no clear rationale. Persephone is a developer notepad, not an IDE — show everything like Windows Explorer. If filtering is needed later, it can be a user setting or a TreeProviderView feature.

4. **~~`fs.stat()` mtime format~~** — **Resolved.** Convert epoch ms → ISO string in `stat()`. Return `undefined` if mtime is 0.

## Acceptance Criteria

- [ ] `FileTreeProvider` class exists in `content/tree-providers/FileTreeProvider.ts`
- [ ] Implements `ITreeProvider` interface: `list()`, `stat()`, `resolveLink()`, `mkdir()`, `rename()`, `deleteItem()`
- [ ] `list()` returns `ITreeProviderItem[]` with correct field mapping (name, href, category, tags, isDirectory)
- [ ] `list()` returns all entries (no ignore list)
- [ ] `list()` sorts folders first (alphabetical), then files by extension then name
- [ ] Tags contain extensions with dot (".ts", ".json")
- [ ] `stat()` converts mtime from epoch ms to ISO string
- [ ] Uses direct Node.js `fs`/`path` (not `app.fs` / `file-path` — intentional, to bypass archive transparency)
- [ ] Added to coding-style.md exception list
- [ ] `npm start` runs without type errors
- [ ] `npm run lint` passes
