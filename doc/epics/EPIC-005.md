# EPIC-005: Archive File Support (ZIP/DOCX/XLSX)

## Status

**Status:** Completed
**Created:** 2026-03-11

## Overview

Enable js-notepad to open and browse ZIP archives (including Office documents like `.docx`, `.xlsx`, `.pptx`) and edit individual files inside them. When an archive is opened, the existing NavigationPanel (file explorer sidebar) is initialized with the archive root as its folder — no custom editor needed. Files inside archives are addressed via a virtual path scheme (`archive!innerPath`) and opened in standard editors (Monaco, Grid, etc.) with transparent zip/unzip handled by an enhanced file service.

## Goals

- Open `.zip`, `.docx`, `.xlsx`, `.pptx` and other ZIP-based archives — NavigationPanel shows contents
- Browse archive contents in the existing file explorer UI (tree with folders, icons)
- Open individual files from the archive in standard editors (Monaco with XML language, Grid for JSON, etc.)
- Save edits back into the archive (modify single file inside ZIP without extracting everything)
- Transparent archive I/O — the rest of the system doesn't need to know about archives

## Architecture

### Virtual Archive Paths

Files inside archives use `!` as separator (inspired by Java JAR URLs):

```
D:/temp/doc.docx!word/document.xml
D:/temp/data.zip!config/settings.json
C:/files/book.xlsx!xl/worksheets/sheet1.xml
```

The `!` character is invalid in Windows filenames, making it a safe separator.

### File Service Enhancement

The existing `FileSystem` class (`/src/renderer/api/fs.ts`) will be enhanced to detect archive paths:

```
read("D:/temp/doc.docx!word/document.xml")
  → detect "!" separator
  → read archive "D:/temp/doc.docx" as binary
  → extract "word/document.xml" from ZIP
  → return content as string (with encoding detection)

write("D:/temp/doc.docx!word/document.xml", content)
  → read existing archive
  → replace "word/document.xml" in ZIP
  → write archive back to disk
```

### Component Overview

Everything runs in the **renderer process** — simple, no IPC, no main process involvement.

```
RENDERER PROCESS
┌──────────────────────────────┐
│  NavigationPanel (sidebar)   │
│  - FileExplorer with archive │
│    root path (zip!)          │
│  - Click file → navigate     │
└────────────┬─────────────────┘
             │ navigatePageTo("arc!inner/file.xml")
┌────────────▼─────────────┐
│  FileSystem (fs.ts)      │
│  - Detects "!" in path   │
│  - Routes archive paths  │
│  - Normal files: as-is   │
└────────────┬─────────────┘
             │ archive paths
┌────────────▼─────────────┐
│  ArchiveService          │
│  - jszip (async API)     │
│  - Sequential queue      │
│  - Direct fs access      │
└──────────────────────────┘
```

**Key insight:** Instead of building a custom ZIP Viewer editor, we reuse the existing NavigationPanel + FileExplorer. When an archive file is opened, an empty text page is created with NavigationPanel initialized to `archivePath!` as root. The user browses the tree and clicks files to navigate — exactly like navigating a real folder. All file listing goes through `app.fs.listDirWithTypes()` which transparently routes archive paths to ArchiveService.

jszip is **async** — it uses Promises and yields the event loop between compression chunks. For typical archives (`.docx`, `.xlsx`, small `.zip`) the operation is near-instant. Large archives may cause slight UI jank but won't fully freeze. If large archive performance becomes an issue, a future phase can move jszip to a **worker thread** (spawned from renderer via `worker_threads`).

### Library

**jszip** — pure JS, async API, reads AND writes ZIP archives, ~45KB gzipped. Runs directly in the renderer process with full Node.js fs access (nodeIntegration=true). Needs to be added as a dependency.

**Important:** jszip must be loaded via **dynamic import** (`const JSZip = await import("jszip")`) inside ArchiveService methods — not a top-level static import. This follows the project's code-splitting pattern (like editors) and ensures application startup performance is not affected by loading a library that may never be used.

## Resolved Questions

