# US-536: `components/data-grid/` → `uikit/AVGrid/` migration

## Status

**Implemented (review deferred).** Part of
[EPIC-025](../../epics/EPIC-025.md) Phase 4 — UIKit composite-primitive
migration. Deferred-review model: this task does NOT run `/review`,
`/document`, or `/userdoc` — those run at epic close.

### Implementation summary (2026-05-18)

- Moved 29 files from `components/data-grid/` to `uikit/AVGrid/` via
  `git mv` (history preserved). `FilterPoper.tsx` → `FilterPopover.tsx`
  rename applied during the move.
- Added `name?: string` to `AVGridProps` + propagated to RenderGrid's
  `data-name` (Rule 1 / US-521). Dropped the dead `className?: string`
  from `AVGridProps`.
- Built `uikit/TruncatedText/` (~50 LOC + story) replacing
  `basic/OverflowTooltipText`.
- Built `uikit/AVGrid/CellInput.tsx` + `uikit/AVGrid/CellSelect.tsx`
  thin wrappers over `uikit/Input` and `uikit/Select`. `CellAutocomplete`
  not created — legacy `DefaultOptionsEdit` never used free-text mode.
- Extended `uikit/Select` with `onEscape?: () => void` callback so the
  grid's EditingModel can receive Esc-cancel even though Select stops
  Esc propagation. Phase 2 audit's lone gap.
- Rewrote `DefaultEditFormater` to use `CellInput` / `CellSelect`.
- Rewrote `FilterBar` to use `uikit/Tag` + `uikit/IconButton`.
- Rewrote `FilterPopover` to use `uikit/Popover` (dropped legacy
  `styled(Popper)` wrapper).
- Rewrote `OptionsFilterContent` to use `uikit/MultiListBox` (with
  built-in search + select-all) + `uikit/Button`. Dropped the external
  TextField + `useFilteredOptions`. Inlined `emptyLabel` locally.
- Retargeted internal legacy imports inside `uikit/AVGrid/`:
  `basic/Button` → `uikit/IconButton`, `basic/CircularProgress` →
  `uikit/Spinner`, `basic/useHighlightedText` → `uikit/shared/highlight`
  (`highlightText` → `highlight`), `basic/OverflowTooltipText` →
  `uikit/TruncatedText`, `overlay/PopupMenu MenuItem` → `uikit/Menu`,
  `form/utils beep` → new `core/utils/audio.ts`.
- Updated `uikit/index.ts` top-level barrel with AVGrid public surface +
  TruncatedText. Removed `export * from './data-grid'` from
  `components/index.ts`.
- Flipped all 6 callers (`editors/grid/{GridEditor,GridViewModel,
  components/ColumnsOptions,utils/grid-utils}`, `editors/graph/
  GraphDetailPanel`, `editors/log-view/items/GridOutputView`) to
  `../../../uikit` barrel.
- Registered `TruncatedText` story in storybook registry.
- `npm run lint` and `npx tsc --noEmit` both at baseline (20 errors / 896
  warnings in the same 4 pre-existing files — no new tsc errors, no new
  lint errors).
- Grep verifies: zero `components/data-grid` imports remaining; zero
  legacy `components/{basic,form,overlay,virtualization}/` imports
  inside `uikit/AVGrid/`.

### Minor behaviour deltas (documented for testing)

- **FilterChip selected state**: legacy used an `outline` (1px blue
  ring) when the filter popover was open; UIKit Tag's `selected` flag
  applies a filled background + colored border instead. Same intent,
  slightly different surface.
- **Filter popover italic options**: legacy `OptionsFilterContent`
  italicized `(empty)` / `italic: true` rows via `getOptionClass`. UIKit
  MultiListBox has no per-item class hook; italic styling is dropped.
  The `(empty)` label is still rendered. Can be added back via a custom
  `renderItem` if desired.
- **Filter popover resized state**: legacy stretched the list to fill
  the resized popover. New version uses MultiListBox `height="100%"`
  inside a `flex: 1` wrapper — equivalent visual result.

**Precursors landed** in commit `2322213` (2026-05-18):
- [US-538](../US-538-uikit-rendergrid/README.md) — UIKit `RenderGrid`
  promotion. `src/renderer/uikit/RenderGrid/` exists; folder barrel
  exports `RenderGrid`, `RenderGridModel`, `RenderFlexGrid`, plus
  types `RefType`, `RerenderInfo`, `RenderCell`, `RenderCellFunc`,
  `RenderCellParams`, `Percent`, `RowAlign`. Top-level `uikit/index.ts`
  re-exports the curated subset (`RenderGrid`, `RenderGridModel`,
  `RenderFlexGrid`, `RenderCellFunc`, `RenderCellParams`, `Percent`,
  `RowAlign`); AVGrid imports `RefType`/`RerenderInfo`/`RenderCell`
  from the folder barrel directly.
