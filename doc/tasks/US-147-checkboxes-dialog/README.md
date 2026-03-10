# US-147: Log item — input.checkboxes (renderer + ui.dialog.checkboxes)

**Epic:** EPIC-004 (Phase 3)
**Status:** Planned
**Depends on:** US-145 (flat LogEntry), US-146 (API overloads)

## Goal

Add a new `input.checkboxes` dialog entry type to the Log View editor. Users (via scripts) and AI agents (via MCP `ui_push`) can present a list of checkboxes for the user to select from, with an optional title, layout mode, and custom buttons.

## Background

### Prerequisite tasks

- **US-145** flattened the `LogEntry` structure — entries are now `{ type, id, timestamp, ...fields }` with no `data` wrapper
- **US-146** standardized the two-overload pattern — all dialog methods support full form (single object) and simple form (positional args)

This task builds on both: the entry type is flat, and the script API follows the overload pattern.

### Existing dialog pattern (post US-145/US-146)

After flattening, dialog entries look like:
```json
{"type":"input.confirm","id":"1","message":"Sure?","buttons":["Yes","No"],"timestamp":123}
{"type":"input.text","id":"2","title":"Name","placeholder":"...","text":"John","button":"OK","timestamp":124}
```

The `checkboxes` entry will follow the same flat pattern:
```json
{"type":"input.checkboxes","id":"3","title":"Select","items":[{"label":"A","checked":true},{"label":"B"}],"button":"OK","timestamp":125}
```

### Key files to reference

| File | Relevance |
|------|-----------|
| `src/renderer/editors/log-view/logTypes.ts` | Add `CheckboxItem`, update `CheckboxesDialogData` |
| `src/renderer/editors/log-view/LogEntryContent.tsx` | Router — add `case "input.checkboxes"` |
| `src/renderer/editors/log-view/items/ConfirmDialogView.tsx` | Reference: simplest dialog pattern |
| `src/renderer/editors/log-view/items/TextInputDialogView.tsx` | Reference: dialog with mutable fields + `updateEntry` |
| `src/renderer/editors/log-view/items/ButtonsPanel.tsx` | Reuse: renders action buttons |
| `src/renderer/editors/log-view/items/DialogContainer.tsx` | Reuse: active/resolved border |
| `src/renderer/editors/log-view/items/DialogHeader.tsx` | Reuse: optional title bar |
| `src/renderer/scripting/api-wrapper/UiFacade.ts` | Add `ui.dialog.checkboxes()` with two-overload pattern |
| `src/renderer/api/types/ui-log.d.ts` | Add `checkboxes()` to `IUiDialog` |
| `assets/editor-types/ui-log.d.ts` | Same (published copy) |
| `assets/mcp-res-ui-push.md` | Document `input.checkboxes` entry |

## Implementation Plan

### Step 1: Update types in `logTypes.ts`

**File:** `src/renderer/editors/log-view/logTypes.ts`

Add `CheckboxItem` interface and update `CheckboxesDialogData` (which was a stub with `items: string[]`):

```typescript
export interface CheckboxItem {
    label: string;
    checked?: boolean;
}

// Flat entry fields (no data wrapper, per US-145):
export interface CheckboxesEntry extends LogEntryBase {
    type: "input.checkboxes";
    title?: StyledText;
    items: CheckboxItem[];
    layout?: "vertical" | "flex";
    buttons?: string[];
    button?: string;        // result
}
```

**Layout modes:**
- `"vertical"` (default) — standard vertical list, one item per row
- `"flex"` — flex row with wrapping, compact layout for many short-label items

### Step 2: Create `CheckboxesDialogView.tsx`

**File:** `src/renderer/editors/log-view/items/CheckboxesDialogView.tsx` (NEW)

Follow `TextInputDialogView.tsx` pattern (uses `updateEntry` for mutable fields):

```
CheckboxesDialogView
├── DialogContainer (resolved border)
├── DialogHeader (optional title)
├── Checkbox list (scrollable, vertical or flex layout)
│   └── For each item: <label> with <input type="checkbox"> + label text
└── ButtonsPanel (action buttons)
```

