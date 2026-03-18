# US-203: Drawing editor — export (SVG/PNG)

**Epic:** [EPIC-007](../../epics/EPIC-007.md)
**Status:** Planned

## Goal

Add export functionality to the drawing editor: toolbar theme toggle (dark/light for export), "Save as file" (SVG/PNG), and "Open in new tab" (SVG preview / Image view). Ensure blob URLs are properly cleaned up when image tabs are closed.

## Background

### Excalidraw export APIs

Exported from `@excalidraw/excalidraw`:

- **`exportToSvg(opts)`** → `Promise<SVGSVGElement>` — returns SVG DOM element. Call `.outerHTML` for text.
- **`exportToBlob(opts)`** → `Promise<Blob>` — returns PNG/JPG/WEBP blob.

Both accept:
```typescript
{
    elements: readonly ExcalidrawElement[];
    appState?: Partial<AppState>;
    files: BinaryFiles | null;
    maxWidthOrHeight?: number;
    exportPadding?: number;
}
```

`exportToBlob` also accepts `mimeType` (default `"image/png"`) and `quality` (0-1).

### Getting current scene data

`ExcalidrawImperativeAPI` (via `excalidrawAPI` prop callback):
- `getSceneElements()` — current non-deleted elements
- `getAppState()` — current appState (theme, background, export settings)
- `getFiles()` — current binary files (embedded images)

### Mermaid editor theme toggle pattern

The mermaid editor has a dark/light toggle in its toolbar — same pattern needed here:
- **File:** [MermaidView.tsx:70-92](../../../src/renderer/editors/mermaid/MermaidView.tsx) — `createPortal` to `model.editorToolbarRefLast`
- **Icons:** `SunIcon` (when light) / `MoonIcon` (when dark)
- **State:** `lightMode: boolean` in ViewModel state, toggled via action
- For the draw editor, this toggle controls Excalidraw's `theme` prop independently of app theme, so user can preview export appearance before exporting

### Toolbar integration for content-views

Content-view editors inject buttons via `createPortal` into `model.editorToolbarRefFirst` (left) and `model.editorToolbarRefLast` (right). Pattern from grid editor ([GridEditor.tsx:77-135](../../../src/renderer/editors/grid/GridEditor.tsx)).

### Opening content in new tabs

- **SVG preview:** `pagesModel.addEditorPage("svg-view", "xml", "Drawing.svg", svgText)`
- **Image view:** `pagesModel.openImageInNewTab(imageUrl)` ([PagesLifecycleModel.ts:574-589](../../../src/renderer/api/pages/PagesLifecycleModel.ts))

### Image viewer URL and disposal

**Current state:** `ImageViewerModel` accepts a `url` field in state for external URLs. It does NOT override `dispose()`. The base `PageModel.dispose()` ([PageModel.ts:61-64](../../../src/renderer/editors/base/PageModel.ts)) handles nav panel and cache cleanup but has no URL revocation.

