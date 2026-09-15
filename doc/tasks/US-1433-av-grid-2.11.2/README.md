# US-1433: Adopt av-grid 2.11.2 in Persephone

Status: planned; investigation complete. This document defines the implementation scope. It does
not implement the upgrade.

## Goal

Use the av-grid 2.7–2.11 features that solve current Persephone integration and authoring problems,
correct the board component catalog for av-grid 2.11.2, restore the Edit Columns popover's lost
header-reorder lock, and document the two recycled-header-cell fixes already delivered by the
dependency bump. The separate Grid editor text-filter feature is scoped to
[US-1434](../US-1434-grid-editor-text-filters/README.md).

## Background

Persephone is already installed on av-grid `2.11.2` in `package.json`/`package-lock.json`; the
upgrade has passed the user's existing typecheck, lint, and production-build checks with no source
changes. This task is about adoption and accurate documentation, not repairing a compile break.

The upstream history between 2.6.1 and `HEAD` is:

| Release | Verified addition or fix | Evidence |
|---|---|---|
| 2.7.0 | Host-owned filtering/sorting and built-in text filtering | `C:\projects\av-grid\src\options.ts:544-591`; `C:\projects\av-grid\src\types.ts:393-416,438-448,506-541` |
| 2.8.0 | `pinned: "left"` is a sticky data column; `isStatusColumn` remains chrome; left/right pins are positional | `C:\projects\av-grid\src\types.ts:304-335`; `C:\projects\av-grid\src\validate.ts:397-421` |
| 2.9.0 | Per-column `textFilterOps`, `blank`/`notBlank`, and `filterLabel` | `C:\projects\av-grid\src\types.ts:393-416,506-541`; `C:\projects\av-grid\src\options.ts:528-542` |
| 2.10.0 | `disableColumnReorder`, flat-row `treeColumn`, and `onTreeToggle` | `C:\projects\av-grid\src\options.ts:593-631`; `C:\projects\av-grid\docs\api.md:420-456` |
| 2.11.0 | Fixed-height header band through `headerHeight` | `C:\projects\av-grid\src\options.ts:261-270`; `C:\projects\av-grid\docs\api.md:289-301` |
| 2.11.1 | Recycled header tooltip/ARIA state no longer leaks into a data cell | upstream log commit `13787ec` / 2.11.1 |
| 2.11.2 | Recycled header contents/label no longer remain in a data cell | upstream log commit `c7511c2` / 2.11.2 |

The upstream `FilterDefinition.match` type is optional only for host-owned filtering; runtime
validation still requires it for a locally evaluated custom filter. That distinction is in
`C:\projects\av-grid\src\validate.ts:498-547` and is not a reason to change Persephone's
custom-filter API.

### Persephone boundary

The package boundary is enforced, not conventional. `eslint.config.mjs:555-573` excludes only
`src/renderer/uikit/DataGrid/**` from the `no-restricted-imports` rule and rejects `av-grid` and
`av-grid/*` imports everywhere else. `src/renderer/uikit/DataGrid/types.ts:1-12` describes this
folder as the mounting shim, and its current explicit re-export list is at `:14-52`.

US-1433 needs no new av-grid type or value re-export. `disableColumnReorder` is an ordinary option,
not a callback or a new named type/value: `DataGridView.collectValues()` includes every defined
prop outside its callback/initial-only sets (`src/renderer/uikit/DataGrid/DataGridView.ts:48-59,213-225`),
then sends it to `AVGrid.create()` (`:99-109`) and includes changed values in deltas (`:139-160`).
Leave `src/renderer/uikit/DataGrid/types.ts` and `index.ts` unchanged. The text-filter re-exports
belong to US-1434, where they have actual consumers.

### Ranked recommendations

#### 1. Correct the board component catalog and guides — highest priority

The catalog is agent-facing, and its av-grid entry is now factually stale:

- `boards-assets/manifest.json:10` describes the old status-column-only surface.
- `boards-assets/manifest.json:16` says the last verification was 2.1.0 in 2026-08 even though
  the entry says it follows the newest package.
- `boards-assets/manifest.json:17` sends agents to Tabulator for tree/nested rows, remote AJAX
  server-side sort/filter/page, and arbitrary frozen data columns.
- `boards-assets/manifest.json:34` repeats those claims in Tabulator's purpose.
- The concrete stale Tabulator row is `boards-assets/README.md:98`; its introduction at `:87-97`
  only says to fall back for a feature av-grid lacks and needs to stay consistent, not be treated
  as the stale feature list.
