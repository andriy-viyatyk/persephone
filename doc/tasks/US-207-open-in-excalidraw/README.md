# US-207: Open image/SVG in Excalidraw editor

**Epic:** [EPIC-007](../../epics/EPIC-007.md)
**Status:** Planned

## Goal

Add "Open in Drawing" toolbar buttons to the SVG preview editor and Image viewer, allowing users to open any image or SVG as a background in a new Excalidraw drawing page for annotation.

## Background

### How Excalidraw embeds images

Excalidraw stores images as `BinaryFileData` entries in a `files` map, linked to `type: "image"` elements via `fileId`:

```typescript
// files map entry
{
    id: "some-file-id",           // FileId (branded string)
    mimeType: "image/png",        // or "image/svg+xml", "image/jpeg", etc.
    dataURL: "data:image/png;base64,...",  // DataURL (branded string)
    created: 1705000000000,       // epoch ms
}

// image element (minimal skeleton for convertToExcalidrawElements)
{
    type: "image",
    x: 0, y: 0,
    fileId: "some-file-id",       // references files map
    width: 800, height: 600,      // from image natural dimensions
}
```

`convertToExcalidrawElements([skeleton])` fills in all required base properties (id, version, seed, etc.).

### Creating a new draw-view page with content

`pagesModel.addEditorPage("draw-view", "json", title, excalidrawJson)` creates a new tab with the Excalidraw editor and pre-loaded content. The JSON must be valid Excalidraw format:

```typescript
{
    type: "excalidraw",
    version: 2,
    source: "js-notepad",
    elements: [...],
    appState: { currentItemFontFamily: 2 },
    files: { "file-id": { ... } }
}
```

### SVG editor (content-view)

- **File:** [SvgView.tsx](../../../src/renderer/editors/svg/SvgView.tsx)
- Toolbar buttons via `createPortal` to `model.editorToolbarRefLast` (currently only copy button)
- SVG text available as `model.state.get().content`
- Content-view sharing TextFileModel

### Image viewer (page-editor)

- **File:** [ImageViewer.tsx](../../../src/renderer/editors/image/ImageViewer.tsx)
- Toolbar buttons in `PageToolbar` component (nav panel, save, copy)
- Image source: `filePath` (local file) or `url` (blob/external URL)
- For local files: read binary via `fs.readBinary(filePath)` → `buffer.toString('base64')`
- For URLs: `fetch(url)` → blob → base64

### Image dimensions

Need width/height for the Excalidraw image element. Use `new Image()` DOM API:
```typescript
function getImageDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
        img.onerror = reject;
        img.src = dataUrl;
    });
}
```

For SVG: can also parse `width`/`height`/`viewBox` attributes from the SVG text, but loading as image is simpler and handles all cases.

### No SVG→native conversion

Excalidraw has no built-in SVG→native-elements converter. SVG will be embedded as an image element (displayed as raster), not as editable Excalidraw shapes. This is the expected behavior — the user gets the SVG as a background and can annotate/draw on top.

## Implementation plan

### Step 1: Create shared utility for building Excalidraw JSON with an image

**File:** `/src/renderer/editors/draw/drawExport.ts` (extend existing file)

Add a function to build Excalidraw JSON containing a single embedded image:

```typescript
import { convertToExcalidrawElements } from "@excalidraw/excalidraw";

export function buildExcalidrawJsonWithImage(
    dataUrl: string,
    mimeType: string,
    width: number,
    height: number,
): string {
    const fileId = crypto.randomUUID();
    const elements = convertToExcalidrawElements([{
        type: "image",
        x: 0,
        y: 0,
        width,
        height,
        fileId: fileId as any,
        status: "saved",
    } as any]);

    return JSON.stringify({
        type: "excalidraw",
        version: 2,
        source: "js-notepad",
        elements,
        appState: { currentItemFontFamily: 2 },
        files: {
            [fileId]: {
                id: fileId,
                mimeType,
                dataURL: dataUrl,
                created: Date.now(),
            },
        },
    });
}
```

Also add an image dimensions helper:

```typescript
export function getImageDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
        img.onerror = () => reject(new Error("Failed to load image"));
        img.src = dataUrl;
    });
}
```

### Step 2: Add "Open in Drawing" button to SVG editor

**File:** `/src/renderer/editors/svg/SvgView.tsx`

Add a button next to the existing copy button in the toolbar portal:

```typescript
import { DrawIcon } from "../../theme/language-icons";
import { pagesModel } from "../../api/pages";
import { buildExcalidrawJsonWithImage, getImageDimensions } from "../draw/drawExport";

// In toolbar portal:
<Button
    type="icon"
    size="small"
    title="Open in Drawing Editor"
    onClick={async () => {
        const svgContent = model.state.get().content;
        if (!svgContent.trim()) return;
        const dataUrl = `data:image/svg+xml;base64,${btoa(svgContent)}`;
        const dims = await getImageDimensions(dataUrl);
        const json = buildExcalidrawJsonWithImage(dataUrl, "image/svg+xml", dims.width, dims.height);
        const title = model.state.get().title.replace(/\.svg$/i, "") + ".excalidraw";
        pagesModel.addEditorPage("draw-view", "json", title, json);
    }}
>
    <DrawIcon />
</Button>
```

