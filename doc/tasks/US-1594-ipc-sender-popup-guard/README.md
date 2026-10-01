# US-1594: IPC sender checks and popup navigation guard

**Epic:** [EPIC-118 — Security hardening](../../epics/EPIC-118.md) · finding F8 · **Low**

## Goal

Require every renderer-to-main IPC registration in the audited IPC surface to come from a live
Persephone app window's main frame, while preserving multiple app windows and existing worker,
MCP, and board-pipe flows. Restrict browser data clearing to app-defined persistent browser
profile partitions, and give popup windows and their descendants the browser webview's protocol
navigation guard.

## Background

### IPC sender boundaries

`src/main/open-window.ts:41-64` creates app windows in `appPartition` (`nopersist`;
`src/main/constants.ts:1-2`) and enables `nodeIntegration` for the app renderer. Multiple windows
are managed by `src/main/open-windows.ts`; a sender check must therefore test the sender's app
partition, live main frame, and `BrowserWindow` ownership rather than compare against one singleton
window. The current `isAppRenderer` predicate already expresses those checks in
`src/main/browser-service.ts:789-793`.

The audited surfaces and legitimate senders are:

| Registration surface | Registered channels / handlers | Legitimate sender and current boundary |
|---|---|---|
| `src/ipc/main/endpoint-registry.ts:18-29` | Every `Endpoint` passed through `bindEndpoint` (bulk renderer API) | App-window main frame. `bindEndpoint` is the shared request/reply loop. Board management endpoints are called by the app UI; board documents do not invoke this registry. |
| `src/ipc/main/renderer-events.ts:5-14` | `RendererEvent.fileDropped` | App-window main frame; the handler maps `event.sender` to an `openWindows` entry before forwarding the file. |
| `src/ipc/main/board-pipe-handlers.ts:11-38` | `Endpoint.registerBoardPipePage`, `unregisterBoardPipePage`, `registerBoardPipeResource`, `unregisterBoardPipeResource`, and `BOARD_PIPE_REPLY_CHANNEL` | App-window main frame. Board frames exchange data over transferred `MessagePort`s; the board-pipe reply here is from the host renderer. |
| `src/main/browser-service.ts:806-915` | Browser permission handlers; `register`, `unregister`, `setAudioMuted`, `exitHtmlFullscreen`, `allowPopups`, `hardReload`, `clearProfileData`, `clearCache`, `collectDom` | App-window main frame. `ownedRegistration` checks ownership for some invoke handlers, but the listed `ipcMain.on` callbacks and clear/collect handlers do not use the current predicate. |
| `src/main/cdp-service.ts:1040-1246` | `getPageEvents`, dialog handlers, automation handlers, navigation/response waits, drag interception, `cdpAttach`, `cdpDetach`, `cdpSend` | App-window main frame. These operations control app pages, browser webviews, and board frames through main-process state; board frames themselves do not send these IPC calls. |
| `src/main/browser-network-service.ts:247-270` | `BrowserNetworkChannel.apply`, `checkIp`, `release`, `sessionSource` | App-window main frame. They configure/query browser webview sessions. |
| `src/main/tor-service.ts:467-513` | `TorChannel.arm`, `start`, `fetchAcquire`, `fetchRelease`, `stop`, `checkIp`, `restart` | App-window main frame. Tor pages are webviews; Tor's `activePartitions` and proxy bookkeeping are main-process state (`tor-service.ts:32-50`). |
| `src/main/command-runner.ts:413-430` | `RunnerChannel.start`, `stdin`, `endStdin`, `kill` | App-window main frame. Board scripts use board bridge ports instead (`command-runner.ts:409-411`). |
| `src/main/search-service.ts:81-175` | `SearchChannel.start`, `cancel` | App-window main frame; the service scopes jobs by the sender's `webContents.id`. The spawned search worker is a `Worker`, not an IPC sender. |
| `src/main/worker-host.ts:140-230` | `WorkerChannel.start`, `proxyResult` | App-window main frame. The worker is a Node `Worker` and reports to its creating renderer through the main process; it does not use `ipcRenderer`. |
| `src/main/network-logger.ts:203-216` | `BrowserChannel.getNetworkLog` | App-window main frame; data belongs to browser webviews registered by the app. |
| `src/main/mcp/renderer-bridge.ts:16-27` | `MCP_RESULT` | App-window main frame. MCP requests are deliberately dispatched to a selected app window (`renderer-bridge.ts:29-45`), including non-primary windows. |

