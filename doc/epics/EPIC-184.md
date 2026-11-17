# EPIC-184: UI test coverage, phase 4a — text and document editors

## Status

**Status:** Completed 2026-11-17
**Created:** 2026-11-17

## Overview

First half of Phase 4 of the [UI test coverage roadmap](../reviews/ui-test-roadmap.md). The roadmap allows splitting
Phase 4 in two when the checklist runs long, and it does: this epic covers the text editor (Monaco), Markdown preview,
Mermaid, compare and Git diff, and editor switching. The viewer editors (HTML, SVG, Image, Log View, Links, Env-vars,
Video) follow in phase 4b. The tests go under `integration-test/tests/editors/`. The deliverable is the tests plus the
bugs they found. The runner needs no new features.

## Goals

- Each editor module below has tests for every behavior on its checklist that `call` can reach. Whatever `call`
  cannot reach is listed as uncovered, with the reason.
- Claude fixes each app bug the tests find and adds a `whats-new.md` line for it.
- Stale guide text found along the way is fixed.

## Non-goals

- The viewer editors (phase 4b), grid editing beyond switching to and from it (Phase 5), and the Git tree panel
  (Phase 5, optional feature).
- The Monaco script panel and script execution (covered in `core/scripting`), and Translate/Transcript (they need
  network or audio; Phase 9).

## Working model

