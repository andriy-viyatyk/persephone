# US-151: Log item: output.progress (renderer + ui.show.progress)

**Epic:** EPIC-004
**Status:** Planned

## Goal

Add `output.progress` entry type to the Log View editor — a progress bar with label, value, max, and completed state. Includes renderer component, a `Progress` helper object returned by `ui.show.progress()`, MCP support, and type declarations.

## Background

### Reference: interactive-script Progress helper

The user wants the API to match the pattern from `D:\projects\interactive-script`:

```typescript
// Usage from demo script
let progress = ui.show.progress("Progress Demo");
progress.max = 100;
progress.value = 0;
progress.label = "Calculating...";
// ... loop updating progress.value ...
progress.completed = true;
progress.label = styledText("Done!").color("gold").value;

// Also supports promise-based completion:
progress = ui.show.progress("Loading...");
progress.completeWithPromise(somePromise, styledText("Done.").color("palegreen").value);
```

The `Progress` class has **getters/setters** for `label`, `value`, `max`, `completed`. Each setter triggers an update to the underlying entry.

### Existing type definition (partially done)

`ProgressOutputEntry` is defined in `logTypes.ts:114-119`:

```typescript
export interface ProgressOutputEntry extends LogEntryBase {
    type: "output.progress";
    label?: StyledText;
    value: number;
    max?: number;
}
```

Needs to become:

```typescript
export interface ProgressOutputEntry extends LogEntryBase {
    type: "output.progress";
    label?: StyledText;
    value?: number;
    max?: number;
    completed?: boolean;
}
```

Changes:
- `value` → `value?` (optional — may not be set yet on creation)
- Added `completed?: boolean` — marks progress as done (shows filled bar or check)

Already included in `OUTPUT_TYPES` set and handled by `isOutputEntry()` type guard.

### Key difference from dialogs

Output entries are **not interactive** — they don't block scripts or return Promises. Instead:
- `ui.show.progress(label)` creates the entry and returns a `Progress` helper synchronously
- The `Progress` helper has property setters that call `updateEntryById()` on the LogViewModel
- Updates are **debounced** (entry goes through `updateEntryAt` → `dirtyIndices` → `flushDirtyDebounced`)
- No Promise resolution, no `button` field

### LogViewModel update mechanism

The VM already has `updateEntryAt(index, updater)` which marks entries dirty for debounced serialization. But Progress needs to update **by ID** (not index) because the script holds a reference to the entry ID, not the array index.

We need a new method: `updateEntryById(id, updater)` — finds the entry by ID and delegates to `updateEntryAt`.

### Rendering concerns

Progress is the **first output entry** to be rendered. Unlike dialogs that have a bordered `DialogContainer`, output entries should have a lighter visual style — they're display-only content, not interactive.

The progress bar visual:
- Label text (styled text support) above or to the left of the bar
- A horizontal bar showing `value / max` fill ratio
- When `completed = true`: bar fully filled with a success color
- When `value` is undefined or 0 and not completed: empty/indeterminate bar
- No border/container needed — it's inline content in the log flow

### Color tokens

Available from `color.ts`:
- `color.misc.blue` — good for progress fill
- `color.misc.green` / `color.success.text` — good for completed state
- `color.background.dark` — good for progress bar track
- `color.text.default` / `color.text.light` — label text

### UiFacade: `show` property

Currently `readonly show: undefined = undefined;` (Phase 3 stub). Needs to become an object with `progress` method. This is the first `show` method, so the `show` property pattern needs to be established.

### MCP: Already handled

The generic `handleUiPush()` in `mcp-handler.ts` routes all entry types through `addEntry()`. Output entries go through the same path as log entries — no special MCP handler needed. The MCP tool call returns immediately (no blocking like dialogs).

However, MCP cannot use the `Progress` helper (it sends flat entries). For MCP, updating a progress bar requires sending a new `ui_push` with the same entry `id` — this needs a new mechanism: **update-by-id** support in the MCP handler (or a separate `ui_update` mechanism).

**Decision needed:** For the first iteration, MCP progress support can be limited to static entries (create-only, no updates). The helper object pattern is primarily for scripts. MCP update support can be added later as a separate enhancement.

## Implementation Plan

### Step 1: Update `ProgressOutputEntry` type

**File:** `src/renderer/editors/log-view/logTypes.ts` (MODIFY)

```typescript
export interface ProgressOutputEntry extends LogEntryBase {
    type: "output.progress";
    label?: StyledText;
    value?: number;
    max?: number;
    completed?: boolean;
}
```

### Step 2: Add `updateEntryById` and upsert logic to LogViewModel

