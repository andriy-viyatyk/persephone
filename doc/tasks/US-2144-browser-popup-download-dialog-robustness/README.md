# US-2144: Browser — popup, download and dialog robustness

**Status:** Done (2026-11-21) — fixed and verified on an owned dev instance. Recorded the same day:
**#1, #2, #4b, #5 reproduced on 5.0.20; #3 partial; #4a
differs from the original claim** (alert spam stacks boxes but does not freeze the app). See
"Runtime reproduction" below. Planned and implemented 2026-11-21 (see "Implementation plan",
"Verification").
**Severity:** Medium (abuse / denial-of-service / phishing), none is a privilege escalation.
**Evidence branch:** `upcoming-v5.0.21` @ `4656a6cb`.

## Goal

Stop a web page from opening unsolicited windows, flooding Save dialogs, or spamming/blocking the
host with JavaScript dialogs, and prevent one "Allow popups" click from disabling the limiter
app-wide.

## Confirmed by code review

1. **No-gesture top-level popups with no address shown.** The first-level popup is allowed whenever
   the rate limiter passes, with no user-activation check (`BrowserGuest.ts:166-171`; only nested
   popups check `userActivated`, `popup-policy.ts:76-79`). Popup options show no URL/origin
   (`popup-policy.ts:38-55`) and size is uncapped from the page (`:12-15`). A site can open a
   borderless-looking window titled by its own `document.title` over Persephone — easy credential
   phishing, plus a slow popup storm (3 per 2 s indefinitely).
2. **One "Allow popups" click disables the limit globally.** `BrowserPromptsModel.ts:48-51` →
   `browser-service.ts:296` `allowPopups(){ globalPopupRateLimiter.allow("popups") }` →
   `popup-rate-limiter.ts:46-49` makes the key permanently allowed for every site/window/Tor page
   until restart. *(Verified the `allowPopups` line.)*
3. **Download flood.** Each guest `will-download` opens a native Save dialog
   (`download-service.ts:238,256`) and starts streaming to `%TEMP%` immediately
   (`:229`); no per-site limit, gesture check or queue. A page loop of `a.click()` on `download`
   links opens unlimited modal dialogs (app unusable) and can fill the disk.
4. **JS dialog spam / `beforeunload` block.** No `safeDialogs` on browser webviews
   (`BrowserWebviewItemView.ts:40-43`), and `beforeunload` uses a synchronous
   `dialog.showMessageBoxSync` on main (`BrowserGuest.ts:269-270`), so `while(1)alert()` or a
   reload/`beforeunload` loop freezes all windows + IPC + MCP while the box is up.
5. **Unbounded title/favicon/history over IPC.** `page-reporters.ts:26-40,53-65` send
   `document.title` and favicon href on every `<head>` mutation with no length cap/throttle;
   `parseGuestMessage` accepts any string (`browser-guest-messages.ts:42-45`); persisted via
   `getRestoreData`. A multi-MB title changed each frame churns IPC/state and bloats the state file.

## Runtime reproduction (5.0.20, 2026-11-21)

Owned test instances (`--profile sec-2144`, `sec-2144c`), loopback fixtures, bounded floods, the
instance killed after each. Line drift: `download-service.ts` has `setSavePath` at `:229` and
`showSaveDialog` at `:256` (the `:238` reference above has moved).

