# US-1619: Smooth the rough edges agents hit when driving Persephone

## Goal

Fix the bugs and close the gaps that an agent hit while driving Persephone through ai-vision/MCP to
set up demo data and record three site videos (2026-10-04), so the same work needs no workarounds.

## Background

An agent recorded the Workspace and Installing boards videos (and the earlier Torrent Viewer video)
by driving Persephone over MCP: `script.execute`, `window.screen.*`, `boards.*`, `pages.*`, plus
`window.screen.recording`. The take scripts and context live in the site repository at
`andriy-viyatyk.github.io/video/fixtures/feature-demos/`, `video/scripts/demo-overlay.js`, and
`video/README.md` (Demo data and the Workspace/Installing boards recipes).

Source map checked for this plan:

- Board identity already has a main-process canonicalizer, `normalizeBoardRoot()` in
  `src/main/board-root-key.ts:10`; trust comparisons/storage are in
  `src/main/board-trust-service.ts:37,227`, renderer registration is
  `src/renderer/api/boards.ts:306`, and pipe ownership checks are
  `src/ipc/main/board-pipe-handlers.ts:13-45`.
- Search reveal is queued by `MonacoEditor.revealLine()` in
  `src/renderer/editors/monaco/MonacoEditor.ts:120` and consumed immediately by
  `MonacoBodyView.handleQueueEvent()` in `src/renderer/editors/monaco/MonacoBodyView.ts:266`.
- Archive panel removal is in `ArchiveEditor.onMainEditorChanged()`;
  `PageModel.detach()` and `_enforceMandatoryOpen()` recompute panels/open state. The empty-sidebar
  cause remains a hypothesis until the required MCP reproduction and state inspection in step 3.
- `BoardInfoEditorModel.register()` in `src/renderer/editors/board-info/BoardInfoEditorModel.ts:682`
  switches folders and host-backed files, but sends host-less sources to properties mode. The
  `+`/Board Info dispatch is handled in `src/renderer/editors/base/editor-switch.ts`.
- `PagesModel.openFile()` in `src/renderer/api/pages/PagesModel.ts:237` passes the input to
  `createLinkData()` without normalizing it; `PageCollectionWrapper.openFile()` delegates unchanged.
- Dialog pending comes from `resolveWithAttention()` in
  `src/renderer/scripting/ai-vision/attention.ts:30-107`. Separately, renderer calls default to a
  30-second bridge timeout in `src/main/mcp/renderer-bridge.ts:10,58`; call routing is in
  `src/main/mcp/tools/call-tools.ts:222-240`.
- Shared automation/actionability and locator resolution are in
  `src/renderer/automation/operations.ts:101-207`. `dragElements()` at lines 731-770 already sends
  trusted CDP press/move/release events and enables `Input.setInterceptDrags`; it is not merely an
  HTML5 drag replay. The observed splitter failure's cause must be established by reproduction.
- Sidebar width is held by `SecondaryViewsModel`, mutated by `PageModel.setSecondaryViewsState()`,
  and persisted by `rememberSecondaryViewsWidth()`; the ai-vision node and types are
  `src/renderer/scripting/ai-vision/page-panels.ts` and
  `src/renderer/api/types/page-panels.d.ts`.
- Explorer expansion is owned by `TreeProviderViewModel` and uikit `TreeModel`; `expandItem()` and
  `toggleItem()` are available on the tree model (`src/renderer/uikit/Tree/TreeModel.ts:677-690`).
  The actual reusable chevron button is made in `src/renderer/uikit/Tree/TreeItemView.ts:280-294`.
- Recording session lifecycle is `src/renderer/api/window-recording.ts:65-247`; header recording
  controls and the MCP indicator are in `src/renderer/ui/app/MainPageView.ts:127-208`.
- Board Info's `installDir` is read-only in `BoardInfoEditorFacade` and `IBoardInfoEditor`; the
  model's picker is `BoardInfoEditorModel.changeInstallDir()` at lines 595-600. The existing API
  precedent is `boards.installPublished(id, { dir })`.