No audited registration needs a board frame, popup, utility process, hidden renderer, or worker to
send `ipcRenderer` traffic. The app window is the sender for worker requests; worker messages use
`worker_threads` events. The browser guest preload at `src/preload-webview.ts:1-14, 84-100`
reports page title/favicon with `ipcRenderer.sendToHost`, not app IPC channels. The host creates
that guest in `src/renderer/editors/browser/BrowserView.ts:72-81`. Board frame communication uses
the board bridge/ports, not app-window IPC. MCP may target any open app window, so the predicate
must accept every live `BrowserWindow` in `appPartition`, not a single current window.
The runner's utility-process jobs are also main-process children: `startNodeJobTo` uses
`utilityProcess.fork` and relays their stdin/stdout/exit through the app renderer sink
(`src/main/command-runner.ts:286-352`). Their `UtilityProcess` messages are not `ipcMain` messages.

### Shared sender guard and rejection behavior

Keep the existing `isAppRenderer` conditions, move them to a small reusable main-process module,
and expose guarded `ipcMain.on` / `ipcMain.handle` registration helpers. Apply them at the
registrations above: the endpoint registry protects the large API loop once; the remaining
modules protect their own registrations at registration time instead of adding independent
checks to every callback. Do not install a blanket `ipcMain` monkey patch.

Before:

```ts
ipcMain.on(BrowserChannel.unregister, (_event, key) => unregisterWebview(key));
```

After (illustrative helper API):

```ts
guardedIpcOn(BrowserChannel.unregister, (_event, key: string) => unregisterWebview(key));
```

For a rejected event-style message, log one `console.warn` with channel and sender identity (no
payload), then drop it. Rate-limit warnings to the first rejection for each channel and sender
`webContents` during that contents' lifetime, for example with a `WeakMap<WebContents,
Set<string>>`; do not log attacker-controlled payloads. For a rejected `ipcMain.handle`
invocation, throw a fixed authorization error so `ipcRenderer.invoke` rejects. For
`bindEndpoint`'s event-based request/reply protocol, reply on `${command}_${commandId}` with an
`Error`. The renderer's `executeOnce` (`src/ipc/renderer/api.ts:56-69`) calls `reject(arg)` when
the reply is an `Error`, so the caller rejects rather than hanging; its following `resolve(arg)`
is ignored because the promise has already settled. The guard and wrapper must share the same
rate-limited warning path so a rejected message does not produce duplicate warnings.

### Profile partition inputs

`getPartitionString` in `src/renderer/editors/browser/BrowserEditorModel.ts:341-356` constructs
three families: persistent profiles as `persist:browser-${profileName || "default"}`, ephemeral
incognito as `browser-incognito-${UUID}`, and Tor as `browser-tor-${UUID}`. The browser network
service has a profile/incognito shape regex at `src/main/browser-network-service.ts:35-40`, but it
does not include Tor. Profile names come from the `browser-profiles` setting; the settings UI
trims new names and prevents case-insensitive duplicates (`src/renderer/editors/settings/sections/BrowserProfilesSectionModel.ts:52-60`).

Only persistent profile partitions are valid for `clearProfileData` and `clearCache`:
`BrowserProfilesSectionModel.ts:67-98` uses `clearProfileData` for default or named profile
settings actions, and `BrowserEditor.ts:201-205` skips `clearCache` for Incognito and Tor. All
three renderer call sites ignore the result: the settings actions only `await` the invoke, and
`BrowserEditor.ts:204` does not await or inspect it. Both main handlers currently resolve
`undefined` because neither returns a value. On an invalid partition, return without a value
(still `undefined`) after the warning.

Use this exact predicate for parameter `p` before calling `session.fromPartition`:

```ts
typeof p === "string"
    && p.startsWith("persist:browser-")
    && p.length > "persist:browser-".length
    && p.length <= 256
