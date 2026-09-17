# US-1434: Grid editor text filters

Status: implemented (2026-09-17), unreviewed. Split from US-1433. Implemented by Claude rather than
through `codex-dev`, because the Codex MCP was `CONNECTION_CLOSED` for the whole session.

## Goal

Let the Grid editor opt individual columns into av-grid's built-in text filter, including
`contains`, `equals`, `startsWith`, `blank`, and `notBlank`, while preserving the checklist as the
default for every column and keeping filter mode in the editor's persisted settings.

## Background

The Grid editor currently supplies `filters`, `filterBar: true`, and `onGetOptions` from
`src/renderer/editors/grid/GridBodyView.ts:76-97`. `GridEditor.onGetOptions` receives a `search`
argument, filters the live rows using the other filters and search, builds a distinct-value set,
sorts it, and labels nullish values (`src/renderer/editors/grid/GridEditor.ts:800-820`). The
checklist already has its own search input: `.avg-list-search` exists in av-grid 2.6.1 at
`C:\projects\av-grid\src\styles\av-grid.css.ts:835-856`, and remains in 2.11.2 at
`C:\projects\av-grid\src\styles\av-grid.css.ts:900-924`. Text filtering is therefore not an
adoption of search where none existed; its benefit is avoiding a large distinct-options list and
offering a direct text predicate for high-cardinality values.

The upstream text filter accepts a normalized `{ op, text }` value for comparing operators and
`{ op }` for `blank`/`notBlank`; a bare string is normalized to `contains`
(`C:\projects\av-grid\src\validate.ts:699-720,760-808`). The per-column operator list is
`textFilterOps`, and the five supported operators are defined at
`C:\projects\av-grid\src\types.ts:393-416,506-541`.

The default is intentionally conservative: `filterType` is effectively `"options"` for every
column unless the user explicitly selects `"text"` in Edit Columns. This covers the common
low-cardinality categorical case (`status`, `type`, `country`), where seeing and ticking known
values is more useful than typing a predicate. It also avoids making `detectColumns` silently
replace the checklist on every newly opened string column: detection runs on sampled rows and
infers data type on each open without persisted settings (`src/renderer/editors/grid/utils/grid-utils.ts:25-75`).

### Persistence and compatibility

The editor persists its own `GridColumnSetting`, not av-grid's `Column`. The current setting has
five fields and deliberately drops the old descriptor's `resizible` and `filterType` fields
(`src/renderer/editors/grid/GridEditor.ts:41-63`). `toColumnSetting` writes the setting and
`buildColumns` merges it back by key (`:82-110`), while view settings persist filters separately in
the host slot (`:66-80,367-403`).

Add an optional `filterType?: "options" | "text"` field to that app-owned setting. Its effective
default is always options:

```ts
// Before: GridEditor.ts:57-63
    dataType?: DataType;
}

// After
    dataType?: DataType;
    filterType?: "options" | "text";
}
```

An absent field and an explicit `"options"` value mean the same thing. Existing settings without
the field therefore need no migration distinction, and new columns do not change behavior unless
the user opts them into text. Persist an explicit `"text"` choice; retaining or writing
`"options"` is also valid but must resolve identically.

Changing a column's mode must clear only that column's incompatible active filter before the new
columns and filters reach av-grid. Options filters are arrays of display options, while text
filters are operator objects (`C:\projects\av-grid\src\validate.ts:665-719`); neither shape can
be faithfully converted into the other. Do not rely on av-grid's restore warning/drop path
(`C:\projects\av-grid\src\model\FiltersModel.ts:285-319`) for an interactive mode change.

## Implementation Plan

### 1. Extend the DataGrid boundary only for actual text-filter consumers

Add these and only these upstream names to `src/renderer/uikit/DataGrid/types.ts` and re-export
them through `src/renderer/uikit/DataGrid/index.ts`:

- `TextFilterOp` — the editor's operator-list type.
- `TextFilterValue` — the normalized value type used by mode-change cleanup and persisted filter
  handling.
- `TEXT_FILTER_OPS` — the upstream five-operator value used for an opted-in text column.

The current explicit lists are `types.ts:14-52` and `index.ts:48-87`; do not bulk-export
`TextFilter`, `TextFilterContent`, `TextFilterOpInfo`, `TreeColumnOptions`, or unrelated new
upstream names. The import restriction remains unchanged at `eslint.config.mjs:555-573`.

### 2. Make options the universal default and persist explicit text opt-in

In `src/renderer/editors/grid/GridEditor.ts`:

