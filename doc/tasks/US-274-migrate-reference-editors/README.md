# US-274: Migrate Reference Editors

## Status

**Status:** Planned
**Priority:** Medium
**Epic:** EPIC-012
**Started:** —
**Completed:** —

## Summary

Migrate PDF viewer and image viewer to load content through `IContentPipe` instead of constructing `safe-file://` URLs from `filePath`. After this, both editors work with any provider (FileProvider, HttpProvider, archive pipes).

## Why

- PDF and image viewers currently only work with local file paths (via `safe-file://` protocol)
- HTTP URLs fail: `safe-file://https//...` → 403 Forbidden (not a valid local path)
- Archive inner files (ZIP entries) also fail through `safe-file://`
- Content pipe gives these editors a uniform way to load from any source

## Background

### Current architecture

**Image Viewer:**
- `<img src="safe-file://${filePath}">` for local files
- `<img src="${blobUrl}">` for external images (already supports blob URLs)
- `BaseImageView` component handles zoom/pan/clipboard

**PDF Viewer:**
- `<object data="app-asset://pdfjs/web/viewer.html?file=${safeFileUrl}">` — iframe with pdfjs
- pdfjs fetches PDF from `safe-file://` URL via Fetch API
- Supports range requests (streaming for large PDFs)
- **Cross-origin issue:** Blob URLs created in the main renderer can't be accessed from the pdfjs iframe (different origin: `app-asset://pdfjs`)

### The `safe-file://` problem

| Source | safe-file:// | Works? |
|--------|-------------|--------|
| Local file `C:\doc.pdf` | `safe-file://C:/doc.pdf` | Yes |
| HTTP `https://example.com/doc.pdf` | `safe-file://https//example.com/doc.pdf` | No (403) |
| Archive `C:\docs.zip!doc.pdf` | `safe-file://C:/docs.zip!doc.pdf` | No (invalid path) |

## Implementation Plan

### Image Viewer — Blob URL approach

**Strategy:** Read bytes via pipe → create blob URL → use as `<img src>`.

The image viewer already supports blob URLs (`state.url` field). The migration:

1. In `restore()` or component mount, read image bytes from pipe:
   ```typescript
   const buffer = await model.pipe.readBinary();
   const blob = new Blob([buffer], { type: mimeType });
   const blobUrl = URL.createObjectURL(blob);
   model.state.update(s => { s.url = blobUrl; });
   ```

2. `dispose()` already revokes blob URLs — no change needed

3. For local files, this uses slightly more memory than `safe-file://` (image loaded into JS heap), but images are typically small and the memory is freed on dispose.

4. The existing `safe-file://` code path can be removed — all sources use blob URL.

**MIME type detection:** Derive from file extension or provider URL:
- `.png` → `image/png`, `.jpg`/`.jpeg` → `image/jpeg`, `.gif` → `image/gif`, etc.
- The `extToMime()` function already exists in `drawExport.ts`

### PDF Viewer — Temp file approach

**Problem:** pdfjs runs in a cross-origin iframe and can't access blob URLs from the main renderer.

**Strategy:** For non-local sources, write PDF bytes to a temp/cache file, then serve via `safe-file://`.

1. Check if the pipe's provider is a `FileProvider`:
   - **Yes:** Use `safe-file://${provider.sourceUrl}` directly (current behavior, efficient streaming)
   - **No (HTTP, archive, buffer):** Read all bytes via `pipe.readBinary()`, write to a temp file in the cache directory, use `safe-file://` for the temp file

2. Temp file management:
   - Path: `appFs.resolveCachePath(pageId + ".pdf")`
   - Written in `restore()` or component mount
   - Cleaned up in `dispose()` (delete temp file)

3. This preserves pdfjs's streaming behavior for local files while enabling HTTP/archive sources.

**Alternative considered: pdfjs data parameter.**
pdfjs supports `pdfjsLib.getDocument({ data: uint8Array })` but this requires rewriting the viewer to use the programmatic API instead of the iframe viewer.html. Too big a change for this task — the iframe approach is proven and well-tested.

## Acceptance Criteria

- [ ] Image viewer loads content via `pipe.readBinary()` → blob URL
- [ ] Image viewer works with FileProvider (local files)
- [ ] Image viewer works with HttpProvider (HTTP URLs)
- [ ] Image viewer works with FileProvider + ZipTransformer (archive entries)
- [ ] PDF viewer works with FileProvider (local files — same as current)
- [ ] PDF viewer works with HttpProvider (downloads to temp, then safe-file://)
- [ ] PDF viewer works with archive entries (extracts to temp, then safe-file://)
- [ ] Temp files cleaned up on page dispose
- [ ] No regressions with local file images and PDFs

## Files to Modify

| File | Change |
|------|--------|
| `src/renderer/editors/image/ImageViewer.tsx` | Load via pipe.readBinary() → blob URL |
| `src/renderer/editors/pdf/PdfViewer.tsx` | Detect provider type, temp file for non-local sources |

## Concerns

**C1: Image memory usage.** Loading images into JS heap via blob URL uses more memory than `safe-file://` streaming. For typical images (< 20MB) this is fine. For very large images, could be an issue — but these are rare in practice.

**C2: PDF temp file for archives.** When opening a PDF from a ZIP archive, the entire PDF is extracted to a temp file. This is the same behavior as the current archive service (which also extracts to memory). The temp file is actually more efficient — it's written to disk rather than held in memory.

## Related

- Epic: [EPIC-012](../../epics/EPIC-012.md)
- Depends on: US-268 (TextFileIOModel migration — pipe on PageModel)
- safe-file:// protocol: `src/main/main-setup.ts` (lines 69-101)
- pdfjs viewer: `assets/pdfjs/web/viewer.html` (unmodified)
