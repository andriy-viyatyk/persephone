# US-204: Drawing editor — MCP & scripting API

**Epic:** [EPIC-007](../../epics/EPIC-007.md)
**Status:** Done

## Goal

Expose a `page.asDraw()` scripting facade for the Excalidraw drawing editor with two capabilities: inserting images into a live canvas and exporting drawings as SVG/PNG. Additionally, expose `app.pages.addDrawPage(dataUrl)` to create a new drawing page with an initial image.

## Background

### Scope decision

The Excalidraw editor has rich interactive functionality (shapes, arrows, freehand drawing, etc.) that is impractical to expose through a scripting API. After discussion, the API is intentionally minimal:

- **`page.asDraw().addImage(dataUrl)`** — Insert an image into the live canvas (editor must be mounted)
- **`page.asDraw().exportAsSvg()` / `exportAsPng()`** — Get the drawing as SVG text or PNG data URL
- **`app.pages.addDrawPage(dataUrl)`** — Create a new drawing page with an initial image

No element manipulation, no shape creation, no detailed scene control. Scripts/agents that need complex drawings should generate Excalidraw JSON directly and set it via `page.content`.

### Why two APIs for images

Excalidraw is an **uncontrolled** React component — it reads `initialData` only on mount. Changing the underlying JSON content while the editor is mounted has no visible effect until the component remounts (user must switch tabs and back).

This creates two distinct use cases:

1. **Add image to open drawing** — requires `ExcalidrawImperativeAPI` ref (`api.addFiles()` + `api.updateScene()`). This is `page.asDraw().addImage()`, which throws if the editor isn't mounted.

2. **Create new drawing with image** — creates a new page with Excalidraw JSON containing the image. This is `app.pages.addDrawPage()`, reusing the existing `buildExcalidrawJsonWithImage()` pattern (same as SVG/Image/Mermaid viewer "Open in Drawing Editor" buttons).

### Existing facade pattern

All editor facades follow the same 4-file pattern:

| File | Purpose |
|------|---------|
| `src/renderer/api/types/draw-editor.d.ts` | `IDrawEditor` interface (visible in Monaco IntelliSense) |
| `src/renderer/scripting/api-wrapper/DrawEditorFacade.ts` | Facade class wrapping `DrawViewModel` |
| `src/renderer/scripting/api-wrapper/PageWrapper.ts` | `asDraw()` method (acquires VM, registers cleanup) |
| `src/renderer/api/types/page.d.ts` | `asDraw(): Promise<IDrawEditor>` in `IPage` interface |

Reference implementations: `GraphEditorFacade.ts` (read-heavy), `SvgEditorFacade.ts` (simple).

### Exports don't need ExcalidrawImperativeAPI

The export functions (`exportToSvg`, `exportToBlob`) from `@excalidraw/excalidraw` accept scene data (elements, appState, files) — they don't need the live React component ref. `DrawViewModel` already exposes `elements`, `appState`, `files` properties.

### Existing `buildExcalidrawJsonWithImage` in drawExport.ts

`buildExcalidrawJsonWithImage(dataUrl, mimeType, naturalWidth, naturalHeight)` already creates complete Excalidraw JSON with an embedded image element. Used by SVG/Image/Mermaid viewers' "Open in Drawing Editor" buttons. `app.pages.addDrawPage()` will reuse this.

### MCP considerations

MCP agents already use `execute_script` to run scripts with `page.asDraw()`. The `create_page` MCP tool already supports creating draw pages (`editor: "draw-view"`, `language: "json"`). The MCP pages resource guide (`assets/mcp-res-pages.md`) needs an entry for the `.excalidraw` content format.

## Implementation plan

### Step 1: Store ExcalidrawImperativeAPI ref on ViewModel

**File:** `src/renderer/editors/draw/DrawViewModel.ts`

Add:
```typescript
private _excalidrawApi: ExcalidrawImperativeAPI | null = null;

setExcalidrawApi(api: ExcalidrawImperativeAPI): void {
    this._excalidrawApi = api;
}

clearExcalidrawApi(): void {
    this._excalidrawApi = null;
}

get excalidrawApi() { return this._excalidrawApi; }
```

**File:** `src/renderer/editors/draw/DrawView.tsx`

