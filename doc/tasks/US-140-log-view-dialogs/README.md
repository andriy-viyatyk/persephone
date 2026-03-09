# US-140: Log View editor — dialog entries (input.text, confirm, buttons)

**Status:** Planned
**Epic:** EPIC-004 (Log View Editor)
**Created:** 2026-03-09

## Overview

Replace the `DialogEntryStub` in `LogEntryContent` with real interactive dialog renderers for three dialog types: `input.text`, `input.confirm`, and `input.buttons`. Each renders inline in the log, supports pending (interactive) and resolved (read-only) states, and calls `vm.resolveDialog()` when the user responds.

Also refactor entry rendering to use a **direct state subscription** model: each entry component subscribes to its slice of `LogViewModel.state.entries[]` via a selector hook, making `entries[]` the single source of truth for both display and edits.

## What We're Building

### Three dialog components

| Type | What it renders | User interaction |
|------|----------------|-----------------|
| `input.confirm` | Message text + buttons (default: "No", "Yes") | Click a button |
| `input.text` | Optional title + text field + buttons (default: "OK") | Type text + click a button |
| `input.buttons` | Array of buttons (no title/message) | Click a button |

### Shared dialog infrastructure

- **DialogContainer** — styled wrapper with active/resolved border states (active = `color.border.active`, resolved = `color.border.default`)
- **DialogHeader** — optional title bar (dark background, only shown when title exists)
- **ButtonsPanel** — reusable button row renderer with `!` prefix (required) support, resolved state (check icon on clicked button, all disabled)

### Two visual states per dialog

| State | Border | Controls | Buttons |
|-------|--------|----------|---------|
| **Pending** | `color.border.active` (bright) | Enabled, editable | Clickable |
| **Resolved** | `color.border.default` (dim) | Disabled, read-only | Disabled, check icon on result |

## Architecture

### State management: direct subscription to entries[]

**Principle:** `LogViewModel.state.entries[]` is the single source of truth. Every rendered entry subscribes directly to its slice of this array via a selector hook.

**How it works:**

```typescript
// LogEntryWrapper receives vm + index (not an entry object)
function LogEntryWrapper({ vm, index, cellRef, showTimestamp }) {
    // Subscribe to just this entry — only re-renders when this specific entry changes
    const entry = vm.state.use(s => s.entries[index]);

    // Update function for child components (immer-style draft + debounced serialization)
    const updateEntry = useCallback((updater: (draft: LogEntry) => void) => {
        vm.updateEntryAt(index, updater);
    }, [vm, index]);

    // ...render with entry and updateEntry
}
```

**Why this design:**

1. **Single source of truth** — no middleware state layers (LogEntryModel state separate from entries[])
2. **Virtualization-safe** — entry state lives in parent, survives component destruction on scroll
3. **Selective re-renders** — `TOneState.use(selector)` with `compareSelection` deep equality ensures only the affected entry re-renders when entries[] changes
4. **Consistent data flow** — typing in text input, clicking buttons, and programmatic updates all go through one path: `vm.state.update()`
5. **No model eviction needed** — there are no per-entry reactive models to cache/evict for rendering purposes

**LogEntryModel is no longer needed.** Both rendering and the scripting facade access entries directly through `LogViewModel` methods (`addEntry`, `addDialogEntry`, `resolveDialog`, `updateEntry`, `clear`). The scripting facade (future `ui` global) will call these methods — no per-entry model wrappers. LogEntryModel and the model cache/eviction logic in LogViewModel can be removed as cleanup.

### Data flow for dialog resolution

```
User clicks button in dialog
  → Dialog component calls vm.resolveDialog(entryId, result, resultButton)
    → LogViewModel.resolveDialog() calls state.update() → entries[i].data gets result/resultButton
    → LogViewModel serializes updated entry line to JSONL content
    → LogViewModel resolves the pending Promise (for script/MCP)
    → LogEntryWrapper's selector fires → component re-renders in resolved state
```

### Data flow for text input typing

```
User types in text field
  → TextInputDialogView calls updateEntry(draft => { draft.data.result = text })
    → LogViewModel.updateEntryAt(index, updater):
      1. state.update() writes to entries[i].data.result → selector fires → re-render
      2. marks index dirty → debounced flush (300ms) → serializes entry line to JSONL content
    → Text field shows current value (survives scrolling out of view and back)
    → Typed text persists to file (debounced) even before dialog is submitted
```

