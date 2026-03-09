# US-136: Define LogEntry types, models, and LogViewModel

## Status

**Status:** Planned
**Priority:** High
**Epic:** EPIC-004
**Depends on:** US-137 (JSONL language support)
**Started:** —
**Completed:** —

## Summary

Define the foundational type system, entry models, and content view model for the Log View editor. This is the data layer that all subsequent tasks (rendering, scripting, MCP) build upon.

## Why

- Every other EPIC-004 task depends on these types and models
- The model layer must be designed correctly upfront — it determines how entries are created, updated, serialized, and rendered
- Getting the `LogEntryModel` base class right ensures the `LogEntryWrapper` and script facade can work with entries generically

## Reference: interactive-script

The type system is inspired by `D:\projects\interactive-script`. Key patterns adapted:

| interactive-script | js-notepad Log View |
|---|---|
| `ViewMessage<T, C>` with `command` discriminator | `LogEntry<T>` with `type` discriminator |
| `commandId: string` (UUID) | `id: string` (auto-generated) |
| `data?: T` payload | `data: T` payload |
| Plain objects, no model classes | **Plain objects + lazy model wrappers** (`LogEntryModel`) — models created on demand for visible/accessed entries |
| `result` + `resultButton` on dialog data | Same pattern, stored inside `data` |
| `UiText = string \| TextWithStyle[]` | `StyledText = string \| StyledSegment[]` |
| `useItemState()` per-item UI state | Model instance holds its own reactive state |

**Key difference:** interactive-script uses plain objects because it's a VSCode webview with postMessage communication. js-notepad needs model instances because entries are manipulated programmatically by scripts and MCP, with reactive UI updates.

## Acceptance Criteria

- [ ] `logTypes.ts` — all LogEntry type definitions (log, dialog, output entry types)
- [ ] `StyledText` type for styled text segments
- [ ] `LogEntryModel` class with reactive state, `toJSON()`, `update()`, `flush()`, `dispose()`
- [ ] Dialog promise management on `LogViewModel` (`pendingDialogs` map, `addDialogEntry`, `resolveDialog`)
- [ ] `LogViewModel` extending `ContentViewModel` — JSONL parsing, entry management, lazy models
- [ ] `PageEditor` extended in shared types (add `"log-view"`)
- [ ] Editor registered in `register-editors.ts` (minimal — just the registration, no rendering yet)
- [ ] `.log.jsonl` file opens with log-view editor (acceptFile)
- [ ] Can switch to Monaco editor to view raw JSONL content
- [ ] No regressions in existing functionality

## Technical Approach

### Architecture Decision: content-view category with JSONL format

Log View is a **content-view** (like Grid, Notebook, Todo), not a page-editor. Rationale:

- **Consistency:** All structured editors in js-notepad are content-views that share `TextFileModel`
- **Monaco switching:** Users can switch to Monaco to view/edit the underlying data — essential for debugging and transparency
- **Existing infrastructure:** TextFileModel provides file I/O, content change detection, state storage, and content hosting for free

**File format: JSONL (`.log.jsonl`)** — one JSON object per line, not a JSON array:

```
{"type":"log.info","id":"1","data":"Process started","timestamp":1741500000000}
{"type":"input.text","id":"2","data":{"title":"Enter name","buttons":["Cancel","OK"]}}
{"type":"log.success","id":"3","data":"Done!","timestamp":1741500002000}
```

**Why JSONL over JSON array:**
- **O(1) append:** Adding a new entry = append one line to content string (no full re-parse/re-serialize)
- **Incremental parsing:** On content change, only parse new lines (track last known line count)
- **Large logs:** No need to parse/serialize thousands of entries on every mutation
- **Standard format:** JSONL is widely used for logs and data processing — useful beyond just Log View

**Prerequisite:** US-137 adds `jsonl` language support to Monaco (syntax highlighting, proper tokenization).

### Type Definitions (`logTypes.ts`)