- The agent guide's stale list is `assets/guides/agents/boards.md:600-603`, and the template's is
  `assets/board-template/CLAUDE.md:784-788`.

Update the manifest and mirror the same corrected distinctions in the README, agent guide, and
board template:

```text
// Before: manifest.json:16-17
Last verified here: 2.1.0 (2026-08)
... tree / nested rows ... remote-ajax data with server-side sort/filter/page ...
... freezing arbitrary DATA columns (av-grid pins only the leading status columns) ...

// After
Last verified here: 2.11.2 (2026-09)
... flat host-owned tree gutters, host-owned filtering/sorting, and leading/trailing sticky data
columns are available ...
```

The corrected fallback language must preserve the distinctions the source actually makes:

- `treeColumn` supplies a gutter over already-flat rows; hierarchical input, expansion state, and
  flattening remain host responsibilities (`C:\projects\av-grid\docs\api.md:420-456`). Tabulator
  remains the choice for a true tree-data engine or nested rows.
- `externalFilter` and `externalSort` let a host own row filtering/reordering while av-grid keeps
  the UI (`C:\projects\av-grid\src\options.ts:544-591`). They do not provide fetching, paging,
  or a remote-data protocol, so Tabulator can remain the fallback for those remote/pagination
  requirements.
- `pinned: "left"`/`"right"` supports sticky data columns, but pins must form the leading/trailing
  visible run, use fixed pixel widths, and cannot be grouped (`C:\projects\av-grid\src\validate.ts:354-391,397-421`).
  Tabulator remains the fallback for arbitrary/interleaved freeze behavior.
- `Column.group` gives exactly one optional group band over the ordinary column-header band:
  av-grid has two header levels, not three or more (`C:\projects\av-grid\src\types.ts:337-361`;
  `C:\projects\av-grid\docs\api.md:863-890`). A board needing one group band should choose
  av-grid; Tabulator remains the fallback for three-or-more-level nested headers.

Revise `preferThisOne`, Tabulator's `purpose`, the Tabulator table row, and both guide lists with
that narrower wording. The av-grid purpose should mention text filters, per-column operator lists,
`blank`/`notBlank`, host-owned filtering/sorting, flat tree gutter, and sticky leading/trailing
data columns. Do not imply that external filtering/sorting supplies server transport. Keep the
vendor URL, no-skin guidance, load order, and `--p-*` contract unchanged.

For the skin fields, no new theme fallback is needed. The upstream style uses existing
`--avg-grid-line`, `--avg-text-muted`, `--avg-text`, hover, border, accent, and button tokens for
the tree and text-filter controls (`C:\projects\av-grid\src\styles\av-grid.css.ts:263-328,903-950,1090-1143`).
The `avg-text-filter` occurrences are selectors rather than new theme variables; the tree's only
new structural default, `--avg-tree-indent`, is a spacing value
(`C:\projects\av-grid\src\styles\av-grid.css.ts:265-275`). The root maps those tokens to existing
`--p-*` values (`C:\projects\av-grid\src\styles\av-grid.css.ts:24-52`), and
`src/renderer/theme/p-vars.ts:21-44,76-84` therefore stays unchanged. Update `skin.tunedFor` to
identify av-grid 2.11.2 and make `cssVsJs` explicit that the new controls inherit existing tokens;
do not add colors or new `--p-*` names.

If this recommendation is skipped, board agents will continue selecting Tabulator for three
capabilities av-grid now covers, the catalog will continue lying about the verified version, and
the two-level-header distinction will remain too broad. The runtime grid itself will still work,
but future board choices will stay wrong.

#### 2. Restore `disableColumnReorder` in the Edit Columns popover and remove dead `resizible`

`ColumnsOptions` is itself a `DataGridView`: the model imports the grid at
`src/renderer/editors/grid/components/ColumnsOptions.ts:3`, creates it at `:371`, and its
`gridProps()` starts at `:398`. The file already records the accepted av-grid migration regression:

```ts
// Before: ColumnsOptions.ts:33-34
What is lost is that the user can now drag these three headers around. It is cosmetic: this
grid's column layout is not persisted, so a reorder lasts until the popover closes.

// After
The av-grid migration initially lost header dragging, but `disableColumnReorder: true` restores
the old no-drag behavior; the popover's column layout remains intentionally unpersisted.
```

Add `disableColumnReorder: true` to this popover's `gridProps()` only. It disables the gesture while
leaving editing, resize, filtering, and programmatic ordering available, as specified by
`C:\projects\av-grid\src\options.ts:595-608`. No persisted state or UI is needed. The generic
DataGrid value path already forwards the option (`src/renderer/uikit/DataGrid/DataGridView.ts:213-225`);
no boundary re-export or `DataGridView` change is needed.

