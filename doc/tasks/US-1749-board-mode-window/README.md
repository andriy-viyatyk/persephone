# US-1749: Board-mode window: `--board` launch, routing, lifetime, bounds

Epic: [EPIC-136: Boards as standalone apps](../../epics/EPIC-136.md)

## Goal

Launch a board root with `--board <path>` into one dedicated board-mode Persephone window, focus that window on repeated launches, and keep its pages and lifetime separate from the normal persisted window session. Board pages remain ordinary Persephone pages; board-mode chrome and tab restrictions belong to US-1750.

## Background

### Launch and dispatch

- `src/shared/launch-input.ts` currently defines only `file`, `url`, and `diff` launch inputs.
- `src/main/utils.ts::launchOperands` drops every argument beginning with `--`; `parseLaunchArguments` recognizes `diff` only as the first operand, then treats remaining operands as URLs or paths. It has no `--board` branch.
- `src/ipc/main/window-handlers.ts` parses cold-start `process.argv` once into a module-level `startupInputs` list. `getStartupInputs()` drains that list for the renderer.
- `src/main/main-setup.ts` handles `second-instance` by bringing an existing window forward and dispatching parsed command-line inputs.
- `src/main/pipe-server.ts::handleMessage` accepts `OPEN`, `SHOW`, and `DIFF` messages. `OPEN` passes one argument through `parseLaunchArguments`; it has no board command.
- `launcher/src/main.rs::main` formats every non-diff argument as `OPEN <resolved-arg>`, both for the running-instance pipe and when it spawns `persephone.exe`. Thus `--board` is not forwarded as a board launch: the running-instance path sends it as a path, and the cold path passes it to Electron where `launchOperands` removes it. The launcher needs an explicit board protocol/argument path.

### Window registry, persistence, and lifetime

- `src/main/open-windows.ts::OpenWindows` owns the `windows` list. `mainWindow` returns the first open entry; `saveState()` writes every entry index to `openWindows.json`; `restoreState()` loads that list and creates the first normal window. `handleOpenFile`, `handleOpenDiff`, and `handleOpenUrl` target `mainWindow`. `movePageToWindow` resolves both drag endpoints by window index in this list.
- `src/main/window-states.ts::WindowStates` stores page state in per-index files named from `openFilesNameTemplate`. Renderer page persistence in `src/renderer/api/pages/PagesPersistenceModel.ts` restores in `init()` and writes through `saveState()` / `saveStateDebounced`; `src/renderer/api/internal/save-window-state.ts` and `RendererEventsService.handleBeforeQuit` save pages on shutdown.
- `src/main/main-setup.ts` calls `openWindows.restoreState()` unconditionally on `ready`; it quits on `window-all-closed` outside macOS. `src/main/open-window.ts::OpenWindow` always installs the ordinary close handshake and close-to-tray behavior. `OpenWindows.setCanQuit` hides the last registered window when `canQuit` is false. A board window must close itself after its board-mode modified-page confirmation, never become the tray-resident normal window, and must not be counted as the last normal window.
- Ordinary bounds are shared in electron-store under `windowState`; `OpenWindow.saveWindowSize()` writes that value on resize/move. Board bounds need a separate per-root record. `src/main/open-window.ts` constructs `BrowserWindow`; Electron's `BrowserWindow.setAppDetails(AppDetailsOptions)` is the per-window taskbar API. `appUserModelId` is a `ShortcutDetails` field, not a `BrowserWindowConstructorOptions` field. The board window should call `setAppDetails` after construction.
- Tray behavior is in `src/main/tray-setup.ts` and delegates to `OpenWindows.hideWindows`, `showWindows`, `anyVisible`, and `bringToFront`. These currently operate only on the normal registry. Keep board windows out of normal tray visibility and focus selection while retaining their normal close behavior.

### Renderer board opening and window targeting

