# US-233: Script Autoloading from Script Library

**Epic:** EPIC-009 — Scriptable Application Events
**Status:** Planned
**Created:** 2026-03-22
**Depends on:** US-229 (EventChannel), US-231 (app.events), US-232 (ScriptContext class + events proxy)

## Goal

Load and execute registration scripts from a designated `autoload/` subfolder in the Script Library when the js-notepad window opens. These scripts subscribe to application events via `app.events` and persist for the window session. Users can reload all autoload scripts manually when library files change.

## Background

### What's in place

- **ScriptContext class** (US-232) — creates execution scope with `releaseList`, `dispose()` cleans up ViewModels and event subscriptions
- **AppWrapper.events proxy** (US-232) — auto-tracks `subscribe()` calls in `releaseList`
- **EventChannel system** (US-229) — `app.events.fileExplorer.itemContextMenu` is the first real channel
- **ScriptRunnerBase.execute()** — handles transpilation, library registration, execution
- **LibraryService** — watches Script Library folder, invalidates require cache on changes
- **Bootstrap pattern** — MCP auto-start uses `setTimeout(() => { ... }, 1500)` in `app.initEvents()` to defer after rendering

### Script Library folder convention

```
script-library/
├── script-panel/     ← Scripts shown in script panel UI (by language)
├── autoload/         ← NEW: Registration scripts loaded on window open
│   ├── 01-youtube-bookmarks.ts
│   ├── 02-package-json-menu.ts
│   └── helper-utils.ts          ← Not loaded (no default export)
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

### Step 1: Create AutoloadService

Create `src/renderer/api/autoload-service.ts`:

```typescript
class AutoloadService {
    private scriptContext: ScriptContext | null = null;
    private loaded = false;

    /** Load all autoload scripts. Disposes previous context if any. */
    async loadScripts(): Promise<void> { ... }

    /** Dispose current context (unsubscribe all events). */
    dispose(): void { ... }

    /** Whether autoload scripts are currently loaded. */
    get isLoaded(): boolean { ... }
}

export const autoloadService = new AutoloadService();
```

Key responsibilities:
- Scan `autoload/` subfolder for `.ts`/`.js` files
- Create ONE `ScriptContext` (shared across all registration scripts)
- For each script: transpile, execute, check for default export, call `register()`
- On error: dispose context (unsubscribe everything), show notification, stop
- Store `ScriptContext` instance for later disposal (reload)

### Step 2: Implement script loading logic

```typescript
async loadScripts(): Promise<void> {
    // Dispose previous context
    this.dispose();

    const libraryPath = settings.get("script-library.path") as string | undefined;
    if (!libraryPath) return;

    const autoloadPath = fpJoin(libraryPath, "autoload");
    if (!fs.existsSync(autoloadPath)) return;

    // Scan for .ts/.js files, sort alphabetically
    const files = fs.readdirSync(autoloadPath)
        .filter(f => f.endsWith(".ts") || f.endsWith(".js"))
        .sort();

    if (files.length === 0) return;

    // Create shared ScriptContext (no page, no consoleLogs)
    this.scriptContext = new ScriptContext(undefined, undefined, libraryPath);

    try {
        for (const file of files) {
            const filePath = fpJoin(autoloadPath, file);
            const script = fs.readFileSync(filePath, "utf-8");

            // Execute script to get module exports
            const result = await scriptRunnerBase.execute(script, this.scriptContext.context, getLanguage(file));

            // Check if script exports a named register function
            if (moduleObj.exports.register && typeof moduleObj.exports.register === "function") {
                await moduleObj.exports.register();
            }
            // Skip files without register export (utility modules)
        }
        this.loaded = true;
    } catch (error) {
        // All-or-nothing: dispose everything on error
        this.dispose();
        ui.notify(`Autoload script failed: ${error.message}`, "error");
    }
}
```

### Concern: Module exports pattern

The current `ScriptRunnerBase.execute()` wraps scripts in `with(this) { return (async function() { ... }).call(this); }`. This means `export default function register()` won't work directly — `export` is ES module syntax, not valid inside a function body.

**Options:**

**Option A: Transpile exports to CommonJS**
Sucrase already transpiles TypeScript. If we add `"imports"` transform (which is already used for library modules in `library-require.ts`), `export default function register()` becomes `exports.default = function register()`. The script result would be `undefined` but `exports` would be populated.

However, the current execution model wraps scripts in `with(this) { ... }` — there's no `module.exports` or `exports` object in the script context.

**Option B: Inject `module` and `exports` into context**
Before executing an autoload script, inject `module = { exports: {} }` and `exports = module.exports` into the ScriptContext's custom context. After execution, read `module.exports.default`.

**Option C: Convention-based — script returns the register function**
Instead of `export function register()`, scripts simply define and return it:
```typescript
// autoload/01-youtube-bookmarks.ts
function register() {
    app.events.browser.onBookmark.subscribe((event) => { ... });
}
register  // implicit return (last expression)
```
But this means the register function runs during evaluation, not as a separate step. This breaks the all-or-nothing error model.

**Option D: Use require() to load autoload scripts**
Instead of executing scripts via `ScriptRunnerBase.execute()`, use `require()` to load them as Node.js modules. This naturally supports `module.exports` and `export default`. Since `registerLibraryExtensions()` already handles `.ts` transpilation for require, this would work.

```typescript
const modulePath = fpJoin(autoloadPath, file);
clearRequireCache(modulePath); // ensure fresh load
const mod = require(modulePath);
if (typeof mod.register === "function") {
    await mod.register();
}
```

**Problem with Option D:** `require()` doesn't use our ScriptContext proxy — the script would access the real `app` object directly, not the wrapped `AppWrapper` with events proxy. Subscriptions wouldn't be tracked in the `releaseList`.

**Option E: Hybrid — require for module loading, inject context globals**
Use `require()` to load the module but set up global variables (`app`, `page`, etc.) pointing to the wrapped objects before requiring. Since we're in Electron with `nodeIntegration: true`, globals are shared.

**Problem:** Global mutation affects all code, not just the autoload script.

**Recommended: Option B** — Inject `module` and `exports` into ScriptContext. This is the cleanest:
- Script authors use familiar `export` syntax
- Module system works within the sandboxed context
- Events proxy tracks subscriptions
- No global mutation

Implementation: In `ScriptContext` or in the autoload service, before executing each script:
```typescript
const moduleObj = { exports: {} as any };
scriptContext.context.module = moduleObj;
scriptContext.context.exports = moduleObj.exports;

