# US-289: Browser-webview images — persist across app restart

**Status:** Planned
**Epic:** None

## Goal

When a user opens an image from the built-in browser (or any other source that produces a blob URL), the image should survive app restart. Currently the image is lost because blob URLs are ephemeral and `getRestoreData()` strips them.

## Background

### How browser images are opened today

1. **Browser context menu** (`BrowserWebviewModel.ts` line 361-368): When the user right-clicks an image in the webview and selects "Open Image in New Tab", the handler calls `pagesModel.openImageInNewTab(srcURL)` where `srcURL` is `data.srcURL` from Electron's context menu event.

2. **`data.srcURL` format**: Electron's webview context menu provides the image's original HTTP(S) URL (e.g., `https://example.com/photo.jpg`). It is NOT a blob URL at this point — it is the real network URL of the `<img>` element's `src` attribute.

3. **`openImageInNewTab()`** (`PagesLifecycleModel.ts` lines 711-726):
   ```typescript
   openImageInNewTab = async (imageUrl: string): Promise<void> => {
       const imgModule = await import("../../editors/image/ImageViewer");
       const imgModel = await imgModule.default.newEmptyPageModel("imageFile");
       if (imgModel) {
           imgModel.state.update((s) => {
               s.title = imageUrl.split("/").pop()?.split("?")[0] || "Image";
               s.url = imageUrl;
           });
           await imgModel.restore();
           this.addPage(imgModel);
       }
   };
   ```
   This sets `state.url` to the original HTTP URL and calls `restore()`.

4. **`restore()` in ImageViewerModel** (`ImageViewer.tsx` lines 75-98): The restore method calls `ensurePipe()` (which does nothing if `filePath` is empty), then checks `if (this.pipe && !this.state.get().url)`. Since `url` is already set (the HTTP URL), the pipe-to-blob branch is skipped. The component renders the HTTP URL directly via `<BaseImageView src={url} />`.

5. **The actual problem**: The image displays fine during the session because `<img src="https://...">` works. But on save/restore:
   - `getRestoreData()` strips `url` (line 42-45) because it assumes all URLs are blob URLs
   - No `filePath` is set
   - No `pipe` descriptor is saved (pipe is null)
   - On restart: the page is restored with no url, no filePath, no pipe — blank image

### Other callers of `openImageInNewTab()`

Several other places also call `openImageInNewTab()` with different URL types:

| Caller | URL type | Survives restart? |
|--------|----------|-------------------|
| `BrowserWebviewModel.ts` (browser context menu) | HTTP URL | No |
| `ResponseViewer.tsx` (REST client) | Blob URL (from base64 response) | No |
| `DrawView.tsx` (drawing export) | Blob URL (from canvas export) | No |
| `PinnedLinksPanel.tsx` / `LinkItemTiles.tsx` / `LinkItemList.tsx` (link editor) | HTTP URL (bookmark `imgSrc`) | No |

### How PdfViewer handles non-local content (reference pattern)

`PdfViewerModel` (`PdfViewer.tsx` lines 59-91) demonstrates the cache pattern:

1. In `restore()`, after `ensurePipe()`, it checks the pipe type
2. For non-local sources (HTTP, archive): reads binary via pipe, writes to `appFs.resolveCachePath(this.id + ".pdf")`, sets `cacheFileCreated = true`
3. In `dispose()`: if `cacheFileCreated`, deletes the cache file
4. Note: base `PageModel.dispose()` also calls `fs.deleteCacheFiles(id)` which deletes all files matching `^{id}` in the cache directory

### Key insight: srcURL is an HTTP URL, not a blob

For the browser context menu case (the primary use case), `data.srcURL` is a real HTTP URL. This means we can create an `HttpProvider` pipe pointing to the original URL. The content pipe system already supports `HttpProvider` serialization/deserialization via `toDescriptor()` and `createPipeFromDescriptor()`. This would make browser images restorable without any file caching at all — the pipe would re-fetch from the original URL on restart.

For blob URL cases (REST client, drawing export), blob URLs are inherently ephemeral. These need file caching.

## Implementation Plan

### Approach: Dual strategy based on URL type

- **HTTP/HTTPS URLs**: Create an `HttpProvider` pipe so the image can be re-fetched on restart. Also cache to disk as a fallback (network may be unavailable).
- **Blob URLs**: Cache binary to disk immediately. Cannot be re-fetched.

### Step 1: Stop stripping HTTP URLs in `getRestoreData()`