Approved scope is findings 1-13. Finding 14 is out of scope and has a separate backlog entry in
`doc/tasks/backlog.md`.

## Findings

1. Board trust and board-pipe ownership checks disagree on path spelling; forward-slash roots can
   fail ownership checks. See implementation step 1.
2. Search can reveal a match before Monaco's final layout, leaving it under sticky scroll. See step 2.
3. Switching from a directly opened `.docx` through Board Info to a board can leave an empty sidebar.
   The currently suspected Archive-panel explanation is unproven; reproduce and inspect state first.
   See step 3.
4. Registering a published board from a host-less file-backed Board Info page can remain in
   properties mode, contrary to the guide's automatic-switch promise. See step 4.
5. `pages.openFile()` can preserve forward slashes in a Windows Explorer root label. See step 5.
6. `script.execute` may return pending on a renderer dialog, or time out at the 30-second bridge
   while the script continues without a handle. See step 6.
7. App-window automation lacks text locators and direct coordinate clicks. See step 7.
8. Existing `drag()` sends trusted pointer input, but the splitter report has not been reproduced or
   explained. Sidebar width also lacks a setter. See step 8.
9. A tooltip can be hit-tested as an obstruction to a later target. See step 9.
10. Actionability can discard zero-size nodes even with `force`, and reported failures need specific,
    nonempty messages. See step 10.
11. Window recordings include recording controls and the header MCP indicator. See step 11.
12. The Explorer folder chevron has no stable name and the model has no public path expansion API.
    See step 12.
13. Board Info install location is not agent-settable; real user paths must remain visible/copyable.
    See step 13.
14. OUT OF SCOPE: clean demo profiles need an independent data directory. Tracked in
    `doc/tasks/backlog.md`; isolate the single-instance lock, pipe name in
    `src/main/pipe-server.ts`, and MCP port.

## Implementation plan

### Findings 1-5: board and page behavior

1. [x] Reuse the existing main-side `normalizeBoardRoot()` from `src/main/board-root-key.ts` in
   `src/main/board-trust-service.ts`: canonicalize roots before trust storage, and use the helper for
   trusted-root and `getGrantedPermissions()` lookup comparisons. In both ownership checks in
   `src/ipc/main/board-pipe-handlers.ts`, normalize the registered root and request root with that
   same helper before comparing. In `src/renderer/api/boards.ts:306`, normalize the absolute local
   root with renderer `fpResolve()` before `isBoardFolder()` and `requestBoardTrust()`. The helper
   resolves absolute paths, uses forward slashes and lowercases on Windows, so old slash records
   continue to match. Preserve display casing outside identity storage.
2. [x] In `MonacoBodyView.handleQueueEvent()` keep the immediate `revealLineInCenter(line)`. For that
   reveal, subscribe once to `editor.onDidLayoutChange` and reapply on the first layout event. Also
   schedule exactly one `requestAnimationFrame` after mount as a fallback if no layout event has fired
   by then. The reveal may reapply only once and only within 500 ms. Cancel the pending
   re-reveal on user scroll, user cursor movement, disposal, or a newer reveal. For the follow-up,
   call `revealLineNearTop(line)`, measure `.sticky-widget` height under `editor.getDomNode()` (zero when absent), then set
   scroll top to `max(0, editor.getTopForLineNumber(line) - stickyHeight)` so the target begins below
   sticky scroll. Manually confirm in the 24-line example; adjust only if the measured sticky area
   still covers the line.
3. [x] Reproduce first over MCP in this order: open a `.docx` directly → use `+` to open Board Info →
   install/trust a board → switch to the board. Read `pages[id].panels.items`, `.isOpen`, `.width`,
   and panel ownership before/after the switch, and compare them with the rendered sidebar state.
   Identify which state keeps the 320 px area (for example, the page view conditions on `open` rather
   than `hasSidebar`, `_enforceMandatoryOpen()` leaves `open` true, or an obsolete panel contributor
   remains registered). The leading hypothesis is that `ArchiveEditor.onMainEditorChanged()` clears
   its sole panel while `PageModel.detach()` does not close the sidebar; do not implement that
   hypothesis until state inspection confirms it. Fix the observed root cause and preserve pages
   whose remaining panels require an open sidebar.
