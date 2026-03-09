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

### Log Entry Models

Each log entry in the view is backed by a **model instance**, not just raw JSON. This enables programmatic interaction with individual entries through the app API and script facade.

**Base model (`LogEntryModel`):**
- Wraps a single `LogEntry` JSON object
- Provides reactive state (entry data, status, result)
- Common interface for all entry types: `id`, `type`, `data`, `timestamp`
- Methods: `update(data)`, `toJSON()`, `dispose()`

**Type-specific subclasses** extend the base for entries that need extra behavior:
- `DialogEntryModel` — adds `result`, `resultButton`, `resolved` state, `resolve(result)` method, and a Promise that the script facade can `await`
- `ProgressEntryModel` — adds `value`, `label` state and `update(value, label)` for live progress updates
- Plain log entries (`log.info`, `log.text`, etc.) use the base `LogEntryModel` directly — no subclass needed

**`LogViewPageModel`** holds an observable array of `LogEntryModel` instances. The array is the source of truth for the view; serialization to JSON happens on save/content-read.

**Why models matter:**
- Scripts and MCP can reference and update existing entries (e.g., update a progress bar, resolve a dialog)
- The view reacts to model state changes, not to full content re-parses
- Future wrapper actions ("copy", "expand", "open in new page") operate on the model, not raw JSON

### Script API: global `ui` variable

`ui` is a **top-level script global** (like `page` and `app`), not a property on `page`. It provides the log facade for appending entries and showing dialogs.

**Resolution logic on first access:**
1. **When `page` is available** (script runs from a page): check if the grouped page exists and is a Log View → if not, create a new Log View page and auto-group it with the current page → return facade bound to that Log View
2. **When `page` is not available** (script runs without a page context): create a standalone Log View page (not grouped) → bind it to the script context → return facade bound to that page. Subsequent accesses to `ui` in the same script reuse the already-bound Log View.

```typescript
// Logging — fire and forget
ui.log.info("Processing started...");
ui.log.warn("Slow query detected");
ui.log.error("Connection failed");
ui.log.success("All done!");

// Dialogs — async, waits for user response
const name = await ui.textInput({ title: "Enter your name" });
const confirmed = await ui.confirm({ message: "Proceed?", buttons: ["No", "Yes"] });
const choice = await ui.buttons({ buttons: ["Option A", "Option B", "Option C"] });
const selected = await ui.checkboxes({ items: ["Item 1", "Item 2", "Item 3"] });

// Output
ui.progress({ label: "Loading...", value: 0.5 });
ui.grid({ columns: [...], rows: [...] });
ui.markdown("## Results\n\nFound **3** issues.");
ui.mermaid("graph TD\n  A[Start] --> B[Process]\n  B --> C[End]");
```

### Read-Only Log

The Log View editor is **read-only** — users cannot manually add or edit entries. Only scripts and AI agents can append entries programmatically. Dialogs are the only interactive elements (user fills in data, clicks buttons). In the future, the log could evolve into an editable notebook-like experience, but that is out of scope for this epic.

### Dialog Cancellation

When a script is awaiting a dialog result and the user closes the Log View page, the dialog must resolve with a **canceled** result (e.g., `{ canceled: true }`). This prevents scripts/agents from hanging indefinitely.

### Live Update Debouncing

When a script appends log entries rapidly, the UI updates are debounced at **300ms** to avoid excessive re-renders. This value may be adjusted after testing.

### MCP Integration

AI agents get a simple `ui_push` MCP command (or similar name). The agent does **not** need to find or track a Log View page — js-notepad manages an **active MCP log page** internally:

- On first `ui_push` call: js-notepad creates a new Log View page and marks it as the "active MCP log"
- Subsequent `ui_push` calls reuse the active MCP log page
- If the user closes the active MCP log page, the next `ui_push` creates a new one
- The agent just calls `ui_push` with `type` and `data` — same entry types as the script `ui` API

```
ui_push({ type: "log.info", data: "Analyzing your code..." })
ui_push({ type: "input.confirm", data: { message: "Apply changes?", buttons: ["No", "Yes"] } })
```

**How dialogs work over MCP (request-response):**

MCP is strictly request-response — there is no server-to-client push. Dialog interaction works naturally as a **blocking tool call**:

1. Agent calls `ui_push` with a dialog entry → js-notepad creates the dialog in the Log View
2. The tool call **blocks** (does not return) until the user interacts with the dialog
3. User clicks a button / enters text → js-notepad returns the tool result with the dialog response
4. Agent receives the result and continues

Log entries (non-dialog) return immediately. This means a multi-step AI interaction looks like:

```
Agent: ui_push(log.info, "Analyzing...")       → returns immediately
Agent: ui_push(input.confirm, "Apply?")        → blocks until user clicks
Agent: receives { result: "Yes" }              → continues
Agent: ui_push(log.success, "Done!")           → returns immediately
```

If the user closes the Log View page while a dialog is pending, the tool call returns `{ canceled: true }`.

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
| `/src/renderer/editors/log-view/` | New editor — `LogViewEditor.tsx`, `LogViewPageModel.ts`, `logTypes.ts`, `index.ts`, `components/` (entry renderers) |
| `/src/renderer/api/types/log-editor.d.ts` | `ILogEditor` facade type definitions (IntelliSense for scripts) |
| `/src/renderer/scripting/api-wrapper/LogEditorFacade.ts` | Script facade — implements the `ui` global's methods |

### Modified Folders

| Location | What changes |
|----------|-------------|
| `/src/shared/types.ts` | Add `PageType` for log-view, add `PageEditor` for `"log-view"` |
| `/src/renderer/editors/register-editors.ts` | Register log-view editor with `acceptFile` for `*.log.json` |
| `/src/renderer/scripting/ScriptContext.ts` | Add global `ui` variable to script sandbox context |
| `/src/renderer/api/mcp-handler.ts` | Add `ui_push` MCP command + active MCP log page tracking |
| `/src/renderer/api/types/index.d.ts` | Declare global `ui` variable (like `page` and `app`) |
| `/assets/editor-types/` | Copy new `.d.ts` files for Monaco IntelliSense |
| `/assets/mcp-api-guide.md` | Document new `ui_push` MCP command |

### Reused Infrastructure (no modifications expected)

| Component | From |
|-----------|------|
| `RenderFlexGrid` | `/src/renderer/components/virtualization/` |
| `PageModel` base class | `/src/renderer/editors/base/` |
| Markdown rendering | `/src/renderer/editors/markdown/` (reuse remark/rehype pipeline) |
| Mermaid rendering | `/src/renderer/editors/mermaid/render-mermaid.ts` |
| Basic UI components | `/src/renderer/components/basic/` (Button, Input, etc.) |

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-137 | JSONL language support for Monaco | **Done** |
| US-138 | Grid editor support for JSONL/NDJSON files | **Done** |
| US-136 | Define LogEntry types, models, and LogViewModel | **Done** |
| — | Log View editor — basic rendering of log entries | Planned |
| — | Log View editor — dialog entries (input.text, confirm, buttons) | Planned |
| — | Log View editor — additional dialogs (checkboxes, radio, select) | Planned |
| — | Log View editor — output entries (progress, grid, text, markdown, mermaid) | Planned |
| — | Script facade: global `ui` variable | Planned |
| — | MCP integration for log pages | Planned |
| — | Styled text support (StyledSegment rendering) | Planned |

*Tasks will be created and assigned IDs as work begins.*

## Resolved Questions

1. **Script access:** Via global `ui` variable (top-level, like `page` and `app`). With `page` context: auto-creates and auto-groups a Log View. Without `page`: creates a standalone Log View page bound to the script context.
2. **Live streaming debounce:** 300ms debounce for UI updates. Adjustable after testing.
3. **Max entries:** No limit. Virtualized rendering handles large logs. Performance depends on user's machine.
4. **Read-only log:** Log View is read-only. No clear/reset. Only scripts/agents can append. Future enhancement may add editing (notebook-like), but out of scope.
5. **Dialog timeout:** No timeouts. But closing the Log View page while a dialog is pending returns a canceled result to the script/agent.

## Notes

### 2026-03-09
- Epic created based on interactive-script UI panel investigation
- Reference project: `D:\projects\interactive-script` — VSCode extension with script panel UI
- Key architecture from reference: ViewMessage protocol, 30+ command types, dialog lifecycle with result flow, virtualized rendering, styled text
- Adapting to js-notepad: store as .log.json, editor type, script facade, MCP integration
- Resolved all open questions: page.ui API, 300ms debounce, no max entries, read-only log, dialog cancellation on page close