Also remove the misspelled `resizible: true` at `ColumnsOptions.ts:243-248`. This is dead metadata,
not a visible regression: av-grid's inferred-column default is `resizable: true`
(`C:\projects\av-grid\src\validate.ts:200-208`), and header rendering treats every column as
resizable unless it explicitly says `resizable: false`
(`C:\projects\av-grid\src\view\HeaderCell.ts:112-116`). The field is still worth removing because
it records no av-grid behavior and obscures the real migration fix.

If this recommendation is skipped, the Edit Columns popover keeps a documented, cosmetic drag
regression and retains a misspelled field that av-grid ignores. Existing resize behavior does not
break because the correct upstream default is already resizable.

#### 3. Document the text-filter shape in scripting/MCP without changing runtime types

This stands independently of the Grid editor. Any av-grid-backed grid can produce a text filter;
the script facade already returns a copied filter value and its type
(`src/renderer/scripting/api-wrapper/GridEditorFacade.ts:180-188`), while the public declaration
keeps `value` as `unknown` and `type` as `string`
(`src/renderer/api/types/grid-editor.d.ts:84-90`). That is structurally capable of returning
`{ op: "contains", text: "..." }` and `{ op: "blank" }`; the facade also explicitly says
sort/filter writes are not exposed (`GridEditorFacade.ts:94-99`).

Add concise JSDoc describing `type: "text"`, the two text-value shapes, and the five operator names
to both `src/renderer/api/types/grid-editor.d.ts` and its checked-in flat mirror
`assets/editor-types/grid-editor.d.ts`. They are currently byte-identical and must remain so.
Update the corresponding read-only filter wording in `GRID_EDITOR_HELP` at
`GridEditorFacade.ts:94-99`. Keep the public types broad for custom filters; this is documentation,
not a narrowed union or a new setter.

If this recommendation is skipped, scripts can already receive the new value at runtime, but
agents and MCP consumers will see an undocumented object shape and the source/mirror declarations
will not explain how to interpret it.

#### 4. Add an honest user-facing release note for the already-delivered recycled-cell fixes

Add a bug-fix bullet to the current `Version 5.0.3 (Upcoming)` section of
`assets/guides/whats-new.md:9-45`: recycled grid header cells no longer leave their tooltip/ARIA
state or label/content in a data cell after virtualization reuses the cell. The upstream fixes
are the 2.11.1 and 2.11.2 commits listed above; the package bump already supplies them.

The Persephone `DataGridView` consumers that can expose this shared header/data-cell path are:

- Grid editor: `src/renderer/editors/grid/GridBodyView.ts:183`.
- Git Tree: `src/renderer/components/git-tree/GitTreeView.ts:258-277`.
- File Grid: `src/renderer/components/file-grid/FileGridView.ts:29-31`.
- Environment Variables: `src/renderer/editors/env-vars/EnvVarsBodyView.ts:352`.
- Grid output embedded in Log View: `src/renderer/editors/log-view/items/GridOutputView.ts:44-60`.

These all construct `DataGridView`, which creates the av-grid instance through the shared boundary
(`src/renderer/uikit/DataGrid/DataGridView.ts:99-109`). The variable-height Log and Notebook
views use `MeasuredRowGrid` instead (`src/renderer/editors/log-view/LogBodyView.ts:55,115`;
`src/renderer/editors/notebook/NotebookBodyView.ts:173,275-287`), so they are not evidence that
the header bug appeared there. The release note should claim the shared grid-cell fix, not every
virtualized list.

If this recommendation is skipped, the fixes still ship in the dependency, but users will have
no accurate release-note explanation for the visible stale-header artifacts they may have seen.

#### 5. Do not force-adopt `treeColumn`, `headerHeight`, or data-column pinning

There is no current Persephone consumer that justifies those three adoptions:

- Git Tree's only status/chrome column is `isStatusColumn: true` at
  `src/renderer/components/git-tree/GitTreeView.ts:124-134`; `applyLayout` moves all status
  columns to the leading run (`:154-178`). It therefore still satisfies 2.8.0's positional
  validation. Its graph column is an SVG swimlane (`src/renderer/components/git-tree/GitTreeView.ts:138-146`;
  `src/renderer/components/git-tree/branch-tree-cell.ts:18,67-72`), not a hierarchical data
  column. Keep it as-is. Neither Git Tree nor the Grid editor has a present requirement for a
  sticky data column; adding one would introduce persisted/UI decisions and positional constraints
  (`C:\projects\av-grid\src\validate.ts:370-391,407-421`).
