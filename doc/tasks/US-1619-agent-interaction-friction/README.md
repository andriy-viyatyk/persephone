# US-1619: Smooth the rough edges agents hit when driving Persephone

## Goal

Fix the bugs and close the gaps that an agent hit while driving Persephone through ai-vision/MCP to
set up demo data and record three site videos (2026-10-04), so the same work needs no workarounds.

## Background

An agent recorded the Workspace and Installing boards videos (and the earlier Torrent Viewer video)
by driving Persephone over MCP: `script.execute`, `window.screen.*`, `boards.*`, `pages.*`, plus
`window.screen.recording`. Every workaround it needed is listed below with what it did instead. The
take scripts that contain those workarounds are in the site repo
(`andriy-viyatyk.github.io/video/fixtures/feature-demos/`, `video/scripts/demo-overlay.js`,
`video/README.md` → "Demo data", "Recipe: Workspace", "Recipe: Installing boards").

**Status of this document:** findings and a proposed plan from the session itself. The detailed
investigation (step 2 of "Creating a new task") still has to be done before implementation: confirm
each cause in the source and fill in the exact file paths and changes.

## Findings

### Bugs (user-visible or API-visible)

1. **Board roots are not normalized.** `boards.registerBoard("C:/Demo/.../Station Dashboard")`
   stores the forward-slash root in `trustedBoards.json`. Opening the board then raises
   "Unhandled promise rejection: The board pipe host does not own this board root" (twice):
   `src/ipc/main/board-pipe-handlers.ts:18` and `:39` compare `getBoardRootForHost(host)` (the
   backslash form) with the stored root by string equality. Agents naturally pass `/` paths.
   Expected: normalize roots on register/trust (and on every lookup), or compare normalized paths.
2. **Search jump hides the match.** Clicking a Search result in a short file (24-line `report.ts`,
   match on line 15) scrolls so line 15 sits under Monaco's sticky-scroll header (line 11 pinned,
   line 16 visible below). The reveal is `editor.revealLineInCenter` in
   `src/renderer/editors/monaco/MonacoBodyView.ts:265`, queued from `MonacoEditor.ts:185`; it
   appears to run before the editor reaches its final height. Calling `revealLine(15)` again after
   layout shows the line correctly.
3. **Empty sidebar after leaving Archive view.** Open a `.docx` directly (not from a workspace): the
   page shows the Archive explorer in its sidebar. Click **+** (Board Info), install and trust a
   board, then pick the board in the editor switch: the page keeps an empty ~320 px sidebar.