- Renderer bootstrap in `src/renderer.ts` calls `app.initPages()`, then initializes events and calls `app.openStartupInputs()`. `src/renderer/api/app.ts::initPages` delegates to `pages.init()`; that calls `PagesPersistenceModel.restoreState()`. Startup inputs are opened only after the content event pipeline is registered. The renderer `Window` is implemented in `src/renderer/api/window.ts`; it already reads `getWindowIndex()` and exposes `appWindow`. Board mode can be read there from `process.argv`, which contains `BrowserWindow.webPreferences.additionalArguments`, then exposed as read-only `appWindow.isBoardMode` and `appWindow.boardRoot` before page initialization.
- `src/renderer/content/persephone-board-link.ts::encodePersephoneBoardLink` encodes a root as `persephone-board://<base64-json>` for Persephone's internal content pipeline. `src/renderer/content/builtin-schemes.ts` maps that internal link to `board-view`; `src/renderer/editors/board/index.ts::newEditorModel` decodes it and calls `BoardEditorModel.initFromBoardRoot`, retaining the existing trust flow. Board-mode launch reuses this internal path so the launched board is an ordinary page and is not auto-trusted. It does not register `persephone-board://` with Windows for links from outside Persephone.
- Main-process default target selection also occurs in `src/main/mcp/renderer-bridge.ts::sendToRenderer` (first registered open window by default), `src/main/mcp/tools/call-tools.ts` (unqualified call routing), and the documented default in `src/main/mcp/ai-vision/main-root.ts`. These defaults must resolve a normal window. Explicit window-index paths remain explicit. `src/ipc/main/core-handlers.ts::getWindowIndex` calls `openWindows.findByWindow`, so that lookup must resolve both registries. `src/main/board-bridge.ts::ownerWindow` first resolves the actual host renderer from its `WebContents`; preserve that ownership so board work stays in the board window.
- Cross-window tab drag is coordinated by `src/main/drag-model.ts::processedEvents` and `OpenWindows.movePageToWindow`; `src/renderer/ui/tabs/PageTabView.ts` sends `appWindow.windowIndex` as the drop target. The routing model must allow a normal page to move from a board window and into a board window. The board's own locked-tab restriction is US-1750.
- Other current window consumers include `src/main/mcp/ai-vision/main-root.ts::WindowsNode` and `src/main/mcp/tools/call-tools.ts` for index enumeration, and `src/main/module-service-supervisor.ts::selectBoardSettingsRenderer` for a renderer that hosts board settings. Keep all-window broadcasts/services able to reach board renderers while ensuring ordinary external-open and default-target paths select normal windows.

## Implementation Plan

- [x] Extend `src/shared/launch-input.ts` with `{ kind: "board"; path: string }`. In `src/main/utils.ts::launchOperands`, preserve the recognized `--board <path>` pair before filtering other switches; otherwise the current filter removes `--board` before parsing. In `parseLaunchArguments`, recognize the pair before ordinary operands, resolve relative paths against `cwd`, validate that the target exists and is a directory, and return a board input without consuming unrelated file/URL operands. Keep the existing `diff` and file/URL behavior intact.

  Before:

  ```ts
  export type LaunchInput =
      | { kind: "file"; path: string }
      | { kind: "url"; url: string }
      | { kind: "diff"; firstPath: string; secondPath: string };
  ```

  After: add the board discriminant and parse the option/value pair into that variant.

  ```ts
  export type LaunchInput =
      | { kind: "file"; path: string }
      | { kind: "url"; url: string }
      | { kind: "diff"; firstPath: string; secondPath: string }
      | { kind: "board"; path: string };
  ```

