# US-1373 — `where` on `elements`

Epic: [EPIC-094 — Per-screen guides and layout schemas](../../epics/EPIC-094.md)

## Goal

Add an optional plain-English spatial phrase, `where?: string`, to the shared AI-vision element
declaration and its live `elements` value. Carry it through the existing element path and the
existing `helpSearch` hit path, then populate exactly one list—`GRID_ELEMENTS`—with ten entries as
the end-to-end worked example, including the per-column filter control required by EPIC-094's
flagship gate. The remaining element phrases belong to US-1376 and US-1377.

## Background

### Existing contract and delivery paths

`src/shared/ai-vision/types.ts:35-39` defines `IAiElementDeclaration`, the shape stored in an
`elements` declaration list: `name`, `purpose`, and optional `selector`. The live value returned
to an agent is the separate `IAiElement` shape at `src/shared/ai-vision/types.ts:41-46`, currently
`name`, `purpose`, `selector`, and `visible`. `IAiVisionDescriptor.elements` is an optional
readonly declaration list at `src/shared/ai-vision/types.ts:82-87`.

`createElements` receives declarations at `src/renderer/scripting/ai-vision/elements.ts:99-106`.
Its `provide("elements")` branch maps each declaration to the live value at
`src/renderer/scripting/ai-vision/elements.ts:115-127`; this is the only place that must copy
`where` into the resolved result. The `CreateElementsOptions` interface at
`src/renderer/scripting/ai-vision/elements.ts:14-22` contains selector scope, labels, and
highlight hooks, but no declaration-level or scope-level descriptive text.

There are exactly two agent-facing text paths to extend:

1. The resolved `elements` value from `createElements.provide("elements")`, currently assembled
   as `{ name, purpose, selector, visible }` at `src/renderer/scripting/ai-vision/elements.ts:117-125`.
2. The element hit in `helpSearch`, currently built as
   `element "<name>" — <purpose>` plus a highlight pointer at
   `src/shared/ai-vision/help-search.ts:82-91`. Its match input is currently
   `` `${element.name} ${element.purpose}` `` at `src/shared/ai-vision/help-search.ts:83-85`.

`GridEditorFacade` also repeats element names and purposes in its manually authored general help
string at `src/renderer/scripting/api-wrapper/GridEditorFacade.ts:57-61`. That text is not the
`descriptor.elements` declaration list or a renderer of an element's `purpose` field; it is not a
third element-delivery path and should not become a second positional source in this task.

`src/shared/ai-vision/hint.ts` does not render `descriptor.elements`: `formatMembers` only formats
members at `src/shared/ai-vision/hint.ts:42-45`, `buildHint` adds children/overview/members at
`src/shared/ai-vision/hint.ts:57-73`, and `buildHelp` adds overview/help/members/children at
`src/shared/ai-vision/hint.ts:100-110`. No element hint list exists to extend. Starting to render
elements there would change every surface's hint output, so it is explicitly out of scope for
this task and must not be reopened by US-1376 or US-1377.

### Blast-radius inventory

The required search for the two type names found the following consumers. The type declarations,
the live builder, and `helpSearch` are the only implementation consumers that need changes; every
static list below remains source-compatible with an optional property and must not be filled in
by this task.

