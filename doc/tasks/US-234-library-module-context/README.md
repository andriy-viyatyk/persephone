# US-234: Fix Script Context Availability in Library Modules

**Epic:** EPIC-009 — Scriptable Application Events
**Status:** Planned
**Created:** 2026-03-22
**Depends on:** US-232 (ScriptContext class)

## Goal

Make `app`, `page`, `ui`, and other script globals available inside library modules loaded via `require("library/...")`. Currently, only the top-level script has access to the ScriptContext — imported modules get `ReferenceError: app is not defined`.

## Background

### The problem

When a script calls `require("library/utils/helpers")`, Node.js loads the module via `module._compile()` which wraps the code in its own function scope:

```javascript
// Node.js internal wrapping:
(function(exports, require, module, __filename, __dirname) {
    // module code — app, page, ui are NOT in scope
});
```

Our ScriptContext (`with(this) { ... }`) only applies to the top-level script. Library modules don't inherit it.

### Confirmed bug

```typescript
// library/utils/helpers.ts
export function myInfo(msg: string) {
    app.ui.notify(msg);  // ← ReferenceError: app is not defined
}

// top-level script
const helper = require("library/utils/helpers");
helper.myInfo("test");  // ← crashes
```

### Expected behavior

All code in a script execution chain — top script and all `require()`-d library modules — should share the same script context globals (`app`, `page`, `ui`, `styledText`, `React`, etc.).

## Implementation Plan

### Approach: Inject globals via `_compile` prefix

The `.ts` and `.js` extension handlers in `library-require.ts` have full control over what code is compiled. We prepend variable declarations that read from a temporary global:

```typescript
// Before script execution:
globalThis.__scriptContext__ = { app: appWrapper, page: pageWrapper, ui: ..., ... };

// Extension handler prepends to every library module:
const app = globalThis.__scriptContext__?.app;
const page = globalThis.__scriptContext__?.page;
// ... etc

// After script execution:
globalThis.__scriptContext__ = undefined;
```

### Step 1: Define the script context globals interface

Create a list of globals that should be injected. These match what ScriptContext puts in its `customContext`:

- `app` — AppWrapper
- `page` — PageWrapper (or undefined)
- `ui` — UiFacade (lazy — but for library modules, the simple reference is enough)
- `React` — React library
- `styledText` — styled text builder

Note: `require` is already available in modules (Node.js provides it). `preventOutput` is script-level, not typically needed in library modules.

### Step 2: Set/clear `globalThis.__scriptContext__` in ScriptContext

In `ScriptContext` class, expose a method or set the global in constructor/dispose:

```typescript
class ScriptContext {
    constructor(...) {
        // ... existing setup ...

        // Make context globals available to library modules
        globalThis.__scriptContext__ = this.customContext;
    }

    dispose() {
        globalThis.__scriptContext__ = undefined;
        // ... existing cleanup ...
    }
}
```

**Concern:** If two scripts run concurrently (unlikely but possible with async), the global would be overwritten. Since JavaScript is single-threaded and we `await` execution, this is safe for synchronous code. For async: event handlers in library modules capture the local `const app` from the prefix — so even after `__scriptContext__` is cleared, the captured reference remains valid.

**Alternative:** Set/clear in `ScriptRunnerBase.execute()` instead of the constructor — more precise scoping. But constructor is simpler and covers the entire lifetime.

### Step 3: Modify extension handlers to inject globals

In `library-require.ts`, modify the `.ts` and `.js` handlers:

```typescript
function getContextPrefix(): string {
    return `
const app = globalThis.__scriptContext__?.app;
const page = globalThis.__scriptContext__?.page;
const React = globalThis.__scriptContext__?.React;
const styledText = globalThis.__scriptContext__?.styledText;
`;
}

require.extensions[".ts"] = (module: NodeModule, filename: string) => {
    const code = fs.readFileSync(filename, "utf-8");
    const { code: compiled } = transform(code, {
        transforms: ["typescript", "imports"],
        filePath: filename,
    });
    (module as any)._compile(getContextPrefix() + compiled, filename);
};
```

The prefix uses optional chaining (`?.`) so modules loaded outside script execution (if any) get `undefined` instead of crashing.

### Step 4: Add type declaration for `__scriptContext__`

