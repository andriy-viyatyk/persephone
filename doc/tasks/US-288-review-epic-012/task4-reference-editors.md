# Task 4: Reference Editors Pipe Completion

## Goal

Complete pipe integration for page-editors (ImageViewer, PdfViewer) and openDiff, so they work uniformly with file, archive, and HTTP sources via the content pipe system.

## Files Changed

| File | Change |
|------|--------|
| `src/renderer/api/pages/PagesLifecycleModel.ts` | Remove archive guard in `newPageModel()` (line 33); add pipe creation in `openDiff()` |
| `src/renderer/editors/image/ImageViewer.tsx` | Add `ensurePipe()` to `restore()`; use pipe in "Open in Drawing Editor"; remove `safe-file://` fallback |
| `src/renderer/editors/pdf/PdfViewer.tsx` | Add `ensurePipe()` to `restore()`; remove `safe-file://` fallback from component |
| `src/renderer/content/resolvers.ts` | Remove outdated comment about page-editors not supporting HTTP (line 89) |

## Implementation Plan

### Item 1: Remove page-editor archive guard in `newPageModel()`

**File:** `src/renderer/api/pages/PagesLifecycleModel.ts`, line 30-41

**Problem:** The guard at line 33 prevents page-editors (image, PDF) from being selected when the path is an archive path. Before EPIC-012, page-editors needed real file paths. Now they receive a pipe with a ZipTransformer and can read via `pipe.readBinary()`.

**Flow verification:** When opening an archive inner file:
1. User clicks file in NavPanel -> `navigatePageTo()` or `openRawLink` event
2. `parsers.ts` parses the `!`-separated path
3. `resolvers.ts` file resolver (line 54-81) creates `ContentPipe(FileProvider(archivePath), [ZipTransformer(entryPath)])`
4. `open-handler.ts` calls `pagesModel.lifecycle.openFile(filePath, pipe)`
5. `openFile()` calls `createPageFromFile(filePath, pipe)` (line 232)
6. `createPageFromFile()` calls `newPageModel(filePath)` which resolves the editor, then sets `pageModel.pipe = pipe` (line 71), then calls `pageModel.restore()` (line 76)

The pipe IS passed through correctly. The only blocker is `newPageModel()` refusing to use page-editors for archive paths.

**Before (line 30-41):**
```typescript
private newPageModel = async (filePath?: string): Promise<PageModel> => {
    const editorDef = editorRegistry.resolve(filePath);
    // Archive inner paths can't use page-editors (image, pdf) — they need real file paths
    if (editorDef && !(filePath && isArchivePath(filePath) && editorDef.category === "page-editor")) {
        const module = await editorDef.loadModule();
        return module.newPageModel(filePath);
    }
    const def = editorRegistry.getById("monaco");
    if (!def) throw new Error("Monaco editor not registered");
    const module = await def.loadModule();
    return module.newPageModel(filePath);
};
```

**After:**
```typescript
private newPageModel = async (filePath?: string): Promise<PageModel> => {
    const editorDef = editorRegistry.resolve(filePath);
    if (editorDef) {
        const module = await editorDef.loadModule();
        return module.newPageModel(filePath);
    }
    const def = editorRegistry.getById("monaco");
    if (!def) throw new Error("Monaco editor not registered");
    const module = await def.loadModule();
    return module.newPageModel(filePath);
};
```

Also remove the `isArchivePath` import if no longer used elsewhere in this file. Check: `isArchivePath` is imported at line 17. Grep the file for other uses — it is NOT used anywhere else in this file, so remove it from the import.

**Before (line 17):**
```typescript
import { fpBasename, fpExtname, isArchivePath } from "../../core/utils/file-path";
```

**After:**
```typescript
import { fpBasename, fpExtname } from "../../core/utils/file-path";
```

---

### Item 2: ImageViewer — add `ensurePipe()`, remove fs fallbacks

**File:** `src/renderer/editors/image/ImageViewer.tsx`

#### 2a: Add `ensurePipe()` method to `ImageViewerModel`

