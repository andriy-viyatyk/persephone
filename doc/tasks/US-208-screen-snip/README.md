# US-208: Drawing editor — screen snip tool

**Epic:** [EPIC-007](../../epics/EPIC-007.md)
**Status:** Planned

## Goal

Add a "Screen Snip" toolbar button to the drawing editor that hides js-notepad, lets the user select a region on any monitor, and inserts the captured screenshot as an image into the Excalidraw canvas.

## Background

### Architecture overview

The snip flow spans three layers:

```
Renderer (DrawView)                Main Process                    Overlay Window
─────────────────                  ────────────                    ──────────────
Click "Snip" button
  → IPC: startSnip ─────────────→ Hide all windows
                                   Wait ~300ms
                                   desktopCapturer.getSources()
                                   Create overlay BrowserWindow
                                     per monitor ──────────────→ Show screenshot
                                                                  with dim overlay
                                                                  User drags selection
                                                                  ← IPC: snipComplete
                                   NativeImage.crop()
                                   Close overlays
                                   Show all windows
  ← IPC: snipResult (dataURL) ←──
Insert into Excalidraw
  via addFiles() + updateScene()
```

### Electron APIs used

- **`desktopCapturer.getSources({ types: ['screen'], thumbnailSize })`** — captures each monitor as a `NativeImage`. Returns one source per display with `display_id` matching `screen.getAllDisplays()`.
- **`screen.getAllDisplays()`** — returns array of `Display` objects with `bounds` (x, y, width, height in DIP), `scaleFactor`, `id`.
- **`NativeImage.crop({ x, y, width, height })`** — crops in physical pixels. Coordinates must be multiplied by `scaleFactor`.
- **`NativeImage.toDataURL()`** — returns `data:image/png;base64,...` string.
- **`openWindows.hideWindows()` / `openWindows.showWindows()`** — already exist in [open-windows.ts:244-254](../../../src/main/open-windows.ts).

### IPC pattern in js-notepad

- Endpoints defined in `/src/ipc/api-types.ts` (enum + type signature)
- Handlers in `/src/ipc/main/controller.ts` (class methods + `bindEndpoint`)
- Renderer calls via `executeOnce<T>(Endpoint.xxx, ...args)` in `/src/ipc/renderer/api.ts`

### Overlay window

A **separate BrowserWindow** per monitor — cannot be part of the main React app because:
- Main window is hidden during capture
- Overlay must be transparent, frameless, always-on-top
- Each monitor may have different DPI scaling

The overlay is a **plain HTML + JS file** (`assets/snip-overlay.html`) — no React needed. Fast load, simple canvas-based selection UI.

### Inserting into Excalidraw

Already have `apiRef` to `ExcalidrawImperativeAPI` in `DrawView.tsx`. Use:
- `api.addFiles([{ id, dataURL, mimeType, created }])` — add the screenshot as a file
- `api.updateScene({ elements: [...existing, ...newImageElement] })` — add image element to canvas

Reuse `convertToExcalidrawElements` from `@excalidraw/excalidraw` (already imported in `drawExport.ts`).

## Implementation plan

### Step 1: Add IPC endpoint

**File:** `/src/ipc/api-types.ts`

Add to `Endpoint` enum:
```typescript
startScreenSnip = "startScreenSnip",
```

Add to `Api` type:
```typescript
[Endpoint.startScreenSnip]: () => Promise<string | null>;
// Returns PNG data URL or null if cancelled
```

### Step 2: Create snip service in main process

**File:** `/src/main/snip-service.ts` (new)

This is the orchestrator that runs in the main process:

```typescript
import { BrowserWindow, desktopCapturer, screen, NativeImage } from "electron";
import { openWindows } from "./open-windows";
import { getAssetPath } from "./utils";
import path from "path";

export async function startScreenSnip(): Promise<string | null> {
    // 1. Get all displays info
    const displays = screen.getAllDisplays();

    // 2. Hide all js-notepad windows
    openWindows.hideWindows();

    // 3. Wait for OS to repaint desktop
    await new Promise((r) => setTimeout(r, 300));

    // 4. Capture all screens
    //    Use the largest display's physical size for thumbnailSize
    //    (desktopCapturer uses the same size for all sources)
    const maxPhysicalWidth = Math.max(...displays.map((d) => d.size.width * d.scaleFactor));
    const maxPhysicalHeight = Math.max(...displays.map((d) => d.size.height * d.scaleFactor));
    const sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: { width: maxPhysicalWidth, height: maxPhysicalHeight },
    });

    // 5. Match sources to displays
    const displaySources = displays.map((display) => {
        const source = sources.find((s) => s.display_id === String(display.id));
        return { display, screenshot: source?.thumbnail ?? null };
    }).filter((ds) => ds.screenshot !== null);

    if (displaySources.length === 0) {
        openWindows.showWindows();
        return null;
    }

    // 6. Create overlay windows and wait for selection
    try {
        return await showOverlaysAndWaitForSelection(displaySources);
    } finally {
        openWindows.showWindows();
    }
}
```

