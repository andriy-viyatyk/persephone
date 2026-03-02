# IApp — `app`

**Status:** Implemented (Phase 0+1+2+3a+3b+4)

Root application object. Entry point to all app functionality.

Available in scripts as the global `app` variable.

## Access

```javascript
app
```

## Properties

### `version` (read-only)

Application version string.

```javascript
const ver = app.version;
// "1.0.17"
```

**Type:** `string`

**Note:** Resolved during app initialization via IPC. Always available when scripts run.

---

### `settings` (read-only)

Application configuration. See [ISettings](settings.md).

```javascript
app.settings.theme              // Current theme name
app.settings.get("theme")       // Read any setting
app.settings.set("theme", "monokai")  // Change a setting
```

**Type:** [`ISettings`](settings.md)

---

### `editors` (read-only)

Read-only registry of all editors. See [IEditorRegistry](editors.md).

```javascript
app.editors.getAll()             // List all editors
app.editors.resolve("data.pdf")  // Best editor for a file
```

**Type:** [`IEditorRegistry`](editors.md)

---

### `recent` (read-only)

Recently opened files. See [IRecentFiles](recent.md).

```javascript
await app.recent.load();
app.recent.files                 // Recent file paths
```

**Type:** [`IRecentFiles`](recent.md)

---

### `fs` (read-only)

File system operations, dialogs, and OS integration. See [IFileSystem](fs.md).

```javascript
const text = await app.fs.read("C:/data/file.txt");
await app.fs.write("C:/data/out.txt", text);
const paths = await app.fs.showOpenDialog();
```

**Type:** [`IFileSystem`](fs.md)

---

### `window` (read-only)

Window management: minimize, maximize, zoom, multi-window. See [IWindow](window.md).

```javascript
app.window.maximize();
app.window.zoom(1);
console.log(app.window.zoomLevel);
```

**Type:** [`IWindow`](window.md)

---

### `shell` (read-only)

OS integration: open URLs, encryption, version info. See [IShell](shell.md).

```javascript
await app.shell.openExternal("https://github.com");
const encrypted = await app.shell.encryption.encrypt("data", "pass");
const info = await app.shell.version.checkForUpdates();
```

**Type:** [`IShell`](shell.md)

---

### `ui` (read-only)

Dialogs and notifications. See [IUserInterface](ui.md).

```javascript
const answer = await app.ui.confirm("Save changes?");
app.ui.notify("File saved", "success");
```

**Type:** [`IUserInterface`](ui.md)

---

### `downloads` (read-only)

Global download tracking. See [IDownloads](downloads.md).

```javascript
app.downloads.downloads          // All download entries
app.downloads.activeCount        // Number of active downloads
```

**Type:** [`IDownloads`](downloads.md)

---

### `pages` (read-only)

Open pages (tabs) in the current window. See [IPageCollection — types/pages.d.ts](../../src/renderer/api/types/pages.d.ts).

```javascript
app.pages.all                    // All open pages
app.pages.activePage             // Currently visible page
await app.pages.openFile("C:/data.json")
```

**Type:** `IPageCollection`

---

## Examples

### Get app version

```javascript
app.version
// "1.0.17"
```

### Change theme via script

```javascript
app.settings.set("theme", "solarized-dark");
```

### List available editors

```javascript
app.editors.getAll().forEach(e => console.log(e.name));
```

### Read recent files

```javascript
await app.recent.load();
console.log(app.recent.files.slice(0, 5));
```

### Read and write files

```javascript
const data = await app.fs.read("C:/data/input.json");
await app.fs.write("C:/data/output.json", data);
```

### Window control

```javascript
app.window.maximize();
await app.window.openNew("C:/file.txt");
```

### Dialogs and notifications

```javascript
const answer = await app.ui.confirm("Delete?", { buttons: ["Delete", "Cancel"] });
if (answer === "Delete") { /* proceed */ }

app.ui.notify("Operation complete", "success");
```

### Open URL and check for updates

```javascript
await app.shell.openExternal("https://github.com");
const info = await app.shell.version.checkForUpdates();
```

---

## Implementation Notes

- The `app` singleton is created in `/src/renderer/api/app.ts`
- Bootstrap calls `app.init()` → `app.initServices()` → `app.initPages()` → `app.initEvents()` before React renders
- `initServices()` loads 8 API modules via dynamic `import()` in parallel
- `initPages()` restores persisted pages and processes CLI arguments
- `initEvents()` initializes 4 internal event services (GlobalEventService, KeyboardService, WindowStateService, RendererEventsService)
- Each window has its own `app` instance (Electron multi-window architecture)
- `app` is added to script context in `ScriptContext.ts` alongside the existing `page` object
- See [/doc/architecture/pages-architecture.md](../../architecture/pages-architecture.md) for bootstrap lifecycle diagram