The `ensurePipe()` pattern from `TextFileIOModel` (lines 29-48 of `TextFileIOModel.ts`) reconstructs a pipe from `filePath` when the model has no pipe. This handles:
- **App restart:** `applyRestoreData()` in `PageModel` (line 103-123) reconstructs pipe from the serialized descriptor. But if the descriptor was missing (legacy pages saved before EPIC-012), `this.pipe` will be null.
- **Legacy pages:** Old pages have `filePath` but no pipe descriptor in saved state.

Add to `ImageViewerModel` class (after `dispose()`, before `restore()`):

**New code to insert after line 44 (`await super.dispose(); }`):**
```typescript
/** Reconstruct pipe from filePath if not already present (legacy compat / app restart). */
private ensurePipe(): void {
    if (this.pipe) return;
    const filePath = this.state.get().filePath;
    if (!filePath) return;

    const bangIndex = filePath.indexOf("!");
    if (bangIndex >= 0) {
        const archivePath = filePath.slice(0, bangIndex);
        const entryPath = filePath.slice(bangIndex + 1);
        this.pipe = new ContentPipe(
            new FileProvider(archivePath),
            [new ZipTransformer(entryPath)],
        );
    } else {
        this.pipe = new ContentPipe(new FileProvider(filePath));
    }
}
```

This requires new imports:
```typescript
import { ContentPipe } from "../../content/ContentPipe";
import { FileProvider } from "../../content/providers/FileProvider";
import { ZipTransformer } from "../../content/transformers/ZipTransformer";
```

#### 2b: Update `restore()` to call `ensurePipe()`

**Before (line 46-68):**
```typescript
async restore() {
    await super.restore();
    const filePath = this.state.get().filePath;
    if (filePath) {
        this.state.update((s) => {
            s.title = fpBasename(filePath);
        });
    }

    // Load image via content pipe → blob URL
    if (this.pipe && !this.state.get().url) {
        try {
            const buffer = await this.pipe.readBinary();
            const ext = fpExtname(filePath || this.pipe.provider.sourceUrl || ".png").toLowerCase();
            const mimeType = extToMime(ext);
            const blob = new Blob([new Uint8Array(buffer)], { type: mimeType });
            const blobUrl = URL.createObjectURL(blob);
            this.state.update((s) => { s.url = blobUrl; });
        } catch {
            // Pipe read failed — fall back to safe-file:// if filePath exists
        }
    }
}
```

**After:**
```typescript
async restore() {
    await super.restore();
    const filePath = this.state.get().filePath;
    if (filePath) {
        this.state.update((s) => {
            s.title = fpBasename(filePath);
        });
    }

    // Load image via content pipe → blob URL
    this.ensurePipe();
    if (this.pipe && !this.state.get().url) {
        try {
            const buffer = await this.pipe.readBinary();
            const ext = fpExtname(filePath || this.pipe.provider.sourceUrl || ".png").toLowerCase();
            const mimeType = extToMime(ext);
            const blob = new Blob([new Uint8Array(buffer)], { type: mimeType });
            const blobUrl = URL.createObjectURL(blob);
            this.state.update((s) => { s.url = blobUrl; });
        } catch {
            // Pipe read failed — no image displayed
        }
    }
}
```

Key changes: added `this.ensurePipe();` before the pipe check, and removed the comment about falling back to `safe-file://`.

#### 2c: Update "Open in Drawing Editor" button to use pipe

**Before (line 176-197):**
```typescript
onClick={async () => {
    const { filePath: fp, url: u } = model.state.get();
    let dataUrl: string;
    let mimeType: string;
    if (fp) {
        const buffer = await fs.readBinary(fp);
        const ext = fpExtname(fp).toLowerCase();
        mimeType = extToMime(ext);
        dataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;
    } else if (u) {
        const response = await fetch(u);
        const blob = await response.blob();
        mimeType = blob.type || "image/png";
        const buffer = Buffer.from(await blob.arrayBuffer());
        dataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;
    } else {
        return;
    }
    const dims = await getImageDimensions(dataUrl);
    const json = buildExcalidrawJsonWithImage(dataUrl, mimeType, dims.width, dims.height);
    const baseName = fp ? fpBasename(fp).replace(/\.\w+$/, "") : "image";
    pagesModel.addEditorPage("draw-view", "json", baseName + ".excalidraw", json);
}}
```

