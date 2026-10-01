# US-1582: Permission policy for the app and browser pages

## Status

**Status:** Completed 2026-10-01
**Priority:** High
**Epic:** None (standalone)

## Goal

Replace Electron's default permission grants with an explicit policy: Persephone-owned renderer contexts receive only the capabilities the app uses, while browser pages receive Chrome-like silent grants, ask prompts, and denials. Browser permission checks must report Chrome's undecided states, with decisions remembered per site and normal browser profile and held only in memory for Incognito and Tor.

## Background (verified 2026-10-01)

- The source contains no calls to `setPermissionRequestHandler`, `setPermissionCheckHandler`, or `setDevicePermissionHandler`; the main process configures several sessions but does not install a permission policy. Browser service only adds a `session-created` listener to clean the user agent (`src/main/browser-service.ts:724-729`), and network logging also observes newly created sessions (`src/main/network-logger.ts:204-206`). The Electron 43 declarations document request/check handlers (`node_modules/electron/electron.d.ts:13333-13359`); the deployed default is therefore currently uncontrolled by Persephone.
- The permission-check handler is synchronous and receives `webContents`, permission, `requestingOrigin`, and details; a decision store used by it must be synchronously readable in main-process memory (`node_modules/electron/electron.d.ts:13350`). Request handler permissions and check-handler permissions differ. The full verified unions and device-selection events are recorded below in the plan.
- Browser editor partitions are `persist:browser-<profile>` for normal profiles, `browser-incognito-<uuid>` for Incognito, and `browser-tor-<uuid>` for Tor (`src/renderer/editors/browser/BrowserEditorModel.ts:339-351`). The Windows SSO session classifier independently recognizes only persistent browser profiles by storage path and excludes Incognito, Tor, and app sessions (`src/main/windows-sso.ts:24-45`); that pattern can inform a shared classifier, but partition/session identity should be authoritative for permission scope.
- Session classification uses object identity for app sessions: initialize `appSession = session.fromPartition(appPartition)` and `fileAccessSession = session.fromPartition(fileAccessPersistPartition)`; Electron returns those same Session objects to `session-created` and permission handlers. Compare by identity first. Every other session is browser content or its helper; classify persistent sessions as normal profiles by `isPersistent()` plus the storage-path regex in `src/main/windows-sso.ts:38-45`, and treat non-persistent browser sessions as Incognito/Tor with decisions held in a `WeakMap<Session, ...>`. The only main-process `BrowserWindow` constructor is `OpenWindow`, which uses `appPartition`; browser webviews use browser partitions. The other main-process `session.fromPartition()` uses are browser profile/Tor network and source helpers, protocol registration on the two named app sessions, and profile cache handlers (`src/main/browser-network-service.ts:58-62,191-192`, `src/main/tor-service.ts:350,416`, `src/main/tor-src-protocol.ts:35-36`, `src/main/board-protocol-service.ts:331-333`, `src/main/session-src-protocol.ts:64-66`, `src/main/browser-service.ts:768-775`). `src/main/download-service.ts` and `src/main/network-logger.ts` only attach to `session-created` sessions and create none (`src/main/download-service.ts:38-49`, `src/main/network-logger.ts:204-206`). No other in-memory non-browser session receives web contents.
- The main window uses the in-memory `appPartition` (`src/main/constants.ts:1-2`, `src/main/open-window.ts:48-52`). Board HTML is served through `board://` on that same app session, registered once in `main-setup.ts` (`src/main/main-setup.ts:145-156`, `src/main/board-protocol-service.ts:328-333`). A trusted board is a user app and currently runs in the app renderer's shared session; the task should apply the app renderer policy to it without inventing separate per-API board gates.
- The separate `fileAccessPersistPartition` is currently only created to register the `app-asset` protocol (`src/main/main-setup.ts:115-129,145-147`); no BrowserWindow or renderer is assigned to it in `src/`. Give it explicit restrictive handlers, but do not classify it as a browser profile or grant browser permissions without a discovered consumer.
- App renderer uses of browser permission APIs found by source search are narrow: `navigator.clipboard.readText()` is used by browser URL-bar “Paste and Go” and app popup-menu paste (`src/renderer/editors/browser/BrowserUrlBarModel.ts:205-217`, `src/renderer/ui/dialogs/poppers/showPopupMenu.ts:43`); rich-text paste uses `navigator.clipboard.read()` (`src/renderer/editors/text/paste-rich-text.ts:52`). Trusted boards share the app renderer session and their built-in context menu uses `navigator.clipboard.writeText`, `navigator.clipboard.write`, and `readText` (`src/board-context-menu.ts:33,97,249`); board bridge APIs also use Electron's native clipboard without Web API focus requirements (`src/board-shim.ts:1783-1791`, `src/main/board-bridge.ts:276-291`). The selected shared app-session allow-list includes clipboard read/write plus `fullscreen` and `pointerLock` for trusted-board user apps; it does not create per-API board gates. Other app clipboard flows use the app's own Electron clipboard service/utilities (`src/main/clipboard-service.ts`, `src/renderer/core/utils/utils.ts:23`, `src/renderer/editors/shared/image-export.ts:93`). Renderer search found no `navigator.permissions`, `getUserMedia`, `getDisplayMedia`, `requestFullscreen`, `requestPointerLock`, Notifications API, MIDI/device API, or File System Access picker calls outside vendored board bundle code. All app-session permissions not in the explicit four-permission allow-list, including `mediaKeySystem`, deny.
- The browser editor mounts a webview and registers its `getWebContentsId()` with main over `BrowserChannel.register` on `dom-ready` (`src/renderer/editors/browser/BrowserView.ts:115-125`, `src/ipc/browser-ipc.ts:13-18,68-75`). `registerWebview()` resolves that id via `webContents.fromId()` and associates it with page/tab IDs (`src/main/browser-service.ts:244-265`), the existing route for prompt events to the correct tab. Session classification does not depend on this registration: the two app sessions are identified by object identity, and all other sessions use browser policy. A prompt still requires a registered browser editor tab; requests from popup webContents have no browser chrome and are denied.
- Browser pages already have host UI affordances that establish a pattern: the find bar and blocked-popup bar mount in `BrowserView.ts`; blocked popups are counted in editor state and rendered with Allow/Dismiss (`src/renderer/editors/browser/BrowserView.ts:428-439,487-518,537-542`). The downloads popup is another browser-owned affordance (`src/renderer/editors/browser/BrowserDownloadsPopup.ts:260-306`). A permission ask can be represented as another browser-owned in-page bar, but must be scoped by internal tab and hidden/settled when that page navigates, closes, or loses its matching request.
- Browser popups are currently allowed under activation/rate-limit rules and recursively guarded after `did-create-window` (`src/main/browser-service.ts:466-520`); the browser architecture explicitly documents that a popup inherits its opener webview's session partition (`doc/architecture/browser-editor.md:86-88`). Internal foreground/background tab targets are instead redirected into the browser editor. Popup webContents therefore receive browser silent grants/denials through the same Session, but Ask requests deny because a popup has no browser chrome prompt host.
- The current browser profile Settings section is the natural review/reset location. It reads `browser-profiles` and default-profile settings (`src/renderer/editors/settings/sections/BrowserProfilesSection.ts:523-536`) and is registered as the “Browser profiles” settings section (`src/renderer/editors/settings/SettingsView.ts:70`, `settings-catalog.ts:131-139`). Profile settings themselves are persisted through the existing renderer settings service (`src/renderer/api/settings.ts:110-151`); permission data should be separate from unrelated profile metadata and hydrated to main memory before any permission check.
- Existing browser external protocol behavior needs special care: browser navigation blocks dangerous protocols in `src/main/browser-service.ts:379-405`; link clicks are routed through the app's configurable open handler, whose default-browser mode calls `shell.openExternal` (`doc/architecture/browser-editor.md:714-748`); Persephone-owned links use explicit `shell.openExternal` routes (`src/renderer/content/builtin-schemes.ts:112-131`, `src/renderer/api/shell/shell-calls.ts:5-6`). Electron 43 exposes the target as `details.externalURL` (`node_modules/electron/electron.d.ts:10832-10840`). Decision: browser `openExternal` is Ask, keyed by top-level origin plus target scheme; show the target scheme/app in the prompt, require a trusted gesture, and keep the dangerous-protocol block in force before permission handling. App-owned explicit `shell.openExternal` flows remain independent of this browser permission.
- Motivation: the current unreviewed task notes that fresh browser pages expose `granted` for notifications, camera, microphone, geolocation, and clipboard-read, unlike Chrome's undecided `prompt` / `default` state; this is a privacy/security gap. The all-granted bot fingerprint is a plausible explanation for the reported Cloudflare Turnstile loop, not a proven cause.