In the `excalidrawAPI` callback, also set the ref on the ViewModel:
```typescript
excalidrawAPI={(excApi) => {
    apiRef.current = excApi;
    vm?.setExcalidrawApi(excApi);
}}
```

Add cleanup on unmount:
```typescript
useEffect(() => {
    return () => { vm?.clearExcalidrawApi(); };
}, [vm]);
```

### Step 2: Create type definition

**File:** `src/renderer/api/types/draw-editor.d.ts` (new)

```typescript
export interface IDrawEditor {
    /**
     * Insert an image onto the live canvas.
     * Throws if the editor is not currently mounted — use `editorIsMounted` to check,
     * or use `app.pages.addDrawPage(dataUrl)` to create a new page with an image.
     * @param dataUrl - Image as data URL (e.g., "data:image/png;base64,...")
     * @param options - Optional placement/sizing
     */
    addImage(dataUrl: string, options?: {
        /** X position on canvas (default: 0) */
        x?: number;
        /** Y position on canvas (default: 0) */
        y?: number;
        /** Max dimension in pixels — longer side capped to this (default: 1200) */
        maxDimension?: number;
    }): Promise<void>;

    /** Export the drawing as SVG markup string. */
    exportAsSvg(): Promise<string>;

    /** Export the drawing as PNG data URL. */
    exportAsPng(options?: {
        /** Scale factor (default: 2 for retina) */
        scale?: number;
    }): Promise<string>;

    /** Number of elements on the canvas. */
    readonly elementCount: number;

    /** Whether the Excalidraw editor is currently mounted and visible.
     * When true, addImage() works. When false, addImage() throws.
     * Use app.pages.addDrawPage() to create a new page with an image instead. */
    readonly editorIsMounted: boolean;
}
```

### Step 3: Create facade class

**File:** `src/renderer/scripting/api-wrapper/DrawEditorFacade.ts` (new)

The facade wraps `DrawViewModel` and implements `IDrawEditor`.

**`addImage` implementation:**
1. Check `vm.excalidrawApi` — if null, throw `"addImage() requires the editor to be visible. Use app.pages.addDrawPage() instead."`
2. Call `getImageDimensions(dataUrl)` to get natural width/height
3. Generate `fileId` via `crypto.randomUUID()`
4. Cap dimensions (same logic as `drawExport.ts` — max 1200px on longer side, or custom `options.maxDimension`)
5. Call `api.addFiles([{ id, dataURL, mimeType, created }])`
6. Create element via `convertToExcalidrawElements([{ type: "image", x, y, width, height, fileId, status: "saved" }])`
7. Call `api.updateScene({ elements: [...existing, ...newElements] })`

**`exportAsSvg` / `exportAsPng` implementation:**
1. Read `elements`, `appState`, `files` from the ViewModel
2. Call `exportToSvg()` / `exportToBlob()` from `@excalidraw/excalidraw` with scene data
3. For PNG, convert blob to data URL via `URL.createObjectURL` or `FileReader`

### Step 4: Register in PageWrapper

**File:** `src/renderer/scripting/api-wrapper/PageWrapper.ts`

Add `asDraw()` method following the standard pattern:
```typescript
async asDraw(): Promise<DrawEditorFacade> {
    const model = this.model;
    if (!isTextFileModel(model)) {
        throw new Error("asDraw() is only available for text pages");
    }
    const vm = await model.acquireViewModel("draw-view") as DrawViewModel;
    this.releaseList.push(() => model.releaseViewModel("draw-view"));
    return new DrawEditorFacade(vm);
}
```

### Step 5: Update page.d.ts

**File:** `src/renderer/api/types/page.d.ts`

Add to `IPage` interface:
```typescript
asDraw(): Promise<IDrawEditor>;
```

### Step 6: Add `addDrawPage` to PagesModel

**File:** `src/renderer/api/pages/PagesLifecycleModel.ts` (or wherever `addEditorPage` lives)

Add method:
```typescript
addDrawPage(dataUrl: string, title?: string): void {
    const dims = /* sync dimension extraction or use defaults */;
    const json = buildExcalidrawJsonWithImage(dataUrl, "image/png", dims.width, dims.height);
    this.addEditorPage("draw-view", "json", title ?? "untitled.excalidraw", json);
}
```

