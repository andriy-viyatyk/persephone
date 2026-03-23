[← API Reference](./index.md)

# app

The root application object. Entry point to all app functionality.

Available as the global `app` variable in scripts.

```javascript
console.log(app.version);               // "1.0.17"
app.settings.set("theme", "monokai");
app.pages.activePage.content;
```

## Properties

| Property | Type | Description |
|----------|------|-------------|
| `version` | `string` | Application version (e.g. `"1.0.17"`). Read-only. |
| [settings](./settings.md) | `ISettings` | Application configuration. |
| [pages](./pages.md) | `IPageCollection` | Open pages (tabs) in the current window. |
| [fs](./fs.md) | `IFileSystem` | File system operations and dialogs. |
| [ui](./ui.md) | `IUserInterface` | Dialogs and notifications. |
| [shell](./shell.md) | `IShell` | OS integration: open URLs, encryption, version info. |
| [window](./window.md) | `IWindow` | Window management: minimize, maximize, zoom, multi-window. |
| [editors](./editors.md) | `IEditorRegistry` | Read-only registry of all editors. |
| [recent](./recent.md) | `IRecentFiles` | Recently opened files. |
| [downloads](./downloads.md) | `IDownloads` | Global download tracking. |
| `menuFolders` | `IMenuFolders` | User-configured sidebar folders. |

## Methods

### fetch(url, options?)

Make an HTTP request using Node.js. Unlike browser `fetch()`, this sends **only the headers you specify** — no automatic Chromium headers (Origin, User-Agent, Sec-Fetch-*, etc.). Returns a standard `Response` object.

```javascript
// Simple GET
const res = await app.fetch("https://api.example.com/users");
const data = await res.json();
```

```javascript
// POST with custom headers
const res = await app.fetch("https://api.example.com/users", {
    method: "POST",
    headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer token123",
    },
    body: JSON.stringify({ name: "John" }),
});
const result = await res.json();
```

#### Options

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `method` | `string` | `"GET"` | HTTP method. |
| `headers` | `Record<string, string>` | — | Request headers. Sent exactly as specified. |
| `body` | `string \| ReadableStream \| null` | — | Request body. |
| `timeout` | `number` | `30000` | Request timeout in milliseconds. |
| `maxRedirects` | `number` | `10` | Maximum number of redirects to follow. |
| `rejectUnauthorized` | `boolean` | `true` | Set to `false` to skip SSL certificate validation (e.g. self-signed certs). |

---

## menuFolders

Manage sidebar folders (persisted to `menuFolders.json`).

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `folders` | `IMenuFolder[]` | Current list of configured folders. |

### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `add({ name, path?, files? })` | `string` | Add a folder. Returns the generated ID. |
| `remove(id)` | `void` | Remove a folder by ID. |
| `find(id)` | `IMenuFolder \| undefined` | Find a folder by ID. |
| `move(sourceId, targetId)` | `void` | Reorder folders. |

### IMenuFolder

| Property | Type | Description |
|----------|------|-------------|
| `id` | `string` | Unique folder ID. |
| `name` | `string` | Display name. |
| `path` | `string?` | Folder path on disk. |
| `files` | `string[]?` | Explicit list of file paths (virtual folders). |

```javascript
// List all sidebar folders
app.menuFolders.folders.forEach(f => console.log(f.name, f.path));

// Add a project folder
app.menuFolders.add({ name: "My Project", path: "C:/projects/my-app" });
```