- [US-539](../US-539-uikit-multiselect/README.md) — UIKit `MultiSelect`
  + `MultiListBox`. `src/renderer/uikit/MultiSelect/` and
  `uikit/MultiListBox/` exist; both exported from `uikit/index.ts`.

**AVGrid → RenderGrid imports already flipped** in commit `2322213`:
during US-538's caller-flip sweep, four AVGrid files
(`AVGrid.tsx`, `avGridTypes.ts`, `model/AVGridModel.ts`,
`model/FocusModel.ts`) had their `components/virtualization/RenderGrid`
imports retargeted to `uikit/RenderGrid` in-place. When this task
moves AVGrid to `uikit/AVGrid/`, those imports become `../RenderGrid`
(sibling UIKit folder).

All open concerns resolved by user review on 2026-05-17. Residual
concerns E and L resolved post-US-538 (see Concerns section).

## Goal

Migrate the entire `src/renderer/components/data-grid/` module — the
`AVGrid` composite, its `filters/` subfolder, its 13-file `model/`
namespace, and supporting utilities — into UIKit at
`src/renderer/uikit/AVGrid/`. The component name `AVGrid` is preserved
(Andriy Viyatyk's initials — historical signature). After this task,
`components/data-grid/` has zero external callers, the six call sites
in `editors/grid/`, `editors/graph/`, and `editors/log-view/` import
from `uikit/AVGrid/` (or the `uikit` barrel) instead, and the legacy
folder is deletable by US-532.

Functionality is preserved verbatim. UIKit-pattern adjustments:
- Making `AVGrid`'s public prop type Rule-7 compliant
  (`Omit<…, "style" | "className">`).
- Retargeting AVGrid's internal legacy imports (`basic/`, `form/`,
  `overlay/`, `virtualization/`) to UIKit equivalents.
- Porting `FilterPoper` → `FilterPopover` (UIKit `Popover`).
- Replacing internal cell editors with UIKit `Input` and UIKit
  `Select` (with adaptations to Select if needed for inline-edit
  semantics).
- Replacing legacy `ListMultiselect` with UIKit `MultiSelect`
  (delivered by US-539).
- Propagating `name` debug prop through to the inner `RenderGrid`'s
  `data-name` attribute.
- Filter chips composed from UIKit `Tag`.

The six external callers see only import-path changes plus optional
`name` adoption.

## Background

### Folder inventory (29 files, ≈3,400 LOC)

**Top-level**
- `index.ts` — barrel
- `column-width.ts` — standalone utility (no internal imports)
- `useResolveOptions.ts` — standalone hook (no internal imports)

**AVGrid composite (8 files)**
- `AVGrid.tsx` — main component (313 lines, `@emotion/styled`,
  `theme/color`)
- `DataCell.tsx`, `HeaderCell.tsx`, `SelectColumn.tsx`,
  `DefaultEditFormater.tsx` — cell renderers (all use
  `@emotion/styled` + `theme/color`)
- `avGridTypes.ts` — public types (`Column`, `CellFocus`, `TFilter`,
  `TSortColumn`, `TDisplayOption`, `TCellRendererProps`, …)
- `avGridUtils.ts` — utility functions (no UI deps)
- `useAVGridContext.ts` — context provider + hook (no UI deps)
- `utils.tsx` — HTML / clipboard helpers (no UI deps)

**model/ (13 files, self-contained, retained verbatim)**
- Hub: `AVGridModel.ts` (exports `AVGridModel`, `AVGridProps`,
  `AVGridState`, `AVGridModels`, `defaultAVGridState`)
- Sub-models: `AVGridActions`, `AVGridData`, `AVGridEvents`,
  `ColumnsModel`, `ContextMenuModel`, `CopyPasteModel`,
  `EditingModel`, `EffectsModel`, `FocusModel`, `RowsModel`,
  `SelectedModel`, `SortColumnModel`

**filters/ (4 files)**
- `useFilters.tsx` — context + provider (pure, no UI deps)
- `FilterBar.tsx` — chip-row UI (`@emotion/styled`, `theme/color`)
- `FilterPoper.tsx` — wraps legacy `Popper` (renamed to
  `FilterPopover.tsx`)
- `OptionsFilterContent.tsx` — multiselect filter body

### Legacy dependencies — resolution table (per user decisions)