In `src/renderer/types/` or inline, declare the global:

```typescript
declare global {
    var __scriptContext__: Record<string, any> | undefined;
}
```

### Step 5: Handle `ui` lazy getter

`ui` is a lazy getter in ScriptContext — the UiFacade is created on first access. In the prefix, we inject `const ui = globalThis.__scriptContext__?.ui;`. Since `customContext.ui` is defined via `Object.defineProperty` with a getter, reading `__scriptContext__.ui` triggers the lazy creation. But this only happens if the library module actually uses `ui`.

**Concern:** If the module stores `const ui = globalThis.__scriptContext__?.ui` but doesn't use it immediately, the getter IS triggered at module load time. This creates the UiFacade (and Log View page) even if the module never calls `ui.log()`.

**Fix:** Don't inject `ui` directly. Instead, make it a getter on the prefix object, or let library modules access `app.ui` instead (which is always available). Actually — `ui` in the script context is the `UiFacade` (log-view based), not `app.ui` (notification-based). They're different objects.

**Simplest fix:** Inject `ui` as a lazy getter too:

```javascript
let __ui__;
Object.defineProperty(this, 'ui', { get: () => __ui__ ?? (__ui__ = globalThis.__scriptContext__?.ui) });
```

**Actually simpler:** Don't inject `ui` at all in the prefix. Library modules that need `ui` logging should receive it as a parameter or use `app.ui.notify()`. The `ui` global is a script-level concern (creates a grouped Log View page), not a library module concern.

**Decision:** Inject `app`, `page`, `React`, `styledText` only. Not `ui`. If needed later, can add.

## Files Changed Summary

| File | Action | What |
|------|--------|------|
| `src/renderer/scripting/library-require.ts` | Modify | Add context prefix to `.ts` and `.js` handlers |
| `src/renderer/scripting/ScriptContext.ts` | Modify | Set/clear `globalThis.__scriptContext__` |
| `src/renderer/types/window.d.ts` (or new file) | Modify | Declare `__scriptContext__` global |

## Concerns

### 1. Require cache and context prefix

Library modules are cached by Node.js `require.cache`. The prefix code runs ONLY on first load (when the module is compiled). On subsequent `require()` calls, the cached module is returned — the prefix doesn't re-run.

**This is fine** because the prefix captures `globalThis.__scriptContext__?.app` at module load time. If the module is cached and reused across script executions, the captured `app` reference points to the AppWrapper from the FIRST execution — not the current one.

**Fix:** We already clear library cache when `libraryDirty` is true (`clearLibraryRequireCache()`). For correct context injection, we should clear cache before EVERY script execution, not just when files change.

**Alternative:** Only clear cache for library modules that use context globals. Too complex.

**Recommended:** Clear library require cache at the start of every `ScriptRunnerBase.prepare()`. This ensures modules always get fresh context. Performance impact is minimal — sucrase transpilation is fast, and library modules are typically small.

### 2. Source map offset

Prepending lines shifts line numbers in error stack traces. Errors in library modules will show line numbers offset by the number of prefix lines (4-5 lines). This makes debugging slightly harder.

**Mitigation:** Keep prefix minimal (fewest lines possible). Could use a single-line prefix:
```javascript
const app=globalThis.__scriptContext__?.app,page=globalThis.__scriptContext__?.page,React=globalThis.__scriptContext__?.React,styledText=globalThis.__scriptContext__?.styledText;
```

One line = 1 line offset in stack traces. Acceptable.

### 3. Non-library modules

The `.js` handler only applies to files inside the library folder (line 44 check). Non-library `.js` modules (node_modules, etc.) are NOT affected. The `.ts` handler applies globally but `.ts` files outside the library folder won't have `__scriptContext__` set — they get `undefined`, which is harmless.

## Acceptance Criteria

- [ ] `app` is available inside library modules loaded via `require("library/...")`
- [ ] `page` is available (or `undefined` if script has no page)
- [ ] `React` and `styledText` are available
- [ ] `app.events.subscribe()` in library modules is tracked by releaseList (events proxy works)
- [ ] Library modules work correctly on first load and subsequent cached loads
- [ ] Non-library modules are not affected
- [ ] TypeScript compiles clean
- [ ] No user-facing script API changes
