# EPIC-182: UI test coverage, phase 2 — shell: pages, tabs, menus, dialogs

## Status

**Status:** Completed 2026-11-16
**Created:** 2026-11-16

## Overview

Phase 2 of the [UI test coverage roadmap](../reviews/ui-test-roadmap.md). It retests the application shell (the tab
strip, grouping and compare, the menu bar and header, the dialog views, popup and context menus, global shortcuts)
by writing scripted tests under `integration-test/tests/shell/`. The deliverable is the tests plus the bugs they
found. The runner needs no new features; EPIC-181 built everything this phase uses.

## Goals

- Each shell module below has tests for every behavior on its checklist that `call` can reach. The rest is listed
  as uncovered, with the reason.
- App bugs found are fixed by Claude, each with a `whats-new.md` line.
- Stale guide text found along the way (as `encryption.md` was in EPIC-181) is fixed.

## Non-goals

- Editor content behavior (Phase 4/5), the sidebar and Explorer (Phase 3), the browser (Phase 6), board internals
  (Phase 7). A shell test may open such a page only as a tab to act on.
- Dialogs whose real flow belongs to a later phase (commit → git, create board / board-vars storage / trust board →
  boards, register toolset / namespace collision / library setup → tools). Here each is only **opened, read, and
  cancelled or answered with its default**; the full flow is tested in its own phase.

## Working model

