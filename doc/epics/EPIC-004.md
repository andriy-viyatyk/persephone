# EPIC-004: Log View Editor

## Status

**Status:** Active
**Created:** 2026-03-09

## Overview

A new editor type "Log View" that displays structured logs with interactive dialogs. Inspired by the UI panel from the `interactive-script` VSCode extension. The editor is associated with `.log.jsonl` files and stores the log as JSONL (one flat JSON object per line). Scripts and AI agents can use it to display log entries (text, info, warn, error, success) and interactive dialogs (text input, confirm, buttons, checkboxes, select, etc.) — with dialog results flowing back to the caller.

## Goals

- New "log-view" editor for `.log.jsonl` files that renders a scrollable log with rich entries
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

Each log entry is a flat object with system fields (`type`, `id`, `timestamp`) plus type-specific fields at the top level:

```typescript
type LogEntry = {
    type: string;        // Entry type: "log.info", "input.text", etc.
    id: string;          // Unique ID (for dialog response tracking)
    timestamp?: number;  // When the entry was created
    [key: string]: any;  // Type-specific fields (text, message, buttons, etc.)
};
```

### Entry Types from interactive-script

**Log entries** (display-only):
- `log.log` — light/dimmed text (console.log forwarding, ui.log())
- `log.text` — plain text (default contrast)
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

1. Script/agent appends a dialog entry (e.g., `input.text`) with no `button` field
2. Log View renders the dialog as active (highlighted border, interactive controls)
3. User fills in data and clicks a button
4. Log View sets the `button` field on the flat entry and serializes to JSONL
5. If script is waiting — it receives the full flat entry via the facade's async API
6. Dialog entry remains visible in the log (read-only after completion)

### File Format (.log.jsonl)

The file content is JSONL — one flat `LogEntry` JSON object per line:

```
{"type":"log.info","id":"1","text":"Process started","timestamp":1741500000000}
{"type":"input.text","id":"2","title":"Enter name","buttons":["Cancel","OK"],"text":"John","button":"OK","timestamp":1741500001000}
{"type":"log.success","id":"3","text":"Done!","timestamp":1741500002000}
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
{"type":"log.info","id":"1","text":"Process started","timestamp":1741500000000}
{"type":"input.text","id":"2","title":"Enter name","buttons":["Cancel","OK"],"timestamp":1741500001000}
{"type":"log.success","id":"3","text":"Done!","timestamp":1741500002000}
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

**Scripting facade (`ui` global):** Calls `LogViewModel` methods directly — `addEntry()`, `addDialogEntry()`, `resolveDialog()`, `updateEntryText()`, `clear()`.

**No LogEntryModel:** Per-entry reactive model wrappers are not needed. The entries array provides both the source for rendering and the target for mutations. `LogEntryModel` was removed in US-145.

### Script API: global `ui` variable

`ui` is a **top-level script global** (like `page` and `app`), not a property on `page`. It provides the log facade for appending entries and showing dialogs.

**Resolution logic (lazy, on first `ui` access):**
1. **When `page` is available** (script runs from a page): check if the grouped page exists and is a Log View → if not, create a new Log View page and auto-group it with the current page → return facade bound to that Log View
2. **When `page` is not available** (script runs without a page context): create a standalone Log View page (not grouped) → bind it to the script context → return facade bound to that page. Subsequent accesses to `ui` in the same script reuse the already-bound Log View.

#### API Grouping

**Logging** (top-level methods, return `IStyledLogBuilder` for optional fluent styling):

```typescript
ui.log("message or StyledText")     // log.log — light/dimmed text
ui.info("message")                  // log.info — blue
ui.warn("message")                  // log.warn — yellow/orange
ui.error("message")                 // log.error — red
ui.success("message")               // log.success — green
ui.text("message")                  // log.text — default contrast
ui.clear()                          // remove all entries
```

**Dialogs** (`ui.dialog.*` — async, await user response):

All dialog methods support a **two-overload pattern**: a simple positional form and a full object form. They return `Promise<IDialogResult>` — a flat entry object. The `button` property contains the clicked button label, or `undefined` if canceled.

```typescript
// Simple form (positional args)       // Full form (single object)
ui.dialog.confirm(message, buttons?)   ui.dialog.confirm({ message, buttons? })
ui.dialog.buttons(buttons, title?)     ui.dialog.buttons({ buttons, title? })
ui.dialog.textInput(title?, options?)  ui.dialog.textInput({ title?, placeholder?, defaultValue?, buttons? })
ui.dialog.checkboxes(items, title?, buttons?)  ui.dialog.checkboxes({ items, title?, buttons? })
ui.dialog.radioboxes(items, title?, buttons?)  ui.dialog.radioboxes({ items, title?, buttons? })
ui.dialog.select(items, title?, placeholder?)  ui.dialog.select({ items, title?, placeholder? })
```

Disambiguation: `StyledText` is `string | StyledSegment[]` (always string or array). A plain non-array object is always the full form.

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

// Styled text (fluent builder)
ui.text("Status: ")
    .append("OK").color("lime").bold()
    .append(" — all checks passed")
    .print();

// Standalone styled text builder (for dialog labels, etc.)
const label = styledText("Warning").color("red").bold().value;
await ui.dialog.confirm(label);

// Confirm dialog
const result = await ui.dialog.confirm("Proceed with changes?");
if (!result.button) return;             // canceled (page was closed)
if (result.button === "Yes") {
    ui.success("Changes applied!");
}

// Text input with validation
const input = await ui.dialog.textInput("Enter your name", {
    placeholder: "Name...",
    buttons: ["Cancel", "!OK"],        // ! = required (disabled when empty)
});
if (!input.button) return;
ui.log(`Hello ${input.text}`);

// Checkboxes
const items = await ui.dialog.checkboxes(
    ["Item 1", "Item 2", "Item 3"],
    "Select items to process",
);
if (!items.button) return;
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

When a script is awaiting a dialog result and the user closes the Log View page, the dialog promise resolves with an object where `button` is `undefined`. The result is always an object — never `undefined` itself. Scripts check for cancellation by testing the `button` property:

```typescript
const result = await ui.dialog.confirm("Proceed?");
if (!result.button) return;  // canceled — page was closed
```

For MCP, canceled dialogs return `{ button: null }` in the results array (using `null` instead of `undefined` since JSON doesn't support `undefined`).

### Live Update Debouncing

When a script appends log entries rapidly, the UI updates are debounced at **300ms** to avoid excessive re-renders. This value may be adjusted after testing.

### MCP Integration

AI agents get a single `ui_push` MCP tool. The agent does **not** need to find or track a Log View page — js-notepad manages an **active MCP log page** internally:

- On first `ui_push` call: js-notepad creates a new Log View page and marks it as the "active MCP log"
- Subsequent `ui_push` calls reuse the active MCP log page
- If the user closes the active MCP log page, the next `ui_push` creates a new one
- The agent sends an array of entries — same types as the script `ui` API

#### Tool: `ui_push`

**Parameters:**

```typescript
{
    entries: Array<string | { type: string; [key: string]: any }>
    // String shorthand: treated as log.info
    // Object: flat entry with type + type-specific fields
}
```

**Entry type mapping (matches script API):**

| Script API method | Entry type | Fields (flat, top-level) |
|-------------------|------------|--------------------------|
| `ui.log()` | `log.log` | `text: StyledText` |
| `ui.info()` | `log.info` | `text: StyledText` |
| `ui.warn()` | `log.warn` | `text: StyledText` |
| `ui.error()` | `log.error` | `text: StyledText` |
| `ui.success()` | `log.success` | `text: StyledText` |
| `ui.dialog.confirm()` | `input.confirm` | `message, buttons?` |
| `ui.dialog.buttons()` | `input.buttons` | `buttons, title?` |
| `ui.dialog.textInput()` | `input.text` | `title?, placeholder?, defaultValue?, buttons?` |
| `ui.dialog.checkboxes()` | `input.checkboxes` | `items, title?, buttons?` |
| `ui.dialog.radioboxes()` | `input.radioboxes` | `items, title?, buttons?` |
| `ui.dialog.select()` | `input.select` | `items, title?, placeholder?` |
| `ui.show.progress()` | `output.progress` | `label?, value, max?` |
| `ui.show.grid()` | `output.grid` | `columns, rows, title?` |
| `ui.show.text()` | `output.text` | `text, language?, title?` |
| `ui.show.markdown()` | `output.markdown` | `text` |
| `ui.show.mermaid()` | `output.mermaid` | `text` |

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
ui_push({ entries: ["Analyzing your code...", "Found 3 files to process"] })
→ returns immediately: { }

// Mixed log + dialog (flat entries — fields at top level)
ui_push({ entries: [
    { type: "log.info", text: "Analysis complete." },
    { type: "input.confirm", message: "Apply changes?", buttons: ["No", "Yes"] }
]})
→ blocks until user clicks → { results: [{ button: "Yes", message: "Apply changes?", ... }] }

// Multiple dialogs in one call
ui_push({ entries: [
    { type: "input.text", title: "Project name", buttons: ["OK"] },
    { type: "input.select", title: "Language", items: ["TypeScript", "JavaScript", "Python"] }
]})
→ blocks until BOTH dialogs resolved → { results: [{ button: "OK", text: "my-app", ... }, { button: "OK", selected: "TypeScript", ... }] }

// Rich output
ui_push({ entries: [
    { type: "output.grid", columns: ["File", "Issues"], rows: [["app.ts", 3], ["index.ts", 1]] },
    { type: "output.markdown", text: "## Summary\n\nFixed **4** issues." },
    { type: "output.mermaid", text: "graph TD\n  A[Scan] --> B[Fix] --> C[Done]" }
]})
→ returns immediately: { }
```