1. **Concurrent writes** — ArchiveService in the **renderer process** with a sequential promise queue per archive file. All read/write operations are async and queued, so no simultaneous access. Write = unzip → replace file → zip back to disk. No IPC needed.
2. **FileWatcher for archive paths** — **Disabled** for archive inner paths. If the archive is updated externally, open inner pages won't auto-reload. Not critical for v1.
3. **Large archives** — jszip is async and yields the event loop between chunks, so the UI won't fully freeze. For typical use cases (`.docx`, `.xlsx`, small `.zip`) it's near-instant. If large archive support becomes important in the future, move jszip to a **worker thread** (spawned from renderer) for smooth UI + progress overlay + cancel.
4. **Read-only mode** — **No.** Full read/write for all archives. This is a developer notepad — user takes responsibility.
5. **Language detection** — Detect language from the **inner filename** (`document.xml` → XML), not the outer archive extension. If the existing `path.extname()` approach doesn't work with archive paths, implement an `archivePath.innerExtension()` utility.
6. **Tab title** — **No special handling.** Use standard behavior (inner filename). User can hover the tab to see the full archive path, same as with regular files from different folders.
7. **Archive caching** — **No cache.** Re-read and re-zip the archive file on every read/write operation. Simple and correct. Performance is acceptable for typical document sizes.
8. **Binary files inside archives** — **No special handling.** Double-click builds the archive path and calls the standard `pages.openFile(archivePath)`. The file goes through the same pipeline as any regular file — editor resolution, encoding detection, etc. Archive paths and regular paths are treated identically by the rest of the system.

## Phases

### Phase 0: Consolidate File Operations through `app.fs`

Prerequisite for archive support. Ensure all renderer file I/O goes through `app.fs` so archive path detection works everywhere automatically.

**Extend `app.fs` with missing operations:**
- `rename(oldPath, newPath)` — currently `fs.renameSync()` used directly
- `stat(path)` → `{ size, mtime, exists, isDirectory }` — currently `fs.statSync()` used directly
- `removeDir(path, recursive?)` — currently `fs.rmdirSync()` used directly
- `listDirWithTypes(path)` → `Array<{ name, isDirectory, size, mtime }>` — current `listDir()` returns names only

**Migrate renderer files from direct `require("fs")` to `app.fs`:**

| File | Direct fs operations to migrate |
|------|--------------------------------|
| `components/file-explorer/FileExplorerModel.tsx` | `existsSync`, `writeFileSync`, `mkdirSync`, `renameSync`, `rmdirSync`, `unlinkSync` |
| `components/file-explorer/file-tree-builder.ts` | `readdirSync`, `statSync` |
| `api/library-service.ts` | `existsSync`, `readdirSync`, `statSync` |
| `api/setup/library-intellisense.ts` | `readFileSync` |
| `editors/text/TextFileIOModel.ts` | `renameSync`, `existsSync` |
| `theme/themes/index.ts` | `readFileSync` |

**Archive-aware path utility module** (`file-path.ts`):

Standard `path.*` functions don't handle archive paths correctly:

```
path.basename("D:/temp/some.zip!styles.xml")  → "some.zip!styles.xml"  ✗ (should be "styles.xml")
path.dirname("D:/temp/some.zip!word/doc.xml") → "D:/temp/some.zip!word" ✗ (meaningless)
path.extname("D:/temp/some.zip!word/doc.xml") → ".xml"                 ✓ (works by luck)
```

Create a `file-path.ts` utility module with archive-aware wrappers for `path.*` functions:
- `fpBasename(filePath)` — for archive paths, returns basename of inner path
- `fpExtname(filePath)` — for archive paths, returns extension of inner path
- `fpDirname(filePath)` — for archive paths, returns archive path (outer file)
- Plus archive-specific: `isArchivePath()`, `parseArchivePath()`, `buildArchivePath()`

These are **pure sync functions** (no I/O), so they live as a standalone module — not in `app.fs`. Replace all renderer `path.basename()`, `path.extname()`, `path.dirname()` calls that operate on user file paths with `filePath.*` equivalents. Internal paths (cache, data) don't need migration.

**Out of scope (acceptable direct usage):**
- `core/utils/file-watcher.ts` — low-level watcher, uses `fs.watch()` which is special (callback-based, not a simple read/write)
- `scripting/library-require.ts` — custom require() transpiler, core internal functionality

### Phase 1: Foundation — Archive Service + File Service Enhancement

Core infrastructure. No UI yet — just the I/O layer. Can be tested via scripting API.

- Install `jszip` dependency
- **ArchiveService** in renderer process (`/src/renderer/api/archive-service.ts`):
  - `listEntries(archivePath)` → returns file/folder list with sizes
  - `readFile(archivePath, innerPath)` → returns Buffer
  - `writeFile(archivePath, innerPath, content)` → unzip → replace → zip to disk
  - Sequential promise queue per archive (prevents concurrent read/write)
