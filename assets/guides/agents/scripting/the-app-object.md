---
title: "The app Object"
audience: "agent"
summary: "How do agents use the app object and its available APIs from scripts?"
---

# The app Object

## The `app` Object

Root application object with all services. The `call` tool addresses the same objects by path with
the same names — `call("pages[0].content")` is `app.pages.all[0].content` here, `call("page")` is
`page`. Use `call` to look around and for one-step reads and actions; write a script when you need
logic, loops, or Node.js.

| Property | Description |
|----------|-------------|
| `app.version` | Application version string |
| `app.pages` | Open tabs — create, open, close, navigate, group |
| `app.fs` | File system — read, write, dialogs, paths |
| `app.settings` | Application configuration — get/set settings; `call` also exposes the section/key catalog and highlighting |
| `app.themes` | Inspect, derive, contrast-check, preview, save, rename, delete, and apply themes |
| `app.ui` | Dialogs — confirm, input, password, notifications |
| `app.shell` | OS integration — open URLs, encryption |
| `app.window` | Window management — minimize, maximize, zoom |
| `app.editors` | Editor registry — list and resolve editors |
| `app.recent` | Recently opened files |
| `app.downloads` | Download tracking |
| `app.boards` | Boards — `createBoard(name, dir)` / `createDemoBoard(name, dir)` / `openBoard(root)`. See `persephone://guides/boards`. |
| `app.boardVars` | Env vars/secrets store for boards — get/set/list per namespace, resolve a board's namespace, open the editor. See `persephone://guides/boards`. |
| `app.openRawLink(href, options?)` | Open any link (file path, URL, or in-app scheme) in a new/reused tab and make it active. `options.editor` requests a specific editor or capability (e.g. `{ editor: "md-view" }` or `{ editor: "image.edit" }`); falls back to the default when omitted/unmatched |
| `app.call(path, options?)` | Resolve the live AiVision tree from the script's own page context; returns the full value by default, or an explicitly bounded value when `maxLength` is supplied, and rejects `Error` on resolver failure |

The MCP `call` root also exposes `clipboard` only on supported platforms when
`clipboard.enabled` is true. It is stored history, not the live OS clipboard: use `clipboard.items`
or `clipboard.list(offset, limit)`
for newest-first previews, `clipboard.read(id, flavor?)` for a stored text, HTML, image, or file-list
payload, and `clipboard.remove(id)` or `clipboard.clear()` only when the user explicitly asks for
deletion. A file-list read returns a plain `string[]` of absolute paths; its `dropEffect` remains
metadata on the history item for copy-versus-cut semantics. Older file-list payloads written as
JSON are still read, but new payloads are stored as one path per line. The feature is opt-in, and
stored non-excluded content may remain readable on disk. Clipboard history is unavailable on Linux
because GNOME Wayland gives apps no way to watch the clipboard; a copied enabled setting does not
make its MCP node available there.

### `app.call(path, options?)`

For the script-side call seam, inspect `script.$help` and use `app.call(path)` inside
`script.execute`. The examples below show the renderer facade's format; the full live contract is
owned by the `script` node.

```javascript
const source = await app.call("page.grouped.content");
const rows = await app.call("page.editor.rows");
await app.call("page.grouped.content", {
    value: JSON.stringify({ checked: true }, null, 2),
});
const result = await app.call("page.editor.getCell", { args: [0, "name"] });
```

For a remote board or browser-page model under `pages[i].editor.app`, `options.timeoutMs` is the
per-call timeout. The host then falls back to the remote method's declared timeout, the session-only
`boards.callTimeoutMs`, and the built-in 30-second default. The per-call value does not affect
ordinary local object-model paths.

The shell nodes are available through the MCP `call` path as well. Use `window.menuBar.folders`
to discover the live built-in and user-folder IDs, then `window.menuBar.open(id)` to open one;
the legacy `window.openMenuBar()` remains available. `page.panels.items` is a live projection of
the current sidebar panels; `page.panels.expand(id)` takes a bare panel ID and
`page.panels.toggleSidebar()` changes only an existing sidebar's open state, throwing when there
are no panels or a non-Explorer panel keeps it open. There is no uniform `page.panels.close(id)`
because individual panel owners have different hide/dispose lifecycles.

Use `settings.sections` to inspect the current built-in Settings catalog, whose sections and rows
can change, then `settings.highlight(key)` to open or activate Settings and point at the containing
section.
`settings.set` remains the mutation operation. Through the AiVision `call` seam only,
`mcp.enabled` and `mcp.port` are refused because changing them disconnects the caller;
`app.settings.set` is unchanged.