```

This accepts `persist:browser-default` and any non-empty named persistent profile suffix,
including `persist:browser-tor-x` (a legitimate profile named `tor-x`). Non-persistent
`browser-incognito-*` and `browser-tor-*` values fail the prefix check. `nopersist`,
`persist:file-access`, and other partitions outside the persistent browser profile namespace
also fail. The current settings UI permits any non-empty trimmed name, so do not add a narrower
character restriction here.

Before:

```ts
const ses = session.fromPartition(partition);
```

After (illustrative):

```ts
if (!isPersistentBrowserProfilePartition(partition)) return;
const ses = session.fromPartition(partition);
```

### Popup navigation and preferences

`registerWebview` attaches `will-navigate` at `src/main/browser-service.ts:419-449`: it blocks
`BLOCKED_PROTOCOLS` (`file:` and `app-asset:`; lines 31-39), and routes other non-Chromium
protocols to the host only after a recent user activation. That activation comes from
`RegisteredWebview.lastUserActivation` (`browser-service.ts:113-115`), updated by
`before-mouse-event` (`:392-406`) and consumed by `will-navigate` (`:440-445`). Popups have no
`RegisteredWebview` and therefore no such activation source.

`guardPopupWindow` at `browser-service.ts:215-273` gates popup creation on focus and rate limits,
and recurses through `did-create-window`, but does not attach navigation guards to the child
`WebContents`. Add a shared scheme-check helper used by both the registered webview and popup
trees. Only the registered webview may use the activation-gated host handoff. Popups and all
descendants are block-only: prevent `BLOCKED_PROTOCOLS` and every non-Chromium scheme in their
main-frame `will-navigate` handlers, and never send a handoff to the host. This matches today's
effective popup behavior for non-Chromium schemes: Chromium's external-protocol path reaches the
permission policy, where `requestKeys` only accepts `http`, `https`, `mailto`, and `tel`
(`src/main/permission-policy-service.ts:34, 147-152`); other schemes are denied.

On `will-redirect` and `will-frame-navigate`, block only `BLOCKED_PROTOCOLS` (`file:` and
`app-asset:`). Do not block other non-Chromium schemes in these events: let Chromium's external
protocol path and permission policy handle them. Neither event ever hands off to the host.
Preserve ordinary HTTP/HTTPS navigation and legitimate redirects.

The app's top-level `BrowserWindow` enables Node integration and has an app preload
(`open-window.ts:49-64`), but `BrowserView` does not enable Node on its guest (`BrowserView.ts:72-81`)
and Electron 43's `nodeIntegration` default is false (`electron.d.ts:19321-19323`). Electron's
[window.open documentation](https://www.electronjs.org/docs/latest/api/window-open) states a
child cannot enable Node integration when its parent has it disabled. Thus page-supplied window
features cannot grant Node to these popups. Do not override popup `webPreferences`: the popup
must retain its opener's session/partition and `window.opener` for OAuth/login flows.

Add a cheap assertion in both `did-create-window` paths (`browser-service.ts:270-272, 561-565`):
if effective popup preferences enable `nodeIntegration` or `nodeIntegrationInSubFrames`, issue
`console.warn` and destroy the child window. The requested `webContents.getLastWebPreferences()`
method is **not declared** in the installed Electron 43 public typings: searching
`node_modules/electron/electron.d.ts` finds no such member. The same typings declare the
`did-create-window` `details.options` field at `electron.d.ts:21327-21342` and specify that it
contains the merged window options, including security preferences inherited from the parent.
Use `details.options.webPreferences` in the typed event callback for the assertion instead of
adding an untyped runtime-method cast. Keep the browser guest's session, preload, sandbox, and
opener configuration intact.

Before:

```ts
childWc.setWindowOpenHandler(/* popup focus/rate-limit policy */);
childWc.on("did-create-window", (grandchild) => guardPopupWindow(grandchild, sender, tabId, internalTabId));
```

After: `registerWebview` passes the shared helper a policy that retains its existing activation-
gated handoff; `guardPopupWindow` passes a block-only policy to each popup and descendant. Each
`did-create-window` callback checks the merged `details.options.webPreferences`, warns and destroys
a child only if Node integration or subframe Node integration is enabled, and otherwise keeps
Electron's inherited popup preferences untouched.

## Implementation Plan

1. **Add the reusable IPC sender gate — `src/main/ipc-sender-guard.ts`.**
   - Move the `isAppRenderer` predicate from `src/main/browser-service.ts:789-793` without
     weakening its checks: sender session equals `session.fromPartition(appPartition)`, sender is
     live, `sender.mainFrame === event.senderFrame`, and `BrowserWindow.fromWebContents(sender)`
     exists.
   - Export typed registration wrappers for event and invoke handlers. Each wrapper checks the
     event once, rate-limits warnings to the first rejection per channel and sender `WebContents`,
     and applies the rejection behavior above (drop event; throw for invoke). Keep an optional
     explicit sender policy only
     if a future audited channel truly needs another sender; this inventory currently has no such
     exception.
   - Export an endpoint-registry-specific rejection path or allow `bindEndpoint` to use the same
     predicate and send its request/reply error. Do not wrap a rejected endpoint in the generic
     `ipcMain.on` drop behavior because the renderer would wait for its command timeout.
2. **Cover the bulk endpoint and renderer event surfaces.**
   - In `src/ipc/main/endpoint-registry.ts:18-29`, gate every `bindEndpoint` callback before
     invoking service code. On rejection, reply with an authorization `Error` on that command's
     reply channel.
   - In `src/ipc/main/renderer-events.ts:5-14`, guard `RendererEvent.fileDropped`.
   - In `src/ipc/main/board-pipe-handlers.ts:12-37`, protect the four `bindEndpoint` registrations
     through the endpoint registry and guard `BOARD_PIPE_REPLY_CHANNEL`. This is still the app
     window's host-side port relay; do not require a board frame as IPC sender.
3. **Guard specialized IPC families at their registration choke points.** Replace direct
   `ipcMain.on` / `ipcMain.handle` registration with the shared wrapper in:
   - `src/main/browser-service.ts:806-915` (including `register`, all browser permission handlers,
     all listed one-way controls, both clear handlers, and `collectDom`). Remove its local
     `isAppRenderer` after callers use the shared predicate; retain per-registration ownership
     checks such as `ownedRegistration`.
   - `src/main/cdp-service.ts:1040-1246` (all CDP and page automation handlers).
   - `src/main/browser-network-service.ts:247-270` and `src/main/tor-service.ts:467-513`.
   - `src/main/command-runner.ts:413-430`, `src/main/search-service.ts:81-175`, and
     `src/main/worker-host.ts:140-230`.
   - `src/main/network-logger.ts:203-216` and `src/main/mcp/renderer-bridge.ts:16-27`.
   Confirm every handler in these blocks is covered, including event listeners with ignored
   `_event` parameters. For `ipcMain.handle`, throwing the fixed authorization error is the
   rejection contract; one-way `on` channels are dropped after the warning.
4. **Validate browser profile partition arguments — `src/main/browser-service.ts:898-911`.**
   - Add one main-side validation helper implementing exactly:
     `typeof p === "string" && p.startsWith("persist:browser-") && p.length > "persist:browser-".length && p.length <= 256`.
   - Reject invalid values before `session.fromPartition`. Return no value (`undefined`), matching
     the current valid-call result; confirmed renderer callers ignore the result at
     `BrowserProfilesSectionModel.ts:73, 97` and `BrowserEditor.ts:204`.
   - `persist:browser-tor-x` is accepted as a persistent profile named `tor-x`; non-persistent
     `browser-incognito-*` and `browser-tor-*`, `nopersist`, and `persist:file-access` fail the
     persistent-profile prefix check. Do not use the broader `PROFILE_PARTITION_RE` alone: it
     intentionally covers Incognito for network settings.
5. **Share the browser navigation policy — `src/main/browser-service.ts:31-43, 419-449`.**
   - Extract the scheme decision used by `registerWebview` into a helper that preserves the
     current `BLOCKED_PROTOCOLS`, Chromium schemes, `USER_ACTIVATION_WINDOW_MS`, host routing
     event, and one-use activation.
   - Keep the registered webview's current `will-navigate` activation-gated host handoff.
     `will-redirect` and `will-frame-navigate` only block `BLOCKED_PROTOCOLS`; neither event may
     hand off to the host or block other non-Chromium schemes.
6. **Install the policy on popup trees and pin their privileges —
   `src/main/browser-service.ts:215-273, 511-565`.**
   - Attach the shared block-only `will-navigate` policy to each `childWc` in
     `guardPopupWindow`, before its recursive `did-create-window` listener. This blocks
     `BLOCKED_PROTOCOLS` and every non-Chromium main-frame scheme without host handoff.
   - Add `will-redirect` and `will-frame-navigate` listeners to popups and descendants that block
     only `BLOCKED_PROTOCOLS`; allow Chromium's external-protocol handling to reach the existing
     permission policy for other schemes. Neither listener hands off to the host.
   - Do not set `overrideBrowserWindowOptions.webPreferences`. In each `did-create-window`
     callback (the registered webview path and recursive popup path), inspect the effective merged
     `details.options.webPreferences`; if either Node integration option is true, warn and destroy
     that child. The installed public typings do not declare `getLastWebPreferences`; use the
     typed `DidCreateWindowDetails.options` field at `electron.d.ts:21327-21342` instead.
     Preserve opener session/partition, inherited webview preload and sandbox, and `window.opener`.
7. **Update tracking links.** Link this README from the existing `[ ]` US-1594 dashboard line in
   `doc/active-work.md:14-22` and from the EPIC-118 task table and US-1594 scope note in
   `doc/epics/EPIC-118.md:164-217`. Keep dashboard status `[ ]`.

## Progress

- [x] 1. Add the shared IPC sender guard and endpoint rejection path.
- [x] 2. Guard the endpoint registry, renderer event, and board-pipe reply surfaces.
- [x] 3. Guard the specialized IPC families listed in the implementation plan.
- [x] 4. Validate persistent browser profile partition arguments before session access.
- [x] 5. Share browser navigation scheme decisions and guard redirects/frame navigations.
- [x] 6. Guard popup trees and assert their effective Node integration preferences.
- [x] 7. Link this task from the dashboard and EPIC-118 tracking; keep dashboard status `[ ]`.
- [x] `will-frame-navigate` blocks subframes only; the main frame stays with `will-navigate`, which
  also sends the tab its "blocked" notice.
- [x] Live checks (2026-10-02, dev build):
  - MCP round trips (renderer `script.execute`, `main.script.execute`) work, so the guarded
    `MCP_RESULT` channel and the endpoint loop accept the app window.
  - Browser tab on `https://example.com/` registered and loaded; closing it ran `clearCache`.
  - `proc.execute("echo us1594")` returned its output (runner channels).
  - `clearCache` with `persist:browser-…` succeeded. `nopersist` and `browser-incognito-x`
    resolved `undefined` without clearing.
  - Popup from the page (`window.open`): same session as the opener, `window.opener` kept.
    `file:///C:/` and `magnet:` navigations stayed on the original URL; `https://example.org/` loaded.
  - Not run live: the rejection path (no non-app frame has `ipcRenderer`; verified by reading the
    code), worker scripts, file search, Tor, and board services. All of them go through the same
    wrapper.