4. **Guide vs behaviour after Register.** `assets/guides/boards.md` ("Installing a board — Download,
   then Register") says the file "switches to the new editor automatically" after trust. In practice
   the page stayed on Board Info (properties view) and the user must pick the board in the editor
   switch. Fix the behaviour or the guide.
5. **`pages.openFile` keeps forward slashes** in the Explorer root label (`C:/Demo/weather-station`),
   while the Menu Bar shows `C:\Demo\weather-station`. Normalize like the other entry points.

### Gaps in the agent surface

6. **`script.execute` returns early when a dialog opens.** A script that triggers the trust dialog
   and then clicks **Trust Board** itself gets "Pending: the action is waiting on a dialog" at once;
   the script keeps running with no way to await its result. The agent had to set a window flag and
   poll it. Options: don't return early while the script is still running and the dialog belongs to
   it; or return a handle (`script.result(id)` / `waitForScript`).
7. **No coordinate or text locator on `window.screen`.** `click('body', { position })` times out
   ("not visible"); there is no "click the row whose text is X". Workaround: find the element in a
   script, set a temporary `data-demo-t` attribute, click that selector. Consider a `text=` /
   `:has-text()` locator and a `clickAt({ x, y })` for the app window.
8. **Splitters cannot be dragged.** `drag()` replays HTML5 drag data only, and uikit
   `SplitterView` (`src/renderer/uikit/Splitter/SplitterView.ts`) uses pointer capture, so neither
   `drag()` nor synthetic pointer events move it. There is no API for the sidebar width either
   (`page.panels` has none; `PageModel.rememberSecondaryViewsWidth` and the `secondary-views.width`
   UI preference are internal, and main caches `uiPreferences.json` until restart). Add a
   trusted pointer-drag primitive (`mouseDown/mouseMove/mouseUp` or `dragTo` by coordinates) and/or
   `page.panels.width`.
9. **Hover tooltips block the next click.** After a trusted click the real pointer stays on the
   element; its tooltip covers the next target and the next click fails actionability after 5 s.
   Workaround: hover a neutral spot after each click. Options: a `parkPointer` option on click, or
   ignore tooltip layers in hit-testing.
10. **Actionability edge cases and messages.**
    - `force: true` still fails on a zero-size element (`app-header-spacer` is 0 px tall), with only
      "Element not found or not visible".
    - `hover()` on a visible header element fails while the Menu Bar overlay is open, unless `force`.
    - One failed `window.screen.click` returned `isError: true` with an empty message.
    Make the error say which check failed (zero size, covered by X, detached).
11. **Recording chrome is in the shot.** A window recording includes the recording controls and the
    header MCP indicator, whose count grows with every MCP client session. The agent hid both with
    `style.visibility`. Consider a recording option that hides app status chrome.
12. **Explorer folder chevron is unnamed.** A folder row's name opens Folder View; expanding needs the
    chevron button, which has no `data-name` (only `aria-label="Expand"`). Give the agent a supported
    way to expand/collapse (`explorer.expand(path)` or a named chevron).
13. **Board install location is not agent-settable, and shows the user name.** Board Info's
    `installDir` is read-only to agents (the picker is a native dialog), and the default path
    `C:\Users\<name>\AppData\Roaming\persephone\data\boards` appears in Board Info, the trust dialog
    and Tools & Editors. Videos had to mask it. Options: show `%APPDATA%\…` in the UI, and/or accept
    an install folder from the agent (`boards.installPublished` already takes `opts.dir`; Board Info
    could too).
14. **No separate profile for demos.** Recording against clean data meant renaming the user's
    `data`, `Partitions` and `Local Storage` folders while Persephone was closed
    (`video/scripts/demo-data.ps1`). A `--data-dir` (or `--profile`) launch option would let a demo
    instance run beside the user's; it needs its own single-instance lock, pipe name
    (`src/main/pipe-server.ts`) and MCP port.

### Related, out of scope here

- The agent pointer for demo recordings is the backlog entry "Demo recording — the parts deferred
  from US-1618". The site videos use `video/scripts/demo-overlay.js` meanwhile.

## Implementation plan (draft — refine during investigation)

- [ ] Investigate and confirm each finding; record the exact source locations here.
- [ ] Bugs 1–5: fix, each with a manual repro check through MCP.
- [ ] 6: design the dialog/early-return behaviour for `script.execute` (decision needed, see below).
- [ ] 7–10, 12: extend the `window.screen` automation surface and its error messages; update
      `window.d.ts`, the ai-vision namespace help and `assets/guides/scripting/api/window.md`.
- [ ] 11: recording option to hide status chrome.
- [ ] 13: path display and install-folder option.
- [ ] 14: decide whether the `--data-dir` profile belongs in this task or its own.
- [ ] Re-run the site's Workspace and Installing boards takes without the workarounds.

## Concerns / Open questions

- Scope: 14 items is large. Split into "bugs" (1–5) and "agent surface" (6–14) if the investigation
  shows the second half needs design work.
- 6: changing when `script.execute` returns affects every MCP client; a separate await handle may be
  safer than changing the default.
- 7/8: a coordinate click bypasses actionability by nature; keep it explicit (`clickAt`) so normal
  clicks stay safe.
- 13: showing `%APPDATA%` instead of the real path may confuse users who copy the path.

## Acceptance criteria

- Registering a board with a `/` root works and opens without errors; the stored root is normalized.
- A Search result in a short file shows the matched line below the sticky header.
- No empty sidebar remains after switching a directly opened `.docx` to a board editor.
- The boards guide matches what happens after Register.
- An agent can do the two site takes without temporary attributes, pointer parking, flag polling,
  hand-hidden chrome or preference-file edits (or each remaining workaround is a documented decision).
