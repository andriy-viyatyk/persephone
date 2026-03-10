# US-145: Flatten LogEntry structure — remove `data` nesting

**Epic:** EPIC-004
**Status:** Planned
**Depends on:** None
**Blocks:** US-146, US-147

## Goal

Refactor the `LogEntry` type to flatten the `data` field. Instead of `{ type, id, timestamp, data: { ...fields } }`, entries become `{ type, id, timestamp, ...fields }`. This eliminates unnecessary nesting, simplifies the MCP API, and removes mapping layers between input parameters, entry state, and result objects.

## Background

### Current structure (nested `data`)

```typescript
interface LogEntry<T = any> {
    type: string;
    id: string;
    data: T;
    timestamp?: number;
}
```

**JSONL:**
```json
{"type":"log.info","id":"1","data":"Hello","timestamp":123}
{"type":"input.confirm","id":"2","data":{"message":"Sure?","buttons":["Yes","No"]},"timestamp":124}
```

### Target structure (flat)

```typescript
interface LogEntry {
    type: string;
    id: string;
    timestamp?: number;
    [key: string]: any;
}
```

**JSONL:**
```json
{"type":"log.info","id":"1","text":"Hello","timestamp":123}
{"type":"input.confirm","id":"2","message":"Sure?","buttons":["Yes","No"],"timestamp":124}
```

### Why flatten

1. **MCP API becomes trivial** — entries are just `{ type, ...fields }`, no `data` wrapper. Document as flat field table per type.
2. **No mapping layers** — `inputParameters == entryObject == dialogState == resultObject`. What goes in is what comes out.
3. **Simpler view code** — `entry.message` instead of `entry.data.message`
4. **Simpler resolveDialog** — `entry.button = button` instead of `entry.data = { ...entry.data, button }`
5. **Log entry consistency** — currently log entries have `data: StyledText` (bare value), while dialog entries have `data: { message, buttons, ... }` (object). Flat model uses named fields for everything: `text: StyledText` for logs.

### Dead code: LogEntryModel.ts

`LogEntryModel` class exists but is **not imported or used anywhere**. It wraps `entry.data` reactively but the codebase uses plain `LogEntry` objects in `LogViewModel.state.entries[]` with direct mutation. This file can be deleted as part of this task.

## Files to modify

