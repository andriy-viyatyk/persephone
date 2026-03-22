# US-232: Script Scope — Refactor ScriptContext & ScriptRunner with Auto-Cleanup

**Epic:** EPIC-009 — Scriptable Application Events
**Status:** Planned
**Created:** 2026-03-22

## Goal

Refactor `ScriptContext` to a class and `ScriptRunner` to a cleaner architecture, then enhance `AppWrapper.events` to auto-track and clean up event subscriptions when the script scope is disposed.

## Background

### Current ScriptContext (function-based)

`ScriptContext.ts` is a factory function `createScriptContext()` that returns `{ context, cleanup, outputFlags }`. It has a `releaseList` that tracks cleanup functions (currently only ViewModel ref-counting). The `cleanup()` function is called in the `finally` block.

### Current ScriptRunner (monolithic class)

`ScriptRunner.ts` is a single class with mixed responsibilities:
- **Run orchestration:** `run()`, `runWithCapture()`, `runWithResult()` — three entry points with context creation, execution, cleanup, result handling
- **Core execution:** `executeScript()` — transpilation, context creation, expression/statement detection, `with(this)` wrapping
- **Script wrapping:** `wrapScriptWithImplicitReturn()` — extract last expression for implicit return
- **Utility:** `convertToText()` — converts any value to `{ text, language }` for display
- **Promise detection:** `isPromiseLike()` — detect genuine promises vs. StyledLogBuilder

### Problems

1. `ScriptContext` is a function returning a bag of values — no proper entity to store for long-lived scopes
2. `ScriptRunner` mixes execution logic with result conversion and output handling
3. `convertToText()` is a pure utility with no `ScriptRunner` dependency
4. No way to execute a script with an existing context (needed for registration scripts)
5. `AppWrapper.events` passes through `app.events` directly — subscriptions aren't tracked

## Implementation Plan

### Step 1: Extract `convertToText` to `script-utils.ts`

Create `src/renderer/scripting/script-utils.ts` with `convertToText()` (lines 304-456 of current ScriptRunner). It's a pure function that converts any value to `{ text: string; language: string }` — no ScriptRunner dependency.