- Git Tree and File Grid rows are fixed-height, one-line layouts: Git Tree uses
  `GIT_TREE_ROW_HEIGHT = 24` (`branch-tree-cell.ts:18`), and File Grid uses 20/24px rows and
  single-line title/status columns (`FileGridView.ts:11-12,65-85`). The `headerHeight` case in
  upstream docs is specifically tall multi-line data rows (`C:\projects\av-grid\docs\api.md:291-295`).
  The tall Log/Notebook consumers use `MeasuredRowGrid` with no header band, so do not add a
  meaningless header option.
- `src/renderer/uikit/Tree/TreeView.ts:316-324,438-470` is a one-column `RenderGrid` host with
  its own `TreeItemView`, level, chevron, drag/drop, and selection behavior. It is not an ordinary
  multi-column `DataGrid` whose indent gutter is missing. `FileGridItem` has no depth/children
  fields (`src/renderer/components/file-grid/FileGrid.ts:4-9`), and the Git graph must remain an
  SVG swimlane. Therefore there is no `treeColumn` consumer.

`disableColumnReorder` is intentionally not included in this no-consumer conclusion: the Edit
Columns popover is the exact consumer covered by recommendation 2. If recommendation 5 is skipped
as planned, the only stale state is that Persephone does not offer sticky data columns, fixed
headers for tall ordinary DataGrid rows, or a DataGrid tree gutter; no existing behavior breaks.

## Implementation Plan

### 1. Correct board metadata and authoring guidance

Update `boards-assets/manifest.json` as the machine-readable source, then mirror the narrowed
fallback language in `boards-assets/README.md:98`, `assets/guides/agents/boards.md:600-603`, and
`assets/board-template/CLAUDE.md:784-788`. Update the av-grid `versionNote` to 2.11.2 / 2026-09,
rewrite the stale `preferThisOne` and Tabulator purpose/list, and preserve the existing vendor,
load-order, no-skin, and theme-token instructions. A single group band remains an av-grid use case;
only three-or-more-level nested headers stay a Tabulator reason
(`C:\projects\av-grid\docs\api.md:863-890`).

Update `skin.tunedFor` and `cssVsJs` to record the verified version and existing-token inheritance.
Do not modify `src/renderer/theme/p-vars.ts` or add any hardcoded color/new theme token.

### 2. Restore the Edit Columns behavior

In `src/renderer/editors/grid/components/ColumnsOptions.ts`:

1. Add `disableColumnReorder: true` to `ColumnsOptionsContentView.gridProps()` near
   `disableSorting` (`:398-410`).
2. Update the migration comment at `:33-34` so it records that the explicit option recovers the
   cosmetic loss while layout remains unpersisted.
3. Remove `resizible: true` from the new-column object at `:243-248`; do not replace it with
   `resizable: true`, because av-grid's default is already true
   (`C:\projects\av-grid\src\validate.ts:200-208`; `C:\projects\av-grid\src\view\HeaderCell.ts:112-116`).

### 3. Document the generic script/API surface and release note

Update the source and mirror declarations together:

- `src/renderer/api/types/grid-editor.d.ts`
- `assets/editor-types/grid-editor.d.ts`

Update the read-only help prose in `src/renderer/scripting/api-wrapper/GridEditorFacade.ts`, then
add the concise 2.11.1/2.11.2 recycled-header-cell note to
`assets/guides/whats-new.md` under the upcoming release. Keep the declaration files byte-identical.

### 4. Verification at implementation time

Do not add unit tests or a test harness; this project does not use them for this surface. Verify:

- The Edit Columns popover cannot drag-reorder its three headers, while editing and resizing still
  work and the layout remains unpersisted.
- A newly added Edit Columns row has no `resizible` property and retains normal av-grid resizing.
- A script reading filters can interpret the documented text value shape, and the source/mirror
  declarations agree.
- The manifest, README, agent guide, and board template make the same av-grid/Tabulator choice,
  including the two-level versus three-or-more-level header distinction.
- Each listed DataGridView consumer no longer exhibits stale header tooltip/label/content after
  enough scrolling to recycle cells.
- The already-passing typecheck, lint, and production build remain green after implementation;
  `git diff --check` is clean.

## Concerns / Open questions

The scope decisions are resolved as follows:

- **Grid editor text filters:** deliberately deferred to US-1434, including all new boundary
  re-exports and Grid editor persistence/UI work.
