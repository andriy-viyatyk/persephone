# US-150: Log item: input.select (renderer + ui.dialog.select)

**Epic:** EPIC-004
**Status:** Planned

## Goal

Add `input.select` dialog type to the Log View editor — a dropdown selection using the existing `ComboSelect` component, with buttons panel. Includes renderer component, script API (`ui.dialog.select`), and MCP documentation.

## Background

### Existing type definition (partially done)

`SelectEntry` is defined in `logTypes.ts:92-98` but is **incomplete** — missing `selected` and `buttons` fields:

```typescript
// Current (incomplete)
export interface SelectEntry extends LogEntryBase {
    type: "input.select";
    title?: StyledText;
    items: string[];
    placeholder?: string;
    button?: string;
}
```

Needs to become:

```typescript
export interface SelectEntry extends LogEntryBase {
    type: "input.select";
    title?: StyledText;
    items: string[];
    selected?: string;      // Currently selected item label
    placeholder?: string;
    buttons?: string[];
    button?: string;
}
```

Already included in `DIALOG_TYPES` set and `DialogEntryType` union. Type guards (`isDialogEntry`, `isDialogResolved`) already handle it.

### ComboSelect component

`src/renderer/components/form/ComboSelect.tsx` — a reusable dropdown with:
- `selectFrom: T[]` — items to select from
- `value: T` — currently selected value
- `onChange: (value?: T) => void` — selection callback
- `placeholder?: string` — input placeholder
- `disabled?: boolean` — disables the control
- Filter/search functionality via text input
- Keyboard navigation (Arrow keys, Enter, Escape)
- Clear button (×)
- Popper-based dropdown (portal) — safe inside virtualized grid

The component uses `ComboTemplate` which wraps a `TextField` + `Popper` dropdown.

### Key differences from radioboxes

| Aspect | Radioboxes | Select |
|--------|-----------|--------|
| UI | Inline radio buttons | Dropdown combo box |
| Component | Custom Radio items | Existing ComboSelect |
| Items | `string[]` | `string[]` |
| State field | `checked?: string` | `selected?: string` |
| Search | No | Built-in filter |
| Best for | Few options (2-6) | Many options (5+) |
| Layout | `vertical` / `flex` | Always single-line |
| Requirement | `!` disabled if nothing selected | `!` disabled if nothing selected |

### Reference pattern: RadioboxesDialogView

Structure: `DialogContainer` > styled root > `DialogHeader` > ComboSelect > `ButtonsPanel`

### Concern: ComboSelect width inside DialogContainer

`DialogContainer` has `width: fit-content`. The `ComboSelect` will need a reasonable width — either constrained by the dialog or set explicitly. The `Popper` dropdown renders via portal so it won't be clipped by `overflow: hidden` on `DialogContainer`.

When **resolved**, the ComboSelect should be `disabled` (grayed out, shows selected value but no dropdown).

### Concern: ComboSelect props mapping

ComboSelect uses generic `T` type, but for the dialog we use `string` items. Key props:
- `selectFrom={entry.items}` — the options
- `value={entry.selected}` — current selection
- `onChange={handleSelect}` — updates `draft.selected`
- `placeholder={entry.placeholder}` — optional placeholder text
- `disabled={resolved}` — lock after resolution

No `getLabel` needed since items are plain strings (default label function handles strings).

## Implementation Plan

### Step 1: Update `SelectEntry` type

**File:** `src/renderer/editors/log-view/logTypes.ts` (MODIFY)

Add `selected` and `buttons` fields:

```typescript
export interface SelectEntry extends LogEntryBase {
    type: "input.select";
    title?: StyledText;
    items: string[];
    selected?: string;
    placeholder?: string;
    buttons?: string[];
    button?: string;
}
```

### Step 2: Create `SelectDialogView`

**File:** `src/renderer/editors/log-view/items/SelectDialogView.tsx` (NEW)

Follow `RadioboxesDialogView` pattern:

```typescript
import styled from "@emotion/styled";
import { useCallback } from "react";
import { SelectEntry } from "../logTypes";
import { useLogViewModel } from "../LogViewContext";
import { DialogContainer } from "./DialogContainer";
import { DialogHeader } from "./DialogHeader";
import { ButtonsPanel } from "./ButtonsPanel";
import { ComboSelect } from "../../../components/form/ComboSelect";

const SelectRoot = styled.div({
    minWidth: 200,

    "& .select-control": {
        padding: "4px 8px",
    },
});

interface SelectDialogViewProps {
    entry: SelectEntry;
    updateEntry: (updater: (draft: SelectEntry) => void) => void;
}

const DEFAULT_BUTTONS = ["OK"];

export function SelectDialogView({ entry, updateEntry }: SelectDialogViewProps) {
    const vm = useLogViewModel();
    const resolved = entry.button !== undefined;
    const buttons = entry.buttons ?? DEFAULT_BUTTONS;

    const handleSelect = useCallback(
        (value?: string) => {
            updateEntry((draft) => {
                draft.selected = value;
            });
        },
        [updateEntry],
    );

    const handleClick = useCallback(
        (label: string) => {
            vm.resolveDialog(entry.id, label);
        },
        [vm, entry.id],
    );

    const requirementNotMet = !entry.selected;

    return (
        <DialogContainer resolved={resolved}>
            <SelectRoot>
                <DialogHeader title={entry.title} />
                <div className="select-control">
                    <ComboSelect
                        selectFrom={entry.items}
                        value={entry.selected}
                        onChange={handleSelect}
                        placeholder={entry.placeholder}
                        disabled={resolved}
                    />
                </div>
                <ButtonsPanel
                    buttons={buttons}
                    button={entry.button}
                    requirementNotMet={requirementNotMet}
                    onClickButton={handleClick}
                />
            </SelectRoot>
        </DialogContainer>
    );
}
```