- [x] Update `launcher/src/main.rs::main` and `src/main/pipe-server.ts::handleMessage` to use `BOARD <absolute-root>\n` for a running app and spawn `persephone.exe --board <absolute-root>` when no pipe is available. Parse `BOARD` into `{ kind: "board", path }`. Preserve path spaces and resolve relative roots against the launcher's current working directory.
- [x] Coordinate cold-start input ownership between `src/main/main-setup.ts` and `src/ipc/main/window-handlers.ts`: select the board root to construct the board-mode window, and do not leave the same board input in the renderer's ordinary `startupInputs` queue. Keep any additional file/URL inputs in that queue for normal-window routing.
- [x] In `src/main/open-windows.ts`, split normal-index loading from normal-window construction: always load and validate persisted normal records at startup, including a board cold start, but defer constructing their BrowserWindows until a normal launch/open needs them. Apply the existing single-record index normalization before allocating board indexes. Maintain closed normal records and their indexes as reserved. Allocate every new normal or board index above all reserved normal-record and live-board indexes; never write board indexes to `openWindows.json`. Update `findWindowDataByWindow()` / `findByWindow()` and `src/ipc/main/core-handlers.ts::getWindowIndex` to resolve board windows. On board close, remove its live record and call `windowStates.deleteState(boardWindow.index)` defensively without deleting its bounds record.
- [x] Add `OpenWindows.allWindowData()` and `findWindowDataByIndex(index)` in `src/main/open-windows.ts`, returning both normal records and live board records. Use the combined accessors in `src/main/mcp/ai-vision/main-root.ts::WindowsNode` (`count`, `children()`, and `WindowNode.data`), `src/main/mcp/tools/call-tools.ts::isWindowOpen()` and explicit-index selection, `src/main/mcp/renderer-bridge.ts::sendToRenderer()` explicit-index selection, and `src/main/mcp/renderer-bridge.ts::sendToRendererForWebContents()`. Use normal-only selectors for defaults: `OpenWindows.mainWindow`, `handleOpenFile()`, `handleOpenUrl()`, `handleOpenDiff()`, no-index `sendToRenderer()`, and unqualified `call-tools.ts` forwarding. Keep `OpenWindows.send()` broadcasting to both kinds. Update `src/main/drag-model.ts::processedEvents()` / `OpenWindows.movePageToWindow()` to resolve source and target indexes through the combined accessor, so ordinary tabs can move both ways. Preserve `src/main/board-bridge.ts::ownerWindow()` sender ownership.
- [x] Review `src/main/module-service-supervisor.ts::selectBoardSettingsRenderer` when a board-only cold start is possible; it currently selects from `openWindows.windows`, so ensure an available renderer can be selected when no normal window exists.
- [x] Add a board-mode constructor path in `src/main/open-window.ts` that takes the root and uses its per-board bounds. After constructing the `BrowserWindow`, call `window.setAppDetails({ appId, relaunchCommand, relaunchDisplayName })`. Build `appId` as `Persephone.Board.` plus the SHA-256 hex digest of the normalized absolute board root; set `relaunchCommand` to `"<launcher-path>" --board "<root>"`, using `getBoardLauncherPath()` from `src/main/board-window-identity.ts` for packaged and development behavior; set `relaunchDisplayName` to the board display name. `appIconPath` uses the stable per-board `.ico` written by the board identity update. Add `--persephone-board-root=<encodeURIComponent(root)>` to `webPreferences.additionalArguments` alongside the existing language arguments.
- [x] Store board bounds separately from `windowState`, keyed by a stable normalized board-root identity. Reuse `OpenWindow.ensureVisiblePosition()` for monitor validation. Change `OpenWindow.saveWindowSize()` to write the ordinary shared key for normal windows and only the matching board key for board windows; do not write board geometry into the normal `windowState` key.
- [x] In `src/main/main-setup.ts::second-instance`, parse inputs before calling `bringToFront()`: call it only when the list contains a non-board input or is empty; board-only launches dispatch to/focus the matching board without raising a normal window. Apply the same rule in `src/main/pipe-server.ts::dispatchInputs()`; `SHOW` remains an explicit normal-window bring-to-front request. On cold start, load normal window records but construct only the board window; defer normal BrowserWindow construction until a normal launch/open. Keep `window-all-closed` quitting once every actual BrowserWindow is gone. Adjust `OpenWindows.setCanQuit()` and the board close path so board windows always close, while close-to-tray applies to the last normal window only. Tray show/hide/restore operates on normal windows.
- [x] In `src/renderer/api/pages/PageModel.ts`, add `confirmRelease(): Promise<boolean>` by moving the existing `editor.confirmRelease()` loop from `PageModel.close()` into it, preserving its order: modified non-main editors first, then the main editor. It returns the confirmation result without calling `onClose()`. Keep `PageModel.close()` behavior and order: return `false` immediately for `pinSide === "right"`; otherwise await `confirmRelease()` and call `onClose()` only when it succeeds.
- [x] Add `Endpoint.resolveWindowClose = "resolveWindowClose"` in `src/ipc/api-types.ts`, with exported payload `type WindowCloseResolution = { outcome: "cancel" } | { outcome: "close"; canQuit: boolean }`. Add `[Endpoint.resolveWindowClose]: (result: WindowCloseResolution) => Promise<void>` to `Api`, implement `ApiCalls.resolveWindowClose(result)` in `src/ipc/renderer/api.ts`, and implement/bind `Controller.resolveWindowClose(event, result)` in `src/ipc/main/core-handlers.ts`. Resolve the sender with `BrowserWindow.fromWebContents(event.sender)` and delegate to `openWindows.resolveWindowClose(window, result)`. Add `resolveWindowClose(outcome: "cancel" | "close")` to `src/renderer/api/window.ts`; it sends the cancel variant or the close variant with `canQuit: !settings.get("window.close-to-tray")`. In `RendererEventsService.handleBeforeQuit()`, only when `appWindow.isBoardMode` is true, await `confirmRelease()` for each non-right-pinned page in page order and stop at the first `false`; then send "cancel" and leave pages attached. Skip right-pinned pages because `PageModel.close()` returns false for `pinSide === "right"`; they must not block a board window from closing. In a normal window, do not run modified-page confirmations: keep today's behavior by saving the session, then resolving with "close". For a confirmed board close, save applicable state and resolve with "close". Main handles cancel by clearing the pending quit timeout and keeping the BrowserWindow open; close uses close-to-tray for normal windows and always closes board windows. Do not use `setCanQuit(false)` to report cancellation.
- [x] In `src/renderer/api/window.ts`, parse `process.argv.find(arg => arg.startsWith("--persephone-board-root="))` during `Window` construction, decode the suffix with `decodeURIComponent`, and expose `readonly isBoardMode: boolean` and `readonly boardRoot: string | undefined` getters on `appWindow`; US-1750 reads those exact symbols. `src/main/open-window.ts` supplies `--persephone-board-root=<encodeURIComponent(root)>` through `webPreferences.additionalArguments`; no preload change is needed. In `src/renderer/api/app.ts::initPages()` / `PagesPersistenceModel.init()`, skip normal persisted-page restore in board mode without enabling normal page persistence. In `src/renderer/api/internal/RendererEventsService.ts` and `src/renderer/api/internal/save-window-state.ts`, skip normal window page-state writes for board mode. After `app.initEvents()` registers the content pipeline, open `encodePersephoneBoardLink(appWindow.boardRoot)` through `app.events.openRawLink` so `BoardEditorModel.initFromBoardRoot()` constructs the ordinary page.
- [x] In `src/renderer/editors/board/BoardEditorView.ts::syncBranch()`, when an untrusted board is shown in board mode, call `requestBoardTrust(boardRoot)` immediately instead of waiting for the `UntrustedBoardView` Trust button. On `true`, let the existing trust subscription replace the branch and run the board in place. On `false` (declined or dismissed), call `appWindow.close()` so the ordinary window close handshake runs. Guard the request by normalized board root so model updates do not stack dialogs. Preserve the existing button flow for normal Persephone windows; launching never writes trust directly.
- [ ] Verify that closing a board window runs the existing page close/save flow and removes its live registry entry without deleting its per-board bounds. Re-launching that board should focus one live window; relaunch after app restart should reopen only when the board argument is supplied.

