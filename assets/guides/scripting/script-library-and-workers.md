---
title: "Script Library and Workers"
audience: "both"
summary: "How do users load scripts from the library and run background workers?"
---

# Script Library and Workers

## Script Library

You can designate a folder as your **Script Library** for quick access to frequently used scripts. The library appears as a dedicated entry in the sidebar — click it to browse and open scripts without navigating through custom folders.

### Setting Up

When you link a library folder for the first time (from the sidebar, Settings, or the Script Panel save button), a **Library Setup** dialog appears:

- **Folder path** — pick any folder to use as your library root
- **Copy example scripts** — enabled by default; copies a set of bundled example scripts into the folder so you can start immediately
  - `script-panel/all/` — general-purpose examples (example.ts, base64-encode.ts, base64-decode.ts)
  - `script-panel/plaintext/` — text-oriented scripts (sort-lines.ts, parse-jwt-token.ts)
  - `script-panel/json/` — JSON utilities (format-json.ts)
  - `utils/helpers.ts` — a shared helper module you can import with `require("library/utils/helpers")`

Existing files are never overwritten — only missing example files are copied.

You can also configure the library path later in **Settings → Script Library**. See [Tabs & Navigation](../tabs-and-navigation/menu-bar.md#script-library) for sidebar details.

### Importing Library Modules

Once a library folder is linked, scripts can import modules from it using `require("library/...")`:

```javascript
// Import a module from your library folder
const helpers = require("library/utils/helpers");
const db = require("library/db/connection");

const result = await db.query(page.content);
return helpers.formatTable(result);
```

**How it works:**
- `require("library/utils/helpers")` resolves to a file inside your linked library folder
- Extension auto-resolution: `.ts`, `.js`, `/index.ts`, `/index.js` are tried automatically — no need to specify the extension
- TypeScript files are transpiled automatically; `.js` files using ES module syntax (`export`/`import`) are also transpiled
- Relative requires within library modules work as expected (e.g., `require('./db-config')` inside a library file)
- Library modules have access to the same globals as the top-level script — `app`, `page`, `styledText`, `ui`, `preventOutput()`, and `require()` all work inside library code
- Breaking change: the injected `React` global is no longer available to top-level or library scripts. A script that references `React` now throws `ReferenceError`; import or bundle any dependencies it needs explicitly.
- Library modules are reloaded fresh on every `require()` call — there is no cached state between script runs. If you need to persist data across executions, use `page.data` or `app.settings`
- If no library folder is linked, `require("library/...")` throws a clear error message

### IntelliSense for Library Modules

When a library folder is linked, Monaco provides full IntelliSense for `require("library/...")` calls:

- **Path completion** — typing `require("library/` auto-suggests folders and files from your library. Selecting a folder re-triggers suggestions so you can drill into subdirectories; files appear without extension (matching runtime auto-resolution)
- **Type information** — exported functions and variables from library `.ts` and `.js` files show parameter types, return types, and JSDoc documentation
- **Live updates** — when you edit a library file, IntelliSense reflects the changes immediately

The built-in `require()` and `preventOutput()` functions also appear in autocomplete with documentation.

This lets you build a reusable toolkit — database helpers, formatters, API clients — and use it from any script or the Script Panel.

### Autoload Scripts

Place scripts in an `autoload/` subfolder of your Script Library to have them run automatically when the window opens:

```
script-library/
├── script-panel/     ← Scripts shown in Script Panel UI
├── autoload/         ← Registration scripts loaded on window open
│   ├── 01-custom-menus.ts
│   ├── 02-bookmark-fixer.ts
│   └── helper-utils.ts       ← Skipped (no register export)
└── utils/            ← Shared library code (imported via require)
```

Scripts must export a named `register` function to be executed:

```typescript
// autoload/01-custom-menus.ts
export function register() {
    app.events.fileExplorer.itemContextMenu.subscribe((event) => {
        // Add custom context menu items for certain files
    });

    app.events.browser.onBookmark.subscribe((event) => {
        // Modify bookmark fields before the Add/Edit dialog opens
        // event.data has: title, href, discoveredImages, imgSrc, category, tags, isEdit
        if (!event.data.isEdit) {
            event.data.category = "Uncategorized";
        }
    });
}
```

**How it works:**

- On window startup, all `.ts` and `.js` files in `autoload/` are loaded **alphabetically** — prefix filenames with `01-`, `02-` to control order
- Each file is checked for a `register` export. If found, `register()` is called (async functions are awaited). Files without a `register` export are silently skipped — they can serve as utility modules imported by other autoload scripts
- All event subscriptions made during registration persist for the window session
- **All-or-nothing error handling** — if any script fails during registration, all subscriptions from all scripts are unsubscribed and an error notification is shown
- Autoload scripts can import shared modules with `require("library/...")` just like regular scripts
- The `app` global is available (but not `page` — autoload scripts run outside any specific page context)

**Reloading:** When library files change on disk, a yellow reload indicator button appears in the header. Click it to reload all autoload scripts and refresh the library modules they import — the previous session is disposed (all event subscriptions removed) and scripts are loaded fresh.


## Background Workers (`app.runAsync`)

Scripts run on the renderer main thread, so CPU-intensive operations (recursive file scans, large data processing, TypeScript program creation) can freeze the UI. `app.runAsync()` offloads a function to a background worker thread — the UI stays responsive while the function executes.

```javascript
const result = await app.runAsync(fn, data, proxy?);
```

**Parameters:**

| Parameter | Description |
|-----------|-------------|
| `fn` | The function to run in the worker. Must be **self-contained** — closures and outer-scope variables are not available. Has full Node.js access via `require()`. |
| `data` | Plain serializable data cloned into the worker (primitives, objects, arrays, `Map`, `Set`, `Date`, `RegExp`, `ArrayBuffer`). Does **not** support functions, DOM elements, or class instances. |
| `proxy` | *(Optional)* Object transparently proxied back to the renderer. Every access on `proxy` inside the worker is async (round-trips via `postMessage`). Use for callbacks, progress reporting, and app API access. |

### Simple example — offload heavy computation

```javascript
const files = await app.runAsync(
    async (data) => {
        const fs = require("fs");
        return fs.readdirSync(data.dir, { recursive: true });
    },
    { dir: "C:/projects/my-app/src" }
);
return files;
```

### With proxy — progress updates from the worker

```javascript
const progress = await app.ui.createProgress("Processing...");
const result = await progress.show(app.runAsync(
    async (data, proxy) => {
        const fs = require("fs");
        const files = fs.readdirSync(data.dir);
        for (let i = 0; i < files.length; i++) {
            // proxy.onProgress runs on the renderer — UI stays responsive
            await proxy.onProgress(`${i + 1}/${files.length}`);
            // ... process file ...
        }
        return files;
    },
    { dir: "C:/my-project" },
    { onProgress: (msg: string) => { progress.label = msg; } }
));
```

### With proxy — passing app API objects

```javascript
const result = await app.runAsync(
    async (data, proxy) => {
        const content = await proxy.fs.readFile(data.path);
        return JSON.parse(content);
    },
    { path: "C:/data.json" },
    { fs: app.fs }
);
```

### Key points

- **Self-contained function** — the function is serialized as a string, so it cannot reference variables from the outer scope. Pass everything it needs via `data` or `proxy`.
- **`data` vs `proxy`** — use `data` for values the worker needs fast (tight loops, local access). Use `proxy` when you need to call back into the renderer (progress updates, app API, UI dialogs).
- **Proxy property sets are fire-and-forget** — setting `proxy.something = value` sends the update but does not wait for confirmation. Use callback methods (`await proxy.onProgress(msg)`) when you need to be sure the renderer processed the call.
- **Node.js access** — `require("fs")`, `require("path")`, `require("child_process")`, npm packages, etc. all work inside the worker.
- **Worker lifecycle** — each `app.runAsync` call spawns a fresh worker and terminates it after completion. No state persists between calls.
- **Error handling** — errors thrown inside the worker propagate as rejected promises to the caller.

See the [app.runAsync() API reference](api/app.md#runasyncfn-data-proxy) for full type signatures.

