# US-233: Script Autoloading from Script Library

**Epic:** EPIC-009 — Scriptable Application Events
**Status:** Planned
**Created:** 2026-03-22
**Depends on:** US-229 (EventChannel), US-231 (app.events), US-232 (ScriptContext class + events proxy), US-234 (library module context), US-235 (unified context injection)

## Goal

Load and execute registration scripts from a designated `autoload/` subfolder in the Script Library when the js-notepad window opens. These scripts subscribe to application events via `app.events` and persist for the window session. Users can reload all autoload scripts manually when library files change.

## Background

### What's in place

- **ScriptContext class** (US-232) — creates execution scope with `releaseList`, `dispose()` cleans up ViewModels and event subscriptions
- **AppWrapper.events proxy** (US-232) — auto-tracks `subscribe()` calls in `releaseList`
- **Unified CONTEXT_PREFIX** (US-234, US-235) — `globalThis.__scriptContext__` is set by ScriptContext constructor, CONTEXT_PREFIX injects `app`, `page`, `React`, `styledText`, `preventOutput`, `require`, `console` as local variables in both top-level scripts and library modules
- **EventChannel system** (US-229) — `app.events.fileExplorer.itemContextMenu` is the first real channel
- **ScriptRunnerBase.execute()** — handles transpilation, library registration, execution (no context param — reads from `globalThis.__scriptContext__`)
- **LibraryService** — watches Script Library folder, invalidates require cache on changes
- **Bootstrap pattern** — MCP auto-start uses `setTimeout(() => { ... }, 1500)` in `app.initEvents()` to defer after rendering

### Script Library folder convention

```
script-library/
├── script-panel/     ← Scripts shown in script panel UI (by language)
├── autoload/         ← NEW: Registration scripts loaded on window open
│   ├── 01-youtube-bookmarks.ts
│   ├── 02-package-json-menu.ts
│   └── helper-utils.ts          ← Not loaded (no register export)
└── utils/            ← Shared library code (imported via require)
```

### Registration script convention

```typescript
// autoload/01-youtube-bookmarks.ts
export function register() {
    app.events.browser.onBookmark.subscribe((event) => {
        // Fix YouTube thumbnail URL
    });
}

// Can also export utilities for other scripts to import
export function fixYoutubeUrl(url: string) { ... }
```

Scripts must export a named `register` function. Files without it are skipped (they may be utility modules imported by registration scripts). Named export is preferred over default export — a module can export both `register` and utility functions that other scripts import.

## Implementation Plan

### Step 1: Create AutoloadRunner in scripting/

Create `src/renderer/scripting/AutoloadRunner.ts` — the main class with all loading logic:

```typescript
class AutoloadRunner {
    private scriptContext: ScriptContext | null = null;
    private loaded = false;

    /** Load all autoload scripts. Disposes previous context if any. */
    async loadScripts(): Promise<void> { ... }

    /** Dispose current context (unsubscribe all events). */
    dispose(): void { ... }

    /** Whether autoload scripts are currently loaded. */
    get isLoaded(): boolean { ... }
}

export const autoloadRunner = new AutoloadRunner();
```

Key responsibilities:
- Scan `autoload/` subfolder for `.ts`/`.js` files
- Create ONE `ScriptContext` (shared across all registration scripts) — no page, no consoleLogs
- Build a meta-script that uses `require()` to load each file and call `register()` if found
- On error: dispose context (unsubscribe everything), show notification, stop
- Store `ScriptContext` instance for later disposal (reload)

### Step 2: Implement script loading logic

Use `require()` to load autoload scripts (same as library modules). This works because:
- `registerLibraryExtensions()` handles `.ts` transpilation with `"imports"` transform (converts `export function register` → `exports.register =`)
- CONTEXT_PREFIX is injected by the extension handler — `app`, `page`, etc. are available in the module
- `globalThis.__scriptContext__` is set by `ScriptContext` constructor before execution

```typescript
async loadScripts(): Promise<void> {
    // Dispose previous context
    this.dispose();

    const libraryPath = settings.get("script-library.path") as string | undefined;
    if (!libraryPath) return;

    const autoloadPath = fpJoin(libraryPath, "autoload");
    if (!app.fs.existsSync(autoloadPath)) return;

    // Scan for .ts/.js files, sort alphabetically
    const files = app.fs.readdirSync(autoloadPath)
        .filter(f => f.endsWith(".ts") || f.endsWith(".js"))
        .sort();

    if (files.length === 0) return;

    // Create shared ScriptContext (no page, no consoleLogs)
    this.scriptContext = new ScriptContext(undefined, undefined, libraryPath);

    // Ensure sucrase is loaded and library extensions registered
    await ensureSucraseLoaded();
    registerLibraryExtensions(libraryPath);
    clearLibraryRequireCache(libraryPath);

    try {
        for (const file of files) {
            const filePath = fpJoin(autoloadPath, file);
            // Clear specific module from cache to ensure fresh load
            delete require.cache[require.resolve(filePath)];
            const mod = require(filePath);

            if (typeof mod.register === "function") {
                const result = mod.register();
                // Await if async
                if (result && typeof result.then === "function") {
                    await result;
                }
            }
            // Files without register export are silently skipped (utility modules)
        }
        this.loaded = true;
    } catch (error) {
        // All-or-nothing: dispose everything on error
        this.dispose();
        app.ui.notify(`Autoload script failed: ${(error as Error).message}`, "error");
    }
}
```