| Verified consumer | Evidence | Verdict for US-1373 |
|---|---|---|
| `src/shared/ai-vision/types.ts` | `IAiElementDeclaration` at lines 35-39; `IAiElement` at lines 41-46; descriptor field at lines 82-87 | Needs additive type changes |
| `src/renderer/scripting/ai-vision/elements.ts` | Imports both types at line 2; declaration plumbing at lines 64-77 and 99-106; live mapping at lines 115-127 | Needs additive output mapping |
| `src/shared/ai-vision/help-search.ts` | Reads `descriptor.elements` and its `name`/`purpose` at lines 82-91 | Needs additive match/line formatting |
| `src/renderer/scripting/api-wrapper/AboutEditorFacade.ts` | Declaration list type at lines 3 and 11 | No source change; later phrase ownership is outside this task |
| `src/renderer/scripting/api-wrapper/ArchiveEditorFacade.ts` | Declaration list type at lines 6 and 8 | No source change |
| `src/renderer/scripting/api-wrapper/BoardEditorFacade.ts` | Declaration list type at lines 14 and 41 | No source change |
| `src/renderer/scripting/api-wrapper/BoardInfoEditorFacade.ts` | Declaration list type at lines 16 and 18 | No source change |
| `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts` | Declaration list type at lines 22 and 61 | No source change |
| `src/renderer/scripting/api-wrapper/EnvVarsEditorFacade.ts` | Declaration list type at lines 10 and 12 | No source change |
| `src/renderer/scripting/api-wrapper/LogViewEditorFacade.ts` | Declaration list type at lines 8 and 15 | No source change |
| `src/renderer/scripting/api-wrapper/McpInspectorFacade.ts` | Declaration list type at lines 31 and 33 | No source change |
| `src/renderer/scripting/api-wrapper/MnemeConfigEditorFacade.ts` | Declaration list type at lines 10 and 24 | No source change |
| `src/renderer/scripting/api-wrapper/MnemeRootEditorFacade.ts` | Declaration list type at lines 2 and 8 | No source change |
| `src/renderer/scripting/api-wrapper/NotebookEditorFacade.ts` | Declaration list type at lines 7 and 9 | No source change |
| `src/renderer/scripting/api-wrapper/RestClientEditorFacade.ts` | Declaration list type at lines 22 and 24 | No source change |
| `src/renderer/scripting/api-wrapper/ToolsetEditorFacade.ts` | Declaration list type at lines 2 and 11 | No source change |
| `src/renderer/scripting/api-wrapper/ToolsHubEditorFacade.ts` | Declaration list type at lines 2 and 10 | No source change |
| `src/renderer/scripting/ai-vision/page-tab.ts` | Declaration list type at lines 4 and 8 | No source change |
| `src/renderer/scripting/ai-vision/page-panels.ts` | Declaration list type at lines 11, 39, and 148 | No source change; its optional selector is already built conditionally at line 175 |
| `src/renderer/scripting/ai-vision/page-editor-switches.ts` | Declaration list type at lines 7 and 14 | No source change |
| `src/renderer/scripting/ai-vision/namespaces/menu-bar.ts` | Declaration list type at lines 4 and 14 | No source change |
| `src/renderer/scripting/ai-vision/namespaces/settings.ts` | Declaration list type at lines 6 and 152 | No source change |
| `src/renderer/scripting/ai-vision/namespaces/ui.ts` | Declaration list type at lines 3 and 5 | No source change |

`IAiElement` itself has no consumer beyond the live array in `elements.ts:117-125`. A structural
search also found other descriptor publishers that pass inferred element arrays through, including
the editor facades at `src/renderer/scripting/api-wrapper/*Facade.ts` and the page/namespace
descriptors at `src/renderer/scripting/ai-vision/`; they remain unchanged because the optional
field is accepted without altering their existing arrays. `GridEditorFacade` is the one exception
by task scope: its ten-entry list after this task is at `src/renderer/scripting/api-wrapper/GridEditorFacade.ts:19-30`
and is published at lines 82-95.

The flagship filter control is rendered by the installed `av-grid` build's `HeaderCell` module at
`node_modules/av-grid/dist/av-grid.js:3284-3302`; the compiled render path updates its
filterable/filtered/open state at `node_modules/av-grid/dist/av-grid.js:3327-3345`. It sets
`data-type="filter-button"` but has no `data-name`. Its CSS hides the button by default and
reveals it for a hovered header or filtered column at
`node_modules/av-grid/dist/av-grid.css:161-181`, with an additional open-state rule at lines
1023-1026. This is an editor internal, so the contract's Scope explicitly excludes exhaustive
`data-name` coverage inside editors (`doc/architecture/ui-element-contract.md:195-203`), and its
`data-type`/`data-part` distinction remains relevant at lines 22-46.