**Overlay creation and selection waiting:**

```typescript
function showOverlaysAndWaitForSelection(
    displaySources: Array<{ display: Electron.Display; screenshot: NativeImage }>
): Promise<string | null> {
    return new Promise((resolve) => {
        const overlays: BrowserWindow[] = [];

        for (const { display, screenshot } of displaySources) {
            const overlay = new BrowserWindow({
                x: display.bounds.x,
                y: display.bounds.y,
                width: display.bounds.width,
                height: display.bounds.height,
                frame: false,
                transparent: true,
                alwaysOnTop: true,
                skipTaskbar: true,
                resizable: false,
                movable: false,
                focusable: true,
                hasShadow: false,
                webPreferences: {
                    nodeIntegration: true,
                    contextIsolation: false,
                },
            });
            overlay.setAlwaysOnTop(true, "screen-saver");
            overlay.loadFile(getAssetPath("snip-overlay.html"));

            overlay.webContents.on("did-finish-load", () => {
                // Send screenshot as data URL + display info
                overlay.webContents.send("snip-init", {
                    screenshotDataUrl: screenshot.toDataURL(),
                    scaleFactor: display.scaleFactor,
                    bounds: display.bounds,
                });
            });

            overlays.push(overlay);
        }

        // Listen for selection result from any overlay
        const { ipcMain } = require("electron");

        const handleComplete = (_event: any, rect: { x: number; y: number; w: number; h: number }, displayId: number) => {
            cleanup();
            // Find the source for this display
            const ds = displaySources.find((d) => d.display.id === displayId);
            if (!ds || !ds.screenshot) { resolve(null); return; }

            // Crop in physical pixels
            const sf = ds.display.scaleFactor;
            const cropped = ds.screenshot.crop({
                x: Math.round(rect.x * sf),
                y: Math.round(rect.y * sf),
                width: Math.round(rect.w * sf),
                height: Math.round(rect.h * sf),
            });
            resolve(cropped.toDataURL());
        };

        const handleCancel = () => {
            cleanup();
            resolve(null);
        };

        const cleanup = () => {
            ipcMain.removeListener("snip-complete", handleComplete);
            ipcMain.removeListener("snip-cancel", handleCancel);
            overlays.forEach((o) => {
                if (!o.isDestroyed()) o.close();
            });
        };

        ipcMain.once("snip-complete", handleComplete);
        ipcMain.once("snip-cancel", handleCancel);
    });
}
```

### Step 3: Wire IPC handler

**File:** `/src/ipc/main/controller.ts`

Add handler:
```typescript
startScreenSnip = async (): Promise<string | null> => {
    const { startScreenSnip } = await import("../../main/snip-service");
    return startScreenSnip();
};
```

Bind in `init()`:
```typescript
bindEndpoint(Endpoint.startScreenSnip, controllerInstance.startScreenSnip);
```

### Step 4: Add renderer API method

**File:** `/src/ipc/renderer/api.ts`

```typescript
startScreenSnip = async (): Promise<string | null> => {
    return executeOnce<string | null>(Endpoint.startScreenSnip);
};
```

### Step 5: Create overlay HTML

**File:** `/assets/snip-overlay.html` (new, plain HTML + JS)

```html
<!DOCTYPE html>
<html>
<head>
<style>
  * { margin: 0; padding: 0; }
  body { overflow: hidden; cursor: crosshair; background: transparent; }
  canvas { position: absolute; top: 0; left: 0; }
</style>
</head>
<body>
<canvas id="canvas"></canvas>
<script>
const { ipcRenderer } = require("electron");

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
let img = null;
let displayId = 0;
let startX = 0, startY = 0;
let isDragging = false;

ipcRenderer.on("snip-init", (_event, data) => {
    displayId = data.bounds.x * 10000 + data.bounds.y; // approximate display ID
    // Actually, we receive displayId from the main process...
    // (need to pass display.id in snip-init data)

    canvas.width = data.bounds.width;
    canvas.height = data.bounds.height;

    img = new Image();
    img.onload = () => drawOverlay(null);
    img.src = data.screenshotDataUrl;
});

function drawOverlay(rect) {
    if (!img) return;
    // Draw screenshot
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    // Dim everything
    ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // Clear selection to show original brightness
    if (rect && rect.w > 2 && rect.h > 2) {
        ctx.drawImage(img,
            rect.x, rect.y, rect.w, rect.h,
            rect.x, rect.y, rect.w, rect.h);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
        ctx.lineWidth = 1;
        ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
    }
}

canvas.addEventListener("mousedown", (e) => {
    startX = e.clientX;
    startY = e.clientY;
    isDragging = true;
});

canvas.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    drawOverlay({
        x: Math.min(startX, e.clientX),
        y: Math.min(startY, e.clientY),
        w: Math.abs(e.clientX - startX),
        h: Math.abs(e.clientY - startY),
    });
});

canvas.addEventListener("mouseup", (e) => {
    if (!isDragging) return;
    isDragging = false;
    const rect = {
        x: Math.min(startX, e.clientX),
        y: Math.min(startY, e.clientY),
        w: Math.abs(e.clientX - startX),
        h: Math.abs(e.clientY - startY),
    };
    if (rect.w > 5 && rect.h > 5) {
        ipcRenderer.send("snip-complete", rect, displayId);
    } else {
        ipcRenderer.send("snip-cancel");
    }
});

document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
        ipcRenderer.send("snip-cancel");
    }
});
</script>
</body>
</html>
```