**File:** `src/renderer/editors/log-view/LogViewModel.ts` (MODIFY)

**2a.** Add `updateEntryById` method after `updateEntryAt`:

```typescript
/** Update an entry by ID. Finds the entry and delegates to updateEntryAt. */
updateEntryById(id: string, updater: (draft: LogEntry) => void): void {
    const index = this.state.get().entries.findIndex((e) => e.id === id);
    if (index >= 0) {
        this.updateEntryAt(index, updater);
    }
}
```

**2b.** Modify `addEntry` to support **upsert** — if `fields.id` is provided and an entry with that ID already exists, update it in-place instead of appending:

```typescript
addEntry(type: string, fields: any): LogEntry {
    const id = fields?.id != null ? String(fields.id) : String(this.nextId++);
    // Ensure nextId stays ahead of any user-provided id
    const numId = parseInt(id, 10);
    if (!isNaN(numId) && numId >= this.nextId) {
        this.nextId = numId + 1;
    }

    // Upsert: if entry with this ID already exists, update it in-place
    if (fields?.id != null) {
        const existingIndex = this.state.get().entries.findIndex((e) => e.id === id);
        if (existingIndex >= 0) {
            this.state.update((s) => {
                const existing = s.entries[existingIndex];
                s.entries[existingIndex] = { ...existing, ...fields, type, id };
            });
            const updatedEntry = this.state.get().entries[existingIndex];
            this.updateEntryInContent(updatedEntry);
            return updatedEntry;
        }
    }

    // Normal append path
    const entry: LogEntry = typeof fields === "string" || Array.isArray(fields)
        ? { type, id, text: fields, timestamp: Date.now() }
        : { type, id, ...fields, timestamp: Date.now() };

    this.state.update((s) => {
        s.entries = [...s.entries, entry];
        s.entryCount = s.entries.length;
    });

    this.appendToContent(entry);
    return entry;
}
```

This enables MCP to update any entry by passing the same `id` — particularly useful for progress bars:

```
// MCP: Create progress
ui_push({ entries: [{ type: "output.progress", id: "p1", label: "Loading...", value: 0, max: 100 }] })

// MCP: Update progress (same id → upsert)
ui_push({ entries: [{ type: "output.progress", id: "p1", value: 50 }] })

// MCP: Complete progress
ui_push({ entries: [{ type: "output.progress", id: "p1", completed: true, label: "Done!" }] })
```

**Note:** `updateEntryInContent` is already a private method (used by `resolveDialog` and `updateEntryText`). It re-serializes a single line in the JSONL content by matching the entry ID.

### Step 3: Create `ProgressOutputView` component

**File:** `src/renderer/editors/log-view/items/ProgressOutputView.tsx` (NEW)

Renders a progress bar with label. No `DialogContainer` needed — output entries are lightweight.

Structure:
- Root div with `minWidth: 200`, `maxWidth: 400` (or similar reasonable width)
- Label line (rendered via `LogStyledText` or inline styled spans)
- Progress bar: track div with fill div inside
- Percentage or value/max text to the right of the bar
- When `completed`: fill goes to 100%, color changes to green, optional checkmark
- When `value` is undefined and not completed: show `CircularProgress` spinner (size 16) next to the label instead of the bar — indeterminate state

```typescript
import styled from "@emotion/styled";
import { ProgressOutputEntry } from "../logTypes";
import { LogStyledText } from "../LogStyledText";
import color from "../../../theme/color";

const ProgressRoot = styled.div({
    minWidth: 200,
    maxWidth: 400,
    padding: "2px 0",

    "& .progress-label": {
        fontSize: 13,
        lineHeight: "18px",
        marginBottom: 2,
    },

    "& .progress-track": {
        height: 6,
        borderRadius: 3,
        background: color.background.dark,
        overflow: "hidden",
    },

    "& .progress-fill": {
        height: "100%",
        borderRadius: 3,
        background: color.misc.blue,
        transition: "width 0.2s ease",
    },

    "& .progress-fill.completed": {
        background: color.misc.green,
    },

    "& .progress-info": {
        fontSize: 11,
        color: color.text.light,
        marginTop: 1,
    },
});

interface ProgressOutputViewProps {
    entry: ProgressOutputEntry;
}

export function ProgressOutputView({ entry }: ProgressOutputViewProps) {
    const { label, value, max = 100, completed } = entry;
    const percent = completed ? 100 : (value != null ? Math.min(100, (value / max) * 100) : 0);

    return (
        <ProgressRoot>
            {label && (
                <div className="progress-label">
                    <LogStyledText text={label} />
                </div>
            )}
            <div className="progress-track">
                <div
                    className={`progress-fill${completed ? " completed" : ""}`}
                    style={{ width: `${percent}%` }}
                />
            </div>
            {value != null && !completed && (
                <div className="progress-info">{value} / {max}</div>
            )}
        </ProgressRoot>
    );
}
```