```typescript
// -- Styled Text --
interface StyledSegment { text: string; styles?: Record<string, string | number>; }
type StyledText = string | StyledSegment[];

// -- Base Entry --
interface LogEntry<T = any> {
    type: string;       // Discriminator: "log.info", "input.text", etc.
    id: string;         // Unique ID
    data: T;            // Type-specific payload
    timestamp?: number; // When created
}

// -- Log Entries (display-only) --
// log.text, log.info, log.warn, log.error, log.success
// data: StyledText

// -- Dialog Entries (interactive) --
// input.confirm  — data: { message: StyledText, buttons?: string[] }
// input.text     — data: { title?: StyledText, placeholder?: string, defaultValue?: string, buttons?: string[] }
// input.buttons  — data: { title?: StyledText, buttons: string[] }
// input.checkboxes — data: { title?: StyledText, items: string[], buttons?: string[] }
// input.radioboxes — data: { title?: StyledText, items: string[], buttons?: string[] }
// input.select   — data: { title?: StyledText, items: string[], placeholder?: string }
//
// All dialog data types include:
//   result?: <type-specific>
//   resultButton?: string

// -- Output Entries (rich display) --
// output.progress — data: { label?: StyledText, value: number, max?: number }
// output.grid     — data: { title?: StyledText, columns: string[], rows: any[][] }
// output.text     — data: { title?: StyledText, text: string, language?: string }
// output.markdown — data: { text: string }
// output.mermaid  — data: { text: string }
```

### Model Classes (Lazy Instantiation)

**Key principle:** The log can contain thousands of entries (e.g., a long-running script). Creating a model instance for every entry upfront is wasteful — only ~20-30 entries are visible at any time (virtualized grid). Models are created **on demand** and cached.

**Storage: plain `LogEntry[]` array is the source of truth.** Models wrap individual entries when needed.

**When a model is created:**
- **Rendering:** The virtualized grid requests a model for a visible entry → `getModel(index)` creates/returns cached model
- **Programmatic access:** Script or MCP calls `getEntry(id)` → creates/returns cached model

**When a model is released (cache eviction):**

`RenderFlexGrid` has an `onAdjustRenderRange(rendered)` callback that fires on every viewport change with the currently rendered row range. The Log View editor uses this to drive cache eviction:

```
RenderFlexGrid.onAdjustRenderRange(rendered) →
  LogViewModel.setRenderedRange(rendered.top, rendered.bottom) →
    evict models whose index is outside rendered range
```

**Eviction rules:**
- Models for entries **outside** the rendered range are flushed and disposed
- `model.flush()` writes any state changes back to the underlying `LogEntry` object, then disposes
- **All models are evictable** — no pinning, no special cases (see "Dialog promises" below)
- Eviction is **debounced** (e.g., 500ms) to avoid thrashing during fast scrolling
- During auto-scroll (new entries arriving), eviction naturally keeps only the tail entries cached

**Auto-scroll scenario:** When a script produces 1000 log entries, each one briefly enters the viewport as the log auto-scrolls. Without eviction, all 1000 models would accumulate. With range-based eviction, only the ~20-30 visible entries (+ overscan buffer) keep models at any time. As new entries arrive at the bottom, old entries at the top get evicted.

**State preservation:** When a model is flushed/disposed, its current data is written back to the plain `LogEntry` in the array. When the model is re-created later (entry scrolls back into view), it reads from that same `LogEntry` — so state is never lost.

**`LogEntryModel`** (single class, no subclasses):
- Wraps a `LogEntry` plain object reference
- `TOneState` for reactive `data` (so the view re-renders on changes)
- `id`, `type`, `timestamp` are immutable after creation
- `update(data)` — merges new data, triggers state update, writes back to plain object
- `toJSON()` — returns the underlying plain `LogEntry` object
- `flush()` — syncs state back to plain object
- `dispose()` — flush + cleanup
- No Promise management, no special dialog/progress logic — the model is purely a reactive wrapper

**No `DialogEntryModel` or `ProgressEntryModel` subclasses.** All entry-specific behavior lives on `LogViewModel` (see below).

### Dialog Promises (on LogViewModel, not on models)

Inspired by interactive-script's `ResponseHandler` pattern. Dialog Promises are managed by `LogViewModel` in a separate map, completely decoupled from entry models:

```typescript
// On LogViewModel:
pendingDialogs: Map<string, { resolve: (result: DialogResult) => void }>
```

**Flow:**
1. `addDialogEntry(type, data)` → creates plain `LogEntry`, appends to entries[], creates Promise, stores resolve callback in `pendingDialogs` map, returns the Promise
2. User interacts with dialog → `resolveDialog(id, result, resultButton)` → updates plain `LogEntry` data fields, calls `pendingDialogs.get(id).resolve(result)`, removes from map. If a model is cached for this entry, updates it too
3. Page closed with pending dialogs → `onDispose()` iterates `pendingDialogs`, calls each resolve with `{ canceled: true }`

**Why this is better than model-based promises:**
- Models are freely evictable — no pinning needed, no special cases in eviction logic
- Dialog state (`result`, `resultButton`) lives in the plain `LogEntry` object — survives model eviction
- The Promise is a lightweight map entry (just an ID + callback), not a full `TOneState` model
- Progress updates work the same way: `updateEntry(id, data)` modifies the plain object; if a model happens to be cached, it picks up the change