1. Add `filterType` to `GridColumnSetting`.
2. Make `toColumnSetting` retain it when present and make `buildColumns` resolve an absent value
   to options.
3. Keep `GridEditor.newColumn` and detected columns on options by default; do not infer text from
   `DataType` or sampled distinct counts.
4. Add the mode-change reconciliation that removes only the affected column's incompatible filter.
5. Keep the existing `GridViewSettings.filters: Filter[]` shape. av-grid normalizes text values in
   the same filter slot, so no second persistence store is needed
   (`C:\projects\av-grid\src\model\FiltersModel.ts:151-178`).

In `src/renderer/editors/grid/utils/grid-utils.ts`, preserve the existing sampling/type inference
and do not attach text as an automatic string-column default. Any new column should resolve to
options until the Edit Columns UI chooses text.

In `src/renderer/editors/grid/GridBodyView.ts`, preserve the existing `state.columns` value path;
verify that each selected column reaches av-grid with `filterType` and, for text, `textFilterOps`.
No external filtering or sorting flags are appropriate: the editor owns its complete in-memory
rows and already supplies local callbacks (`GridBodyView.ts:94-97`; `GridEditor.ts:632-649`).

### 3. Add the explicit mode selector to Edit Columns

In `src/renderer/editors/grid/components/ColumnsOptions.ts`:

1. Add a filter-mode field to `EditColumnRow` (`:60-70`).
2. Load the current effective mode in `prepareEditColumns` (`:105-117`), treating missing as
   options.
3. Add a `Filter` selector to the popover's own column grid. Its existing `getColumns` definition
   demonstrates the editable options-column pattern (`:36-58`).
4. Write the selected mode from `updateColumns` (`:230-249`), retaining the mode for existing
   columns and persisting text only when explicitly selected.

Before/after persisted settings:

```json
// Before and still valid: no field means the checklist.
{"key":"status","name":"status","dataType":"string"}

// After an explicit user choice.
{"key":"message","name":"message","dataType":"string","filterType":"text"}
```

Before/after filter values:

```json
// Checklist filter, including the existing display-option shape.
{"columnKey":"status","value":[{"value":"open","label":"open"}]}

// Text filters normalized by av-grid.
{"columnKey":"message","type":"text","value":{"op":"contains","text":"timeout"}}
{"columnKey":"message","type":"text","value":{"op":"blank"}}
```

### 4. Use the five operators for explicit text columns

When a column's effective mode is text, pass `textFilterOps: TEXT_FILTER_OPS`. When it is options,
omit `textFilterOps`; upstream validation requires that field only with `filterType: "text"`
(`C:\projects\av-grid\src\validate.ts:723-758`). Keep av-grid's normalized text value rather
than inventing an app-specific shape. `blank` and `notBlank` compare the displayed text after the
upstream normalization rules, while the checklist continues to distinguish `(null)` and
`(undefined)` through its existing labels (`GridEditor.ts:810-820`).

### 5. Verification at implementation time

Do not add unit tests or a test harness; this project does not use them for this surface. Verify:

- A newly opened CSV/JSON keeps the options checklist for string, number, and boolean columns.
- The Edit Columns selector can opt a string column into text and persists that choice through a
  Grid↔Monaco switch and restart via the existing host settings slot
  (`GridEditor.ts:66-80,367-403`).
- A text column exposes all five operators; comparing operators use trimmed text and blank/notBlank
  use the text-free value shape.
- Switching options→text or text→options clears only the changed column's incompatible filter;
  other filters remain applied.
- A legacy setting with no `filterType` behaves exactly like an options setting, with no migration
  warning or loss of its options filter.
- The checklist's existing search input still works, and opening a text filter avoids requesting
  or constructing the column's distinct-options list.
- The typecheck, lint, production build, and `git diff --check` pass after implementation; no
  unit-test or harness files are added.

## Concerns / Open questions

The design decisions are resolved as follows:

- **Default:** options for every column. Text is an explicit Edit Columns choice; neither DataType
  nor sampled distinct count silently changes a newly opened file.
- **Legacy settings:** absent `filterType` is options, exactly the new default. No legacy-versus-new
  migration branch is needed.
- **Mode changes:** clear only incompatible filters rather than converting arrays and text objects.
- **Operator list:** use upstream `TEXT_FILTER_OPS` for all explicit text columns; do not duplicate
  the list or add app-specific operators.
- **External flags:** not used. The editor's callbacks are local and the upstream flags leave the
  host-side round trip to the caller (`C:\projects\av-grid\docs\api.md:380-387`).