**Key behavior:**
- Each checkbox toggles `items[i].checked` via `updateEntry(draft => { draft.items[i].checked = !draft.items[i].checked })` — persists to JSONL via debounced serialization
- Default buttons: `["OK"]` (same as textInput)
- When resolved: checkboxes become disabled (read-only)
- `requirementNotMet` for `!` buttons: true when no item has `checked === true`
- Use native `<input type="checkbox">` with `accent-color` from theme

**Styling:**
- Single root styled component: `CheckboxesRoot`
- Nested class-based styles: `.checkbox-list`, `.checkbox-item`
- Use `<label>` wrapping both checkbox and text (clicking text toggles checkbox)
- Checkbox items: `padding: 2px 8px`, `fontSize: 14`, `lineHeight: "20px"`
- Checkbox list container: `maxHeight: DIALOG_CONTENT_MAX_HEIGHT`, `overflow-y: auto`
- Layout: `.checkbox-list` uses `flexDirection: "column"` (vertical) or `flexDirection: "row"` + `flexWrap: "wrap"` (flex)
- Use `color` tokens from theme (no hardcoded colors)
- Cursor: pointer when active, default when resolved

**Shared max-height constant:**

```typescript
/** Max height for scrollable dialog content areas. Shared across all dialog types. */
export const DIALOG_CONTENT_MAX_HEIGHT = 400;
```

Defined in `logTypes.ts` (or a shared constants file). Used by checkboxes and available for future dialogs with scrollable content.

### Step 3: Route in `LogEntryContent.tsx`

**File:** `src/renderer/editors/log-view/LogEntryContent.tsx`

Add import and case (using flat entry type from US-145):

```typescript
import { CheckboxesDialogView } from "./items/CheckboxesDialogView";

// In switch:
case "input.checkboxes":
    return (
        <CheckboxesDialogView
            entry={entry as CheckboxesEntry}
            updateEntry={updateEntry}
        />
    );
```

### Step 4: Add `ui.dialog.checkboxes()` to UiFacade

**File:** `src/renderer/scripting/api-wrapper/UiFacade.ts`

Follow the **standard two-overload pattern** (established in US-146):

```typescript
checkboxes: (itemsOrOptions: (string | CheckboxItem)[] | { items: ...; title?; layout?; buttons? }, title?: StyledText, buttons?: string[]): Promise<DialogResult> => {
    let fields: Record<string, any>;
    if (Array.isArray(itemsOrOptions)) {
        // Simple form: checkboxes(["A", "B"], title?, buttons?)
        const normalized = itemsOrOptions.map((item) =>
            typeof item === "string" ? { label: item } : item,
        );
        fields = { items: normalized, title, buttons };
    } else {
        // Full form: checkboxes({ items, title?, layout?, buttons? })
        fields = { ...itemsOrOptions };
        fields.items = fields.items.map((item: any) =>
            typeof item === "string" ? { label: item } : item,
        );
    }
    return this.vm.addDialogEntry("input.checkboxes", fields);
},
```

**Script usage examples:**

```javascript
// ── Simple form ──────────────────────────────────────────────────
// Minimal — all unchecked, default OK button
const result = await ui.dialog.checkboxes(["Option A", "Option B", "Option C"]);

// With title and custom buttons
const result = await ui.dialog.checkboxes(
    ["Option A", "Option B"],
    "Select options",
    ["Apply", "Cancel"],
);

// ── Full form ────────────────────────────────────────────────────
// Full control — presets, layout, custom buttons
const result = await ui.dialog.checkboxes({
    items: [
        { label: "Feature 1", checked: true },
        { label: "Feature 2" },
        { label: "Feature 3", checked: true },
    ],
    title: "Select features",
    buttons: ["Apply", "Cancel"],
});

// Flex layout — compact wrapping row for many short items
const result = await ui.dialog.checkboxes({
    items: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    title: "Select days",
    layout: "flex",
});

// ── Reading results (same for both forms) ────────────────────────
if (result.button === "OK") {
    const selected = result.items.filter(i => i.checked).map(i => i.label);
    ui.log(`Selected: ${selected.join(", ")}`);
}
```

**Note:** `layout` is only available in the full form.

### Step 5: Update type definitions (`.d.ts`)

**Files:**
- `src/renderer/api/types/ui-log.d.ts`
- `assets/editor-types/ui-log.d.ts`