Also move `McpScriptResult` interface there (or keep in ScriptRunner — it's small).

### Step 2: Refactor ScriptContext to class

Convert the factory function to a class:

```typescript
export class ScriptContext {
    readonly releaseList: Array<() => void> = [];
    readonly outputFlags: ScriptOutputFlags = { outputPrevented: false, groupedContentWritten: false };
    readonly context: Record<string, any>;  // The proxy object passed as `this` to scripts

    constructor(page?: PageModel, consoleLogs?: ConsoleLogEntry[], libraryPath?: string) {
        const appWrapper = new AppWrapper(this.releaseList);
        const pageWrapper = page ? new PageWrapper(page, this.releaseList, this.outputFlags) : undefined;
        // ... same proxy setup as current createScriptContext ...
        this.context = new Proxy(customContext, { ... });
    }

    dispose() {
        for (const release of this.releaseList) {
            try { release(); } catch {}
        }
        this.releaseList.length = 0;
    }
}
```

### Step 3: Create ScriptRunnerBase with pure execution logic

Create `ScriptRunnerBase` (or rename — could stay in same file) with only the core execution:

```typescript
class ScriptRunnerBase {
    /**
     * Execute a script string with a given context proxy.
     * Handles expression vs statement detection, implicit return, async await.
     * Does NOT create context, does NOT cleanup — caller manages lifecycle.
     */
    protected async execute(script: string, context: Record<string, any>): Promise<any> {
        // expression/statement detection
        // wrapScriptWithImplicitReturn
        // new Function(...).call(context)
        // await if promise-like
        // return result (or Error)
    }

    protected wrapScriptWithImplicitReturn(script: string): string { ... }
    protected isPromiseLike(value: any): boolean { ... }
}
```

This is the minimal execution engine — no context creation, no cleanup, no output handling.

### Step 4: ScriptRunner extends ScriptRunnerBase

`ScriptRunner` keeps the high-level orchestration methods:

```typescript
class ScriptRunner extends ScriptRunnerBase {
    handlePromiseException = 0;
    private libraryDirty = true;

    invalidateLibraryCache = () => { this.libraryDirty = true; };

    /**
     * Simple run — creates context, executes, cleans up, returns raw result.
     */
    run = async (script: string, page?: PageModel, language?: string): Promise<any> => {
        // prepare (transpile, load deps, create ScriptContext)
        // execute with context
        // finally: context.dispose()
    };

    /**
     * MCP mode — creates context, captures console, cleans up, returns structured result.
     */
    runWithCapture = async (...): Promise<McpScriptResult> => { ... };

    /**
     * UI mode — creates context, writes output to grouped page, cleans up.
     */
    runWithResult = async (...): Promise<string> => { ... };

    /**
     * Execute with an existing context (no auto-dispose).
     * For registration scripts — caller manages the context lifetime.
     */
    runWithContext = async (script: string, context: ScriptContext, language?: string): Promise<any> => {
        const transpiled = await transpileIfNeeded(script, language);
        return this.execute(transpiled, context.context);
    };

    /** Common preparation: transpile, ensure sucrase, register library, clear cache. */
    private async prepare(script: string, language?: string): Promise<{ script: string; libraryPath?: string }> {
        // transpilation, sucrase loading, library extension registration, cache clear
        // returns prepared script and library path
    }
}
```

Key changes:
- `prepare()` extracts the common setup logic (transpile + sucrase + library)
- `runWithContext()` — new method for executing with an existing context (no auto-dispose)
- Each `run*` method follows: prepare → create context → execute → handle result → dispose
- `execute()` inherited from `ScriptRunnerBase` — pure execution, no side effects

### Step 5: Add events proxy to AppWrapper

`AppWrapper` intercepts `subscribe()` calls on EventChannels:

```typescript
// In AppWrapper:
private _events: unknown;

get events() {
    if (!this._events) {
        this._events = createEventsProxy(app.events, this.releaseList);
    }
    return this._events;
}
```

Generic recursive proxy wraps any EventChannel leaf:

```typescript
function createEventsProxy(target: any, releaseList: Array<() => void>): any {
    return new Proxy(target, {
        get(obj, prop) {
            const value = obj[prop];
            if (value && typeof value === "object") {
                if (typeof value.subscribe === "function") {
                    return wrapEventChannel(value, releaseList);
                }
                return createEventsProxy(value, releaseList);
            }
            return value;
        },
    });
}

function wrapEventChannel(channel: any, releaseList: Array<() => void>) {
    return {
        subscribe(handler: any) {
            const sub = channel.subscribe(handler);
            releaseList.push(() => sub.unsubscribe());
            return sub;
        },
        subscribeDefault(handler: any) {
            const sub = channel.subscribeDefault(handler);
            releaseList.push(() => sub.unsubscribe());
            return sub;
        },
    };
}
```

### Step 6: Verify mid-pipeline unsubscribe safety

Check `EventChannel.sendAsync()` — if `unsubscribe()` is called during iteration (e.g., a handler unsubscribes another handler), does it cause issues? The handler array is iterated by index. If `unsubscribe()` splices an entry mid-iteration, it could skip handlers.

**Fix if needed:** Snapshot the handlers array at the start of `sendAsync()`:
```typescript
const handlers = [...this.handlers];  // snapshot
for (const handler of handlers) { ... }
```

## Concerns (Resolved)

### Regular script subscriptions — clean up by default
When user runs a script with F5, subscriptions die when script finishes. Safe and predictable. Registration scripts (future) are for persistent subscriptions.

### Legacy Subscription class — out of scope
Not exposed to scripts through `app.events`. Only `EventChannel` subscriptions need tracking.

### Timer tracking — out of scope
`setTimeout`/`setInterval` cleanup is a separate concern. Class structure supports adding later.

### Proxy caching
If script does `const ch = app.events.fileExplorer.itemContextMenu` then calls `ch.subscribe()` twice — each call goes through the proxy's `get()` which wraps the channel fresh. Both `unsubscribe()` functions are pushed to `releaseList`. Works correctly.

## Files Changed Summary

| File | Action | What |
|------|--------|------|
| `src/renderer/scripting/script-utils.ts` | **Create** | `convertToText()` utility |
| `src/renderer/scripting/ScriptContext.ts` | **Rewrite** | Convert to class with `dispose()` |
| `src/renderer/scripting/ScriptRunner.ts` | **Rewrite** | ScriptRunnerBase + ScriptRunner, `runWithContext()` |
| `src/renderer/scripting/api-wrapper/AppWrapper.ts` | Modify | Add `events` getter with proxy |
| `src/renderer/api/events/EventChannel.ts` | Possibly modify | Snapshot handlers in `sendAsync()` |

## Acceptance Criteria

- [ ] `convertToText()` extracted to `script-utils.ts`
- [ ] `ScriptContext` is a class with `constructor()` and `dispose()`
- [ ] `ScriptRunnerBase` has pure `execute()` method
- [ ] `ScriptRunner` extends base with `run()`, `runWithCapture()`, `runWithResult()`, `runWithContext()`
- [ ] `app.events.*.subscribe()` in scripts auto-pushes `unsubscribe()` to releaseList
- [ ] Regular scripts clean up subscriptions when script finishes
- [ ] `ScriptContext` instance can be stored for long-lived scopes (no auto-dispose in constructor)
- [ ] `EventChannel.sendAsync()` is safe against mid-iteration unsubscribe
- [ ] TypeScript compiles clean
- [ ] Existing script behavior (F5, MCP, runWithResult) unchanged