**Concern:** `getImageDimensions` is async (uses `Image` element). But `addEditorPage` is sync. Options:
- Make `addDrawPage` async
- Use default dimensions (e.g., 800x600) and let Excalidraw handle the aspect ratio
- Extract dimensions from the data URL header synchronously (PNG/JPEG headers contain dimensions)

**Recommendation:** Make `addDrawPage` async. The script API already supports async calls.

### Step 7: Expose `addDrawPage` in pages.d.ts

**File:** `src/renderer/api/types/pages.d.ts`

Add to `IPageCollection`:
```typescript
/** Create a new drawing page with an embedded image. */
addDrawPage(dataUrl: string, title?: string): Promise<void>;
```

### Step 8: Wire `addDrawPage` in PagesWrapper

**File:** `src/renderer/scripting/api-wrapper/PagesWrapper.ts`

Add method delegating to `pagesModel.addDrawPage()`.

### Step 9: Refactor drawExport.ts

**File:** `src/renderer/editors/draw/drawExport.ts`

Add scene-data overloads so the facade can call export without `ExcalidrawImperativeAPI`:

```typescript
interface SceneData {
    elements: readonly any[];
    appState: Record<string, any>;
    files: any;
}

export async function exportSceneAsSvgText(scene: SceneData): Promise<string> { ... }
export async function exportSceneAsPngBlob(scene: SceneData, scale?: number): Promise<Blob> { ... }
```

Existing API-based functions remain for DrawView.tsx toolbar buttons.

### Step 10: Register type file and update MCP guide

**File:** `assets/editor-types/_imports.txt` — Add `draw-editor.d.ts` (alphabetical order).

**File:** `assets/mcp-res-pages.md` — Add `.excalidraw` content format documentation and `page.asDraw()` / `app.pages.addDrawPage()` availability note.

## Concerns

### 1. `addDrawPage` image dimensions — async vs sync

`getImageDimensions` is async (creates `Image` element). Making `addDrawPage` async is fine for the scripting API. The `PagesWrapper` and `pages.d.ts` need to declare it as `Promise<void>`.

## Acceptance criteria

- [ ] `page.asDraw()` returns `IDrawEditor` facade
- [ ] `addImage(dataUrl)` inserts an image into the live Excalidraw canvas
- [ ] `addImage()` throws clear error when editor is not mounted
- [ ] `editorIsMounted` returns true when editor is visible, false otherwise
- [ ] `exportAsSvg()` returns SVG markup string
- [ ] `exportAsPng()` returns PNG data URL
- [ ] `elementCount` returns number of elements
- [ ] `app.pages.addDrawPage(dataUrl)` creates a new drawing page with embedded image
- [ ] Type definitions in `draw-editor.d.ts` and `pages.d.ts` with IntelliSense support
- [ ] Works from MCP `execute_script` tool
- [ ] MCP resource guide updated
- [ ] Auto-release cleanup via `releaseList`

## Files changed summary

| File | Change |
|------|--------|
| `src/renderer/api/types/draw-editor.d.ts` | **NEW** — `IDrawEditor` interface |
| `src/renderer/api/types/page.d.ts` | Add `asDraw(): Promise<IDrawEditor>` |
| `src/renderer/api/types/pages.d.ts` | Add `addDrawPage(dataUrl, title?): Promise<void>` |
| `src/renderer/scripting/api-wrapper/DrawEditorFacade.ts` | **NEW** — Facade class |
| `src/renderer/scripting/api-wrapper/PageWrapper.ts` | Add `asDraw()` method |
| `src/renderer/scripting/api-wrapper/PagesWrapper.ts` | Add `addDrawPage()` method |
| `src/renderer/api/pages/PagesLifecycleModel.ts` | Add `addDrawPage()` method |
| `src/renderer/editors/draw/drawExport.ts` | Add scene-data overloads for export |
| `src/renderer/editors/draw/DrawViewModel.ts` | Store `ExcalidrawImperativeAPI` ref |
| `src/renderer/editors/draw/DrawView.tsx` | Set/clear API ref on ViewModel |
| `assets/editor-types/_imports.txt` | Add `draw-editor.d.ts` |
| `assets/mcp-res-pages.md` | Add `.excalidraw` editor pairing and API notes |