- **Boundary:** add only the three names with consumers in this task; all direct av-grid imports
  remain inside `src/renderer/uikit/DataGrid/` (`eslint.config.mjs:555-573`).

## Acceptance Criteria

- [x] `filterType` is persisted in the app-owned `GridColumnSetting`; missing means options.
- [x] Every newly opened column defaults to the options checklist, including string columns.
- [x] Edit Columns provides an explicit options/text selector and persists a text opt-in.
- [x] Text columns use `TextFilterOp`, `TextFilterValue`, and `TEXT_FILTER_OPS` through the local
      DataGrid boundary; options columns do not receive `textFilterOps`.
- [x] All five text operators work, including `blank` and `notBlank`.
- [x] Mode changes clear only incompatible active filters and preserve unrelated filters.
- [x] The existing checklist search remains available; the plan does not claim that text filtering
      replaces a missing search facility.
- [x] Legacy settings and options-array filters continue to work without a migration distinction.
- [x] No `externalFilter`, `externalSort`, or distinct-count auto-default is introduced.
- [x] The implementation-time typecheck, lint, production build, and `git diff --check` pass;
      no unit-test or harness files are added.

## What was actually built

One helper pair carries the whole feature, in `src/renderer/editors/grid/utils/grid-utils.ts`:
`resolveFilterMode(column)` (anything not an explicit `"text"` is the checklist) and
`withFilterMode(column, mode)`, which owns `filterType` and `textFilterOps` **together** — they
have to travel as a pair, because av-grid rejects `textFilterOps` on a non-text column and a text
column without it offers only three chips instead of five. The options arm *deletes* both fields
rather than writing `filterType: "options"`, so the absent form is the one that reaches disk.

Three call sites use it: `buildColumns` (restore), `ColumnsOptions.updateColumns` (Apply), and
`toColumnSetting`, which writes `filterType` only for a text column.

`ColumnsOptions.dropFiltersForModeChanges` runs **before** `setColumns` on Apply. av-grid
re-validates filters when it restores them, not when a host replaces the columns, so without this
a stale options filter would keep matching by its old predicate behind a text popover the user
cannot use to clear it. It matches on `oldKey`, because the filters name the columns as they are
before any rename in the same Apply.

## Verification (live, in the running app)

- A newly opened JSON showed `options` for all five columns, including the three string ones.
- Edit Columns gained a **Filter** column; setting `message` to `text` and applying made its funnel
  open the text body with all five chips (`contains`, `equals`, `starts with`, `is empty`,
  `is not empty`) and no checklist. `status` still opened the checklist.
- The applied filters normalized to av-grid's own shapes and coexisted:
  `{op: "contains", text: "timeout"}` with `type: "text"` beside the options array on `status`.
- `is empty` committed as `{op: "blank"}` — the text-free shape — and narrowed to 0 rows.
- Reverting `message` to options cleared **only** its filter; the `status` options filter stayed
  applied.
- Persistence held across Grid→Monaco→Grid **and** a full renderer restart. On disk, only
  `message` carries `filterType: "text"`; no column carries `"options"`, and `textFilterOps` is
  not persisted at all.
- Typecheck, lint, `npm run build-prod` and `git diff --check` all pass. No test files added.

## Files Changed

### This planning task

- `doc/tasks/US-1434-grid-editor-text-filters/README.md` — this implementation plan.
- `doc/active-work.md` — Planned dashboard entry under `*(no epic)*`.

### Planned implementation touch set

- `src/renderer/uikit/DataGrid/types.ts`
- `src/renderer/uikit/DataGrid/index.ts`
- `src/renderer/editors/grid/GridEditor.ts`
- `src/renderer/editors/grid/GridBodyView.ts`
- `src/renderer/editors/grid/utils/grid-utils.ts`
- `src/renderer/editors/grid/components/ColumnsOptions.ts`

### Explicitly unchanged

- `src/renderer/uikit/DataGrid/DataGridView.ts` — generic value forwarding already covers the
  column options (`:213-225`).
- `src/renderer/theme/p-vars.ts` and `src/renderer/uikit/DataGrid/DataGrid.css` — no new theme
  token or stylesheet import is needed.
- `src/renderer/api/types/grid-editor.d.ts`, `assets/editor-types/grid-editor.d.ts`, and
  `src/renderer/scripting/api-wrapper/GridEditorFacade.ts` — generic runtime/API documentation is
  covered by US-1433 and remains independent of this editor feature.
- All files under `C:\projects\av-grid` — read-only upstream source.
