# US-536: UIKit `DataGrid` — `components/data-grid/` migration

## Status

**Placeholder.** Part of [EPIC-025](../../epics/EPIC-025.md) Phase 4 —
UIKit composite-primitive migration. Deferred-review model: this task
does NOT run `/review`, `/document`, or `/userdoc` — those run at epic
close.

## Goal

Migrate the entire `src/renderer/components/data-grid/` module — the
`AVGrid` composite, its `filters/` subfolder, its `model/` namespace,
and supporting utilities — into UIKit at `src/renderer/uikit/DataGrid/`.
After this task, `components/data-grid/` has zero external callers, the
six call sites in `editors/grid/`, `editors/graph/`, and
`editors/log-view/` import from `uikit/DataGrid/` instead, and the
legacy folder can be deleted by US-532.

Functionality is preserved verbatim. UIKit-pattern adjustments are
limited to wrapper-level concerns (`data-name` debug attribute, token
usage for spacing/color where trivial, dropping `@emotion/styled` on
the outermost composition where it conflicts with Rule 7). Internal
cell rendering, virtualization, sort/filter/edit logic, and the
public component API stay the same so that the six callers see only
import-path changes plus optional `name` prop adoption.

## Background

### What's in scope

`src/renderer/components/data-grid/` total:

- Top-level files: `index.ts`, `column-width.ts`, `useResolveOptions.ts`
- `AVGrid/` (top): `AVGrid.tsx` (313 lines), `DataCell.tsx`,
  `DefaultEditFormater.tsx`, `HeaderCell.tsx`, `SelectColumn.tsx`,
  `avGridTypes.ts`, `avGridUtils.ts`, `useAVGridContext.ts`,
  `utils.tsx`
- `AVGrid/filters/`: `FilterBar.tsx` (273), `FilterPoper.tsx` (117),
  `OptionsFilterContent.tsx` (203), `useFilters.tsx` (219)
- `AVGrid/model/`: `AVGridActions.ts`, `AVGridData.ts`,
  `AVGridEvents.ts`, `AVGridModel.ts`, `ColumnsModel.ts`,
  `ContextMenuModel.tsx`, `CopyPasteModel.ts`, `EditingModel.ts`,
  `EffectsModel.ts`, `FocusModel.ts`, `RowsModel.ts`,
  `SelectedModel.ts`, `SortColumnModel.ts`

The folder lifts wholesale into `src/renderer/uikit/DataGrid/` with
internal imports retargeted.

### Callers (6 external files)

| File | Imports |
|---|---|
| `editors/graph/GraphDetailPanel.tsx` | `AVGrid`, `CellFocus`, `Column`, `detectColumnWidth` |
| `editors/grid/GridEditor.tsx` | `AVGrid`, `FilterBar`, `FiltersProvider` |
| `editors/grid/GridViewModel.ts` | `AVGridModel`, `CellFocus`, `Column`, `TFilter`, `TOnGetFilterOptions`, `avGridUtils` |
| `editors/grid/components/ColumnsOptions.tsx` | `AVGrid`, `AVGridModel`, `avGridTypes` |
| `editors/grid/utils/grid-utils.ts` | `Column`, `detectColumnWidth` |
| `editors/log-view/items/GridOutputView.tsx` | `AVGrid`, `Column`, `CellFocus` |

### Filters subfolder coupling

`filters/` is tightly bound to AVGrid's column / row models —
`FilterBar.tsx` consumes `FiltersProvider` context and the column
state from the AVGrid context. Splitting filters into a separate
task would force a transitional API and double the diff. Migrate
them together in this task as one cohesive composite.

### UIKit composition pattern — open question

UIKit Rule 7 forbids `@emotion/styled` on UIKit components in app
code. AVGrid's outer composition is itself an internal styled
structure (its callers don't pass `style`/`className` to it today —
they consume the typed component API). The Rule 7 ban is on
**callers** passing `style`/`className`, not on the primitive's
internal Emotion usage. UIKit `Popover`, `Menu`, and others also
use `styled.div` internally.

Decision: keep AVGrid's **internal** `@emotion/styled` usage as-is.
The Rule 7 surface that needs auditing is its public prop type — it
must `Omit<…, "style" | "className">` like every other UIKit
primitive. This is the only structural change required to match the
UIKit pattern.

### `data-grid/` consumes the legacy `components/overlay/` Popper

`FilterPoper.tsx` (yes, "Poper" — typo in the filename) imports
legacy `Popper` from `components/overlay/Popper`. As part of the
migration, port `FilterPoper` over to UIKit `Popover` (with
`resizable` mode if it uses that — verify against the legacy props).
This is a tight coupling that has to land in the same diff because
the file moves into `uikit/DataGrid/filters/`.

### Naming

