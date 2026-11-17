# EPIC-183: UI test coverage, phase 3 — page sidebar and Explorer

## Status

**Status:** Completed 2026-11-17
**Created:** 2026-11-16

## Overview

Phase 3 of the [UI test coverage roadmap](../reviews/ui-test-roadmap.md). It tests the page sidebar: the Explorer
panel and its file operations, the Search panel, the other sidebar panels, Explorer watching of outside changes, and
archive browsing. The tests go under `integration-test/tests/sidebar/`. The deliverable is the tests plus the bugs
they found. The runner needs no new features.

## Goals

- Each sidebar module below has tests for every behavior on its checklist that `call` can reach. Whatever `call`
  cannot reach is listed as uncovered, with the reason.
- Claude fixes each app bug the tests find and adds a `whats-new.md` line for it.
- Stale guide text found along the way is fixed.

## Non-goals

- Editor content behavior (Phase 4/5), board internals (Phase 7), and the Git panel (Phase 5, optional feature). A
  sidebar test may open such a page only to check that the panel opened it.
- The Boards and Clipboard panels beyond "opens and lists its entries". Their full flows belong to Phases 7 and 5.

## Working model

Same as [EPIC-181](EPIC-181.md#working-model) and [EPIC-182](EPIC-182.md#working-model):

- **Codex (Luna) writes, runs and triages** each task's tests. This epic's checklist is the plan, so there is no
  separate task document. Codex reads the area's guide and source and explores the call tree against an
  `npm run test:ui -- --open` instance that Claude starts. It runs the tests with
  `npm run test:ui -- --attach --area sidebar/<module>`.
- **App bugs:** Codex never fixes them and never bends a test to pass. It leaves the test failing and reports steps,
  expected, actual and the failing test in the task's Results block. Claude investigates and fixes every one.
- **Claude per task:** reads the new tests and checks for real assertions, no fixed sleeps, and nothing that passes
  without checking. Sends corrections to the same Codex session, fixes the reported bugs, and reruns the tests.
- **Claude per epic:** runs the whole `sidebar` area twice in launched mode, then the full suite once, and fixes
  anything still failing.
- Every test works only inside its own folder under `ctx.fixture(...)`. No test browses, creates or deletes outside
  that folder. Shared helpers go to `integration-test/tests/helpers/sidebar-helpers.mjs`.

## Area checklists

Read these guides first:

- [`screens/sidebar.md`](../../assets/guides/screens/sidebar.md)
- [`tabs-and-navigation/file-explorer-and-panels.md`](../../assets/guides/tabs-and-navigation/file-explorer-and-panels.md)
- [`tabs-and-navigation/grouping-session-and-watching.md`](../../assets/guides/tabs-and-navigation/grouping-session-and-watching.md)
- [`tabs-and-navigation/menu-bar.md`](../../assets/guides/tabs-and-navigation/menu-bar.md)

### US-2039: Explorer panel — `tests/sidebar/explorer/`

- Open the Explorer on a fixture folder. The tree lists its files and subfolders.
- Expand and collapse a folder; its children appear and disappear.
- Open a file from the tree. It opens as a page, or the active page navigates to it, whichever the guide says.
- Create a file and a folder from the tree. Each appears in the tree and exists on disk.
- Rename a file and a folder. The tree and the disk both show the new name, and an open page follows the rename if
  the guide says it does.
- Delete a file and a folder. The confirmation is answered, and the item is gone from the tree and from disk.
- Copy and move through the context menu or clipboard actions, whichever the panel offers. Covers drag-drop only if
  `call` can drive it; otherwise it is listed as uncovered.
- Reveal the active file: the tree expands to the file and selects it.

#### Results

- Tests added in [`explorer.test.mjs`](../../integration-test/tests/sidebar/explorer/explorer.test.mjs):
  - `Explorer lists fixture entries, expands folders, navigates in place, and reveals the active file`
  - `Explorer context menu creates, renames, deletes, copies, and moves fixture entries`
  - `dragging an Explorer file row fails safely without moving the file or wedging the app`
- `npm run test:ui -- --attach --area sidebar/explorer`, run twice consecutively: **3 passed, 0 failed, 0 skipped**
  on each run.
- App bugs found: **none**. The earlier folder-delete `EPERM` was not an app bug: the Vite dev server watcher held
  an open handle under `integration-test/`; Claude fixed it by excluding that folder from Vite watching.
- Drag hang: **fixed by Claude**. The new regression test calls `window.screen.drag` with Explorer row refs, expects
  `drag cannot perform HTML5 drag-and-drop in the app window`, then verifies the source file remains on disk and in
  the tree and `pages.all` still responds.
- Uncovered: drag-drop between folders remains unsupported; the app window has no HTML5 drag path for synthetic
  input. The regression test verifies the drag is safely rejected, not that a move or copy drop succeeds.

- Delete-key follow-up: a fresh-instance probe showed that clicking an Explorer row and sending an untargeted
  `Delete` key opens the expected confirmation without modifying the open editor. The test now waits for tree focus
  after selecting the row and then sends the key without a target click; this is treated as harness timing, not an
  app bug. `closePages` now delegates to `closeOwnedPages` so an unsaved page is dismissed with “Don't Save”.
- The requested attach run after these changes reported **0 passed, 3 failed** because the manual probe workspace
  was still open, leaving two `[data-type="tree-provider-view"]` roots and making row snapshots ambiguous. The probe
  page has since been closed. This run does not validate the updated tests; it was not repeated per the one-run limit.

- Claude check (2026-11-17): **app bug fixed.** `window.screen.drag` on an Explorer file row froze the
  instance. The row's `dragstart` hands the drag to `webContents.startDrag` (drag-out to Windows
  Explorer), and that native drag loop blocks the main process, MCP included, until a real mouse
  button is released. In the app window, automation now cancels the `dragstart` it causes and
  throws a clear error (`guardAppWindowDragStart` in `automation/mouse.ts`). The Tree and the OS-drag
  handoff no longer act on a cancelled `dragstart`. Drag-drop between folders stays uncovered: the app
  window has no HTML5 drag path for synthetic input. **Not an app bug:** the folder-delete EPERM. The
  Vite dev server's watcher (`scripts/dev.mjs`) held an open handle on every folder under
  `integration-test/`, so a renamed and then deleted fixture folder stayed "delete pending" until the
  dev server exited. `vite.renderer.config.ts` now ignores `integration-test/**`. After that, the area
  passed twice in launched mode (2/2), with a clean fixture reset.