| Source file in data-grid | Imports today | Resolution |
|---|---|---|
| AVGrid.tsx, avGridTypes.ts, model/AVGridModel.ts, model/FocusModel.ts | `uikit/RenderGrid` (already flipped by US-538 in commit `2322213`) | Becomes `../RenderGrid` after AVGrid relocates to `uikit/AVGrid/` |
| AVGrid.tsx | `components/basic/CircularProgress` | `uikit/Spinner` |
| AVGrid.tsx | `components/basic/useHighlightedText` (`HighlightedTextProvider`) | `uikit/shared/highlight` (already exists with identical API) |
| AVGrid.tsx | `theme/color` (grid colors) | keep (legitimate token consumer) |
| DataCell.tsx | `components/basic/useHighlightedText` (`useHighlightedText`, `highlightText`) | `uikit/shared/highlight` — function rename: `highlightText` → `highlight` |
| DataCell.tsx | `components/basic/OverflowTooltipText` | new `uikit/TruncatedText` primitive shipped in this task |
| DataCell.tsx, HeaderCell.tsx, SelectColumn.tsx, FilterBar.tsx, OptionsFilterContent.tsx | `components/basic/Button` | `uikit/Button` / `uikit/IconButton` |
| FilterBar.tsx | `components/basic/Chip` | `uikit/Tag` |
| DefaultEditFormater.tsx | `components/basic/TextField` | `uikit/Input` (or a small `CellInput.tsx` wrapper — see Implementation plan § Phase 4) |
| DefaultEditFormater.tsx | `components/form/ComboSelect`, `ComboTemplate`, `ComboTemplateRef` | `uikit/Select` with adaptations for inline cell-edit semantics (see Implementation plan § Phase 4) |
| OptionsFilterContent.tsx | `components/form/ListMultiselect` | `uikit/MultiSelect` — **US-539 delivers it** |
| OptionsFilterContent.tsx | `components/basic/TextField` | `uikit/Input` |
| OptionsFilterContent.tsx | `components/form/utils` (`emptyLabel`, `useFilteredOptions`) | inline into `OptionsFilterContent` (single consumer) |
| model/ContextMenuModel.tsx | `components/overlay/PopupMenu` (`MenuItem`) | `uikit/Menu` (type-only flip, identical to US-535) |
| model/EditingModel.ts | `components/form/utils` (`beep`) | new `src/renderer/core/utils/audio.ts` |

`useHighlightedText` confirmed: `uikit/shared/highlight.ts` already
has `HighlightedTextProvider`, `useHighlightedText`, and `highlight`
(replaces `highlightText` — function rename). Used by NotebookEditor
and LinkEditor post-US-512/US-523.

`basic/TextField`, `form/ComboSelect`, `form/ComboTemplate`,
`form/ListMultiselect` have **zero** external callers outside
`components/`'s own files. They can be safely orphaned during this
migration; deletion happens in US-532.

### Callers (6 files, all in `editors/`)

| File | Symbols imported | Touches `style`/`className` on AVGrid? |
|---|---|---|
| `editors/graph/GraphDetailPanel.tsx` | `AVGrid`, `CellFocus`, `Column`, `detectColumnWidth` | No |
| `editors/grid/GridEditor.tsx` | `AVGrid`, `FilterBar`, `FiltersProvider` | No |
| `editors/grid/GridViewModel.ts` | `AVGridModel`, `CellFocus`, `Column`, `TFilter`, `TOnGetFilterOptions`, `avGridUtils` | No |
| `editors/grid/components/ColumnsOptions.tsx` | `AVGrid`, `AVGridModel`, `avGridTypes` | No |
| `editors/grid/utils/grid-utils.ts` | `Column`, `detectColumnWidth` | No |
| `editors/log-view/items/GridOutputView.tsx` | `AVGrid`, `Column`, `CellFocus` | No |

Rule 7 is achievable — no caller passes `style` or `className` to
`AVGrid` today.

### Reference implementations

- `uikit/Tree/` — closest existing UIKit composite (virtualised list
  + selection + context-menu + drag). Mirror its folder structure.
- `uikit/Select/` — the destination for inline cell-edit dropdown
  semantics; uses Popover + ListBox internally.
- `uikit/Popover/` — migration target for `FilterPoper`.
- `uikit/Tag/` — migration target for `FilterBar`'s chips.
- `uikit/shared/highlight.ts` — drop-in replacement for legacy
  `basic/useHighlightedText`.

### `FilterPoper` → `Popover` prop mapping (verified)

Every `Popper` prop FilterPoper passes maps 1:1 to UIKit `Popover`:

| Legacy `Popper` prop | UIKit `Popover` prop | Match |
|---|---|---|
| `open` | `open` | ✓ |
| `elementRef` | `elementRef` | ✓ |
| `x`, `y` | `x`, `y` | ✓ |
| `placement="bottom-start"` | `placement="bottom-start"` | ✓ default |
| `onClose` | `onClose` | ✓ |
| `offset={[x, y]}` | `offset={[crossAxis, mainAxis]}` | ✓ (same shape, verified in US-531) |
| `onKeyDown` | `onKeyDown` | ✓ |
| `resizable` | `resizable` | ✓ |
| `onResize` | `onResize` | ✓ |