Same as [EPIC-183](EPIC-183.md#working-model):

- **Codex (Luna) writes, runs and triages** each task's tests. This epic's checklist is the plan, so there is no
  separate task document. Codex reads the editor's guide and source and explores the call tree against an
  `npm run test:ui -- --open` instance that Claude starts. It runs the tests with
  `npm run test:ui -- --attach --area editors/<module>`.
- **App bugs:** Codex never fixes them and never bends a test to pass. It leaves the test failing and reports steps,
  expected, actual and the failing test in the task's Results block. Claude investigates and fixes every one.
- **Claude per task:** reads the new tests and checks for real assertions, no fixed sleeps, and nothing that passes
  without checking. Sends corrections to the same Codex session, fixes the reported bugs, and reruns the tests.
- **Claude per epic:** runs the whole `editors` area twice in launched mode, then the full suite once, and fixes
  anything still failing.
- Every test works only inside its own folder under `ctx.fixture(...)`. Shared helpers go to
  `integration-test/tests/editors/helpers.mjs` (area-only, per `integration-tests.md`).

## Area checklists

Read the guide for each editor first (`assets/guides/editors/<name>.md`) and
[`editors/index.md`](../../assets/guides/editors/index.md).

### US-2043: Text editor (Monaco) — `tests/editors/text/`

The module already holds the Phase 1 pilot (`text.test.mjs`). New tests go in new files beside it.

- Type, undo and redo. The content and the modified state follow each step.
- Find and replace through the find bar: matches are found, one and all are replaced.
- Change the language. Highlighting mode and the page's language both change, and the choice survives a save and
  reopen if the guide says it does.
- Multi-cursor editing, as far as `call` can drive it (the editor API, or the keyboard).
- Word wrap on and off.
- Format document for a language that has a formatter (JSON).
- Save writes the file to disk and clears the modified state.

#### Results

- Tests added in [`text-behavior.test.mjs`](../../integration-test/tests/editors/text/text-behavior.test.mjs):
  - `typing updates content and modified state through undo and redo`
  - `find and replace changes one match and then all remaining matches`
  - `changing the language updates the page and Monaco highlighting`
  - `word wrap can be turned on and off for the current page`
  - `keyboard multi-cursor typing edits two lines at once`
  - `JSON document formatting preserves data and changes its layout`
  - `saving typed text writes the file and clears modified state`
- `npm run test:ui -- --attach --area editors/text`: **10 passed, 1 failed, 0 skipped**.
- App bug found: open a saved text fixture, type text, then press Ctrl+Z to restore the exact saved content. Expected
  `page.modified` to return to `false`; actual it remains `true`. Failing test: `typing updates content and modified
  state through undo and redo`.
- Uncovered: **none**. Each checklist behavior was reachable and observed through the call surface. The guide does not
  promise that a language choice persists after reopening, so no save/reopen persistence assertion was added.
- Claude check (2026-11-17): **not an app bug.** `modified` means "edited since the last save"
  (`TextFileModel.changeContent` sets it on every change); it is not a comparison with the file on disk. Windows
  Notepad behaves the same way. The test now expects the page to stay modified after the undo. The redo step sent
  `Ctrl+Y`, which this app binds to Delete Line (`configure-monaco.ts`, `shortcuts.md`). The test now sends
  `Ctrl+Shift+Z`. The format test's newline check passed on unformatted input; it now requires more than three lines.
  `--attach --area editors/text`: **11 passed, 0 failed**.

### US-2044: Markdown preview — `tests/editors/markdown/`

- A markdown file opens in preview and renders headings, lists, code blocks and tables.
- A Mermaid block inside the markdown renders as a diagram.
- Links: a link to another fixture file opens it; a heading anchor scrolls to its heading.
- The find bar finds text in the preview.
- An edit in the text editor shows up in the preview.

#### Results

- Tests added in [`markdown.test.mjs`](../../integration-test/tests/editors/markdown/markdown.test.mjs):
  - `Markdown files open in preview and render headings, lists, code, and tables`
  - `a Mermaid fence in Markdown renders a diagram image`
  - `local Markdown links open in the same page and heading links scroll to their target`
  - `the Markdown find bar finds and cycles through preview text`
  - `editing Markdown in Text Editor updates the rendered preview`
- `npm run test:ui -- --attach --area editors/markdown`: **5 passed, 0 failed, 0 skipped**.
- App bugs found: **none**.
- Uncovered: **none**. All five checklist behaviors were reachable and observed through the call surface.

### US-2045: Mermaid — `tests/editors/mermaid/`

- A `.mmd` file renders a diagram; a syntax error shows the error state instead.
- The look and layout menus (US-2020) change the rendering, and the choice is kept as the guide says.
- The image actions the guide lists (copy or export) work as far as `call` can observe them.

#### Results

- Tests added in [`mermaid.test.mjs`](../../integration-test/tests/editors/mermaid/mermaid.test.mjs):
  - `a Mermaid page renders valid source and reports invalid syntax`
  - `look and layout choices stay with their page across editor switches`
  - `Mermaid PNG export writes a non-empty PNG and copy completes`
- `npm run test:ui -- --attach --area editors/mermaid`: **3 passed, 0 failed, 0 skipped**.
- App bugs found: **none**.
- Uncovered: clipboard payload contents and the native Save as PNG chooser cannot be observed through `call`: the window automation surface cannot read the OS clipboard, and the native chooser cannot select a destination. The copy facade resolved successfully, and the documented `savePngToFile` export wrote a PNG with a valid signature under the test fixture.

### US-2046: Compare and Git diff — `tests/editors/compare/`

- Compare mode for two grouped text pages: the diff view opens, shows the changes, and closes back to the two
  editors.
- Git diff: on a git repository the test creates inside its fixture folder, a changed file opens in the Git diff
  editor with its revisions, and an edit there behaves as the guide says. If `git` is not available, the test is
  tagged so it is skipped and the item is listed as uncovered.

#### Results

- Tests added in [`compare.test.mjs`](../../integration-test/tests/editors/compare/compare.test.mjs):
  - `compare mode shows grouped text changes and exits back to both editors`
  - `Git Diff shows committed and working revisions and saves edits from the working side`
- `npm run test:ui -- --attach --area editors/compare`: **1 passed, 0 failed, 1 skipped**. The Git Diff test was
  skipped because the `git` requirement needs `--with git`.
- `npm run test:ui -- --attach --area editors/compare --with git`: **2 passed, 0 failed, 0 skipped**.
- App bugs found: **none**.
- Uncovered: **none**. Git was available; opting into its requirement exercised revision display, editing, and saving.

### US-2047: Editor switching — `tests/editors/switching/`

- One file switched between its editors (text, grid, markdown preview, Mermaid, whichever apply to its type) through
  the editor switch the guide describes. The content is preserved and edits made in one editor show in the other.
- The switch choice is kept per page as the guide says.
- A file type with a single editor offers no other switch target.

#### Results

- Tests added in [`switching.test.mjs`](../../integration-test/tests/editors/switching/switching.test.mjs):
  - `JSON content and edits stay in sync between Grid and Text Editor`
  - `Markdown source edits render in Preview and each page keeps its selected editor`
  - `Mermaid source edits render after switching between Text Editor and Mermaid`
  - `plain text files offer no editor switch target besides Text Editor`
- `npm run test:ui -- --attach --area editors/switching`: **4 passed, 0 failed, 0 skipped**.
- App bugs found: **none**.
- Uncovered: **none**. JSON Grid, Markdown Preview, Mermaid, and the single-editor Text page were reachable through the
  call surface; content and edits were observed across switches, and the Markdown page's selected editor remained
  page-specific when another Markdown page was opened.

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-2043 | Tests: text editor (Monaco) | Done |
| US-2044 | Tests: Markdown preview | Done |
| US-2045 | Tests: Mermaid | Done |
| US-2046 | Tests: compare and Git diff | Done |
| US-2047 | Tests: editor switching | Done |

## Concerns

1. **Monaco input.** Typing goes through the editor API or CDP key events. Multi-cursor needs modifier clicks or
   Monaco commands; whatever `call` cannot reach is listed as uncovered.
2. **Rendering is asynchronous.** Markdown and Mermaid render after a delay. Tests wait with `ctx.waitFor` on what
   the page shows, never with a fixed sleep.
3. **Git availability.** The Git diff test needs `git` on PATH. It creates its own repository inside its fixture
   folder and never touches the project repository.
4. **Clipboard and export.** Image copy and export may only be observable through files or the clipboard API; if
   neither is reachable, the item is uncovered.

## Notes

### 2026-11-17
- Created from the roadmap's Phase 4, split in two. This epic is phase 4a; the viewer editors follow in phase 4b.
- All five tasks implemented. Claude's per-task checks fixed test errors, not app bugs:
  - Undo back to the saved text keeps `modified`, by design.
  - Redo is `Ctrl+Shift+Z`, because `Ctrl+Y` is Delete Line.
  - Weak checks were tightened: JSON format, Mermaid re-render after an edit, and a page count that depended on other
    open pages.
  - Menu reads now wait for the menu to render.
- No app bugs were found.
- Epic pass: the `editors` area passed twice in launched mode (30/30, `--with git`), and the full suite passed once
  (124/124, `--with git`). The completion skills have not run yet.