- **Archive path utilities** (`archivePath.ts`):
  - `isArchivePath(path)` — checks for `!` separator
  - `parseArchivePath(path)` → `{ archivePath, innerPath }`
  - `buildArchivePath(archivePath, innerPath)` → combined path
  - `getInnerExtension(path)` → extension from inner filename
- **FileSystem enhancement** (`fs.ts`):
  - `read()`, `readFile()`, `readBinary()`, `write()`, `writeBinary()` detect archive paths
  - Route archive paths to ArchiveService (direct call, same process)
  - Normal file paths pass through unchanged
- **FileWatcher**: skip watching for archive paths (return no-op watcher)
- **Language detection**: use inner filename extension for archive paths

### Phase 2: Archive Browsing via NavigationPanel

Reuse the existing NavigationPanel + FileExplorer to browse archive contents. No custom editor — just wire up the `openFile` flow to initialize NavigationPanel with an archive root.

**Step 1: Fix `fpDirname` for archive inner paths**

Currently `fpDirname("D:/temp/doc.zip!word/doc.xml")` returns `"D:/temp"` (parent of archive file on disk). For NavigationPanel's "navigate up" to work inside archives, it needs to navigate within the archive:

```
fpDirname("D:/temp/doc.zip!word/doc.xml") → "D:/temp/doc.zip!word"
fpDirname("D:/temp/doc.zip!word")         → "D:/temp/doc.zip!"
fpDirname("D:/temp/doc.zip!")             → "D:/temp"  (exits archive)
```

Also fix `fpJoin` for archive paths so file-tree-builder can construct child paths:
```
fpJoin("D:/temp/doc.zip!", "word")       → "D:/temp/doc.zip!word"
fpJoin("D:/temp/doc.zip!word", "doc.xml") → "D:/temp/doc.zip!word/doc.xml"
```

**Step 2: Fix `navigatePageTo` for archive paths**

`PagesLifecycleModel.navigatePageTo()` uses `fs.existsSync()` (sync) to check if the target file exists. This doesn't work for archive paths. Change to `await fs.exists()`.

**Step 3: Hook into `openFile` for archive extensions**

When `pagesModel.openFile("D:/temp/doc.zip")` is called (or a `.docx`/`.xlsx` is dropped onto the window):
- Detect archive extension (`.zip`, `.docx`, `.xlsx`, `.pptx`, `.jar`, `.war`, `.epub`)
- Create an empty text page (not loaded from file)
- Initialize its NavPanelModel with `rootFilePath = "D:/temp/doc.zip!"` and open the panel
- Set the page title to the archive filename
- The NavigationPanel's FileExplorer calls `fs.listDirWithTypes("D:/temp/doc.zip!")` — which works via archive routing

User then clicks files in the tree → `navigatePageTo(pageId, "D:/temp/doc.zip!word/document.xml")` → file opens in Monaco with XML highlighting. NavPanel stays open with the archive as root.

**Step 4: Disable unsupported features for archive roots**

When NavigationPanel root is an archive path (`isArchivePath(rootFilePath)`):
- **Disable file operations** — `enableFileOperations = false` (no new file, rename, delete in archives)
- **Disable search** — Hide search button. Search uses IPC to main process `search-service.ts` which reads files from disk, doesn't understand archive paths
- **Context menu adjustments** — Hide "Show in File Explorer" for archive inner paths (meaningless). Keep "Copy File Path" (useful for scripting) and "Open in New Tab"

**Step 5: Handle "Open in New Tab" from archive**