| # | Result | Evidence |
|---|---|---|
| 1 no-gesture popup | **Reproduces** | `open()` on page load (no gesture) opened a 480×360 window titled with the page's `<title>`, with no origin/URL anywhere. `width=4000,height=4000` was not clamped: 2560×1392 at (-1232,-1544) on a 1536×912 work area — largely off-screen. A 6-popup burst: 3 opened, 3 denied, prompt bar shown. |
| 2 global "Allow" | **Reproduces** | After **Allow** on `127.0.0.1`, a fresh tab on `localhost` opened 8/8 no-gesture popups with no prompt (3/8 before). Still in effect after page A navigated away. |
| 3 download flood | **Partial** | 10 no-gesture downloads 300 ms apart all started and completed — no limit, gesture check or queue. A slow 1 MB stream grew its `.part` file in the temp folder (196 KB → 983 KB) before completion. The stacked native Save dialogs are code-confirmed only (owned instances bypass the dialog, `download-service.ts:256`). |
| 4a alert spam | **Partial — differs** | `alert()`×5 + `confirm()` returned in 0–1 ms to the page (not blocking it); up to 4 native "persephone" boxes were up at once; no "prevent additional dialogs" option. Main stayed responsive (5 ms). The "`while(1)alert()` freezes all windows" claim did **not** reproduce — the issue is unbounded stacked boxes, not a freeze. |
| 4b `beforeunload` | **Reproduces** | `beforeunload` + reload raised the native "Unsaved changes" box; while it was up, main-process, host-renderer and `pages.all` calls all timed out (>4–6 s). Reload was triggered from main; a page-initiated reload loop was not run. |
| 5 title churn | **Reproduces (modest)** | 1 MB and 5 MB titles reached the host model uncapped; `openFiles0.json` grew 3 KB → 3.15 MB and 1.3 KB → 15.7 MB. 1 MB churn raised main round-trips from ~6 ms to 150–300 ms; 5 MB churn showed no lag. A 1 MB title also flows unbounded into agent tool output (`pages.all`). Favicon cap not tested. |

Not run: stacked Save dialogs on the real path, 100+ alert loops, popup Allow across restart,
startup cost of a 15 MB state file.

## Steps to reproduce (hand to Sonnet/Codex)

Owned test instance (US-2140 ground rules). These are DoS-shaped — run each briefly and kill the
owned instance after; do not run against the live app.

- **#1 no-gesture popup:** `<script>open('about:blank','','width=480,height=360')</script>` on page
  load (no click). Confirm a window opens and shows no origin.
- **#2 global allow:** on page A trigger >3 popups, click **Allow**; in another tab load a popup
  loop and confirm it is now unlimited.
- **#3 download flood:** `setInterval(()=>{const a=document.createElement('a');a.href='/big?'+Math.random();a.download='f.bin';a.click()},300)` with a fixture `/big` that streams; confirm stacked Save dialogs. (Note: owned test instances bypass the native Save dialog per `integration-tests.md`, so this may need `--open`/manual to see the dialog pile-up — record which mode showed what.)
- **#4 dialog spam:** `<button onclick="for(;;)alert('x')">x</button>` — confirm repeated native boxes; and a `beforeunload` cancel loop — confirm other windows freeze while the box is up.
- **#5 title churn:** `const s='A'.repeat(5e6);(function f(){document.title=s+Math.random();requestAnimationFrame(f)})()` — watch host CPU and state-file size.

## Fix direction

Require recent user activation for first-level popups (reuse `BrowserGuest.lastUserActivation`),
clamp popup size, and show the popup origin (title prefix or a host-rendered frame with a read-only
URL). Key the popup allowance by top-level origin in main and expire it on navigation. Serialize
Save dialogs per page and gate repeat downloads on activation; hold the transfer until a path is
chosen or cap temp bytes. Set `safeDialogs` (origin-named) on browser webviews and use async
`showMessageBox` for `beforeunload`. Truncate title (~1 KB) / favicon URL (~2 KB) and throttle
reports in `parseGuestMessage`.

## Background (current code, re-verified on `c3f0439a`)

- **Window opening.** `BrowserGuest.attach()` (`src/main/browser/BrowserGuest.ts:156-173`) installs the
  guest's `setWindowOpenHandler`: page-open policy (US-2140) → tab dispositions relayed as `"new-window"` →
  `globalPopupRateLimiter.check("popups")` → allow with `handleGuestPopup(parentWindow, features)`
  (`popup-policy.ts:23-40`, size from the page, no clamp). Nested popups (`guardPopupWindow`,
  `popup-policy.ts:42-90`) need a `focus` on their own window and the same limiter, and relay their
  tab dispositions without any check. The renderer limits page-opened tabs with its own copy of the
  limiter (`BrowserPageLinkOpener.openLink`, key `"tabs"`).
