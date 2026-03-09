# US-141: Script Facade — Global `ui` Variable (Logging + Dialogs)

**Epic:** EPIC-004 (Log View Editor)
**Phase:** 2 — Integration Layer

## Goal

Add a `ui` global variable to the script sandbox. Scripts use `ui` to log messages, show dialogs, and display rich output in a Log View page. The `ui` global is lazy-initialized: the Log View page is created on first access.

## Scope

This task covers the **script facade only** (not MCP). Specifically:

1. **`UiFacade.ts`** — facade class wrapping `LogViewModel`
2. **`ScriptContext.ts`** — add lazy `ui` global to the script sandbox
3. **`ui-log.d.ts`** — type definitions for IntelliSense (`IUiLog` interface)
4. **`index.d.ts`** — declare global `ui` variable
5. **Copy to `/assets/editor-types/`** — for Monaco IntelliSense in script editor

## Design (from EPIC-004)

### API Surface

**Logging** (fire-and-forget, top-level):
```typescript
ui.log("message or StyledText")     // log.text
ui.info("message")                  // log.info
ui.warn("message")                  // log.warn
ui.error("message")                 // log.error
ui.success("message")               // log.success
ui.text("message")                  // alias for log.text
ui.clear()                          // remove all entries
```

**Dialogs** (`ui.dialog.*` — async, returns Promise):
```typescript
ui.dialog.confirm(message, buttons?)
// → Promise<{ button: string | undefined }>

ui.dialog.buttons(buttons, title?)
// → Promise<{ button: string | undefined }>

ui.dialog.textInput(title?, options?)
// → Promise<{ button: string | undefined; text: string | undefined }>
```

> Note: `checkboxes`, `radioboxes`, `select` will be added in Phase 3 tasks.

**Output** (`ui.show.*` — display-only):
> Not implemented yet. Will be added in Phase 3. The facade should have the `show` property returning `undefined` or a stub for now.

### Cancellation

- Dialog promises **always resolve with an object** — never with `undefined`.
- On cancellation (page closed while pending), `button` is `undefined`.
- Scripts check: `if (!result.button) return;`

### Transparent Dialog Data (no mapping needed)

`LogViewModel.addDialogEntry()` returns the full `entry.data` object directly — the same object the script pushed, with `button` added by the renderer when user responds. **No mapping or field renaming is needed in the facade.** The facade just passes through the result.

Example flow for `ui.dialog.textInput("Name", { placeholder: "..." })`:
1. Script calls facade → facade calls `vm.addDialogEntry("input.text", { title: "Name", placeholder: "..." })`
2. User types "hello" → renderer updates `entry.data.text = "hello"`
3. User clicks "OK" → `vm.resolveDialog(id, "OK")` sets `entry.data.button = "OK"`
4. Promise resolves with full `entry.data`: `{ title: "Name", placeholder: "...", text: "hello", button: "OK" }`
5. On cancellation: `{ title: "Name", placeholder: "...", button: undefined }`

## Implementation Plan

### Step 1: Create `UiFacade.ts`

**File:** `src/renderer/scripting/api-wrapper/UiFacade.ts`

```typescript
class UiFacade {
    constructor(private vm: LogViewModel) {}

    // Logging methods — delegate to vm.addEntry(type, data)
    log(message: StyledText) { this.vm.addEntry("log.text", message); }
    info(message: StyledText) { this.vm.addEntry("log.info", message); }
    warn(message: StyledText) { this.vm.addEntry("log.warn", message); }
    error(message: StyledText) { this.vm.addEntry("log.error", message); }
    success(message: StyledText) { this.vm.addEntry("log.success", message); }
    text(message: StyledText) { this.vm.addEntry("log.text", message); }
    clear() { this.vm.clear(); }

    // Dialog namespace
    readonly dialog = {
        confirm: async (message, buttons?) => { ... },
        buttons: async (buttons, title?) => { ... },
        textInput: async (title?, options?) => { ... },
    };
}
```

**Key patterns:**
- Takes `LogViewModel` in constructor (acquired via `acquireViewModel`)
- Logging methods are fire-and-forget (no return value)
- Dialog methods return the mapped public result format
- `dialog` is an object property with methods (not a class)

### Step 2: Add lazy `ui` to `ScriptContext.ts`

The `ui` global must be **lazy-initialized** — the Log View page is only created when the script first accesses `ui`.