## Implementation Plan

### Phase 1 — explicit handlers, checks, and app policy

- [x] Add a main-process permission-policy module (`src/main/permission-policy-service.ts`) and initialize it synchronously in `setupMainProcess()` before any `OpenWindow` is constructed or renderer/webview can issue requests. Install handlers on sessions already created and retain the `session-created` listener for every later session.
- [x] Install `setPermissionRequestHandler` and synchronous `setPermissionCheckHandler` on every `Session`; use Electron 43's request/check unions and make callbacks total with default-deny unknown/unmapped cases.
- [x] Classify sessions by Session object identity for app/file-access sessions. Persistent browser profiles use the existing storage-path pattern; non-persistent sessions use Session-keyed `WeakMap` decisions. `windows-sso.ts` remains unchanged.
- [x] App-session allow-list is exactly `clipboard-read`, `clipboard-sanitized-write`, `fullscreen`, and `pointerLock`; the file-access session and all other app permissions deny, including app-session `mediaKeySystem`.
- [x] Browser File System Access requests grant the picker-mediated flow; checks remain false and the decision is never stored. App-session requests deny it.
- [x] Browser `openExternal` is Ask, keyed by top-level origin and lower-case target scheme. Prompt shows only the scheme; unsupported and dangerous protocols deny. Chromium's user-activation enforcement and runtime external-protocol behavior remain for manual verification.
- [x] Browser silent request grants include `fullscreen`, `pointerLock`, `clipboard-sanitized-write`, `keyboardLock`, and `mediaKeySystem`; `display-capture` and unmapped requests deny. Ask permissions include camera/mic, geolocation, notifications, MIDI/SysEx, clipboard-read, idle-detection, window-management, speaker-selection, and `openExternal`.
- [x] Deny HID, serial, USB, Bluetooth, deprecated-sync clipboard-read, unknown, and unmapped device permissions through selection handlers and `setDevicePermissionHandler`.
- [x] Deny `storage-access` and `top-level-storage-access` for checks and requests.
- [x] Make session setup idempotent, register `session-created` and `web-contents-created` listeners before renderer startup, and explicitly install handlers for the two app sessions during the ready sequence.