## Concerns

- **Sender allowlist scope:** the policy assumes all IPC registrations in the audited inventory
  belong to app windows. The source review found no IPC-enabled worker, board frame, popup, or
  hidden renderer. If a future feature adds one, it must define an explicit sender policy and
  evidence in its own task rather than weakening the default predicate.
- **Profile names:** the UI currently accepts any non-empty trimmed name and only blocks
  case-insensitive duplicates (`BrowserProfilesSectionModel.ts:52-60`). The main-side partition
  validator must therefore preserve legitimate existing names while rejecting empty values and
  malformed or out-of-namespace partition strings. Do not silently impose a narrower new name
  alphabet in this defense-in-depth change.
- **Popup preferences:** Electron 43 public typings do not declare `getLastWebPreferences`, so
  use the typed merged `details.options.webPreferences` from `did-create-window`. Its declaration
  documents the effective precedence including inherited security preferences. Do not replace
  inherited preferences because OAuth popups rely on the opener's session and `window.opener`.
- **Popup activation:** only registered webviews have `lastUserActivation`. Popups and descendants
  use block-only navigation rules; the permission policy denies unsupported external schemes.
- **Logging:** rejected attacker-controlled traffic may arrive in a loop. Emit only the first
  warning per channel and sender `WebContents`; exclude payload data.