4. [x] In `BoardInfoEditorModel.register()`, after trust and custom-editor registry refresh, switch a
   file-backed source to `boardEditorId(root)` even when a content host was not transferred. Keep
   folder claim validation and standalone hub/toast Board Info properties mode. The guide promise is
   intended for file/folder editor-switch installation. Update `assets/guides/boards.md` only if a
   documented opener is confirmed to intentionally differ.
5. [x] In `PagesModel.openFile()`, normalize local absolute filesystem paths with `fpResolve()` before
   `createLinkData()`. Keep URL/virtual schemes and archive inner paths unchanged. `PageCollectionWrapper`
   remains a delegate.

### Findings 6-10: script waiting and automation

6. [x] Add a renderer-side pending-run registry for `script.execute` in the ai-vision script node.
   Race both the script promise and the existing dialog-attention signal. When a dialog wins, retain
   the promise and return pending with `{ runId, pendingReason: "dialog" }` plus attention. Also
   race against a 25-second renderer bound, safely below the normal 30-second bridge timeout; if it
   wins, return `{ runId, pendingReason: "running" }` and a clear message to await
   `script.result(runId)`. Do not let `sendToRenderer()`'s 30-second timeout win this path.
   `script.result(runId, { timeoutMs })` waits at most 25 seconds (default and maximum); on timeout
   while execution continues, return pending with the same id and `pendingReason: "running"` so the
   client can poll again. Do not extend the bridge timeout. Keep the invariant explicit in
   `src/main/mcp/tools/call-tools.ts`: renderer bound (25 s) < default bridge timeout (30 s); the
   existing 125-second extension remains only for its declared blocking paths. Update
   `src/renderer/scripting/ai-vision/root.ts` members/`$help`, `attention.ts`/`call.ts`, and
   `call-tools.ts:toCallResult()` so Pending text distinguishes dialog attention from still-running
   execution. Registry results are bounded by count and TTL, deleted after a completed result is
   read, and retained after a result-poll timeout. No `window.d.ts` change: this is the ai-vision
   `script` API.
7. [x] Add `text=` locator resolution in shared `src/renderer/automation/operations.ts`. Semantics:
   `text="words"` is exact and case-sensitive after whitespace normalization; unquoted `text=words`
   is a case-insensitive substring match after trimming and collapsing whitespace. When nested
   visible elements contain the same text, choose the innermost/smallest visible matching element
   (tie-break by DOM depth); preserve `nth` over the resulting visible match list. Because app
   window, web-page, and board facades share `operations.ts`, support the locator on `window.screen.*`,
   `page.editor.*`, and board automation targets, and document all three surfaces.
   Add `window.screen.clickAt({ x, y })` as an explicit trusted coordinate click that bypasses
   actionability. Coordinates are app-window CSS pixels, origin at the renderer viewport's top-left.
   Keep ordinary `click()` actionability unchanged. Update adapter, `window.d.ts`, ai-vision
   descriptors/help, and window/browser/board scripting guides.
8. [x] Diagnose `drag()` before changing its dispatch. Source review shows `dragElements()` already
   dispatches trusted CDP press/move/release and enables `Input.setInterceptDrags`; the old claim that
   it only replays HTML5 drag data is false. In a live MCP check during planning, dragging the
   splitter to `body` failed actionability, while targeting `.pages-container` moved the splitter
   from aria value 351 to 367; the width was restored to 351. This shows the failed attempt used a
   non-actionable destination, but does not prove the cause of the earlier reported failure. First
   replay that exact failure against a real visible destination; record actionability points, event
   delivery, and pointer capture. Fix the shared `dragElements()` path for any confirmed cause while
   preserving HTML5 drag intercept behavior. Add
   `window.screen.dragTo({ from: { x, y }, to: { x, y } })` as coordinates-only sugar over that same
   dispatch path; do not maintain diverging paths. Coordinates are app-window CSS pixels from the
   renderer viewport's top-left. Agents obtain them with `window.screen.evaluate()` and
   `getBoundingClientRect()` (snapshots do not currently include boxes). Add writable
   `page.panels.width`, routed through `PageModel.setSecondaryViewsState({ width })` and persisted
   with `rememberSecondaryViewsWidth()`. Update page/window types, descriptors/help and guides.