## Concerns

- The launcher currently cannot forward `--board` to a running instance: `launcher/src/main.rs` emits only `OPEN`/`DIFF`/`SHOW`, and `src/main/pipe-server.ts` has no board message. This is a required protocol change, not a parser-only change.
- Cold-start suppression must cover both sides of persistence. Main currently creates a normal window from `openWindows.restoreState()` on every ready event, and every renderer calls `PagesPersistenceModel.init()` and saves on quit. Skipping only one restore call would still create a normal window or allow board pages to overwrite normal session data.
- The agreed board-mode unsaved-page prompt is not present in the current window-close handshake. `src/main/open-window.ts` sends `eBeforeQuit`; `src/renderer/api/internal/RendererEventsService.ts::handleBeforeQuit` calls `saveWindowStateForShutdown()` and signals readiness without calling `PageModel.close()`. Modified-page `confirmRelease()` is currently reached through `PageModel.close()`. Add `PageModel.confirmRelease()` to reuse that editor-confirmation order without closing pages, and `Endpoint.resolveWindowClose` with `{ outcome: "cancel" } | { outcome: "close"; canQuit: boolean }`; current `setCanQuit(false)` hides the last window, so it cannot represent cancellation. Keep this confirmation board-mode-only: normal windows must continue saving their session without prompting, so modified pages are restored as today. Skip right-pinned pages in the board preflight because `PageModel.close()` returns false for `pinSide === "right"`; they must not block board-window close.
- `appUserModelId` is not a BrowserWindow option in the installed Electron types; it appears under `ShortcutDetails`. The per-window taskbar method is `BrowserWindow.setAppDetails(AppDetailsOptions)`. US-1751 must supply the `.ico` before `appIconPath` can be set, so US-1749 sets `appId`, `relaunchCommand`, and `relaunchDisplayName` only.
- Board windows need an index for `getWindowIndex()`, window routing, and drag transfers, but persisted normal records can already reserve indexes even when their BrowserWindows are deferred. Load/validate those records before allocating any board index, allocate new indexes above all reserved/live indexes, and never persist a board index.
- A board-only second-instance launch must not call `bringToFront()` on a normal window before board dispatch; `second-instance` and pipe `dispatchInputs()` need the same conditional routing rule.
- Decision 11 requires immediate trust UI in the board window. `BoardEditorView` currently renders `UntrustedBoardView` with an explicit Trust action; US-1749 must trigger `requestBoardTrust()` when that branch appears in board mode and close the window through `appWindow.close()` if it returns false.
- A board window should be visible to app-wide broadcasts and board-hosted services but absent from default routing and normal session persistence. The implementation should keep those concepts separate rather than simply omitting board windows from every shared window operation.