**After:**
```typescript
onClick={async () => {
    const { filePath: fp, url: u } = model.state.get();
    let dataUrl: string;
    let mimeType: string;
    if (model.pipe) {
        const buffer = await model.pipe.readBinary();
        const ext = fpExtname(fp || model.pipe.provider.sourceUrl || ".png").toLowerCase();
        mimeType = extToMime(ext);
        dataUrl = `data:${mimeType};base64,${Buffer.from(buffer).toString("base64")}`;
    } else if (u) {
        const response = await fetch(u);
        const blob = await response.blob();
        mimeType = blob.type || "image/png";
        const buffer = Buffer.from(await blob.arrayBuffer());
        dataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;
    } else {
        return;
    }
    const dims = await getImageDimensions(dataUrl);
    const json = buildExcalidrawJsonWithImage(dataUrl, mimeType, dims.width, dims.height);
    const baseName = fp ? fpBasename(fp).replace(/\.\w+$/, "") : "image";
    pagesModel.addEditorPage("draw-view", "json", baseName + ".excalidraw", json);
}}
```

Changes: `if (fp)` with `fs.readBinary(fp)` becomes `if (model.pipe)` with `model.pipe.readBinary()`. The `buffer.toString("base64")` needs `Buffer.from(buffer)` wrapping since `pipe.readBinary()` returns a Buffer (actually this is already a Buffer, so `Buffer.from()` is a no-op but safe).

#### 2d: Remove `safe-file://` fallback from component

**Before (line 132):**
```typescript
const src = url || `safe-file://${filePath?.replace(/\\/g, "/") || ""}`;
```

**After:**
```typescript
const src = url || "";
```

When `ensurePipe()` is in place, `restore()` will always create a blob URL from the pipe for file-backed images. The `safe-file://` fallback is no longer needed. If there's no URL and no pipe (shouldn't happen for file-backed pages), no image is shown — which is correct.

#### 2e: Remove unused `fs` import

After the changes above, `fs` (from `../../api/fs`) is only used in `saveImage()` via `fs.showSaveDialog()` and `fs.saveBinaryFile()`. Check:
- Line 12: `import { fs } from "../../api/fs";` — still needed for `saveImage()`
- Line 181: `await fs.readBinary(fp)` — being removed

The `fs` import is still needed for `saveImage()`. Keep it.

---

### Item 3: PdfViewer — add `ensurePipe()`, remove `safe-file://` fallback

**File:** `src/renderer/editors/pdf/PdfViewer.tsx`

#### 3a: Add `ensurePipe()` method to `PdfViewerModel`

Same pattern as ImageViewer. Add after line 35 (`private cacheFileCreated = false;`):

**New code:**
```typescript
/** Reconstruct pipe from filePath if not already present (legacy compat / app restart). */
private ensurePipe(): void {
    if (this.pipe) return;
    const filePath = this.state.get().filePath;
    if (!filePath) return;

    const bangIndex = filePath.indexOf("!");
    if (bangIndex >= 0) {
        const archivePath = filePath.slice(0, bangIndex);
        const entryPath = filePath.slice(bangIndex + 1);
        this.pipe = new ContentPipe(
            new FileProvider(archivePath),
            [new ZipTransformer(entryPath)],
        );
    } else {
        this.pipe = new ContentPipe(new FileProvider(filePath));
    }
}
```

New imports needed:
```typescript
import { ContentPipe } from "../../content/ContentPipe";
import { FileProvider } from "../../content/providers/FileProvider";
import { ZipTransformer } from "../../content/transformers/ZipTransformer";
```

#### 3b: Update `restore()` to call `ensurePipe()`