Note: `result` is written as a draft during typing — the dialog is not "resolved" until the user clicks a button (which sets `resultButton`). The presence of `resultButton` distinguishes pending from resolved.

**Text input typing serializes to JSONL with debouncing.** The `updateEntry` callback in `LogEntryWrapper` updates in-memory state AND marks the entry as dirty for debounced serialization. This way typed text is persisted even if the page is closed before clicking a button.

**How dirty tracking works:**
- `LogViewModel` has a `dirtyIndices: Set<number>` field
- `updateEntry` from the wrapper calls `vm.state.update()` + `vm.markDirty(index)` — or a single combined method like `vm.updateEntryAt(index, updater)`
- `markDirty` adds the index to the set and triggers a debounced flush (300ms, same as existing `updateEntryInContentDebounced`)
- Debounced flush: for each dirty index, reads `state.get().entries[i]`, finds the line by ID in JSONL content, replaces it. Clears the dirty set.
- `resolveDialog` serializes immediately (no debounce) — it's a one-time event, not rapid-fire like typing

### ViewModel access via React Context

Dialog components need `vm.resolveDialog()`. Instead of threading `vm` through every wrapper level, we use a React Context:

- `LogViewContext` provides the `LogViewModel` instance
- Provider set once in `LogViewEditor`, consumed by dialog components via `useContext`
- Clean prop signatures, scales to all 6 dialog types + output entries

### Component structure

```
/src/renderer/editors/log-view/
  LogViewContext.ts               ← NEW (React Context for vm)
  LogEntryWrapper.tsx             ← REFACTOR (receives vm + index, uses state selector)
  LogEntryContent.tsx             ← MODIFY (route dialogs to real views)
  items/                          ← NEW folder for all rendered log item types
    ConfirmDialogView.tsx         ← NEW (input.confirm)
    TextInputDialogView.tsx       ← NEW (input.text)
    ButtonsDialogView.tsx         ← NEW (input.buttons)
    ButtonsPanel.tsx              ← NEW (shared button row with ! prefix + check icon)
    DialogContainer.tsx           ← NEW (shared styled wrapper)
    DialogHeader.tsx              ← NEW (optional title bar)
```

## Implementation Plan

### 1. Create LogViewContext

New file: `src/renderer/editors/log-view/LogViewContext.ts`

```typescript
const LogViewContext = createContext<LogViewModel | null>(null);
export const LogViewProvider = LogViewContext.Provider;
export function useLogViewModel(): LogViewModel {
    const vm = useContext(LogViewContext);
    if (!vm) throw new Error("LogViewContext not provided");
    return vm;
}
```

### 2. Refactor LogEntryWrapper

**Current props:** `{ entry: LogEntry; cellRef?: RefObject<HTMLDivElement>; showTimestamp?: boolean }`

**New props:** `{ vm: LogViewModel; index: number; cellRef?: RefObject<HTMLDivElement>; showTimestamp?: boolean }`

**New body:**
```typescript
export function LogEntryWrapper({ vm, index, cellRef, showTimestamp }: LogEntryWrapperProps) {
    const entry = vm.state.use(s => s.entries[index]);

    const updateEntry = useCallback((updater: (draft: LogEntry) => void) => {
        vm.updateEntryAt(index, updater); // updates state + marks dirty for debounced serialization
    }, [vm, index]);

    if (!entry) return null;

    const accentClass = accentClassMap[entry.type] || "";

    return (
        <WrapperRoot ref={cellRef as any} className={accentClass}>
            {showTimestamp && entry.timestamp != null && (
                <div className="entry-timestamp">{formatTimestamp(entry.timestamp)}</div>
            )}
            <div className="entry-content">
                <LogEntryContent entry={entry} updateEntry={updateEntry} />
            </div>
        </WrapperRoot>
    );
}
```

**Key changes:**
- `entry` comes from `vm.state.use(selector)` — reactive, selective re-renders
- `updateEntry` is an immer-style callback passed down to `LogEntryContent` and dialog views
- `cellRef` still works the same way (RenderFlexGrid uses it for height measurement)
- All existing styling (accent classes, hover effect, timestamp) preserved unchanged

### 3. Create `items/` folder with shared building blocks

**`DialogContainer.tsx`** — styled `div`:
- Border: active (`color.border.active`) vs default (`color.border.default`) based on resolved state
- Border radius, margin
- Single styled root with nested class selectors (project convention)