### `LogViewModel` (ContentViewModel)

Extends `ContentViewModel` (like NotebookViewModel, TodoViewModel):

```typescript
const defaultLogViewState = {
    entries: [] as LogEntry[],     // Plain objects — source of truth
    entryCount: 0,                 // For UI reactivity
    error: undefined as string | undefined,
};
```

**Key responsibilities:**
- `entries: LogEntry[]` — plain object array in state
- `modelCache: Map<string, LogEntryModel>` — lazily created models, keyed by entry ID
- `pendingDialogs: Map<string, { resolve }>` — Promise resolve callbacks for unresolved dialogs
- `addEntry(type, data)` — creates `LogEntry`, appends JSONL line to host content, updates entries array
- `addDialogEntry(type, data)` — like `addEntry` but also creates Promise, stores resolve callback, returns Promise
- `resolveDialog(id, result, resultButton)` — updates plain entry, resolves Promise, updates cached model if any
- `updateEntry(id, data)` — updates plain entry data (for progress, etc.), updates cached model if any
- `getModel(index)` — returns cached model or creates one on demand from the plain entry at index
- `setRenderedRange(top, bottom)` — evicts models outside range (debounced)
- `getEntry(id)` — returns model (creates if needed) for programmatic access
- `clear()` — remove all entries, dispose all cached models, clear host content
- Auto-incrementing ID counter (simple `"1"`, `"2"`, ...)

**JSONL serialization strategy:**
- **On file open (`onInit`):** Split content by newlines → parse each line as JSON → populate `entries[]`
- **On append (`addEntry`):** Create `LogEntry` object → push to `entries[]` → append one JSONL line to host content (no full re-serialize)
- **On entry update (dialog result, progress):** Update plain object in `entries[]` → re-serialize the specific line → update host content with debounce
- **On external content change (`onContentChanged`):** Incremental parse — compare new line count vs known entries, parse only new/changed lines
- **Skip-loop:** Uses `skipNextContentUpdate` pattern (same as Notebook/Todo) to avoid reacting to own writes

**Incremental parsing detail:**
```
Known entries: 100 lines
New content: 105 lines
→ Only parse lines 101-105 as new entries
→ If lines 1-100 changed (edit in Monaco), full re-parse
```

### Shared Types Changes

```typescript
// src/shared/types.ts
PageEditor: add "log-view"
// No new PageType needed — content-views use "textFile"
```

### Editor Registration

Minimal registration in `register-editors.ts`:
- `id: "log-view"`, `category: "content-view"`, `pageType: "textFile"`
- `acceptFile`: `*.log.jsonl` → priority 20
- `validForLanguage`: `(lang) => lang === "jsonl"`
- `isEditorContent`: regex check for JSONL log entries (e.g., `/"type"\s*:\s*"log\./.test(content)`)
- `loadModule`: dynamic import (returns placeholder editor for now)

## Files to Create/Modify

### New Files

| File | Purpose |
|------|---------|
| `src/renderer/editors/log-view/logTypes.ts` | All type definitions (LogEntry, dialog data, output data, StyledText) |
| `src/renderer/editors/log-view/LogEntryModel.ts` | Base model + DialogEntryModel + ProgressEntryModel |
| `src/renderer/editors/log-view/LogViewModel.ts` | ContentViewModel with JSONL parsing, entry management, lazy models |
| `src/renderer/editors/log-view/index.ts` | Editor module export (placeholder editor component) |

### Modified Files

| File | Change |
|------|--------|
| `src/shared/types.ts` | Add `"log-view"` to PageEditor |
| `src/renderer/editors/register-editors.ts` | Register log-view editor |

## Implementation Progress

### Phase 1: Type Definitions
- [ ] Create `logTypes.ts` with all entry type interfaces
- [ ] Define `StyledText` / `StyledSegment` types
- [ ] Define discriminated union helpers (type guards like `isDialogEntry()`, `isLogEntry()`)

### Phase 2: Entry Model
- [ ] Implement `LogEntryModel` class with TOneState, toJSON, update, flush, dispose
- [ ] Single class — no subclasses needed (dialog/progress behavior lives on LogViewModel)