Current behavior → target behavior (illustrative; final types belong in the implementation):

```ts
// Before: no permission handlers are installed; Electron's defaults apply.

// After: each session gets explicit, role-aware handlers before web content runs.
ses.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) =>
    permissionPolicy.check(ses, webContents, permission, requestingOrigin, details));
ses.setPermissionRequestHandler((webContents, permission, callback, details) =>
    permissionPolicy.request(ses, webContents, permission, callback, details));
ses.setDevicePermissionHandler(() => false);
```

### Phase 2 — browser asks, origin policy, and persistence

- [x] Use typed permission keys and key remembered decisions by profile/session, top-level origin, and permission (including target scheme for `openExternal`). Never store `fileSystem` decisions.
- [x] Use the top-level URL for registered-webContents requests/checks; nullable webContents checks use `embeddingOrigin` then `requestingOrigin`. Opaque/non-http(s) origins deny.
- [ ] Cross-origin iframe requests are permitted only when Chromium Permissions-Policy delegated that feature through the embedder's `allow` attribute/policy; Blink checks this before permission requests for APIs such as geolocation and camera/microphone. **Confirm during implementation:** run one quick check that an iframe without `allow="geolocation"` cannot trigger the handler. If Electron does reach the handler for it, deny cross-origin subframe Ask requests unless `details.isMainFrame` is true or the requesting-frame origin equals the top-level origin; compare `new URL(details.requestingUrl).origin` with the main-frame URL in the request handler, and compare `requestingOrigin` with `details.embeddingOrigin` in the check handler. Do not prompt or key decisions to the third-party frame origin.
- [x] Handle nullable `webContents` without throwing; checks are synchronous and never prompt.
- [x] Split `media` into camera and microphone decisions and combine both capabilities into one prompt when requested together.
- [x] Implement synchronous check states: remembered Allow true, Block false, undecided Ask false, silent grants true, denied/check-only permissions false; `fileSystem` checks always false.
- [x] Retain Electron callbacks pending user choice; send only request ID, top-level origin, permissions, and optional external scheme through the registered tab key. Resolution uses the main-owned request record.
- [x] Add a browser chrome permission bar with origin, capability descriptions, Allow, and Block; no registered browser tab means denial.
- [x] Keep requests pending without timeout and deny on main-frame navigation, tab unregister/close, and webContents destruction. Multiple prompts queue per browser editor; popups without browser chrome deny Ask requests.
- [x] Persist normal-profile decisions in `browser-permissions.json` under `getDataFolder()`, validate schema/origins, hydrate synchronously, and write through a temporary sibling file plus rename. Private-session decisions stay in a `WeakMap`; `fileSystem` never persists.
- [x] Extend `Settings → Browser profiles` with per-profile list/revoke-all and per-origin/per-permission removal. Main IPC accepts only the app main renderer; list access is limited to default or profiles with saved records, and mutations require an existing saved-profile record. Manual interaction remains to verify.
- [x] Keep permission persistence in main; renderer review/removal uses the main IPC contract and synchronous checks read the hydrated store.

