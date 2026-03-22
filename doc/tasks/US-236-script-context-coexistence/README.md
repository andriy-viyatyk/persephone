# US-236: Script Context Coexistence Issues

**Epic:** EPIC-009 — Scriptable Application Events
**Status:** Planned
**Created:** 2026-03-22

## Goal

Fix script context isolation so multiple ScriptContexts can coexist — long-lived autoload contexts and short-lived F5 script contexts must not interfere with each other.

## Known Problems

### 1. Autoload event handlers break after F5 script run

**What happens:**
- Autoload scripts register event handlers during startup. The autoload `ScriptContext` persists (not disposed) — it holds the `releaseList` for event subscriptions.
- The autoload `ScriptContext` constructor sets `globalThis.__scriptContext__` and defines a lazy `ui` getter on `globalThis`.
- When user runs a script via F5, `ScriptRunner` creates a **new** `ScriptContext` which overwrites `globalThis.__scriptContext__` and redefines the `ui` getter.
- When the F5 script finishes, `ScriptContext.dispose()` clears `globalThis.__scriptContext__ = undefined` and `delete globalThis.ui`.
- **Result:** Autoload event handlers that use `ui` reference undefined values. `ui` getter is gone.

### 2. Lazy require() in event handlers loses script context

**What happens:**
- `clearLibraryRequireCache()` is called on every script execution, clearing all cached library modules.
- If an autoload event handler does a lazy `require("library/some-module")` inside the handler (not during registration), the module is re-loaded with `globalThis.__scriptContext__` which is `undefined`.
- **Result:** The freshly loaded module has `app = undefined`, `page = undefined`, etc.

### 3. Startup performance concern