Legacy `PopperRoot` wraps Popper with `overflow: visible`. UIKit
Popover defaults to `overflow: hidden` (with `[data-scroll]` for
scrollable). For FilterPoper's content
(`OptionsFilterContent` with its own virtualised scroll), the
default is fine. **Drop the `overflow: visible` override.**

`borderRadius: 6` already matches `radius.lg = 6`. No override needed.

## Implementation plan

### Phase 1 — Precursor verification (DO NOT START US-536 until met)

- [x] [US-538](../US-538-uikit-rendergrid/README.md) — UIKit
  RenderGrid promotion **landed in commit `2322213`** (2026-05-18).
  `src/renderer/uikit/RenderGrid/` exists. Folder barrel exports
  `RenderGrid`, `RenderGridModel`, `RenderFlexGrid`, plus types
  `RefType`, `RerenderInfo`, `RenderCell`, `RenderCellFunc`,
  `RenderCellParams`, `Percent`, `RowAlign`. AVGrid imports
  `RefType`/`RerenderInfo`/`RenderCell` from this folder barrel
  (not the top-level `uikit/index.ts` curated subset).
- [x] [US-539](../US-539-uikit-multiselect/README.md) — UIKit
  MultiSelect **landed in commit `2322213`** (2026-05-18).
  `src/renderer/uikit/MultiSelect/` exists; `uikit/index.ts` exports
  `MultiSelect` and `MultiSelectProps`. US-539 also delivered
  `uikit/MultiListBox/` as a sibling primitive — AVGrid consumes the
  popover-wrapped `MultiSelect`, not `MultiListBox` directly.

### Phase 2 — Audit UIKit Select for inline cell-edit gaps

Before retargeting `DefaultEditFormater.tsx` to UIKit Select, verify
Select supports the cell-edit interactions AVGrid needs:

1. **Autofocus** — when entering edit mode, focus lands in the
   Select input and the dropdown opens.
2. **Enter commits** — pressing Enter on a highlighted option (or
   the typed text matching an option) commits via `onChange` and
   exits edit mode.
3. **Esc cancels** — pressing Esc closes the dropdown WITHOUT firing
   `onChange` (i.e. discards the edit). `model.onPopoverClose` must
   distinguish "Esc cancels" from "click outside commits".
4. **Tab commits** — same as Enter, then moves focus to the next
   cell.
5. **Click outside** — current AVGrid behaviour is commit (not
   cancel). Verify Select's outside-click matches.
6. **Free-text values** — `ComboSelect` allows typing a value not
   in the options list and committing it. Verify Select supports
   this (the `Autocomplete` primitive does; `Select` may be a
   constrained-choice variant). If Select is constrained-only, the
   correct primitive may be **`Autocomplete`** instead — file a
   note and use Autocomplete for free-text columns.

**Outcome of audit:** if any gap exists, file a small precursor
extension to Select (or use Autocomplete where appropriate). If no
gap, proceed.

### Phase 3 — Move the folder

1. **Relocate** `src/renderer/components/data-grid/` →
   `src/renderer/uikit/AVGrid/`.
2. **Adjust internal cross-imports** (relative paths only).
3. **Final folder shape:**
   ```
   uikit/AVGrid/
     AVGrid.tsx                  ← main component (no rename)
     DataCell.tsx
     HeaderCell.tsx
     SelectColumn.tsx
     DefaultEditFormater.tsx
     CellInput.tsx               ← NEW thin wrapper over uikit/Input (Phase 4)
     CellSelect.tsx              ← NEW thin wrapper over uikit/Select (Phase 4)
     CellAutocomplete.tsx        ← NEW (conditional — only if Phase 2 audit finds free-text needed)
     avGridTypes.ts              ← name preserved (matches AVGrid)
     avGridUtils.ts              ← name preserved
     useAVGridContext.ts         ← name preserved
     utils.tsx
     column-width.ts
     useResolveOptions.ts
     index.ts
     filters/
       FilterBar.tsx
       FilterPopover.tsx         ← renamed from FilterPoper.tsx
       OptionsFilterContent.tsx
       useFilters.tsx
     model/                      ← 13 files, names unchanged
       …
   ```
4. **Rule 7 on public prop types:** add `Omit<…, "style" | "className">`
   to `AVGridProps` (and `FilterBarProps`).
5. **Rule 1 — `name` debug prop:** add `name?: string` to
   `AVGridProps`. Propagate to `RenderGrid`'s `name` prop so it
   emits `data-name` on the rendered `RenderGrid` root. No new
   wrapper element.

### Phase 4 — Build cell-editor wrappers + retarget `DefaultEditFormater`

**User-confirmed pattern (2026-05-17):** create per-input-type
wrappers as thin shells over their UIKit primitives, co-located
with `DefaultEditFormater.tsx` inside `uikit/AVGrid/`. Each wrapper
owns:

1. The cell-edit interaction glue (autofocus on mount, Enter →
   commit + close, Esc → cancel + close, Tab → commit + move,
   click-outside → commit).
2. Cell-specific CSS adjustments (no border, absolute positioning
   over the cell rectangle, removed border-radius, transparent
   background where the cell shows through, etc.) so the wrapped
   UIKit primitive sits flush inside the cell.

This pattern is intentional and extensible — future cell-input
kinds (e.g. `CellCheckbox`, `CellDate`, `CellColor`) follow the
same shape.

**Wrapper files to create:**

- **`uikit/AVGrid/CellInput.tsx`** — wraps `uikit/Input`. Used for
  text / number cells. Public API exposes the cell-edit lifecycle:
  ```ts
  interface CellInputProps {
      value: string;
      onCommit: (value: string) => void;   // Enter / Tab / click-outside
      onCancel: () => void;                 // Esc
      // Optional: type hint, validation, etc.
  }
  ```
- **`uikit/AVGrid/CellSelect.tsx`** — wraps `uikit/Select`. Used
  for constrained-choice cells (`Column.options` provided, no free
  text). Same `onCommit` / `onCancel` shape.
- **`uikit/AVGrid/CellAutocomplete.tsx`** — wraps
  `uikit/Autocomplete`. **Conditional** — only created if Phase 2
  audit finds that UIKit Select cannot express free-text input
  for columns whose `Column.options` permit it. If Select already
  covers free-text via a prop, this file is not needed.

**Styling approach:** each wrapper applies its cell-fit CSS in
ONE of two ways:

1. **Wrapper-local Emotion styled `<div>`** with descendant
   selectors targeting the inner UIKit primitive's `data-type`
   attribute. Example:
   ```tsx
   const CellInputRoot = styled.div({
       position: "absolute",
       inset: 0,
       '& [data-type="input"]': {
           border: "none",
           borderRadius: 0,
           background: "transparent",
       },
   });
   ```
   This is allowed inside UIKit (Rule 7 applies to consumers only)
   and keeps the cell-fit knowledge local to AVGrid.

2. **Extend UIKit Input / Select with a `variant="bare"` (or
   similar) prop** that removes the chrome. The wrapper then passes
   `variant="bare"` and only owns the positioning + lifecycle.

**Recommendation:** **option 1** (wrapper-local descendant
selectors). Keeps UIKit Input/Select clean of grid-specific
variants. The descendant-selector idiom is internal-to-AVGrid by
construction. Switch to option 2 only if another consumer surfaces
needing the same `variant="bare"` styling.

**`DefaultEditFormater.tsx` rewrite:** switches from importing
`basic/TextField` + `form/ComboSelect` + `form/ComboTemplate` to
importing `CellInput`, `CellSelect`, `CellAutocomplete` (if
created) from the same folder. Its internal switch on column type
maps:
- text / number → `CellInput`
- options (constrained) → `CellSelect`
- options (free-text) → `CellAutocomplete` if created, otherwise
  `CellSelect` (free-text mode)
- The `ComboTemplateRef` type is replaced by whatever ref shape
  the new wrappers expose (or just dropped if no caller reads it).

### Phase 5 — Retarget remaining legacy imports

Per the resolution table in Background:

1. **`uikit/Spinner`** → `AVGrid.tsx` (loading branch, replaces
   `CircularProgress`).
2. **`uikit/shared/highlight`** → `AVGrid.tsx` + `DataCell.tsx`.
   Rename `highlightText` call sites to `highlight`.
3. **`uikit/Button` / `uikit/IconButton`** → HeaderCell,
   SelectColumn, FilterBar, OptionsFilterContent. Choose
   `IconButton` where the call site passes only an icon and title;
   `Button` otherwise.
4. **`uikit/Tag`** → FilterBar. The local `FilterChip` helper now
   composes `uikit/Tag` internally; its public surface
   (consumed only by FilterBar) is unchanged.
5. **`uikit/Input`** → OptionsFilterContent (search box at top of
   the filter dropdown).
6. **`uikit/MultiSelect`** → OptionsFilterContent (the filter
   list, replaces `form/ListMultiselect`).
7. **`uikit/Popover`** → FilterPopover.tsx (renamed from
   FilterPoper.tsx). Drop the `styled(Popper)` wrapper; pass props
   directly to `<Popover>`. Confirmed 1:1 prop mapping above.
8. **`uikit/Menu` `MenuItem`** → model/ContextMenuModel.tsx
   (type-only flip).
9. **`core/utils/audio.beep`** → model/EditingModel.ts. Create
   `src/renderer/core/utils/audio.ts` with the `beep()` function
   moved verbatim from `components/form/utils.ts`.