### app.pages

```javascript
app.pages.activePage              // Current active page (IPage)
app.pages.all                     // All open pages (IPage[]) — e.g. all.find(p => p.title === "x")
app.pages.findPage(pageId)        // Find page by ID
await app.pages.closePage(pageId) // Close a page — true if closed, false if cancelled; unknown IDs throw
await app.pages.openFile(path)    // Open a file in a tab
app.pages.addEmptyPage()          // Add empty text page
app.pages.addEditorPage(editor, language, title, content?) // Add page with optional initial content
app.pages.showPage(pageId)        // Activate a tab
app.pages.showNext()              // Next tab
app.pages.showPrevious()          // Previous tab
app.pages.group(leftId, rightId)  // Group two pages side-by-side
app.pages.ungroup(pageId)         // Remove from group
app.pages.pinTab(pageId)          // Pin a tab
app.pages.unpinTab(pageId)        // Unpin a tab
app.pages.moveTab(fromId, toId)   // Reorder tabs
await app.pages.openDiff({ firstPath, secondPath })  // Diff view
app.pages.compare.pairs           // Active compare pairs with left/right page ids and paths
app.pages.compare.enter(pageId)   // Enter compare mode for either member of a grouped pair
app.pages.compare.exit(pageId)    // Leave compare mode for either member
await app.pages.showBrowserPage({ url })              // Open browser tab
await app.pages.openUrlInBrowserTab(url)              // Open URL in browser — returns the page id
await app.pages.navigatePageTo(pageId, filePath, { revealLine, highlightText })
```

### app.fetch

`app.fetch(url, options?)` is a script API that makes an HTTP request through Node.js and returns a
standard `Response`; it is not an AiVision call-tree method. Options include `method`, `headers`,
`body`, `timeout`, `maxRedirects`, `signal`, `rejectUnauthorized` (TLS validation), `proxy`, and
`tor`. It adds no automatic Chromium headers. Proxy and Tor routing do not fall back to a direct
connection.

### app.fs