Add `ICheckboxItem` interface and `checkboxes()` overloads to `IUiDialog`:

```typescript
/** A checkbox item with label and optional checked state. */
export interface ICheckboxItem {
    label: string;
    checked?: boolean;
}
```

```typescript
/**
 * Show a checkboxes dialog. Returns items with updated `checked` state in `result.items`.
 *
 * @example
 * // Simple form
 * const result = await ui.dialog.checkboxes(["Option A", "Option B", "Option C"]);
 * const result = await ui.dialog.checkboxes(["A", "B", "C"], "Pick items", ["OK", "Cancel"]);
 *
 * @example
 * // Full form
 * const result = await ui.dialog.checkboxes({
 *     items: [{ label: "Feature 1", checked: true }, { label: "Feature 2" }],
 *     title: "Select features",
 *     layout: "flex",
 *     buttons: ["Apply", "Cancel"],
 * });
 *
 * @example
 * if (result.button === "OK") {
 *     const selected = result.items.filter(i => i.checked).map(i => i.label);
 * }
 */
checkboxes(items: (string | ICheckboxItem)[], title?: IStyledText, buttons?: string[]): Promise<IDialogResult>;
checkboxes(options: {
    items: (string | ICheckboxItem)[];
    title?: IStyledText;
    layout?: "vertical" | "flex";
    buttons?: string[];
}): Promise<IDialogResult>;
```

### Step 6: Update MCP ui-push resource

**File:** `assets/mcp-res-ui-push.md`

Add `input.checkboxes` to the entry types table:

```markdown
| `input.checkboxes` | `items: [{label, checked?}], title?, layout?, buttons?` | Checkboxes selection | `{ button, items }` |
```

Example:
```json
{
  "type": "input.checkboxes",
  "title": "Select items to process",
  "items": [
    { "label": "Item A" },
    { "label": "Item B", "checked": true },
    { "label": "Item C" }
  ],
  "buttons": ["Process", "Cancel"]
}
```

Note: MCP entries use flat format (no `data` wrapper, per US-145). Items must use object form `{ label, checked? }`.

### Step 7: Update active.md and EPIC-004

- Move US-147 to `active.md` In Progress section
- Update EPIC-004 Phase 3 table status to **In Progress**

## Concerns / Open Questions

### 1. Checkbox visual style

**Question:** Should we use native `<input type="checkbox">` or a custom styled checkbox?

**Recommendation:** Use native `<input type="checkbox">` with minimal styling. Reasons:
- Consistent with OS conventions
- Simpler implementation
- Existing dialogs use native-looking elements (TextField, Button)
- Can add accent color via CSS `accent-color` property

### 2. "Select All" / "Select None" convenience

**Question:** Should we add "Select All" / "Select None" links?

**Recommendation:** Not for v1. Keep it simple. Can be added later if users request it.

### 3. `requirementNotMet` semantics for `!` buttons

**Recommendation:** `requirementNotMet = true` when no item has `checked === true`. Parallels textInput where `requirementNotMet = !currentValue.trim()`. A `!OK` button would be disabled until at least one checkbox is selected.

### 4. RadioboxesDialogData alignment

**Note:** The same `items: { label, checked? }[]` pattern should be applied to `RadioboxesDialogData` when that task is implemented. For radioboxes, only one item can be `checked: true` at a time.

## Acceptance Criteria

- [ ] `input.checkboxes` renders in Log View with checkboxes, optional title, and buttons
- [ ] Checking/unchecking toggles `item.checked` in entry (persisted to JSONL)
- [ ] Clicking a button resolves the dialog with `{ button, items }` (items contain final checked state)
- [ ] Resolved dialog becomes read-only (checkboxes disabled, buttons disabled)
- [ ] `!` button prefix disables button when nothing is checked
- [ ] `ui.dialog.checkboxes()` works in scripts — simple form (array) and full form (object)
- [ ] `input.checkboxes` works via MCP `ui_push` (flat entry format)
- [ ] Type definitions updated in both `.d.ts` files with both overloads
- [ ] MCP ui-push resource updated with entry type and example
- [ ] Preset `checked` values work (items can be pre-selected)
- [ ] Both `vertical` and `flex` layouts work correctly
- [ ] Scrollable list with `DIALOG_CONTENT_MAX_HEIGHT`