9. [x] Extend the shared actionability hit test to ignore tooltip layers created by
   `src/renderer/uikit/Tooltip/attach-tooltip.ts`; do not add a click option and do not ignore
   menus/dialogs or other overlays.
10. [x] Fix selector matching so zero-size elements reach the `force` handling instead of being
    filtered out as invisible first. `force: true` skips the intended size/visibility checks while
    retaining valid locator/coordinate checks. Make every failure identify `not found`, `zero size`,
    `not visible`, `detached`, or `covered by <element description>`, and ensure MCP `isError` never
    has an empty message. Trace the empty-message path through `operations.ts` and
    `call-tools.ts:toCallResult()`.

### Findings 11-13: recording, Explorer, Board Info

11. [x] Add `hideStatusChrome?: boolean` to `window.screen.recording.start()` and recording session
    state. Hide recording controls and the MCP indicator before capture starts; restore their exact
    prior visibility on stop, cancel, recorder error, setup/start error, and page-close cleanup.
    Coordinate through `MainPageView`, not script style mutations. Update the window types, adapter,
    ai-vision descriptor/help and `assets/guides/scripting/api/window.md`.
12. [x] Add stable `data-name="explorer-folder-expand"` to the actual folder chevron button in
    `src/renderer/uikit/Tree/TreeItemView.ts`, scoped/documented for the Explorer tree and following
    `doc/architecture/ui-element-contract.md`. Add `expand(path)` and `collapse(path)` to the Explorer
    panel node. Resolve path to the tree item's `href`; load ancestor children as `revealItem()` does,
    then use `TreeModel.expandItem()`/`toggleItem()` and current expanded state. Update
    `src/renderer/api/types/page-panels.d.ts`, `page-panels.ts`, `PageWrapper.ts` help and
    `assets/guides/scripting/api/page.md`.
13. [x] Add `setInstallDir(dir)` to `BoardInfoEditorModel`, `BoardInfoEditorFacade`, and
    `IBoardInfoEditor`, updating ai-vision members/help and the Board Info scripting guide. Mirror
    `boards.installPublished(id, { dir })`; keep `installDir` readable and retain the native picker.
    Do not redact/replace displayed paths with `%APPDATA%`; users need copyable filesystem paths.

## Implementation constraints

- Item 3's cause and the earlier item 8 drag failure are not yet proven. The live drag check only
  established that `body` is an invalid destination and `.pages-container` works in the current
  build. Reproduce the reported call and gather state/input-path evidence before selecting a fix.
- The current live check showed that a valid visible destination lets existing `drag()` move the
  splitter. Reproduce the earlier failing call before attributing its cause; `dragTo()` remains a
  coordinate-only wrapper over the same shared dispatch path.
- No board-facing bridge contract changes are planned, so `BOARD_BRIDGE_VERSION` does not need a
  bump.
- Finding 14 stays out of scope and is recorded in `doc/tasks/backlog.md`.

## Acceptance Criteria

- Findings 1-13 meet the outcomes in the manual verification plan; item 14 remains backlog-only.
- Board-root identity is canonical at trust storage and pipe ownership checks; legacy slash roots
  still match. Search result lines are visible below sticky scroll. The file-backed Register flow
  switches to the board as documented. The `.docx` sidebar fix is supported by the reproduced state
  cause. Local `pages.openFile()` paths display canonically.