**MCP as default output for AI agents:**

The Log View is the **preferred output channel** for AI agents. When the user asks the agent to "show something" in js-notepad, the agent should use `ui_push` with appropriate `output.*` entries (grid, markdown, mermaid) rather than creating separate editor pages. Separate pages (`create_page`) are only for when the user explicitly asks to open data in a specific editor. This will be documented in the MCP API guide (`/assets/mcp-api-guide.md`).

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
| `/src/renderer/api/types/ui-log.d.ts` | `IUiLog` facade type definitions (IntelliSense for `ui` global in scripts) |
| `/src/renderer/scripting/api-wrapper/UiFacade.ts` | Script facade — implements `ui`, `ui.dialog.*`, `ui.show.*` methods, binds to LogViewModel |

### Modified Folders

| Location | What changes |
|----------|-------------|
| `/src/renderer/scripting/ScriptContext.ts` | Add `ui` global to script sandbox context (lazy-initialized UiFacade) |
| `/src/renderer/api/mcp-handler.ts` | Add `ui_push` MCP tool + active MCP log page tracking |
| `/src/renderer/api/types/index.d.ts` | Declare global `ui` variable (like `page` and `app`) |
| `/assets/editor-types/` | Copy `ui-log.d.ts` for Monaco IntelliSense |
| `/assets/mcp-api-guide.md` | Document `ui_push` MCP tool, entry types, and "log as default AI output" guidance |
| `/src/main/mcp-http-server.ts` | Register `ui_push` tool definition |

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
| US-141 | Script facade: global `ui` variable (logging + dialogs) | **Done** |
| US-142 | Log View polish: StyledTextBuilder, dialog UX, ScriptRunner fix | **Done** |
| US-143 | MCP tool: `ui_push` (entry array, batched dialogs, active log page) + API guide update | **Done** |
| US-144 | MCP: split API guide into focused resources + server instructions | **Done** |

*Test all implemented items via scripts and MCP before proceeding.*

**Phase 2.5: Refactoring** (prerequisites for Phase 3):