### US-2040: Search panel — `tests/sidebar/search/`

- Search the fixture folder by file name. The expected files are listed, and files that do not match are left out.
- Search by content. A file containing the text is listed, along with its matching line if the panel shows lines.
- Open a result. The file opens, at the matching line if the guide says so.
- Clear the search, or search with no matches. The empty state shows.

#### Results

- Tests added in [`search.test.mjs`](../../integration-test/tests/sidebar/search/search.test.mjs):
  - `Explorer name search filters entries and restores expanded folders when cleared`
  - `Search in Folder limits content results to the selected folder`
  - `content search lists matching files and lines and opens a result at its matching line`
  - `content search shows the empty state when the fixture has no matches`
  - `content search Include and Exclude globs narrow matching files`
- `npm run test:ui -- --attach --area sidebar/search`, run twice: **5 passed, 0 failed, 0 skipped** on each run.
- App bugs found: **none**.
- Uncovered: **none**. Filename filtering with restored folder expansion, folder-scoped content search, Include/Exclude globs, matching lines and result navigation, and the no-results empty state were reachable through the call surface.

### US-2041: Other panels — `tests/sidebar/panels/`

- Open-tabs list: lists the open pages; clicking an entry shows that page; closing from the list closes it.
- Recent-files list: a file opened and closed shows up in the list; opening it from the list works.
- Script-library panel: a library script under the test's fixture folder is listed and runs, or opens, as the guide
  says. If the library path is a setting, restore it.
- Tools & Editors panel: lists its entries; opening one opens the matching page.
- Boards and Clipboard panels: each opens and shows its list or empty state.
- Sidebar frame: switching panels and closing the sidebar behave as the guide says.

#### Results