**Before (line 37-68):**
```typescript
async restore() {
    await super.restore();
    const filePath = this.state.get().filePath;
    if (filePath) {
        this.state.update((s) => {
            s.title = fpBasename(filePath);
        });
    }

    // Determine local path for safe-file:// protocol
    if (this.pipe) {
        if (this.pipe.provider.type === "file" && this.pipe.transformers.length === 0) {
            // Plain FileProvider — use source path directly (efficient streaming)
            this.state.update((s) => {
                s.localPdfPath = this.pipe!.provider.sourceUrl;
            });
        } else {
            // Non-local source (HTTP, archive, etc.) — read and cache as temp file
            try {
                const buffer = await this.pipe.readBinary();
                const cachePath = appFs.resolveCachePath(this.id + ".pdf");
                await appFs.writeBinary(cachePath, buffer);
                this.cacheFileCreated = true;
                this.state.update((s) => {
                    s.localPdfPath = cachePath;
                });
            } catch {
                // Pipe read failed — localPdfPath stays undefined
            }
        }
    }
}
```

**After:**
```typescript
async restore() {
    await super.restore();
    const filePath = this.state.get().filePath;
    if (filePath) {
        this.state.update((s) => {
            s.title = fpBasename(filePath);
        });
    }

    // Determine local path for safe-file:// protocol
    this.ensurePipe();
    if (this.pipe) {
        if (this.pipe.provider.type === "file" && this.pipe.transformers.length === 0) {
            // Plain FileProvider — use source path directly (efficient streaming)
            this.state.update((s) => {
                s.localPdfPath = this.pipe!.provider.sourceUrl;
            });
        } else {
            // Non-local source (HTTP, archive, etc.) — read and cache as temp file
            try {
                const buffer = await this.pipe.readBinary();
                const cachePath = appFs.resolveCachePath(this.id + ".pdf");
                await appFs.writeBinary(cachePath, buffer);
                this.cacheFileCreated = true;
                this.state.update((s) => {
                    s.localPdfPath = cachePath;
                });
            } catch {
                // Pipe read failed — localPdfPath stays undefined
            }
        }
    }
}
```

Only change: `this.ensurePipe();` added before the `if (this.pipe)` block.

#### 3c: Remove `safe-file://` fallback from component

**Before (line 96-101):**
```typescript
// Use localPdfPath (set by restore) or fall back to filePath for backward compat
const servePath = localPdfPath || filePath;
const fileUrl = servePath ? `safe-file://${servePath.replace(/\\/g, "/")}` : "";
const viewerUrl = fileUrl
    ? `app-asset://pdfjs/web/viewer.html?file=${encodeURIComponent(fileUrl)}`
    : "";
```

**After:**
```typescript
const fileUrl = localPdfPath ? `safe-file://${localPdfPath.replace(/\\/g, "/")}` : "";
const viewerUrl = fileUrl
    ? `app-asset://pdfjs/web/viewer.html?file=${encodeURIComponent(fileUrl)}`
    : "";
```

With `ensurePipe()`, `restore()` will always set `localPdfPath` for file-backed pages (either directly from FileProvider's sourceUrl, or via cache file). The fallback to raw `filePath` is no longer needed. If `localPdfPath` is empty (pipe read failed), no PDF is shown.

The `filePath` variable on line 93 is still used for the NavPanel button (line 106) and title (line 40), so keep the `const filePath = model.state.use(...)` line.

---

### Item 4: openDiff migration to pipes

**File:** `src/renderer/api/pages/PagesLifecycleModel.ts`, lines 291-327

**Problem:** `openDiff()` calls `createPageFromFile(firstPath)` and `createPageFromFile(secondPath)` without pipes. For plain file paths this works because `TextFileIOModel.ensurePipe()` auto-creates a `FileProvider`. But for HTTP URLs or archive paths, the text editor will get a `FileProvider("https://...")` or `FileProvider("C:/docs.zip!file.txt")` which is wrong.

**Approach:** Create pipes for each path before calling `createPageFromFile`. Use the same logic as the file resolver in `resolvers.ts`:
- If path contains `!` → `ContentPipe(FileProvider(archivePath), [ZipTransformer(entryPath)])`
- If path starts with `http://` or `https://` → `ContentPipe(HttpProvider(url))`
- Otherwise → `ContentPipe(FileProvider(path))`