Before → after decision-store and IPC shapes:

```ts
// Before: no typed decision store and no permission-request event in BrowserEvent.

// After: normal-profile decisions have stable origin/permission keys; private sessions stay in a WeakMap.
type PermissionDecision = "allow" | "block";
type SavedDecisions = {
    version: 1;
    profiles: Record<string, Record<string, Record<string, PermissionDecision>>>;
};

// Main → renderer BrowserChannel.event payload (renderer returns requestId + decision by IPC).
type PermissionPromptData = {
    requestId: string;
    topLevelOrigin: string;
    permissions: Array<"camera" | "microphone" | "geolocation" | "notifications" | "midi" | "midiSysex" | "clipboard-read" | "idle-detection" | "window-management" | "speaker-selection" | "openExternal">;
    externalScheme?: string;
};
type BrowserEvent = ExistingBrowserEvent | { type: "permission-request"; data: PermissionPromptData };
type ResolvePermissionRequest = { requestId: string; decision: "allow" | "block" };
```

### Phase 3 — verification, guides, and integration

- [ ] Verify fresh browser defaults in Electron 43: Ask checks return false before a decision and therefore `prompt`/`default`; Allow/Block updates checks consistently.
- [ ] Verify app renderer and trusted boards retain clipboard read/write, fullscreen, and pointer-lock behavior. The app-session allow-list is exactly `clipboard-read`, `clipboard-sanitized-write`, `fullscreen`, and `pointerLock`; `mediaKeySystem` and every other permission are denied.
- [ ] Verify browser camera and microphone are separate remembered decisions, including one combined prompt for a request asking for both; verify geolocation/notification and other Ask prompts show the top-level origin.
- [ ] Verify Widevine DRM remains available in browser sessions, display capture stays denied in this task, and dangerous external protocols remain blocked even after `openExternal` Allow.
- [ ] Verify no registered browser prompt host exists for popup windows: their session policy still grants silent permissions and denies Ask/device requests.
- [ ] Verify profile decisions survive restart and remain isolated; profile removal cleans decision data; Incognito/Tor choices stay in their Session-keyed WeakMap and never reach disk. Verify `fileSystem` checks remain false after browser restart while its request still uses the picker.
- [ ] Keep automation and MCP non-privileged. No permission-grant API is added; page-initiated Ask requests follow the same user prompt and remain pending until the user acts or the documented lifecycle cancellation occurs.
- [ ] Update user guides after implementation: `assets/guides/editors/browser.md`, `assets/guides/screens/settings.md`, `assets/guides/editors/index.md` if required, and `assets/guides/whats-new.md`. Update `doc/architecture/browser-editor.md` to document session classification, check/request behavior, and prompt IPC ownership.