The existing declaration `selector?: string` is the intended address when a `data-name` is
unavailable: `src/shared/ai-vision/types.ts:35-39`, and `resolvedSelector` uses the explicit
selector before falling back to `[data-name="<name>"]` at
`src/renderer/scripting/ai-vision/elements.ts:64-74`. The page-panel publisher already uses the
same optional-selector tuple shape at `src/renderer/scripting/ai-vision/page-panels.ts:148-175`.
US-1373 therefore adds an explicit selector built from av-grid's existing class names; it makes no
change to the dependency source, `node_modules`, or a dependency release.
This keeps the worked example addressable for EPIC-094's A.2 gate without extending the shell
contract into editor internals.

Optional output fields are omitted in surrounding code rather than emitted as `undefined`: for
example, `BoardEditorFacade.summarize()` uses conditional spreads at
`src/renderer/scripting/api-wrapper/BoardEditorFacade.ts:130-140`, and `BrowserEditorFacade` adds
optional summary fields only when defined at `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts:119-130`.
This matters at the serialization boundary: `result-shaper.ts:160-165` enumerates returned object
properties, while `result-shaper.ts:128-130` turns an emitted `undefined` into `null`. Therefore a
declaration without `where` must produce a live element object without a `where` key, not
`where: undefined`.

## Implementation Plan

- [x] Update `src/shared/ai-vision/types.ts:35-46` with `where?: string` on both the declaration
  and resolved element shapes. `IAiVisionDescriptor.elements` at lines 82-87 stays the same because
  it already points to the declaration interface.

  Before:

  ```ts
  export interface IAiElementDeclaration {
      readonly name: string;
      readonly purpose: string;
      readonly selector?: string;
  }

  export interface IAiElement {
      readonly name: string;
      readonly purpose: string;
      readonly selector: string;
      readonly visible: boolean;
  }
  ```

  After:

  ```ts
  export interface IAiElementDeclaration {
      readonly name: string;
      readonly purpose: string;
      readonly where?: string;
      readonly selector?: string;
  }

  export interface IAiElement {
      readonly name: string;
      readonly purpose: string;
      readonly where?: string;
      readonly selector: string;
      readonly visible: boolean;
  }
  ```

- [x] Update `createElements` in `src/renderer/scripting/ai-vision/elements.ts:115-127` to copy
  `declaration.where` only when it is defined. Keep `CreateElementsOptions` unchanged: its verified
  fields at lines 14-22 control selector scoping, labels, and highlight behavior; a scope-level
  default would invent a location for every child and could not represent the state-specific
  popup phrases required by EPIC-094.

  Before:

  ```ts
  return {
      name: declaration.name,
      purpose: declaration.purpose,
      selector,
      visible: isVisible(selector),
  };
  ```

  After:

  ```ts
  return {
      name: declaration.name,
      purpose: declaration.purpose,
      ...(declaration.where !== undefined ? { where: declaration.where } : {}),
      selector,
      visible: isVisible(selector),
  };
  ```

- [x] Update `collectKindHits` in `src/shared/ai-vision/help-search.ts:82-91`. When `where` is
  absent, retain the existing line byte-for-byte: `element "<name>" — <purpose>`, followed by the
  existing `Show it to the user with highlight(...)` pointer. When it is present, use this exact
  line shape before the existing pointer:

  ```text
  element "<name>" — <purpose>; where: <where>
  ```

  Match against the element name, purpose, and `where` phrase together, so positional words such
  as `top-right` participate in search as well as the control's existing purpose. The implementation
  should preserve the absent-field line with an explicit conditional rather than appending a
  dangling separator.

  Before:

  ```ts
  const line = `element "${element.name}" — ${element.purpose}`;
  if (matches(`${element.name} ${element.purpose}`, tokens)) {
      hits.push({
          path: joinChildPath(path, "elements"),
          kind: descriptor.kind,
          matchedLine: `${line} Show it to the user with ${joinChildPath(path, `highlight("${element.name}")`)}.`,
      });
  }
  ```

  After:

  ```ts
  const matchedText = `${element.name} ${element.purpose}${element.where !== undefined ? ` ${element.where}` : ""}`;
  const line = element.where === undefined
      ? `element "${element.name}" — ${element.purpose}`
      : `element "${element.name}" — ${element.purpose}; where: ${element.where}`;
  if (matches(matchedText, tokens)) {
      hits.push({
          path: joinChildPath(path, "elements"),
          kind: descriptor.kind,
          matchedLine: `${line} Show it to the user with ${joinChildPath(path, `highlight("${element.name}")`)}.`,
      });
  }
  ```