10. **Inline `emptyLabel` + `useFilteredOptions`** from `form/utils`
    into `OptionsFilterContent.tsx` (single consumer).

### Phase 6 — Build `uikit/TruncatedText`

Replaces `basic/OverflowTooltipText`. ~60 LOC. Behaviour: show text
with ellipsis when overflowing; show full text in browser tooltip
on hover when truncated.

- `uikit/TruncatedText/TruncatedText.tsx`
- `uikit/TruncatedText/TruncatedText.story.tsx`
- `uikit/TruncatedText/index.ts`

Used by `DataCell.tsx` (replaces all `OverflowTooltipText`
call sites).

UIKit primitive conventions: `data-type="truncated-text"`, `name`
debug prop, `Omit<…, "style" | "className">`, model-not-needed
(plain function component — falls under Rule 8's "stay with plain
hooks" threshold).

### Phase 7 — Update barrels and callers

1. **`uikit/index.ts`** — add public exports:
   - `AVGrid`, `AVGridModel`, `AVGridProps`
   - Types: `Column`, `CellFocus`, `CellEdit`, `TFilter`,
     `TOptionsFilter`, `TDisplayOption`, `TSortColumn`,
     `TDataType`, `TDisplayFormat`, `TAlignment`, `TFilterType`,
     `TAnyFilter`, `TOptionsFilterValue`, `TOnColumnResize`,
     `TOnColumnsReorder`
   - Filters: `FilterBar`, `FiltersProvider`, `useFilters`,
     `TOnGetFilterOptions`
   - Helpers: `detectColumnWidth`, `useResolveOptions`,
     `defaultCompare`, `formatDispayValue`, `filterRows`,
     `defaultValidate`, `detectColumns`, `recordsToTableHTML`,
     `recordsToClipboardFormatted`, `rowsToCsvText`
   - New: `TruncatedText`, `TruncatedTextProps`
   - **Do NOT export** filter internals (`FilterPopover`,
     `OptionsFilterContent`).
2. **Caller-file edits (6 files):** import-path swaps only.
   Optional: pass `name` to AVGrid per opportunistic Rule 1
   adoption.
   - `editors/grid/GridEditor.tsx` — 3 imports
   - `editors/grid/GridViewModel.ts` — 3 imports
   - `editors/grid/components/ColumnsOptions.tsx` — 3 imports
   - `editors/grid/utils/grid-utils.ts` — 2 imports
   - `editors/graph/GraphDetailPanel.tsx` — 3 imports
   - `editors/log-view/items/GridOutputView.tsx` — 2 imports

All callers prefer the `uikit` barrel:
```ts
import { AVGrid, type Column, type CellFocus, detectColumnWidth } from "../../uikit";
```

### Phase 8 — Verify

1. `npm run lint` — clean.
2. `npx tsc --noEmit` — no new errors.
3. Grep:
   - `from "[^"]*components/data-grid` — zero matches outside
     `src/renderer/components/data-grid/` itself (which gets
     deleted in US-532).
   - `from "[^"]*components/(basic|form|overlay)` inside
     `src/renderer/uikit/AVGrid/` — zero matches.
   - `from "[^"]*components/virtualization` inside
     `src/renderer/uikit/AVGrid/` — zero matches (must be zero
     because US-538 lands first).
4. Manual smoke — see Test surface below.

## Concerns / open questions

All concerns resolved by user review on 2026-05-17.

| Concern | Decision |
|---|---|
| A — cell-editor helpers | **Create thin per-type wrappers** (`CellInput`, `CellSelect`, optionally `CellAutocomplete`) inside `uikit/AVGrid/`. Each wraps its UIKit primitive (`Input` / `Select` / `Autocomplete`), owns the cell-edit lifecycle (autofocus, Enter/Tab → commit, Esc → cancel, click-outside → commit), and applies cell-fit CSS (no border, absolute positioning, etc.) via wrapper-local Emotion. Pattern is extensible for future cell-input kinds (`CellCheckbox`, `CellDate`, `CellColor`). |
| B — MultiSelect | **Promote to UIKit as a new primitive** ([US-539](../US-539-uikit-multiselect/README.md)). US-539 lands first; US-536 consumes it. |
| C — `beep()` location | **`src/renderer/core/utils/audio.ts`** (new file). |
| D — naming-table renames | Apply: `Popper` → `Popover` (FilterPoper → FilterPopover), `Chip` → `Tag` (FilterBar internal), `OverflowTooltipText` → `TruncatedText` (new UIKit primitive), `ListMultiselect` → `MultiSelect` (US-539), `PopupMenu MenuItem` → `Menu MenuItem` (type flip). **NOT applied:** `AVGrid` (kept by user request). |
| E — RenderGrid dependency | **Resolved (post-US-538).** US-538 landed in commit `2322213` on 2026-05-18. AVGrid's RenderGrid imports were already retargeted to `uikit/RenderGrid` during the US-538 caller-flip sweep — when AVGrid relocates here, those imports become `../RenderGrid`. |
| F — `model/` reorganisation | **Keep verbatim.** No reorganisation. |
| G — rename AVGrid | **Do not rename.** Component name, file name (`AVGrid.tsx`), type names (`AVGridProps`, `AVGridModel`), folder name (`uikit/AVGrid/`), and helper names (`avGridTypes.ts`, `avGridUtils.ts`, `useAVGridContext.ts`) all preserved. |
| H — Storybook story | **No story.** AVGrid is tested via the Grid editor directly. |
| I — `name` debug prop | **Apply.** `AVGrid` accepts `name?: string` and propagates to `RenderGrid`'s `data-name` attribute. No new wrapper element. |

### Residual implementation concerns

#### J. UIKit Select free-text input parity

`ComboSelect` / `ComboTemplate` support typing a value not in the
options list and committing it (free-text mode). UIKit Select is
designed as a constrained-choice primitive. Two paths surface
during Phase 2 audit:

1. UIKit Select already supports free-text via some prop (e.g.
   `allowFreeText`). Use it.
2. UIKit Select is constrained-only. Use `uikit/Autocomplete` for
   columns whose `Column.options` permit free-text. The choice can
   be per-column (constrained → Select, free-text → Autocomplete).

Verify during Phase 2; the answer informs the size of the
`DefaultEditFormater` rewrite.

#### K. `RenderGrid` cross-folder relationship (within UIKit)

After US-538 lands, AVGrid's import becomes
`import { RenderGrid } from "../RenderGrid"` (sibling UIKit folder).
This is acceptable per UIKit architecture (sibling primitives
compose freely). No further action needed beyond Phase 7's barrel
exports.

#### L. AVGrid's internal `RenderGridStyled` `styled(RenderGrid)` wrapping

**Resolved (post-US-538).** `uikit/RenderGrid/RenderGrid.tsx:89`
applies `className={model.props.className}` to its root, and
`uikit/CLAUDE.md` documents the "Foundational compositional primitive
exception" that explicitly admits `className` (and `blockStyles`,
`contentProps`, `renderAreaProps`) as part of RenderGrid's public API.
The `styled(RenderGrid)` wrapping in `AVGrid.tsx` therefore continues
to work verbatim after the move. After AVGrid relocates into
`uikit/AVGrid/`, this remains internal Emotion usage inside UIKit's
own folder — Rule 7 applies to consumers, not to UIKit's internal
composition. **Keep the `styled(RenderGrid)` wrapper as-is.**