Public symbol stays `AVGrid` (callers reference it as `AVGrid`). The
folder name moves from `data-grid/` to `DataGrid/` to match UIKit
folder casing convention. The barrel `uikit/index.ts` exports
`AVGrid`, `AVGridModel`, `Column`, `CellFocus`, the filter types,
and the helper functions used by the six callers.

## Implementation plan (high-level)

1. **Audit pass.** Verify the caller inventory above is still
   complete. Inventory every internal cross-import inside
   `components/data-grid/`.
2. **Move folder.** Relocate
   `src/renderer/components/data-grid/` →
   `src/renderer/uikit/DataGrid/`. Adjust all internal relative
   imports.
3. **Rule 7 audit on public props.** Ensure `AVGrid`'s public
   prop type `Omit<…, "style" | "className">`. Same for any other
   exported composite (`FilterBar`, etc.).
4. **`FilterPoper` → UIKit `Popover` retargeting.** Replace the
   one legacy `components/overlay/Popper` import inside `filters/`
   with UIKit `Popover`. Match placement / offset behaviour against
   the existing legacy usage.
5. **Caller updates.** Six files: swap import paths from
   `../../components/data-grid` to `../../uikit/DataGrid`
   (or `../../uikit` if the barrel re-exports). No behavioural
   change in the editors.
6. **Verify.** `npm run lint`, `npx tsc --noEmit`, manual smoke
   on the Grid editor, the Graph editor (detail panel), and the
   LogView grid output. Test surface listed below.

## Concerns / open questions

### A. Folder placement under uikit/

Two options:

1. `uikit/DataGrid/` flat — promotes AVGrid as a peer of `Tree`,
   `ListBox`, etc.
2. `uikit/DataGrid/` with the `AVGrid/filters/`, `AVGrid/model/`
   subfolders retained verbatim.

**Recommendation:** option 2 (verbatim subfolder structure). The
internal organisation is non-trivial (13 model files); reorganising
during migration adds review burden without code value. The
canonical UIKit entry point is `AVGrid` + a few helpers; the rest is
implementation detail.

### B. Renaming `AVGrid` to `DataGrid` in the public API

The component is called `AVGrid` (Andriy Viyatyk's initials). Some
projects rename composites to descriptive names during a UIKit
migration. This would touch all 6 callers in 12+ places.

**Recommendation:** keep `AVGrid` for this migration to keep the
diff focused. A rename can happen as a follow-up if desired.

### C. `data-grid` filter primitive footprint inside UIKit

The filter UIs (`FilterBar`, `FilterPoper`, `OptionsFilterContent`,
`useFilters`) are AVGrid-specific. They should not be exposed as
top-level UIKit primitives — they're part of the AVGrid composite.
Export them from `uikit/DataGrid/` only, not from the top-level
`uikit` barrel.

**Recommendation:** confirm during implementation that the
top-level `uikit/index.ts` exports only `AVGrid`, `AVGridModel`,
and the helper types/utilities used by callers — not the filter
internals.

### D. Storybook entries for AVGrid

EPIC-025 promotes UIKit components into Storybook stories
(`*.story.tsx`). AVGrid is complex enough that a story may take
real effort. Storybook story addition can be a follow-up task or
absorbed if cheap.

**Recommendation:** defer Storybook story to a follow-up unless
trivial. File the follow-up if deferred.

## Acceptance criteria

- [ ] `src/renderer/components/data-grid/` no longer exists.
- [ ] `src/renderer/uikit/DataGrid/` contains the migrated module
      with verbatim functionality.
- [ ] All 6 caller files compile and run after import-path swap.
- [ ] `uikit/DataGrid/filters/` no longer imports from
      `components/overlay/` (Popper → Popover swap completed).
- [ ] AVGrid's public prop type omits `style` and `className` (Rule 7).
- [ ] `npm run lint` clean; `npx tsc --noEmit` reports no new errors.
- [ ] Manual smoke (Test surface) passes.

## Test surface (manual smoke)

- Open a JSON file → grid-json editor: data renders, sorting works,
  filter bar opens, column visibility / order changes via Columns
  popover, copy/paste cells via Excel clipboard format.
- Open a CSV file → grid-csv editor: same surface as above.
- Open the Graph editor → detail panel: AVGrid in the panel shows
  selected node properties; resize columns; cell focus moves.
- Run a script that writes log output as a grid →
  `app.log.grid(...)`: rows render inside `GridOutputView`; sorting
  works.
- Edit a cell in grid-json: in-place editor opens, commits on Enter,
  cancels on Esc.

## Links

- Epic: [EPIC-025](../../epics/EPIC-025.md)
- Phase: 4 — UIKit composite primitive
- Related: [US-509](../US-509-grid-editor-chrome-migration/README.md)
  — Grid editor chrome (toolbar / dialogs around AVGrid)
- Unblocks: [US-532](../US-532-legacy-components-removal/README.md)
  deletion of `components/data-grid/`