**File:** `src/renderer/editors/image/ImageViewer.tsx`

Currently:
```typescript
getRestoreData() {
    const data = super.getRestoreData();
    delete data.url;
    return data;
}
```

Change to only strip blob URLs, keep HTTP(S) URLs:
```typescript
getRestoreData() {
    const data = super.getRestoreData();
    // Blob URLs don't survive across sessions — strip them.
    // HTTP(S) URLs are kept as display metadata (the pipe handles re-fetch).
    if (data.url && data.url.startsWith("blob:")) {
        delete data.url;
    }
    return data;
}
```

**Why keep the URL?** The `url` field serves as both the image source for `<img src>` and as metadata. For HTTP images, keeping the URL means the component can render the image immediately from the URL on restart (before the pipe even reads). For blob images, the URL is useless after restart so we still strip it.

### Step 2: Create an HttpProvider pipe for HTTP URLs in `openImageInNewTab()`

**File:** `src/renderer/api/pages/PagesLifecycleModel.ts`

In `openImageInNewTab()`, if the URL is HTTP(S), create an `HttpProvider` pipe and assign it to the model. This way the pipe descriptor gets serialized into `getRestoreData()` via the base `PageModel` logic.

Before (current code):
```typescript
openImageInNewTab = async (imageUrl: string): Promise<void> => {
    const imgModule = await import("../../editors/image/ImageViewer");
    const imgModel = await imgModule.default.newEmptyPageModel("imageFile");
    if (imgModel) {
        imgModel.state.update((s) => {
            s.title = imageUrl.split("/").pop()?.split("?")[0] || "Image";
            s.url = imageUrl;
        });
        await imgModel.restore();
        this.addPage(imgModel);
    }
};
```

After:
```typescript
openImageInNewTab = async (imageUrl: string): Promise<void> => {
    const imgModule = await import("../../editors/image/ImageViewer");
    const imgModel = await imgModule.default.newEmptyPageModel("imageFile");
    if (imgModel) {
        imgModel.state.update((s: { title: string; url?: string }) => {
            s.title = imageUrl.split("/").pop()?.split("?")[0] || "Image";
            s.url = imageUrl;
        });
        // For HTTP(S) URLs, create a pipe so the image can be re-fetched on restart
        if (/^https?:\/\//i.test(imageUrl)) {
            const { HttpProvider } = await import(
                "../../content/providers/HttpProvider"
            );
            const { ContentPipe } = await import("../../content/ContentPipe");
            imgModel.pipe = new ContentPipe(new HttpProvider(imageUrl));
        }
        await imgModel.restore();
        this.addPage(imgModel);
    }
};
```

### Step 3: Enhance `restore()` to cache binary and handle restart

**File:** `src/renderer/editors/image/ImageViewer.tsx`

The current `restore()` flow:
1. Calls `ensurePipe()` (reconstructs pipe from `filePath` — does nothing if `filePath` is empty)
2. If pipe exists and no `url` set → reads binary from pipe → creates blob URL

After the changes in Steps 1-2, on restart:
- `applyRestoreData()` (base PageModel) reconstructs the pipe from the saved descriptor (HttpProvider)
- `url` is set (the HTTP URL was preserved)
- `restore()` runs: `ensurePipe()` does nothing (pipe already exists from descriptor). The `if (this.pipe && !this.state.get().url)` check is false (url is set), so no blob URL is created.
- The component renders `<img src={httpUrl}>` directly — this works.

**But we also want a cached fallback** for when the network is down on restart. Modify `restore()`:

```typescript
async restore() {
    await super.restore();
    const { filePath, url } = this.state.get();
    if (filePath) {
        this.state.update((s) => {
            s.title = fpBasename(filePath);
        });
    }

    // Load image via content pipe → blob URL
    this.ensurePipe();
    if (this.pipe && !url) {
        try {
            const buffer = await this.pipe.readBinary();
            const ext = fpExtname(filePath || this.pipe.provider.sourceUrl || ".png").toLowerCase();
            const mimeType = extToMime(ext);
            const blob = new Blob([new Uint8Array(buffer)], { type: mimeType });
            const blobUrl = URL.createObjectURL(blob);
            this.state.update((s) => { s.url = blobUrl; });

            // Cache to disk for restart recovery (non-local sources only)
            if (this.pipe.provider.type !== "file" || this.pipe.transformers.length > 0) {
                this.cacheImageBuffer(buffer, ext);
            }
        } catch {
            // Pipe read failed — try cache file fallback
            await this.tryRestoreFromCache();
        }
    } else if (!url && !this.pipe) {
        // No pipe, no url — try cache file fallback (restart after blob URL scenario)
        await this.tryRestoreFromCache();
    }
}
```