### Phase 3: View Model
- [ ] Implement `LogViewModel` extending ContentViewModel
- [ ] JSONL parsing in `onInit()` — split by newlines, parse each line
- [ ] Incremental parsing in `onContentChanged()` — detect new/changed lines
- [ ] `addEntry()` — append JSONL line to host content (O(1), no full re-serialize)
- [ ] Lazy model cache (`getModel`, `setRenderedRange` eviction)
- [ ] Dialog promise management (`pendingDialogs` map, `addDialogEntry`, `resolveDialog`, cancel on dispose)
- [ ] `updateEntry()` — update plain object + cached model if any (for progress, etc.)
- [ ] Skip-loop pattern for own content writes
- [ ] ID generation (auto-incrementing counter, restored from max existing ID on load)

### Phase 4: Registration & Wiring
- [ ] Add `"log-view"` to PageEditor in `src/shared/types.ts`
- [ ] Create placeholder `index.ts` with minimal editor component
- [ ] Register in `register-editors.ts` (content-view, acceptFile for `.log.jsonl`)
- [ ] Verify `.log.jsonl` files open with log-view editor
- [ ] Verify switching to Monaco shows raw JSONL content

## Concerns

### 1. Content-view with JSONL — serialization overhead

**Concern:** Content-views serialize through `host.changeContent()`. For large logs, re-serializing the entire JSONL string on every entry append could be expensive.

**Resolution:** JSONL format makes this manageable:
- **Append:** `host.changeContent(currentContent + "\n" + JSON.stringify(newEntry))` — string concatenation, not full re-serialize
- **Update (dialog result):** Replace one specific line — split/join or regex replace on the line containing the entry ID, then debounced `changeContent()`
- **Debounce:** Updates to host content are debounced (300ms for rapid appends). Multiple appends within the debounce window batch into a single `changeContent()` call
- For extremely large logs (10k+ entries), the string concatenation is still O(n) due to string immutability, but JSONL avoids the JSON.parse/stringify overhead of a JSON array

### 2. Entry ID strategy

**Concern:** Should IDs be UUIDs (like interactive-script's `commandId`) or simple incrementing numbers?

**Recommendation:** Simple incrementing integers as strings (`"1"`, `"2"`, ...). UUIDs add overhead and aren't needed — IDs only need to be unique within a single log page. The counter lives on `LogViewModel` and resets when loading from file (max existing ID + 1).

### 3. Large entry arrays — lazy model instantiation and eviction

**Concern:** A log can contain thousands of entries. Creating a `LogEntryModel` with `TOneState` for each one would be wasteful — only ~20-30 are visible at any time. During auto-scroll (script producing rapid output), every entry briefly enters the viewport, so without cleanup all models would accumulate.

**Resolution:** Models are created on demand and evicted via `RenderFlexGrid`'s `onAdjustRenderRange` callback. The grid reports which row indices are currently rendered → view model evicts models outside that range (debounced, 500ms). **All models are freely evictable** — no pinning needed because dialog promises live on the view model (not on models), and entry state is always preserved in the plain `LogEntry` objects.

### 4. Incremental parsing edge cases

**Concern:** When the user edits raw JSONL in Monaco (switches to text editor), the incremental parser may encounter invalid JSON lines or reordered entries.

**Resolution:**
- Invalid lines are skipped with a warning (or shown as error entries in the log view)
- If line count decreased or lines changed in the middle, fall back to full re-parse
- Simple heuristic: if `newLineCount < knownEntryCount` or first lines differ → full re-parse; otherwise parse only new trailing lines

### 5. Dialog promise lifecycle

**Concern:** If a script appends a dialog and the Log View page is closed before the user responds, the promise must not hang forever.

**Resolution:** `LogViewModel.onDispose()` iterates the `pendingDialogs` map and calls each resolve callback with `{ canceled: true }`. Since promises live on the view model (not on entry models), this works regardless of whether the dialog's model is currently cached or evicted.

## Notes

### 2026-03-09
- Task created as first task of EPIC-004
- Initially designed as page-editor; changed to content-view after review — consistency with existing editors and Monaco switching are more important
- Changed file format from JSON array (`.log.json`) to JSONL (`.log.jsonl`) for O(1) append and incremental parsing
- Added US-137 as prerequisite for JSONL language support in Monaco
- Adapted interactive-script's plain-object approach with lazy model wrappers for performance
- Key architectural differences from interactive-script documented in Reference section

## Related

- **Prerequisite:** [US-137 — JSONL language support for Monaco](../US-137-jsonl-language/README.md)
- Epic: [EPIC-004 — Log View Editor](../../epics/EPIC-004.md)
- Reference: `D:\projects\interactive-script` (VSCode extension with UI panel)
- Pattern reference: [NotebookViewModel](../../../src/renderer/editors/notebook/NotebookViewModel.ts), [TodoViewModel](../../../src/renderer/editors/todo/TodoViewModel.ts)