Same as [EPIC-181](EPIC-181.md#working-model), decided there:

- **Codex (Luna) writes, runs and triages** each task's tests. The checklist in this epic is the plan; there is no
  separate task document. Codex reads the area's guide and source, explores the call tree against an
  `npm run test:ui -- --open` instance Claude starts, and runs `npm run test:ui -- --attach --area shell/<module>`.
- **App bugs:** Codex does not fix them and never bends a test to pass. It leaves the test failing and reports steps,
  expected, actual and the failing test in the task's Results block. Claude investigates and fixes every one.
- **Claude per task:** reads the new tests (real assertions, no fixed sleeps, nothing that passes without checking),
  sends corrections to the same Codex session, fixes the reported bugs, reruns the tests.
- **Claude per epic:** runs the whole `shell` area in launched mode twice, plus the full suite once, and fixes
  anything still failing.
- Test files go to `integration-test/tests/shell/<module>/`. The existing
  [`shell/dialogs/rename.test.mjs`](../../integration-test/tests/shell/dialogs/rename.test.mjs) stays and the dialogs
  module grows around it.

## Area checklists

Guides to read first: [`screens/tabs.md`](../../assets/guides/screens/tabs.md),
[`screens/header.md`](../../assets/guides/screens/header.md),
[`screens/menu-bar.md`](../../assets/guides/screens/menu-bar.md),
[`screens/dialogs.md`](../../assets/guides/screens/dialogs.md),
[`tabs-and-navigation/`](../../assets/guides/tabs-and-navigation/index.md),
[`shortcuts.md`](../../assets/guides/shortcuts.md).

### US-2033: Tabs — `tests/shell/tabs/`

- Open several pages; close one; close others; close to the right (whatever the tab menu offers).
- Reorder: move a tab; the order reads back from `pages.all` and the tab strip.
- Pin left and right; pinned tabs stay on their side; unpin.
- Duplicate a page: same editor and content, a new id.
- Rename a file page from the tab (the rename dialog accepts the new name; the file on disk is renamed).
- Dirty marker: an edit shows it on the tab; save clears it.
- Close a modified page: the Unsaved Changes dialog — Save, Don't Save and Cancel each do what they say.
- The right tab strip (if it shows pages in the current layout) and the editor-categories popover open and list
  their entries.
- Active tab: showing a page makes it active; closing the active one activates a neighbor.

#### Results

- Tests added in [`tabs.test.mjs`](../../integration-test/tests/shell/tabs/tabs.test.mjs):
  - `opening, closing, and showing pages keeps the active tab on a neighbor`
  - `tab menu closes tabs to the right and closes other unpinned tabs`
  - `moving a tab updates pages.all and the rendered tab strip order`
  - `left and right pins stay in their strips and the right page opens in a popover`
  - `duplicating a page keeps its editor and content with a fresh id`
  - `renaming from the tab dialog changes the file and page title`
  - `editing marks the tab modified and saving clears the marker`
  - `modified pages honor Save, Don't Save, and Cancel when closing`
  - `right tab strip and editor categories popover list their entries`
- `npm run test:ui -- --attach --area shell/tabs` run 1: **9 passed, 0 failed, 0 skipped**.
- `npm run test:ui -- --attach --area shell/tabs` run 2 (immediately after run 1): **9 passed, 0 failed, 0 skipped**. The attached instance returned to its single `untitled` page with no test pages or pins left open.
- App bugs found:
  - **Fixed by Claude.** Open a text page and choose **Duplicate Tab** from its tab menu. Expected a fresh-id page with the same title, Monaco editor, and content. Actual before the fix: the new page was titled `Empty`, had no editor, and had empty content. Failing test: `duplicating a page keeps its editor and content with a fresh id`; it passes in both runs after the fix.
- Uncovered: **none**.

- Claude check (2026-11-16): **app bug fixed** — Duplicate Tab opened an editor-less "Empty" page. `duplicatePage` gave the editor a fresh id but left the text host's old id in its descriptor; adopting the host copied the old id back onto the editor, so the main-editor id no longer matched (and both pages would have shared one cache). The host now gets the same fresh id and its own copy of the cache files (`fs.copyCacheFiles`), after the source flushes its state. The right-pinned popover "bug" was a test bug (`null` vs `undefined`, an immediate read of a missing `popoverPage.id`), as were the unscoped editor click and a leftover right-pinned page. Later the shared `openTabMenu` helper was narrowed to the main strip and could not reach a right chip; Claude scoped it to the tab element in either strip.

### US-2034: Grouping and compare — `tests/shell/grouping/`

- Group two pages side by side; both read as grouped and partners of each other.
- Ungroup; swap sides.
- Grouping a third page replaces the partner the way the guide says.
- Compare mode between two text pages opens and closes, and leaves both pages intact.
- Closing one page of a group leaves the other ungrouped and usable.

#### Results

- Tests added in [`grouping.test.mjs`](../../integration-test/tests/shell/grouping/grouping.test.mjs):
  - `grouped pages can be ungrouped and regrouped with their sides swapped`
  - `Ctrl-clicking a third page replaces the active page's grouped partner`
  - `compare mode opens and closes without changing either text page`
  - `closing one grouped page leaves its partner open, ungrouped, and readable`
- `npm run test:ui -- --attach --area shell/grouping`: **4 passed, 0 failed, 0 skipped**.
- App bugs found: **none**.
- Uncovered: **none**; each checklist item was reached and observed through the live call surface.

- Claude check (2026-11-16): tests read sound; a side swap is a regroup in reverse order (the app has no swap command), checked through the compare pair's sides. No app bug.

### US-2035: Menu bar, header, folders — `tests/shell/menu-bar/`

- Menu bar opens; each section the guide lists is present.
- Folder bookmarks: add a folder (from `work/`), it appears, opening it works, remove it.
- Header quick-settings popover opens and a setting changed there reads back from `app.settings`.
- Status indicators the header shows on a seeded profile are present (no network, mic or Tor required).
- Global mute button toggles and reads back.

#### Results

- Tests added in [`menu-bar.test.mjs`](../../integration-test/tests/shell/menu-bar/menu-bar.test.mjs):
  - `Menu Bar opens with each built-in section from the guide`
  - `a work folder bookmark appears, opens its contents, and can be removed`
  - `header quick settings change a service switch and persist it to settings`
  - `seeded header status indicators include quick settings and MCP`
- `npm run test:ui -- --attach --area shell/menu-bar` run 1: **4 passed, 0 failed, 0 skipped**.
- `npm run test:ui -- --attach --area shell/menu-bar` run 2 (immediately after run 1): **4 passed, 0 failed, 0 skipped**. Cleanup left no user-folder bookmarks, the Menu Bar closed, and the quick-settings change restored.
- App bugs found: **none**.
- Uncovered: the Add Folder button's native directory picker cannot select a folder through `call`. The bookmark test seeds the `work/` folder through the exposed `menuFolders.add` API, then verifies its rendered category, contents, and UI removal.
- Uncovered: global mute activation/toggle. The seeded profile has no active audio mute lease, and the call tree exposes only the release action; creating a lease requires a trusted board using `audio@1`, so the header control cannot be activated through this task's safe shell call path.

- Claude check (2026-11-16): tests read sound; the mute and folder-picker gaps are real (no audio lease on a seeded profile; native picker). No app bug.

### US-2036: Dialogs — `tests/shell/dialogs/`

- Confirmation, input, text and password dialogs (opened from a script or the call tree): each answered, each
  cancelled, Enter submits and Escape cancels, the answer reaches the caller.
- Open URL dialog: a fixture-server URL opens; cancel opens nothing.
- Tor info dialog opens and closes (no Tor required).
- Commit, create board, create board-vars storage, library setup, namespace collision, register toolset and trust
  board: each opened from its normal entry point where `call` can reach it, title and fields read, cancelled, with
  no side effect left behind. Record any that cannot be opened without a later phase's setup as uncovered.
- Only one dialog answers at a time; a second queued dialog becomes `dialogs[0]` after the first closes (if the
  app queues them).

#### Results

- Tests added in [`dialogs.test.mjs`](../../integration-test/tests/shell/dialogs/dialogs.test.mjs):
  - `confirmation dialogs return the chosen label and Escape cancels`
  - `input dialog returns edited text and Enter submits while Escape cancels`
  - `password dialogs return a supplied secret and cancellation returns null`
  - `text dialogs return their content and Escape cancels`
  - `a second simultaneous dialog moves to dialogs zero after the first closes`
- Tests added in [`entrypoints.test.mjs`](../../integration-test/tests/shell/dialogs/entrypoints.test.mjs):
  - `Open URL opens a fixture-server URL and Cancel opens no page`
- Tests added in [`later.test.mjs`](../../integration-test/tests/shell/dialogs/later.test.mjs):
  - `toolset registration opens with its proposed tools and Cancel leaves it unregistered`
  - `Script Library folder opens setup and Cancel leaves it unconfigured`
  - `board variables storage dialog opens from first use and can be cancelled`
  - `New board opens in its fixture workspace and Cancel creates nothing`
  - `opening a fixture board shows Trust Board and Cancel leaves it untrusted`
- `npm run test:ui -- --attach --area shell/dialogs` run 1: **12 passed, 0 failed, 0 skipped**.
- `npm run test:ui -- --attach --area shell/dialogs` run 2: **12 passed, 0 failed, 0 skipped**. The existing rename test is included in both area totals.
- App bugs found: **none**.
- Uncovered: Tor info dialog. The seeded profile has no `tor.exe-path`; `pages.showBrowserPage({ tor: true })` refuses before opening a Tor page, and the browser facade exposes no call to open the info dialog without one.
- Uncovered: Commit dialog. The seed has no Git repository, and the call surface has no safe way to initialize and stage a fixture repository for the normal Git Changes commit action.
- Uncovered: Namespace collision. The collision check follows the Trust Board prompt; reaching it requires accepting that prompt, which this task forbids.

- Claude check (2026-11-16): tests read sound; setup stays under `ctx.fixture`, trust is never accepted, changed settings are restored. No app bug.

### US-2037: Popup and context menus — `tests/shell/menus/`

- The tab context menu opens and lists its items; one harmless item runs (e.g. copy path) and its effect reads back.
- The page menu opens and lists its items.
- Link menus: a link in a markdown page shows its menu; one item runs.
- Escape and a click outside close a menu.

#### Results

- Tests added in [`menus.test.mjs`](../../integration-test/tests/shell/menus/menus.test.mjs):
  - `tab context menu lists its actions and Save writes the changed fixture`
  - `Browser page menu opens and lists its page actions`
  - `Markdown link context menu offers link actions and Copy Link copies its href`
  - `Escape and a click outside dismiss the tab context menu`
- `npm run test:ui -- --attach --area shell/menus` run 1: **4 passed, 0 failed, 0 skipped**.
- `npm run test:ui -- --attach --area shell/menus` run 2 (immediately after run 1): **4 passed, 0 failed, 0 skipped**. Cleanup left only the original `untitled` page, no open menus, and no US-2037 fixture directory.
- App bugs found: **none**.
- Uncovered: **none**; all four checklist items were reached and observed through the call surface.

- Claude check (2026-11-16): tests read sound; no network (fixture server, `example.invalid`). Note: the Copy Link test writes the OS clipboard. No app bug.

### US-2038: Keyboard shortcuts — `tests/shell/shortcuts/`

- The global shortcuts from `shortcuts.md` the call tree can send: `Ctrl+N`, `Ctrl+W`, `Ctrl+Tab` /
  `Ctrl+Shift+Tab`, `Ctrl+S`, zoom in/out/reset, next/previous theme, `F1`, `F5`, `Alt+Left` / `Alt+Right`.
- Each asserts its effect (page count, active page, saved file, zoom factor, theme id, opened guide), not just that
  the key was sent.
- `Ctrl+Shift+N` (new window), `Ctrl+O` and `Ctrl+Shift+S` (native picker) and `F12` (DevTools) are recorded as
  uncovered unless a safe check exists.

#### Results

- Tests added in [`shortcuts.test.mjs`](../../integration-test/tests/shell/shortcuts/shortcuts.test.mjs):
  - `Ctrl+N creates a page and Ctrl+W closes that page`
  - `Ctrl+Tab moves to the next page`
  - `Ctrl+Shift+Tab moves to the previous page`
  - `Ctrl+S saves the active text page to its file`
  - `Ctrl+plus zooms the window in`
  - `Ctrl+- zooms the window out`
  - `Ctrl+0 resets the window zoom`
  - `theme shortcuts select the next theme and return to the original theme`
  - `F1 opens the active text editor guide`
  - `F5 runs the active JavaScript page`
  - `Alt+Left and Alt+Right navigate the active page history`
- `npm run test:ui -- --attach --area shell/shortcuts` run 1: **11 passed, 0 failed, 0 skipped**.
- `npm run test:ui -- --attach --area shell/shortcuts` run 2: **11 passed, 0 failed, 0 skipped**. After both runs, cleanup left one unmodified `untitled` page, one window, the original zoom level (0.5), the original `persephone` theme, and no US-2038 fixture folder.
- App bug found and fixed by Claude: with two fixture-backed pages open and the first active, `Ctrl+Tab` should activate the next page in visible tab order; it previously activated the seed page instead. Failing test before the fix: `Ctrl+Tab moves to the next page`. Both `Ctrl+Tab` tests now pass unchanged.
- Zoom shortcut note (not an app bug): the app handles `Ctrl+=`, `Ctrl+-`, and `Ctrl+0` in the main process `before-input-event`; `window.screen.pressKey` dispatches through CDP and does not raise that event. The three zoom tests use `pressNativeShortcut` in `tests/helpers/shell-helpers.mjs`, which sends native `webContents.sendInputEvent` keyDown/keyUp to the visible non-board, non-DevTools window that owns the test instance, and assert the zoom level changes.
- App bugs found in the two current attach runs: **none**.
- Uncovered:
  - `Ctrl+Shift+N`: opens another application window; no safe way to observe and close it was verified through the attached call surface.
  - `Ctrl+O` and `Ctrl+Shift+S`: open native file pickers; no safe, observable selection and cancellation path was verified.
  - `F12`: opens DevTools; no safe way to observe and close it was verified.

- Claude check (2026-11-16): tests read sound. **App bug fixed** — `Ctrl+Tab` / `Ctrl+Shift+Tab` walked the activation order (`state.ordered`, active page last) instead of the tab strip, a regression from the pages refactor; `PagesNavigationModel` now steps through `state.pages` minus right-pinned pages. Zoom was a harness gap, not a bug: the zoom keys are handled in the main process's `before-input-event`, which CDP key events never reach; the tests now send native input (`pressNativeShortcut`). **Epic pass:** `shell` area 44/44 launched, full suite 87/87 twice (~200 s each).

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-2033 | Tests: tabs | Done |
| US-2034 | Tests: grouping and compare | Done |
| US-2035 | Tests: menu bar, header, folders | Done |
| US-2036 | Tests: dialogs | Done |
| US-2037 | Tests: popup and context menus | Done |
| US-2038 | Tests: keyboard shortcuts | Done |

## Concerns

1. **Mouse-only UI.** Drag-reorder, hover menus and the popover may have no call path. Codex uses the object model
   or `window.screen` actions where they exist and records the rest as uncovered rather than faking a DOM event the
   user cannot produce.
2. **Dialogs owned by later phases.** Opening the commit or trust-board dialog may need a repo or a board. Those get
   the smallest setup that opens them, or are deferred to their phase and listed as uncovered.
3. **Shortcut delivery.** If `call` sends keys to a focused element rather than the window, a global shortcut may be
   swallowed by Monaco. The test focuses a neutral element first and says so; a shortcut that works for the user but
   not through `call` is a harness gap, not an app bug.

## Notes

### 2026-11-16
- Created from the roadmap's Phase 2.
