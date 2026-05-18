# US-539: UIKit `MultiSelect` — multi-value selection primitive

## Status

**Implemented (review deferred).** Part of [EPIC-025](../../epics/EPIC-025.md)
Phase 4 — UIKit primitive infrastructure. Deferred-review model: this task
does NOT run `/review`, `/document`, or `/userdoc` — those run at epic
close.

### Implementation summary

- `src/renderer/uikit/MultiListBox/MultiListBox.tsx` — view (~360 LOC,
  plain function component composing `Input` + custom select-all row +
  `ListBox` with `renderItem` for per-row Checkbox).
- `src/renderer/uikit/MultiListBox/MultiListBox.story.tsx` — Storybook
  story registered under section "Lists".
- `src/renderer/uikit/MultiListBox/index.ts` — public exports.
- `src/renderer/uikit/MultiSelect/MultiSelect.tsx` — view (forwardRef,
  ~130 LOC).
- `src/renderer/uikit/MultiSelect/MultiSelectModel.ts` — open/close
  state + handlers + display-text memo (~200 LOC, mirrors
  `SelectModel`).
- `src/renderer/uikit/MultiSelect/MultiSelect.story.tsx` — Storybook
  story registered under section "Lists".
- `src/renderer/uikit/MultiSelect/index.ts` — public exports.
- `src/renderer/uikit/index.ts` — barrel updated.
- `src/renderer/editors/storybook/storyRegistry.ts` — new stories
  registered.

Lint clean; `npx tsc --noEmit` reports no new errors from the new files.
Manual UI smoke not yet performed (awaiting Storybook check).

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

Mirror the `ListBox` / `Select` pattern. **Two** new primitives:

1. **`uikit/MultiListBox`** — standalone multi-select list.
   - Composes `uikit/ListBox` (virtualisation + keyboard nav +
     filtering) and adds a built-in search Input + optional
     select-all checkbox + per-row Checkbox affordance.
   - Standalone callers: Settings page, Phase 6 Script UI,
     column-visibility pickers, etc.

2. **`uikit/MultiSelect`** — dropdown wrapper around `MultiListBox`.
   - Trigger: readonly `uikit/Input` showing the formatted
     selection preview ("(n) selected" or comma-joined) +
     chevron `endSlot`.
   - Popover anchored to the trigger; content is a single
     `<MultiListBox>`.

`ListBox` already supports multi-selection via its `selected` /
`onSelectChange` API (verified in US-484 extensions); `MultiListBox`
composes it rather than re-implementing selection. `MultiSelect`
stays thin — Input + Popover + MultiListBox — with no extra
selection or search wiring of its own.

Parallels:

| Single-value | Multi-value      |
|--------------|------------------|
| `ListBox`    | `MultiListBox`   |
| `Select`     | `MultiSelect`    |

### Public API sketch (to be refined during implementation)

