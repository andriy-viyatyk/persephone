# EPIC-187: UI test coverage, phase 5a — Grid, Settings, Tools hub, About

## Status

**Status:** Completed 2026-11-18
**Created:** 2026-11-18

## Overview

First half of Phase 5 of the [UI test coverage roadmap](../reviews/ui-test-roadmap.md). Phase 5 lists eleven
surfaces, which is too many for one epic, so it is split the way Phase 4 was. This epic (5a) covers the Grid editor,
the Settings page, the Tools & Editors hub, and the About page with its guide browser. Phase 5b takes the rest:
clipboard history, MCP inspector, category pages, the toolset editor, agent tools, and the optional Git tree and Mneme
tests. The deliverable is the tests plus the bugs they find. The runner needs no new features.

This is the first coverage epic on the product test runner (EPIC-186), so every new test uses the `app` object style
(`ctx.app.pages[id].editor.…`), with `ctx.call` only where the stand-in cannot express the call (call options such as
`{ dialog: true }`).

## Goals

- Each module below has tests for every behavior on its checklist that `call` can reach. Whatever `call` cannot reach
  is listed as uncovered, with the reason.
- Claude fixes each app bug the tests find and adds a `whats-new.md` line for it.
- Every difficulty Codex has working out how to drive the app is recorded in
  [ai-vision-feedback.md](../reviews/ai-vision-feedback.md).

## Non-goals

- Phase 5b surfaces (above).
- Settings already covered in `core/settings` (round trip through `app.settings`, persistence across restart, theme and
  UI language switch). The Settings page tests here cover the page itself, not the settings store.