| File | Change |
|------|--------|
| `src/renderer/editors/log-view/logTypes.ts` | Redefine `LogEntry`, remove generic `<T>`, flatten all dialog data types |
| `src/renderer/editors/log-view/LogEntryModel.ts` | **Delete** (unused) |
| `src/renderer/editors/log-view/LogViewModel.ts` | Update `addEntry`, `addDialogEntry`, `resolveDialog`, `updateEntryData`, `updateEntryAt`, serialization |
| `src/renderer/editors/log-view/LogEntryContent.tsx` | Change `entry.data.X` → `entry.X` in stubs and router |
| `src/renderer/editors/log-view/LogEntryWrapper.tsx` | No change (doesn't access `data` directly) |
| `src/renderer/editors/log-view/LogMessageView.tsx` | Change `entry.data` → `entry.text` |
| `src/renderer/editors/log-view/items/ConfirmDialogView.tsx` | Change `entry.data.X` → `entry.X` |
| `src/renderer/editors/log-view/items/TextInputDialogView.tsx` | Change `entry.data.X` → `entry.X`, `draft.data.text` → `draft.text` |
| `src/renderer/editors/log-view/items/ButtonsDialogView.tsx` | Change `entry.data.X` → `entry.X` |
| `src/renderer/scripting/api-wrapper/UiFacade.ts` | Build flat entry fields instead of `data` objects |
| `src/renderer/api/mcp-handler.ts` | Simplify — entries are flat, no `entry.data` extraction |
| `assets/mcp-res-ui-push.md` | Update examples to flat format |
| `src/renderer/api/types/ui-log.d.ts` | No change needed (script API types are about function signatures, not entry internals) |
| `assets/editor-types/ui-log.d.ts` | No change needed (same reason) |

## Implementation Plan

### Step 1: Redefine types in `logTypes.ts`

Remove the generic `LogEntry<T>` and flatten all entry types.

**System fields** (shared by all entries):
```typescript
interface LogEntryBase {
    type: string;
    id: string;
    timestamp?: number;
}
```

**Log entries** — add `text` field:
```typescript
interface LogMessageEntry extends LogEntryBase {
    type: LogLevel;
    text: StyledText;
}
```

**Dialog entries** — fields directly on entry:
```typescript
interface ConfirmEntry extends LogEntryBase {
    type: "input.confirm";
    message: StyledText;
    buttons?: string[];
    button?: string;       // result
}

interface TextInputEntry extends LogEntryBase {
    type: "input.text";
    title?: StyledText;
    placeholder?: string;
    defaultValue?: string;
    text?: string;          // user input (mutable)
    buttons?: string[];
    button?: string;        // result
}

interface ButtonsEntry extends LogEntryBase {
    type: "input.buttons";
    title?: StyledText;
    buttons: string[];
    button?: string;        // result
}
```

**Loose union for runtime flexibility:**
```typescript
type LogEntry = LogEntryBase & Record<string, any>;
```

Keep specific typed interfaces for view components that need them (e.g., `ConfirmEntry` for `ConfirmDialogView`), but the core `LogEntry` type stays loose to support unknown/future entry types without breaking.

**Update helper functions:**
- `isDialogResolved(entry)`: check `entry.button !== undefined` (was `entry.data?.button`)
- `isLogEntry(entry)`: unchanged (checks `entry.type`)
- Remove `DialogResultFields` — `button` is just a direct field on entries

**Delete `DialogResult` type alias** — dialog resolution now returns the entry object itself (minus system fields), so the result type is just `Record<string, any> & { button?: string }`.

### Step 2: Update `LogViewModel.ts`

**`addEntry(type, fields)`:**
```typescript
// Before:
addEntry(type: string, data: any): LogEntry {
    const entry: LogEntry = { type, id: String(this.nextId++), data, timestamp: Date.now() };
    ...
}

// After:
addEntry(type: string, fields: any): LogEntry {
    const id = String(this.nextId++);
    // For log entries, fields is StyledText → wrap as { text }
    // For dialog/output entries, fields is already an object → spread
    const entry: LogEntry = typeof fields === "string" || Array.isArray(fields)
        ? { type, id, text: fields, timestamp: Date.now() }
        : { type, id, ...fields, timestamp: Date.now() };
    ...
}
```

**`addDialogEntry(type, fields)`:**
```typescript
// Before:
addDialogEntry<T>(type: string, data: T): Promise<DialogResult> {
    const entry = this.addEntry(type, data);
    ...
}

// After — same signature, fields are spread into entry by addEntry:
addDialogEntry(type: string, fields: Record<string, any>): Promise<Record<string, any>> {
    const entry = this.addEntry(type, fields);
    ...
}
```

**`resolveDialog(id, button)`:**
```typescript
// Before:
entry.data = { ...entry.data, button };
...
pending.resolve(updatedEntry.data);

// After:
entry.button = button;
...
// Return all non-system fields as the result
const { type: _t, id: _i, timestamp: _ts, ...result } = updatedEntry;
pending.resolve(result);
```

**`updateEntryData(id, data)`:**
```typescript
// Before:
s.entries[index] = { ...s.entries[index], data };

// After — for log entries, data is the new text:
const { type, id, timestamp } = s.entries[index];
s.entries[index] = { type, id, timestamp, text: data };
```

**`updateEntryAt(index, updater)`:**
```typescript
// No structural change — updater receives the flat entry directly
// Views will do: draft.text = text (instead of draft.data.text = text)
```

### Step 3: Update all view components

Mechanical replacement in each file:

**`LogMessageView.tsx`:**
- `entry.data` → `entry.text` (the StyledText content)

**`LogEntryContent.tsx`:**
- `entry.data?.title` → `entry.title`
- `entry.data?.message` → `entry.message`
- `entry.data?.button` → `entry.button`
- `entry.data?.label` → `entry.label`
- `JSON.stringify(entry.data)` → `JSON.stringify(entry)` (for unknown entry preview)
- Remove type casts like `entry as LogEntry<ConfirmDialogData>` → use typed interfaces directly

**`ConfirmDialogView.tsx`:**
- `const data = entry.data` → remove, use `entry` directly
- `data.button` → `entry.button`
- `data.buttons` → `entry.buttons`
- `data.message` → `entry.message`

**`TextInputDialogView.tsx`:**
- `const data = entry.data` → remove, use `entry` directly
- `data.button` → `entry.button`
- `data.buttons` → `entry.buttons`
- `data.title` → `entry.title`
- `data.text` → `entry.text`
- `data.defaultValue` → `entry.defaultValue`
- `data.placeholder` → `entry.placeholder`
- `draft.data.text = text` → `draft.text = text`

**`ButtonsDialogView.tsx`:**
- Same pattern as ConfirmDialogView

### Step 4: Update `UiFacade.ts`

Dialog methods now pass flat fields directly:

```typescript
// Before:
confirm: (message, buttons?) => {
    const data: ConfirmDialogData = { message, buttons };
    return this.vm.addDialogEntry("input.confirm", data);
},

// After (identical logic, but data IS the entry fields):
confirm: (message, buttons?) => {
    return this.vm.addDialogEntry("input.confirm", { message, buttons });
},
```

Logging methods:

```typescript
// Before:
private addLog(type: string, message: StyledText) {
    const entry = this.vm.addEntry(type, message);
    return new StyledLogBuilder(message, (data) => this.vm.updateEntryData(entry.id, data));
}

// After — addEntry now handles StyledText → { text } mapping:
private addLog(type: string, message: StyledText) {
    const entry = this.vm.addEntry(type, message);
    return new StyledLogBuilder(message, (text) => this.vm.updateEntryData(entry.id, text));
}
```

### Step 5: Update `mcp-handler.ts`

The MCP handler becomes simpler because entries are flat:

```typescript
// Before:
if (entry.type.startsWith("input.")) {
    dialogPromises.push(vm.addDialogEntry(entry.type, entry.data ?? {}));
} else {
    vm.addEntry(entry.type, entry.data ?? "");
}

// After — spread all fields except type:
const { type, ...fields } = entry;
if (type.startsWith("input.")) {
    dialogPromises.push(vm.addDialogEntry(type, fields));
} else {
    vm.addEntry(type, fields.text ?? "");
}
```

String shorthand:
```typescript
// Before:
const entry = typeof raw === "string" ? { type: "log.info", data: raw } : raw;

// After:
const entry = typeof raw === "string" ? { type: "log.info", text: raw } : raw;
```

### Step 6: Update MCP resource `mcp-res-ui-push.md`

Update all entry examples to flat format:

```markdown
**Before:**
{ type: "input.confirm", data: { message: "Apply changes?", buttons: ["No", "Yes"] } }

**After:**
{ type: "input.confirm", message: "Apply changes?", buttons: ["No", "Yes"] }
```

Update the entry types table — fields are entry-level, not nested under `data`.

### Step 7: Delete `LogEntryModel.ts`

Remove the unused file. Verify no imports exist (already confirmed: zero usages).

## Concerns / Open Questions

### 1. Reserved field names

**Question:** Could user-defined fields clash with system fields (`type`, `id`, `timestamp`)?

**Answer:** No practical concern. System fields are always set by `addEntry()`. User-provided fields come from the dialog data, which uses domain-specific names (`message`, `buttons`, `title`, `items`, etc.). No overlap.

### 2. Backward compatibility of JSONL files

**Question:** Existing `.log.jsonl` files use the nested `data` format. Should we support reading old format?

**Recommendation:** Add a simple migration in `loadContent()`: if a parsed entry has a `data` field and no type-specific fields, unwrap `data` into the entry. This handles old files transparently. The migration is a few lines of code.

```typescript
// Migration: unwrap nested data from old format
if (entry.data !== undefined && entry.text === undefined && entry.message === undefined) {
    const { data, ...rest } = entry;
    if (typeof data === "object" && data !== null && !Array.isArray(data)) {
        Object.assign(rest, data);
    } else {
        rest.text = data;  // log entries: data was StyledText
    }
    return rest;
}
```

### 3. Extracting result from flat entry

**Question:** When `resolveDialog` returns the result, should it return the entire flat entry or strip system fields?

**Recommendation:** Strip system fields (`type`, `id`, `timestamp`). The caller doesn't need them — they want `{ button, message, ... }` or `{ button, text, ... }`. This matches the current behavior where `resolveDialog` returns `entry.data` (which never had system fields).

## Acceptance Criteria

- [ ] `LogEntry` type is flat — no `data` wrapper
- [ ] All log entries use `text` field for StyledText content
- [ ] All dialog entries have fields directly on entry (`message`, `buttons`, `button`, `title`, etc.)
- [ ] JSONL serialization uses flat format
- [ ] Old nested-format JSONL files are read correctly (migration)
- [ ] Dialog resolution returns flat result (no system fields)
- [ ] All view components work with flat entries
- [ ] Script API works unchanged (UiFacade handles mapping)
- [ ] MCP `ui_push` works with flat entries
- [ ] MCP resource docs updated with flat examples
- [ ] `LogEntryModel.ts` deleted
- [ ] No regressions in existing dialog functionality