await scriptRunnerBase.execute(script, scriptContext.context, language);

const registerFn = moduleObj.exports.register;
if (typeof registerFn === "function") {
    await registerFn();
}
```

Note: Need to ensure sucrase's `"imports"` transform is applied to autoload scripts (it transpiles `export function register` → `exports.register =`).

### Step 3: Integrate into bootstrap

In `app.initEvents()`, after MCP auto-start:

```typescript
// Defer autoload scripts to not block window rendering
setTimeout(async () => {
    try {
        await autoloadService.loadScripts();
    } catch (error) {
        console.error("Autoload scripts failed:", error);
    }
}, 1500);
```

### Step 4: Reload indicator and manual reload

When LibraryService detects file changes in the library:
- If autoload scripts are currently loaded, show a reload indicator
- User can trigger reload via a UI element (e.g., button in Script Library panel, or notification action)

**Simplest approach for v1:** Add a notification when library files change and autoload is active:
```typescript
ui.notify("Script Library changed. Reload autoload scripts?", "info");
```

Or add a small reload button/indicator in the sidebar Script Library panel.

**For this task:** Implement the reload mechanism (`autoloadService.loadScripts()` disposes old context and creates new one). The UI indicator can be a follow-up task.

### Step 5: Setting to enable/disable (optional)

Could add `"autoload.enabled"` setting, but since autoload only runs if the `autoload/` folder exists with scripts, it's self-gating. If user doesn't want autoload, they don't create the folder.

**Decision: No setting needed.** The folder existence is the toggle.

## Concerns

### 1. Transpilation of `export` syntax (CRITICAL — resolved above)

Need to ensure autoload scripts are transpiled with `"imports"` transform so `export function register()` becomes `exports.register = ...`. This requires either:
- Modifying `transpileIfNeeded()` to always include `"imports"` transform for autoload scripts
- Or passing a flag/option to control transforms

Currently `transpileIfNeeded()` only adds `"typescript"` transform. The `"imports"` transform is only applied in `library-require.ts` for `require()`-d modules.

### 2. ScriptContext without page

AutoloadService creates `ScriptContext(undefined, undefined, libraryPath)` — no page. This means:
- `page` global is `undefined` in registration scripts ← correct, registration scripts don't operate on pages
- `ui` lazy getter works (creates standalone Log View) ← useful for debugging
- `require("library/...")` works ← needed for importing shared modules

### 3. Shared vs per-script ScriptContext

**Design decision from epic:** One shared ScriptContext for all autoload scripts. All subscriptions go into the same `releaseList`. On reload, dispose everything at once.

This means:
- If script B fails during registration, script A's subscriptions (already registered) are also unsubscribed
- This is the "all-or-nothing" model from the epic design decisions
- Simple and predictable

### 4. Script execution order

Alphabetical by filename. Users can prefix with `01-`, `02-` to control order. This is documented in the epic.

### 5. Async register functions

The `register()` function may need to be async (e.g., to fetch data, read files). We `await` it:
```typescript
if (typeof registerFn === "function") {
    const result = registerFn();
    if (result && typeof result.then === "function") {
        await result;
    }
}
```

### 6. Library require cache and autoload

When autoload scripts use `require("library/utils")`, the required modules are cached in Node's require cache. On reload, we need to clear the cache for library modules. `scriptRunner.invalidateLibraryCache()` + `clearLibraryRequireCache()` handles this.

But autoload scripts themselves are loaded via `ScriptRunnerBase.execute()`, not `require()` — so they're not in the require cache. Only their `require()`-d dependencies are cached.

### 7. When does autoload run relative to other initialization?

After `initEvents()` with setTimeout deferral. This means:
- All app services are initialized (settings, fs, pages, etc.)
- EventChannels exist and are wired (file explorer context menu works)
- Window is rendering (or about to render)
- MCP may or may not be started yet (also deferred)

This is fine — autoload scripts subscribe to events, they don't need to run immediately.

## Files Changed Summary

| File | Action | What |
|------|--------|------|
| `src/renderer/api/autoload-service.ts` | **Create** | AutoloadService class |
| `src/renderer/api/app.ts` | Modify | Add autoload initialization in `initEvents()` |
| `src/renderer/scripting/ScriptRunnerBase.ts` | Possibly modify | Expose `execute()` as public for autoload, or make autoload use its own execution |
| `src/renderer/scripting/transpile.ts` | Possibly modify | Add option for `"imports"` transform |
| `src/renderer/scripting/ScriptContext.ts` | Possibly modify | Support `module`/`exports` injection |

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
