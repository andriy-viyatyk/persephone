# US-149: Log item: input.radioboxes (renderer + ui.dialog.radioboxes)

**Epic:** EPIC-004
**Status:** Planned

## Goal

Add `input.radioboxes` dialog type to the Log View editor — a single-selection radio button group with buttons panel. Includes renderer component, script API (`ui.dialog.radioboxes`), and MCP documentation.

## Background

### Existing type definition (already done)

`RadioboxesEntry` is already defined in `logTypes.ts:82-89`:

```typescript
export interface RadioboxesEntry extends LogEntryBase {
    type: "input.radioboxes";
    title?: StyledText;
    items: string[];           // Array of radio option labels (simple strings)
    checked?: string;          // Currently selected item label
    buttons?: string[];
    button?: string;
}
```

Already included in `DIALOG_TYPES` set and `DialogEntryType` union. Type guards (`isDialogEntry`, `isDialogResolved`) already handle it.

### Key differences from checkboxes

| Aspect | Checkboxes | Radioboxes |
|--------|-----------|-----------|
| Selection | Multiple (0+) | Single (0 or 1) |
| Items | `CheckboxItem[]` with `{ label, checked }` | `string[]` (labels only) |
| State field | Each item has `checked: boolean` | Single `checked?: string` (selected label) |
| Requirement | `!` button disabled if **no items checked** | `!` button disabled if **nothing selected** |
| Icons | CheckedIcon / UncheckedIcon (squares) | RadioCheckedIcon / RadioUncheckedIcon (circles) |

### Reference pattern: CheckboxesDialogView

Structure: `DialogContainer` > styled root > `DialogHeader` > item list > `ButtonsPanel`

### Available icons

`RadioCheckedIcon` and `RadioUncheckedIcon` already exist in `src/renderer/theme/icons.tsx`.

## Implementation Plan

### Step 1: Create `Radio` component

**File:** `src/renderer/components/basic/Radio.tsx` (NEW)

Follow `Checkbox.tsx` pattern exactly:
- `RadioRoot` styled label with `inline-flex`, gap 4, cursor pointer
- Props: `checked`, `disabled`, `onChange`, `children`, `className`
- Use `RadioCheckedIcon` / `RadioUncheckedIcon` from `../../theme/icons`
- Same disabled styling (opacity 0.5, no hover effect)
- `onChange` callback receives `void` (not boolean) — clicking a radio always selects it

```typescript
interface RadioProps {
    checked?: boolean;
    disabled?: boolean;
    onChange?: () => void;      // No boolean — radio always selects
    children?: React.ReactNode;
    className?: string;
}
```

### Step 2: Create `RadioboxesDialogView`

**File:** `src/renderer/editors/log-view/items/RadioboxesDialogView.tsx` (NEW)

Follow `CheckboxesDialogView.tsx` pattern:
- `RadioboxesRoot` styled div, same structure as `CheckboxesRoot`
- Nested classes: `.radio-list` (flex container), `.radio-item` (font size 14)
- Layout support: `vertical` (default) and `flex` (horizontal wrap)
- `handleSelect(label)` → `updateEntry(draft => { draft.checked = label })`
- `requirementNotMet` = `entry.checked === undefined` (nothing selected)
- Default buttons: `["OK"]`

### Step 3: Wire into LogEntryContent

**File:** `src/renderer/editors/log-view/LogEntryContent.tsx` (MODIFY)

Add case in switch at ~line 130 (after `input.checkboxes`):

```typescript
case "input.radioboxes":
    return (
        <RadioboxesDialogView
            entry={entry as RadioboxesEntry}
            updateEntry={updateEntry as any}
        />
    );
```

Add import for `RadioboxesDialogView` and `RadioboxesEntry`.

### Step 4: Add `ui.dialog.radioboxes()` to UiFacade

**File:** `src/renderer/scripting/api-wrapper/UiFacade.ts` (MODIFY)

Add `radioboxes` method to the `dialog` object (after `checkboxes`):