- Native file dialogs (Settings' site-extensions **Browse...**, any Save As).

## Working model

Unattended overnight run, so it differs from EPIC-185 in two ways:

- **Codex cannot run the suite at all** since EPIC-186 (the test host is an Electron utility process its sandbox
  cannot start, even with `--attach`). Codex writes tests from the guides, `$help` text in the source, the API type
  files and the editor source, and checks syntax with `node --check`. **Claude runs the tests and triages** every
  failure: a test bug goes back to Codex or is a one-line fix; an app bug is Claude's.
- **Two Codex sessions per task, both Luna/high:** session A investigates and writes a short task document
  (deleted when the epic closed) listing each test with its exact call paths and the source line that proves the
  path exists; Claude reviews it; session B writes the tests from the corrected document.
- Codex never uses the persephone MCP tool or port 7865, never runs `npm start`, `build-prod` or Electron, and never
  commits or stages.
- Every Codex brief asks for an `AI-VISION FEEDBACK` section; Claude appends each case to
  [ai-vision-feedback.md](../reviews/ai-vision-feedback.md), plus every failure caused by a wrong guess about the API.
- Every test works only inside its own folder under `ctx.fixture(...)` and closes what it opens. Known app failures
  that cannot be fixed tonight stay failing (the suite has no expected-failure marker) and are listed under Open items.

## Area checklists

### US-2065: Grid editor — `tests/editors/grid/`

The module already holds the five pilot tests (`grid.test.mjs`). New tests go in new files beside it.

- JSON, JSONL and CSV open as a grid with the right columns and rows; a CSV without headers gets `a`, `b`, `c` names;
  a single JSON object becomes one row; malformed JSON shows a parse error, not a grid.
- Edit a cell (string, number, boolean) through the facade or the keyboard; type validation as the guide says.
- Add and delete rows and columns; insertion is disabled while sorted or filtered.
- Sort ascending then descending by clicking a header.
- Column filters: the options checklist, and a Text filter (contains, equals, starts with, empty) set through
  **Edit Columns**; two filters combine.
- **Columns** popup: hide, show and reorder a column, Apply and Cancel.
- CSV options: header toggle and delimiter change.
- Excel-style paste of tab-delimited text grows rows and columns; one value pasted into a range fills it (as far as
  the facade or the keyboard reach it without reading the OS clipboard).
- Keyboard navigation between cells, as far as `call` can observe the focused cell.
- Switch back to the text editor: content preserved and saved to disk.

#### Results

- 16 tests in `open-formats.test.mjs`, `data-operations.test.mjs`, `options.test.mjs` and `keyboard.test.mjs` (plus the
  5 pilot tests): formats and parse errors, typed UI edits with number validation, Escape cancel, facade row/column
  CRUD, header sort, text and option filters, Edit Columns Apply/Cancel, CSV options, arrow navigation, Enter/F2 edit,
  Ctrl+Delete / Ctrl+Shift+Delete, Ctrl+Insert, TSV paste and range fill (clipboard saved and restored).
- App bugs fixed: a JSONL file with a bad line showed the lines before it as a table (an edit would have saved only
  those); picking a filter type with the mouse in Edit Columns closed the popup.
- **Open:** the guide says sorting or filtering disables row insertion and deletion; since the av-grid move the editor
  passes `canAddRows: true`, so Ctrl+Insert adds a row while sorted. The test stays failing.
- Uncovered: column reorder by dragging (the app window refuses HTML5 drags).

### US-2066: Settings page — `tests/tools/settings-page/`

- The Menu Bar gear opens Settings; the page has the root, the Content tree and the panels.
- Every built-in section in `settings.sections` renders its panel.
- Clicking a Content tree entry scrolls its panel into view, and scrolling the panels moves the tree's highlight
  (scroll-spy), as far as `call` can scroll and observe.
- `settings.highlight(key)` opens or activates Settings and points at the right section.
- A field changed on the page (a toggle, a select, a text field) writes the setting, and the page shows a setting
  changed through `app.settings`.
- **View Settings File** opens the settings file.
- A **?** help button exposes its `aria-description`.

#### Results

- 7 tests in `settings-page.test.mjs`: Menu Bar gear opens the page, every catalogue section renders, Content tree
  click and scroll-spy, `settings.highlight`, checkbox ↔ `app.settings`, View Settings File, help `aria-description`.
- App bugs fixed: every app-window highlight (`settings.highlight`, `elements` highlights, `ui.highlightElement`)
  failed because the CSP blocked the overlay's inline script; the scroll-spy stopped following the scroll after a
  scroll made while a Content tree jump was settling.

### US-2067: Tools & Editors hub — `tests/tools/tools-hub/`

- The hub opens (from the sidebar or the API) as `tools-hub-view`; `setTab` and the tab buttons switch between
  Editors, Search boards, Tools and Site extensions, and `activeTab` follows.
- Editors tab: the editor categories list the built-in editors; creating a new page from an entry opens that editor.
- Tools tab: the trusted-tools list shows a toolset registered through `tools.*` with a fixture toolset (if
  registration needs a dialog, answer it through the dialog protocol); unregistering removes it.
- Site extensions tab: lists a fixture site extension, if one can be installed from the test profile without the
  network; otherwise the empty state.
- Search boards tab: searching filters the list; with no catalog, the documented empty or offline state.

#### Results

- 5 tests in `tools-hub.test.mjs`: tabs by API and by click, Grid (JSON) created from the Editors tab, a fixture
  toolset registered through the consent dialog and unregistered, an untrusted fixture site extension listed and
  removed, and the empty Search boards state with a typed query.
- Runner fix: the test app fetched the published-boards catalog from GitHub at every start. The seed now marks the
  catalog as checked, so the suite stays offline and starts with an empty catalog.
- Uncovered: populated Search boards filtering (needs Phase 7's fixture catalog).

### US-2068: About page and guides — `tests/tools/guides/`

- The Menu Bar **About** opens the About page with the version card and the guide browser.
- `F1` with focus outside Monaco opens the guide for the active editor, or the guide contents when none is mapped.
- `pages["about-page"].editor.open(path)` shows that guide; a link inside a guide opens the linked guide; back works if
  the browser has it.
- `pages.openUrl("persephone-guide://editors/<editor>")` opens the guide as an ordinary Markdown tab.
- `guides.*` read paths return the same text as the shipped files.

#### Results

- 5 tests in `guides.test.mjs`: Menu Bar About, F1 opens the active grid's guide, `open` / link / `back` in the About
  pane, `persephone-guide://` as a Markdown tab, `guides["editors/grid"]` equals the shipped body.
- Uncovered: F1's fallback to the contents (no test-reachable editor without a guide).

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-2065 | Tests: Grid editor | Done |
| US-2066 | Tests: Settings page | Done |
| US-2067 | Tests: Tools & Editors hub | Done |
| US-2068 | Tests: About page and guides | Done |

## Concerns

1. **Codex writes blind.** It cannot run a single test, so its first draft is a guess checked only against source.
   Expect more test bugs per task than in earlier phases; each one is also an ai-vision feedback case.
2. **The grid is drawn.** Cells are virtualized and transient cell editors have no `elements` entry (grid guide), so
   keyboard navigation and paste may only be reachable through the facade.
3. **Clipboard.** The OS clipboard is not read back in tests; paste tests use a facade or a keyboard path that does
   not need it, or list paste as uncovered.
4. **Tools hub trust.** Registering a toolset shows a confirmation; the test answers it through the dialog protocol
   and unregisters afterwards, so the profile's registry is left as it was.

## Open items

1. **Grid row insertion while sorted or filtered.** `grid.md` says sorting or filtering disables row insertion and
   deletion; `GridBodyView` always passes `canAddRows: true`, and its projection does not react to sort or filter
   changes. Decide between restoring the rule and changing the guide. The test `Ctrl+Insert adds an unsorted row and
   is blocked while sorted or filtered` stays failing until then.
2. **Runner cleanup and stray dialogs.** A test that leaves an "Unsaved Changes" dialog open fails every later test in
   its module at "starting". Cleanup could answer Don't Save for test-owned pages.
3. **Carried over:** the EPIC-185 env-vars test (`Settings opens the Environment Variables editor…`) still fails in
   launched runs, as in EPIC-186's baseline.

## Notes

### 2026-11-18
- Created from the roadmap's Phase 5, first half. Split decision: Phase 5 has eleven surfaces; 5a takes the four
  largest single-editor surfaces, 5b the integration surfaces and the two optional features (Git tree, Mneme).
- The Settings page, Tools hub and guides tests open the new `tools` area the roadmap reserved for Phase 5.
- Each task: Codex Luna planned (session A), Claude reviewed (the grid plan went back once to read the `av-grid`
  source in `node_modules`; the tools-hub plan once for the call-tree root), Codex Luna wrote the tests (session B).
  Claude ran every module and triaged; most failures were test bugs from guessing the API without a live app, all
  recorded in [ai-vision-feedback.md](../reviews/ai-vision-feedback.md) (21 entries).
- Four app bugs fixed (above), with `whats-new.md` lines. Guide fix: `web-app-tests.md` now says that a string result
  that is valid JSON text comes back parsed.
- Completion skills on Codex (Luna): review found nothing; document made no changes; userdoc reworded the highlight
  line in `whats-new.md`. `guides:check`, typecheck and lint pass. Task folders deleted at close.
- Second launched run of `tools` and `editors/grid`: 37 passed, 1 failed (open item 1).
- Full launched run (`--with git`): 221 tests, **218 passed, 2 failed (open items 1 and 3), 1 skipped**; 33 new tests.