## Acceptance Criteria

- [ ] `--board <folder>` opens the board as an ordinary board page in a board-mode window on cold launch and in an already-running Persephone instance.
- [ ] A second launch for the same normalized board root focuses its existing window; a different board root gets a different window.
- [ ] A board cold start creates no normal window and does not restore or overwrite the normal window/page session. Launching Persephone without `--board` restores that normal session.
- [ ] Board windows are absent from `openWindows.json` and normal `windowStates` page files; their bounds persist per board root and are restored with off-screen correction.
- [ ] Every board window index is above all normal persisted indexes and live window indexes, is resolvable by `findByWindow()` / `getWindowIndex()`, is never saved, and has any stale `windowStates` file deleted on board close.
- [ ] The board window calls `BrowserWindow.setAppDetails()` with root-derived `appId`, a `relaunchCommand` using `getBoardLauncherPath()` and `--board "<root>"`, and board `relaunchDisplayName`; its per-board icon update sets `appIconPath` to the stable `.ico`. In development, the launcher path resolves to the installed Persephone launcher when available. Its bounds do not affect normal window bounds.
- [ ] Explorer, launcher file/URL/diff inputs, second-instance inputs, and unqualified default main/MCP routing never select a board window. If there is no normal window, a normal session window is created/restored first.
- [ ] A board-only second-instance or pipe launch focuses/creates the board without bringing a normal window forward; non-board inputs and empty/`SHOW` launches bring a normal window forward.
- [ ] Board-owned page navigation stays in the board renderer; ordinary tabs can move out of and into board windows.
- [ ] Board close checks each non-right-pinned page's modified editors in page order and closes only after all confirmations succeed; a declined confirmation cancels close and leaves pages attached. Right-pinned pages do not block board-window close.
- [ ] Closing a normal window or quitting with modified pages shows no prompt, as today; the normal session is saved and restored on the next start.
- [ ] Close-to-tray applies only to the normal window; closing the final board window with no resident normal window allows the app to quit.
- [ ] The renderer exposes only the minimal board-mode flag/root needed by US-1750. No board title bar, chrome, tab locking, or conditional tab bar is implemented by this task.
- [ ] Opening an untrusted board in board mode immediately shows the trust dialog in that window. Accepting runs the board in place; declining or dismissing closes the board window through `appWindow.close()`. Launching never trusts a board automatically.