### Step 6: Add snip button to DrawView toolbar

**File:** `/src/renderer/editors/draw/DrawView.tsx`

Add a "Screen Snip" button using a scissors/crop icon. Need to add an icon — use `CursorIcon` or create a new `SnipIcon`, or reuse an existing icon like `ViewLandscapeIcon`.

```typescript
import { api } from "../../../ipc/renderer/api";

const handleScreenSnip = useCallback(async () => {
    if (!apiRef.current) return;
    const dataUrl = await api.startScreenSnip();
    if (!dataUrl) return; // cancelled

    const dims = await getImageDimensions(dataUrl);
    const fileId = crypto.randomUUID();

    apiRef.current.addFiles([{
        id: fileId as any,
        dataURL: dataUrl as any,
        mimeType: "image/png",
        created: Date.now(),
    }]);

    const newElements = convertToExcalidrawElements([{
        type: "image",
        x: 0,
        y: 0,
        width: Math.min(dims.width, 1200),
        height: Math.min(dims.height, 1200) * (dims.height / dims.width),
        fileId: fileId as any,
        status: "saved",
    } as any]);

    const existing = apiRef.current.getSceneElements();
    apiRef.current.updateScene({
        elements: [...existing, ...newElements],
    });
}, []);
```

### Step 7: Add toolbar icon

Either reuse `ViewLandscapeIcon` (looks like a landscape/screen) or create a new `SnipIcon` in `/src/renderer/theme/icons.tsx` — a simple scissors or screen-crop icon.

## Resolved concerns

### 1. DPI scaling — will test on mixed-DPI setup (120% + 100%)

Overlay coordinates in DIP, crop in physical pixels (× scaleFactor). User will test with two monitors at different scales.

### 2. Capture timing — 300ms

Standard delay after hiding windows. User will test if sufficient.

### 3. Display ID matching — `String(display.id) === source.display_id`

### 4. Overlay session — default session, `nodeIntegration: true`

### 5. Multi-window — `hideWindows()`/`showWindows()` handle all windows, IPC via `executeOnce` command ID

### 6. Cancel — Escape key or tiny selection (<5px)

### 7. Toolbar icon — new `SnipIcon`

Custom SVG: open scissors rotated 90° with blade tips connected by a dashed right-angle line (crop/snip indicator). Matches the Windows Snipping Tool visual style. Created in `/src/renderer/theme/icons.tsx`.

### 8. IPC cleanup — `finally` block restores windows, overlay close on cleanup. Edge-case crashes acceptable.

## Files changed summary

| File | Change |
|------|--------|
| `src/ipc/api-types.ts` | Add `startScreenSnip` endpoint |
| `src/ipc/main/controller.ts` | Add handler + binding |
| `src/ipc/renderer/api.ts` | Add `startScreenSnip` method |
| `src/main/snip-service.ts` | **NEW** — orchestrator (hide, capture, overlays, crop, show) |
| `assets/snip-overlay.html` | **NEW** — plain HTML/JS overlay with canvas selection UI |
| `src/renderer/editors/draw/DrawView.tsx` | Add "Screen Snip" button + handler |
| `src/renderer/theme/icons.tsx` | Add `SnipIcon` (if new icon needed) |

## Acceptance criteria

- [ ] "Screen Snip" button visible in drawing editor toolbar
- [ ] Clicking it hides all js-notepad windows
- [ ] Full-screen overlay appears with dimmed screenshot on each monitor
- [ ] User can drag to select a rectangle (crosshair cursor)
- [ ] Selected area shows at full brightness with white border
- [ ] Releasing mouse captures the selection and inserts into Excalidraw canvas
- [ ] Escape key cancels and restores windows
- [ ] Works on multi-monitor setups
- [ ] DPI scaling handled correctly (cropped region matches visual selection)
- [ ] js-notepad windows restore after capture or cancel
- [ ] Inserted image appears at correct dimensions on canvas
- [ ] Empty/tiny selection (<5px) treated as cancel