**Resolution logic:**
1. When `page` is available: check for existing grouped Log View → if none, create a new page, set it to `log-view` editor, group it with current page → acquire `LogViewModel` → return `UiFacade`
2. When `page` is not available: create a standalone Log View page (not grouped) → acquire `LogViewModel` → return `UiFacade`

**Implementation approach — `Object.defineProperty` with lazy getter:**

```typescript
// In createScriptContext():
let uiFacade: UiFacade | undefined;

Object.defineProperty(customContext, "ui", {
    get: () => {
        if (!uiFacade) {
            uiFacade = initializeUiFacade(page, releaseList);
        }
        return uiFacade;
    },
    enumerable: true,
    configurable: false,
});
```

**`initializeUiFacade()` function (synchronous):**
1. Find or create the Log View page (via `findOrCreateLogViewPage` — see Step 4)
2. Call `acquireViewModelSync("log-view")` to get `LogViewModel`
3. Push release to `releaseList`
4. Return `new UiFacade(vm)`

### Step 3: Pre-load log-view module + synchronous VM creation

**Resolved approach: `prepareViewModel` + `acquireViewModelSync`**

The `ui` getter is synchronous, but `acquireViewModel()` is async because it dynamically imports the editor module. We solve this by separating module loading from VM creation:

1. **`ScriptRunner`** (async) calls `prepareViewModel("log-view")` once on first script run — this loads and caches the editor module
2. **`ui` getter** (sync) calls `acquireViewModelSync("log-view")` — creates the VM synchronously using the cached factory

These methods were added to `ContentViewModelHost` and exposed via `IContentHost`:
- `prepareViewModel(editorId)` — async, loads and caches the editor module
- `acquireViewModelSync(editorId)` — sync, returns VM if module is cached, `undefined` otherwise

**In `ScriptRunner.executeScript()`:**
```typescript
// Pre-load log-view module (once, on first script run)
await logPage.prepareViewModel("log-view");
```

**In `initializeUiFacade()` (called from sync `ui` getter):**
```typescript
const vm = logPage.acquireViewModelSync("log-view") as LogViewModel;
if (!vm) throw new Error("Log view module not pre-loaded");
releaseList.push(() => logPage.releaseViewModel("log-view"));
return new UiFacade(vm);
```

This keeps `UiFacade` simple — it receives a ready `LogViewModel` in its constructor, no buffering or Promises needed.

### Step 4: Log View page creation

