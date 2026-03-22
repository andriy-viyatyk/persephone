# US-235: Unified Script Context Injection — Remove `with(this)` and `lexicalObjects`

**Epic:** EPIC-009 — Scriptable Application Events
**Status:** Planned
**Created:** 2026-03-22
**Depends on:** US-234 (library module context fix)

## Goal

Replace the `with(this)` + `lexicalObjects` execution model with the same prefix-based context injection used for library modules. One unified mechanism for both top-level scripts and sub-modules. Removes ~55 lines of `lexicalObjects` declarations and simplifies the execution engine.

## Background

### Current state (two different mechanisms)

**Top-level scripts** use `with(this)` proxy + `lexicalObjects`:
```javascript
with (this) {
    return (async function() {
        const Array = globalThis.Array;  // 50+ lines of lexicalObjects
        const JSON = globalThis.JSON;
        // ...
        return (userScript);
    }).call(this);
}
```

**Library sub-modules** (US-234) use prefix injection:
```javascript
var app=globalThis.__scriptContext__?.app,page=globalThis.__scriptContext__?.page,...;
// module code — normal scope, globals work naturally
```

### Why `with(this)` exists

The `with` statement makes `app`, `page`, `ui` available as bare names in scripts. The proxy intercepts variable lookups and returns the script context objects.

### Why `lexicalObjects` exists

The `with` proxy breaks native constructors. When code inside `with(this)` accesses `Array`, the proxy intercepts it and returns `globalThis.Array` — but the returned value loses its original binding context. `Array.from()` fails because `from` is a static method that relies on `Array` being the real constructor. The `lexicalObjects` workaround re-declares all native globals as lexical `const` variables, shadowing the proxy.

### Why we can remove both

US-234 introduced `globalThis.__scriptContext__` and a prefix that injects `app`, `page`, etc. as local variables. This works without `with` and without `lexicalObjects`. Since sub-modules already use this mechanism, the top-level script can use it too — making the two consistent.

## Implementation Plan

### Step 1: Define the full context prefix in one place

Move the prefix from `library-require.ts` to a shared location (e.g., `library-require.ts` itself or a new shared constant). Expand it to include ALL script context globals:

```typescript
// In library-require.ts (or a shared module):
export const CONTEXT_PREFIX =
    "var app=globalThis.__scriptContext__?.app" +
    ",page=globalThis.__scriptContext__?.page" +
    ",ui=globalThis.__scriptContext__?.ui" +
    ",React=globalThis.__scriptContext__?.React" +
    ",styledText=globalThis.__scriptContext__?.styledText" +
    ",preventOutput=globalThis.__scriptContext__?.preventOutput" +
    ",require=globalThis.__scriptContext__?.require||require" +
    ",console=globalThis.__scriptContext__?.console||console" +
    ";\n";
```

Notes:
- `require` falls back to native `require` if no script context (for safety)
- `console` falls back to native `console` if no script context
- `ui` is included — it's a lazy getter on `customContext`, so reading it from `__scriptContext__` will trigger creation only when the variable is actually used in code (JavaScript doesn't evaluate `var` initializers eagerly for destructured... actually `var ui=globalThis.__scriptContext__?.ui` DOES evaluate immediately)

**`ui` concern:** The `var ui=...` in the prefix evaluates `globalThis.__scriptContext__?.ui` at module load time. If `ui` is a getter on `customContext`, this triggers the lazy creation of UiFacade (and Log View page) even if the module never uses `ui`.

**Fix:** Don't inject `ui` in the prefix. Scripts that need `ui` access it through the global `__scriptContext__` or we make it a getter:

Actually, the simplest fix: in the prefix, use `Object.defineProperty` for `ui` to preserve laziness. But that's complex for a one-liner.

**Alternative:** Accept that `ui` creates eagerly if imported. Most scripts don't use `ui` in sub-modules. For the top-level script, `ui` was already lazy via the proxy getter.

**Recommended:** Don't inject `ui` in the prefix for now. The top-level script accesses `ui` via the `__scriptContext__` getter naturally (since it's defined on `customContext` with `Object.defineProperty`). Wait — no, without `with(this)`, the top-level script also needs `ui` as a local variable.

**Better approach:** Make the prefix handle `ui` lazily:
```javascript
var __ctx=globalThis.__scriptContext__;
var app=__ctx?.app,page=__ctx?.page,React=__ctx?.React,...;
var ui; Object.defineProperty(this,'__ui_getter',{get:()=>ui||(ui=__ctx?.ui)});
```

This is getting complex. **Simplest approach:** Just inject `ui` directly. If the script doesn't use `ui`, the Log View page is created but harmless. If this becomes a problem, we optimize later.

Actually — re-reading ScriptContext.ts, `ui` is defined as a property getter on `customContext` (line 73: `Object.defineProperty(customContext, "ui", { get: () => { ... } })`). When we do `globalThis.__scriptContext__ = customContext`, reading `__scriptContext__.ui` triggers the getter.

But `var ui = globalThis.__scriptContext__?.ui` — the `?.` means if `__scriptContext__` is undefined, `ui` is undefined. If it exists, it reads the property — triggering the getter. This happens at the moment the `var` declaration initializes.

**For the top-level script prefix:** `__scriptContext__` is always set (ScriptContext constructor sets it). So `ui` getter IS triggered.

**For sub-module prefix:** Same — `__scriptContext__` is set during script execution.

**Decision:** Skip `ui` from the prefix. Keep it as something scripts explicitly access. Most utility modules don't need `ui`. For top-level scripts that use `ui`, we can handle it specially — or just accept that `ui` needs to be accessed differently.

