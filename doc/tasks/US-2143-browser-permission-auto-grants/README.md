# US-2143: Browser — permissions granted without a prompt

**Status:** Completed (2026-11-21). Both findings reproduced on 5.0.20 (see "Runtime
reproduction"); fixed and verified on an owned dev instance (see "Verification").
**Severity:** Medium.
**Evidence branch:** `upcoming-v5.0.21` @ `4656a6cb`; plan re-verified on `4434940a` (after US-2140,
US-2141 and US-2142 — `permission-policy-service.ts` line numbers unchanged).
**Epic:** none.

## Goal

Stop silent grants of permissions that Chrome gates behind a prompt, and attribute permission
prompts and grants to the origin Chrome attributes them to: File System Access write/directory
grants go through the prompt bar (sensitive paths are refused), and a cross-origin iframe can neither
obtain nor reuse the top-level site's notification or external-link grant.

## Confirmed by code review

1. **`fileSystem` auto-granted.** `permission-policy-service.ts:200`:
   `if (permission === "fileSystem") { callback(true); return; }` — on every browser-profile session.
   The check handler returns false (`:148`), so only the request path is auto-allowed. In Electron
   the File System Access API raises this request for write upgrades and for Chromium's
   sensitive-path blocklist (profile root, system folders), so a single
   `showDirectoryPicker({mode:'readwrite'})` pick grants persistent write access with no second
   prompt — enough to overwrite documents or drop files in a broad folder.
2. **Cross-origin iframe inherits notification grant.** Requests/checks key on the `webContents`
   top-level URL, not the requesting frame (`permission-policy-service.ts:46-48,141-146,205-209`);
   only `openExternal` is refused for subframes (`:211`). So a third-party iframe's
   `Notification.requestPermission()` shows the prompt as the **top** site, and once allowed every
   frame on that top-level site can show Windows toasts. Electron toasts carry Persephone's name/icon
   but not the origin, so content can imitate app/system messages.

## Runtime reproduction (5.0.20, 2026-11-21)

Owned test instances (`--profile sec-2143`, `sec-2143b`), loopback fixtures. Main-process decisions
were logged by patching `Session.prototype.setPermissionRequestHandler`/`setPermissionCheckHandler`
before a new tab created its session, so the app's own handlers were wrapped.

| # | Result | Evidence |
|---|---|---|
| 1 `fileSystem` | **Reproduces at policy level** | The app's real request handler, called with `permission="fileSystem"` (writable directory, readable file, and a cross-origin subframe request), returned `true` at once with no prompt bar; the check handler returned `false`. A trusted click on `showDirectoryPicker({mode:'readwrite'})` opened the native "Select where this site can save changes" dialog, which automation could not drive — so the request details Electron 44 actually sends (`fileAccessType`, `isDirectory`, `filePath`) were **not observed**, and no file was written. Confirm by hand: run the PoC below, pick a scratch folder, and watch for a second prompt. |
| 2 iframe notifications | **Reproduces** | Top `127.0.0.1:18151` framing `localhost:18152`: the iframe's `Notification.requestPermission()` (trusted click) showed the prompt bar naming the **top** origin. Main saw `perm=notifications`, `isMainFrame=false`, `requestingUrl=http://localhost:18152/n.html` — and ignored both. After Allow, the iframe's `new Notification(...)` fired `onshow`. Control: a third origin (`localhost:18153`) framed later had `Notification.permission === "granted"` at load, no prompt, and its toast showed too. |

So the fix data is already available in the handler: `details.isMainFrame` and
`details.requestingUrl` are populated for subframe requests.

## Steps to reproduce

Owned test instance (US-2140 ground rules).

- **#1:**
  ```html
  <button onclick="showDirectoryPicker({mode:'readwrite'}).then(async d=>{
    const f=await d.getFileHandle('persephone-poc.txt',{create:true});
    const w=await f.createWritable();await w.write('marker');await w.close();document.title='WROTE'})">pick</button>
  ```
  Open in a browser tab, click, pick a scratch folder you created. If the title becomes `WROTE` with
  no write prompt, the silent grant is confirmed. (Do not pick system or profile folders — a scratch
  folder is enough to prove it.)
- **#2:** serve `http://a.test` (map a loopback alias, or two fixture ports) with
  `<iframe src="http://b.test/n.html">`; in `n.html`:
  ```html
  <script>Notification.requestPermission().then(p=>{if(p==='granted')new Notification('Persephone update',{body:'test'})})</script>
  ```
  Confirm the prompt names the **top** origin, and that a toast then fires from the iframe's code.

## Background

### Where the policy lives

- `src/main/permission-policy-service.ts` (306 lines, not a roadmap §2.3 god file) owns the Electron
  `setPermissionRequestHandler` / `setPermissionCheckHandler` hooks for every session, the pending
  prompt callbacks (`pending` map, `resolvePermissionRequest`, `settlePermissionRequestsForWebContents`)
  and the prompt dispatch through the injected `PermissionPromptHandler`
  (`browser-service-composition.ts:createBrowserPermissionPromptHandler` → `guest.sendEvent("permission-request")`).
- `src/main/site-permission-store.ts` owns remembered allow/block decisions per (profile, origin, key);
  `PROMPTABLE` is the set of keys that may be remembered; `normalizeOrigin()` accepts only http(s).
- Renderer: `BrowserWebviewModel` → `BrowserPromptsModel.enqueuePermission` →
  `BrowserPromptBars.PermissionPromptBarView` renders `prompt.topLevelOrigin` in `[data-name=permission-origin]`
  and `t("browser.permissionRequest", { permissions })` in `[data-name=permission-description]`; labels
  come from `browser-permission-labels.ts`. Allow/Block call back with only the request id.
- IPC shape: `BrowserPermissionPromptData` in `src/ipc/browser-ipc.ts` (mirrored by
  `PermissionPromptData` in the service).

### What Electron 44 sends for `fileSystem` (from `node_modules/electron/electron.d.ts`)

`FilesystemPermissionRequest extends PermissionRequest` — `{ isMainFrame, requestingUrl,
fileAccessType?: 'writable' | 'readable', filePath?: string, isDirectory?: boolean }`. The check
handler's details carry the same three fields, and the docs note that **`isMainFrame` is always
`false` for a `fileSystem` check** ("Chromium limitations"), so `isMainFrame` cannot be relied on for
this permission. Electron's `FileSystemAccessPermissionContext` raises the request in two places:

1. **Permission grant upgrades** (`PermissionGrantImpl::RequestPermission`): a write grant after a
   `readwrite` picker or `createWritable()`/`handle.requestPermission({mode:'readwrite'})`, and a read
   grant for a picked directory (Chrome's "Let site view files?") or a handle restored from IndexedDB.
   Details: the handle's `filePath`, `isDirectory`, and `fileAccessType` = `writable`/`readable`.
2. **Sensitive entries** (`ConfirmSensitiveEntryAccess`): when the picked path is on Chromium's
   blocklist, Electron asks the handler; a deny aborts the pick. Same detail shape.

The two cases are not distinguishable by shape, so the policy decides from the path and access type
alone. Read access to an individual picked file is granted by Chromium itself without a request (as in
Chrome). The exact values Electron sends after a real native pick could not be captured (the native
dialog cannot be driven) — that is a hand check.

### What Chrome does

- **File System Access:** a sensitive path (drive roots, the profile/home folder itself, AppData,
  Program Files, Windows, the browser's own folders, ancestors of those, `.lnk`/`.local` files) is
  refused outright; a directory read or any write upgrade shows a prompt naming the site and the
  folder/file; the grant lasts for the visit and is not saved as a site setting. Pickers in
  cross-origin subframes are refused by Chromium itself.
- **Notifications** (`notification_permission_context.cc`): requests "may only happen on top-level
  frames and same-origin iframes"; a cross-origin iframe is denied without a prompt. Use stays allowed
  in any frame but is keyed on the **frame's own origin**, so a third-party iframe gets the grant only
  if its own origin was allowed.
- **External protocols:** the remembered choice belongs to the initiating origin.
- **Delegated permissions** (camera, microphone, geolocation, MIDI, clipboard-read, idle detection,
  window management, speaker selection): controlled by Permissions Policy (`allow=` on the iframe,
  default `'self'`); when delegated, Chrome prompts for and stores the grant under the **top-level**
  origin. Blink enforces the policy before the request reaches the browser, so the current
  top-origin keying already matches Chrome for these.

## Implementation plan

- [x] **1. New collaborator `src/main/file-system-access-policy.ts`** (owner of the File System Access
  rule; the service only dispatches). Reuses `normalizeOrigin()` from `site-permission-store.ts`,
  `app.getPath()`, `node:path` `win32`, `node:fs` `realpathSync.native`.
  ```ts
  /** undefined = deny without a prompt. BrowserFileAccessPrompt comes from src/ipc/browser-ipc.ts (step 3). */
  export function fileSystemAccessToPrompt(details: Electron.FilesystemPermissionRequest, topOrigin: string): BrowserFileAccessPrompt | undefined
  ```
  Deny when: no `filePath`; `requestingUrl` is present and its http(s) origin is not `topOrigin`
  (cross-origin or opaque subframe — `isMainFrame` is not trusted for this permission); the path is not
  an absolute local drive path (UNC/relative); the path (as given, and after `realpath` when it exists —
  else the realpath of its parent plus the basename) is sensitive; a file with a `.lnk`/`.local`
  extension. Sensitive = drive root; equal to or inside a "block all children" folder; equal to a
  "block itself" folder; an ancestor of any listed folder. Lists (case-insensitive, built per call from
  `app.getPath` and the environment):
  - block all children: `appData`, `userData`, `%LOCALAPPDATA%`, `<home>\AppData`, the executable's
    folder, `%SystemRoot%`/`%windir%`, `%ProgramFiles%`, `%ProgramFiles(x86)%`, `%ProgramW6432%`,
    `%ProgramData%`, `<home>\.ssh`;
  - block itself only: `<home>`.
  Otherwise return `{ path: filePath, access: fileAccessType === "writable" ? "write" : "read", isDirectory }`.
- [x] **2. `src/main/permission-policy-service.ts`**
  - Replace `if (permission === "fileSystem") { callback(true); return; }` with a call that derives the
    top origin, calls `fileSystemAccessToPrompt`, and on a result shows the prompt with **no stored
    keys** (`keys: []`) and `fileAccess` in the prompt data; otherwise `callback(false)`. A decision is
    one-shot: `resolvePermissionRequest` stores nothing because `keys` is empty, and the grant lasts as
    long as Electron's grant object (the visit), as in Chrome.
  - Extract the prompt-dispatch tail of `handleRequest` into `promptForRequest(ses, webContents,
    callback, origin, keys, extra)` used by both paths (no new protocol: same pending map, same
    `PermissionPromptHandler`, same `resolvePermissionRequest` IPC).
  - **Frame-scoped permissions.** Add
    ```ts
    /** Chrome keys these on the requesting frame's own origin; they are not delegated from the top site. */
    function isFrameScoped(key: BrowserPermissionKey): boolean { return key === "notifications" || key.startsWith("openExternal:"); }
    function requesterIsTopOrigin(details: Electron.PermissionRequest, top: string): boolean {
        return details.isMainFrame === true || normalizeOrigin(details.requestingUrl) === top;
    }
    ```
    In `handleRequest`, right after the keys/origin guard and **before** the store lookup:
    `if (keys.some(isFrameScoped) && !requesterIsTopOrigin(details, origin)) { callback(false); return; }`.
    The existing `openExternal && !isMainFrame` prompt refusal stays (same-origin subframes still
    cannot prompt for external links; they can use a stored allow, as before).
  - In `handleCheck`, key `notifications` on the requesting origin
    (`normalizeOrigin(origin)`, the frame's own origin Electron passes) instead of the top URL; other
    keys unchanged.
  - Before → after (request):
    ```ts
    if (permission === "fileSystem") { callback(true); return; }            // before
    if (permission === "fileSystem") { requestFileSystemAccess(ses, request); return; } // after
    ```
- [x] **3. IPC types.** `src/ipc/browser-ipc.ts` `BrowserPermissionPromptData` gains
  `fileAccess?: BrowserFileAccessPrompt` (`{ path; access: "read" | "write"; isDirectory }`);
  `PermissionPromptData` in the service reuses the same type. `BrowserPermissionKey` (the site-settings key set)
  does **not** gain `fileSystem` — it is never remembered or listed in Site permissions.
- [x] **4. Prompt bar.** `src/renderer/editors/browser/BrowserPromptBars.ts` `PermissionPromptBarView.sync()`:
  when `prompt.fileAccess` is set, the description is one of four new messages chosen by
  access × directory, with the path; the origin line is unchanged (it already names the origin the
  grant goes to — the top-level origin, which the policy now guarantees is also the requester for
  frame-scoped and file prompts). The bar's `title` shows the full path for long paths.
- [x] **5. i18n.** `src/shared/i18n/en/browser.ts`: `permissionFileEditFolder`, `permissionFileViewFolder`,
  `permissionFileEditFile`, `permissionFileViewFile`; translate into all 17 packs in `assets/languages/`.
- [x] **6. Runtime verification** (owned dev instance, loopback fixtures) — see "Verification".
- [x] **7. Completion:** review, `/document` (`doc/architecture/browser-editor.md` Permission Policy,
  `key-files.md`, `folder-structure.md`), `/userdoc` (`assets/guides/editors/browser/index.md`,
  `layout.md`, `whats-new.md`), dashboard close.

### Files that need NO changes

`site-permission-store.ts` (no new remembered key), `browser-service-composition.ts` (prompt relay is
generic), `BrowserPromptsModel.ts`, `BrowserWebviewModel.ts`, `BrowserGuestChannel.ts`,
`browser-handlers.ts` (same resolve IPC), `browser-permission-labels.ts`, the Site permissions popover
and profile Settings (file grants are never listed), `board-shim.ts` / `BOARD_BRIDGE_VERSION`
(`window.persephone` unchanged), the app/board session branches of the handlers.

## Concerns / decisions

- **File grants are not remembered.** Chrome keeps File System Access grants for the visit only and
  never shows them in site settings; the store's per-origin key model also cannot hold a per-path
  grant. So Allow/Block on a file prompt answer just that request. A page can ask again only from a
  new user gesture (pickers and `requestPermission` need activation).
- **Our own blocklist, not Chromium's.** The two request kinds look identical, so the policy applies
  its own Windows blocklist. If Chromium flags a path our list does not cover, the user still sees a
  prompt naming the path — no silent grant either way.
- **`isMainFrame` is not trusted for `fileSystem`** (documented as always `false` on checks); the
  same-origin rule uses `requestingUrl`. A request without `requestingUrl` is attributed to the top
  origin (Chromium already refuses pickers in cross-origin subframes).
- **Notification checks follow the frame's own origin**, matching Chrome: an iframe from a site the
  user allowed at top level can still notify; one from any other site cannot. Same-origin
  `about:blank`/`srcdoc`/`blob:` subframes have no http(s) `requestingUrl`, so their notification
  *requests* are denied (fail closed); this is a rare edge and Chrome-incompatible only there.
- **Delegated permissions are unchanged.** They prompt and store under the top-level origin, which is
  what Chrome does and what the bar shows. Main cannot read a frame's Permissions Policy (Electron's
  `WebFrameMain` does not expose it), so the policy relies on Blink's enforcement for undelegated
  cross-origin iframes; the verification checks that such a request never produces a prompt.
- **External links:** a cross-origin subframe can no longer use the top site's stored allow for a
  scheme; same-origin subframes keep the previous behavior.
- **Client-certificate picker** (US-2142 follow-up): not part of this rework; left for later.

## Acceptance criteria

- A page cannot gain write or directory File System Access without an explicit prompt; the prompt
  names the site and the path; sensitive paths are refused without a prompt.
- A cross-origin iframe cannot obtain or use the top-level site's notification permission: its
  request is denied without a prompt, and after the top site is allowed its
  `Notification.permission` is not `granted` and a `new Notification()` errors.
- The top-level page itself still prompts and, once allowed, still notifies; a same-origin iframe
  still shares the grant.
- The prompt bar names the origin the grant is stored under.
- `npm run typecheck`, `npm run lint`, `npm run i18n:check`, `npm run guides:check` pass.

## Verification

Owned dev instance (`electron .vite/build/main.js --test v.test.mjs --profile sec-fix-2143`),
loopback fixtures only (top `127.0.0.1:18161`, cross-origin iframe `localhost:18162`, geolocation
iframe `localhost:18163`). Main-process decisions were logged the same way as the reproduction (the
app's own handlers wrapped before the browser session was created). Scripts and logs:
`<scratchpad>/us2143-verify/` (`v.test.mjs`, `server.mjs`, `server.log`, `logs1/`). 2 tests, both
passed. "Before" is the 5.0.20 reproduction above (same signals).

| # | After the fix | Before (5.0.20) |
|---|---|---|
| 2 iframe asks | Iframe B's `requestPermission()` (trusted click): **no prompt bar**, result `denied`; main `REQ notifications isMainFrame=false requestingUrl=localhost:18162 → false` | prompt bar naming the top origin, `granted` after Allow |
| 2 top asks | Top page's own request: bar names `http://127.0.0.1:18161`, "Notifications"; Allow → `granted`, stored for that origin only | same |
| 2 iframe after top grant | Reloaded iframe B: `Notification.permission` `denied` (check keyed on `localhost:18162` → false); `new Notification()` → **`onerror`**; re-ask → `denied`, no prompt | `granted`, toast `onshow`; a later third-origin iframe inherited `granted` |
| 2 same-origin iframe | `127.0.0.1:18161/n.html` iframe: `granted` at load, toast `onshow` (shared grant kept) | — |
| delegated (control) | Cross-origin iframe without `allow=`: geolocation error 1 "disabled in this document by permissions policy"; no request reached main, no prompt | — |
| 1 sensitive paths | App handler called with Electron-shaped `fileSystem` details: home, `C:\`, `C:\Users`, `C:\WINDOWS\System32`, the Startup folder, `%TEMP%` (inside AppData\Local), the profile's own `browser-permissions.json`, a `.lnk` file, and a cross-origin `requestingUrl` → all **`false` at once, no prompt bar**; `fileSystem` check → `false` | every call `true` at once, no prompt |
| 1 prompted | Non-sensitive `C:\us2143-nonexistent\docs` (write dir): callback **pending**, bar names `http://127.0.0.1:18161` and "This site wants to edit files in the folder C:\us2143-nonexistent\docs." (path also in the tooltip); Block → `false`, Allow → `true`; asking again prompts again (not remembered). Read dir / write file / read file show the view-folder / save-changes / open-file texts. `browser-permissions.json` holds only the notification allow — no file entry | `true` at once |

**Code-only:** the UNC rejection (not exercised at runtime by rule; the path check returns before any
file-system call); same-origin `about:blank`/`blob:` subframe notification requests (denied by
design).
**Hand check:** a real `showDirectoryPicker({mode:'readwrite'})` pick of a scratch folder (the native
dialog cannot be driven): expect the prompt bar with the folder path, and `WROTE` only after Allow;
picking `C:\` or the user folder should fail without a prompt. This also confirms the detail values
Electron 44 sends after a real pick.

## Files changed

| File | Change |
|---|---|
| `src/main/file-system-access-policy.ts` (new) | File System Access request rule: sensitive-path blocklist, same-origin requester, prompt data |
| `src/main/permission-policy-service.ts` | `fileSystem` → prompt; frame-scoped notifications/external links; shared prompt dispatch |
| `src/ipc/browser-ipc.ts` | `BrowserFileAccessPrompt`, `BrowserPermissionPromptData.fileAccess` |
| `src/renderer/editors/browser/BrowserPromptBars.ts` | file-access prompt text |
| `src/shared/i18n/en/browser.ts`, `assets/languages/*.lang.json` | four file-access prompt messages |
| `doc/architecture/browser-editor.md`, `key-files.md`, `folder-structure.md` | developer docs (frame attribution, File System Access rule, new file) |
| `assets/guides/editors/browser/index.md`, `layout.md`, `whats-new.md` | user docs (file-access and embedded-frame prompts) |