## Planned File Scope

| File | Planned change |
|---|---|
| `src/shared/launch-input.ts` | Add board launch input variant. |
| `src/main/utils.ts` | Preserve and parse `--board <path>`; validate the board root. |
| `launcher/src/main.rs` | Forward board launch to pipe or spawned Persephone process. |
| `src/main/pipe-server.ts` | Dispatch the launcher's board pipe message. |
| `src/main/open-windows.ts` | Board registry, focus/reuse, normal-window routing, lifecycle and cross-window moves. |
| `src/main/open-window.ts`, `src/main/browser-registration.ts` | Board mode constructor, renderer arguments, per-root bounds, `BrowserWindow.setAppDetails()`, and reusable launcher path. |
| `src/main/main-setup.ts` | Cold-start choice, second-instance routing, quit and close-to-tray behavior. |
| `src/ipc/main/window-handlers.ts` | Keep board launch input out of the ordinary renderer startup queue; expose only remaining normal inputs. |
| `src/main/tray-setup.ts` | Keep tray visibility actions scoped to normal windows. |
| `src/main/drag-model.ts` | Route drag transfers between normal and board window records. |
| `src/main/mcp/renderer-bridge.ts` | Default renderer target skips board windows. |
| `src/main/mcp/tools/call-tools.ts` | Unqualified MCP calls target a normal window. |
| `src/main/mcp/ai-vision/main-root.ts` | Keep the documented default/main window and normal window collection coherent. |
| `src/main/module-service-supervisor.ts` | Ensure board settings renderer selection remains valid with the separate registry. |
| `src/ipc/api-types.ts`, `src/ipc/renderer/api.ts`, `src/ipc/main/core-handlers.ts` | Add and bind `Endpoint.resolveWindowClose` with `WindowCloseResolution` payload. |
| `src/renderer.ts` | Read board mode before page initialization; open board after event setup. |
| `src/renderer/api/app.ts` | Gate normal page restore for board mode. |
| `src/renderer/api/pages/PagesPersistenceModel.ts` | Suppress normal restore and page-session writes in board mode. |
| `src/renderer/api/internal/RendererEventsService.ts` | Retain board close handshake without normal session save. |
| `src/renderer/api/internal/save-window-state.ts` | Skip normal session writes for board windows. |
| `src/renderer/api/window.ts` | Parse the renderer `process.argv` additional argument and expose `appWindow.isBoardMode` and `appWindow.boardRoot`. |
| `src/renderer/api/pages/PageModel.ts`, `src/renderer/editors/board/BoardEditorView.ts` | Confirm modified editors without closing pages during board-window shutdown; immediately request trust in board mode and close on decline/dismissal. |

### Files that need no changes