Wait — the user currently writes `ui.log("hello")` in top-level scripts and it works. If we remove `with(this)` and don't inject `ui`, this breaks. We need `ui` available.

**Final approach for `ui`:** Define it as a getter in the prefix using a two-line approach:

```javascript
var app=globalThis.__scriptContext__?.app,...;
var ui; if(globalThis.__scriptContext__){Object.defineProperty(this,'ui',{get:function(){if(!ui)ui=globalThis.__scriptContext__.ui;return ui},configurable:true})}
```

No — `this` in the prefix is `exports`, not the script scope.

**Simplest working approach:** Just inject `ui` eagerly. The UiFacade/Log View creation is fast and only happens if script context exists. If the user runs a script that doesn't use `ui`, the Log View page is created but that's the current behavior too (if any sub-module touches `ui`). We can optimize laziness later if it becomes a problem.

### Step 2: Simplify executeInternal — no `with`, no `lexicalObjects`

Replace the current wrapping:

```javascript
// Before (current):
with (this) {
    return (async function() {
        const Array = globalThis.Array;
        // ... 50 lines ...
        return (userScript);
    }).call(this);
}

// After (new):
return (async function() {
    var app=globalThis.__scriptContext__?.app,...;
    return (userScript);
})();
```

The `executeInternal` and `wrapScriptWithImplicitReturn` methods just use `CONTEXT_PREFIX` instead of `lexicalObjects`, and drop `with(this)`.

### Step 3: Remove `lexicalObjects` constant

Delete the ~55-line `lexicalObjects` string from `ScriptRunnerBase.ts`.

### Step 4: Remove proxy chain from ScriptContext

The `with(this)` proxy chain in ScriptContext (`readOnlyGlobalThis` proxy, main `context` proxy) was only needed because `with` intercepts variable lookups. Without `with`, these proxies are unnecessary.

ScriptContext still needs to:
- Create `AppWrapper`, `PageWrapper`, UiFacade
- Build the `customContext` object (for `globalThis.__scriptContext__`)
- Manage `releaseList` and `dispose()`

But the complex proxy chain (lines 101-185 of current ScriptContext.ts) can be removed. The `context` property becomes just the `customContext` plain object.

**However:** `new Function(wrappedScript)` creates a function. We call it with `.call(context)` — but without `with`, `this` inside the function is just the context object, not used for variable lookup. We can call it without `.call(context)` entirely, or pass `undefined`.

### Step 5: Update `fn.call(context)` to `fn()`

Since we no longer use `with(this)`, the function doesn't need a specific `this` value:

```javascript
const fn = new Function(wrappedScript);
const scriptResult = fn();  // no .call(context) needed
```

## Files Changed Summary

| File | Action | What |
|------|--------|------|
| `src/renderer/scripting/library-require.ts` | Modify | Expand CONTEXT_PREFIX with all globals, export it |
| `src/renderer/scripting/ScriptRunnerBase.ts` | Modify | Remove `lexicalObjects`, use CONTEXT_PREFIX, drop `with(this)` |
| `src/renderer/scripting/ScriptContext.ts` | Modify | Remove proxy chain, simplify to plain object |

## Concerns

### 1. `ui` lazy initialization (RESOLVED)

`ui` and `console` must NOT be injected via the `var` prefix — reading `__scriptContext__.ui` triggers UiFacade creation (Log View page) eagerly.

**Solution:** Use `Object.defineProperty(globalThis, 'ui', { get: () => customContext.ui, configurable: true })` in ScriptContext constructor. The getter delegates to `customContext.ui` which is itself a lazy getter. `dispose()` removes it via `delete globalThis.ui`.

Two categories of globals:
- **Prefix injection (var):** `app`, `page`, `React`, `styledText`, `preventOutput`, `require` — safe to read eagerly
- **globalThis lazy getters:** `ui`, `console` — trigger side effects, only activate when used

### 2. Global pollution (out of scope)

Without `with(this)`, `var myVar = 5` in a script sets it on the function's local scope (good), but `myVar = 5` (without `var/let/const`) sets it on `globalThis` (bad). This is the same behavior as sub-modules and is a separate concern. The `with` proxy previously caught unqualified assignments.

**Decision:** Out of scope. Address in a future task if needed.

### 3. `new Function()` strict mode

`new Function()` runs in sloppy mode by default. `with` is not allowed in strict mode, so current code must be sloppy. After removing `with`, we could add `"use strict";` — but this might break some user scripts that rely on sloppy mode features.

**Decision:** Keep sloppy mode for now. Strict mode can be a future opt-in.

### 4. Stack trace line offsets

The prefix adds 1-2 lines before user code. Stack traces will show line numbers offset by this amount. Same issue as sub-modules (already accepted in US-234). Keep prefix minimal (one line).

## Acceptance Criteria

- [ ] Top-level scripts use the same prefix injection as sub-modules
- [ ] `with(this)` removed from all script wrapping
- [ ] `lexicalObjects` (~55 lines) removed
- [ ] Proxy chain removed from ScriptContext
- [ ] `app`, `page`, `React`, `styledText`, `preventOutput`, `require`, `console` available in top-level scripts
- [ ] `ui` available in top-level scripts (lazy or eager)
- [ ] Expression mode still works (`5 + 5` returns `10`)
- [ ] Statement mode still works (`const a = 5; a * 8` returns `40`)
- [ ] Implicit return still works
- [ ] `Array.from()`, `JSON.stringify()` etc. work without `lexicalObjects`
- [ ] Existing scripts behavior unchanged
- [ ] TypeScript compiles clean