```typescript
radioboxes: (itemsOrOpts: string[] | { items: string[]; title?: StyledText; checked?: string; layout?: "vertical" | "flex"; buttons?: string[] }, title?: StyledText, buttons?: string[]): Promise<LogEntry> => {
    if (Array.isArray(itemsOrOpts)) {
        return this.vm.addDialogEntry("input.radioboxes", { items: itemsOrOpts, title, buttons });
    }
    return this.vm.addDialogEntry("input.radioboxes", itemsOrOpts);
},
```

No normalization needed — items are plain strings (unlike checkboxes which need `string → { label }` conversion).

### Step 5: Add TypeScript declarations

**File:** `src/renderer/api/types/ui-log.d.ts` (MODIFY)
**File:** `assets/editor-types/ui-log.d.ts` (MODIFY — keep in sync)

Add to `IUiDialog` interface (after `checkboxes` overloads):

```typescript
/**
 * Show a radio buttons dialog. Returns the selected item in `result.checked`.
 * Default buttons: ["OK"]. Use `!` prefix for buttons that require a selection.
 *
 * @example
 * // Simple form
 * const result = await ui.dialog.radioboxes(["Option A", "Option B", "Option C"]);
 * const result = await ui.dialog.radioboxes(["A", "B", "C"], "Pick one", ["!OK", "Cancel"]);
 *
 * @example
 * // Full form
 * const result = await ui.dialog.radioboxes({
 *     items: ["Small", "Medium", "Large"],
 *     title: "Select size",
 *     checked: "Medium",
 *     buttons: ["!Apply", "Cancel"],
 * });
 *
 * @example
 * if (result.button === "OK") {
 *     ui.info(`Selected: ${result.checked}`);
 * }
 */
radioboxes(items: string[], title?: IStyledText, buttons?: string[]): Promise<IDialogResult>;
radioboxes(options: {
    items: string[];
    title?: IStyledText;
    checked?: string;
    layout?: "vertical" | "flex";
    buttons?: string[];
}): Promise<IDialogResult>;
```

### Step 6: Update MCP documentation

**File:** `assets/mcp-res-ui-push.md` (MODIFY)

Add to dialog entries table:

```
| `input.radioboxes` | `items: string[], title?, checked?, layout?, buttons?` | Radio selection — result includes `checked` with selected item label |
```

Add example:

```
// Radio buttons dialog
ui_push({ entries: [
    { type: "input.radioboxes", title: "Select size", items: ["Small", "Medium", "Large"], buttons: ["!OK", "Cancel"] }
] })
→ blocks → { results: [{ button: "OK", checked: "Medium", ... }] }
```

## Concerns / Open Questions

1. **Pre-selected item via `checked` field:** The type allows `checked?: string` for a pre-selected radio. The renderer should honor this — if `checked` is set on creation, that radio should be initially selected. This also means `requirementNotMet` should check `!entry.checked` (empty string or undefined).

2. **No normalization needed:** Unlike checkboxes (which have `{ label, checked }` objects), radioboxes items are plain strings. The UiFacade method doesn't need a `normalizeItems` helper.

## Acceptance Criteria

- [ ] `Radio` component works standalone (checked/unchecked/disabled states)
- [ ] `RadioboxesDialogView` renders radio items, title, and buttons
- [ ] Single selection enforced — clicking one radio deselects previous
- [ ] `!` button prefix works (disabled until item selected)
- [ ] Pre-selected `checked` value honored on creation
- [ ] Dialog resolves with `{ button, checked }` on button click
- [ ] Resolved state shows selected radio (disabled, grayed out)
- [ ] `ui.dialog.radioboxes()` works with simple form (items[], title?, buttons?)
- [ ] `ui.dialog.radioboxes()` works with full form ({ items, title?, checked?, layout?, buttons? })
- [ ] MCP `ui_push` accepts `input.radioboxes` entries
- [ ] Type declarations in both `.d.ts` files with JSDoc and examples
- [ ] MCP resource documentation updated with radioboxes example