- **Edit Columns reorder:** `disableColumnReorder` is a value option already forwarded by the
  generic DataGrid shim; no callback classification or new public type is needed
  (`src/renderer/uikit/DataGrid/DataGridView.ts:48-59,213-225`).
- **`resizible`:** dead metadata with no visible symptom because av-grid defaults ordinary columns
  to resizable (`C:\projects\av-grid\src\validate.ts:200-208`; `C:\projects\av-grid\src\view\HeaderCell.ts:112-116`).
- **Pinned data columns, header height, and tree gutter:** no current consumer; leave the upstream
  capability available without adding Persephone UI or persistence for it.
- **Theme:** no new `--p-*` fallback. The upstream tree/text-filter CSS chains to existing
  `--avg-*` tokens and the existing Persephone bridge (`C:\projects\av-grid\src\styles\av-grid.css.ts:24-52,263-328,903-950`).
- **External repository:** `C:\projects\av-grid` is read-only investigation input. No file there
  is part of the implementation or this repository's changed-file set.

## Acceptance Criteria

- [ ] `boards-assets/manifest.json`, `boards-assets/README.md`, `assets/guides/agents/boards.md`,
      and `assets/board-template/CLAUDE.md` all identify av-grid 2.11.2 and no longer make the
      disproved tree/server-side/arbitrary-freeze claims; one group band remains an av-grid use
      case and only three-or-more-level nested headers remain a Tabulator reason.
- [ ] The Edit Columns popover passes `disableColumnReorder: true`, its migration comment records
      the recovered behavior, and its three headers cannot be dragged while other editing behavior
      remains available.
- [ ] The misspelled `resizible` field is removed, with no replacement needed because ordinary
      av-grid columns default to `resizable: true`.
- [ ] `src/renderer/api/types/grid-editor.d.ts`, `assets/editor-types/grid-editor.d.ts`, and
      `GridEditorFacade.ts` document the generic text-filter value without narrowing custom-filter
      support; the declaration files remain byte-identical.
- [ ] `assets/guides/whats-new.md` accurately names the recycled header-cell tooltip/ARIA and
      label/content fixes delivered by av-grid 2.11.1/2.11.2 and the affected DataGridView family.
- [ ] `src/renderer/uikit/DataGrid/types.ts` and `index.ts` are unchanged; no file outside the
      boundary imports `av-grid` directly.
- [ ] No new `--p-*` theme token, hardcoded color, `treeColumn`, `headerHeight`, or data-column
      pinning workaround is added without a newly identified consumer.
- [ ] The implementation-time typecheck, lint, production build, and `git diff --check` pass;
      no unit-test or harness files are added.

## Files Changed

### This planning task

- `doc/tasks/US-1433-av-grid-2.11.2/README.md` — this implementation plan.
- `doc/active-work.md` — Active dashboard entry under `*(no epic)*`.

### Planned implementation touch set

- `boards-assets/manifest.json`
- `boards-assets/README.md`
- `assets/guides/agents/boards.md`
- `assets/board-template/CLAUDE.md`
- `src/renderer/editors/grid/components/ColumnsOptions.ts`
- `src/renderer/api/types/grid-editor.d.ts`
- `assets/editor-types/grid-editor.d.ts`
- `src/renderer/scripting/api-wrapper/GridEditorFacade.ts`
- `assets/guides/whats-new.md`

### Explicitly unchanged

- `src/renderer/uikit/DataGrid/types.ts` and `src/renderer/uikit/DataGrid/index.ts` — no US-1433
  text-filter consumer; those re-exports belong to US-1434.
- `src/renderer/uikit/DataGrid/DataGridView.ts` — generic value forwarding already covers the
  option.
- `src/renderer/editors/grid/GridEditor.ts`, `src/renderer/editors/grid/GridBodyView.ts`, and
  `src/renderer/editors/grid/utils/grid-utils.ts` — text-filter adoption is US-1434.
- `src/renderer/theme/p-vars.ts` and `src/renderer/uikit/DataGrid/DataGrid.css` — existing token
  bridge and stylesheet import are sufficient.
- `src/renderer/components/git-tree/GitTreeView.ts` and
  `src/renderer/components/git-tree/branch-tree-cell.ts` — status chrome and SVG graph remain as
  they are.
- `src/renderer/components/file-grid/FileGridView.ts`, `src/renderer/uikit/Tree/TreeView.ts`,
  `src/renderer/editors/log-view/LogBodyView.ts`, and
  `src/renderer/editors/notebook/NotebookBodyView.ts` — no header-height/tree-column adoption.
- All files under `C:\projects\av-grid` — read-only upstream source.
