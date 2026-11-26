# US-2222: Clicking a website notification brings Persephone forward

Epic: [EPIC-214](../../epics/EPIC-214.md). Status: Implemented; pending manual OS verification.

## Goal

Clicking a desktop notification shown by a website (or board) in a Persephone browser tab restores and focuses the
Persephone window and shows that tab, as Chrome does.

## Background

The US-2218 check on Ubuntu 26.04 GNOME Wayland (2026-11-26) showed a permitted `localhost` notification in GNOME
under Persephone with its icon and dock badge. Clicking it ran the page's `onclick`, but the minimized app stayed
minimized and the originating tab was not shown. Windows has not been run. The app's guest and window code contains no
platform-specific notification-click focus route, so the same gap is expected there, but is not a measured result.

### Measured Wayland activation

Claude measured these in the Ubuntu 26.04 GNOME Wayland VM with the Electron 44.9.3 development app on
2026-11-26:

- Without a notification click, main-process `win.minimize()` followed by `win.restore(); win.focus()` was refused:
  the window stayed hidden, `isFocused()` was false, and GNOME displayed a "Persephone" is ready notice.
- Electron's Linux notification presenter uses libnotify, and the Electron binary imports
  `notify_notification_get_activation_token`. Web notifications use the same presenter; US-2218 observed them
  under the app name.
- A main-process Electron `Notification` whose click handler called `restore(); focus()` raised and focused the
  minimized window after a real click using `ydotool` (`isFocused()` true). Delaying those calls by 300 ms after
  the click also worked.

The user's click supplies activation, consumed by the next activation. Route the request promptly: main must
show/restore/focus as soon as it receives the message, before waiting for renderer readiness or other slow work;
no stage may add a deliberate delay. The final GNOME check still verifies the full web-notification route.

### Ownership and existing paths

- A browser editor contains internal tabs inside a Persephone page. `BrowserWebviewItemView` in
  `src/renderer/editors/browser/BrowserWebviewItemView.ts` creates one `<webview>` per tab, sets its partition and
  `window.webviewPreloadUrl`, captures `tabId`, and passes parsed `ipc-message` events to
  `BrowserWebviewModel.handleGuestMessage`. `BrowserTabsModel.switchTab(tabId)` selects the internal tab;
  `model.page?.id` identifies its enclosing page. The per-item listener already knows the source; never trust a page
  to supply another tab or window ID.
- `src/preload-webview.ts` installs guest helpers, including in subframes. `src/main/browser-service.ts` forces
  browser guest `contextIsolation: true`, `nodeIntegration: false`, `nodeIntegrationInSubFrames: true`. The preload
  runs in an isolated world: wrapping its own `Notification` does **not** wrap the page's constructor, `onclick`, or
  `addEventListener`. `src/preload-webview/page-visibility-shim.ts` demonstrates
  `contextBridge.executeInMainWorld` and a returned callable crossing the isolation boundary; use that pattern to
  install the click observer in each actual page world before page scripts. Do not change isolation or expose IPC.
- The existing transport is `ipcRenderer.sendToHost` → the webview's `ipc-message` listener, centralized by
  `src/ipc/browser-guest-messages.ts` (`sendToHost`, `parseGuestMessage`, typed channel map). Add a typed event to
  that existing transport; do not write a new transport, correlator, acknowledgement, or error envelope. Route it in
  the item view to a focused collaborator, not into the roadmap §2.3 `BrowserWebviewModel.ts`.
- `src/renderer/api/window.ts` exposes `appWindow.windowIndex`; `src/ipc/renderer/api.ts` exposes the existing
  `api.showWindowPage(windowIndex, pageId)`. `src/ipc/main/window-handlers.ts` forwards it to
  `openWindows.showWindowPage` in `src/main/open-windows.ts`, which calls `OpenWindow.focus()` and sends `eShowPage`.
  `src/main/open-window.ts` restores a minimized window before focusing it; `RendererEventsService.handleShowPage`
  invokes `pages.navigation.showPage` in `src/renderer/api/pages/PagesNavigationModel.ts`. This exact-window path is
  preferable to `openWindows.bringToFront()`, used by the second-instance handoff to choose a normal window.
  `OpenWindow.focus()` currently does not show a hidden window, so close-to-tray cannot be reversed by this path.
  Its callers in `open-windows.ts` all intend to bring a window forward: `openBoardWindow` reopens a board;
  `handleOpenFile`, `handleOpenDiff`, and `handleOpenUrl` present launch inputs; `showWindowPage` reveals a page;
  `movePageToWindow` reveals the drop target; `openPathInNewWindow` presents the new window; and
  `activateSomeWindow` activates a normal window. Showing a hidden window is correct for each.
