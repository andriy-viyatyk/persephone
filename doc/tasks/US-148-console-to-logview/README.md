# US-148: Forward console.log/warn/error to Log View when `ui` is active

## Goal

When a script uses the `ui` global, automatically forward `console.log`, `console.warn`, and `console.error` calls to the Log View as `log.text`, `log.warn`, and `log.error` entries respectively. Provide `ui.preventConsoleLog()`, `ui.preventConsoleWarn()`, `ui.preventConsoleError()` methods to suppress forwarding per-level.

## Background

### Current console handling

**MCP scripts** (`runWithCapture`): ScriptContext creates a custom `console` object when a `consoleLogs` array is provided (ScriptContext.ts:70-76). Calls are serialized and captured into the array, then returned in the `McpScriptResult`. The native browser console is NOT called.

**Regular scripts** (`run`/`runWithResult`): No custom console is created. Scripts use the browser's native `console` — output goes to DevTools only, invisible to the user.

### UI object lifecycle

The `ui` global is a lazy getter (ScriptContext.ts:57-68). On first access:
1. `initializeUiFacade()` creates or reuses a grouped Log View page
2. Acquires `LogViewModel` synchronously (log-view module is pre-loaded)
3. Returns `UiFacade` wrapping the LogViewModel

**Key insight:** Console forwarding should activate only after `ui` is first accessed, because:
- Not all scripts use `ui` — only scripts that explicitly use Log View should have console forwarding
- The LogViewModel must exist before we can forward to it

### Console methods to map

| `console` method | → `ui` method | → Log View type | Notes |
|---|---|---|---|
| `console.log(...)` | — | `log.log` | Light/dimmed color (distinct from `ui.log`) |
| `console.info(...)` | `ui.info()` | `log.info` | Info (blue) |
| `console.warn(...)` | `ui.warn()` | `log.warn` | Warning (yellow/orange) |
| `console.error(...)` | `ui.error()` | `log.error` | Error (red) |
| `console.debug(...)` | — | — (no forward) | Too verbose, DevTools-only |
| `console.trace(...)` | — | — (no forward) | Stack trace, DevTools-only |
| `console.dir(...)` | — | — (no forward) | Object inspector, DevTools-only |
| `console.table(...)` | — | — (no forward) | Table display, DevTools-only |

Only `log`, `info`, `warn`, `error` are forwarded — each maps to its exact `ui` counterpart. This preserves distinct colors in the Log View (`log.log` = light/dimmed, `log.info` = blue, `log.warn` = yellow, `log.error` = red).

### Existing serialization

`serializeArg()` (ScriptContext.ts:18-29) handles primitives, objects, errors. Can be reused for formatting console args into a string for the log entry text.

### Output format

`console.log("hello", 42, {a: 1})` → single `log.text` entry with text: `"hello 42 {"a":1}"` (args joined with space, matching browser console behavior).

## Implementation Plan

### Step 1: Add console forwarding in ScriptContext

**File:** `src/renderer/scripting/ScriptContext.ts`

After `initializeUiFacade()` creates the `UiFacade`, install console forwarding:

```typescript
// Inside initializeUiFacade(), after creating the UiFacade:
function installConsoleForwarding(
    facade: UiFacade,
    customContext: Record<string, any>,
) {
    const formatArgs = (args: any[]) => args.map(serializeArg).join(" ");

    // Create a forwarding console that sends to both Log View AND native console
    const nativeConsole = globalThis.console;

    const forwardingConsole = {
        log: (...args: any[]) => {
            nativeConsole.log(...args);
            if (!facade.consoleLogPrevented) facade.log(formatArgs(args));
        },
        info: (...args: any[]) => {
            nativeConsole.info(...args);
            if (!facade.consoleLogPrevented) facade.info(formatArgs(args));
        },
        warn: (...args: any[]) => {
            nativeConsole.warn(...args);
            if (!facade.consoleWarnPrevented) facade.warn(formatArgs(args));
        },
        error: (...args: any[]) => {
            nativeConsole.error(...args);
            if (!facade.consoleErrorPrevented) facade.error(formatArgs(args));
        },
        // Pass-through for non-forwarded methods
        debug: nativeConsole.debug.bind(nativeConsole),
        trace: nativeConsole.trace.bind(nativeConsole),
        dir: nativeConsole.dir.bind(nativeConsole),
        table: nativeConsole.table.bind(nativeConsole),
        clear: nativeConsole.clear.bind(nativeConsole),
        assert: nativeConsole.assert.bind(nativeConsole),
        count: nativeConsole.count.bind(nativeConsole),
        countReset: nativeConsole.countReset.bind(nativeConsole),
        group: nativeConsole.group.bind(nativeConsole),
        groupCollapsed: nativeConsole.groupCollapsed.bind(nativeConsole),
        groupEnd: nativeConsole.groupEnd.bind(nativeConsole),
        time: nativeConsole.time.bind(nativeConsole),
        timeEnd: nativeConsole.timeEnd.bind(nativeConsole),
        timeLog: nativeConsole.timeLog.bind(nativeConsole),
    };

    customContext.console = forwardingConsole;
}
```

**Key design points:**
- Native console is ALWAYS called (forwarding is additive, not replacing)
- Only `log`/`info`/`warn`/`error` forward to Log View
- All other console methods pass through to native console
- Forwarding checks `facade.consoleXxxPrevented` flags before writing to Log View

### Step 2: Wire console forwarding into the lazy `ui` getter

**File:** `src/renderer/scripting/ScriptContext.ts`