When clicking "Open in New Tab" on a file in the archive tree, `pagesModel.openFile("D:/temp/doc.zip!file.xml")` is called. The `openFile` flow needs to handle archive inner paths — skip the archive extension check (that's for the outer archive), proceed with `createPageFromFile` which reads content via `app.fs.read()` (already routed).

**Supported archive extensions:** `.zip`, `.docx`, `.xlsx`, `.pptx`, `.jar`, `.war`, `.epub`, `.odt`, `.ods`, `.odp`

### Phase 2b: `.asar` Support (Electron archive)

Electron patches Node's `fs` module to read `.asar` files transparently — `readdirSync`, `readFileSync`, `statSync` all work as if `.asar` is a real directory. No jszip, no `!` separator, no ArchiveService needed.

The only fix: `fs.stat("file.asar")` currently returns `isDirectory: false` (it's a regular file on disk). Override this for `.asar` extensions to return `isDirectory: true`. Then NavigationPanel treats it as a folder and everything works via Electron's native patching.

- Add `.asar` to the archive extension set used by `openFile` hook (Phase 2 Step 3)
- In `fs.stat()`, detect `.asar` extension and return `isDirectory: true`
- No `!` path convention — use regular path separators (`file.asar/src/index.js`)
- Read-only: Electron's `.asar` patch doesn't support writes
- FileWatcher: detect `.asar` in path and return no-op watcher (same as archive paths). Need a helper like `isAsarPath(filePath)` that checks if any segment ends with `.asar`

### Phase 4: Polish

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
**Phase 0: Consolidate file operations through `app.fs`**

| Task | Title | Status |
|------|-------|--------|
| US-159 | Extend `app.fs` API with missing operations | Done |
| US-164 | Create `file-path` utility module + migrate `path.*` usage | Done |
| US-160 | Migrate FileExplorerModel to `app.fs` | Done |
| US-161 | Migrate file-tree-builder to `app.fs` | Done |
| US-162 | Migrate library-service + library-intellisense to `app.fs` | Done |
| US-163 | Migrate TextFileIOModel + themes/index to `app.fs` | Done |

**Phase 1: Archive Service + FileSystem enhancement**

| Task | Title | Status |
|------|-------|--------|
| US-165 | ArchiveService + archive path utilities + fs.ts routing | Done |

**Phase 2: Archive browsing via NavigationPanel**

| Task | Title | Status |
|------|-------|--------|
| US-166 | Archive browsing — fpDirname/fpJoin fixes, openFile hook, NavPanel adaptations | Done |
| US-167 | File operations inside archives — create/rename/delete via ArchiveService + fs.ts | Done |

**Phase 2b: `.asar` support**

| Task | Title | Status |
|------|-------|--------|
| US-168 | `.asar` browsing — stat override + openFile hook | Done |

**Phase 4: Polish**

| Task | Title | Status |
|------|-------|--------|
| US-169 | Archive visual indicators — banner + badge | Done |

## Notes

### 2026-03-11 (initial)
- Epic created based on discussion about opening Word/Excel documents
- Key insight: `.docx`/`.xlsx` are ZIP archives containing XML files
- Initial idea was to use encoding system for zip/unzip — evolved into dedicated archive service with virtual paths
- Archive path separator `!` chosen (invalid in Windows filenames, similar to Java JAR URL convention)
- jszip selected as library (pure JS, read+write, works in renderer)
- Three-phase approach: foundation → viewer → polish

### 2026-03-11 (decisions)
- All 8 open questions resolved:
  - ArchiveService runs in **renderer process** — simplest approach, no IPC
  - FileWatcher **disabled** for archive paths (no auto-reload)
  - **No caching** — re-read/re-zip on every operation
  - **No read-only mode** — full read/write, user takes responsibility
  - **No special tab titles** — standard behavior, hover for full path
  - **No special binary handling** — all files go through standard pipeline
  - Language detected from **inner filename** extension
  - Large archives: jszip is async (yields event loop between chunks), so UI won't fully freeze
- Architecture discussion: considered renderer → main process → worker thread
  - Renderer: simplest, jszip is async so not a full freeze, good enough for typical .docx/.xlsx
  - Main process: would also block its event loop during compression, so IPC progress/cancel wouldn't work
  - Worker thread: only true non-blocking solution, but adds complexity — deferred to Phase 3 if needed
  - **Decision: start simple in renderer, migrate to worker thread later if large archive perf is an issue**
- Added Phase 0 after auditing renderer fs usage:
  - 7 renderer files use `require("fs")` directly instead of `app.fs`
  - `app.fs` missing: `rename()`, `stat()`, `removeDir()`, `listDirWithTypes()`
  - Consolidating first ensures archive path detection in Phase 1 works everywhere automatically
  - Excluded: `file-watcher.ts` (low-level callback-based watcher), `library-require.ts` (core transpiler internals), pure `path.*` imports (no I/O)

### 2026-03-11 (Phase 2 pivot)
- **Dropped custom ZIP Viewer editor** in favor of reusing NavigationPanel + FileExplorer
- Key insight: NavigationPanel already does everything a ZIP Viewer would — file tree, click-to-navigate, context menu, search. All file listing goes through `app.fs.listDirWithTypes()` which already routes archive paths. No need to build a dedicated editor.
- Opening an archive → creates empty text page with NavPanel root set to `archivePath!`
- User browses and clicks files → `navigatePageTo()` opens inner files in standard editors
- Needs: `fpDirname`/`fpJoin` fixes for archive inner paths, `navigatePageTo` async exists check, `openFile` archive extension detection, disable file ops + search in NavPanel for archive roots
- Benefit: zero new editor code, leverages existing battle-tested UI, search/filter features can be added later within the same framework