| Task | Title | Status |
|------|-------|--------|
| US-145 | Flatten LogEntry structure — remove `data` nesting | **Done** |
| US-146 | Standardize ui API — two-overload pattern (full object + simple positional) | **Done** |

**Phase 3: New log items** (one by one, each includes renderer + script API + MCP + test):

| Task | Title | Status |
|------|-------|--------|
| US-148 | Console forwarding to Log View + MCP Log View sharing | **Done** |
| US-147 | Log item: input.checkboxes (renderer + ui.dialog.checkboxes) | **Done** |
| US-149 | Log item: input.radioboxes (renderer + ui.dialog.radioboxes) | **Done** |
| US-150 | Log item: input.select (renderer + ui.dialog.select) | **Done** |
| US-151 | Log item: output.progress (renderer + ui.show.progress) | **Done** |
| US-152 | Log item: output.grid (renderer + ui.show.grid) | **Done** |
| US-153 | Log item: output.text (renderer + ui.show.text) | **Done** |
| US-155 | Extract MarkdownBlock reusable component | **Done** |
| US-154 | Log item: output.markdown (renderer + ui.show.markdown) | Planned |
| — | Log item: output.mermaid (renderer + ui.show.mermaid) | Planned |

*Tasks will be created and assigned IDs as work begins.*

## Resolved Questions

1. **Script access:** Via global `ui` variable (top-level, like `page` and `app`). With `page` context: auto-creates and auto-groups a Log View. Without `page`: creates a standalone Log View page bound to the script context.
2. **Live streaming debounce:** 300ms debounce for UI updates. Adjustable after testing.
3. **Max entries:** No limit. Virtualized rendering handles large logs. Performance depends on user's machine.
4. **Read-only log:** Log View is read-only. No clear/reset. Only scripts/agents can append. Future enhancement may add editing (notebook-like), but out of scope.
5. **Dialog timeout:** No timeouts. But closing the Log View page while a dialog is pending resolves with `{ button: undefined }` (script) or `{ button: null }` (MCP). The result is always an object.
6. **API grouping:** `ui.log/info/warn/error/success/text` at top level, `ui.dialog.*` for interactive dialogs, `ui.show.*` for rich output. Matches interactive-script patterns. No `ui.inline.*`, `ui.window.*`, or `ui.file.*` (covered by existing `page` and `app` APIs).
7. **Dialog return types:** All dialogs always return an object with `button` field (e.g., `{ button: "Yes" }`, `{ button: "OK", text: "input" }`). On cancellation, `button` is `undefined` (script) or `null` (MCP) — the result itself is never `undefined`. Object format is forward-compatible — new fields can be added without breaking existing scripts.
8. **MCP approach:** Single `ui_push` tool with entry array. String shorthand for simple log messages. Multiple dialogs per call supported via `Promise.all()`. Log View is the default output channel for AI agents — separate pages only when user explicitly requests a specific editor. Named `ui_push` (not `ui_push`) for consistency with the script `ui` global — the tool handles logs, dialogs, and output items, not just log messages.
9. **MCP batched dialogs:** Multiple dialog entries in one `ui_push` call are supported. Each dialog creates a pending promise, `Promise.all()` collects results. Tool call blocks until all dialogs are resolved. IPC timeout is infinite for dialog-containing requests (users can take breaks and return).

## Notes

### 2026-03-09 (initial)
- Epic created based on interactive-script UI panel investigation
- Reference project: `D:\projects\interactive-script` — VSCode extension with script panel UI
- Key architecture from reference: ViewMessage protocol, 30+ command types, dialog lifecycle with result flow, virtualized rendering, styled text
- Adapting to js-notepad: store as .log.jsonl, editor type, script facade, MCP integration
- Resolved all open questions: page.ui API, 300ms debounce, no max entries, read-only log, dialog cancellation on page close

