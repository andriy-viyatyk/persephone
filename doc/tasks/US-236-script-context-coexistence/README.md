# US-236: Script Context Coexistence Issues

**Epic:** EPIC-009 — Scriptable Application Events
**Status:** Planned
**Created:** 2026-03-22

## Known Problems

### 1. Autoload event handlers break after F5 script run

**What happens:**
- Autoload scripts register event handlers during startup. The autoload `ScriptContext` persists (not disposed) — it holds the `releaseList` for event subscriptions.
- The autoload `ScriptContext` constructor sets `globalThis.__scriptContext__` and defines a lazy `ui` getter on `globalThis`.
- When user runs a script via F5, `ScriptRunner` creates a **new** `ScriptContext` which overwrites `globalThis.__scriptContext__` and redefines the `ui` getter.
- When the F5 script finishes, `ScriptContext.dispose()` clears `globalThis.__scriptContext__ = undefined` and `delete globalThis.ui`.
- **Result:** Autoload event handlers that use `app`, `ui`, or other context globals now reference undefined values. `ui` getter is gone. `app` in the handler's closure is still the `AppWrapper` from autoload's context (captured at `require()` time via CONTEXT_PREFIX), so `app` may still work. But `ui` is broken.

**Symptoms:**
- First menu item click after F5 → `ui` is undefined or log-view error
- `app` may still work because it was captured as a local variable via CONTEXT_PREFIX at module load time

### 2. Lazy require() in event handlers loses script context

**What happens:**
- `clearLibraryRequireCache()` is called on every script execution (in `ScriptRunnerBase.prepare()`), clearing all cached library modules.
- If an autoload event handler does a lazy `require("library/some-module")` inside the handler (not during registration), the module is re-loaded with the **current** `globalThis.__scriptContext__` — which is `undefined` if no script is currently running.
- **Result:** The freshly loaded module has `app = undefined`, `page = undefined`, etc.

**Symptoms:**
- Handler works fine initially (module was cached from registration time)
- After any F5 script run (which clears require cache), the next handler invocation that triggers a lazy require fails

## Investigation Needed

- How should multiple ScriptContexts coexist? Options:
  - Stack-based: push/pop `__scriptContext__` instead of overwrite/clear
  - Separate globals for autoload vs regular scripts
  - Autoload handlers don't use `__scriptContext__` at all — they capture everything at registration time
- Should `dispose()` restore the previous `__scriptContext__` and `ui` getter?
- Should autoload's `ui` getter be different from regular script's `ui` getter?
- How to handle require cache clearing without breaking autoload module references?