- No project handler turns a guest page's `window.focus()` into host-window restoration or browser tab selection.
  The webview's DOM `focus` listener only dismisses overlays. A site's own `window.focus()` in `onclick` therefore
  cannot be relied on as the hook; observe the notification click even when the page has no handler.
- The Castlabs Electron pin in `package.json` is `v44.9.3+wvcus`. `node_modules/electron/electron.d.ts` has a
  `click` event on main-process Electron `Notification` objects, but no WebContents, Session, or app hook for a web
  `Notification` click. Electron's class cannot observe Chromium-created page notifications. The types also warn
  that Wayland focus can be refused; the measurements above establish the click-driven approach.
- Boards are in scope: `src/renderer/editors/board/frame/BoardFrameSession.ts` creates `board://` iframes and records
  their `tabId` and owning model/page. `src/main/board-protocol-service.ts` injects `src/board-shim.ts` before author
  scripts; its `src/board-shim/frame-behaviours.ts` uses `HostFrameChannel.emit` to reach the host via the typed
  frame event map and `BoardFrameEndpoint`/`board-host-router.ts`. Board main and secondary frames may raise
  notifications when granted. Only registered main and secondary board frames are in scope: `BoardFrameSession.identify()` accepts the exact
  iframe window and origin, so nested iframe messages do not reach this endpoint. Do not weaken that source check.
- `src/main/permission-policy-service.ts` installs both `setPermissionRequestHandler` and
  `setPermissionCheckHandler`. Browser notification grants are frame-origin scoped through
  `src/main/site-permission-store.ts`; cross-origin frames cannot prompt using the top origin's grant. In the app
  session, board notification checks use the trusted `BoardGrant.deviceAccess().notifications` and
  `BoardGrant.iframeFeatures()` in `src/shared/board/board-grant.ts`. Preserve all these decisions unchanged.

## Implementation Plan

- [x] **Own click observation in `src/shared/notification-click-observer.ts`.** Export one self-contained function
  with no imports or module-level references: the browser preload passes that function to `executeInMainWorld`,
  which serializes it, and `src/board-shim/frame-behaviours.ts` calls the same function directly in the page world.
  `scripts/build-prod.mjs` bundles both entries (the board shim as an IIFE), and `eslint.config.mjs` permits this
  dependency-free shared module; no duplicate logic or import-zone workaround is needed. Install before author scripts.
  Wrap construction with `Reflect.construct` and attach a native `click` listener immediately to the returned native
  instance; invoke the supplied callback only for a trusted native click. Preserve constructor/prototype and static
  behavior (`permission`, `requestPermission`, `maxActions` where present), `instanceof`, subclass construction,
  errors, and original objects. Preserve the page-visible `Notification.name`, `Notification.length`, prototype
  identity, and `Function.prototype.toString` output as native-looking as practical without elaborate machinery;
  do not assign or replace `onclick`, consume the event, or interfere with
  `addEventListener`, `close`, or permission requests. Do not focus on creation, dismissal, or synthetic
  `dispatchEvent`. Account for pages replacing their own constructor and for document/frame teardown; a closed or
  navigated-away page must not reactivate a stale tab. This covers document-created `new Notification`, not service
  worker `showNotification`/`notificationclick`, which has no live page instance and is outside this task.

  Before → after (illustrative behavior, not a replacement implementation):

  ```ts
  // Before: page constructs an unobserved native notification.
  const notification = new Notification(title, options);
  // After: the native instance still goes to the page; the observer adds a listener first.
  const notification = Reflect.construct(NativeNotification, args, newTarget);
  nativeAddEventListener.call(notification, "click", onTrustedNotificationClick);
  return notification;
  ```

- [x] **Own browser installation in `src/preload-webview/notification-click.ts`** and invoke it from
  `src/preload-webview.ts` for every guest frame, including subframes. `executeInMainWorld` serializes its function;
  ensure the install function is self-contained in that world and bridge only a narrow private callback back to
  preload (the returned callable pattern in `page-visibility-shim.ts`), not `ipcRenderer` or a public global.
  Send a payload-free `notification-click` using `sendToHost` in `src/ipc/browser-guest-messages.ts`; add the typed
  channel and parser case there. The page must not be able to manufacture a trusted click through the bridge.
