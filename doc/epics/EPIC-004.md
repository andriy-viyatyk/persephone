# EPIC-004: Log View Editor

## Status

**Status:** Active
**Created:** 2026-03-09

## Overview

A new editor type "Log View" that displays structured logs with interactive dialogs. Inspired by the UI panel from the `interactive-script` VSCode extension. The editor is associated with `.log.json` files and stores the full log as a JSON array. Scripts and AI agents can use it to display log entries (text, info, warn, error, success) and interactive dialogs (text input, confirm, buttons, checkboxes, select, etc.) — with dialog results flowing back to the caller.

## Goals

- New "log-view" editor for `.log.json` files that renders a scrollable log with rich entries
- Log entry types: text, info, warn, error, success, progress
- Interactive dialog entries rendered inline: confirm, text input, buttons, checkboxes, radioboxes, select
- Dialog results stored in the JSON and returned to the calling script/agent
- Virtualized rendering for large logs (reuse existing RenderGrid infrastructure)
- Styled text support (plain strings or `[{ text, styles }]` segments)
- Script API: global `ui` variable for appending entries, showing dialogs, and reading results
- MCP API: agents can append log entries and show dialogs via MCP commands

## Reference: interactive-script UI Panel

The design is based on the `D:\projects\interactive-script` project. Key patterns to reuse:

### Message/Entry Model

Each log entry follows this structure (adapted from `ViewMessage`):

```typescript
interface LogEntry<T = any> {
    type: string;        // Entry type: "log.info", "input.text", etc.
    id: string;          // Unique ID (for dialog response tracking)
    data: T;             // Type-specific payload
    timestamp?: number;  // When the entry was created
}
```

### Entry Types from interactive-script

**Log entries** (display-only):
- `log.text` — plain text
- `log.info` — info (blue)
- `log.warn` — warning (yellow)
- `log.error` — error (red)
- `log.success` — success (green)

**Dialog entries** (interactive, have `result` field):
- `input.confirm` — message + buttons → result: button clicked
- `input.text` — title + text field + buttons → result: entered text + button
- `input.buttons` — array of buttons → result: button clicked
- `input.checkboxes` — checkable items + buttons → result: selected items + button
- `input.radioboxes` — radio items + buttons → result: selected item + button
- `input.select` — dropdown select → result: selected value

**Output entries** (rich display):
- `output.progress` — progress bar with label
- `output.grid` — tabular data display
- `output.text` — formatted text block (e.g., code)
- `output.markdown` — rendered markdown block
- `output.mermaid` — rendered mermaid diagram

### Styled Text

Text can be a plain string or an array of styled segments:

```typescript
type StyledText = string | StyledSegment[];
interface StyledSegment { text: string; styles?: Record<string, string | number>; }
```

### Dialog Lifecycle

1. Script/agent appends a dialog entry (e.g., `input.text`) with no `result`
2. Log View renders the dialog as active (highlighted border, interactive controls)
3. User fills in data and clicks a button
4. Log View updates the entry's `result`/`resultButton` fields in the JSON
5. If script is waiting — it receives the result via the facade's async API
6. Dialog entry remains visible in the log (read-only after completion)

### File Format (.log.jsonl)

The file content is JSONL — one `LogEntry` JSON object per line:

```
{"type":"log.info","id":"1","data":"Process started","timestamp":1741500000000}
{"type":"input.text","id":"2","data":{"title":"Enter name","buttons":["Cancel","OK"],"result":"John","resultButton":"OK"},"timestamp":1741500001000}
{"type":"log.success","id":"3","data":"Done!","timestamp":1741500002000}
```

## Design Decisions

### Editor Registration

- **Editor ID:** `log-view`
- **Category:** `content-view` (like Grid, Notebook, Todo — shares TextFileModel, allows Monaco switching)
- **File association:** `*.log.jsonl`
- **Language:** `jsonl` (custom Monaco language, see US-137)
- **Dynamic import:** loaded on demand like all editors

### File Format: JSONL (`.log.jsonl`)

The log is stored as **JSONL (JSON Lines)** — one JSON object per line, not a JSON array:

```
{"type":"log.info","id":"1","data":"Process started","timestamp":1741500000000}
{"type":"input.text","id":"2","data":{"title":"Enter name","buttons":["Cancel","OK"]}}
{"type":"log.success","id":"3","data":"Done!","timestamp":1741500002000}
```

**Why JSONL over JSON array:**
- **O(1) append:** Adding a new entry = append one line (no need to parse/re-serialize entire content)
- **Incremental parsing:** Only parse new lines (track last known line count)
- **Monaco switching:** Users can switch to Monaco to view/edit raw JSONL — proper syntax highlighting via `jsonl` language
- **Standard format:** JSONL is widely used for logs and data processing