**`DialogHeader.tsx`** — conditional title bar:
- Only renders if `title` prop is provided (returns `null` otherwise)
- Dark background (`color.background.dark`), light text
- Uses `StyledTextView` for styled text support

**`ButtonsPanel.tsx`** — reusable button row:
- Renders buttons with `<Button size="small" type="raised">`
- `!` prefix parsing: strips `!` from display, marks button as "required"
- Required buttons disabled when `required` prop is `true` (e.g., text field empty)
- When resolved: all buttons disabled, clicked button shows `CheckIcon` (from `icons.tsx`)
- Used by all three dialog types (and future checkboxes/radio/select)

### 4. Create dialog view components

All dialog views share this pattern:
- **Props:** `{ entry: LogEntry; updateEntry: (updater: (draft: LogEntry) => void) => void }`
- **Context:** `useLogViewModel()` to get `vm` for `vm.resolveDialog()`
- **Resolved check:** `const resolved = entry.data?.resultButton !== undefined;`

**`ConfirmDialogView.tsx`** (`input.confirm`):
- Data shape: `ConfirmDialogData` from `logTypes.ts` — `{ message: StyledText; buttons?: string[]; result?; resultButton? }`
- DialogContainer (active=!resolved) + message body via `StyledTextView` + ButtonsPanel
- Default buttons: `["No", "Yes"]`
- On click: `vm.resolveDialog(entry.id, buttonText, buttonText)` — for confirm, result = clicked button text

**`TextInputDialogView.tsx`** (`input.text`):
- Data shape: `TextDialogData` from `logTypes.ts` — `{ title?: StyledText; placeholder?; defaultValue?; buttons?: string[]; result?; resultButton? }`
- DialogContainer (active=!resolved) + DialogHeader (if title) + `<TextField>` + ButtonsPanel
- Text field value: `entry.data.result ?? entry.data.defaultValue ?? ""`
- Text field onChange: `updateEntry(draft => { draft.data.result = newText })` — writes draft to state
- Text field disabled/readonly when resolved
- Default buttons: `["OK"]`
- ButtonsPanel `required` prop: `true` when text is empty (for `!` prefixed buttons)
- On click: `vm.resolveDialog(entry.id, currentText, buttonText)` — result = text field value

**`ButtonsDialogView.tsx`** (`input.buttons`):
- Data shape: `ButtonsDialogData` from `logTypes.ts` — `{ title?: StyledText; buttons: string[]; result?; resultButton? }`
- DialogContainer (active=!resolved) + DialogHeader (if title) + ButtonsPanel
- Buttons from `entry.data.buttons` (required, no default)
- On click: `vm.resolveDialog(entry.id, buttonText, buttonText)`

### 5. Update LogEntryContent router

**Current props:** `{ entry: LogEntry }`
**New props:** `{ entry: LogEntry; updateEntry: (updater: (draft: LogEntry) => void) => void }`