- **User activation.** `BrowserGuest.lastUserActivation` is set by `before-mouse-event` (down/up) and
  `before-input-event` (keyDown); `handOffExternal()` consumes it within `USER_ACTIVATION_WINDOW_MS`
  (5 s, `src/shared/browser-navigation-policy.ts`).
- **"Allow popups".** `BrowserPromptsModel.allowPopups()` sets `webview.popupsAllowed = true`, calls
  `globalPopupRateLimiter.allow("tabs")` in the renderer and sends `BrowserChannel.allowPopups` (no
  arguments) → `browserService.allowPopups()` → `globalPopupRateLimiter.allow("popups")` in main.
  `PopupRateLimiter.allow()` puts the key in a permanent set.
- **Downloads.** `download-service.ts` `handleOrdinaryDownload()` sets the temp `.part` path at once
  (`:257`), then `chooseDownloadPath()` opens `dialog.showSaveDialog` per download (`:288`, no queue).
  Test instances skip the dialog (`testInstanceDownloadPath`). US-2141 private-download scoping
  (`privateOwnerId`, `privateHost`, `notify()`) must stay intact.
- **JS dialogs.** Electron answers page dialogs in its own JS through the WebContents' internal
  `-run-dialog` event (`info: { frame, dialogType, messageText, defaultPromptText }`, `callback(ok,
  input)`), the place where `disableDialogs`/`safeDialogs` are read. Probed on the dev build
  (`us2144-verify/b.test.mjs`): in a `<webview>` guest the page does **not** wait for the callback, so
  20 `alert()` calls in a loop raised 19 simultaneous native boxes; `safeDialogs` only adds a "prevent
  additional dialogs" checkbox from the 2nd box, it cannot bound a loop.
- **`beforeunload`.** `BrowserGuest.handleBeforeUnload()` (`:260-278`) runs `dialog.showMessageBoxSync`;
  Electron's `will-prevent-unload` must be answered synchronously (preventDefault = leave), and it
  carries no information about what was being attempted. `bypassUnloadGuard` is armed by hard reload.
- **Title/favicon.** `src/preload-webview/page-reporters.ts` reports on every `<head>` mutation;
  `parseGuestMessage` (`src/ipc/browser-guest-messages.ts:42-45`) accepts any value;
  `BrowserWebviewModel.handleGuestMessage` stores it in tab state (persisted).

## Implementation plan

### 1. First-level popups need a gesture, are clamped, and show their origin
- [x] **New `src/main/browser/user-activation.ts`** — `class UserActivation { note(); isActive(); consume() }`
  (window `USER_ACTIVATION_WINDOW_MS`). Owner of "recent user activation" for a guest; replaces
  `BrowserGuest.lastUserActivation` (`trackPress`, `handleInput`, `handOffExternal` use it).
- [x] **New `src/main/browser/popup-gate.ts`** — `class BrowserPopupGate` (one per `BrowserGuest`): owner of
  "may this page open a tab/window now". `allowOpen(kind)`: granted origin → yes; otherwise consume
  the activation (one open per gesture, as Chrome) and then `globalPopupRateLimiter.check(kind)`.
  `grant()` records the guest's current top-level **http(s) origin**; `onNavigated(url)` drops the
  grant when the committed origin changes. Reuses `globalPopupRateLimiter` (check only).
- [x] `BrowserGuest.ts` window-open handler: after the page-open policy, `if (!this.popups.allowOpen(tab ?
  "tabs" : "popups")) → "popups-blocked"` for both tabs and windows; `did-navigate` →
  `this.popups.onNavigated(url)`. The renderer re-registers a guest on every `dom-ready`, so
  `registerWebview` passes the previous `BrowserGuest` of the same webContents (`previous`) and the new
  one keeps its `activation`, `popups` and `unload` collaborators (found at runtime: without it the grant
  died on every same-origin reload).