**Note:** Need to verify `LogStyledText` exists or use the same approach as `LogMessageView` for rendering styled text.

### Step 4: Wire into LogEntryContent

**File:** `src/renderer/editors/log-view/LogEntryContent.tsx` (MODIFY)

Add import for `ProgressOutputView` and `ProgressOutputEntry`.

Add case before the `isOutputEntry` fallback:

```typescript
case "output.progress":
    return <ProgressOutputView entry={entry as ProgressOutputEntry} />;
```

### Step 5: Create `Progress` helper class

**File:** `src/renderer/scripting/api-wrapper/Progress.ts` (NEW)

A helper class that wraps an entry ID and provides property setters:

```typescript
import type { LogViewModel } from "../../editors/log-view/LogViewModel";
import type { StyledText, ProgressOutputEntry } from "../../editors/log-view/logTypes";

/**
 * Progress helper returned by `ui.show.progress()`.
 * Property setters update the underlying log entry.
 */
export class Progress {
    private _label?: StyledText;
    private _value?: number;
    private _max?: number;
    private _completed?: boolean;

    constructor(
        private readonly entryId: string,
        private readonly vm: LogViewModel,
        initial: { label?: StyledText; value?: number; max?: number },
    ) {
        this._label = initial.label;
        this._value = initial.value;
        this._max = initial.max;
    }

    private update(): void {
        this.vm.updateEntryById(this.entryId, (draft) => {
            const d = draft as ProgressOutputEntry;
            d.label = this._label;
            d.value = this._value;
            d.max = this._max;
            d.completed = this._completed;
        });
    }

    get label(): StyledText | undefined { return this._label; }
    set label(value: StyledText | undefined) {
        this._label = value;
        this.update();
    }

    get value(): number | undefined { return this._value; }
    set value(value: number | undefined) {
        this._value = value;
        this.update();
    }

    get max(): number | undefined { return this._max; }
    set max(value: number | undefined) {
        this._max = value;
        this.update();
    }

    get completed(): boolean | undefined { return this._completed; }
    set completed(value: boolean | undefined) {
        this._completed = value;
        this.update();
    }

    /**
     * Mark progress as completed when a promise settles.
     * Optionally update the label on completion.
     */
    completeWithPromise(promise: Promise<any>, completeLabel?: StyledText): void {
        promise.finally(() => {
            this.completed = true;
            if (completeLabel !== undefined) {
                this.label = completeLabel;
            }
        });
    }
}
```

**Note:** Renamed from `conpleteWhenPromise` (typo in interactive-script) to `completeWithPromise` — cleaner name.

### Step 6: Add `show.progress()` to UiFacade

**File:** `src/renderer/scripting/api-wrapper/UiFacade.ts` (MODIFY)

Replace the stub:

```typescript
// Before:
readonly show: undefined = undefined;

// After:
readonly show = {
    progress: (labelOrOpts?: StyledText | { label?: StyledText; value?: number; max?: number }): Progress => {
        let fields: Record<string, any>;
        if (isOptionsObject(labelOrOpts)) {
            fields = labelOrOpts;
        } else {
            fields = { label: labelOrOpts };
        }
        const entry = this.vm.addEntry("output.progress", fields);
        return new Progress(entry.id, this.vm, fields);
    },
};
```

Also add import for `Progress` class.

### Step 7: Add TypeScript declarations

**File:** `src/renderer/api/types/ui-log.d.ts` (MODIFY)
**File:** `assets/editor-types/ui-log.d.ts` (MODIFY — keep in sync)

Add `IProgress` interface and `IUiShow` interface:

```typescript
// =============================================================================
// Progress Helper
// =============================================================================

/**
 * Progress bar helper returned by `ui.show.progress()`.
 * Update properties to change the progress bar in real-time.
 *
 * @example
 * const progress = ui.show.progress("Loading...");
 * progress.max = 100;
 * for (let i = 0; i <= 100; i += 10) {
 *     await delay(200);
 *     progress.value = i;
 * }
 * progress.completed = true;
 * progress.label = styledText("Done!").color("green").value;
 */
export interface IProgress {
    /** Progress label (supports styled text). */
    label: IStyledText | undefined;
    /** Current progress value. */
    value: number | undefined;
    /** Maximum value (default: 100). */
    max: number | undefined;
    /** When true, shows the bar as fully completed. */
    completed: boolean | undefined;

    /**
     * Mark progress as completed when a promise settles.
     * Optionally update the label on completion.
     */
    completeWithPromise(promise: Promise<any>, completeLabel?: IStyledText): void;
}

// =============================================================================
// Show Namespace
// =============================================================================

export interface IUiShow {
    /**
     * Show a progress bar in the Log View. Returns a Progress helper
     * whose property setters update the bar in real-time.
     *
     * @example
     * // Simple form — just a label
     * const progress = ui.show.progress("Downloading...");
     *
     * @example
     * // Full form with initial values
     * const progress = ui.show.progress({
     *     label: "Processing files",
     *     value: 0,
     *     max: 50,
     * });
     *
     * @example
     * // Complete on promise resolution
     * const progress = ui.show.progress("Loading data...");
     * progress.completeWithPromise(fetchData(), styledText("Loaded!").color("green").value);
     */
    progress(label?: IStyledText): IProgress;
    progress(options: {
        label?: IStyledText;
        value?: number;
        max?: number;
    }): IProgress;
}
```

Add to `IUiLog`:

```typescript
/** Rich output display methods. */
readonly show: IUiShow;
```

### Step 8: Verify LogStyledText component exists

Need to check if there's a shared component for rendering `StyledText` (styled segments). If not, extract from `LogMessageView` or create a small reusable component.

### Step 9: Update MCP documentation

**File:** `assets/mcp-res-ui-push.md` (MODIFY)

Add `output.progress` to a new **Output entries** section:

```
**Output entries** (rich display):

| Type | Fields | Description |
|------|--------|-------------|
| `output.progress` | `label?, value?, max?, completed?` | Progress bar with optional label |
```

Add example:

```
// Progress bar — create
ui_push({ entries: [
    { type: "output.progress", id: "dl-1", label: "Downloading...", value: 0, max: 100 }
] })
→ returns immediately: { }

// Progress bar — update (same id → upsert, merges fields)
ui_push({ entries: [
    { type: "output.progress", id: "dl-1", value: 50 }
] })

// Progress bar — complete
ui_push({ entries: [
    { type: "output.progress", id: "dl-1", completed: true, label: "Download complete!" }
] })
```

### Step 10: Add test entries to test.log.jsonl

**File:** `D:\js-notepad-notes\temp\test.log.jsonl` (MODIFY)

Add progress entries with varying states:
- In progress (value: 65, max: 100)
- Completed (completed: true, label styled)
- Empty (just label, no value)
- With styled label

## Concerns / Open Questions

1. **MCP progress updates:** ~~Resolved~~ — `addEntry` now supports upsert: if `fields.id` matches an existing entry, the entry is updated in-place instead of appending. MCP sends `ui_push` with the same `id` to update a progress bar. This is generic and works for any entry type, not just progress.

2. **Indeterminate state:** ~~Resolved~~ — When `value` is undefined and `completed` is false, show the existing `CircularProgress` component (`components/basic/CircularProgress.tsx`) with a small `size` (e.g., 16) next to the label. This is the same spinner used in `Button` for async onClick. No custom animation needed.

3. **Progress bar width:** ~~Resolved~~ — Fixed width ~160px for the progress bar track. Will adjust after visual review if needed.

4. **Styled text rendering in label:** Need to verify how `LogMessageView` renders `StyledText` and reuse the same pattern. May need a small `LogStyledText` component if it's currently inline in `LogMessageView`.

5. **Method name:** Using `completeWithPromise` instead of `conpleteWhenPromise` (typo in interactive-script). Should we keep the interactive-script spelling for compatibility? **Recommendation:** Use the corrected name.

## Acceptance Criteria

- [ ] `ProgressOutputEntry` type updated with optional `value` and `completed` field
- [ ] `LogViewModel.updateEntryById()` method added
- [ ] `ProgressOutputView` renders progress bar with label, fill, and value info
- [ ] Completed state shows green filled bar
- [ ] Styled text labels render correctly
- [ ] `Progress` helper class with getters/setters for label, value, max, completed
- [ ] Property setters trigger entry updates via `updateEntryById`
- [ ] `completeWithPromise(promise, label?)` marks completed on promise settlement
- [ ] `ui.show.progress()` works with simple form (label) and full form (options object)
- [ ] `ui.show` property replaces the `undefined` stub
- [ ] Type declarations (`IProgress`, `IUiShow`) in both `.d.ts` files with JSDoc
- [ ] `addEntry` supports upsert — if `fields.id` matches existing entry, updates in-place
- [ ] MCP `ui_push` can create and update progress entries via same `id`
- [ ] MCP resource documentation updated with progress example
- [ ] Test entries in test.log.jsonl for visual review