### Step 3: Wire into LogEntryContent

**File:** `src/renderer/editors/log-view/LogEntryContent.tsx` (MODIFY)

Add import for `SelectDialogView` and `SelectEntry`.

Add case in switch after `input.radioboxes`:

```typescript
case "input.select":
    return (
        <SelectDialogView
            entry={entry as SelectEntry}
            updateEntry={updateEntry as any}
        />
    );
```

### Step 4: Add `ui.dialog.select()` to UiFacade

**File:** `src/renderer/scripting/api-wrapper/UiFacade.ts` (MODIFY)

Add `select` method to the `dialog` object (after `radioboxes`):

```typescript
select: (itemsOrOpts: string[] | { items: string[]; title?: StyledText; selected?: string; placeholder?: string; buttons?: string[] }, title?: StyledText, buttons?: string[]): Promise<LogEntry> => {
    if (Array.isArray(itemsOrOpts)) {
        return this.vm.addDialogEntry("input.select", { items: itemsOrOpts, title, buttons });
    }
    return this.vm.addDialogEntry("input.select", itemsOrOpts);
},
```

No normalization needed — items are plain strings.

### Step 5: Add TypeScript declarations

**File:** `src/renderer/api/types/ui-log.d.ts` (MODIFY)
**File:** `assets/editor-types/ui-log.d.ts` (MODIFY — keep in sync)

Add to `IUiDialog` interface (after `radioboxes` overloads):

```typescript
/**
 * Show a dropdown select dialog. Returns the selected item in `result.selected`.
 * Default buttons: ["OK"]. Use `!` prefix for buttons that require a selection.
 *
 * @example
 * // Simple form
 * const result = await ui.dialog.select(["Option A", "Option B", "Option C"]);
 * const result = await ui.dialog.select(["A", "B", "C"], "Pick one", ["!OK", "Cancel"]);
 *
 * @example
 * // Full form with pre-selected item
 * const result = await ui.dialog.select({
 *     items: ["Small", "Medium", "Large"],
 *     title: "Select size",
 *     selected: "Medium",
 *     placeholder: "Choose...",
 *     buttons: ["!Apply", "Cancel"],
 * });
 *
 * @example
 * if (result.button === "OK") {
 *     ui.info(`Selected: ${result.selected}`);
 * }
 */
select(items: string[], title?: IStyledText, buttons?: string[]): Promise<IDialogResult>;
select(options: {
    items: string[];
    title?: IStyledText;
    selected?: string;
    placeholder?: string;
    buttons?: string[];
}): Promise<IDialogResult>;
```

### Step 6: Update MCP documentation

**File:** `assets/mcp-res-ui-push.md` (MODIFY)

The `input.select` row is likely already in the dialog entries table (from EPIC planning). Verify and add example:

```
// Select dropdown dialog
ui_push({ entries: [
    { type: "input.select", title: "Select format", items: ["JSON", "CSV", "XML"], placeholder: "Choose format...", buttons: ["!OK", "Cancel"] }
] })
→ blocks → { results: [{ button: "OK", selected: "JSON", ... }] }
```

Add to dialog results description: "Select dialogs include `selected` with the selected item label"

### Step 7: Add test entries to test.log.jsonl

**File:** `D:\js-notepad-notes\temp\test.log.jsonl` (MODIFY)

Add a few select entries with varying configurations:
- With title, placeholder, pre-selected, resolved
- Without title, unresolved (pending)
- With styled title

## Concerns / Open Questions

1. **ComboSelect Popper z-index:** The dropdown uses `Popper` which renders outside the normal flow. Inside the Log View's virtualized grid, the Popper should still work correctly since it uses a portal. But we should verify it renders above other rows.

2. **Width control:** ComboSelect calculates its dropdown width from the anchor element width. Inside `SelectRoot` with `minWidth: 200`, the combo should be reasonably sized. May need to add a specific width or `width: 100%` to the ComboSelect wrapper if it looks too narrow.

3. **No `layout` option:** Unlike checkboxes/radioboxes, select doesn't need layout variants — it's always a single dropdown control.

## Acceptance Criteria

- [ ] `SelectEntry` type updated with `selected` and `buttons` fields
- [ ] `SelectDialogView` renders ComboSelect, title, and buttons
- [ ] ComboSelect shows items in dropdown with search/filter
- [ ] Selection updates `entry.selected` via `updateEntry`
- [ ] `!` button prefix works (disabled until item selected)
- [ ] Pre-selected `selected` value honored on creation
- [ ] Dialog resolves with `{ button, selected }` on button click
- [ ] Resolved state shows selected value (ComboSelect disabled, grayed out)
- [ ] `ui.dialog.select()` works with simple form (items[], title?, buttons?)
- [ ] `ui.dialog.select()` works with full form ({ items, title?, selected?, placeholder?, buttons? })
- [ ] MCP `ui_push` accepts `input.select` entries
- [ ] Type declarations in both `.d.ts` files with JSDoc and examples
- [ ] MCP resource documentation updated with select example
- [ ] Test entries in test.log.jsonl for visual review