### Data Storage

- The page's `content` is the JSONL text (one LogEntry JSON per line)
- Appending a log entry = append one JSONL line to content string
- Dialog result submission = find entry by ID → update result fields → serialize
- Modified tracking works normally (dirty state when entries are added/changed)

### State Management

`LogViewModel.state.entries[]` is the single source of truth. Both rendering and the scripting facade access entries through this array:

**Rendering:** Each entry component subscribes to its slice via `vm.state.use(s => s.entries[index])` (selector hook with deep equality). All changes — user typing, button clicks, programmatic updates — go through `vm.state.update()`. No per-entry model wrappers needed.

**Scripting facade (future `ui` global):** Calls `LogViewModel` methods directly — `addEntry()`, `addDialogEntry()`, `resolveDialog()`, `updateEntry()`, `clear()`. Similar to interactive-script's API pattern (`ui.log.info(...)`, `ui.dialog.confirm(...)`).

**No LogEntryModel:** Per-entry reactive model wrappers are not needed. The entries array provides both the source for rendering and the target for mutations. `LogEntryModel` (from US-136) is deprecated and will be removed.

### Script API: global `ui` variable

`ui` is a **top-level script global** (like `page` and `app`), not a property on `page`. It provides the log facade for appending entries and showing dialogs.

**Resolution logic (lazy, on first `ui` access):**
1. **When `page` is available** (script runs from a page): check if the grouped page exists and is a Log View → if not, create a new Log View page and auto-group it with the current page → return facade bound to that Log View
2. **When `page` is not available** (script runs without a page context): create a standalone Log View page (not grouped) → bind it to the script context → return facade bound to that page. Subsequent accesses to `ui` in the same script reuse the already-bound Log View.

#### API Grouping

**Logging** (fire-and-forget, top-level methods):

```typescript
ui.log("message or StyledText")     // log.text — standard log
ui.info("message")                  // log.info — blue
ui.warn("message")                  // log.warn — yellow/orange
ui.error("message")                 // log.error — red
ui.success("message")               // log.success — green
ui.text("message")                  // log.text — high-contrast
ui.clear()                          // remove all entries
```

**Dialogs** (`ui.dialog.*` — async, await user response):

All dialog methods return `Promise<T | undefined>` where `undefined` means canceled (page closed while dialog was pending). All result objects include a `button` field for the clicked button label.

```typescript
ui.dialog.confirm(message, buttons?)
// → Promise<{ button: string } | undefined>
// Default buttons: ["No", "Yes"]

ui.dialog.buttons(buttons, title?)
// → Promise<{ button: string } | undefined>

ui.dialog.textInput(title?, options?)
// options: { placeholder?, defaultValue?, buttons? }
// → Promise<{ button: string; text: string } | undefined>

ui.dialog.checkboxes(items, title?, buttons?)
// → Promise<{ button: string; selected: string[] } | undefined>

ui.dialog.radioboxes(items, title?, buttons?)
// → Promise<{ button: string; selected: string } | undefined>

ui.dialog.select(items, title?, placeholder?)
// → Promise<{ button: string; selected: string } | undefined>
```

**Output** (`ui.show.*` — display-only rich content):

```typescript
ui.show.progress(label, value, max?)    // progress bar (updates existing or creates new)
ui.show.grid(columns, rows, title?)     // tabular data
ui.show.text(text, language?, title?)   // formatted text block (e.g., code)
ui.show.markdown(text)                  // rendered markdown
ui.show.mermaid(text)                   // rendered mermaid diagram
```

#### Script Usage Examples

```typescript
// Logging
ui.info("Processing started...");
ui.warn("Slow query detected");

// Confirm dialog
const result = await ui.dialog.confirm("Proceed with changes?");
if (!result) return;                    // page was closed
if (result.button === "Yes") {
    ui.success("Changes applied!");
}

// Text input with validation
const input = await ui.dialog.textInput("Enter your name", {
    placeholder: "Name...",
    buttons: ["Cancel", "!OK"],        // ! = required (disabled when empty)
});
if (!input) return;
ui.log(`Hello ${input.text}`);

// Checkboxes
const items = await ui.dialog.checkboxes(
    ["Item 1", "Item 2", "Item 3"],
    "Select items to process",
);
if (!items) return;
ui.info(`Selected: ${items.selected.join(", ")}`);

// Output
ui.show.markdown("## Results\n\nFound **3** issues.");
ui.show.mermaid("graph TD\n  A[Start] --> B[Process]\n  B --> C[End]");
ui.show.grid(["Name", "Value"], [["Item 1", 42], ["Item 2", 99]]);
```

