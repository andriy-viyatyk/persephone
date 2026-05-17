# US-539: UIKit `MultiSelect` — multi-value selection primitive

## Status

**Placeholder.** Part of [EPIC-025](../../epics/EPIC-025.md) Phase 4 —
UIKit primitive infrastructure. Deferred-review model: this task does
NOT run `/review`, `/document`, or `/userdoc` — those run at epic
close.

## Goal

Build a new UIKit primitive `uikit/MultiSelect` that supports selecting
multiple values from a list with a search box, virtualised rows, and
a select-all checkbox. Replaces legacy `components/form/ListMultiselect`
(currently AVGrid's filter-popover internal). After this task,
`uikit/MultiSelect` is available for use by the AVGrid migration
([US-536](../US-536-uikit-datagrid/README.md)) and any future caller
(Settings page, script-built UIs, column-visibility dropdown, etc.).

`MultiSelect` is a peer of `Select` — it shares the dropdown layout
and search affordance but operates on a `value: T[]` instead of
`value: T | null`.

## Background

### Why this is a UIKit primitive (not internal to AVGrid)

The widget is general-purpose: a dropdown of multi-selectable items
with optional search. Use cases beyond AVGrid:

- Settings page — multi-select preferences.
- Phase 6 Script UI API — descriptors of the form
  `{ component: "MultiSelect", items: [...], value: [...] }`.
- Column visibility in `ColumnsOptions.tsx` (currently a one-off).
- Future tag-picker, filter-multipicker, etc.

### Composition

Build on top of `uikit/ListBox` (which already does virtualisation
+ keyboard nav + filtering) and `uikit/Popover` (dropdown chrome).
The pattern mirrors `uikit/Select`:

- Anchor element (Input-like trigger showing the current selection
  count or a comma-joined preview) + chevron.
- Popover anchored to the trigger.
- Inside popover: search box + ListBox with multi-row selection
  (each row has a Checkbox).

`ListBox` already supports multi-selection via its `selected` /
`onSelectChange` API (verified in US-484 extensions). The
new primitive composes it.

### Public API sketch (to be refined during implementation)

```ts
interface MultiSelectProps<T = IListBoxItem> {
    name?: string;
    items: T[] | Traited<T[]>;     // Rule 3
    value: T[];                     // current selection
    onChange: (value: T[]) => void;
    placeholder?: string;
    disabled?: boolean;
    readOnly?: boolean;
    size?: "sm" | "md";

    // Dropdown
    filterMode?: "startsWith" | "contains" | "off";
    maxVisibleItems?: number;
    rowHeight?: number;
    resizable?: boolean;
    matchAnchorWidth?: boolean;
    emptyMessage?: string;

    // Optional select-all checkbox at the top of the dropdown
    selectAll?: boolean;

    // Display formatting of the current value in the trigger
    formatSelection?: (value: T[]) => string;  // default: "(n) selected" or comma-join up to N

    width?: number | string;
    minWidth?: number | string;
    maxWidth?: number | string;
}
```

### Legacy reference

`src/renderer/components/form/ListMultiselect.tsx` is the current
implementation. It supports:
- Search filter
- Virtualised rows
- Select-all checkbox
- Custom row label via `getLabel`
- Disabled rows

The new `uikit/MultiSelect` covers the same surface, plus Rule 1–8
conformance (`data-type`, `data-name`, model-view pattern, omit
`style` / `className`).

## Implementation plan (high-level)

1. **Scaffold.**
   - `uikit/MultiSelect/MultiSelect.tsx` — view (forwardRef, ~150
     LOC).
   - `uikit/MultiSelect/MultiSelectModel.ts` — state + actions
     (~200 LOC).
   - `uikit/MultiSelect/MultiSelect.story.tsx` — stories: small
     items list, large virtualised list, with search, with
     select-all, with custom formatSelection.
   - `uikit/MultiSelect/index.ts` — public exports.
2. **Trigger.** Reuse `uikit/Input` as the trigger (readonly,
   matches Select's anchor). Display the formatted selection via
   `formatSelection`. Chevron in `endSlot`.
3. **Popover.** Anchored to the Input via `model.rootRef`. Content
   contains: optional select-all Checkbox at top + ListBox below.
4. **Multi-selection.** Adapt ListBox's existing multi-select
   wiring. Click a row → toggle in value. Keyboard: Space toggles
   the active row.
5. **Search.** Inline search box at the top of the popover (or
   filter the ListBox via its `searchText` prop — match Select's
   pattern).
6. **Rule 7 audit.** Omit `style` and `className` from
   `MultiSelectProps`. Confirm Storybook tests render with only
   prop-driven layout.
7. **Barrel.** Export `MultiSelect`, `MultiSelectProps` from
   `uikit/index.ts`.

## Concerns / open questions

### A. Composition — does ListBox's multiselect API cover everything?

UIKit ListBox `selected` / `onSelectChange` was added in US-484.
Verify it supports the cell-toggle pattern needed here (Space
toggles active row, click toggles a specific row) before
implementation. If gaps surface, file a small ListBox-extension
prep step or absorb into MultiSelect's own model.

### B. Search box placement — inside Popover or shared with trigger?

Two patterns:
1. Trigger reads "(n) selected"; click opens Popover; inside, a
   search Input filters the list. (Legacy `ListMultiselect`
   pattern.)
2. Trigger IS the search Input (like `Select` — typing filters);
   open state managed by chevron. Selection chips visible in the
   trigger.

**Recommendation:** pattern 1 — separate trigger and search. The
trigger should display the *current selection count or preview*,
not be a search input. Pattern 2 conflates "what's selected" with
"what to find", which works for single-Select (only one selected
value to show) but gets confusing with multiple selections.

### C. Select-all behaviour with filtered list

When the search filter is active, does "select all" select all
visible items or all items?

**Recommendation:** **select all visible items** (only items
matching the current filter). Mirrors typical multi-checkbox
filters. Tri-state: indeterminate when some-but-not-all visible
items are selected.

## Acceptance criteria

- [ ] `src/renderer/uikit/MultiSelect/` exists with
      `MultiSelect.tsx`, `MultiSelectModel.ts`, `MultiSelect.story.tsx`,
      `index.ts`.
- [ ] `MultiSelectProps` omits `style` and `className` (Rule 7).
- [ ] `MultiSelectProps` accepts `name?: string` and emits
      `data-name` on the root.
- [ ] `items` prop accepts `T[] | Traited<T[]>` (Rule 3).
- [ ] `data-type="multiselect"` on the root.
- [ ] Storybook stories cover: small list, virtualised large list
      (≥ 200 items), with search, with select-all.
- [ ] `npm run lint` clean; `npx tsc --noEmit` reports no new errors.
- [ ] Manual smoke (Storybook stories all render and respond to
      interaction).

## Links

- Epic: [EPIC-025](../../epics/EPIC-025.md)
- Phase: 4 — UIKit primitive infrastructure
- Composes: [US-468](../US-468-uikit-listbox/README.md) (UIKit
  ListBox), [US-466](../US-466-uikit-popover/README.md) (UIKit
  Popover), [US-471](../US-471-uikit-input-slots/README.md) (Input
  endSlot)
- Unblocks: [US-536](../US-536-uikit-datagrid/README.md) (AVGrid
  migration consumes `MultiSelect` in `OptionsFilterContent.tsx`)