- [x] **Own browser selection in a new `src/renderer/editors/browser/browser-notification-focus.ts` collaborator**.
  In `BrowserWebviewItemView.ts` handle this parsed event locally, verifying that its webview is still connected,
  registered for this tab, and belongs to the current editor/page. Resolve and cache the window index with the
  existing `api.getWindowIndex()` during view setup, before any click; the `appWindow.windowIndex` getter throws
  until initialized. Immediately call `api.showWindowPage(windowIndex, model.page.id)` on click, before tab selection
  or any asynchronous work; then select with `model.tabs.switchTab(tabId)`. If the index is not yet available, send
  as soon as it resolves, rechecking liveness, without a timer or other intentional delay. Do not reactivate a
  closed/replaced webview or page. Keep the existing pointer-down and other guest message behavior unchanged.

  ```ts
  // Before: guest messages go to the existing router.
  this.model.webview.handleGuestMessage(this.tabId, msg, event.frameId);
  // After: this one event uses the source item's identity; all others keep their route.
  if (msg.channel === BrowserGuestMessageChannel.notificationClick) {
      this.notificationFocus.show(this.tabId, this.webview);
      return;
  }
  this.model.webview.handleGuestMessage(this.tabId, msg, event.frameId);
  ```

- [x] **Own board installation in `src/board-shim/frame-behaviours.ts`** using the same native-instance observation
  rule. Emit a payload-free `notification.click` over the existing `HostFrameChannel` and add it to
  `BoardToHostEvents` in `src/ipc/board-bridge/frame-protocol.ts`; use existing frame event primitives and routing,
  not a separate postMessage protocol. Add the route in `src/renderer/editors/board/frame/board-host-router.ts` and
  put selection in a focused `src/renderer/editors/board/frame/board-notification-focus.ts` collaborator composed by
  `board-frame-composition.ts`. Check `BoardFrameSession.isCurrent` with the routed frame/generation before acting;
  use the session's own `tabId` and model, never page-supplied identities. Select the enclosing page via the same
  `api.showWindowPage` path immediately, using the window index obtained in advance as for browser views. Do not
  await frame readiness, panel selection, or other slow work before sending it. For a secondary view use
  `BoardTargetModel.switchTab(session.tabId)` to open its panel after dispatch, rechecking the frame after
  asynchronous work. Avoid changing `window.persephone`; if implementation changes it,
  bump `BOARD_BRIDGE_VERSION` and append its history line in `src/shared/board-bridge-version.ts`.
- [x] **Own hidden-window recovery in `src/main/open-window.ts`**: change `OpenWindow.focus()` to call
  `this.window.show()` when `!this.window.isVisible()`, before its existing minimized restore, position correction,
  and `focus()`. Keep the existing `openWindows.showWindowPage` ordering: focus immediately upon receipt, before
  `await openWindowData.whenReady`. This applies on Windows and Linux with a tray host and is correct for each caller
  listed above. `open-window.ts` is not a roadmap section 2.3 god file. Do not add delays or await renderer readiness before
  this focus request. Do not grow a roadmap section 2.3 god file or use `await import()` or a pass-through wrapper to cross
  an import zone. No permission, board grant, or public bridge API changes are needed.

  ```ts
  // Before
  if (this.window.isMinimized()) this.window.restore();
  // After, before the existing restore, position correction, and focus
  if (!this.window.isVisible()) this.window.show();
  if (this.window.isMinimized()) this.window.restore();
  ```

- [x] Run `npm run typecheck`, `npm run lint`, and `npm run build-prod`. All passed; the production build completed
  with existing Vite warnings. No unit tests or test harnesses were added.
- [x] Run affected existing browser and board UI integration areas on Windows (Claude, after restarting `npm start`):
  `browser`, `boards` and `core/startup`, 211 passed, 2 skipped. Manual GNOME checks: see "VM results" below.