### 2026-03-09 (API design refinement)
- Refined script API grouping: `ui.log/info/warn/error/success/text` (top-level), `ui.dialog.*`, `ui.show.*`
- Dropped `ui.inline.*`, `ui.window.*`, `ui.file.*` — already covered by `page` and `app` APIs
- Dialog return type: consistent `{ button, ...data }` objects for all dialogs (forward-compatible)
- Cancellation: `{ button: undefined }` for scripts, `{ button: null }` for MCP — result is always an object, never `undefined` itself
- MCP: single `ui_push` tool with entry array, string shorthand, batched dialogs via `Promise.all()`
- MCP philosophy: Log View = default AI output channel; separate editor pages only on explicit user request
- Initially renamed to `ui_push`, later reverted to `ui_push` for consistency with `ui` API name (covers logs + dialogs + output, not just logs)

### 2026-03-10 (US-142: Log View polish)
- Implemented `StyledTextBuilder` / `StyledLogBuilder` fluent API — logging methods now return builders for `.append().color().bold().print()` chaining
- Added standalone `styledText()` global for building styled text in dialog labels
- `LogViewModel.updateEntryText()` — immediate serialization to prevent race conditions with page setup
- Dialog UX: fit-content width, button padding, force scroll-to-bottom on dialog entries (`forceScrollVersion`)
- Iterative auto-scroll (3 follow-ups at 50/150/300ms) to compensate for async ResizeObserver height adjustments
- `RenderFlexGrid.preferMinHeightForNewRows` — prevents height jumping for new rows
- `ScriptRunner.wrapScriptWithImplicitReturn` — fixed block-closer (`});`, `];`) handling

### 2026-03-10 (US-143: MCP `ui_push` tool)
- Implemented `ui_push` MCP tool — AI agents can push entries (log messages, dialogs, output items) to a managed Log View page
- Tool name reverted from `ui_push` to `ui_push` for consistency with script `ui` global (covers all entry categories, not just logs)
- Active MCP log page tracking in `mcp-handler.ts`: auto-creates on first call, reuses on subsequent, recreates if user closes
- `sendToRenderer` now accepts optional `timeoutMs` parameter (0 = no timeout). Dialog-containing `ui_push` calls use infinite timeout so users can take breaks
- String shorthand: plain strings in entries array treated as `log.info`
- Batched dialogs: multiple `input.*` entries per call resolved via `Promise.all()`, tool blocks until all resolved
- Canceled dialogs return `{ button: null }` (JSON-safe, vs `undefined` for scripts)
- MCP API guide (`assets/mcp-api-guide.md`) updated with full `ui_push` documentation, entry types, examples, and "when to use" guidance
- Phase 2 now complete — all integration layer tasks done (scripts + MCP)

### 2026-03-10 (US-144: MCP resource split + server instructions)
- Split monolithic `assets/mcp-api-guide.md` (509 lines) into 3 focused resources: `mcp-res-ui-push.md`, `mcp-res-pages.md`, `mcp-res-scripting.md`
- Added `notepad://guides/full` resource that dynamically concatenates all 3 files (no content duplication)
- Added MCP server `instructions` — immediate context sent to agents on connection (workflow overview, resource pointers, quick tips)
- Resource URIs changed from `notepad://docs/api-guide` to `notepad://guides/*`
- Agents now get immediate context without reading any resource, and can read only the specific guide they need

### 2026-03-10 (US-147: input.checkboxes dialog)
- First Phase 3 log item: `input.checkboxes` — checkbox list dialog with optional title, layout modes, and custom buttons
- New reusable `Checkbox` component in `components/basic/` using `CheckedIcon`/`UncheckedIcon` icons for consistency with Todo editor, Grid, and ListMultiselect
- `CheckboxItem` type: `{ label: string; checked?: boolean }` — items stored as objects in the flat entry
- `ui.dialog.checkboxes()` with two-overload pattern; simple form accepts string[] (auto-normalized to objects)
- `!` button prefix disables button when no item is checked (`requirementNotMet`)
- Updated `RadioboxesEntry` stub: `checked?: string` (single selected item by label, prevents misconfiguration)