The tricky part: the `ui` getter creates UiFacade lazily. Console forwarding must be installed at that same moment. Modify the `ui` getter:

```typescript
Object.defineProperty(customContext, "ui", {
    get: () => {
        if (!uiFacade) {
            uiFacade = initializeUiFacade(page, releaseList, outputFlags);
            // Install console forwarding now that ui (and LogViewModel) exists
            installConsoleForwarding(uiFacade, customContext);
        }
        return uiFacade;
    },
    enumerable: true,
    configurable: false,
});
```

### Step 3: Handle MCP console capture interaction

**Concern:** When `consoleLogs` array is provided (MCP mode), the current code already creates a custom `console` (ScriptContext.ts:70-76). If `ui` is later accessed, the forwarding console should REPLACE the capture-only console.

**Solution:** The `installConsoleForwarding` function overwrites `customContext.console`. This naturally replaces the MCP capture console. But we need to ALSO keep capturing into `consoleLogs` for MCP:

```typescript
// If consoleLogs exists (MCP mode), also capture into the array
if (consoleLogs) {
    const forwardingConsole = {
        log: (...args: any[]) => {
            nativeConsole.log(...args);
            consoleLogs.push({ level: "log", args: args.map(serializeArg), timestamp: Date.now() });
            if (!facade.consoleLogPrevented) facade.log(formatArgs(args));
        },
        // ... same pattern for info, warn, error
    };
}
```

**Wait — is this actually needed?** MCP scripts use `runWithCapture` which returns `consoleLogs`. But if the script also uses `ui`, the log entries are visible in the Log View already. The `consoleLogs` in the MCP result are mostly for the agent to see what the script printed. We should still capture them for MCP response completeness.

**Simplification:** Pass `consoleLogs` (or undefined) to `installConsoleForwarding` so it can optionally capture.

### Step 4: Add prevent methods to UiFacade

**File:** `src/renderer/scripting/api-wrapper/UiFacade.ts`

```typescript
export class UiFacade {
    // Console forwarding flags
    consoleLogPrevented = false;
    consoleWarnPrevented = false;
    consoleErrorPrevented = false;

    preventConsoleLog() { this.consoleLogPrevented = true; }
    preventConsoleWarn() { this.consoleWarnPrevented = true; }
    preventConsoleError() { this.consoleErrorPrevented = true; }

    // ... existing code
}
```

### Step 5: Update type definitions

**Files:** `src/renderer/api/types/ui-log.d.ts` and `assets/editor-types/ui-log.d.ts`

Add to `IUiLog`:

```typescript
export interface IUiLog {
    // ... existing methods ...

    /**
     * Prevent `console.log()` and `console.info()` from being forwarded to the Log View.
     * The native browser console is still called — only the Log View forwarding is suppressed.
     * Useful when third-party libraries produce noisy log output.
     */
    preventConsoleLog(): void;

    /**
     * Prevent `console.warn()` from being forwarded to the Log View.
     */
    preventConsoleWarn(): void;

    /**
     * Prevent `console.error()` from being forwarded to the Log View.
     */
    preventConsoleError(): void;
}
```

### Step 6: Update MCP resource guide

**File:** `assets/mcp-res-scripting.md`

Add a note about console forwarding behavior in the scripting guide.

## Resolved Concerns

1. **Console entry styling** — Same appearance as explicit `ui.log()`/`ui.warn()`/`ui.error()` calls. Each console method maps to its exact `ui` counterpart, so distinct colors are preserved (`log.text` = default, `log.info` = blue, `log.warn` = yellow, `log.error` = red). No additional visual distinction needed.

2. **Console method mapping** — Exact 1:1 mapping: `console.log`→`ui.log`, `console.info`→`ui.info`, `console.warn`→`ui.warn`, `console.error`→`ui.error`.

3. **Prevent methods naming** — `preventConsoleLog()` — matches user's original request.

4. **Re-enable after preventing** — One-way only (`prevent*`). No `allow*` for now.

5. **MCP + ui interaction** — When MCP `execute_script` accesses `ui`, console entries go to BOTH `consoleLogs` (returned to agent) AND Log View (visible to user). Dual-output is correct.

6. **Opt-in vs automatic** — Automatic when `ui` is accessed. Users call `ui.preventConsole*()` to suppress.

## Acceptance Criteria

- [ ] `console.log("hello")` appears as `log.log` entry in Log View (light/dimmed color) when script uses `ui`
- [ ] `console.info("info")` appears as `log.info` entry (blue)
- [ ] `console.warn("warning")` appears as `log.warn` entry (yellow)
- [ ] `console.error("error")` appears as `log.error` entry (red)
- [ ] Multiple args are joined with space: `console.log("a", 1, {b:2})` → `"a 1 {"b":2}"`
- [ ] Objects/errors are serialized properly (reuse `serializeArg`)
- [ ] Native browser console still receives all calls (forwarding is additive)
- [ ] `console.debug`, `console.trace`, `console.table`, etc. still work (pass-through to native)
- [ ] `ui.preventConsoleLog()` suppresses `console.log` and `console.info` forwarding
- [ ] `ui.preventConsoleWarn()` suppresses `console.warn` forwarding
- [ ] `ui.preventConsoleError()` suppresses `console.error` forwarding
- [ ] Prevent methods don't affect native console output
- [ ] Scripts that don't use `ui` are unaffected (no console interception)
- [ ] MCP scripts with `consoleLogs` capture still work when `ui` is also accessed
- [ ] Type definitions updated in both `.d.ts` files
- [ ] IntelliSense works for `preventConsole*` methods