- [x] Fill exactly ten entries in `GRID_ELEMENTS` in
  `src/renderer/scripting/api-wrapper/GridEditorFacade.ts:19-30`, including the new
  `grid-column-filter` declaration. The running window verified the following toolbar geometry on
  a 1536px-wide grid page (all controls at `top: 47`): `page-nav-panel` left 6,
  `grid-columns` left 34, `grid-csv-options` left 62, `grid-search` left 1145 through 1345,
  and `page-editor-switch` left 1349. Therefore the switcher is to the right of the search box;
  the phrase must name that neighbour. The toolbar code path remains verified by
  `GridEditorView` at `src/renderer/editors/grid/index.ts:219-240`, `TextChromeView` at
  `src/renderer/editors/base/TextChromeView.ts:356-380`, and `PageToolbarView` at
  `src/renderer/editors/base/PageToolbarView.ts:362-384`.

  The filter view and state are verified in the dependency output at
  `node_modules/av-grid/dist/av-grid.js:3284-3345` and CSS at
  `node_modules/av-grid/dist/av-grid.css:161-181,1023-1026`. The CSS gives the filter button
  `display: none` at rest, then displays it when its header is hovered, its column is filtered,
  or its filter popup is open. Because `createElements` calculates `visible` with
  `offsetParent !== null` at `src/renderer/scripting/ai-vision/elements.ts:90-97,117-125`,
  `grid-column-filter` must be documented as an aggregate state: with no hovered/filtered/open
  filter buttons, `visible` is false; while any matching button is displayed, `visible` is true.
  It does not report a separate visibility value for each repeated column, and a hidden button can
  still be present in the DOM.

  Its default selector would fall back to a nonexistent `data-name` button. The Grid facade
  currently supplies no `highlightOptions` at `src/renderer/scripting/api-wrapper/GridEditorFacade.ts:82-87`;
  the overlay therefore selects only the first DOM match by default
  (`assets/agent/ui-highlight.js:265-282`), which is not acceptable for a repeated, state-hidden
  control. Use an explicit visible-state selector for the declaration and `highlightOptions: { all: true }`
  for the Grid element builder, so highlighting rings every currently visible matching filter
  button (up to the overlay's documented cap) and returns no misleading visible target when all
  filter buttons are hidden. The declaration must use an explicit selector because the dependency
  supplies no `data-name`; the selector only filters the visible hover/filtered/open states. The
  planned selector is:

  ```css
  .avg-filter-button.avg-column-filtered,
  .avg-filter-button.avg-filter-open,
  .avg-header-cell:hover .avg-filter-button
  ```

  The `where` phrase remains user-facing prose; these classes belong only in the declaration's
  selector because they are the dependency's existing visibility state hooks, not a request to
  modify the dependency.

  | Element | `where` phrase | Source-backed reason |
  |---|---|---|
  | `grid-search` | `search box at the right of the grid toolbar, left of the editor switcher` | Live geometry puts the switcher at left 1349, immediately after the search box ending at 1345; the slots are assembled at `TextChromeView.ts:361-369` and `GridEditorView.ts:230-232`. |
  | `grid-search-clear` | `clear button at the right edge of the grid search box` | The clear control is appended as the input's `endSlot` and is present only with active search (`src/renderer/editors/grid/index.ts:157-177`). |
  | `grid-column-filter` | `filter button at the right edge of each column header; appears when the header is hovered, the column is filtered, or its filter popup is open` | The dependency CSS is evidence of the button's right-edge position and hover/filtered/open visibility states (`node_modules/av-grid/dist/av-grid.css:161-181,1023-1026`); US-1373 does not modify that dependency. |
  | `grid-columns` | `Edit Columns button on the left side of the grid toolbar` | It is the first grid toolbar contribution (`src/renderer/editors/grid/index.ts:46-49,76-83`). |
  | `grid-csv-options` | `CSV Options button beside Edit Columns on the left side of the grid toolbar` | It is appended after the columns button and exists only for CSV (`src/renderer/editors/grid/index.ts:65-73,86-98`). |
  | `columns-options-apply` | `in the Columns popup, bottom-right` | The popup is placed below the button (`ColumnsOptions.ts:439-445`); its footer pushes Cancel and Apply to the end, with Apply last (`ColumnsOptions.ts:305-331`). |
  | `columns-options-cancel` | `in the Columns popup, bottom-right, left of Apply` | The same footer order places Cancel immediately before Apply (`ColumnsOptions.ts:317-331`). |
  | `csv-options-header` | `in the CSV Options popup, at the top` | The vertical popup appends the header checkbox first (`CsvOptions.ts:75-81,100-115`). |
  | `csv-options-delimiter` | `in the CSV Options popup, below the header checkbox` | The delimiter label and radio group follow the header checkbox (`CsvOptions.ts:82-87,100-115`). |
  | `csv-options-other` | `custom delimiter field in the CSV Options popup, at the bottom` | The Other row is appended after the delimiter choices (`CsvOptions.ts:88-99,100-115`). |

  The tenth declaration's exact shape is:

  ```ts
  {
      name: "grid-column-filter",
      purpose: "Open the row filter for one grid column.",
      where: "filter button at the right edge of each column header; appears when the header is hovered, the column is filtered, or its filter popup is open",
      selector: '.avg-filter-button.avg-column-filtered, .avg-filter-button.avg-filter-open, .avg-header-cell:hover .avg-filter-button',
  }
  ```

  The Grid builder change is likewise explicit. Before:

  ```ts
  beforeHighlight: pageId ? () => activatePageAndWaitForLayout(pageId) : undefined,
  ```

  After:

  ```ts
  beforeHighlight: pageId ? () => activatePageAndWaitForLayout(pageId) : undefined,
  highlightOptions: { all: true },
  ```

  Do not add a separate column-header declaration for sorting or drag-reordering. The dependency
  renders one repeated header root with `data-type="header-cell"`, `data-column-key`, and a
  repeated root `draggable` state at `node_modules/av-grid/dist/av-grid.js:3304-3319`; sorting is
  likewise state on that root at lines 3320-3326. A static `grid-column-header` selector would
  match every header, and the existing highlight contract would either ring only the first or all
  repeated headers, without identifying the column the user asked about. The filter button is the
  actionable control needed by the flagship gate; its repeated all-visible highlight is acceptable
  because the phrase deliberately says “each column header.”

- [x] Leave `src/shared/ai-vision/hint.ts` unchanged. Its verified builders do not consume the
  element declaration list, and adding elements to hints would broaden this task to every hint
  surface rather than extending the two paths where element text already appears.

- [x] Leave all other declaration lists unchanged. US-1376 and US-1377 will add their phrases from
  the layout schemas they own; this task must not pre-fill any of those lists.

### Phrase convention for US-1376 and US-1377

Use short, user-facing plain-English noun phrases in the present tense: describe where a person
looks (`search box at the right of the grid toolbar, left of the editor switcher`, `in the Columns popup, bottom-right`),
not how code addresses it, how to click it, pixels, coordinates, colors, or CSS selectors. Include
the containing region and the state when a control exists only in a popup or other state. When a
control exists only in a state, name that state in the phrase, and make the state's name match the
label of the second, separately labelled diagram in the guide's `## Layout` section, as required by
EPIC-094 decision 8. Use the same wording in that schema and its `where` field so the two artifacts
cannot drift. No phrase means the declaration omits `where` entirely because there is no stable,
useful spatial claim; it does not mean an empty string, `null`, or a vague placeholder.

## Concerns

- The grid sketch in `doc/in-app-guides-roadmap.md:182-191` is illustrative, not a verified screen
  inventory: it shows `[Add row] [Delete] [Columns ▾] [Filter ⌕] [⋮]` in one toolbar and a bottom
  status line, while the live grid toolbar has only the Columns and CSV controls plus the search
  box and editor switcher, and filtering is on each column header. US-1376 must draw the grid
  schema from the live screen rather than copying that sketch as fact.
- Live placement remains a human verification point. The source establishes the intended ordering,
  but the ten phrases must be checked against the running screen before implementation is accepted;
  this is the same live-app verification requirement recorded in EPIC-094.
- The filter entry intentionally depends on av-grid's internal class names. An av-grid upgrade can
  therefore silently break it while typecheck, lint, and build remain green: `visible` could stay
  permanently false and `highlight` could find nothing. That is the check the EPIC-094 `/userdoc`
  step is meant to catch: when a screen's toolbar changes, re-check its `## Layout` schema and
  `where` phrases. No test is added for this dependency-owned selector.
- EPIC-094 decision 9 is satisfied: the schema draws the filter control, the agent can address it,
  and the entry is added with an explicit selector rather than a `data-name`, with the contract's
  Scope section (`doc/architecture/ui-element-contract.md:195-203`) as the recorded reason.
- The optional resolved field must be omitted, not emitted as `undefined`, because the generic
  result shaper converts an emitted undefined object property to `null` (`src/shared/ai-vision/result-shaper.ts:128-165`).
- `hint.ts` is intentionally a no-change file. Any request to show an element list in hints is a
  separate surface-wide scope change, not a reason to expand US-1373.
- No unit tests or test harnesses are planned; the project rule in this task is to verify the
  additive type/build behavior and the live element/help-search behavior without adding tests.

## Acceptance Criteria

- [x] `IAiElementDeclaration` and `IAiElement` both expose optional `readonly where?: string`, while
  `IAiVisionDescriptor.elements` remains the same declaration-list property.
- [x] `createElements(...).provide("elements")` includes `where` only for declarations that define
  it; lists without phrases retain the existing four-key result shape.
- [x] `helpSearch` matches against name, purpose, and `where`; present phrases use
  `element "<name>" — <purpose>; where: <where>` before the unchanged highlight pointer, and
  absent phrases retain the old line exactly.
- [x] `hint.ts` and `CreateElementsOptions` are unchanged; no element hint list or scope-level
  default is introduced.
- [x] The dependency-owned filter button is addressed by the explicit class selector in the table,
  retaining the dependency's existing `data-type="filter-button"` without adding a `data-name`;
  EPIC-094 decision 9 is satisfied because the schema draws the control and the agent can address
  it, with the contract Scope section (`doc/architecture/ui-element-contract.md:195-203`) recording
  why an editor-internal `data-name` is not added.
- [x] Exactly ten `GRID_ELEMENTS` entries receive the phrases in the table above, including the
  stateful per-column filter entry and explicit popup/state wording for all `columns-options-*`
  and `csv-options-*` controls.
- [x] The filter entry's `visible` behavior is documented and its repeated highlight path rings
  currently visible matches with an honest no-match result when all filter buttons are hidden.
- [x] No other element list receives a `where` phrase in US-1373; those additions remain assigned
  to US-1376 and US-1377.
- [x] No unit tests, test harnesses, dashboard entries, implementation commit, or unrelated files
  are added by this task-document phase.

## Files Changed Summary

| File | Planned change |
|---|---|
| `src/shared/ai-vision/types.ts` | Add optional `where` to declaration and resolved element interfaces. |
| `src/renderer/scripting/ai-vision/elements.ts` | Conditionally copy `where` into live element results. |
| `src/shared/ai-vision/help-search.ts` | Include `where` in element hit text and matching while preserving the old absent-field line. |
| `src/renderer/scripting/api-wrapper/GridEditorFacade.ts` | Fill the ten `GRID_ELEMENTS` phrases and use visible-state/all-match highlighting for the repeated filter control. |
| `doc/tasks/US-1373-where-on-elements/README.md` | This investigation and implementation plan. |

Files verified and intentionally requiring no change: `src/shared/ai-vision/hint.ts`,
`CreateElementsOptions` in `src/renderer/scripting/ai-vision/elements.ts`, the general Grid help
string in `src/renderer/scripting/api-wrapper/GridEditorFacade.ts:57-61`, every declaration
consumer listed in the blast-radius table except the Grid list, and these other structural
`elements:` publishers: `src/renderer/scripting/api-wrapper/AboutEditorFacade.ts:134`,
`src/renderer/scripting/api-wrapper/ArchiveEditorFacade.ts:62`,
`src/renderer/scripting/api-wrapper/BoardEditorFacade.ts:127`,
`src/renderer/scripting/api-wrapper/BoardInfoEditorFacade.ts:108`,
`src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts:117`,
`src/renderer/scripting/api-wrapper/DrawEditorFacade.ts:96-113`,
`src/renderer/scripting/api-wrapper/EnvVarsEditorFacade.ts:86`,
`src/renderer/scripting/api-wrapper/FileDiffEditorFacade.ts:50`,
`src/renderer/scripting/api-wrapper/FolderViewEditorFacade.ts:61`,
`src/renderer/scripting/api-wrapper/GitTreeEditorFacade.ts:93`,
`src/renderer/scripting/api-wrapper/GraphEditorFacade.ts:151`,
`src/renderer/scripting/api-wrapper/HtmlEditorFacade.ts:61`,
`src/renderer/scripting/api-wrapper/ImageEditorFacade.ts:56`,
`src/renderer/scripting/api-wrapper/LogViewEditorFacade.ts:92`,
`src/renderer/scripting/api-wrapper/MarkdownEditorFacade.ts:75`,
`src/renderer/scripting/api-wrapper/McpInspectorFacade.ts:228`,
`src/renderer/scripting/api-wrapper/MermaidEditorFacade.ts:70`,
`src/renderer/scripting/api-wrapper/MnemeConfigEditorFacade.ts:96`,
`src/renderer/scripting/api-wrapper/MnemeRootEditorFacade.ts:88`,
`src/renderer/scripting/api-wrapper/NotebookEditorFacade.ts:111`,
`src/renderer/scripting/api-wrapper/RestClientEditorFacade.ts:152`,
`src/renderer/scripting/api-wrapper/SvgEditorFacade.ts:58`,
`src/renderer/scripting/api-wrapper/TextEditorFacade.ts:95`,
`src/renderer/scripting/api-wrapper/ToolsetEditorFacade.ts:68`,
`src/renderer/scripting/api-wrapper/ToolsHubEditorFacade.ts:57`,
`src/renderer/scripting/api-wrapper/VideoEditorFacade.ts:90`,
`src/renderer/scripting/ai-vision/page-compare.ts:103`,
`src/renderer/scripting/ai-vision/page-editor-switches.ts:70`,
`src/renderer/scripting/ai-vision/page-panels.ts:280,323`,
`src/renderer/scripting/ai-vision/page-tab.ts:79`,
`src/renderer/scripting/ai-vision/namespaces/menu-bar.ts:35`,
`src/renderer/scripting/ai-vision/namespaces/settings.ts:257`, and
`src/renderer/scripting/ai-vision/namespaces/ui.ts:45`.
`doc/active-work.md` is also intentionally unchanged because the dashboard entry already exists
and the user explicitly excluded dashboard edits.