### Phase 4 — site permissions popover

- [x] Add a mutually exclusive site-permissions icon button in the URL input start slot: retain the search-engine chip whenever `urlBar.showSearchEngineSelector` is true; otherwise show the button only for the active tab's current HTTP(S) URL while the user is not typing. Hide it for blank, file, internal, and other non-web URLs. Give it the `Site permissions` tooltip and a `data-name` identifier.
- [x] Anchor a UIKit `PopoverView` below the button. Its title is the current origin; list Camera, Microphone, Location, Notifications, MIDI, MIDI full control (SysEx), Clipboard read, Device use (idle detection), Window management, Speaker selection, and remembered `openExternal:<scheme>` decisions as “Open <scheme> links”. Use controlled UIKit switches; undecided entries appear off with a muted “Ask” hint.
- [x] Add Reload and Reset permissions actions. Reset returns every decision for the current origin in the current session scope to Ask. After changing a decision, show “Reload the page to apply” and a Reload action because Chromium does not revoke live grants such as an active camera stream.
- [x] Add typed main-process IPC requests keyed only by the browser registration key (`tabId`/`internalTabId`). Main resolves the owning registration to its `webContents`, Session, and current top-level HTTP(S) origin; do not accept a renderer-selected profile or origin. Return entries for all promptable keys and remembered external-protocol keys.
- [x] Validate that the caller is the app renderer owning the registration. Return an empty result or `false` for invalid callers, app/file-access Sessions, invalid registration, and non-HTTP(S) origins. Setting accepts only `allow`/`block` for a promptable key or an existing supported `openExternal:<scheme>` entry and writes through `saveDecision`; reset removes all decisions for the origin in that Session/profile scope.
- [x] Keep the Browser Profiles Settings view reading the same live store so changes from the popover are reflected without a cached duplicate. Remove the duplicate identical `settlePermissionRequestsForWebContents` / `denyPermissionRequestsForWebContents` implementation and update callers to the single function.
- [x] Keep popover visibility/transient UI state out of `getRestoreData()` and mutate editor state only through `state.update()`.

**Acceptance criteria:**

- [x] Search-engine selection and site-permissions controls are mutually exclusive in the URL start slot; the permissions button appears only on a navigated HTTP(S) origin when the URL is not being edited.
- [x] The popover lists every promptable permission and remembered supported external-protocol decision for the active origin with Allow/Block switches; undecided entries are off and visibly marked “Ask”.
- [x] Reset clears all current-scope decisions for that origin; each permission change offers a Reload action and applying a choice does not claim to revoke a live grant before reload.
- [x] IPC derives registration, Session/profile scope, and origin in main. Invalid/non-owning renderers, app/file-access Sessions, non-web URLs, invalid keys, and unsupported external schemes cannot read or mutate decisions.
- [x] Normal profile choices use the existing persisted store; Incognito/Tor choices use their Session memory store. Browser Profiles settings observes the same decisions.
- [x] Transient popover state is not restored with the editor, state writes use `state.update()`, and only one webContents permission-settlement function remains.