- [x] `popup-policy.ts`: one `popupWindowOptions(anchor, features)` for first-level and nested popups —
  size clamped to `[100, workArea]` of the display matching the anchor (`screen.getDisplayMatching`),
  position centred on the anchor and clamped into the work area. `showPopupOrigin(window)`: the window
  title is `<origin> — <page title>` (`mainFrame.origin`, so an `about:blank` popup shows its opener's
  origin; page title cut to 200 chars), kept on `page-title-updated` (preventDefault) and `did-navigate`.
  Nested popups' tab dispositions now need the window's activation and the `"tabs"` limit.

### 2. "Allow popups" is scoped to the tab's site
- [x] `BrowserChannel.allowPopups` carries the registration key; `browser-handlers.ts` → **new
  `src/main/browser/browser-page-guard-service.ts`** `browserPageGuardService.allowPopups(event, key)` →
  `browserGuests.owned(key, sender)?.popups.grant()`. (A separate service, like `browser-popup-service.ts`,
  so the §2.3 file `browser-service.ts` does not grow; it stays at 320 lines.)
- [x] Renderer: `BrowserPromptsModel` remembers `blockedPopupTabId` (`countBlockedPopup(tabId)`), Allow
  grants that tab; `clearTab(tabId, sameDocument)` also hides that tab's popup bar on a cross-document
  navigation. Remove `webview.popupsAllowed`, the renderer `"tabs"` limiter check in
  `BrowserPageLinkOpener.openLink` (main is now the single owner) and `PopupRateLimiter.allow /
  isAllowed / allowByPrefix / removeByPrefix` (unused; the permanent allow was the bug).