**Note on SVG encoding:** SVGs may contain characters that `btoa()` can't handle (non-ASCII). Use a safe encoder:
```typescript
const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svgContent, 'utf-8').toString('base64')}`;
```
Node.js `Buffer` is available since we're in Electron with `nodeIntegration: true`.

### Step 3: Add "Open in Drawing" button to Image viewer

**File:** `/src/renderer/editors/image/ImageViewer.tsx`

Add a button in the `PageToolbar` (before the copy button):

```typescript
import { DrawIcon } from "../../theme/language-icons";
import { pagesModel } from "../../api/pages";
import { buildExcalidrawJsonWithImage, getImageDimensions } from "../draw/drawExport";

// Handler on ImageViewerModel or as standalone function:
const handleOpenInDrawing = async () => {
    const { filePath, url } = model.state.get();
    let dataUrl: string;
    let mimeType: string;

    if (filePath) {
        const buffer = await fs.readBinary(filePath);
        const ext = fpExtname(filePath).toLowerCase();
        mimeType = extToMime(ext);
        dataUrl = `data:${mimeType};base64,${buffer.toString('base64')}`;
    } else if (url) {
        // url could be blob:, data:, or https:
        const response = await fetch(url);
        const blob = await response.blob();
        mimeType = blob.type || "image/png";
        const buffer = Buffer.from(await blob.arrayBuffer());
        dataUrl = `data:${mimeType};base64,${buffer.toString('base64')}`;
    } else {
        return;
    }

    const dims = await getImageDimensions(dataUrl);
    const json = buildExcalidrawJsonWithImage(dataUrl, mimeType, dims.width, dims.height);
    const baseName = filePath ? fpBasename(filePath).replace(/\.\w+$/, "") : "image";
    pagesModel.addEditorPage("draw-view", "json", baseName + ".excalidraw", json);
};

// In PageToolbar, before copy button:
<Button
    type="icon"
    size="small"
    title="Open in Drawing Editor"
    onClick={handleOpenInDrawing}
>
    <DrawIcon />
</Button>
```

### Step 4: Add mime type helper

**File:** `/src/renderer/editors/draw/drawExport.ts`

```typescript
const MIME_MAP: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".ico": "image/x-icon",
    ".svg": "image/svg+xml",
};

export function extToMime(ext: string): string {
    return MIME_MAP[ext.toLowerCase()] || "image/png";
}
```

## Concerns / Open questions

### 1. Large images → large JSON

Embedding a large PNG as base64 in the Excalidraw JSON could produce very large page content (e.g., a 5MB image → ~7MB JSON). This will:
- Slow down content-change detection (fingerprinting in DrawViewModel)
- Increase memory usage for the page's TextFileModel
- Make saving slower

**Mitigation:** Not a blocker — this is the same pattern Excalidraw uses natively for embedded images. Users who add images via the Excalidraw toolbar face the same issue. We could add a file-size warning for very large images (>5MB) in a future task.

### 2. SVG encoding edge cases

SVGs may contain non-ASCII characters (unicode text, emoji). `btoa()` only handles Latin-1. Using Node.js `Buffer.from(svgContent, 'utf-8').toString('base64')` handles all unicode correctly since we're in Electron.

### 3. Image element sizing in Excalidraw

The image element's `width`/`height` determine how large it appears on the canvas. Using `naturalWidth`/`naturalHeight` (actual pixel dimensions) may produce very large or very small canvas elements depending on the image resolution. Options:
- Use natural dimensions as-is (what user expects)
- Cap to a max size (e.g., 1200px wide) while preserving aspect ratio
- Let user resize in Excalidraw after opening

**Recommendation:** Cap to max 1200px on the longer side, preserving aspect ratio. This ensures the image is visible and manageable. The user can resize in Excalidraw.

### 4. Icon for "Open in Drawing"

Use the existing `DrawIcon` from `language-icons.tsx` — same pencil+sketch icon used in the quick-add menu and file explorer. This provides visual consistency.

## Files changed summary

| File | Change |
|------|--------|
| `src/renderer/editors/draw/drawExport.ts` | Add `buildExcalidrawJsonWithImage`, `getImageDimensions`, `extToMime` |
| `src/renderer/editors/svg/SvgView.tsx` | Add "Open in Drawing" toolbar button |
| `src/renderer/editors/image/ImageViewer.tsx` | Add "Open in Drawing" toolbar button |

## Acceptance criteria

- [ ] SVG editor has "Open in Drawing" button in toolbar
- [ ] Clicking it opens a new tab with draw-view containing the SVG as an embedded image
- [ ] Image viewer has "Open in Drawing" button in toolbar
- [ ] Clicking it opens a new tab with draw-view containing the image as an embedded image
- [ ] Works for local files (filePath) and URL-based images (blob/external)
- [ ] SVG unicode content encodes correctly (no btoa errors)
- [ ] Image appears at reasonable size on canvas (max 1200px on longer side)
- [ ] User can draw/annotate on top of the embedded image
- [ ] Default title derived from source file name + `.excalidraw`