- `script.execute` returns a handle before the bridge timeout for both dialog and long-running cases;
  `script.result` polls within the bridge bound and can return the same pending id repeatedly.
- Text locators have the documented exact/substring/whitespace/nesting behavior across shared
  automation hosts. Coordinate click/drag use documented app viewport CSS pixels. Existing HTML5
  drag behavior remains intact if the common path is fixed.
- Actionability failures are named and nonempty; tooltip layers do not obstruct clicks; force skips
  intended checks. Sidebar width is writable/persistent; recording chrome restores on all terminal
  paths; Explorer expansion is supported; Board Info install location is agent-settable and paths
  stay copyable.

## Manual verification plan

Run by Claude on 2026-10-05 over MCP against the dev build (cold `npm start` included), on the
`C:\Demo` fixtures. Codex's sandbox could not launch the app (`spawn EPERM`).

1. **Pass.** `boards.registerBoard("C:/Demo/us1619-board")` returned a `runId` on the trust dialog;
   after Trust, `script.result` returned `true`, the record stored `C:\Demo\us1619-board`, and
   `boards.openBoard("C:/…")` opened it with no "does not own this board root" rejection.
   `unregisterBoard` with the slash form removed it.
2. **Implemented, not reproducible here.** In an 861 px editor the 24-line file fits, so line 15 is
   visible with or without the fix; the bounded re-reveal after layout is in place.
3. **Pass (after fix).** `.docx` → Archive → Word board left `panels.items: []` with the sidebar
   and its splitter still drawn (cause below). After the fix no sidebar is drawn.
4. **Code review only.** Every catalog board is installed in the test profile; exercising Register
   would mean uninstalling the user's boards. `register()` switches file-backed sources (incl.
   host-less Archive) and keeps properties mode for standalone Board Info.
5. **Pass.** `pages.openFile("C:/Demo/weather-station")` → Explorer root `C:\Demo\weather-station`.
6. **Pass.** A 32 s script returned `{ pending, runId, pendingReason: "running" }` at 25 s;
   `script.result(runId)` returned `done-32`; a second read reports no pending run. The dialog case
   returned `pendingReason: "dialog"` with attention (step 1).
7. **Pass.** `text=README.md` opened the file; `clickAt({x,y})` from `getBoundingClientRect()`
   opened README.md.
8. **Pass.** `dragTo` moved the sidebar splitter; `page.panels.width = 280` resized it and persisted
   `secondary-views.width` (restored to 351).
9. **Pass (after fix).** A `data-type="tooltip"` element covering an Explorer row no longer blocks
   `click("text=package.json")`; the click reached the row.
10. **Pass.** Forced click on the zero-height `app-header-spacer` succeeds; unforced fails with
    "Element has zero size."; absent selector/text fail with "Element not found."
11. **Pass (after fix).** `recording.start({ region: "window", hideStatusChrome: true })` hides the
    controls and MCP indicator for the session and restores them on cancel; no error notification.
12. **Pass (after fix).** `pages[i].panels.explorer.expand("C:/Demo/weather-station/docs")` shows
    the folder's children; `collapse` hides them.
13. **Code review only** (same reason as 4): `setInstallDir(dir)` sets the Board Info install folder.

### Fixes made during verification

- **Trust records stored the comparison key.** `board-trust-service.ts` wrote
  `normalizeBoardRoot()` (lowercase, forward slashes) as the stored `root`, so every trusted board
  was rewritten lowercase on the next trust change and shown that way. Stored roots now use
  `path.resolve()`; comparison still uses the key. The affected `trustedBoards.json` of the test
  profile was restored to real casing (backup kept in the session scratchpad).
- **Every `window.screen` click failed** with "SyntaxError: Unexpected token '.'": in the page-side
  `text=` code a statement ended before a `.sort(...)` continuation line.
- **`hideStatusChrome` never applied:** `prepare()` published it while idle and `setState()` resets
  it for any idle state. The flag is now a field set before capture and cleared on return to idle.
- **Cancel raised "Recording session was not found"** (pre-existing): the recorder's last chunk
  was written after main dropped the session; cancelled sessions now skip chunk writes.