`app.fs.watch(path, callback, options?)` observes local changes within the script context; callback
functions cannot be supplied through MCP calls. Normal scripts release watches when they complete;
autoload scripts retain them until reload. See the [filesystem reference](../../scripting/api/fs.md#watching-paths)
for batch contents, recovery, and disposal.

```javascript
const text = await app.fs.read(filePath)              // Read text file
const { content, encoding } = await app.fs.readFile(filePath)  // Read with encoding info
const buffer = await app.fs.readBinary(filePath)      // Read binary
await app.fs.write(filePath, content, encoding?)      // Write text (default UTF-8)
await app.fs.writeBinary(filePath, data)              // Write binary
await app.fs.exists(filePath)                         // Check if exists
await app.fs.delete(filePath)                         // Delete file

// Directories
const files = await app.fs.listDir(dirPath, pattern?) // List files (names only, not full paths)
await app.fs.mkdir(dirPath)                           // Create directory (recursive)

// Dialogs
const files = await app.fs.showOpenDialog({ title, filters, multiSelect })
const path = await app.fs.showSaveDialog({ defaultPath, filters })
const folders = await app.fs.showFolderDialog({ title })

// Paths
app.fs.resolveDataPath(relativePath)                  // App data folder
const dir = await app.fs.commonFolder("downloads")    // OS folders: documents, downloads, desktop, home, temp, etc.

// Explorer
app.fs.showInExplorer(filePath)                       // Show file in explorer
app.fs.showFolder(folderPath)                         // Open folder
```

### app.themes

When the user describes a palette, inspect `app.themes.list()` and choose a close built-in or saved
theme. Use `app.themes.fork(id)` when preserving its full palette matters, or
`app.themes.derive(base, isDark?)` for a new palette from background, text, and accent colors.
`fork()` returns an id-less draft; edit the draft's name, base, and overrides, then inspect
`app.themes.contrast(draft)` before making it visible. To change a saved custom theme in place, start
from `app.themes.file(id)` — its stored base intent, `isDark` and overrides, with the id — and pass
it back to `save()`.

Preview only to let the user inspect the result. `app.themes.preview(draft)` changes this window's
appearance in renderer memory and writes neither settings nor files. Preview is window-local and
survives settings/theme-file reloads, but ends on window reload or app restart. In a running
renderer it stays active until `app.themes.endPreview()`, `app.themes.apply(id)`, or explicit
selection through the Settings picker or theme cycling. A preview started through a board ends when
that board closes or reloads, unless a later preview or theme selection has replaced it.

```javascript
const draft = app.themes.fork("persephone");
draft.name = "Moss at midnight";
draft.base.accent = "#6aa88b";
const contrast = app.themes.contrast(draft);
const preview = app.themes.preview(draft);
// Save only after the user asks to keep the palette.
const saved = await app.themes.save(draft);
// Apply only when the user asks to select it.
await app.themes.apply(saved.id);
```

MCP exposes the same calls as `call themes.list`, `call themes.preview(args: [draft])`, and
`call themes.endPreview`. `preview` changes this window's appearance; `save` and `rename` write
custom theme files, `delete` removes one (and persists the `persephone` fallback if selected), and
`apply` immediately changes this window and persists the selected theme. Inspect those cautions
and ask before saving, deleting, or applying when the user has not requested that action.

### app.settings

```javascript
const theme = app.settings.theme                      // Current theme name
const value = app.settings.get("editor.fontSize")     // Get any setting
app.settings.set("theme", "monokai")                  // Set a setting
app.settings.set("editor.word-wrap", true)                 // default for newly shown Text Editor pages only

app.settings.settingsFilePath                         // Path of the settings file on disk

// Subscribe to changes
const sub = app.settings.onChanged.subscribe(({ key, value }) => { ... });
sub.dispose();  // Unsubscribe
```

Settings live in `%APPDATA%\persephone\data\appSettings.json` — JSON5, watched, and reloaded on
save, so an external edit applies immediately and fires `onChanged` just like `set()` does. Use
`set()` when you are connected; edit the file only when you are not (that is how the MCP server
gets turned on in the first place). Persephone regenerates the file's comments on every save, so
comments added by hand are lost. Keys, defaults, and accepted values are documented in the file
itself and summarised in `persephone://guides/ui`.

`editor.word-wrap` is read only when a newly shown Text Editor page has no saved page state. Each
page then retains its own persisted `wordWrap` value, so changing the application default does not
change existing Text Editor pages.

### app.ui

```javascript
// Confirmation dialog — returns button label or null
const answer = await app.ui.confirm("Delete?", {
    title: "Confirm",
    buttons: ["Yes", "No", "Cancel"]
});

// Input dialog — returns { value, button } or null
const result = await app.ui.input("Enter name:", { value: "default", selectAll: true });

// Password dialog — returns string or null
const pw = await app.ui.password({ mode: "encrypt" });  // "encrypt" shows confirm field

// Toast notification — "info", "success", "warning", "error"
app.ui.notify("Done!", "success");
const clicked = await app.ui.notify("Click me", "info");  // Returns "clicked" or undefined
const alerts = app.ui.alerts.list();                      // Held toast data, including createdAt
app.ui.alerts.closeAll("error");                          // Dismiss matching toasts
```

### app.shell

```javascript
await app.shell.openExternal("https://github.com")   // Open URL in OS browser

// Encryption (AES-GCM)
const encrypted = await app.shell.encryption.encrypt(text, password)
const decrypted = await app.shell.encryption.decrypt(encrypted, password)
app.shell.encryption.isEncrypted(text)                // Check if encrypted

// Version info
const v = await app.shell.version.runtimeVersions()   // { electron, node, chrome }
const u = await app.shell.version.checkForUpdates()    // { updateAvailable, latestVersion, ... }
```

### app.window

```javascript
app.window.minimize()
app.window.maximize()
app.window.restore()
app.window.close()
app.window.toggleWindow()             // Toggle maximize/restore
app.window.isMaximized                // boolean (read-only)
app.window.zoom(1)                    // Zoom in (positive) or out (negative)
app.window.resetZoom()
app.window.zoomLevel                  // Current zoom level
app.window.toggleMenuBar()            // Toggle sidebar
app.window.menuBar.folders             // Live built-in and configured user folders
app.window.menuBar.selected            // Current folder
app.window.menuBar.open(folderId?)     // Open; a supplied ID must be valid
app.window.menuBar.close()
await app.window.openNew(filePath?)   // Open new window
```

### app.editors

```javascript
app.editors.getAll()                  // All registered editors: [{ id, name, category }]
app.editors.getById("grid-json")      // Get editor info by ID
app.editors.resolve("data.json")      // Best editor for a file path
app.editors.resolveId("readme.md")    // Just the editor ID
```

### app.recent

```javascript
await app.recent.load()               // Load recent files list (lazy)
app.recent.files                      // string[] — most recent first
await app.recent.add(filePath)        // Add to recent
await app.recent.remove(filePath)     // Remove from recent
await app.recent.clear()              // Clear all
```