Note: RenderGrid sets `id="avg-root"`, `id="avg-container"`, and
`id="avg-render-area"` on its own elements (now inside `uikit/RenderGrid/`).
`closest("#avg-container")` selectors in app code (e.g.
`NoteItemViewModel.ts:247,280`) continue to resolve correctly — no
AVGrid change required. Filed as future cleanup (descendant-walks
rather than duplicate ids).

## Acceptance criteria

- [ ] `src/renderer/components/data-grid/` no longer exists.
- [ ] `src/renderer/uikit/AVGrid/` contains the migrated module
      with verbatim functionality.
- [ ] All 6 caller files compile and run after import-path swap.
- [ ] No file inside `src/renderer/uikit/AVGrid/` imports from
      `components/basic/`, `components/form/`,
      `components/overlay/`, or `components/virtualization/`.
- [ ] `FilterPoper` → `FilterPopover` migration: uses UIKit
      `Popover`; no legacy `Popper` import inside `uikit/AVGrid/`.
- [ ] `uikit/AVGrid/CellInput.tsx` exists as a thin wrapper over
      `uikit/Input` with cell-edit lifecycle and cell-fit CSS.
- [ ] `uikit/AVGrid/CellSelect.tsx` exists as a thin wrapper over
      `uikit/Select`.
- [ ] `uikit/AVGrid/CellAutocomplete.tsx` exists if Phase 2 audit
      finds free-text needed; otherwise the column's free-text
      need is met by `CellSelect`.
- [ ] `DefaultEditFormater` uses `CellInput` / `CellSelect`
      (and / or `CellAutocomplete`); no `basic/TextField`,
      `form/ComboSelect`, `form/ComboTemplate` imports remain.
- [ ] `OptionsFilterContent` uses UIKit `MultiSelect` (from
      US-539); no `form/ListMultiselect` import.
- [ ] `model/EditingModel.ts` uses `core/utils/audio.beep`; no
      `form/utils` import.
- [ ] `model/ContextMenuModel.tsx` uses `uikit/Menu MenuItem`; no
      `overlay/PopupMenu` import.
- [ ] `AVGridProps` omits `style` and `className` (Rule 7).
- [ ] `AVGridProps` accepts `name?: string` and propagates to
      `RenderGrid`'s `data-name`.