- **Empty sidebar after leaving Archive view:** `PageModel.hasSidebar` stays true once a sidebar
  model exists; `PageContentView.syncSecondary()` now draws no sidebar when no panel is left.
- **Explorer `expand(path)` did nothing:** the folder's own children were never loaded and the path
  was not normalized to the tree's href form (`TreeProviderViewModel.expandPath/collapsePath`).
- **Tooltip click-through:** the hit test skipped the tooltip but the trusted click still landed on
  it (tooltips are `pointer-events: auto`); a covering Persephone tooltip is now made click-through.
  Web-page `role="tooltip"` elements are deliberately not touched.

## Files Changed

| Area | Files |
|---|---|
| Board trust and page behavior | `src/main/board-root-key.ts`, `src/main/board-trust-service.ts`, `src/ipc/main/board-pipe-handlers.ts`, `src/renderer/api/boards.ts`, `src/renderer/api/pages/PagesModel.ts`, `src/renderer/api/pages/PageModel.ts`, `src/renderer/api/pages/IPageHost.ts`, `src/renderer/core/utils/file-path.ts`, `src/renderer/editors/monaco/MonacoBodyView.ts`, `src/renderer/editors/board-info/BoardInfoEditorModel.ts`, `src/renderer/editors/explorer/ExplorerEditorModel.ts`, `src/renderer/editors/explorer/ExplorerSecondaryView.ts` |
| MCP script and automation | `src/renderer/automation/operations.ts`, `src/renderer/api/window-screen.ts`, `src/renderer/api/types/window.d.ts`, `src/renderer/api/types/page-panels.d.ts`, `src/renderer/api/types/browser-editor.d.ts`, `src/renderer/scripting/ai-vision/root.ts`, `src/renderer/scripting/ai-vision/attention.ts`, `src/renderer/scripting/ai-vision/call.ts`, `src/renderer/scripting/ai-vision/page-panels.ts`, `src/renderer/scripting/ai-vision/namespaces/window-screen.ts`, `src/renderer/scripting/ai-vision/browser-automation-members.ts`, `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts`, `src/renderer/scripting/api-wrapper/BoardEditorFacade.ts`, `src/renderer/scripting/api-wrapper/PageWrapper.ts`, `src/main/mcp/tools/call-tools.ts` |
| UI and user/developer docs | `src/renderer/ui/app/MainPageView.ts`, `src/renderer/api/window-recording.ts`, `src/renderer/uikit/Tree/TreeItemView.ts`, `src/renderer/components/tree-provider/TreeProviderViewModel.ts`, `src/renderer/scripting/api-wrapper/BoardInfoEditorFacade.ts`, `src/renderer/api/types/board-info-editor.d.ts`, `assets/editor-types/window.d.ts`, `assets/editor-types/page-panels.d.ts`, `assets/editor-types/board-info-editor.d.ts`, `assets/editor-types/browser-editor.d.ts`, `assets/guides/boards.md`, `assets/guides/agents/boards.md`, `assets/guides/agents/browser.md`, `assets/guides/agents/scripting.md`, `assets/guides/scripting/api/window.md`, `assets/guides/scripting/api/page.md`, `assets/guides/scripting/api/editors.md`, `doc/architecture/ui-element-contract.md`, `doc/active-work.md`, `doc/tasks/backlog.md` |

### Files that need NO changes

- `src/main/pipe-server.ts`, profile-specific single-instance logic and MCP port allocation: finding
  14 is out of scope.
- `src/shared/board-bridge-version.ts`, `src/board-shim.ts`, `src/main/board-bridge.ts`, and
  `src/renderer/editors/board/board-api.d.ts`: no board-facing bridge contract changes are planned.
- `src/main/recording-service.ts`: renderer status chrome does not change recording ownership or IPC.
- Site video fixtures are useful for manual MCP reproduction but are outside this repository/task.
- Unit tests and test harnesses are excluded by project rules.