Autoload registration scripts should be lightweight — just subscribe to events. Heavy modules (graph generators, database clients) should be lazy-loaded inside event handlers, not imported at registration time. But lazy loading is currently broken (problem #2).

## Solution: Per-Instance ScriptContext with Context-Bound Require

### Design Principles

- **ScriptRunnerBase stays a singleton** — pure stateless execution engine (transpile, wrap, execute)
- **ScriptContext is the context owner** — each instance holds `app`, `page`, `ui`, `customRequire`, etc.
- **`fn.call(context)`** — scripts execute with `this = ScriptContext` instance
- **`globalThis.__scriptContext__` is removed** — no shared global slot
- **Each `customRequire` call is always-fresh** — clears the specific module from `require.cache` before loading

### Architecture Overview

```
ScriptRunner (orchestrator, singleton)
  │
  ├── executeWithContextAndFlags(script, page?, consoleLogs?, language?)
  │     ├── new ScriptContext(page, consoleLogs, libraryPath)
  │     │     ├── app = new AppWrapper(releaseList)
  │     │     ├── page = new PageWrapper(...)
  │     │     ├── customRequire = context-bound require
  │     │     ├── console = native or MCP-capturing
  │     │     ├── ui getter on globalThis (stack-based)
  │     │     └── releaseList for cleanup
  │     │
  │     ├── ScriptRunnerBase.execute(script, context, language)
  │     │     ├── prepare() — transpile, register extensions
  │     │     └── executeInternal(script, context)
  │     │           ├── fn = new Function(SCRIPT_PREFIX + wrappedScript)
  │     │           └── fn.call(context)  ← this = ScriptContext
  │     │
  │     └── context.dispose() in finally block
  │
AutoloadRunner (persistent context)
  │
  ├── loadScripts()
  │     ├── new ScriptContext(no page, no consoleLogs, libraryPath)
  │     ├── For each autoload file:
  │     │     context.customRequire(resolvedPath)
  │     │     → module gets context's app, page, require via prefix
  │     │     → mod.register() subscribes to events
  │     └── Context persists (not disposed) — handlers stay alive
  │
  └── dispose() — ScriptContext.dispose() unsubscribes all
```

### How customRequire chain works

Each ScriptContext instance creates a `customRequire` function bound to itself. It's injected as a local `require` variable via the prefix. The chain propagates through the entire module tree:

```
Top-level script (executed via fn.call(context)):
  prefix: var app=this.app, require=this.customRequire, ...
  script calls require("library/B")
    │
    ▼
context.customRequire("library/B")
  → resolves "library/B" to absolute path
  → delete require.cache[resolved]          ← always fresh
  → globalThis.__activeScriptContext__ = this
  → nativeRequire(resolved)
    → Node.js checks extension: ".ts"
    → extension handler fires:
      → reads globalThis.__activeScriptContext__
      → builds prefix: var __ctx=globalThis.__activeScriptContext__,
          app=__ctx.app, require=__ctx.customRequire, ...
      → module._compile(prefix + compiled)
      → clears globalThis.__activeScriptContext__
    → module B code runs:
      → `app` = context's AppWrapper (from prefix) ✓
      → `require` = context's customRequire (from prefix) ✓
      → B calls require("library/C")  ← this is context's customRequire
        → same flow: set __activeScriptContext__, native require,
          extension handler, prefix, clear
        → module C loaded with same context ✓
      → B calls require("./D")  ← relative path, also goes through customRequire
        → same flow ✓
  → globalThis.__activeScriptContext__ = null
```

**Why safe without prev/restore:** `require()` is synchronous. Each `customRequire` call sets `__activeScriptContext__` at start and clears at end. The extension handler always fires while it's set. Each sub-module's `require` is the same `customRequire` (injected via prefix), so it re-sets before every native require call.

**Non-library requires:** `require("fs")`, `require("path")` etc. pass through `customRequire` but don't trigger extension handlers (built-in modules). We still set `__activeScriptContext__` for them in case a non-library `.ts`/`.js` file is required by absolute path.

### How `ui` is solved — Stack-based getter

`ui` stays on `globalThis` as a lazy getter (cannot be in prefix — `var ui=this.ui` would eagerly trigger Log View creation). Each ScriptContext saves the previous `ui` descriptor and restores it on dispose:

```typescript
class ScriptContext {
    private previousUiDescriptor: PropertyDescriptor | undefined;

    constructor() {
        // Save previous (e.g., autoload's getter)
        this.previousUiDescriptor = Object.getOwnPropertyDescriptor(globalThis, "ui");
        // Define this context's lazy ui getter
        Object.defineProperty(globalThis, "ui", {
            get: () => { /* lazy UiFacade creation */ },
            configurable: true, enumerable: false,
        });
    }

    dispose() {
        // Restore previous ui getter
        if (this.previousUiDescriptor) {
            Object.defineProperty(globalThis, "ui", this.previousUiDescriptor);
        } else {
            delete (globalThis as any).ui;
        }
    }
}
```

**Lifecycle:**
1. Autoload defines `ui` getter A on globalThis
2. F5 script starts → saves getter A, defines getter B
3. F5 script finishes → restores getter A
4. Autoload event handler fires → `globalThis.ui` is getter A ✓

### How `console` is solved

`console` is injected via prefix: `console=this.console||console`. Each ScriptContext has a `console` property:
- **Regular scripts (F5):** native `console` (no override)
- **MCP scripts:** capturing console that records to `consoleLogs` array
- **Autoload scripts:** native `console`

Captured as a local var in the module — independent of `globalThis.console`. No conflicts.

### Always-fresh require cache

Each `customRequire()` call deletes the specific module from `require.cache` before calling native `require()`. This ensures every module load gets a fresh compilation with the current context's bindings.

**Why:** `require.cache` is global and shared. If autoload loads module X, and later F5 hits the cache, it gets autoload's context (wrong `page`). If F5 loads X and caches it, autoload later gets F5's disposed context. Always-fresh avoids all staleness.

**Performance:** Re-transpilation on each require. Sucrase is fast (~1ms per module) and require calls happen at script start, not in hot loops.

**Trade-off — no shared state via modules:** Library modules cannot be used as cross-script shared storage:

```typescript
// library/counter.ts
export const state = { counter: 0 };
```

Script A increments `state.counter`, script B requires the same module — gets fresh module with `counter: 0`. This is by design — each script execution starts clean. For shared state, use `page.data` (per-page) or `app.settings` (global).

**Document this limitation** in architecture and user docs.

## Implementation Plan

### Step 1: Add context properties and customRequire to ScriptContext

ScriptContext currently creates a `customContext` plain object. Instead, make ScriptContext itself the context — add properties directly:

```typescript
export class ScriptContext {
    readonly releaseList: Array<() => void> = [];
    readonly outputFlags: ScriptOutputFlags = { ... };

    // Context properties (available via prefix in scripts and modules)
    readonly app: AppWrapper;
    readonly page: PageWrapper | undefined;
    readonly React = React;
    readonly styledText = styledText;
    readonly preventOutput: () => void;
    console: typeof console;
    readonly customRequire: NodeRequire;

    private previousUiDescriptor: PropertyDescriptor | undefined;

    constructor(page?: PageModel, consoleLogs?: ConsoleLogEntry[], libraryPath?: string) {
        this.app = new AppWrapper(this.releaseList);
        this.page = page ? new PageWrapper(page, this.releaseList, this.outputFlags) : undefined;
        this.preventOutput = () => { this.outputFlags.outputPrevented = true; };
        this.console = consoleLogs ? createCapturingConsole(consoleLogs) : console;
        this.customRequire = this.createCustomRequire(libraryPath);

        // Stack-based ui getter
        this.previousUiDescriptor = Object.getOwnPropertyDescriptor(globalThis, "ui");
        Object.defineProperty(globalThis, "ui", { get: () => ..., configurable: true });
    }

    private createCustomRequire(libraryPath?: string): NodeRequire {
        const self = this;
        const req = ((id: string) => {
            let resolvedPath: string;
            if (typeof id === "string" && id.startsWith("library/")) {
                if (!libraryPath) throw new Error("Script library is not linked...");
                resolvedPath = resolveLibraryModule(libraryPath, id.slice("library/".length));
            } else {
                // Non-library: set active context, call native require
                globalThis.__activeScriptContext__ = self;
                try { return nativeRequire(id); }
                finally { globalThis.__activeScriptContext__ = null; }
            }
            // Library module: always-fresh load
            delete require.cache[resolvedPath];
            globalThis.__activeScriptContext__ = self;
            try { return nativeRequire(resolvedPath); }
            finally { globalThis.__activeScriptContext__ = null; }
        }) as NodeRequire;

        req.resolve = nativeRequire.resolve;
        req.cache = nativeRequire.cache;
        req.extensions = nativeRequire.extensions;
        req.main = nativeRequire.main;
        return req;
    }

    dispose() {
        // Restore previous ui getter
        if (this.previousUiDescriptor) {
            Object.defineProperty(globalThis, "ui", this.previousUiDescriptor);
        } else {
            delete (globalThis as any).ui;
        }
        // Release resources
        for (const release of this.releaseList) {
            try { release(); } catch { /* don't block */ }
        }
        this.releaseList.length = 0;
    }
}
```

### Step 2: Update ScriptRunnerBase.executeInternal to use fn.call(context)

ScriptRunnerBase stays a singleton. `execute()` and `executeInternal()` take a context parameter:

```typescript
export class ScriptRunnerBase {
    protected libraryDirty = true;

    protected async execute(script: string, context: ScriptContext, language?: string) {
        const prepared = await this.prepare(script, language);
        return this.executeInternal(prepared, context);
    }

    private async executeInternal(script: string, context: ScriptContext) {
        const SCRIPT_PREFIX =
            "var app=this.app,page=this.page,React=this.React" +
            ",styledText=this.styledText,preventOutput=this.preventOutput" +
            ",require=this.customRequire||require" +
            ",console=this.console||console;\n";

        // ... expression/statement detection (existing logic) ...

        const wrappedScript = `return (async function() {\n${SCRIPT_PREFIX}${script}\n}).call(this);`;
        const fn = new Function(wrappedScript);
        const result = fn.call(context);  // ← this = ScriptContext instance
        return this.isPromiseLike(result) ? await result : result;
    }

    // prepare() stays the same — transpile, register extensions
    // invalidateLibraryCache() stays the same
}
```

### Step 3: Update extension handler

```typescript
// In library-require.ts:

const MODULE_CONTEXT_PREFIX =
    "var __ctx=globalThis.__activeScriptContext__" +
    ",app=__ctx?.app,page=__ctx?.page,React=__ctx?.React" +
    ",styledText=__ctx?.styledText,preventOutput=__ctx?.preventOutput" +
    ",require=__ctx?.customRequire||require" +
    ",console=__ctx?.console||console;\n";

export function registerLibraryExtensions(): void {
    if (extensionsRegistered) return;
    extensionsRegistered = true;

    const originalJsHandler = require.extensions[".js"];

    require.extensions[".ts"] = (module: NodeModule, filename: string) => {
        if (!globalThis.__activeScriptContext__) {
            // No script context — use original handler
            originalJsHandler(module, filename);
            return;
        }

        const code = fs.readFileSync(filename, "utf-8");
        const { code: compiled } = transform(code, {
            transforms: ["typescript", "imports"],
            filePath: filename,
        });
        (module as any)._compile(MODULE_CONTEXT_PREFIX + compiled, filename);
    };

    require.extensions[".js"] = (module: NodeModule, filename: string) => {
        if (globalThis.__activeScriptContext__ && isInsideLibrary(filename)) {
            const code = fs.readFileSync(filename, "utf-8");
            const { code: compiled } = transform(code, {
                transforms: ["imports"],
                filePath: filename,
            });
            (module as any)._compile(MODULE_CONTEXT_PREFIX + compiled, filename);
            return;
        }
        originalJsHandler(module, filename);
    };
}
```

**Key simplification:** The extension handler reads `globalThis.__activeScriptContext__` directly — it's set by `customRequire` before `nativeRequire()` and cleared after. No separate `activeRunner` variable needed. The `globalThis` reference is used in both the handler check AND the prefix string — the prefix reads properties from the same object.

### Step 4: Update ScriptRunner orchestration

```typescript
class ScriptRunner extends ScriptRunnerBase {
    // ... existing run(), runWithResult(), runWithCapture() methods ...

    private async executeWithContextAndFlags(script, page?, consoleLogs?, language?) {
        await editorRegistry.loadViewModelFactory("log-view");

        const libraryPath = settings.get("script-library.path") as string | undefined;
        const context = new ScriptContext(page, consoleLogs, libraryPath);

        try {
            const result = await this.execute(script, context, language);
            return { result, outputFlags: context.outputFlags };
        } catch (error) {
            return { result: error, outputFlags: context.outputFlags, isError: true };
        } finally {
            context.dispose();
        }
    }
}
```

### Step 5: Update AutoloadRunner

```typescript
class AutoloadRunner {
    private scriptContext: ScriptContext | null = null;

    async loadScripts() {
        this.dispose();
        // ...
        this.scriptContext = new ScriptContext(undefined, undefined, libraryPath);

        await ensureSucraseLoaded();
        registerLibraryExtensions();

        for (const file of files) {
            const resolvedPath = fpResolve(fpJoin(autoloadPath, file));
            // Use context's customRequire to load — propagates context through chain
            const mod = this.scriptContext.customRequire(resolvedPath);
            if (typeof mod.register === "function") {
                const result = mod.register();
                if (result && typeof result.then === "function") await result;
            }
        }
    }
}
```

**Note:** AutoloadRunner no longer calls `ScriptRunnerBase.execute()` — it uses `customRequire` directly to load modules. The autoload scripts are modules (they `export function register()`), not top-level scripts. This is simpler and consistent.

### Step 6: Remove clearLibraryRequireCache() from prepare()

Since `customRequire` always clears the specific module from cache, the bulk `clearLibraryRequireCache()` in `prepare()` is no longer needed for context freshness. Keep it only when `libraryDirty` is set by file watcher (actual file changes).

### Step 7: Remove globalThis.__scriptContext__

- Delete all references from ScriptContext, library-require, window.d.ts
- Remove old `CONTEXT_PREFIX` export from library-require.ts
- Add `__activeScriptContext__` type to window.d.ts

### Step 8: Cleanup

- Remove `createLibraryRequire()` and `createUnlinkedLibraryRequire()` from library-require.ts — replaced by ScriptContext.customRequire
- Remove `CONTEXT_PREFIX` export — replaced by `SCRIPT_PREFIX` (inline in ScriptRunnerBase) and `MODULE_CONTEXT_PREFIX` (in library-require)
- Update `resolveLibraryModule` to be exported (used by ScriptContext.customRequire)

## Files Changed Summary

| File | Action | What |
|------|--------|------|
| `src/renderer/scripting/ScriptContext.ts` | Major refactor | Context properties, customRequire, stack-based ui, remove __scriptContext__ |
| `src/renderer/scripting/ScriptRunnerBase.ts` | Refactor | execute/executeInternal take context param, fn.call(context), remove CONTEXT_PREFIX import |
| `src/renderer/scripting/ScriptRunner.ts` | Update | Pass context to execute(), minor wiring changes |
| `src/renderer/scripting/library-require.ts` | Refactor | MODULE_CONTEXT_PREFIX reads __activeScriptContext__, remove old CONTEXT_PREFIX/createLibraryRequire |
| `src/renderer/scripting/AutoloadRunner.ts` | Simplify | Use context.customRequire() to load modules directly |
| `src/renderer/types/window.d.ts` | Update | Remove __scriptContext__, add __activeScriptContext__ |

## Documentation

Update `doc/architecture/scripting.md` with the new context isolation architecture:
- How per-instance ScriptContext works (owns app, page, customRequire, console)
- ScriptRunnerBase stays a stateless singleton engine
- The two injection mechanisms: `fn.call(context)` for scripts, `__activeScriptContext__` for modules
- The `customRequire` → `__activeScriptContext__` → extension handler chain
- Why `globalThis.__scriptContext__` was removed
- How multiple contexts coexist (autoload long-lived vs F5 short-lived)
- The stack-based `ui` getter model
- Always-fresh require cache design and its trade-off (no shared state via modules)
- Design decisions: why this approach was chosen over AsyncLocalStorage, vm module, worker threads, and stack-based alternatives

## Acceptance Criteria

- [ ] Autoload event handlers work after F5 script run (`ui`, `app` both functional)
- [ ] Lazy `require()` inside event handlers loads modules with correct context
- [ ] Multiple F5 script runs don't break autoload handlers
- [ ] MCP script execution doesn't break autoload handlers
- [ ] Regular script execution (F5) works as before
- [ ] Library module imports work (require chain propagates context)
- [ ] `ui` lazy initialization works (Log View created on first access)
- [ ] Console capture works for MCP scripts
- [ ] TypeScript compiles clean
- [ ] Existing test scripts work: `5+5`, library module imports, autoload registration
- [ ] Library modules cannot share state across script runs (by design — documented)