## Concerns / Open Questions

No unresolved policy decisions block implementation. The following decisions are fixed:

- `fileSystem`: browser request returns Allow because the File System Access picker is the user's consent; check always returns false, so grants do not persist across reloads. App and board session denies it. Do not persist site-level `fileSystem` decisions.
- `openExternal`: Ask with the target read from `details.externalURL`; remember per top-level origin and target scheme (`openExternal:<scheme>`), matching Chrome's per-site/per-app choice. Dangerous and unsupported schemes remain blocked before an Allow can take effect.
- `display-capture`: deny in this task. There is no `setDisplayMediaRequestHandler` in `src/`, so getDisplayMedia does not work today. A desktopCapturer-backed source picker is a separate follow-up.
- Pending permission requests have no timeout. Deny and clear them on main-frame navigation, tab close/unregister, or webContents destruction.
- Cross-origin iframe Ask requests belong to the top-level origin and require Permissions-Policy delegation; the one runtime check and conservative fallback are in Phase 2/3.
- Popup `webContents` inherits the opener's browser Session and therefore receives the same browser policy; because it has no registered browser chrome, deny Ask requests.
- Browser profiles persist decisions in main-process JSON; Incognito/Tor use Session-keyed memory only. No scripting/MCP permission-grant API is provided.

### Known limitations (found after implementation, 2026-10-01)

- **Undecided permissions read `denied`, not `prompt`.** Electron maps a `false` from the
  permission check handler to `denied` and has no "prompt" result, so a never-visited site sees
  `Notification.permission === "denied"` and `permissions.query(...).state === "denied"` instead of
  Chrome's `default` / `prompt`. Requests still reach the Allow/Block prompt. A main-world override
  of `navigator.permissions` / `Notification` would be detectable; carried to
  [US-1584](../US-1584-cloudflare-challenge/README.md).
- **Cross-origin iframe delegation not verified at runtime.** Requests from cross-origin frames are
  attributed to the top-level origin without checking frame/delegation details (review finding);
  the runtime check from Phase 2 was not run. Carried to US-1584.

## Acceptance Criteria

- [ ] Every Electron session used by app, board, browser, file access, and Tor has explicit request, check, and device-permission behavior; unmapped permissions deny.
- [ ] App main renderer and trusted boards receive exactly `clipboard-read`, `clipboard-sanitized-write`, `fullscreen`, and `pointerLock`; all other permissions, including `mediaKeySystem`, deny. There are no per-API board exceptions.
- [ ] A fresh browser origin gets Chrome-like default states: undecided Ask checks return false to Electron and therefore `navigator.permissions.query()` is `prompt` and `Notification.permission` is `default`.
- [ ] Browser silent grants remain available only under their user-gesture rules; `mediaKeySystem` keeps Castlabs Widevine DRM; `display-capture` is denied; device APIs are denied.
- [ ] Ask permissions show an Allow/Block prompt labeled with the top-level origin in the correct browser tab. Normal decisions persist per top-level site, permission, and profile; `openExternal` is additionally keyed by target scheme. Incognito/Tor decisions are Session-memory-only and review/reset is available in Browser Profiles settings.
- [ ] Cross-origin iframe requests use the top-level origin and prompt only when Chromium Permissions-Policy delegates the feature; opaque/non-http(s) top-level origins deny. If the runtime check shows Electron reaches the handler without delegation, cross-origin Ask requests deny unless the frame is same-origin or main-frame.
- [ ] Null-webContents permission checks resolve by Session plus origin and never throw. Camera and microphone are distinct decisions; a combined request produces one prompt covering both.
- [ ] Popup webContents inherit the opener's Session and therefore receive browser silent grants/denials; Ask requests from popups deny because no browser chrome is registered.
- [ ] Pending Ask requests have no timeout and are denied/cleared on main-frame navigation, tab close/unregister, or webContents destruction.
- [ ] Browser File System Access request is granted to retain picker-based user consent while permission checks remain false and no site decision is stored. `openExternal` prompts show `details.externalURL` scheme/app, remember per origin and scheme, and never override dangerous-protocol blocking.
- [ ] Scripting/MCP cannot silently grant a permission.
- [ ] User-facing browser and Settings guides describe prompts and review/reset behavior.
- [ ] Site permissions are available from the URL bar for eligible web pages, and reset/reload behavior is clear.