- Tests added in [`other-panels.test.mjs`](../../integration-test/tests/sidebar/panels/other-panels.test.mjs):
  - `Open Tabs lists open pages and selecting an entry activates that page`
  - `Recent Files lists a closed fixture file and opens it from the list`
  - `Script Library lists and opens a script from its configured fixture folder`
  - `Tools & Editors lists editors and opens the selected editor`
  - `Boards and Clipboard entries open their panels with list or empty state`
  - `Menu Bar switches folders and Escape closes the sidebar`
- `npm run test:ui -- --attach --area sidebar/panels`: **6 passed, 0 failed, 0 skipped**.
- App bugs found: **none**.
- Uncovered: closing a page from the Open Tabs list. The guide documents clicking an entry to switch pages, and the
  rendered list rows expose only selection; `OpenTabsListView` supplies no close action or context menu. Open Tabs
  listing and activation are covered.

- Claude check (2026-11-17): **app bug fixed.** In the epic's launched pass, the Open Tabs list showed only `untitled`
  after two pages were added. `OpenTabsListView` changed its one `listProps` object in place and passed it back to
  `ListBoxView.update()`. ListBox finds changes by comparing the previous props object with the next one, so it saw
  none and kept its first rows. It passed under `--attach` only because the list happened to be built after the pages
  existed. The view now passes a new props object on each update. Codex's uncovered item checks out:
  `OpenTabsListView` has no close action.

### US-2042: Watching and archives — `tests/sidebar/watching/`

- Outside changes, made through `fs.write` or `fs` delete calls: a created file appears in an expanded Explorer
  folder, a deleted file disappears, and a renamed file shows its new name. No refresh by hand.
- An open page whose file changes outside reflects the change as the guide describes. Skip this if EPIC-181
  `core/files` already covers it; say so in the Results block.
- Archive browsing: a zip fixture built by the test opens as a folder in the Explorer. Its entries are listed, and
  opening an entry shows its content.

#### Results

- Tests added in [`watching.test.mjs`](../../integration-test/tests/sidebar/watching/watching.test.mjs):
  - `Explorer refreshes an expanded folder after outside create, delete, and rename`
  - `ZIP archive opens as a browsable tree and an entry opens with its content`
- `npm run test:ui -- --attach --area sidebar/watching`: **2 passed, 0 failed, 0 skipped**.
- App bugs found: **none**. An initial ambiguous archive-entry selector was a test issue; the test now scopes the
  accessibility snapshot to the archive tree and clicks its returned ref.
- Open-page external changes: covered by EPIC-181 `core/files`, test `external file changes reload an unmodified page`;
  skipped here as directed.
- Uncovered: **none**. Outside create/delete/rename updates and ZIP listing/entry navigation were reachable through
  the call surface.

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-2039 | Tests: Explorer panel | Done |
| US-2040 | Tests: Search panel | Done |
| US-2041 | Tests: other sidebar panels | Done |
| US-2042 | Tests: watching and archives | Done |

## Concerns

1. **Mouse-only tree actions.** Drag-drop, hover and inline rename may have no path through `call`. Codex uses the
   tree's `elements`, context menus and `window.screen` actions where they exist. The rest goes on the uncovered
   list; Codex does not fake a DOM event that a user cannot produce.
2. **Watch timing.** Watcher events are asynchronous and may be debounced. Tests wait with `ctx.waitFor` on what
   the tree shows, never with a fixed sleep.
3. **Fixture isolation.** File operations run against real disk. Each test creates its own folder and removes only
   what it created, and the Explorer root is always a folder the test owns.
4. **Zip fixtures.** The test builds the zip itself, through the app or a small writer in the helper, rather than
   committing a binary.

## Notes

### 2026-11-16
- Created from the roadmap's Phase 3. The roadmap's "Watching" and "Archive browsing" bullets are merged into one
  task, US-2042.

### 2026-11-17
- All four tasks implemented. Epic pass: the `sidebar` area passed twice in launched mode (16/16), and the full suite
  passed once (103/103). Claude fixed two app bugs (the app-window drag freeze and the stale Open Tabs list) and one
  dev-tooling issue (the Vite watcher held handles under `integration-test/`). The launched pass also exposed
  cold-start waits that `--attach` runs hide. Codex fixed those in the tests. The completion skills have not run yet.