#### Design Notes

- **No `ui.inline.*`** — not needed for log-view (those were inline confirmations specific to interactive-script's UI)
- **No `ui.window.*`** — js-notepad already has `page.grouped` for opening content in separate tabs
- **No `ui.file.*`** — js-notepad already has `app.fs` for file operations
- **Consistent result objects** — all dialogs return `{ button, ...data }` objects, making it safe to extend dialog results in the future without breaking existing scripts

### Read-Only Log

The Log View editor is **read-only** — users cannot manually add or edit entries. Only scripts and AI agents can append entries programmatically. Dialogs are the only interactive elements (user fills in data, clicks buttons). In the future, the log could evolve into an editable notebook-like experience, but that is out of scope for this epic.

### Dialog Cancellation

When a script is awaiting a dialog result and the user closes the Log View page, the dialog promise resolves with `undefined`. This prevents scripts/agents from hanging indefinitely. Scripts check for cancellation with a simple falsy check:

```typescript
const result = await ui.dialog.confirm("Proceed?");
if (!result) return;  // page was closed — canceled
```

For MCP, canceled dialogs return `{ button: null }` in the results array.

### Live Update Debouncing

When a script appends log entries rapidly, the UI updates are debounced at **300ms** to avoid excessive re-renders. This value may be adjusted after testing.

### MCP Integration

AI agents get a single `log_push` MCP tool. The agent does **not** need to find or track a Log View page — js-notepad manages an **active MCP log page** internally:

- On first `log_push` call: js-notepad creates a new Log View page and marks it as the "active MCP log"
- Subsequent `log_push` calls reuse the active MCP log page
- If the user closes the active MCP log page, the next `log_push` creates a new one
- The agent sends an array of entries — same types as the script `ui` API

#### Tool: `log_push`

**Parameters:**

```typescript
{
    entries: Array<string | { type: string; data: any }>
    // String shorthand: treated as log.info
    // Object: { type, data } matching LogEntry types
}
```

**Entry type mapping (matches script API):**

| Script API method | Entry type | data |
|-------------------|------------|------|
| `ui.log()` | `log.text` | `StyledText` |
| `ui.info()` | `log.info` | `StyledText` |
| `ui.warn()` | `log.warn` | `StyledText` |
| `ui.error()` | `log.error` | `StyledText` |
| `ui.success()` | `log.success` | `StyledText` |
| `ui.dialog.confirm()` | `input.confirm` | `{ message, buttons? }` |
| `ui.dialog.buttons()` | `input.buttons` | `{ buttons, title? }` |
| `ui.dialog.textInput()` | `input.text` | `{ title?, placeholder?, defaultValue?, buttons? }` |
| `ui.dialog.checkboxes()` | `input.checkboxes` | `{ items, title?, buttons? }` |
| `ui.dialog.radioboxes()` | `input.radioboxes` | `{ items, title?, buttons? }` |
| `ui.dialog.select()` | `input.select` | `{ items, title?, placeholder? }` |
| `ui.show.progress()` | `output.progress` | `{ label?, value, max? }` |
| `ui.show.grid()` | `output.grid` | `{ columns, rows, title? }` |
| `ui.show.text()` | `output.text` | `{ text, language?, title? }` |
| `ui.show.markdown()` | `output.markdown` | `{ text }` |
| `ui.show.mermaid()` | `output.mermaid` | `{ text }` |

**Return value:**

```typescript
{
    results?: Array<{ button: string | null; [key: string]: any }>
    // One result per dialog entry in the input array
    // button = null means canceled (page closed)
    // Non-dialog entries produce no results
}
```

**Batching and blocking:**

- Non-dialog entries are appended immediately
- Multiple dialog entries in a single call are supported — each creates a pending promise, `Promise.all()` collects all results before returning
- The tool call blocks until ALL dialogs in the batch are resolved (or canceled)
- This allows agents to show multiple dialogs at once (e.g., a form with several inputs)

**Usage examples:**

```
// Simple log messages (string shorthand → log.info)
log_push({ entries: ["Analyzing your code...", "Found 3 files to process"] })
→ returns immediately: { }

// Mixed log + dialog
log_push({ entries: [
    { type: "log.info", data: "Analysis complete." },
    { type: "input.confirm", data: { message: "Apply changes?", buttons: ["No", "Yes"] } }
]})
→ blocks until user clicks → { results: [{ button: "Yes" }] }

// Multiple dialogs in one call
log_push({ entries: [
    { type: "input.text", data: { title: "Project name", buttons: ["OK"] } },
    { type: "input.select", data: { title: "Language", items: ["TypeScript", "JavaScript", "Python"] } }
]})
→ blocks until BOTH dialogs resolved → { results: [{ button: "OK", text: "my-app" }, { button: "OK", selected: "TypeScript" }] }

// Rich output
log_push({ entries: [
    { type: "output.grid", data: { columns: ["File", "Issues"], rows: [["app.ts", 3], ["index.ts", 1]] } },
    { type: "output.markdown", data: { text: "## Summary\n\nFixed **4** issues." } },
    { type: "output.mermaid", data: { text: "graph TD\n  A[Scan] --> B[Fix] --> C[Done]" } }
]})
→ returns immediately: { }
```

**MCP as default output for AI agents:**

The Log View is the **preferred output channel** for AI agents. When the user asks the agent to "show something" in js-notepad, the agent should use `log_push` with appropriate `output.*` entries (grid, markdown, mermaid) rather than creating separate editor pages. Separate pages (`create_page`) are only for when the user explicitly asks to open data in a specific editor. This will be documented in the MCP API guide (`/assets/mcp-api-guide.md`).

### Log Entry Wrapper (Extensible Container)

Every log entry is rendered inside a **`LogEntryWrapper`** component — a generic container that wraps the type-specific content renderer. This wrapper is the extension point for future enhancements without modifying individual entry renderers.

**Initial scope (v1):** The wrapper is minimal — just a styled container with appropriate spacing and optional timestamp display. But the architecture is in place from day one.

**Future enhancements (out of scope, but the wrapper enables them):**
- Header bar with action buttons ("copy content", "open in new page", "expand to full screen")
- Collapse/expand for long entries
- Entry-level context menu
- Selection/highlighting of individual entries
- Drag-and-drop reordering

**Structure:**
```
LogEntryWrapper          ← generic container (handles chrome, actions, layout)
  └── LogEntryContent    ← type-specific renderer (log.info, input.text, etc.)
```

The key principle: **entry content renderers should only care about rendering their data.** All surrounding chrome (borders, spacing, actions, hover effects) belongs to the wrapper.

### Rendering

- Use **RenderFlexGrid** (already used by Notebook and Todo editors) — supports variable row heights via ResizeObserver
- Each entry type has its own React component (like interactive-script's `OutputItem` router), rendered inside `LogEntryWrapper`
- Active dialogs have highlighted border; completed dialogs are read-only
- Auto-scroll to bottom on new entries (with manual scroll override)
- No max entry limit — rely on virtualization for performance

## Implementation Map

### New Folders/Files

| Location | Purpose |
|----------|---------|
| `/src/renderer/editors/log-view/` | Editor — `LogViewEditor.tsx`, `LogViewModel.ts`, `logTypes.ts`, `index.ts`, `items/` (entry renderers) |
| `/src/renderer/api/types/ui.d.ts` | `IUi` facade type definitions (IntelliSense for `ui` global in scripts) |
| `/src/renderer/scripting/api-wrapper/UiFacade.ts` | Script facade — implements `ui`, `ui.dialog.*`, `ui.show.*` methods, binds to LogViewModel |

### Modified Folders

| Location | What changes |
|----------|-------------|
| `/src/renderer/scripting/ScriptContext.ts` | Add `ui` global to script sandbox context (lazy-initialized UiFacade) |
| `/src/renderer/api/mcp-handler.ts` | Add `log_push` MCP tool + active MCP log page tracking |
| `/src/renderer/api/types/index.d.ts` | Declare global `ui` variable (like `page` and `app`) |
| `/assets/editor-types/` | Copy `ui.d.ts` for Monaco IntelliSense |
| `/assets/mcp-api-guide.md` | Document `log_push` MCP tool, entry types, and "log as default AI output" guidance |
| `/src/main/mcp-http-server.ts` | Register `log_push` tool definition |

### Reused Infrastructure (no modifications expected)

| Component | From |
|-----------|------|
| `RenderFlexGrid` | `/src/renderer/components/virtualization/` |
| `ContentViewModel` base class | `/src/renderer/editors/base/` |
| Markdown rendering | `/src/renderer/editors/markdown/` (reuse remark/rehype pipeline) |
| Mermaid rendering | `/src/renderer/editors/mermaid/render-mermaid.ts` |
| Basic UI components | `/src/renderer/components/basic/` (Button, Input, etc.) |

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-137 | JSONL language support for Monaco | **Done** |
| US-138 | Grid editor support for JSONL/NDJSON files | **Done** |
| US-136 | Define LogEntry types, models, and LogViewModel | **Done** |
| US-139 | Log View editor — basic rendering of log entries | **Done** |
| US-140 | Log View editor — dialog entries (input.text, confirm, buttons) | **Done** |
| — | Styled text support (StyledSegment rendering) | **Done** (included in US-139) |

**Phase 2: Integration layer** (for already implemented log items — log messages + 3 dialogs):

| Task | Title | Status |
|------|-------|--------|
| — | Script facade: global `ui` variable (logging + dialogs) | Planned |
| — | MCP tool: `log_push` (entry array, batched dialogs, active log page) | Planned |
| — | MCP API guide update (log as default AI output channel) | Planned |

*Test all implemented items via scripts and MCP before proceeding.*

**Phase 3: New log items** (one by one, each includes renderer + script API + MCP + test):

| Task | Title | Status |
|------|-------|--------|
| — | Log item: input.checkboxes (renderer + ui.dialog.checkboxes) | Planned |
| — | Log item: input.radioboxes (renderer + ui.dialog.radioboxes) | Planned |
| — | Log item: input.select (renderer + ui.dialog.select) | Planned |
| — | Log item: output.progress (renderer + ui.show.progress) | Planned |
| — | Log item: output.grid (renderer + ui.show.grid) | Planned |
| — | Log item: output.text (renderer + ui.show.text) | Planned |
| — | Log item: output.markdown (renderer + ui.show.markdown) | Planned |
| — | Log item: output.mermaid (renderer + ui.show.mermaid) | Planned |

*Tasks will be created and assigned IDs as work begins.*

## Resolved Questions

1. **Script access:** Via global `ui` variable (top-level, like `page` and `app`). With `page` context: auto-creates and auto-groups a Log View. Without `page`: creates a standalone Log View page bound to the script context.
2. **Live streaming debounce:** 300ms debounce for UI updates. Adjustable after testing.
3. **Max entries:** No limit. Virtualized rendering handles large logs. Performance depends on user's machine.
4. **Read-only log:** Log View is read-only. No clear/reset. Only scripts/agents can append. Future enhancement may add editing (notebook-like), but out of scope.
5. **Dialog timeout:** No timeouts. But closing the Log View page while a dialog is pending resolves with `undefined` (script) or `{ button: null }` (MCP).
6. **API grouping:** `ui.log/info/warn/error/success/text` at top level, `ui.dialog.*` for interactive dialogs, `ui.show.*` for rich output. Matches interactive-script patterns. No `ui.inline.*`, `ui.window.*`, or `ui.file.*` (covered by existing `page` and `app` APIs).
7. **Dialog return types:** All dialogs return consistent objects with `button` field (e.g., `{ button: "Yes" }`, `{ button: "OK", text: "input" }`). Object format is forward-compatible — new fields can be added without breaking existing scripts.
8. **MCP approach:** Single `log_push` tool with entry array. String shorthand for simple log messages. Multiple dialogs per call supported via `Promise.all()`. Log View is the default output channel for AI agents — separate pages only when user explicitly requests a specific editor.
9. **MCP batched dialogs:** Multiple dialog entries in one `log_push` call are supported. Each dialog creates a pending promise, `Promise.all()` collects results. Tool call blocks until all dialogs are resolved.

## Notes

### 2026-03-09 (initial)
- Epic created based on interactive-script UI panel investigation
- Reference project: `D:\projects\interactive-script` — VSCode extension with script panel UI
- Key architecture from reference: ViewMessage protocol, 30+ command types, dialog lifecycle with result flow, virtualized rendering, styled text
- Adapting to js-notepad: store as .log.json, editor type, script facade, MCP integration
- Resolved all open questions: page.ui API, 300ms debounce, no max entries, read-only log, dialog cancellation on page close

### 2026-03-09 (API design refinement)
- Refined script API grouping: `ui.log/info/warn/error/success/text` (top-level), `ui.dialog.*`, `ui.show.*`
- Dropped `ui.inline.*`, `ui.window.*`, `ui.file.*` — already covered by `page` and `app` APIs
- Dialog return type: consistent `{ button, ...data }` objects for all dialogs (forward-compatible)
- Cancellation: `undefined` for scripts, `{ button: null }` for MCP — no extra `canceled` field
- MCP: single `log_push` tool with entry array, string shorthand, batched dialogs via `Promise.all()`
- MCP philosophy: Log View = default AI output channel; separate editor pages only on explicit user request
- Renamed MCP tool from `ui_push` to `log_push` for clarity
