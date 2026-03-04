# IWindow — `app.window`

**Status:** Implemented (Phase 2)

Window management API. Controls the application window: minimize, maximize, restore, close, zoom, menu bar, and multi-window support.

## Access

```javascript
app.window
```

---

## Methods — Window Actions

### `minimize()`

Minimize the window to the taskbar.

```javascript
app.window.minimize();
```

**Returns:** `void`

---

### `maximize()`

Maximize the window.

```javascript
app.window.maximize();
```

**Returns:** `void`

---

### `restore()`

Restore the window from maximized or minimized state.

```javascript
app.window.restore();
```

**Returns:** `void`

---

### `close()`

Close the window.

```javascript
app.window.close();
```

**Returns:** `void`

---

### `toggleWindow()`

Toggle between maximized and restored state.

```javascript
app.window.toggleWindow();
```

**Returns:** `void`

---

## Methods & Properties — Window State

### `isMaximized` (read-only)

Whether the window is currently maximized. Updated reactively via IPC events.

```javascript
if (app.window.isMaximized) {
  app.window.restore();
} else {
  app.window.maximize();
}
```

**Type:** `boolean`

---

### `setMaximized(isMaximized)`

Set the maximized state. Used by `WindowStateService` to sync from main process, but also available for scripts.

```javascript
app.window.setMaximized(true);
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `isMaximized` | `boolean` | Whether the window is maximized |

**Returns:** `void`

---

## Properties & Methods — Menu Bar

### `menuBarOpen` (read-only)

Whether the menu bar (sidebar) is currently open.

```javascript
if (app.window.menuBarOpen) {
  console.log("Menu bar is open");
}
```

**Type:** `boolean`

---

### `toggleMenuBar()`

Toggle the menu bar (sidebar) open or closed.

```javascript
app.window.toggleMenuBar();
```

**Returns:** `void`

---

## Methods — Zoom

### `zoom(delta)`

Zoom in or out incrementally.

```javascript
app.window.zoom(1);   // zoom in
app.window.zoom(-1);  // zoom out
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `delta` | `number` | Positive to zoom in, negative to zoom out |

**Returns:** `void`

---

### `resetZoom()`

Reset zoom to 100%.

```javascript
app.window.resetZoom();
```

**Returns:** `void`

---

## Properties & Methods — Zoom State

### `zoomLevel` (read-only)

Current zoom level (step value). `0` = 100%. Updated reactively via IPC events.

```javascript
console.log(app.window.zoomLevel); // 0, 1, 2, -1, -2, etc.
```

**Type:** `number`

---

### `setZoomLevel(zoomLevel)`

Set the zoom level directly. Used by `WindowStateService` to sync from main process, but also available for scripts.

```javascript
app.window.setZoomLevel(2); // set to ~144%
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `zoomLevel` | `number` | Zoom step value (0 = 100%) |

**Returns:** `void`

---

## Properties — Window Identity

### `windowIndex` (read-only)

Zero-based index of this window among all application windows. Set once during initialization.

```javascript
console.log(app.window.windowIndex); // 0, 1, 2, etc.
```

**Type:** `number`

---

## Methods — Multi-Window

### `openNew(filePath?)`

Open a new application window. Optionally opens a file in the new window.

```javascript
await app.window.openNew();                    // Empty window
await app.window.openNew("C:/Users/me/file.txt");  // Window with file
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `filePath?` | `string` | Optional file to open in the new window |

**Returns:** `Promise<number>` — The new window's index.

---

## Examples

### Toggle maximize

```javascript
// Using toggleWindow (recommended)
app.window.toggleWindow();

// Or manually
if (app.window.isMaximized) {
  app.window.restore();
} else {
  app.window.maximize();
}
```

### Toggle menu bar from script

```javascript
app.window.toggleMenuBar();
```

### Zoom to specific level

```javascript
// Reset first, then zoom in 3 steps
app.window.resetZoom();
app.window.zoom(1);
app.window.zoom(1);
app.window.zoom(1);
```

### Open file in new window

```javascript
const paths = await app.fs.showOpenDialog();
if (paths) {
  await app.window.openNew(paths[0]);
}
```

---

## Implementation Notes

- All window actions are fire-and-forget IPC calls to the main process
- Window state (`isMaximized`, `zoomLevel`, `menuBarOpen`) is stored in a reactive `TOneState` — React components subscribe via `.use()`, scripts read via getters
- Event subscriptions (`eWindowMaximized`, `eZoomChanged`) are handled by `WindowStateService` during `initEvents()`, not in the Window constructor
- Each window has its own `app.window` instance