**Before (line 291-327):**
```typescript
openDiff = async (
    params: { firstPath: string; secondPath: string } | undefined
) => {
    if (!params) return;
    const { firstPath, secondPath } = params;
    if (!firstPath || !secondPath) return;
    let existingFirst = this.model.state
        .get()
        .pages.find((p) => p.state.get().filePath === firstPath);
    let existingSecond = this.model.state
        .get()
        .pages.find((p) => p.state.get().filePath === secondPath);

    if (!existingFirst) {
        existingFirst = await this.createPageFromFile(firstPath);
        this.addPage(existingFirst);
    }
    if (!existingSecond) {
        existingSecond = await this.createPageFromFile(secondPath);
        this.addPage(existingSecond);
    }

    this.model.layout.groupTabs(existingFirst.id, existingSecond.id, true);
    this.model.layout.fixCompareMode();
    if (
        isTextFileModel(existingFirst) &&
        isTextFileModel(existingSecond)
    ) {
        existingFirst.state.update((s) => {
            s.compareMode = true;
        });
        existingSecond.state.update((s) => {
            s.compareMode = true;
        });
    }
    this.model.navigation.showPage(existingFirst.id);
};
```

**After:**
```typescript
openDiff = async (
    params: { firstPath: string; secondPath: string } | undefined
) => {
    if (!params) return;
    const { firstPath, secondPath } = params;
    if (!firstPath || !secondPath) return;
    let existingFirst = this.model.state
        .get()
        .pages.find((p) => p.state.get().filePath === firstPath);
    let existingSecond = this.model.state
        .get()
        .pages.find((p) => p.state.get().filePath === secondPath);

    if (!existingFirst) {
        const pipe = this.createPipeFromPath(firstPath);
        existingFirst = await this.createPageFromFile(firstPath, pipe);
        this.addPage(existingFirst);
    }
    if (!existingSecond) {
        const pipe = this.createPipeFromPath(secondPath);
        existingSecond = await this.createPageFromFile(secondPath, pipe);
        this.addPage(existingSecond);
    }

    this.model.layout.groupTabs(existingFirst.id, existingSecond.id, true);
    this.model.layout.fixCompareMode();
    if (
        isTextFileModel(existingFirst) &&
        isTextFileModel(existingSecond)
    ) {
        existingFirst.state.update((s) => {
            s.compareMode = true;
        });
        existingSecond.state.update((s) => {
            s.compareMode = true;
        });
    }
    this.model.navigation.showPage(existingFirst.id);
};
```

**New helper method** (add as a private method in `PagesLifecycleModel`):
```typescript
/** Create a content pipe from a path string (file, archive, or HTTP). */
private createPipeFromPath(path: string): IContentPipe {
    if (path.startsWith("http://") || path.startsWith("https://")) {
        return new ContentPipe(new HttpProvider(path));
    }
    const bangIndex = path.indexOf("!");
    if (bangIndex >= 0) {
        const archivePath = path.slice(0, bangIndex);
        const entryPath = path.slice(bangIndex + 1);
        return new ContentPipe(
            new FileProvider(archivePath),
            [new ZipTransformer(entryPath)],
        );
    }
    return new ContentPipe(new FileProvider(path));
}
```

**New imports needed** in `PagesLifecycleModel.ts`:
```typescript
import { ContentPipe } from "../../content/ContentPipe";
import { FileProvider } from "../../content/providers/FileProvider";
import { HttpProvider } from "../../content/providers/HttpProvider";
import { ZipTransformer } from "../../content/transformers/ZipTransformer";
```

Note: `IContentPipe` is already imported (line 20).

---

### Item 5: Remove outdated comment in resolvers.ts

**File:** `src/renderer/content/resolvers.ts`, line 88-89

**Before:**
```typescript
    // Only text-based content is supported (Monaco editor). Page-editors
    // (image, PDF) can't handle HTTP sources yet (US-274).
```