## Acceptance Criteria

- Every `ipcMain.handle` / `ipcMain.on` registration in the listed inventory is guarded by the
  shared sender policy, including all `bindEndpoint` users through the registry loop.
- Valid IPC from any live app window main frame continues to work, including board pipe flows,
  MCP requests to non-primary windows, worker start/proxy replies, search, and browser automation.
- Board iframes, browser pages, popup frames, and non-main-frame app documents cannot invoke the
  audited IPC handlers.
- Rejected event messages are dropped; rejected invoke calls reject with the fixed authorization
  error; rejected endpoint requests receive an `Error` reply and renderer callers reject rather
  than hang; warnings are limited to the first rejection per channel and sender `WebContents`.
- `clearProfileData` and `clearCache` operate only on `persist:browser-default` or valid named
  `persist:browser-<name>` profile partitions. They reject app, file-access, Incognito, Tor,
  out-of-namespace, and malformed partition values before creating/accessing a session.
- Popup windows and recursively created descendants have block-only main-frame navigation:
  block `file:`, `app-asset:`, and every non-Chromium scheme without handing anything to the host.
  Redirect and frame handlers block only `file:` and `app-asset:`; neither hands off other URLs.
- Neither popup creation path overrides `webPreferences`; it checks merged `details.options` and
  warns and destroys a child if `nodeIntegration` or `nodeIntegrationInSubFrames` is enabled.
  Normal OAuth popups retain opener, session/partition, preload, and sandbox behavior.