## Files that need NO changes

- `src/main/constants.ts`: reuse existing app and file-access partition constants; their values do not change.
- `src/main/open-window.ts`: the app BrowserWindow already uses `appPartition`; central session policy covers it.
- `src/main/tor-service.ts`, `src/main/browser-network-service.ts`, `src/main/tor-src-protocol.ts`: these use browser/Tor partitions already covered by central session handlers; they do not own permission policy.
- `src/main/session-src-protocol.ts`, `src/main/board-protocol-service.ts`: they register protocols on caller-provided sessions and do not create independent web-content sessions.
- `src/main/download-service.ts`, `src/main/network-logger.ts`: they only attach listeners to `session-created` sessions and do not create sessions or own permission decisions.
- `src/main/windows-sso.ts`: reuse its persistent-profile storage-path classifier; no SSO policy change is needed.
- `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts`, browser API declarations, and `src/main/mcp/`: no permission-grant API is added to scripting or MCP.
- `assets/guides/index.md`, `assets/guides/editors/index.md`, and `assets/guides/screens/index.md`: existing Browser, Settings, and What's New guide entries already link these pages; no navigation changes are needed.
- `doc/active-work.md`: US-1582 is already linked under Planned and remains there.

## Files Changed Summary

| File | Planned change |
|---|---|
| `src/main/permission-policy-service.ts` (new) | Session classification, handlers, decision memory/persistence, pending requests, origin validation, device-deny behavior, and scoped site-permission get/set/reset |
| `src/main/main-setup.ts` | Initialize policy before sessions can request permissions; hook created sessions |
| `src/main/browser-service.ts` | Route ask requests to registered tabs, validate webContents mapping, settle on lifecycle end; define popup Ask behavior |
| `src/ipc/browser-ipc.ts` | Permission prompt, decision/review, and registration-keyed site-permission IPC contracts |
| `src/renderer/editors/browser/BrowserWebviewModel.ts` | Receive main-process permission event and forward to model/view |
| `src/renderer/editors/browser/BrowserEditorModel.ts` | Pending ask UI state, site-permission popover state/actions, reload/reset behavior |
| `src/renderer/editors/browser/BrowserEditor.ts` | Permission event registration, navigation cleanup, decision and site-permission IPC |
| `src/renderer/editors/browser/BrowserView.ts`, `src/renderer/editors/browser/BrowserView.css` | Origin-bound Allow/Block prompt bar and URL-bar site-permissions popover |
| `src/renderer/editors/settings/sections/BrowserProfilesSection.ts` and `BrowserProfilesSectionModel.ts` | Review/revoke per-profile site permissions |
| `assets/guides/editors/browser.md` | Explain browser permission prompts, file picker/external protocol decisions, and profile-scoped permissions |
| `assets/guides/screens/settings.md` | Document review/reset controls in Browser Profiles settings |
| `assets/guides/whats-new.md` | Announce the browser permission policy |
| `doc/architecture/browser-editor.md` | Document session classification, check/request behavior, and prompt IPC ownership |