The HTTP resolver already maps image extensions to `image-view` and `.pdf` to `pdf-view` (lines 131-138). This comment is outdated and misleading. Remove it.

**After:**
```typescript
    // Extension map determines which editor handles each URL.
```

---

## Concerns

### Concern 1: URL-only images (browser webview)
The `ImageViewerModel` has a `url` state field for external images (e.g., right-click "Open Image in New Tab" from browser). These have no `filePath` and no pipe. The `ensurePipe()` method handles this correctly — it returns early when `filePath` is null. The `restore()` code then checks `if (this.pipe && !this.state.get().url)` — since there's already a `url` set, it skips pipe reading. No issue here.

### Concern 2: PDF `readBinary()` failure after `ensurePipe()`
If `ensurePipe()` creates a pipe but `readBinary()` fails in PdfViewer's `restore()` (e.g., file deleted, permission error), `localPdfPath` stays undefined and no PDF is displayed. This is acceptable behavior — same as current behavior when pipe read fails (line 63-65). The user sees a blank page, which is reasonable for a missing file.

### Concern 3: `navigatePageTo` does not pass pipes
`navigatePageTo()` (line 331-434) calls `createPageFromFile(newFilePath)` without a pipe (line 367). For archive paths navigated via NavPanel, this means the new page won't get a pipe from the caller. However, `ensurePipe()` in the page model will reconstruct the pipe from `filePath`. For HTTP URLs, `navigatePageTo` is not typically used (HTTP pages don't have NavPanel navigation). This is acceptable for now.

### Concern 4: `openDiff` with HTTP — compare mode limitations
`openDiff` creates two pages and enables `compareMode`. This only works when both pages are `TextFileModel` (checked at line 315-325). HTTP-sourced PDFs or images in diff mode would just show two pages side-by-side without compare features, which is reasonable.

### Concern 5: Memory — large images as blob URLs
`ImageViewer.restore()` reads the entire image into memory as a Buffer, then creates a Blob URL. For very large images (e.g., 100MB BMP), this doubles memory usage (Buffer + Blob). This is the existing behavior and not introduced by this task. No change needed.

### Concern 6: `createPipeFromPath` duplication
The `createPipeFromPath` helper in `PagesLifecycleModel` duplicates logic from `resolvers.ts` file resolver and `TextFileIOModel.ensurePipe()`. Consider extracting to a shared utility in the future. For now, keeping it local is simpler and avoids circular imports.

## Testing Notes

### Item 1 — Archive guard removal
1. Open a ZIP archive via NavPanel
2. Click on a `.png` or `.jpg` file inside the archive → should open in ImageViewer (not Monaco)
3. Click on a `.pdf` file inside the archive → should open in PdfViewer (not Monaco)
4. Click on a `.json` file inside the archive → should still open in Monaco (no regression)

### Item 2 — ImageViewer pipe
1. Open a local image file → displays correctly via blob URL
2. Open an image from inside a ZIP archive → displays correctly
3. Open an image via HTTP URL (e.g., paste `https://example.com/image.png` in Open URL dialog) → displays correctly
4. Click "Open in Drawing Editor" on a local image → opens in Excalidraw
5. Click "Open in Drawing Editor" on an archive image → opens in Excalidraw (uses pipe)
6. Right-click "Open Image in New Tab" from browser → still works (URL path, no pipe)
7. Restart app with an image tab open → image restores correctly (pipe reconstructed from descriptor or ensurePipe)

### Item 3 — PdfViewer pipe
1. Open a local PDF file → displays via `safe-file://` (direct FileProvider path)
2. Open a PDF from inside a ZIP archive → displays via cache file
3. Open a PDF via HTTP URL → displays via cache file
4. Restart app with a PDF tab open → PDF restores correctly

### Item 4 — openDiff with pipes
1. Use "Compare Files" to diff two local files → works as before
2. Use "Compare Files" with an archive path (e.g., `C:\docs.zip!file1.txt`) → opens correctly with pipe
3. Verify compare mode indicators appear for text files