**Problem:** `URL.createObjectURL(blob)` creates a blob URL that leaks memory until `revokeObjectURL()` is called. Since js-notepad runs for days/weeks via tray icon (window hides, doesn't close), blob URLs must be explicitly revoked when the image tab is closed.

### Available icons

- `DownloadIcon` — for "Save as file" button
- `NewWindowIcon` — for "Open in new tab" button
- `SunIcon` / `MoonIcon` — for theme toggle

### Save file dialog

`fs.showSaveDialog({ title, defaultPath, filters })` → path or null.
`fs.saveBinaryFile(path, buffer)` for binary data.
For SVG (text): `fs.write(path, svgText)`.

## Implementation plan

### Step 1: Add blob URL cleanup to ImageViewerModel

**File:** `/src/renderer/editors/image/ImageViewer.tsx`

Override `dispose()` in `ImageViewerModel` to revoke blob URLs:

```typescript
async dispose(): Promise<void> {
    const url = this.state.get().url;
    if (url && url.startsWith("blob:")) {
        URL.revokeObjectURL(url);
    }
    await super.dispose();
}
```

This ensures any blob URL passed via `openImageInNewTab()` is freed when the tab closes.

No changes needed to the `openImageInNewTab` API — it already accepts a URL string. The image viewer now just cleans up blob URLs on disposal.

### Step 2: Move theme control from app-level to editor-level

**File:** `/src/renderer/editors/draw/DrawViewModel.ts`

Currently `DrawView.tsx` reads the app theme via `settings.use("theme")` + `isCurrentThemeDark()`. We need to decouple this so the editor has its own toggle:

Add to `DrawViewState`:
```typescript
export interface DrawViewState {
    loading: boolean;
    error: string | null;
    /** Editor-local dark/light mode, initially synced with app theme. */
    darkMode: boolean;
}
```

Initialize from app theme in `onInit()`:
```typescript
protected onInit(): void {
    this.state.update((s) => { s.darkMode = isCurrentThemeDark(); });
    this.parseContent(this.host.state.get().content);
}
```

Add toggle action:
```typescript
toggleDarkMode = () => {
    this.state.update((s) => { s.darkMode = !s.darkMode; });
};
```

Keep `settings.use("theme")` in `DrawView.tsx` — when the app theme changes, sync the editor's `darkMode` to match:
```typescript
// In DrawView component:
useEffect(() => {
    if (vm) vm.state.update((s) => { s.darkMode = isCurrentThemeDark(); });
}, [themeId, vm]);
```

This way:
- App theme change → editor syncs automatically
- Editor toggle → overrides locally until next app theme change
- Export uses the editor's current `darkMode` state (user previews before exporting)

### Step 3: Store Excalidraw imperative API ref

**File:** `/src/renderer/editors/draw/DrawView.tsx`

```typescript
const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);

<Excalidraw
    excalidrawAPI={(api) => { apiRef.current = api; }}
    ...
/>
```

### Step 4: Create export helper functions

**File:** `/src/renderer/editors/draw/drawExport.ts` (new file — keeps DrawView clean)

```typescript
import { exportToSvg, exportToBlob } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/dist/types/excalidraw/types";

function getSceneData(api: ExcalidrawImperativeAPI) {
    return {
        elements: api.getSceneElements(),
        appState: api.getAppState(),
        files: api.getFiles(),
    };
}

export async function exportAsSvgText(api: ExcalidrawImperativeAPI): Promise<string> {
    const scene = getSceneData(api);
    const svg = await exportToSvg({
        elements: scene.elements,
        appState: { ...scene.appState, exportBackground: true },
        files: scene.files,
    });
    return svg.outerHTML;
}

export async function exportAsPngBlob(api: ExcalidrawImperativeAPI, scale = 2): Promise<Blob> {
    const scene = getSceneData(api);
    return exportToBlob({
        elements: scene.elements,
        appState: { ...scene.appState, exportBackground: true, exportScale: scale },
        files: scene.files,
        mimeType: "image/png",
    });
}
```

**Key details:**
- `exportBackground: true` — always include current Excalidraw background in export
- `exportScale: 2` — 2x resolution for crisp PNG output
- Export captures the current editor theme (dark or light) via appState

### Step 5: Add toolbar buttons via portal

**File:** `/src/renderer/editors/draw/DrawView.tsx`

Inject into `model.editorToolbarRefLast` using `createPortal`:

**Four buttons (left to right):**

1. **Theme toggle** — `SunIcon`/`MoonIcon`, calls `vm.toggleDarkMode()`
2. **"Copy to clipboard"** — `CopyIcon`, copies PNG image to clipboard (2x scale)
3. **"Save as file"** — `DownloadIcon`, popup menu: "Save as SVG" / "Save as PNG"
4. **"Open in new tab"** — `NewWindowIcon`, popup menu: "Open as SVG" / "Open as Image"

```typescript
{Boolean(model.editorToolbarRefLast) &&
    createPortal(
        <>
            <Button type="icon" size="small"
                title={darkMode ? "Switch to Light Theme" : "Switch to Dark Theme"}
                onClick={vm.toggleDarkMode}
            >
                {darkMode ? <SunIcon /> : <MoonIcon />}
            </Button>
            <WithPopupMenu items={saveMenuItems}>
                {(setOpen) => (
                    <Button type="icon" size="small" title="Save as file"
                        onClick={(e) => setOpen(e.currentTarget)}>
                        <DownloadIcon />
                    </Button>
                )}
            </WithPopupMenu>
            <WithPopupMenu items={openMenuItems}>
                {(setOpen) => (
                    <Button type="icon" size="small" title="Open in new tab"
                        onClick={(e) => setOpen(e.currentTarget)}>
                        <NewWindowIcon />
                    </Button>
                )}
            </WithPopupMenu>
        </>,
        model.editorToolbarRefLast!
    )}
```

### Step 6: Implement action handlers

**Copy to clipboard (PNG):**
```typescript
const blob = await exportAsPngBlob(apiRef.current);
await navigator.clipboard.write([
    new ClipboardItem({ "image/png": blob }),
]);
ui.notify("Copied to clipboard", "success");
```

Uses same pattern as `BaseImageView.copyToClipboard()` — writes PNG blob via `ClipboardItem`. Uses 2x scale for crisp output. Shows success notification.

**Save as SVG:**
```typescript
const svgText = await exportAsSvgText(apiRef.current);
const savePath = await fs.showSaveDialog({
    title: "Save as SVG",
    defaultPath: getDefaultName("svg"),
    filters: [{ name: "SVG", extensions: ["svg"] }],
});
if (savePath) await fs.write(savePath, svgText);
```

**Save as PNG:**
```typescript
const blob = await exportAsPngBlob(apiRef.current);
const buffer = Buffer.from(await blob.arrayBuffer());
const savePath = await fs.showSaveDialog({
    title: "Save as PNG",
    defaultPath: getDefaultName("png"),
    filters: [{ name: "PNG", extensions: ["png"] }],
});
if (savePath) await fs.saveBinaryFile(savePath, buffer);
```

**Open as SVG:**
```typescript
const svgText = await exportAsSvgText(apiRef.current);
pagesModel.addEditorPage("svg-view", "xml", getDefaultName("svg"), svgText);
```

**Open as Image:**
```typescript
const blob = await exportAsPngBlob(apiRef.current);
const blobUrl = URL.createObjectURL(blob);
pagesModel.openImageInNewTab(blobUrl);
```

### Step 7: Default file names helper

```typescript
function getDefaultName(ext: string): string {
    const filePath = model.state.get().filePath;
    if (filePath) {
        const base = fpBasename(filePath).replace(/\.excalidraw$/i, "");
        return `${base}.${ext}`;
    }
    return `drawing.${ext}`;
}
```

### Step 8: Handle empty drawings

Before each export action, check if there are elements:
```typescript
if (apiRef.current.getSceneElements().length === 0) {
    ui.notify("Nothing to export — the drawing is empty", "warning");
    return;
}
```

## Resolved concerns

### 1. Export background — RESOLVED: always include with editor theme

Export always includes background (`exportBackground: true`). The user controls appearance via the editor's dark/light toggle before exporting. This matches the mermaid editor pattern.

### 2. Blob URL cleanup — RESOLVED: revoke in ImageViewerModel.dispose()

Override `dispose()` in `ImageViewerModel` to call `URL.revokeObjectURL()` for blob URLs. This ensures cleanup when the image tab is closed, even after days of running. No API changes needed — `openImageInNewTab` already accepts URL strings.

### 3. PNG export scale — RESOLVED: 2x

Use `exportScale: 2` in appState for PNG export. Produces crisp 2x resolution images suitable for retina displays and zooming.

## Files changed summary

| File | Change |
|------|--------|
| `src/renderer/editors/draw/DrawView.tsx` | Add `apiRef`, theme toggle, toolbar buttons with popup menus |
| `src/renderer/editors/draw/DrawViewModel.ts` | Add `darkMode` state, `toggleDarkMode` action |
| `src/renderer/editors/draw/drawExport.ts` | **NEW** — export helper functions (SVG text, PNG blob) |
| `src/renderer/editors/image/ImageViewer.tsx` | Override `dispose()` to revoke blob URLs |

## Acceptance criteria

- [ ] Theme toggle button in toolbar switches Excalidraw between dark/light
- [ ] App theme change syncs editor theme; editor toggle overrides locally
- [ ] "Copy to clipboard" copies PNG image at 2x scale, shows success notification
- [ ] "Save as SVG" opens native save dialog, writes SVG file
- [ ] "Save as PNG" opens native save dialog, writes PNG file at 2x scale
- [ ] "Open as SVG" opens SVG text in new tab with svg-view editor
- [ ] "Open as Image" opens PNG in new tab with image-view editor
- [ ] Export includes current Excalidraw background color
- [ ] Blob URLs are revoked when image tabs are closed (verify in DevTools → Memory)
- [ ] Default filename derived from page title
- [ ] Empty drawings show warning notification instead of exporting
- [ ] Toolbar buttons appear in the editor toolbar area (right side)
