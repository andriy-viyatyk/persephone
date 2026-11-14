---
title: "app"
audience: "user"
summary: "How do scripts read application properties and call common app methods?"
---

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
| [themes](./themes.md) | `IThemes` | Inspect, derive, preview, and manage built-in and custom themes. |
| [pages](./pages.md) | `IPageCollection` | Open pages (tabs) in the current window. |
| [fs](./fs.md) | `IFileSystem` | File system operations and dialogs. |
| [ui](./ui.md) | `IUserInterface` | Dialogs, notifications, progress, and app-window highlights. |
| [shell](./shell.md) | `IShell` | OS integration: open URLs, encryption, version info. |
| [window](./window.md) | `IWindow` | Window management: minimize, maximize, zoom, multi-window. |
| [editors](./editors.md) | `IEditorRegistry` | Read-only registry of all editors. |
| [recent](./recent.md) | `IRecentFiles` | Recently opened files. |
| [downloads](./downloads.md) | `IDownloads` | Global download tracking. |
| [proc](app-proc-and-boards.md#proc) | `IProc` | Spawn external programs and stream their output. |
| [boards](app-proc-and-boards.md#boards) | `IBoards` | Create and open [Boards](../../boards/index.md) from scripts or agents. |
| [capabilities](app-capabilities-and-vars.md#capabilities) | `ICapabilities` | Discover and invoke built-in and trusted-board capability handlers. |
| [boardVars](app-capabilities-and-vars.md#boardvars) | `IBoardVars` | Admin access to the [board environment-variables store](../../boards/env-vars.md#environment-variables--secrets-outside-the-board-folder) — any namespace, not just the calling board's own. |
| `menuFolders` | `IMenuFolders` | User-configured sidebar folders. |

## Methods

### call(path, options?)

Resolve a path in the live application object model from a script. Paths use the same names as the
scripting API and can read values, invoke the final method, or assign a writable property. Results
are plain JSON-safe values. Script calls are unbounded by default, so long strings and structured
results arrive intact. Pass `maxLength` when you want to impose a bound; structured truncation keeps
whole values. The MCP `call` envelope reports how many collection items or properties were shown and
how many were available; `app.call()` returns the value itself.

```javascript
// Read the grouped output page for the current script
const output = await app.call("page.grouped.content");

// Invoke a method with JSON-compatible arguments
await app.call("pages.showPage", { args: [pageId] });

// Assign a writable property
await app.call("page.grouped.content", {
    value: JSON.stringify({ done: true }, null, 2),
});

// Discover and point at an application setting without changing it
const sections = await app.call("settings.sections");
await app.call("settings.highlight", { args: ["mcp.enabled"] });

// Inspect and control the current window's Menu Bar
const folders = await app.call("window.menuBar.folders");
await app.call("window.menuBar.open", { args: ["tools-editors"] });

// Inspect and expand a page sidebar panel
const panels = await app.call("page.panels.items");
if (panels.length) {
    await app.call("page.panels.expand", { args: [panels[0].id] });
}
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `path` | `string` | Object-model path, such as `page.grouped.content`, `pages[0].content`, or `settings.theme`. |
| `options.args` | `unknown[]` | Arguments for the final method. Cannot be combined with `value`. |
| `options.value` | `unknown` | Value for the final writable property. Cannot be combined with `args`. |
| `options.maxLength` | `number` | Optional maximum serialized length for a shaped string or structured result. Omit it for an unbounded script result. |
| `options.timeoutMs` | `number` | Per-call timeout for a remote board or browser-page `.app` leaf. Timeout precedence continues with the remote declaration, session-only `boards.callTimeoutMs`, then the 30-second default. |

`app.call()` is rooted in the current script's window. It can address pages, editor
facades, and application services exposed to scripts, including the local `boards` inventory and
the Agent Tools registry. It cannot resolve the MCP-only `main.*` or `windows[i].*` paths.
Failures reject the returned promise with an `Error`.

`window.menuBar.open()` takes a current folder ID from `window.menuBar.folders`, not a display
label or disk path. `page.panels.expand()` takes the bare panel ID returned in `items`; use the
panel's own header control to close an individual panel. The settings catalog is available as
`settings.sections` and `settings.highlight(key)` through this object-model API; the regular
`app.settings.get()` and `app.settings.set()` methods remain the configuration API.

---

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
| `tor` | `boolean` | `false` | Route the request through Persephone's Tor daemon. Cannot be combined with `proxy`. |
| `proxy` | `string` | — | Route through a SOCKS5 or HTTP proxy. Cannot be combined with `tor`. |

#### Routing

Choose a route for each request. A routed request never falls back to a direct connection; it
rejects if the route cannot be used. SOCKS5 sends the target host name to the proxy for DNS
resolution, so host names are not looked up locally and `.onion` addresses work through Tor.
The first Tor request can wait for the daemon to start and bootstrap (up to 90 seconds).

```javascript
// Use Persephone's Tor daemon; requires the tor.exe-path setting
const throughTor = await app.fetch("https://check.torproject.org/api/ip", { tor: true });

// Use an explicit SOCKS5 proxy (socks5h:// is also accepted)
const throughSocks = await app.fetch("https://api.example.com/data", {
    proxy: "socks5://192.168.1.1:1080",
});

// A bare host:port is shorthand for SOCKS5
const throughSocksShorthand = await app.fetch("https://api.example.com/data", {
    proxy: "192.168.1.1:1080",
});
```

An HTTP proxy can be specified as `http://host:port`; it uses CONNECT for both HTTP and HTTPS
targets. Proxy credentials can be included in the URL, for example
`socks5://user:pass@host:1080` or `http://user:pass@host:8080`. Credentials are used for that
call only and are not stored.

### openRawLink(href, options?)

Open any link through Persephone's navigation pipeline — a local file path, a URL, or an in-app scheme
(`persephone-board://`, `persephone-toolset://`, `persephone-guide://`, `tree-category://`,
`git-tree://`, `mneme://`, `mneme-folder://`, or `folder-editor://`). The Explorer creates
`folder-editor://` links for trusted boards that claim a folder; scripts should normally use the
Explorer or `page.editorSwitches.switchTo(...)` rather than constructing that link
themselves. Opens a new tab or reuses a matching one if it already exists.

```javascript
// Open a local file in a new tab
await app.openRawLink("C:/data/report.json");

// Open a URL in the built-in browser
await app.openRawLink("https://example.com");

// Open a Board by its root path (prefer app.boards.openBoard for boards)
await app.boards.openBoard("C:/work/boards/My Board");

// Request a specific editor — render Markdown instead of opening its source
await app.openRawLink("C:/notes/README.md", { editor: "md-view" });

// An image data URL + the image-edit capability opens a new, untitled, editable Excalidraw
// drawing with the image embedded (equivalent to app.pages.addDrawPage)
await app.openRawLink(imageDataUrl, { editor: "image.edit" });
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `href` | `string` | File path, URL, in-app link scheme, or (for `{ editor: "image.edit" }`) an image `data:` URL. |
| `options.editor` | `string` | Optional. Request a specific editor or capability for `href` (e.g. `"md-view"` or `"image.edit"`). Falls back to the default editor when omitted or when the requested target doesn't accept `href`. |

**Returns:** `Promise<void>` — resolves after the navigation is dispatched.

---

### runAsync(fn, data, proxy?)

Run a function in a background worker thread. The renderer stays responsive while the function executes. The function runs in an isolated worker with full Node.js access (`require`, `fs`, `path`, `child_process`, npm packages, etc.).

The function is serialized as a string — it must be **self-contained** and cannot reference outer-scope variables (closures are lost). Pass all inputs via `data` (cloned) or `proxy` (proxied).

```javascript
// Simple: offload heavy computation
const files = await app.runAsync(
    async (data) => {
        const fs = require("fs");
        return fs.readdirSync(data.dir, { recursive: true });
    },
    { dir: "C:/projects/my-app/src" }
);
```

```javascript
// With proxy: progress updates from the worker
const progress = await app.ui.createProgress("Processing...");
const result = await progress.show(app.runAsync(
    async (data, proxy) => {
        const fs = require("fs");
        const files = fs.readdirSync(data.dir);
        for (let i = 0; i < files.length; i++) {
            await proxy.onProgress(`${i + 1}/${files.length}`);
        }
        return files;
    },
    { dir: "C:/my-project" },
    { onProgress: (msg: string) => { progress.label = msg; } }
));
```

#### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `fn` | `(data: TData, proxy: TProxy) => Promise<TResult>` | Self-contained function to run in the worker. |
| `data` | `TData` | Plain serializable data cloned into the worker via structured clone. Supports: primitives, plain objects, arrays, `Map`, `Set`, `ArrayBuffer`, `Date`, `RegExp`. Does **not** support: functions, DOM elements, class instances, circular references. |
| `proxy` | `TProxy?` | Optional object transparently proxied back to the renderer. Every access on `proxy` inside the worker is async (round-trips via `postMessage`). Property sets are fire-and-forget — use callback methods (`await proxy.onProgress(msg)`) when confirmation is needed. |

**Returns:** `Promise<TResult>` — the value returned by `fn`, cloned back to the renderer.

See [Scripting — Background Workers](../script-library-and-workers.md#background-workers-apprunasync) for usage guide and examples.

---


## Read next

| What you need | Page (object-model path) |
|---|---|
| Processes and boards | [app-proc-and-boards](app-proc-and-boards.md) - `guides.scripting.api["app-proc-and-boards"]` |
| Capabilities, board variables and menu folders | [app-capabilities-and-vars](app-capabilities-and-vars.md) - `guides.scripting.api["app-capabilities-and-vars"]` |