- [ ] `uikit/TruncatedText/` exists with
      `TruncatedText.tsx` + `TruncatedText.story.tsx`.
- [ ] `src/renderer/core/utils/audio.ts` exists and exports `beep`.
- [ ] `npm run lint` clean; `npx tsc --noEmit` reports no new errors.
- [ ] Manual smoke (Test surface) passes.

## Test surface (manual smoke)

- **Grid editor — JSON page:** open a `.json` file; rows render;
  click headers to sort; type in the search box; click filter
  icons; apply / clear filters; reorder columns by drag;
  resize columns; edit a cell (commit on Enter, cancel on Esc);
  copy a cell range (Ctrl+C) and paste into Excel; paste from
  Excel into the grid (Ctrl+V); add a row via the bottom-left "+";
  delete rows via context menu.
- **Grid editor — CSV page:** same as above for a `.csv` file.
- **Grid editor — Columns dialog:** open the Columns popper from
  the toolbar; edit visibility / order / width / type; close;
  confirm changes apply.
- **Graph editor — Detail panel:** select a graph node; switch to
  the detail panel; the AVGrid inside renders selected-node
  properties; resize columns; cell focus moves with keyboard.
- **LogView grid output:** run a script that calls
  `app.log.grid([...])`; rows render inside `GridOutputView`;
  sorting works.
- **Filter popover:** in a Grid page, click a column's filter
  icon; the filter popover opens at the correct position; the
  options list is searchable (UIKit MultiSelect inside); selecting /
  deselecting options applies the filter; clicking outside closes
  the popover; Esc closes the popover; resize the popover; resized
  state persists for the open session.
- **Edit cell with constrained dropdown:** in a column with
  `options`, edit a cell; the UIKit Select dropdown appears;
  arrow keys navigate options; Enter commits; Esc cancels.
- **Edit cell with free-text dropdown (if applicable):** in a
  column allowing free text plus suggestions, edit a cell; the
  UIKit Autocomplete (or Select free-text mode) accepts a typed
  value; Enter commits the typed value; Esc cancels.
- **Tag chips in filter bar:** apply a filter; the FilterBar
  shows the active filter as a UIKit Tag; clicking the X on the
  Tag clears the filter.

## Files changed

(High-level. Detailed file table generated during implementation.)

| Area | Change |
|---|---|
| `src/renderer/components/data-grid/` | Folder moved entirely; subsequently deleted by US-532. |
| `src/renderer/uikit/AVGrid/` | New folder containing migrated module (names preserved per Concern G). |
| `src/renderer/uikit/TruncatedText/` | New primitive (replaces `basic/OverflowTooltipText`). |
| `src/renderer/uikit/MultiSelect/` | Delivered by US-539 (not this task). |
| `src/renderer/uikit/index.ts` | Adds AVGrid + TruncatedText public exports. |
| `src/renderer/core/utils/audio.ts` | New file with `beep()`. |
| `editors/grid/*`, `editors/graph/GraphDetailPanel.tsx`, `editors/log-view/items/GridOutputView.tsx` | Import paths flipped. |

## Files NOT changed (do not investigate)

- `src/renderer/components/virtualization/RenderGrid/` — US-538
  scope (moves to `uikit/RenderGrid/`).
- `src/renderer/components/basic/CircularProgress.tsx`,
  `Button.tsx`, `Chip.tsx`, `TextField.tsx`,
  `OverflowTooltipText.tsx`, `useHighlightedText.tsx` — orphaned by
  this task; deletion is US-532.
- `src/renderer/components/form/ComboSelect.tsx`,
  `ComboTemplate.tsx`, `ListMultiselect.tsx`, `utils.ts` —
  orphaned by this task; deletion is US-532.
- `src/renderer/components/overlay/Popper.tsx` — still used by
  `editors/grid/components/{Csv,Columns}Options.tsx` (US-509
  scope).

## Links

- Epic: [EPIC-025](../../epics/EPIC-025.md)
- Phase: 4 — UIKit composite primitive
- Blocked on: [US-538](../US-538-uikit-rendergrid/README.md) (UIKit
  RenderGrid promotion) AND [US-539](../US-539-uikit-multiselect/README.md)
  (UIKit MultiSelect primitive).
- Related: [US-509](../US-509-grid-editor-chrome-migration/README.md)
  — Grid editor chrome around AVGrid.
- Related: [US-535](../US-535-menuitem-import-flips/README.md) —
  `MenuItem` import-flip precedent.
- Unblocks: [US-532](../US-532-legacy-components-removal/README.md)
  deletion of `components/data-grid/`.
- Deferred review: this task does NOT run `/review`, `/document`,
  or `/userdoc` — those run at EPIC-025 close per the
  deferred-review model.