**Why `require()` works here:** Since US-234/US-235, `ScriptContext` sets `globalThis.__scriptContext__` in its constructor. The extension handlers in `library-require.ts` prepend `CONTEXT_PREFIX` to every `.ts`/`.js` file loaded via `require()`. So `app` inside the autoload module is the `AppWrapper` from `ScriptContext`, and `subscribe()` calls are tracked in the `releaseList`.

### Step 3: Create thin wrapper in api/

Create `src/renderer/api/autoload-service.ts` — lightweight service that bridges `AutoloadRunner` into the window lifecycle:

```typescript
import { autoloadRunner } from "../scripting/AutoloadRunner";

export const autoloadService = {
    loadScripts: () => autoloadRunner.loadScripts(),
    dispose: () => autoloadRunner.dispose(),
    get isLoaded() { return autoloadRunner.isLoaded; },
};
```

### Step 4: Integrate into bootstrap

In `app.initEvents()` (`src/renderer/api/app.ts`), after MCP auto-start:

```typescript
// Defer autoload scripts to not block window rendering
setTimeout(async () => {
    try {
        const { autoloadService } = await import("./autoload-service");
        await autoloadService.loadScripts();
    } catch (error) {
        console.error("Autoload scripts failed:", error);
    }
}, 1500);
```

### Step 5: Reload on library changes

When LibraryService detects file changes in the library and autoload is active:
- Show a notification: "Script Library changed. Click to reload autoload scripts."
- On click: call `autoloadService.loadScripts()` (disposes old, loads fresh)

**For this task:** Implement the reload mechanism. The UI indicator can be a simple notification with action.

## Concerns

### 1. ScriptContext without page

AutoloadRunner creates `ScriptContext(undefined, undefined, libraryPath)` — no page. This means:
- `page` global is `undefined` in registration scripts ← correct, registration scripts don't operate on pages
- `ui` lazy getter works (creates standalone Log View) ← useful for debugging
- `require("library/...")` works ← needed for importing shared modules

### 2. Shared vs per-script ScriptContext

**Design decision from epic:** One shared ScriptContext for all autoload scripts. All subscriptions go into the same `releaseList`. On reload, dispose everything at once.

This means:
- If script B fails during registration, script A's subscriptions (already registered) are also unsubscribed
- This is the "all-or-nothing" model from the epic design decisions
- Simple and predictable

### 3. Script execution order

Alphabetical by filename. Users can prefix with `01-`, `02-` to control order.

### 4. Async register functions

The `register()` function may need to be async (e.g., to fetch data, read files). We `await` it if the result is thenable.

### 5. Library require cache and autoload

When autoload scripts use `require("library/utils")`, the required modules are cached in Node's require cache. On reload, we clear the cache for all library modules via `clearLibraryRequireCache()`.

### 6. When does autoload run relative to other initialization?

After `initEvents()` with setTimeout deferral. This means:
- All app services are initialized (settings, fs, pages, etc.)
- EventChannels exist and are wired (file explorer context menu works)
- Window is rendering
- MCP may or may not be started yet (also deferred)

This is fine — autoload scripts subscribe to events, they don't need to run immediately.

### 7. require.resolve may throw for .ts files

`require.resolve(filePath)` might fail for `.ts` files if Node doesn't recognize the extension. We should use `try/catch` or just delete by path string from `require.cache`.

## Files Changed Summary

| File | Action | What |
|------|--------|------|
| `src/renderer/scripting/AutoloadRunner.ts` | **Create** | AutoloadRunner class with loadScripts(), dispose(), isLoaded |
| `src/renderer/api/autoload-service.ts` | **Create** | Thin wrapper to bridge into window lifecycle |
| `src/renderer/api/app.ts` | Modify | Add autoload initialization in `initEvents()` |
| `doc/tasks/active.md` | Modify | Update task status |

## Acceptance Criteria

- [ ] `autoload/` subfolder in Script Library is scanned on window open
- [ ] `.ts` and `.js` files loaded alphabetically
- [ ] Scripts with `export function register()` have their register function called
- [ ] Scripts without `register` export are skipped silently (utility modules)
- [ ] Event subscriptions made in register() persist for the window session
- [ ] On error during any register(): all subscriptions unsubscribed, error notification shown
- [ ] `autoloadService.loadScripts()` can be called again to reload (disposes old, loads fresh)
- [ ] Autoload scripts can use `require("library/...")` to import shared modules
- [ ] Autoload scripts can use `app.events` with IntelliSense
- [ ] No autoload if Script Library path not configured or `autoload/` folder doesn't exist
- [ ] TypeScript compiles clean
- [ ] Window rendering not blocked by autoload
