# US-509: Grid editor chrome — UIKit migration

## Status

**Placeholder** — not yet planned. Part of
[EPIC-025](../../epics/EPIC-025.md) Phase 4 per-screen migration.

## Goal

Migrate the Grid editor's chrome (toolbar, search field, options
modals) to UIKit primitives. After this task, the listed files contain
no `@emotion/styled` definitions and import nothing from
`components/basic|form|layout|overlay/`.

`AVGrid`, `RenderGrid`, and the filter UI (`filters/FilterBar`,
`filters/useFilters`) are **out of scope** — those are Phase 5
adopt-in-place complex components.

## Scope

Three rendering files:

- `src/renderer/editors/grid/GridEditor.tsx`
- `src/renderer/editors/grid/components/CsvOptions.tsx`
- `src/renderer/editors/grid/components/ColumnsOptions.tsx`

`GridViewModel.ts`, `getRowKey` and other utils need no changes.

## Old → UIKit primitives

| Old | New |
|---|---|
| `styled.div` (`GridPageRoot`) | UIKit `Panel` (`flex={1}`, optional `height` for fit-content) |
| `styled(TextField)` (`SearchFieldRoot`) | UIKit `Input` with `color="info"` (or appropriate variant) |
| `components/basic/TextField` | UIKit `Input` |
| `components/basic/Button` | UIKit `Button` / `IconButton` |
| `components/basic/Checkbox` (CsvOptions / ColumnsOptions) | UIKit `Checkbox` |
| `components/basic/Select` (if any) | UIKit `Select` |
| Options-modal `styled.div` containers | UIKit `Panel` |

## Notes

- `showColumnsOptions` and `showCsvOptions` open modal-style dialogs.
  Confirm during planning whether to use UIKit `Dialog` (US-432) or
  keep the existing dialog mechanism with an internal Panel/UIKit body.
- The blue-text styled `SearchFieldRoot` overrides input text color
  — the simplest UIKit substitute is `Input` with a color prop, or a
  one-off `color` style applied through the Input's slot. Verify there
  is a token-driven path; do not introduce a new emotion override.
- `AVGrid` / `FilterBar` / `FiltersProvider` stay imported as-is from
  `components/data-grid/` — these move to `uikit/` during Phase 5.
- `GridPageRoot` accepts `fitContent?: boolean` to switch height
  between `fit-content` and a fixed value — preserve that behavior via
  Panel's `height` prop conditionally.

## Test surface (manual smoke)

- Open a JSON or CSV file in grid view.
- Search field filters rows; blue text is preserved.
- Columns options modal: toggle column visibility, persists.
- CSV options modal: change delimiter / header row / quote — grid
  re-parses.
- Filter bar (unchanged) still works on top of the chrome.
- `fitContent` mode (if used by any caller) renders correctly.

## Acceptance criteria

- [ ] No `@emotion/styled` in the three listed files.
- [ ] No imports from `components/basic|form|layout|overlay/` in those
      files. `components/data-grid/` imports remain (Phase 5).
- [ ] `npm run lint` clean; `npx tsc --noEmit` reports no new errors.
- [ ] All toolbar / search / options-modal interactions behave
      identically.

This task does NOT run `/review`, `/document`, or `/userdoc` — those run
at EPIC-025 close per the epic's deferred review model.

## Links

- Epic: [EPIC-025](../../epics/EPIC-025.md)
- Phase: 4 — per-screen migration
- Related: AVGrid Phase 5 adopt-in-place migration (separate, end-of-epic)