- [ ] Windows toast click (manual, on the user's desktop): not yet run.

### Manual verification (Claude: Ubuntu VM and Windows)

1. On Ubuntu GNOME Wayland and Windows, grant a local test site notifications. Create a notification from an
   inactive internal browser tab in an inactive Persephone page; minimize the owning window, click the OS
   notification, and verify that exact window, page, and internal tab appear. Repeat with the window behind another
   app, with two Persephone windows, and with a tray-hidden window if supported. Record actual OS/compositor results.
2. Repeat with no page click handler, then with `onclick`, `addEventListener("click", ...)`, both together, and
   `window.focus()` inside the handler. Verify each handler runs once, its event/`this` remains native, and focus
   works without the site's call. Confirm `Notification.permission`, `requestPermission`, `instanceof`, denied and
   allowed permissions, and ordinary close behave as before. A synthetic click must not raise the app.
3. Repeat from a granted board main frame and an already-open secondary frame, in a normal and dedicated board
   window. Confirm the correct page/panel is shown and handlers run; verify denied board notifications stay denied.
   Exercise permitted browser subframes; nested board iframes are outside this task.
4. Close or navigate the source tab/frame before clicking a pending notification and confirm no unrelated tab is
   activated. Verify normal pointer clicks and tab switching still work. Record any compositor focus refusal and
   investigate before claiming the acceptance criteria pass.

### VM results (Claude, 2026-11-26)

Ubuntu 26.04 GNOME Wayland, dev app, `http://localhost:8765` test page with notifications allowed, real clicks on
the GNOME banner (ydotool):

- Minimized window, another page active, page `onclick`: window restored and focused, the browser page shown,
  `onclick` ran once, `instanceof Notification` true.
- Window hidden to the tray with its close button, another internal browser tab selected, `onclick` and an
  `addEventListener("click")` handler: window shown and focused, the source internal tab selected, each handler ran
  once. One earlier attempt did nothing; the page's own handlers did not run either, so GNOME did not deliver that
  click (not this code). Repeated twice more, both passed.
- Inactive internal tab, window visible: the source tab selected, `onclick` ran.
- No page handler, minimized: window restored and focused.
- Synthetic `dispatchEvent(new Event("click"))` with the window minimized: window stays minimized.
- The wrapped constructor keeps `Notification.name`, native `toString` output and `requestPermission`.
- Board main frame (a test board granted `notifications`, trusted), minimized with another page active: window
  restored and focused, the board page shown, the board's `onclick` ran.
- Not run: two-window, secondary board frame, dedicated board window, closed-source-tab cases; the Windows toast click.

## Concerns

- Service-worker `showNotification` / `notificationclick` has no live document instance and is outside this task.
- Observation is best effort: a page can replace its constructor or interfere with listeners. This is compatibility
  for cooperative page code, not an authentication boundary.
- Windows foreground behavior remains to be confirmed in the manual check.

## Acceptance Criteria

- With Persephone minimized or behind another window, clicking a site notification restores and focuses the window
  and activates the tab that raised it, on Windows and GNOME.
- A page's own `onclick` handler still runs; permission decisions are unchanged.

## Files Changed Summary

| Path | Planned change |
|------|----------------|
| `src/shared/notification-click-observer.ts` | One self-contained page-world native notification observer shared by both entry points. |
| `src/preload-webview/notification-click.ts`, `src/preload-webview.ts` | Install observer in each browser guest frame and relay trusted clicks. |
| `src/ipc/browser-guest-messages.ts` | Extend existing typed guest message and parser. |
| `src/renderer/editors/browser/BrowserWebviewItemView.ts`, `src/renderer/editors/browser/browser-notification-focus.ts` | Route from the originating webview and select its page/internal tab. |
| `src/board-shim/frame-behaviours.ts`, `src/ipc/board-bridge/frame-protocol.ts` | Install board observer and extend existing typed frame event map. |
| `src/renderer/editors/board/frame/board-host-router.ts`, `board-frame-composition.ts`, `board-notification-focus.ts` | Route from the current board frame and select its page/view. |
| `src/main/open-window.ts` | Show hidden windows in `OpenWindow.focus()` before restoring and focusing. |
| `src/shared/board-bridge-version.ts` | Only if `window.persephone` changes; bump version and add history. |

**No changes:** `src/main/permission-policy-service.ts`, `src/main/site-permission-store.ts`,
`src/shared/board/board-grant.ts`, `src/main/browser-service.ts`, `src/main/board-protocol-service.ts`,
`src/renderer/editors/browser/BrowserWebviewModel.ts`, `src/renderer/editors/board/BoardWebview.ts`,
`src/renderer/editors/board/BoardEditorModel.ts`, `src/renderer/api/pages/PageModel.ts`, and `src/board-shim.ts`.
The dashboard title stays the same; no dashboard edit is needed.
