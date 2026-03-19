[← API Reference](./index.md)

# app.window

Window management: minimize, maximize, zoom, and multi-window support.

```javascript
app.window.maximize();
app.window.zoom(1);  // zoom in one step
```

## Window Actions

| Method | Description |
|--------|-------------|
| `minimize()` | Minimize to taskbar. |
| `maximize()` | Maximize the window. |
| `restore()` | Restore from maximized/minimized. |
| `close()` | Close the window. |
| `toggleWindow()` | Toggle between maximized and restored. |

## Window State

| Property | Type | Description |
|----------|------|-------------|
| `isMaximized` | `boolean` | Whether the window is maximized. Read-only, updated reactively. |
| `windowIndex` | `number` | Zero-based index among all app windows. Read-only. |

## Menu Bar

| Member | Type | Description |
|--------|------|-------------|
| `menuBarOpen` | `boolean` | Whether the sidebar is open. Read-only. |
| `toggleMenuBar()` | `void` | Toggle sidebar open/closed. |
| `openMenuBar(panelId?)` | `void` | Open the sidebar. Pass an optional panel ID to navigate to a specific panel (e.g., `"tools-and-editors"`). |

## Zoom

| Member | Type | Description |
|--------|------|-------------|
| `zoom(delta)` | `void` | Zoom in (positive) or out (negative). E.g., `1` or `-1`. |
| `resetZoom()` | `void` | Reset zoom to 100%. |
| `zoomLevel` | `number` | Current zoom level (0 = 100%). Read-only, updated reactively. |

```javascript
app.window.zoom(2);    // zoom in 2 steps
app.window.zoom(-1);   // zoom out 1 step
app.window.resetZoom(); // back to 100%
```

## Multi-Window

### openNew(filePath?) → `Promise<number>`

Open a new application window. Returns the new window's index.

```javascript
// Open empty window
await app.window.openNew();

// Open window with a file
await app.window.openNew("C:/data/report.json");
```