Need a helper to find or create a Log View page. This is synchronous — the module is already pre-loaded in Step 3, and `pagesModel` is imported statically (it's bootstrapped at app initialization).

```typescript
import { pagesModel } from "../../api/pages";

function formatLogTitle(): string {
    const now = new Date();
    const date = now.toISOString().slice(0, 10);       // "2026-03-10"
    const time = now.toTimeString().slice(0, 5);        // "12:24"
    return `${date} ${time}.log.jsonl`;
}

function findOrCreateLogViewPage(
    sourcePage: PageModel | undefined,
    releaseList: Array<() => void>
): LogViewModel {
    let logPage: PageModel;
    let isExisting = false;

    if (sourcePage) {
        // Check if grouped page is already a Log View
        const grouped = pagesModel.getGroupedPage(sourcePage.id);
        if (grouped && grouped.state.get().editor === "log-view") {
            logPage = grouped;
            isExisting = true;
        } else {
            // Create new Log View page and group it
            logPage = pagesModel.addEditorPage("log-view", "jsonl", formatLogTitle());
            pagesModel.groupTabs(sourcePage.id, logPage.id, false);
        }
    } else {
        // No source page — create standalone
        logPage = pagesModel.addEditorPage("log-view", "jsonl", formatLogTitle());
    }

    const vm = logPage.acquireViewModelSync("log-view") as LogViewModel;
    if (!vm) throw new Error("Log view module not pre-loaded");
    releaseList.push(() => logPage.releaseViewModel("log-view"));

    // Append separator when reusing existing log
    if (isExisting) {
        vm.addEntry("log.info", "");
    }
    vm.addEntry("log.info", `Script ${sourcePage?.state.get().title ?? "untitled"} started`);

    return vm;
}
```

### Step 5: Type definitions

**New file: `src/renderer/api/types/ui-log.d.ts`**

```typescript
export interface IStyledSegment {
    text: string;
    styles?: Record<string, string | number>;
}
export type IStyledText = string | IStyledSegment[];

export interface IDialogConfirmResult { button: string | undefined; }
export interface IDialogButtonsResult { button: string | undefined; }
export interface IDialogTextInputResult { button: string | undefined; text: string | undefined; }

export interface IUiDialog {
    confirm(message: IStyledText, buttons?: string[]): Promise<IDialogConfirmResult>;
    buttons(buttons: string[], title?: IStyledText): Promise<IDialogButtonsResult>;
    textInput(title?: IStyledText, options?: { placeholder?: string; defaultValue?: string; buttons?: string[] }): Promise<IDialogTextInputResult>;
}

export interface IUiLog {
    log(message: IStyledText): void;
    info(message: IStyledText): void;
    warn(message: IStyledText): void;
    error(message: IStyledText): void;
    success(message: IStyledText): void;
    text(message: IStyledText): void;
    clear(): void;
    readonly dialog: IUiDialog;
}
```

**Update: `src/renderer/api/types/index.d.ts`**

```typescript
declare global {
    const app: IApp;
    const page: IPage | undefined;
    const ui: IUiLog;
    // ...
}
```

## Concerns and Open Questions

### 1. ~~Async `acquireViewModel` in sync getter~~ (RESOLVED)

Resolved by adding `prepareViewModel()` + `acquireViewModelSync()` to `ContentViewModelHost` / `IContentHost`. The module is pre-loaded asynchronously in `ScriptRunner`, then the VM is created synchronously in the `ui` getter. See Step 3 for details.

### 2. ~~Grouped page conflict~~ (RESOLVED)

`groupTabs()` → `group()` automatically calls `ungroup()` on both pages first. So simply calling `groupTabs(sourcePage, logPage)` will ungroup any previous pairing. No special handling needed.

### 3. ~~`outputFlags.groupedContentWritten` interaction~~ (RESOLVED)

Accessing `ui` sets `groupedContentWritten = true`. The Log View IS the grouped page, so this is semantically correct. The default script output (writing result to grouped page) is suppressed — the script is handling its own output via `ui`.

### 4. ~~Title of the Log View page~~ (RESOLVED)

Title format: `"2026-03-10 12:24.log.jsonl"` (current datetime). This is useful if the user wants to save the log to a logs folder.

### 5. ~~Re-using existing Log View~~ (RESOLVED)

Append without clearing. On each script run, push auto-generated separator entries:
```typescript
vm.addEntry("log.info", "");                              // empty line separator
vm.addEntry("log.info", `Script ${page.title} started`);  // run header
```
Scripts can call `ui.clear()` explicitly if they want a clean slate.

### 6. ~~`preventOutput()` interaction~~ (RESOLVED)

Accessing `ui` already prevents default output (sets `groupedContentWritten = true`). Calling `preventOutput()` additionally changes nothing — the final script result is not printed to the grouped page regardless. Exceptions are shown in a text dialog.

### 7. ~~Naming: `ui-log.d.ts` vs `log-view.d.ts`~~ (RESOLVED)

`ui-log.d.ts` — `ui` is a top-level global, not an editor facade.

## Files to Create

| File | Purpose |
|------|---------|
| `src/renderer/scripting/api-wrapper/UiFacade.ts` | Facade class wrapping LogViewModel |
| `src/renderer/api/types/ui-log.d.ts` | Type definitions for `IUiLog` interface (Vite copies to assets automatically) |

## Files to Modify

| File | Change |
|------|--------|
| `src/renderer/scripting/ScriptRunner.ts` | Pre-load log-view module via `prepareViewModel()` |
| `src/renderer/scripting/ScriptContext.ts` | Add lazy `ui` global via property getter |
| `src/renderer/api/types/index.d.ts` | Add `const ui: IUiLog` to global declarations |

## Acceptance Criteria

- [ ] `ui.log("hello")` creates a Log View page and displays a log entry
- [ ] `ui.info/warn/error/success/text` create entries with correct types
- [ ] `ui.clear()` removes all entries
- [ ] `ui.dialog.confirm("message")` shows a confirm dialog and returns `{ button }` (always an object)
- [ ] `ui.dialog.buttons(["A", "B"])` shows buttons dialog
- [ ] `ui.dialog.textInput("Title")` shows text input dialog and returns `{ button, text }`
- [ ] With `page` context: Log View is auto-grouped with source page
- [ ] Without `page` context: standalone Log View page is created
- [ ] Re-running a script reuses the existing Log View (appends)
- [ ] Closing the Log View while a dialog is pending resolves with `{ button: undefined }`
- [ ] `ui` is available in Monaco IntelliSense with correct types
- [ ] `preventOutput()` does not affect `ui` output
