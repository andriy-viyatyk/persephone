# US-1597: Device permissions for board frames

Epic: [EPIC-119: Board permissions](../../epics/EPIC-119.md)

## Goal

Enforce board-granted Chromium permissions for `board://<host>` frames in the app session using a main-owned host-to-root registry and the board trust snapshot. Restrict iframe delegation and close every other device or permission surface reachable from a board frame while preserving the exact legacy behavior.

## Background

EPIC-119 makes object-form permissions enforced and off by default, with the granted set captured in main-owned trust state. The US-1593 inventory rows 9 and 29 assign browser clipboard reads, device permissions, iframe delegation, and nested-frame origin checks to this task. US-1596 is implemented: its current source keeps board-root file serving and hosted-document pipes separate from Chromium device permissions; this task must not alter that file-access behavior.

### Verified current behavior

- Board frames are created by `BoardWebview.createIframe()` as `board://<host>/...` frames and currently receive the fixed `allow="clipboard-read; clipboard-write"` (`src/renderer/editors/board/BoardWebview.ts:480-487`). Main and secondary-view frames use this same constructor and the same `BoardWebview` class.
- Every app-session permission request and check currently returns `APP_ALLOW.has(permission)`, without looking at the requesting origin, board root, or board grant (`src/main/permission-policy-service.ts:29, 163-166, 188-191`). `APP_ALLOW` is exactly `clipboard-read`, `clipboard-sanitized-write`, `fullscreen`, and `pointerLock`; at the handler layer this grants clipboard read/write and fullscreen/pointer lock to any requester in the app session, including a `null`/opaque or other non-app origin if it reaches the handler. Camera, microphone, geolocation, notifications, display-capture, MIDI, idle detection, window management, speaker selection, keyboard lock, storage access, HID, serial, USB, and other unlisted permissions are not allowed through these two handlers.
- For non-app sessions, the existing `requestKeys()` maps `mediaTypes` video/audio to camera/microphone, and `handleRequest()` requires every mapped key to be allowed before it accepts combined media access (`src/main/permission-policy-service.ts:139-155, 188-212`). This existing behavior does not apply to the app session because its early `APP_ALLOW` return takes precedence.
- `setDevicePermissionHandler(() => false)` denies default HID/serial/USB device grants; `denySelection()` cancels HID, serial, and USB selection. A `web-contents-created` listener cancels Bluetooth device selection (`src/main/permission-policy-service.ts:157-161, 240-241, 354-358`). These are already denied for board frames and remain denied.
- There is no `setDisplayMediaRequestHandler` registration in `src`. The `display-capture` request is denied by the app-session `APP_ALLOW` return (`src/main/permission-policy-service.ts:188-191`); implementation will also install an explicit board-safe display-media denial so `getDisplayMedia()` has no source-selection path.
- Electron 43 declares `isMainFrame` on both permission request details and permission-check details (`node_modules/electron/electron.d.ts:10889-10900, 22943-22965`). Classify the app UI structurally with `details.isMainFrame === true`: the app window's main frame is the app UI, while boards, HTML previews, and other embedded content are subframes. This avoids comparing file-origin strings because the production window uses `loadFile()` while development uses the Vite URL (`src/main/open-window.ts:247-249`). Request details also carry `requestingUrl`; media requests add `mediaTypes` and `securityOrigin`; the permission-check callback supplies `requestingOrigin`, while details supply `mediaType` and `requestingUrl` (`node_modules/electron/electron.d.ts:9526-9535, 10889-10900, 13350, 22943-22965`). `setPermissionRequestHandler` includes `display-capture`, `keyboardLock`, `speaker-selection`, `window-management`, and `unknown`; `setPermissionCheckHandler` includes `midi`, `midiSysex`, `hid`, `serial`, `usb`, `storage-access`, and related checks but not keyboard lock or display-capture (`node_modules/electron/electron.d.ts:13350-13359`). The display-media handler's callback accepts `Streams` with optional sources, so `{}` is the typed no-source denial (`node_modules/electron/electron.d.ts:13333, 21441-21460, 23630-23642`).
- `local-fonts` and `persistent-storage` are not named in Electron 43's permission unions. No repository handler or board response policy currently names either capability. The Local Font Access API has a `local-fonts` Permissions Policy feature ([spec](https://wicg.github.io/local-font-access/)); object-form board HTML must explicitly disable it. Persistent-storage requests, if surfaced to the app-session request/check handlers, must hit the default-deny path; ordinary origin-scoped board storage stays as it is.
- Electron browser `Notification` is the web Notifications API, separate from Electron's main-process `Notification` class. Since app-session `notifications` is absent from `APP_ALLOW`, a board's web notification permission request is denied today, so it cannot post a web notification. Granting the board's `notifications` flag will allow that web API for its board origin; it does not expose Electron's main-process class (`src/main/permission-policy-service.ts:29, 188-191`; [Electron Notification API](https://www.electronjs.org/docs/latest/api/notification) distinguishes main-process `Notification` from the renderer Web Notifications API).
- `BOARD_CSP` includes `frame-src 'self'`, so board HTML can nest same-origin `board://<host>` frames only; remote, `data:`, and `blob:` frame sources are blocked by this directive (`src/main/board-protocol-service.ts:71-90`). Same-origin secondary frames, repeated frames for one board, and the same board open in multiple tabs/windows all have the same unforgeable browser origin, which page script cannot forge. Permission identity therefore comes from Chromium's requester origin only: use `requestingOrigin` for checks, the origin of `details.requestingUrl` for ordinary requests, and `securityOrigin` for media when supplied; resolve a `board://<host>` to its root with the main-owned `getBoardRootForHost()` registry and fetch that root's granted snapshot. Unknown hosts or missing trust grants deny.
- The app session also contains an opaque sandboxed HTML preview. `HtmlBodyView` sets `sandbox="allow-scripts"` without `allow-same-origin` and navigates to `html-preview://...` (`src/renderer/editors/html/HtmlBodyView.ts:62-65, 118`); its source does not read the clipboard or delegate `clipboard-read`. A board can likewise make an opaque sandboxed nested frame. `details.isMainFrame === true` preserves `APP_ALLOW` for the app UI; every subframe is classified by its browser-provided requester origin. A `board://<host>` subframe uses that board's grant, while `null`/opaque and all other non-board subframes preserve only `fullscreen` and `pointerLock`; deny `clipboard-read` and every device permission. This prevents opaque frames from inheriting app-session clipboard access through the current blanket `APP_ALLOW` rule.
- The app's existing browser clipboard-read callsites are renderer-owned UI (`src/renderer/editors/text/paste-rich-text.ts:50-64`, `src/renderer/ui/dialogs/poppers/showPopupMenu.ts:30-44`, and the Browser URL bar at `src/renderer/editors/browser/BrowserUrlBarModel.ts:206-218`); these execute in the app window's main frame and keep clipboard access. Browser page contents use their separate profile session and site-permission prompt path (`src/main/permission-policy-service.ts:163-185`, `src/main/browser-service.ts:836-844`). Board paste is the separate board-origin callsite (`src/board-context-menu.ts:247-256`) and will follow the board's `clipboardRead` flag. Markdown sanitizer strips iframe tags (`src/renderer/editors/markdown/markdown-sanitize.ts:43-61`); markdown/notebook previews have no separate non-app frame or clipboard-read callsite. No existing opaque or other non-app-origin content requires `APP_ALLOW` clipboard-read.
- Legacy manifests normalize to `{ kind: "legacy", service }`; `boardTrustService` treats legacy grants as allowed for all flags except `service` (`src/shared/board-manifest-utils.ts:40-74`, `src/main/board-trust-service.ts:169-178`). Preserve the current app-session result for legacy board frames exactly: clipboard read/write, fullscreen, and pointer lock remain allowed; camera, microphone, geolocation, notifications, and other device permissions remain denied. Do not give legacy boards new device access.
- The current `BOARD_BRIDGE_VERSION` and `OBJECT_PERMISSION_BRIDGE_VERSION` are both `1.30.0` (`src/shared/board-bridge-version.ts:2`, `src/shared/version-utils.ts:54-56`). US-1597 changes bridge-visible behavior, so implementation must bump `BOARD_BRIDGE_VERSION` to `1.31.0`. Leave `OBJECT_PERMISSION_BRIDGE_VERSION` at `1.30.0`: it records the first bridge that understands object-form permissions, not the current bridge release. Boards relying on this new enforcement continue to use the already-defined flags and object-form compatibility requirement.

### Remaining browser and device permission inventory

| Surface | Current app-session behavior verified in source | US-1597 object-form board behavior |
|---|---|---|
| Camera (`getUserMedia` video) | `media` is absent from `APP_ALLOW`; request and check are denied. | Allow only with granted `camera` for the requesting `board://<host>` origin. |
| Microphone (`getUserMedia` audio) | `media` is absent from `APP_ALLOW`; request and check are denied. | Allow only with granted `microphone` for the requesting `board://<host>` origin. |
| Combined camera + microphone request | App-session `media` is denied without inspecting `mediaTypes`. | Allow only when both `camera` and `microphone` are granted. |
| Geolocation | Absent from `APP_ALLOW`; request and check are denied. | Allow only with granted `geolocation`. |
| Web Notifications | `notifications` is absent from `APP_ALLOW`; request and check are denied. | Allow only with granted `notifications`; web `Notification` can then post OS notifications. |
| Clipboard read / deprecated sync read | `clipboard-read` is in `APP_ALLOW` and the iframe currently delegates reads. `deprecated-sync-clipboard-read` is not in `APP_ALLOW`. | Gate `clipboard-read` by `clipboardRead`; deny deprecated sync read. Legacy keeps today's clipboard-read behavior. |
| Clipboard write | `clipboard-sanitized-write` is in `APP_ALLOW`; `clipboard-write` is delegated by the iframe. | Keep writes allowed; this does not grant clipboard read. |
| Display capture / `getDisplayMedia` | `display-capture` requests are denied by the app-session handler; no `setDisplayMediaRequestHandler` is registered in source. | Explicitly deny display capture; camera/microphone flags do not imply screen capture. |
| WebHID | `hid` check is not in `APP_ALLOW`; `select-hid-device` cancels selection; `setDevicePermissionHandler` returns false. | Deny. |
| WebSerial | `serial` check is not in `APP_ALLOW`; `select-serial-port` cancels selection; `setDevicePermissionHandler` returns false. | Deny. |
| WebUSB | `usb` check is not in `APP_ALLOW`; `select-usb-device` cancels selection; `setDevicePermissionHandler` returns false. | Deny. |
| Web Bluetooth | No Bluetooth permission is in `APP_ALLOW`; `select-bluetooth-device` is prevented and callback receives an empty ID. | Deny. |
| MIDI / MIDI SysEx | `midi` and `midiSysex` are absent from `APP_ALLOW`. | Deny. |
| Idle detection | `idle-detection` is absent from `APP_ALLOW`. | Deny. |
| Window management | `window-management` is absent from `APP_ALLOW`. | Deny. |
| Storage Access API | `storage-access` and `top-level-storage-access` are absent from `APP_ALLOW`. | Deny. |
| Persistent storage request | Not named in Electron 43's permission unions and no repository-specific gate exists. If Chromium surfaces a request to the app-session handlers, the current `APP_ALLOW` default denies it. | Keep request/check paths fail-closed; this permission concerns the board origin's own storage durability, not access to app files or other origins. |
| Local Font Access | Not named in Electron 43's permission unions and no repository-specific policy header exists; current behavior follows Chromium. | Deny for object-form board documents with `Permissions-Policy: local-fonts=()`; this API is not covered by Electron's generic handlers. |
| Speaker selection | `speaker-selection` is absent from `APP_ALLOW`. | Deny. |
| Keyboard lock | `keyboardLock` is denied by the app-session `APP_ALLOW` early return. | Deny. |
| Pointer lock / fullscreen | Both are explicitly in `APP_ALLOW`. | Keep allowed for boards, including object-form boards. |

## Implementation Plan

- [x] In `src/main/permission-policy-service.ts`, add a main-owned app-session resolver. In both permission callbacks, first preserve `APP_ALLOW` only when `details.isMainFrame === true` (the app UI main frame). For subframes, use Chromium's requesting origin: `requestingOrigin` for checks, the origin of `details.requestingUrl` for requests, and `securityOrigin` for media when supplied. If a subframe origin is `board://<host>`, resolve `<host>` with `getBoardRootForHost()` and read only that root's main-owned granted snapshot. Unknown hosts or missing grants deny; never read a board manifest or accept a board-supplied root/grant. Every other subframe origin, including opaque/`null`, receives only `fullscreen` and `pointerLock`; deny clipboard reads/writes and every device permission. Do not compare origin strings to identify the app UI: production loads it with `loadFile()` and Chromium's file-origin serialization is not stable across APIs.
- [x] Apply that resolver in both `handleRequest()` and `handleCheck()` before the current `APP_ALLOW` shortcut. For object-form boards, map `camera` and `microphone` to Electron's `media` permission; map `geolocation`, `notifications`, and `clipboard-read` (`clipboardRead` flag) directly. For `mediaTypes`, require every requested feature: video requires `camera`, audio requires `microphone`, and a request containing both is allowed only if both are granted. In permission checks, use `details.mediaType` and deny `unknown` or missing media types. Keep `clipboard-sanitized-write`, `fullscreen`, and `pointerLock` allowed as today.
- [x] Use only the browser-provided, page-unforgeable requesting origin as board identity. For a request, derive it from `details.requestingUrl`; for media use `securityOrigin` when present and require it to agree with the URL-derived origin. For a check use `requestingOrigin`. Use `details.isMainFrame === true` to identify the app UI in either callback; all board and preview documents are subframes. The board CSP's `frame-src 'self'` prevents foreign nested frame URLs; all ordinary nested board frames and repeated board instances have the same `board://<host>` origin and therefore resolve to the same main-owned root. Do not walk or disambiguate a frame tree. An opaque `null` requester or any other non-board subframe origin gets only fullscreen and pointer lock and cannot inherit the board's clipboard-read grant.
- [x] For object-form board origins, allow a requested browser permission immediately when its matching stored grant is true. Do not show a per-use prompt: trust approval already approved this exact grant set, and a second prompt would add a conflicting permission decision path. Re-check the trust snapshot on each request/check so a changed manifest cannot widen access before re-trust. Keep non-board app-session behavior and existing browser-site prompts unchanged.
- [x] Handle `media` requests with `details.mediaTypes` as an all-of check in the request callback; do not allow a mixed video/audio request when only one of the two flags is granted. Map the result to Chromium's single `media` callback. Keep the check-handler media type checks consistent with request handling.
- [x] In `src/renderer/editors/board/BoardWebview.ts`, make `createIframe()` async and await `boardTrust.getGrantedPermissions(this.props.boardRoot)` before `document.createElement("iframe")`. Do not create or navigate the frame until the snapshot resolves; if no grant is returned, keep the frame unloaded and fail closed. Build `iframe.allow` from the snapshot, set it before assigning `iframe.src`, and include `camera`, `microphone`, `geolocation`, `notifications`, and `clipboard-read` only when their corresponding object-form flags are granted; keep `clipboard-write` delegated and preserve today's clipboard-read delegation for legacy grants. Do not delegate display capture, local fonts, MIDI, or other ungranted features. `registerBoard()` must await `createIframe()`.
- [x] Add a grant-snapshot change notification in `src/renderer/api/board-trust.ts` for authoritative trust refresh/re-trust. `BoardWebview` subscribes to it; when this board's granted set changes (including US-1598 re-trust with the same trusted path list), remove and recreate its iframe so Chromium applies the new `allow` policy on navigation. Reuse the registered host and await the refreshed snapshot before assigning the new frame's `src`. Primary and secondary instances use the same `BoardWebview` behavior.
- [x] In `src/main/permission-policy-service.ts`, explicitly install `setDisplayMediaRequestHandler()` for the app session and deny requests with an empty `{}` streams object; do not grant screen/window/system-audio capture under `camera` or `microphone`. Keep board `display-capture` denied. Continue to deny HID/serial/USB through `setDevicePermissionHandler` and their selectors, and Bluetooth through `select-bluetooth-device`.
- [x] In `src/main/permission-policy-service.ts`, explicitly default-deny `midi`, `midiSysex`, `idle-detection`, `window-management`, `storage-access`, `top-level-storage-access`, `persistent-storage` if surfaced, `speaker-selection`, `keyboardLock`, `hid`, `serial`, and `usb` for object-form boards. Preserve only the currently allowed `fullscreen` and `pointerLock` among this inventory. For `local-fonts`, add a `Permissions-Policy: local-fonts=()` header for object-form board HTML in `src/main/board-protocol-service.ts`; this API is not exposed through Electron 43's permission-handler type surface.
- [x] In `src/main/board-protocol-service.ts`, add the permission policy response header while serving board HTML when the main-owned granted snapshot is `{ kind: "flags" }`. Keep the existing CSP and board root/pipe handling intact. The policy must disallow local-font enumeration and must not accidentally expand iframe delegation; do not infer object-form status from a board-supplied live manifest.
- [x] Preserve the exact existing legacy grant behavior under the app session. The static `APP_ALLOW` behavior remains the fallback for legacy boards and other app content; legacy `clipboard-read` remains enabled through its existing `APP_ALLOW` path, and legacy boards receive no new camera, microphone, geolocation, or notifications access. Keep device selection denied for legacy boards as it is today.
- [x] Bump `BOARD_BRIDGE_VERSION` in `src/shared/board-bridge-version.ts` from `1.30.0` to `1.31.0` and update the board authoring guide's current-version note. Do not change `OBJECT_PERMISSION_BRIDGE_VERSION` in `src/shared/version-utils.ts`; it marks the first bridge release that understands object-form permissions, `1.30.0`.

### Before → after

```ts
// Before: every app-session origin receives the same fixed allow set.
if (ses === appSession) return APP_ALLOW.has(permission as string);
iframe.allow = "clipboard-read; clipboard-write";

// After: identify the app UI structurally; board identity comes from Chromium's origin.
if (details.isMainFrame === true) return APP_ALLOW.has(permission as string);
const origin = requesterOrigin(details); // requestingOrigin for checks
if (isBoardOrigin(origin)) return allowFromGrantedBoardSnapshot(origin, permission, details);
return permission === "fullscreen" || permission === "pointerLock";

// Await before creating/navigating: Chromium reads `allow` when the frame navigates.
const grant = await boardTrust.getGrantedPermissions(this.props.boardRoot);
const iframe = document.createElement("iframe");
iframe.allow = grantedIframeFeatures(grant, { clipboardWrite: true });
iframe.src = boardUrl;
```

## Concerns

- Electron request and check details differ: checks provide `requestingOrigin`; requests carry `requestingUrl`, with media requests also carrying `securityOrigin`. The policy uses those browser-provided origins directly and maps registered board hosts to main-owned roots. Opaque and other non-app/non-board requesters do not inherit clipboard read or device permissions.
- The `media` request callback is one boolean even when the request asks for video and audio. It must require every requested type; partial approval must not accidentally grant both streams.
- Only same-origin `board://<host>` navigable children are allowed by the current board CSP. Opaque sandboxed children are handled by the `null`-origin deny rule; repeated same-origin board frames and copies of a board across tabs/windows resolve to the same board root without an ambiguity check.
- The `allow` attribute is applied at navigation. `createIframe()` must await a known main-owned grant before constructing the iframe and set the complete attribute before `src`; a US-1598 grant change must invalidate/recreate the frame after the refreshed grant snapshot arrives.
- `details.isMainFrame === true` preserves existing clipboard reads in the app UI's text editor paste flow, popup paste menus, and Browser URL bar. This is production-safe across Vite `http://` and `loadFile()` `file://` app URLs because it does not compare serialized origins. Browser page content remains under separate profile-session prompts. HTML preview runs in an opaque sandboxed subframe and has no clipboard-read callsite; Markdown sanitization blocks iframe tags; no Markdown/notebook preview needs non-app-origin clipboard access.
- Local Font Access is outside the Electron 43 permission unions, so denying it through the generic permission handlers is not sufficient. The object-form board response policy is required; the directive is `Permissions-Policy: local-fonts=()`.
- `persistent-storage` is not named in Electron 43's declarations. Keep its request/check behavior explicitly default-deny if Chromium surfaces it to these handlers; ordinary board-origin storage remains available and is not a grant of app files or another origin's data.
- Web notifications are an OS-visible side effect. The `notifications` flag intentionally grants that web API directly after trust approval; it does not expose main-process `Notification` or any other Electron API.
- No per-use prompt is proposed. A trust-time grant is the user's approval, and runtime checks consult that immutable granted snapshot until the separate US-1598 re-trust flow replaces it.
- No unit tests are part of this task-document change, per project workflow.

## Acceptance Criteria

- [ ] `setPermissionRequestHandler` and `setPermissionCheckHandler` enforce `camera`, `microphone`, `geolocation`, `notifications`, and `clipboardRead` for object-form board origins using only the main-owned granted snapshot.
- [ ] Requesting origin is resolved through the main-owned `board://` host-to-root registry; the caller cannot supply a board root or permissions. Same-origin board frames use that root's grant, and opaque requesters receive no board grant.
- [ ] Identity uses only Chromium's requester origin. Same-origin secondary frames, duplicate board frames, and the same board in multiple tabs/windows resolve to the same root grant. Unknown board hosts and missing trust grants fail closed.
- [ ] In both permission callbacks, `details.isMainFrame === true` preserves current `APP_ALLOW` for the app UI regardless of whether its URL is a Vite `http://` URL or production `file://` URL. For subframes, a `board://<host>` origin uses its registered board grant; `null`/opaque and every other non-board app-session requester receive only fullscreen and pointer lock, with clipboard reads/writes and all device permissions denied. Verified app-session clipboard readers and the effect of this rule are listed in Background.
- [ ] Combined media requests require every requested `mediaTypes` grant; check-handler `mediaType: "unknown"` fails closed.
- [ ] An enabled trust-time flag is allowed without a per-use prompt; the task's recommendation and rationale are recorded here.
- [ ] Main and secondary board iframe `allow` attributes list only granted device/read features, with clipboard write remaining delegated.
- [ ] `BoardWebview.createIframe()` awaits the grant snapshot before creating/navigating the frame and assigns `allow` before `src`. A grant change from US-1598 refreshes the snapshot and recreates the frame so Chromium evaluates the new delegation.
- [ ] Inventory covers display capture, HID/serial/USB/Bluetooth, MIDI/SysEx, idle detection, window management, storage access, persistent storage, local fonts, speaker selection, keyboard lock, clipboard write, fullscreen, and pointer lock, with each denied, harmless, or preserved as current behavior.
- [ ] Electron `Notification` distinction and the board web `Notification` behavior are documented; `notifications` gates only the web API.
- [ ] Legacy grants preserve the exact app-session behavior: clipboard read/write, fullscreen, and pointer lock remain allowed; devices and other permissions remain denied.
- [ ] `BOARD_BRIDGE_VERSION` is bumped from `1.30.0`; `OBJECT_PERMISSION_BRIDGE_VERSION` remains `1.30.0`.
- [ ] No implementation or unit tests are included in this task-document task.

## Files requiring no changes

| File | Reason |
|---|---|
| `src/shared/board-manifest-utils.ts` | All five object-form flags already exist and normalize to false by default; legacy normalization already exists. |
| `src/main/board-trust-service.ts` | It already exposes the main-owned granted snapshot by canonical board root; this task consumes it. |
| `src/shared/version-utils.ts` | `OBJECT_PERMISSION_BRIDGE_VERSION` continues to mark first support for object-form permissions (`1.30.0`); this task only advances the current bridge release. |
| `src/main/board-bridge.ts`, `src/main/board-file-access.ts`, `src/main/board-pipe-service.ts` | US-1597 is limited to Chromium frame permissions and does not change bridge or file authorization. |
| `src/renderer/editors/board/board-pipe-handler.ts`, `src/renderer/editors/board/BoardEditorModel.ts` | US-1596 hosted-document and board-pipe behavior is already implemented and is outside this task. |
| `node_modules/electron/electron.d.ts` | Read-only Electron 43 signature reference; do not edit vendored declarations. |

## Files Changed

| File | Planned change |
|---|---|
| `src/main/permission-policy-service.ts` | Resolve board origins to main-owned grants; enforce request/check handlers; explicitly deny remaining permission and device surfaces; deny display capture. |
| `src/main/board-trust-service.ts` | Expose synchronous reads of the already-built main-owned granted snapshot for Chromium's synchronous permission-check callback. |
| `src/renderer/editors/board/BoardWebview.ts` | Build the iframe `allow` list from granted flags for primary and secondary views. |
| `src/renderer/api/board-trust.ts` | Publish authoritative grant-snapshot changes so board frames can reload their iframe delegation after re-trust. |
| `src/main/board-protocol-service.ts` | Add an object-form-only `Permissions-Policy` response header to block local font access. |
| `src/shared/board-bridge-version.ts`, `assets/guides/agents/boards.md` | Bump `BOARD_BRIDGE_VERSION` to `1.31.0` and keep the guide's current-version note aligned. |
| `doc/active-work.md` | Link the US-1597 dashboard row to this task document and keep `[ ]`. |
| `doc/epics/EPIC-119.md` | Link the US-1597 task row to this document. |