### 3. Downloads
- [x] **New `src/main/browser/download-request-limiter.ts`** — owner of "may this page start a download"
  (Chrome's DownloadRequestLimiter): a guest page may start one download per document without a gesture;
  further ones need a fresh activation (consumed). Per-document state resets on main-frame `did-navigate`.
  Blocked → `item.cancel()` and one `eBoardNotify` warning per document (`main.downloadsBlocked`), the
  generic notification route `download-service` already uses for claims. Applied before board claims.
- [x] **New `src/main/download-path-queue.ts`** — `class SavePathQueue` (`hasRoom`, `enqueue`): one Save
  dialog at a time per initiating `webContents`; at most `MAX_QUEUED_PER_PAGE` (3, the open dialog
  included) queued, more are cancelled before a record is created.
- [x] `download-service.ts`: run `chooseDownloadPath` through the queue (test-instance path included);
  while no path is chosen, pause the transfer once `UNCHOSEN_TEMP_LIMIT_BYTES` (32 MB) reached the temp
  file and resume after the path is chosen (cancel/remove unchanged). Private-download scoping untouched.

### 4. JS dialogs and `beforeunload`
- [x] **New `src/main/browser/page-dialog-guard.ts`** — `guardPageDialogs(contents)`, owner of page JS
  dialogs for browser guests and their popups. Replaces Electron's `-run-dialog` listener (only when it
  exists; otherwise Electron's handler with `safeDialogs` stays): **one native box at a time per page**
  (a dialog while one is open is answered "cancel" at once, no box); title = the frame's origin; from the
  2nd box a "prevent additional dialogs" checkbox (`main.preventMoreDialogs`) that silences that origin
  for the page's life; `prompt()` unsupported as before; boxes are closed on Electron's `-cancel-dialogs`
  (navigation); message capped at 2,000 chars. Async `dialog.showMessageBox` in `withNativeDialog`.
  Installed from `guardBrowserGuestAtCreation` and `guardPopupWindow`.
- [x] `browser-service.ts` `will-attach-webview` calls `applyPageDialogPreferences()` (in
  `page-dialog-guard.ts`): `safeDialogs: true` + localized `safeDialogsMessage` as the fallback if
  Electron's internal event changes.
- [x] **New `src/main/browser/unload-guard.ts`** — `class BrowserUnloadGuard` (one per `BrowserGuest`):
  owner of the `beforeunload` confirm. On `will-prevent-unload` it keeps the page (no preventDefault),
  shows an **async** box (one at a time; further attempts while it is open stay silently) and on
  **Leave** arms a one-shot bypass and replays the recorded navigation intent. Intents: main sees
  `will-navigate` (URL), its own F5/Ctrl+R/Alt+←/→; the host sends `BrowserChannel.navigationIntent`
  before its own load/back/forward/reload (`BrowserGuestChannel.noteNavigation`, called from
  `BrowserWebviewModel.load/goBack/goForward/reload` and the page context menu;
  `browserPageGuardService.noteNavigationIntent` validates it). An intent is used only
  if ≤ 3 s old; with no intent, Leave arms the bypass for 10 s so the user's repeated action leaves.
  `bypassUnloadGuard` moves into this class (`armBypass`, cleared on `did-stop-loading`).

### 5. Title / favicon
- [x] `browser-guest-messages.ts`: `GUEST_TITLE_MAX_CHARS = 1024`, `GUEST_FAVICON_URL_MAX_CHARS = 2048`
  (`data:image` favicons up to `GUEST_FAVICON_DATA_URL_MAX_CHARS = 32768`); `parseGuestMessage` accepts
  only strings, truncates titles, drops over-long favicons.
- [x] `page-reporters.ts`: same caps at the source and at most one report per 250 ms (trailing).

- [x] Completion: review, developer docs, user guides, translations (17 packs), dashboard.

### Files that need NO changes
`BrowserPopupRegistry.ts` (reads `webContents.getTitle()`, unaffected by the window title),
`navigation-scheme-guards.ts` policy functions (only the creation hook gains one call),
`permission-policy-service.ts`, `BrowserPromptBars.ts` (same bar, same text), `board-shim.ts` /
`BOARD_BRIDGE_VERSION` (`window.persephone` unchanged), `api/downloads.ts`, `BrowserDownloadsPopup.ts`.

## Concerns / decisions

- **Grant scope = tab + origin, reset on origin change.** Chrome keeps a per-site setting; the brief asks
  for an allowance that expires on navigation. Same-origin navigations keep it (login flows, SPAs), a
  different origin drops it. The grant skips the gesture and the rate limit, as "Allow" did before.
- **Tabs need a gesture too.** `window.open(url)` without features and `target=_blank` arrive as tab
  dispositions; Chrome blocks both without a gesture, so main now gates them with the same rule.
- **One activation per open/download** (consumed), like Chrome's transient activation. A click that both
  opens a popup and downloads gets only the first.
- **Dialog guard relies on Electron's internal `-run-dialog` event.** It is the only place a page's dialog
  can be answered; the guard installs itself only when Electron registered that listener, and
  `safeDialogs` stays on as the fallback. Worth re-checking on each Castlabs Electron upgrade
  (US-1757). A second dialog while one is open gets "cancel" (Chrome would block the page instead;
  here the page never waits anyway).
- **Automation dialogs stay with the automation (follow-up fix).** The first version of the guard
  showed its box for every dialog, also while an agent call drove the page, so the automation dialog
  policy answered over CDP while a native box stayed up (`browser/automation` `observe.test.mjs`: 2
  dialog-policy tests got the native-dialog attention). The guard now asks
  `automationAnswersPageDialog(contents)` (`cdp-service.ts` → `automationAnswersDialog` in
  `cdp/cdp-page-events.ts`, sharing the automation window check the CDP dialog handler uses) and, when
  the automation answers, shows no box and leaves the answer to CDP (policy, or `handleDialog` under
  `manual`). Plain pages and user-raised dialogs on observed pages keep the guarded box.
- **`beforeunload` replay.** A POST form submission replays as a GET of its URL; an unknown intent
  (e.g. a page's own `location.reload()`) leaves on the user's next attempt within 10 s.
- **Temp hold, not hold-at-zero.** Electron starts the transfer before `will-download` returns; pausing at
  32 MB bounds the disk use per download (×3 waiting per page) while keeping small downloads instant.
  A server that drops a paused connection fails that download (user retries).
- **Popups' own downloads** (real popup windows) get the Save-dialog queue and temp cap but not the
  gesture gate (no activation tracking there; opening the popup already needed one).

## Deferred

None. Not covered by design (recorded in "Concerns"): Chrome's per-site persisted popup setting, a
prompt to allow automatic downloads (Persephone blocks with a notification instead), and a cooldown for a
page that re-triggers its own `beforeunload` after **Cancel**.

## Acceptance criteria

- A page cannot open a top-level window or a tab without a user gesture (or the tab's Allow), and popup
  windows show their origin and fit the work area.
- "Allow popups" affects only the granting tab's origin and resets when it navigates to another origin.
- A download loop cannot stack Save dialogs or start more than one download per document without a
  gesture; unchosen downloads stop at 32 MB in the temp folder.
- A dialog loop shows at most one box per page at a time; a `beforeunload` confirm never blocks main.
- Titles over 1 KB and favicon URLs over 2 KB never reach the host model or state file.

All met — see "Verification" (gesture gate, clamp, origin title, Allow scope, download gate, dialog cap,
non-blocking `beforeunload`, title/favicon caps at runtime; Save-dialog queue, temp cap, dialog checkbox
and **Leave** replay are code-only / hand checks).

## Verification

Owned dev instance (`electron .vite/build/main.js --test <file> --profile sec-fix-2144`), loopback
fixtures only (origin A `127.0.0.1:18171`, origin B `localhost:18172`), bounded floods, the instance
closed after each run; native boxes counted read-only with the reproduction's `watch.ps1` (window
enumeration of the owned PIDs, no input). Scripts and logs: `<scratchpad>/us2144-verify/`
(`server.mjs`, `server.log`, `v1.test.mjs`, `v1b.test.mjs`, `v2.test.mjs`, `v3.test.mjs`, `logs-*`,
`watch-*.out`, `run-*.out`). "Before" is the 5.0.20 reproduction above; #4a "before" was re-measured on
this dev build (`a.test.mjs`, `b.test.mjs`).

| # | After the fix | Before |
|---|---|---|
| 1 no-gesture popup | `open()` on load: **no window**, page got `null`, bar "1 popup was blocked on this page"; `open(url)` (tab disposition) on load: **no tab**, `null`, bar | window opened, no bar |
| 1 gesture popup | Trusted click → window opens, title **`http://127.0.0.1:18171 — Sign in to your bank`**, 480×367 centred on the host | title = page `<title>` only |
| 1 size | Trusted click, `width=4000,height=4000` → **1536×912 at (0,0)** = the work area | 2560×1392 at (-1232,-1544) |
| 1 link | Trusted click on a `target=_blank` link → new internal tab | — |
| 2 Allow scope | Tab A (8 no-gesture popups): 0 opened, bar; **Allow**; A reloaded: **8/8**; new tab on B: **0/8** + bar; A navigated to B: **0/8**; A back on A: **0/8** (grant dropped) | after Allow on A, every tab/origin 8/8, also after A left |
| 3 downloads | 10 no-gesture `<a download>` clicks 300 ms apart: **1 download**, warning notification shown; 3 trusted clicks on a download button: **3 downloads** | 10/10 started |
| 4a alerts | 20 `alert()` in a loop: **at most 1 box at a time** (title `http://127.0.0.1:18171`, 10 polls with 1, never 2), main eval 4 ms, `pages.all` 56 ms; the box closed when the tab navigated (`-cancel-dialogs`); `-run-dialog` listener count 1 (the guard) | 19 simultaneous boxes (dev build, same page) |
| 4b `beforeunload` | Click (activation) + reload from main: one "Unsaved changes" box; while up: main eval **2 ms**, `pages.all` **57 ms**, host renderer answered at once (with the native-dialog attention notice); a second reload while it was up: still **one** box, page stayed | main, renderer and `pages.all` timed out (>4–6 s) |
| 5 title | 1 MB title per frame for 2 s: tab `pageTitle` and editor title **1,024** chars, `pages.all` title 1,024, `openFiles0.json` **6–10 KB** | 1 MB in the model, state file 3 MB |
| 5 favicon | `<link rel=icon>` with a 5 KB URL: tab favicon **""** | (not tested) |

**Code-only:** the Save-dialog queue and the 32 MB temp hold (owned instances skip the Save dialog;
the queue still ran there and downloads completed); the "Prevent this page from creating additional
dialogs" checkbox (from the 2nd box; it cannot be ticked without OS input); nested popups' tab gate;
the `safeDialogs` fallback (only used if Electron drops its internal event).
**Hand check:** (1) on an installed build, a page looping `<a download>` clicks shows one Save dialog
at a time and stops after 3 queued; a large download left in its Save dialog stops growing its
`%TEMP%\persephone-downloads\*.part` at 32 MB and finishes after a path is chosen. (2) A page with a
`beforeunload` guard: edit it, then use toolbar Back / Reload / a typed URL / a link → the box appears
and **Leave** completes that same navigation; **Cancel** stays. (3) Two alerts in a row: the second box
has the checkbox; ticking it silences further alerts from that site in the tab.
**Follow-up fix (automation dialogs):** `browser/automation` was 33/35 with the first guard (2
`observe.test.mjs` dialog-policy tests got a native box); 35/35 after the guard defers to the
automation dialog policy.

## Files changed

| File | Change |
|---|---|
| `src/main/browser/user-activation.ts` (new) | Recent user activation of a guest |
| `src/main/browser/popup-gate.ts` (new) | Gesture + rate-limit gate, per-tab origin grant |
| `src/main/browser/unload-guard.ts` (new) | Async `beforeunload` confirm with intent replay |
| `src/main/browser/page-dialog-guard.ts` (new) | One JS dialog box at a time per page; `safeDialogs` fallback; defers to the automation dialog policy |
| `src/main/cdp/cdp-page-events.ts`, `src/main/cdp-service.ts` | `automationAnswersDialog` / `automationAnswersPageDialog` (follow-up fix) |
| `src/main/browser/download-request-limiter.ts` (new) | One automatic download per document |
| `src/main/browser/browser-page-guard-service.ts` (new) | IPC entry for Allow and navigation intents |
| `src/main/download-path-queue.ts` (new) | Per-page Save-dialog queue |
| `src/main/browser/BrowserGuest.ts` | Uses the collaborators; sync unload box removed |
| `src/main/browser/popup-policy.ts` | `popupWindowOptions` (clamp), `showPopupOrigin`, dialog guard, nested tab gate |
| `src/main/browser/navigation-scheme-guards.ts` | Installs the dialog guard at guest creation |
| `src/main/browser-service.ts` | Carries guest state across re-registration; dialog preferences (no net growth) |
| `src/main/download-service.ts` | Download gate, queue, temp hold |
| `src/ipc/popup-rate-limiter.ts` | Permanent-allow API removed |
| `src/ipc/browser-ipc.ts`, `src/ipc/main/browser-handlers.ts` | `allowPopups(key)`, `navigationIntent` channel and types |
| `src/ipc/browser-guest-messages.ts`, `src/preload-webview/page-reporters.ts` | Title/favicon caps, 250 ms report throttle |
| `src/renderer/editors/browser/BrowserPromptsModel.ts`, `BrowserPageLinkOpener.ts`, `BrowserWebviewModel.ts`, `BrowserGuestChannel.ts`, `webview-context-menu.ts` | Tab-scoped Allow, renderer limiter removed, navigation intents |
| `src/shared/i18n/en/main.ts`, `assets/languages/*.lang.json` (17) | `main.preventMoreDialogs`, `main.downloadsBlocked` |
| `doc/architecture/browser-editor.md`, `key-files.md`, `folder-structure.md` | Developer docs |
| `assets/guides/editors/browser/network-and-agent.md`, `layout.md`, `assets/guides/whats-new.md` | User docs |