| File | Reason |
|---|---|
| `src/renderer/content/persephone-board-link.ts` | Existing internal root-link encoding is the launch-to-page bridge; it is not an external Windows protocol registration. |
| `src/renderer/content/builtin-schemes.ts` | The internal `persephone-board` content scheme targets `board-view`. |
| `src/renderer/editors/board/index.ts` | Existing `newEditorModel` decodes the root link and initializes the board model. |
| `src/renderer/editors/board/BoardEditorModel.ts` | Existing `initFromBoardRoot()` and trust loading provide ordinary board-page initialization. |
| `src/main/window-states.ts` | Board windows are kept out of the normal persisted-window registry, so normal per-index page-state storage remains unchanged. |
| `src/main/board-bridge.ts` | `ownerWindow()` resolves the board renderer directly with `BrowserWindow.fromWebContents(hostWebContents)`; retain that sender-based parent selection. |
| `src/main/browser-service.ts`, `src/main/download-service.ts`, `src/main/recording-service.ts` | These paths derive dialog/operation ownership from the requesting `WebContents` via `BrowserWindow.fromWebContents`; keep sender-based ownership for board windows. |
| `src/renderer/ui/app/MainPageView.ts`, `src/renderer/ui/app/MainPage.css`, `src/renderer/ui/sidebar/MenuBarView.ts`, `src/renderer/ui/sidebar/MenuBar.css`, `src/renderer/ui/tabs/PageTabsView.ts`, `src/renderer/ui/tabs/PageTabView.ts`, `src/renderer/ui/tabs/PageTabs.css`, `src/renderer/ui/tabs/PageTab.css` | US-1750 owns board chrome, locked board tab, and on-demand tab bar. |

## Files Changed Summary

| Area | Planned files |
|---|---|
| Launch and window lifecycle | `src/shared/launch-input.ts`, `src/main/utils.ts`, `launcher/src/main.rs`, `src/main/pipe-server.ts`, `src/main/open-windows.ts`, `src/main/open-window.ts`, `src/main/main-setup.ts`, `src/ipc/main/window-handlers.ts`, `src/main/tray-setup.ts` |
| Routing, window services, and close response | `src/main/drag-model.ts`, `src/main/mcp/renderer-bridge.ts`, `src/main/mcp/tools/call-tools.ts`, `src/main/mcp/ai-vision/main-root.ts`, `src/main/module-service-supervisor.ts`, `src/ipc/api-types.ts`, `src/ipc/renderer/api.ts`, `src/ipc/main/core-handlers.ts` |
| Renderer bootstrap and page persistence | `src/renderer.ts`, `src/renderer/api/app.ts`, `src/renderer/api/pages/PagesPersistenceModel.ts`, `src/renderer/api/internal/RendererEventsService.ts`, `src/renderer/api/internal/save-window-state.ts`, `src/renderer/api/window.ts`, `src/renderer/api/pages/PageModel.ts`, `src/renderer/editors/board/BoardEditorView.ts` |

## Implementation notes (live verification, 2026-11-02)

- **`prompting` close outcome.**
  - `WindowCloseResolution` gained `{ outcome: "prompting" }`.
  - `OpenWindow`'s close handler starts a 2-second timer that destroys a renderer that doesn't
    answer. A board window's save prompt waits for the user, so the timer destroyed the window
    under the open dialog.
  - Before prompting, `RendererEventsService.handleBeforeQuit()` now sends `prompting`.
    `OpenWindows.resolveWindowClose()` treats it like `cancel` (it clears the timer and keeps the
    window) until the real `cancel` or `close` answer arrives.
- **`PageModel.needsReleaseConfirmation`.**
  - `PageModel.modified` reads `editors[]`, but a text page's unsaved state lives on the main
    editor's host, which `confirmRelease()` checks through `mainEditor`.
  - The new getter mirrors `confirmRelease()`, and the `prompting` pre-check uses it.
- **Trust prompt scope.** `BoardEditorView.requestBoardModeTrust()` prompts only for the board the
  window was launched for (`appWindow.boardRoot`). Another untrusted board opened inside a board
  window keeps the ordinary Trust button, because declining would otherwise close the whole window.
- **Verified live (dev build, launcher into the running instance):**
  - `--board` opens the board as a page in window index 3, above the saved normal window 2.
  - A repeat launch focuses that window.
  - Closing with a modified file shows the save prompt. Cancel keeps the window; Don't Save closes
    it and discards the edit.
  - `openWindows.json` keeps only the normal windows.
- **Not verified live:**
  - Cold start from a shortcut (needs the installed build).
  - The untrusted-board trust prompt.
  - Close-to-tray with only board windows left.