Add helper methods:

```typescript
private cacheFileCreated = false;

private async cacheImageBuffer(buffer: Buffer): Promise<void> {
    try {
        const cachePath = appFs.resolveCachePath(this.id + ".img");
        await appFs.writeBinary(cachePath, buffer);
        this.cacheFileCreated = true;
    } catch { /* ignore cache write failure */ }
}

private async tryRestoreFromCache(): Promise<void> {
    const cachePath = appFs.resolveCachePath(this.id + ".img");
    if (await appFs.exists(cachePath)) {
        try {
            const buffer = await appFs.readBinary(cachePath);
            const blob = new Blob([new Uint8Array(buffer)], { type: "image/png" });
            const blobUrl = URL.createObjectURL(blob);
            this.state.update((s) => { s.url = blobUrl; });
        } catch { /* cache read failed */ }
    }
}
```

### Step 4: Cache blob URL content immediately in `openImageInNewTab()`

For blob URLs (from REST client, drawing export), we need to cache the binary at creation time, since the blob URL won't survive restart and there's no pipe to re-fetch from.

**File:** `src/renderer/api/pages/PagesLifecycleModel.ts`

After the model is created and `restore()` is called, if the URL is a blob URL, fetch and cache:

```typescript
openImageInNewTab = async (imageUrl: string): Promise<void> => {
    const imgModule = await import("../../editors/image/ImageViewer");
    const imgModel = await imgModule.default.newEmptyPageModel("imageFile");
    if (imgModel) {
        imgModel.state.update((s: { title: string; url?: string }) => {
            s.title = imageUrl.split("/").pop()?.split("?")[0] || "Image";
            s.url = imageUrl;
        });
        if (/^https?:\/\//i.test(imageUrl)) {
            const { HttpProvider } = await import(
                "../../content/providers/HttpProvider"
            );
            const { ContentPipe } = await import("../../content/ContentPipe");
            imgModel.pipe = new ContentPipe(new HttpProvider(imageUrl));
        }
        await imgModel.restore();
        this.addPage(imgModel);

        // For blob URLs, cache binary to disk for restart recovery
        if (imageUrl.startsWith("blob:")) {
            this.cacheImageFromBlobUrl(imgModel, imageUrl);
        }
    }
};

private cacheImageFromBlobUrl(model: PageModel, blobUrl: string): void {
    fetch(blobUrl)
        .then((r) => r.arrayBuffer())
        .then(async (ab) => {
            const { fs: appFs } = await import("../../api/fs");
            const buffer = Buffer.from(ab);
            const cachePath = appFs.resolveCachePath(model.id + ".img");
            await appFs.writeBinary(cachePath, buffer);
        })
        .catch(() => { /* ignore cache failure */ });
}
```

**Alternative (cleaner):** Add a `cacheFromUrl(url: string)` method directly on `ImageViewerModel` and call it from `openImageInNewTab()`. This keeps the caching logic inside the model.

### Step 5: Clean up cache file on dispose

**File:** `src/renderer/editors/image/ImageViewer.tsx`

The base `PageModel.dispose()` already calls `fs.deleteCacheFiles(this.id)` which deletes all files matching `^{id}` in the cache directory. This will clean up our cached image files automatically (e.g., `{id}.png`, `{id}.jpg`).

However, the explicit `cacheFileCreated` flag pattern (used by PdfViewer) is cleaner and more intentional. Add to `dispose()`:

```typescript
async dispose(): Promise<void> {
    const url = this.state.get().url;
    if (url && url.startsWith("blob:")) {
        URL.revokeObjectURL(url);
    }
    // Note: base dispose() calls fs.deleteCacheFiles(id) which handles cleanup
    await super.dispose();
}
```

No changes needed here — the existing `dispose()` plus base class cleanup already handles this.

### Step 6: Handle `applyRestoreData` for the `url` field

**File:** `src/renderer/editors/image/ImageViewer.tsx`

Currently `ImageViewerModel` does not override `applyRestoreData()`. The base `PageModel.applyRestoreData()` only restores standard `IPageState` fields (`id`, `type`, `title`, `modified`, `filePath`, `editor`, `pinned`) and `pipe`. It does NOT restore the custom `url` field.