Route dialog types to real views (pass `entry` + `updateEntry` to each):
- `input.confirm` → `ConfirmDialogView`
- `input.text` → `TextInputDialogView`
- `input.buttons` → `ButtonsDialogView`
- Other dialog types (`input.checkboxes`, etc.) → keep existing `DialogEntryStub`
- Log entries (`isLogEntry`) → `LogMessageView` (unchanged, doesn't need `updateEntry`)
- Output entries → `OutputEntryStub` (unchanged)

Remove the `DialogEntryStub` function for the three implemented types. Keep it for unimplemented dialog types (checkboxes, radio, select) — rename to `DialogEntryStub` with a note.

### 6. Wire up LogViewEditor

- Wrap grid content in `LogViewContext.Provider` with `vm`
- Update `renderLogEntry` to pass `vm` + `p.row` to `LogEntryWrapper`

### 7. Refactor LogViewModel

Several methods currently mutate entry objects directly and use the `LogEntryModel` cache. Refactor them to use `state.update()` (immer) so changes propagate through selector hooks.

**`resolveDialog`** — currently mutates `entry.data` directly and updates cached model. Refactor:

```typescript
resolveDialog(id: string, result: any, resultButton?: string): void {
    let entryForSerialize: LogEntry | undefined;
    this.state.update(s => {
        const entry = s.entries.find(e => e.id === id);
        if (entry) {
            entry.data = { ...entry.data, result, resultButton };
            entryForSerialize = entry; // capture for serialization
        }
    });
    if (entryForSerialize) {
        this.updateEntryInContent(entryForSerialize);
    }
    // Resolve pending Promise...
    const pending = this.pendingDialogs.get(id);
    if (pending) {
        pending.resolve({ result, resultButton });
        this.pendingDialogs.delete(id);
    }
}
```

**New `updateEntryAt(index, updater)`** — combined method for UI-driven entry updates (e.g., text typing):

```typescript
/** Update entry at index via immer updater. Marks dirty for debounced JSONL serialization. */
updateEntryAt(index: number, updater: (draft: LogEntry) => void): void {
    this.state.update(s => { updater(s.entries[index]); });
    this.dirtyIndices.add(index);
    this.flushDirtyDebounced();
}
```

**`dirtyIndices` + debounced flush:**

```typescript
private dirtyIndices = new Set<number>();

private flushDirtyDebounced = debounce(() => {
    if (this.dirtyIndices.size === 0) return;
    const entries = this.state.get().entries;
    const content = this.host.state.get().content;
    const lines = content.split("\n");
    let changed = false;

    for (const idx of this.dirtyIndices) {
        const entry = entries[idx];
        if (!entry) continue;
        // Find line by entry ID and replace
        for (let i = 0; i < lines.length; i++) {
            const trimmed = lines[i].trim();
            if (!trimmed) continue;
            try {
                const parsed = JSON.parse(trimmed);
                if (parsed.id === entry.id) {
                    const updated = JSON.stringify(entry);
                    if (lines[i] !== updated) {
                        lines[i] = updated;
                        changed = true;
                    }
                    break;
                }
            } catch { /* skip */ }
        }
    }
    this.dirtyIndices.clear();

    if (changed) {
        this.skipNextContentUpdate = true;
        this.host.changeContent(lines.join("\n"), true);
    }
}, 300);
```

**Remove old `updateEntry(id, data)`** — replace with `updateEntryAt`. Also remove `modelCache`-related code from `updateEntry`.

**`addEntry`** — currently pushes to `entries` via `state.update()` already. Keep using `state.update()`.

**Remove LogEntryModel usage from rendering pipeline:**
- Remove `modelCache`, `getModel()`, `getEntry()`, `setRenderedRange()`, `evictModels()`, `evictModelsDebounced()` — these were for per-entry model management
- Keep `LogEntryModel.ts` file for now (don't delete, just stop using it) — cleanup in a separate commit
- Remove `handleRenderRange` callback from `LogViewEditor` (was wired to `onAdjustRenderRange` for model eviction)

**Important:** After `state.update()` with immer, the entries in the state are new objects (immer produces new references). The `updateEntryInContent()` method needs the updated entry to serialize. Capture it from state after update, or read from `this.state.get().entries` after the update call.

### 8. Update LogViewEditor.renderLogEntry

**Current implementation:**
```typescript
const renderLogEntry = useCallback((p: RenderFlexCellParams) => {
    if (!vm) return null;
    const entries = vm.state.get().entries;
    const entry = entries[p.row];
    if (!entry) return null;
    return (
        <LogEntryWrapper key={entry.id} entry={entry} cellRef={p.ref} showTimestamp={state.showTimestamps} />
    );
}, [vm, state.showTimestamps]);
```

**New implementation:**
```typescript
const renderLogEntry = useCallback((p: RenderFlexCellParams) => {
    if (!vm) return null;
    return (
        <LogEntryWrapper vm={vm} index={p.row} cellRef={p.ref} showTimestamp={state.showTimestamps} />
    );
}, [vm, state.showTimestamps]);
```

Note: No `key` prop needed here — RenderFlexGrid manages cell identity by row index. The `key` was previously `entry.id` but now we pass index instead of entry.

Also remove the `handleRenderRange` callback and the `onAdjustRenderRange` prop from `RenderFlexGrid` — model eviction is no longer needed.

### 9. Update getInitialRowHeight

**Current:** reads `entries[row]` to get `entry.id`, then looks up height cache.

**New:** same logic, but now reads from `vm.state.get().entries[row]` (already does this). No change needed — just verify it still works.

## File Changes

| File | Change |
|------|--------|
| `src/renderer/editors/log-view/LogViewContext.ts` | **NEW** — Context providing LogViewModel |
| `src/renderer/editors/log-view/items/DialogContainer.tsx` | **NEW** — Shared styled dialog wrapper |
| `src/renderer/editors/log-view/items/DialogHeader.tsx` | **NEW** — Optional title bar |
| `src/renderer/editors/log-view/items/ButtonsPanel.tsx` | **NEW** — Reusable button row with `!` prefix + check icon |
| `src/renderer/editors/log-view/items/ConfirmDialogView.tsx` | **NEW** — input.confirm renderer |
| `src/renderer/editors/log-view/items/TextInputDialogView.tsx` | **NEW** — input.text renderer |
| `src/renderer/editors/log-view/items/ButtonsDialogView.tsx` | **NEW** — input.buttons renderer |
| `src/renderer/editors/log-view/LogEntryWrapper.tsx` | **REFACTOR** — Receive vm+index, use state selector, provide updateEntry |
| `src/renderer/editors/log-view/LogEntryContent.tsx` | **MODIFY** — Add updateEntry prop, route 3 dialog types to real views |
| `src/renderer/editors/log-view/LogViewEditor.tsx` | **MODIFY** — Add context provider, pass vm+index to wrapper |
| `src/renderer/editors/log-view/LogViewModel.ts` | **MODIFY** — Refactor resolveDialog/updateEntry to use state.update(); remove modelCache, getModel, getEntry, setRenderedRange, evictModels |
| `src/renderer/editors/log-view/LogEntryModel.ts` | **KEEP** — Not deleted, but no longer imported/used by any rendering code. Cleanup later. |

## Acceptance Criteria

- [ ] `input.confirm` renders message + buttons, resolves on click
- [ ] `input.text` renders title + text field + buttons, resolves with typed text
- [ ] `input.buttons` renders button array, resolves on click
- [ ] Pending dialogs show active border, enabled controls
- [ ] Resolved dialogs show default border, disabled controls, check icon on result button
- [ ] Dialog resolution persists to JSONL content (verified by switching to Monaco)
- [ ] Pre-resolved dialogs (from file) render correctly in resolved state
- [ ] `!` prefix on buttons works for all dialog types (disabled when required condition not met)
- [ ] Text input value survives scrolling out of view and back (virtualization)
- [ ] Grid row height updates when dialog renders (taller than log entries)
- [ ] Auto-scroll still works when dialog entry is appended
- [ ] LogEntryWrapper subscribes to its entry slice — only re-renders when its entry changes
- [ ] Existing log message entries (log.info, etc.) continue to render correctly after refactor

## Resolved Concerns

1. **State management** → Direct subscription to `vm.state.entries[index]` via selector hook. Single source of truth, no middleware state.
2. **ViewModel access** → React Context (LogViewContext) providing LogViewModel
3. **Check icon** → Use existing `CheckIcon` from `icons.tsx`
4. **Text input state** → Write to `entries[i].data.result` via `updateEntry()` — survives virtualization
5. **StyledText in buttons** → Keep as plain `string[]` for simplicity
6. **Dialog height** → RenderFlexGrid handles variable heights via ResizeObserver
7. **Required button `!` prefix** → Implement in shared ButtonsPanel for all dialog types
8. **File organization** → One file per dialog + shared building blocks in `items/` folder
9. **Grid re-render on resolve** → Selector hook re-renders the affected entry automatically, no grid-level update needed
10. **Index vs ID binding** → Bind by index (not entry ID). The log is append-only — entries are never inserted in the middle or reordered, so index-to-entry mapping is stable. Index binding is O(1) direct array access vs O(n) `find` for ID. If mid-list insertion is ever needed, an ID→index map can be added later.

## Test Data

Sample JSONL lines for testing all three dialog types:

```
{"type":"log.info","id":"1","data":"Starting process...","timestamp":1741500000000}
{"type":"input.confirm","id":"2","data":{"message":"Do you want to proceed?","buttons":["No","Yes"]},"timestamp":1741500001000}
{"type":"input.text","id":"3","data":{"title":"Configuration","placeholder":"Enter your name...","buttons":["Cancel","!OK"]},"timestamp":1741500002000}
{"type":"input.buttons","id":"4","data":{"buttons":["Option A","Option B","Option C"]},"timestamp":1741500003000}
{"type":"input.confirm","id":"5","data":{"message":"This one is already answered","buttons":["No","Yes"],"result":"Yes","resultButton":"Yes"},"timestamp":1741500004000}
{"type":"input.text","id":"6","data":{"title":"Already filled","defaultValue":"","buttons":["Cancel","!OK"],"result":"John Doe","resultButton":"OK"},"timestamp":1741500005000}
{"type":"log.success","id":"7","data":"All done!","timestamp":1741500006000}
```
