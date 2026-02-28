# IApp — `app`

**Status:** Implemented (Phase 0+1+2)

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

## Planned Properties (Not Yet Implemented)

The following will be added in subsequent migration phases:

| Property | Type | Phase | Description |
|----------|------|-------|-------------|
| `app.ui` | `IUserInterface` | 3 | Dialogs and UI actions |
| `app.shell` | `IShell` | 3 | Shell services (search, encryption, scripting) |
| `app.pages` | `IPageCollection` | 4 | Open pages/tabs collection |

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

---

## Implementation Notes

- The `app` singleton is created in `/src/renderer/api/app.ts`
- `init()` is called during bootstrap (before React renders) — not exposed to scripts
- `initServices()` loads interface wrappers via dynamic `import()` after the main bundle (stores must be in the module cache first)
- Each window has its own `app` instance (Electron multi-window architecture)
- `app` is added to script context in `ScriptContext.ts` alongside the existing `page` object