Need to override `applyRestoreData()`:

```typescript
applyRestoreData(data: Partial<ImageViewerModelState>): void {
    super.applyRestoreData(data);
    if (data.url) {
        this.state.update((s) => { s.url = data.url; });
    }
}
```

**This is critical.** Without this, the HTTP URL saved in Step 1 would never be applied on restart, and the image would still be blank.

## Concerns / Open questions

### 1. Caching strategy for blob URLs: extension guessing
When caching a blob URL, we default to `.png`. The actual content type may differ. We could inspect the blob's MIME type via `fetch(blobUrl).then(r => r.headers.get("content-type"))` but blob URLs from `URL.createObjectURL()` may not always have accurate content-type headers. Using `.png` as fallback is pragmatic — modern browsers handle MIME-mismatched image data gracefully.

### 2. Cache file extension for HTTP URLs
For HTTP URLs, we can extract the extension from the URL path (e.g., `.jpg` from `https://example.com/photo.jpg`). But some URLs have no extension (e.g., `https://example.com/image/123`). We should fall back to `.img` or `.png`.

### 3. `tryRestoreFromCache()` — use single `.img` extension
Use a single fixed extension `.img` for all cached images (both HTTP and blob). No need to scan multiple extensions. Determine MIME type from buffer magic bytes on read, or default to `image/png`. Browsers are forgiving with image MIME types.

### 4. Should HTTP images render directly or via blob URL?
Currently, for HTTP URLs, the `<img src>` uses the HTTP URL directly. This means:
- **Pro:** Works immediately, no fetch needed in renderer
- **Pro:** No blob URL memory allocation
- **Con:** If the remote server requires specific headers/cookies that the webview had but `<img>` doesn't, it won't load
- **Con:** CORS or authentication issues with direct `<img src="https://...">`

For the browser context menu case, `data.srcURL` is the raw image URL which typically works with a plain `<img>` tag. This should be fine for most cases.

### 5. Cache write on app close
The app's close flow sends an event to the renderer window, which performs `saveState()` on all open page models. The main process waits up to 2 seconds for the window to confirm it's ready to close. ImageViewerModel should ensure the cache file is written during `saveState()` (not as a fire-and-forget async). This way the cache write completes before the app shuts down, same as other page models.

### 6. newPageModelFromState needs url support
The `newPageModelFromState` factory function spreads state into the initial state. Since `ImageViewerModelState` includes `url?: string`, and the spread `{ ...getDefaultImageViewerModelState(), ...state }` would include `url` from the incoming state, this should work automatically. But verify that the restore path via `applyRestoreData()` → `restore()` correctly handles the `url` field being set (Step 6 above is the fix).

## Acceptance Criteria

1. **Browser image persists:** Open an image from the browser webview context menu → close and restart the app → the image tab is restored and the image is visible.
2. **HTTP URL re-fetch:** On restart, if the network is available, the image loads from the original HTTP URL (visible in `state.url`).
3. **Cache fallback:** If the image was cached and the network is unavailable on restart, the image still loads from the cache file.
4. **Blob URL images cached:** Open an image from the REST client response viewer → close and restart → the image is restored from cache.
5. **Cleanup on close:** When the image tab is closed, the cache file is deleted (via base `PageModel.dispose()` → `fs.deleteCacheFiles(id)`).
6. **No regression:** Opening a local image file (via File > Open) still works correctly. The `filePath`-based flow is unchanged.
7. **Save Image button:** The "Save Image to File" button (shown for URL-based images, not file-based) still works and switches the page to file-based mode.

## Files Changed

| File | Change |
|------|--------|
| `src/renderer/editors/image/ImageViewer.tsx` | Modify `getRestoreData()` to keep HTTP URLs; add `applyRestoreData()` override; add `cacheImageBuffer()`, `tryRestoreFromCache()` helpers; update `restore()` with cache write and fallback read |
| `src/renderer/api/pages/PagesLifecycleModel.ts` | In `openImageInNewTab()`: create HttpProvider pipe for HTTP URLs; cache blob URL content to disk |
| `src/renderer/api/fs.ts` | No changes needed (existing `resolveCachePath`, `writeBinary`, `readBinary`, `exists` are sufficient) |
| `src/renderer/content/providers/HttpProvider.ts` | No changes needed (already serializable via `toDescriptor()`) |
| `src/renderer/editors/base/PageModel.ts` | No changes needed (existing `dispose()` → `deleteCacheFiles()` handles cleanup) |
