# IWindow — `app.window`

**Status:** Implemented (Phase 2)

Window management API. Controls the application window: minimize, maximize, restore, close, zoom, and multi-window support.

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

## Properties — Window State

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

## Properties — Zoom State

### `zoomLevel` (read-only)

Current zoom level. Updated reactively via IPC events. Default: `1.0`.

```javascript
console.log(app.window.zoomLevel); // 1.0, 1.1, 0.9, etc.
```

**Type:** `number`

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
if (app.window.isMaximized) {
  app.window.restore();
} else {
  app.window.maximize();
}
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
- `isMaximized` and `zoomLevel` are cached locally, updated via `eWindowMaximized` and `eZoomChanged` IPC events
- Event subscriptions are established when the module is loaded (during `initServices()`)
- Each window has its own `app.window` instance