## Checks

Run these checks when implementing US-1594:

- `npm run typecheck`
- `npm run lint`
- `npm run build-prod`
- **Live, dev build:** confirm a browser tab loads; Settings profile “Clear data” works; closing a
  browser tab clears its cache; a script runs through the worker; file search works; an MCP call
  reaches a second app window when one is open; and a board page with a service still works.
- **Live popup checks:** from a web page open a popup, verify navigating it to `file:///C:/` is
  blocked, then verify an OAuth-style popup keeps `window.opener` and the opener's cookies/session.
- The rejected IPC sender path cannot be exercised live because no non-app frame has app
  `ipcRenderer` access. Verify rejection behavior, warning rate limiting, and the reply error by
  reading the guarded registration code and `src/ipc/renderer/api.ts:56-69`.

## No Change Needed

- `src/preload-webview.ts` — it only uses `ipcRenderer.sendToHost` for the browser guest's title
  and favicon reports; it does not expose app IPC to page code.
- `src/renderer/editors/browser/BrowserView.ts` — it configures the browser guest and its preload;
  navigation listeners belong to the main-process webContents owner.
- `src/main/open-window.ts` — retain the app window's existing Node-enabled renderer settings; pin
  popup assertions belong in `browser-service.ts`.
- `src/main/board-bridge.ts` and board frame code — board traffic uses the established bridge and
  transferred ports; no IPC sender exception is required.