```ts
interface MultiListBoxProps<T = IListBoxItem> {
    name?: string;
    items: T[] | Traited<T[]>;     // Rule 3
    value: T[];                     // current selection
    onChange: (value: T[]) => void;
    disabled?: boolean;
    readOnly?: boolean;
    size?: "sm" | "md";

    // Built-in search Input
    showSearch?: boolean;           // default: true
    filterMode?: "startsWith" | "contains" | "off";
    searchPlaceholder?: string;

    // Virtualisation (delegated to inner ListBox)
    rowHeight?: number;
    maxVisibleItems?: number;

    // Optional select-all checkbox row at the top
    selectAll?: boolean;

    emptyMessage?: string;

    width?: number | string;
    height?: number | string;
}

interface MultiSelectProps<T = IListBoxItem> {
    name?: string;
    items: T[] | Traited<T[]>;
    value: T[];
    onChange: (value: T[]) => void;
    placeholder?: string;
    disabled?: boolean;
    readOnly?: boolean;
    size?: "sm" | "md";

    // Forwarded to inner MultiListBox
    filterMode?: "startsWith" | "contains" | "off";
    rowHeight?: number;
    maxVisibleItems?: number;
    selectAll?: boolean;
    emptyMessage?: string;

    // Dropdown chrome
    resizable?: boolean;
    matchAnchorWidth?: boolean;

    // Trigger label formatter
    formatSelection?: (value: T[]) => string;  // default: "(n) selected"

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

1. **Scaffold `MultiListBox` first.**
   - `uikit/MultiListBox/MultiListBox.tsx` — view (forwardRef,
     ~150 LOC).
   - `uikit/MultiListBox/MultiListBox.story.tsx` — stories: small
     list, virtualised large list (≥ 200 items), with search,
     with select-all, disabled rows.
   - `uikit/MultiListBox/index.ts` — public exports.
   - Composition: built-in search Input on top (when
     `showSearch !== false`, default true), optional select-all
     Checkbox row, `<ListBox>` below in multi-select mode (Space
     toggles active row, click toggles row, per-row Checkbox
     icon).
2. **Scaffold `MultiSelect`.**
   - `uikit/MultiSelect/MultiSelect.tsx` — view (forwardRef,
     ~120 LOC).
   - `uikit/MultiSelect/MultiSelectModel.ts` — open/close state +
     `rootRef` (mirrors `SelectModel`).
   - `uikit/MultiSelect/MultiSelect.story.tsx` — stories: basic
     usage, with select-all, custom `formatSelection`,
     virtualised items.
   - `uikit/MultiSelect/index.ts` — public exports.
3. **MultiSelect trigger.** Reuse `uikit/Input` (readonly) showing
   the formatted selection via `formatSelection`. Chevron in
   `endSlot`. Open Popover on click / Enter / Space / ArrowDown.
4. **MultiSelect popover.** Anchored to the Input via
   `model.rootRef`. Content is a single `<MultiListBox>` — no
   extra search or select-all wiring (those live inside
   MultiListBox).
5. **Select-all behaviour.** When `selectAll` is true, renders as
   the first row in the dropdown. Tri-state checkbox: checked
   when all visible items are selected, indeterminate when
   some-but-not-all visible items are selected, unchecked
   otherwise. Toggling selects/deselects only the *currently
   visible* (filtered) items (Concern C).
6. **Rule 7 audit.** Both `MultiListBoxProps` and `MultiSelectProps`
   omit `style` and `className`. `data-type="multilistbox"` and
   `data-type="multiselect"` respectively on the roots. Confirm
   Storybook tests render with only prop-driven layout.
7. **Barrel.** Export `MultiListBox`, `MultiListBoxProps`,
   `MultiSelect`, `MultiSelectProps` from `uikit/index.ts`.

## Concerns / open questions

### A. Composition — does ListBox's multiselect API cover everything? — RESOLVED

**Decision (user, 2026-05-18):** Do NOT enhance `ListBox` with
multi-select mode flags. Introduce a separate `MultiListBox`
primitive that composes `ListBox` under the hood.

- Keeps `ListBox` focused on the single-selection / picker
  contract.
- Mirrors the `Select` / `ListBox` parallel cleanly:
  single = `ListBox`/`Select`; multi = `MultiListBox`/`MultiSelect`.
- `MultiListBox` is usable standalone (Settings, Phase 6 Script
  UI, custom dropdowns) — not just an AVGrid internal.

`MultiListBox` reuses `ListBox`'s existing multi-select wiring
(`selected` / `onSelectChange`, added in US-484) and layers in a
built-in search Input + select-all row + per-row Checkbox.

### B. Search box placement — inside Popover or shared with trigger? — RESOLVED

**Decision (user, 2026-05-18):** Pattern 1 — search Input lives
**inside `MultiListBox`** (built-in, top of the list).
`MultiSelect`'s trigger is a readonly Input showing the
selection preview via `formatSelection`.

Rationale: because `MultiListBox` is a standalone primitive,
search must be ergonomic for callers that drop it in without a
Popover wrapper. Building search into `MultiListBox` makes
standalone use trivial and keeps `MultiSelect` a thin Popover
wrapper.

Pattern 2 (trigger IS the search Input, à la `Select`)
conflates "what's selected" with "what to find" — manageable
for single-Select (one value to display) but visually awkward
with multiple selections.

### C. Select-all behaviour with filtered list — RESOLVED

**Decision (user, 2026-05-18):** "Select all" operates on the
**currently visible (filtered) items** only — not on the full
item set.

- Checkbox is checked when all visible items are selected.
- Indeterminate (tri-state) when some-but-not-all visible items
  are selected.
- Unchecked when no visible items are selected.
- Toggling on selects every currently visible item (preserving
  any out-of-filter selections).
- Toggling off deselects every currently visible item
  (preserving out-of-filter selections).

This mirrors typical multi-checkbox filter UIs (e.g. Excel
column filters) and lets users incrementally build up a
selection across multiple searches.

## Acceptance criteria

- [ ] `src/renderer/uikit/MultiListBox/` exists with
      `MultiListBox.tsx`, `MultiListBox.story.tsx`, `index.ts`.
- [ ] `src/renderer/uikit/MultiSelect/` exists with
      `MultiSelect.tsx`, `MultiSelectModel.ts`, `MultiSelect.story.tsx`,
      `index.ts`.
- [ ] Both `MultiListBoxProps` and `MultiSelectProps` omit `style`
      and `className` (Rule 7).
- [ ] Both accept `name?: string` and emit `data-name` on the root.
- [ ] `items` prop on both accepts `T[] | Traited<T[]>` (Rule 3).
- [ ] `data-type="multilistbox"` on the `MultiListBox` root;
      `data-type="multiselect"` on the `MultiSelect` root.
- [ ] `MultiSelect` is composed (its DOM contains a `MultiListBox`
      inside a `Popover` anchored to its trigger Input) — verify
      via a Storybook DOM inspection.
- [ ] Storybook stories for both primitives cover: small list,
      virtualised large list (≥ 200 items), with search, with
      select-all (incl. tri-state behaviour under filter), disabled
      rows.
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