- Worker implementation internals — worker threads use `Worker` messages, and only their app
  renderer parent sends the listed worker IPC channels.
- `src/renderer/api/settings.ts` and profile settings UI — their current profile choices and
  callers define the persistent profile names; validation belongs at the main-process session
  boundary.

## Investigation References

- Epic finding and scope: `doc/epics/EPIC-118.md:142-149, 164-178, 180-217`.
- Existing sender predicate and browser IPC: `src/main/browser-service.ts:789-915`.
- Main window partition and web preferences: `src/main/constants.ts:1-2` and
  `src/main/open-window.ts:41-64`.
- Electron 43 Node preference defaults and subframe option: `node_modules/electron/electron.d.ts:19321-19329`;
  child preference precedence: [Electron window.open](https://www.electronjs.org/docs/latest/api/window-open).
- Electron 43 `did-create-window` merged options: `node_modules/electron/electron.d.ts:21327-21342`;
  `getLastWebPreferences` is absent from this installed public declaration.
- Endpoint error response semantics: `src/ipc/main/endpoint-registry.ts:18-29` and
  `src/ipc/renderer/api.ts:56-69`.
- Popup guard, registration guard, and recursive popup creation:
  `src/main/browser-service.ts:215-273, 419-449, 511-565`.
- Browser partition construction and settings actions:
  `src/renderer/editors/browser/BrowserEditorModel.ts:341-356`,
  `src/renderer/editors/settings/sections/BrowserProfilesSectionModel.ts:52-98`,
  `src/renderer/editors/browser/BrowserEditor.ts:201-205`.
- Remaining IPC registration blocks are enumerated with their channel families in Background.

## Files Changed

| File | Change |
|---|---|
| `src/main/ipc-sender-guard.ts` *(new)* | Centralize app-main-frame validation, guarded IPC registration, and rate-limited sender/channel warnings. |
| `src/ipc/main/endpoint-registry.ts` | Guard the shared endpoint loop and reply with an `Error` on rejected requests. |
| `src/ipc/main/renderer-events.ts` | Guard `RendererEvent.fileDropped`. |
| `src/ipc/main/board-pipe-handlers.ts` | Guard `BOARD_PIPE_REPLY_CHANNEL`; endpoint calls are covered by the registry. |
| `src/main/browser-service.ts` | Apply the sender guard; validate clear partitions with the exact predicate; factor navigation policy; add popup guards and merged-preference assertions. |
| `src/main/cdp-service.ts` | Guard all CDP, dialog, automation, navigation-wait, response-wait, and drag-intercept handlers. |
| `src/main/browser-network-service.ts` | Guard browser network IPC handlers. |
| `src/main/tor-service.ts` | Guard Tor IPC handlers. |
| `src/main/command-runner.ts` | Guard renderer runner channels; utility-process protocol remains main-process relayed. |
| `src/main/search-service.ts` | Guard search start and cancel events. |
| `src/main/worker-host.ts` | Guard worker start and proxy-result events. |
| `src/main/network-logger.ts` | Guard network-log invoke handler. |
| `src/main/mcp/renderer-bridge.ts` | Guard renderer MCP result events while preserving multi-window routing. |
| `doc/tasks/US-1594-ipc-sender-popup-guard/README.md` | Record the verified investigation, decisions, implementation plan, and checks. |
| `doc/active-work.md` | Link US-1594 from the existing EPIC-118 dashboard row; keep `[ ]`. |
| `doc/epics/EPIC-118.md` | Link US-1594 in the task table and link its scope note to this document. |
