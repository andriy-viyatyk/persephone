# US-2145: Browser — URL-bar/UI spoofing and local-surface hygiene

**Status:** Done (2026-11-21) — #1, #2, #3, #5, #7 fixed and verified on an owned dev instance; #4
deferred (see "Deferred"); #6 was fixed by US-2142. Recorded the same day: **#1–#5 reproduced on
5.0.20; #7 code-confirmed** (see "Runtime reproduction"), and #7 also reproduced on the dev build
before the fix (see "Verification"). Planned, implemented and completed in one authorized run.
**Severity:** Low–Medium. A grab-bag of lower-risk hardening items.
**Evidence branch:** `upcoming-v5.0.21` @ `4656a6cb`; plan re-verified on `f27b08ee` (after US-2140…US-2144).

## Goal

Stop a web page from dressing itself up as trusted chrome — a misleading address, a silent full-screen
or pointer lock, a board opened with page-chosen data without asking — and close three local-surface
gaps: an unescaped cURL command, a forged internal drag payload, and (deferred, see below) MCP
connections from other local processes.

## Confirmed by code review

**UI spoofing**
1. **URL bar shows raw URL, keeps userinfo, no security indicator.** `BrowserUrlBarModel.syncFromUrl`
   puts the full committed URL in the input (`:48-54`); no host emphasis, no userinfo stripping, no
   padlock/"Not secure" (only `BrowserToolbarView.ts:200` checks `https:`). **Reproduced on 5.0.20:**
   `http://accounts.example.com@127.0.0.1:…` shows with the userinfo kept, a 200-char path shows in
   full, and there is no not-secure marker.
2. **Fullscreen and pointer lock granted with no notice.** `permission-policy-service.ts:163,217`
   always allow; the guest fills the app window (`BrowserWebviewItemView.ts:73-86`); no "press Esc"
   overlay found. A page can draw fake Persephone chrome or a fake OS prompt. (Escape does always
   exit fullscreen — intercepted in main `before-input-event`, `BrowserGuest.ts:240-244` — users just
   aren't told.)
3. **Board-claimed scheme opens with page-chosen data after any input.** Since US-2144 the hand-off
   consumes a fresh gesture (`UserActivation`, `user-activation.ts`; `BrowserGuest.handOffExternal`,
   `:231-233`), but it then fires `eOpenPipelineCandidate` and `openPageSchemeCandidate()`
   (`content/page-scheme-handoff.ts`) opens any board-claimed scheme with no "Open in <board>?"
   prompt. Exploitability depends on the board.

**Local-surface hygiene** (not reachable from a *web page*, but worth fixing)
4. **MCP server has no auth for other local processes.** `mcp-http-server.ts:57-71,85-93` — once Host
   and Origin pass, any loopback `initialize` opens a session, and the tool surface includes
   `script.execute`. Browsers are correctly refused and it is off by default, but any other local
   user/process on the machine gets code-exec as the user. *(Verified Host/Origin gate; this is the
   remaining gap.)* **Deferred** — see "Deferred".
5. **cURL strings from the network log are not shell-escaped.** `network-log-links.ts:88-104` builds
   `curl '<url>'` / `-H '<k>: <v>'` with only the body escaped; a page-controlled header/path with a
   `'` yields a copy-paste command injection in the user's shell. The method is also unquoted, and an
   HTTP method token may contain `|`, `&`, `` ` `` and `$`.
6. **Favicon cache / loopback GET** — **fixed by US-2142** (`components/icons/favicon-cache.ts`:
   per-hop `http(s)` check, cross-host private/loopback targets refused, pinned lookup; see the
   US-2142 row in `doc/tasks/completed.md`). Nothing to do here.
7. **Forged internal drag payload.** `core/traits/dnd.ts:28-31` reads `application/persephone-trait`
   straight from `dataTransfer`; a drag the host did not start (a web page's, another app's) can
   carry that MIME type, and a folder-page drop turns a forged ILink/FILE_LINK payload into a move or
   import of payload-named paths.

## Runtime reproduction (5.0.20, 2026-11-21)

Owned test instance (`--profile sec-2145`, MCP on `--mcp-port 18145`), loopback fixtures; no OS
input injection or clipboard used.

| # | Result | Evidence |
|---|---|---|
| 1 URL bar | **Reproduces** | `http://accounts.example.com@127.0.0.1:18171/fs` shown in full with userinfo, a neutral (i) icon, no "Not secure". A 200-char path shows in full (input value 228 chars). |
| 2 fullscreen / pointer lock | **Reproduces** | Trusted-click `requestFullscreen()` granted; window went 1026×683 → 1536×960 full screen; `requestPointerLock()` granted. No host overlay/toast, no origin or "press Esc" text (host DOM scan empty, capture shows only the page). |
| 3 board-claimed scheme | **Reproduces** | A trusted test board claiming `zzqqtest:` opened as a board page with `zzqqtest:hello?x=1&src=click` after a trusted click, and after a key-only event (`site.keyDown`) — no prompt. Controls: no input, or hover/mousemove only, did not open it. (`site.pressKey`/`site.type` did not trigger — their CDP key events do not reach `before-input-event`.) |
| 4 MCP auth | **Reproduces** | Plain loopback `initialize` with no Origin and no token → 200 + session id; `tools/list` returns `call`, whose description exposes `main.script.execute` and the page/board object model (listed only, nothing called). `Origin: http://evil.example` and a bad Host → 403, so the existing gate works. |
| 5 cURL escaping | **Reproduces** | Header `X-T: a' ; echo POC ; '` produced `curl '…/x?q=a%27b' -X POST -H 'X-T: a' ; echo POC ; '' -H …` — unbalanced. Chromium percent-encodes `'` in the URL, so the injection rides on header values. (Read from the link-view content; never executed.) |
| 7 forged drag | **Code-confirmed** | `getTraitDragData` (`core/traits/dnd.ts:36-39`) accepts any JSON under the MIME type with no origin/nonce check; folder-page drops go through `getTraitDropAction` (`components/tree-provider/drop-dispatch.ts:13-45`), where a forged ILink payload whose `sourceId` equals the provider's `sourceUrl` becomes a **move** of payload-named paths, and FILE_LINK types become **import-files**. Whether Chromium forwards a guest's custom MIME type to the embedder is unverified (no OS drag was run). |

## Background (current code, re-verified on `f27b08ee`)

- **URL bar.** `BrowserUrlBarModel` (`editors/browser/BrowserUrlBarModel.ts`) owns `urlInput`;
  `syncFromUrl()` (called from `BrowserEditor`, `BrowserTabsModel`, `BrowserEditorView`) copies the
  committed URL verbatim, and Escape restores `model.currentUrl` verbatim. `BrowserToolbarView`
  renders the field with the UIKit `InputView` (start slot: Tor/incognito/proxy markers, then the
  search-engine chip or the site-permissions (i) button; end slot: Navigate, Site actions, Translate,
  star). `InputView` (`uikit/Input/InputView.ts`) has only `startSlot`/`endSlot`; an `<input>` cannot
  style part of its text, so host emphasis needs a separate rendering. No public-suffix list is
  bundled; Chrome itself paints the whole host in the normal colour and dims scheme and path, so the
  host (not eTLD+1) is the unit we emphasise. `BookmarksModel` reads `urlInput` for the star, so a
  stripped value also keeps credentials out of bookmarks.
- **Fullscreen.** `BrowserWebviewItemView` (`BrowserWebviewItemView.ts:73-108`) already listens to the
  webview's `enter-html-full-screen`/`leave-html-full-screen` and stretches the wrapper over the
  window (`data-html-fullscreen`). Main exits fullscreen on Escape (`BrowserGuest.handleInput`). No
  notice is shown.
- **Pointer lock.** Granted in `permission-policy-service.ts` (`handleRequest`, line 217); the host
  never learns about it. Guests run with `contextIsolation: true`, and the webview preload
  (`src/preload-webview.ts`) installs per-frame helpers (`installCinemaMode`) plus main-frame
  reporters that `sendToHost` typed guest messages (`ipc/browser-guest-messages.ts`), which
  `BrowserWebviewItemView` receives (`ipc-message`) and forwards to
  `BrowserWebviewModel.handleGuestMessage` (god file BRW-1, exhaustive `switch`).
- **Board-scheme hand-off.** `BrowserGuest.handOffExternal(url)` (main) consumes the gesture and sends
  the host-wide renderer event `eOpenPipelineCandidate(url)` (no tab, no origin);
  `RendererEventsService.handlePipelineCandidate` calls `openPageSchemeCandidate(url)`. The context-menu
  path (`BrowserPageLinkOpener.handOff`) calls the same function. Scheme ownership lives in
  `content/scheme-registry.ts`; a board registration's `owner` is its board root
  (`api/boards/custom-editor-registry.ts:274-277`), whose display name is
  `customEditorRegistry.findByRoot(root)?.name`.
- **Prompt bar.** `BrowserPromptsModel.permissionPrompts` holds main-issued
  `BrowserPermissionPromptData` per inner tab; `PermissionPromptBarView` (`BrowserPromptBars.ts`)
  shows origin + text and answers through `prompts.resolvePermissionPrompt` → IPC
  `resolvePermissionRequest`; `clearTab` drops a tab's prompts on navigation.
- **cURL.** `network-log-links.ts` builds the href; `core/utils/curl-parser.ts` (`parseHttpRequest`)
  reads it back for the REST Client and the open pipeline. Its tokenizer never resets `quoteChar` after
  a closing quote, so a backslash after a closed single-quoted word is kept literally and the bash
  idiom `'\''` does not round-trip.
- **Drag.** `setTraitDragData` is called only in host `dragstart` handlers; every trait drop reads
  `getTraitDragData`/`getTraitDragDataFromEvent`, and dragover feedback uses `hasTraitDragData`
  (`core/traits/dnd.ts`). OS file drops reach trait targets through the event expando set by
  `GlobalEventService.captureDrop`, not through the MIME type. Cross-window **tab** moves use the
  separate `application/persephone-tab` MIME: the target window only sends `{targetWindowIndex}` to
  main's `DragModel`, which acts only when the source window's own `dragend` event arrives within
  100 ms, so a forged tab payload is inert.

## Implementation plan

### #1 URL bar — owner: new `editors/browser/url-display.ts` (rule) + `InputView` `display` slot (UIKit)

- [x] **`src/renderer/editors/browser/url-display.ts` (new, pure):**
  - `stripUrlUserinfo(url)` — when `new URL(url)` has a username or password, clear both and return
    `href`; otherwise return `url` unchanged (no re-serialisation of other URLs).
  - `urlSecurity(url): "secure" | "not-secure" | "neutral"` — `https:` → secure; `http:` → not-secure
    unless the host is potentially trustworthy as in Chrome (`localhost`, `*.localhost`,
    `127.0.0.0/8`, `[::1]`) → neutral; every other scheme → neutral. Error pages: Persephone has no
    certificate-error bypass (no "proceed" interstitial; `certificate-error` is only handled in test
    mode), so an `https:` URL never commits content without a valid certificate, and an error page is
    Chromium's own document showing no site content — the scheme rule covers it.
  - `urlDisplayParts(url): { scheme; host; rest } | undefined` — for `http(s):` only; `scheme` =
    `protocol + "//"`, `host` = `URL.host` (punycode, port kept; userinfo never included), `rest` =
    pathname + search + hash, with a lone `/` dropped.
  - `originLabel(url)` — `protocol//host` for `http(s):`, the protocol (`file:`) otherwise, `""` when
    unparsable. Used by #2 and #3.
- [x] **`BrowserUrlBarModel`:** `syncFromUrl` stores `stripUrlUserinfo(url)`; the Escape branch of
  `handleUrlKeyDown` restores `stripUrlUserinfo(currentUrl)`.
- [x] **`uikit/Input/InputView.ts` + `Input.css`:** new optional prop `display?: SlotContent` — a
  formatted read-only rendering drawn **over** the field's text while it is not focused. Slot kinds
  widen to `"start" | "end" | "display"`; the display host (`data-part="display"`, `aria-hidden`) is
  inserted right after the `<input>`; the root gets `data-has-display`. CSS (`@layer uikit`): with
  `data-has-display` the root becomes a 3-column grid (start slot / field / end slot) and the field and
  the display share the middle cell; the unfocused field's text is transparent and the display shows
  (`pointer-events: none`, `contain: inline-size` so a long URL never widens the bar). *Changed during
  verification:* the first version collapsed the unfocused `<input>` to zero width, which broke
  `window.screen.click('[data-name="url-input"] input')` (2 failures in `tests/browser/navigation`);
  the overlay keeps the field's box, so clicks, focus and automation are unchanged. `"display"` is in
  `INPUT_OWN_KEYS`.
- [x] **`src/renderer/editors/browser/BrowserUrlDisplayView.ts` (new collaborator, keeps
  `BrowserToolbarView` from growing logic):** a `VanillaView<{ url: string }>` whose root
  (`data-url-display`) holds `scheme` (dimmed), `host` (strong colour; left-elided so the right end —
  the registrable domain — stays visible) and `rest` (dimmed, right-elided) spans, laid out as the grid
  `auto minmax(0, max-content) minmax(0, 1fr)` so the host gets its full width before the path gets
  any (with flex, shrink weights still shaved the host by a fraction of a pixel and painted its
  ellipsis); plus an exported `createNotSecureChip()` element (warning icon + `browser.notSecure`,
  title `browser.notSecureTitle`).
- [x] **`BrowserToolbarView`:** pass `display: parts && !userHasTyped ? urlDisplay.root : undefined`
  in `urlInputProps`; in `syncUrlEntrySlot` append the not-secure chip before the (i) button when
  `urlSecurity(activeUrl) === "not-secure" && !userHasTyped`. CSS in `BrowserView.css`
  (`[data-url-display]`, `[data-not-secure-chip]`), colours from existing tokens
  (`--color-text-light`, `--color-text-default`, `--color-warning-text`).

### #2 Fullscreen / pointer-lock notice — owner: new `editors/browser/BrowserExclusiveAccessNotice.ts`

- [x] **`src/preload-webview/exclusive-access-reporter.ts` (new, every frame):** a capture-phase
  `pointerlockchange` listener on `document` that sends the new guest message `pointer-lock` with
  `{ locked: !!document.pointerLockElement }`. Install from `src/preload-webview.ts` outside the
  main-frame block (an iframe can lock the pointer too). The preload is in an isolated world and
  registers first, so the page cannot suppress it.
- [x] **`src/ipc/browser-guest-messages.ts`:** add `pointerLock: "pointer-lock"` to the channel table,
  the union and `parseGuestMessage` (boolean payload only).
- [x] **`BrowserExclusiveAccessNotice` (new view):** `show(kind: "fullscreen" | "pointer-lock",
  origin)` renders a centred pill at the top of its parent (`pointer-events: none`) with
  `browser.fullscreenNotice` / `browser.pointerLockNotice` and hides it after
  `EXCLUSIVE_ACCESS_NOTICE_MS` (4 000 ms, Chrome's bubble is similar); `hide()` on leave/unlock.
  *Found during verification:* in HTML fullscreen the `<webview>` is the host document's
  `fullscreenElement` and sits in the **top layer**, above any z-index, so the notice was in the DOM
  but not on screen. While shown and the document is fullscreen it now joins the top layer as a
  manual popover (`restack()`, also run on `fullscreenchange`).
- [x] **`BrowserWebviewItemView`:** owns the notice in its wrapper (so in HTML fullscreen it sits on
  top of the full-screen page); `enter-html-full-screen` → show fullscreen notice, leave → hide;
  `onIpcMessage` handles `pointer-lock` locally (show/hide) and forwards everything else. The
  forwarded type narrows to `Exclude<GuestMessage, { channel: "pointer-lock" }>` in
  `BrowserWebviewModel.handleGuestMessage`'s signature (no new case in the god file). Origin from
  `originLabel(tab.url)`.
- [x] Escape: fullscreen already exits through `BrowserGuest.handleInput`; pointer lock is released by
  Chromium on Escape (confirmed at runtime with `webContents.sendInputEvent`, see "Verification"), so
  no main-process change was needed.

### #3 Board-scheme confirmation — owner: `content/page-scheme-handoff.ts` (rule + remembered answers), `BrowserPromptsModel` (asking)

- [x] **Main `BrowserGuest.handOffExternal`:** keep the gesture (`activation.consume()`, a key press
  still counts, as in Chrome) but send the per-tab browser event `scheme-handoff` (`{ url }`) through
  `sendEvent` instead of the host-wide `eOpenPipelineCandidate`, so the renderer knows the tab and its
  origin. Remove `sendHostEvent` from `BrowserGuestHooks` and `browser-service.ts`, the
  `eOpenPipelineCandidate` contract (`ipc/contracts/browser.ts`) and its subscriber in
  `RendererEventsService`. Add `"scheme-handoff"` to `BrowserEventType`.
- [x] **`BrowserWebviewModel` event router:** route `scheme-handoff` to the existing `new-window` case
  (`case "new-window": case "scheme-handoff":` → `pageLinks.openLink(url, tabId, "page")`); the
  `openLink` policy sends non-Chromium URLs to the hand-off. One label, no new logic in the god file.
- [x] **`content/page-scheme-handoff.ts`:**
  - `pageSchemeClaim(url): { scheme; board } | undefined` — the scheme and claiming board's manifest
    name (`boardSchemeOwner(scheme)` from `scheme-registry.ts`, new accessor returning the owner root;
    name via the new `trustedProviderBoardName(root)` in `content/registry.ts` — a claimed scheme
    always has a provider declaration — else the root's basename; `customEditorRegistry` names the
    board's *editor*, not the board).
  - `pageSchemeDecision(partition, origin, scheme)` / `rememberPageSchemeDecision(…, decision)` —
    in-memory map for the app session, keyed by browser partition + page origin + scheme (Chrome asks
    once per origin and scheme; private partitions never touch disk).
  - `openPageSchemeCandidate(url)` unchanged (opens; now called only after consent).
- [x] **`BrowserPageLinkOpener.handOff(url, sourceTabId, origin)`** (both `menu` and `page` origins):
  unclaimed → refused toast for `menu`, silent for `page`; remembered `block` → nothing; remembered
  `allow` → open; otherwise `prompts.askBoardScheme(tabId, originLabel(tab.url), claim, url, onDecision)`,
  which remembers the answer and opens on Allow.
- [x] **`BrowserPromptsModel`:** `BrowserPermissionPrompt` gains `boardScheme?: { scheme; board; url }`;
  `askBoardScheme` enqueues a renderer-local prompt (fresh `requestId`, a resolver in a private map;
  a repeat request for the same tab + origin + scheme replaces the pending URL instead of stacking);
  `resolvePermissionPrompt` calls the local resolver when one exists, else IPC as today; `clearTab`
  drops local resolvers of removed prompts (no decision recorded).
- [x] **`PermissionPromptBarView.sync`:** `boardScheme` → `browser.permissionOpenBoardScheme`
  (`{scheme}`, `{board}`), tooltip = the URL. Same Allow / Block buttons.

### #5 Shell-safe cURL — owner: `network-log-links.ts` (builder), `curl-parser.ts` (round trip)

- [x] `shellQuote(value)` = `'` + value with `'` → `'\''` + `'`; apply to the URL, the method, each
  `name: value` header and the body.
- [x] `hasControlChars(value, allowWhitespace)` — URL, method and header names/values with any C0
  control or DEL drop the whole entry (Chromium never sends those, so this is a guard, not a
  loss); a body with C0 controls other than tab/CR/LF (ESC can end a terminal's bracketed paste) is
  left out of the command (such a body is binary decoded as UTF-8 and was never reproducible).
- [x] `curl-parser.ts` `tokenize`: reset `quoteChar` when a quote closes, so `'\''` (and `\` outside
  quotes in general) parses as bash does and the REST Client reads back the escaped command.

### #7 Forged drag payload — owner: `core/traits/dnd.ts`

- [x] `setTraitDragData` adds a fresh per-drag `nonce` (`crypto.randomUUID()`) to the payload and keeps
  it as the host's active drag; installs (once) document capture listeners that end it on `dragend`,
  after a `drop` (deferred with `setTimeout(0)` so the drop handlers still see it), and on
  `pointerdown`.
- [x] `getTraitDragData` returns the payload only when its `nonce` equals the active nonce;
  `hasTraitDragData` is true only while a host drag is active. A drag that did not start in this
  document (a web page's, another app's, another Persephone window's) therefore never yields a trait
  payload; OS file drops keep working through the event expando.
- [x] `application/persephone-tab` unchanged (target-side data is not trusted; see Background).

## Concerns / decisions

- **URL-bar display vs. edit value.** The `<input>` keeps the full URL (minus userinfo) so editing,
  selection, copy, the star and automation (`url-input` value) behave as before; only the unfocused
  rendering changes. Dropping userinfo also from the edit value matches Chrome and keeps credentials
  out of bookmarks; Enter on such a page reloads without the embedded credentials (Chrome does the
  same).
- **No eTLD+1 without a public-suffix list.** The whole host is emphasised and left-elided, so its
  registrable end is always on screen; adding a PSL dependency for a bolder sub-span is not worth it.
- **Loopback `http:` is not marked**, as in Chrome (it is potentially trustworthy); dev servers would
  otherwise always show the chip.
- **Board-scheme gesture.** A key press still counts as the gesture (Chrome's user activation includes
  keys); the new prompt is the gate — a page cannot click the host prompt bar. Answers are
  remembered per partition, origin and scheme for the app session, both Allow and Block, so a page
  cannot re-prompt after a Block; restarting Persephone forgets them. The context-menu "Open Link in
  New Tab" path asks too (one rule for page-supplied links).
- **Drag.** Trait drags now work only inside the window where they started; dragging a link from
  one Persephone window into another window's link page or Explorer stops working (tab moves between
  windows are unaffected). A nonce left active by a `dragend` that never reached the document (a
  source element removed mid-drag) is cleared by the next `pointerdown` or host drag.
- **Guardrails.** No new protocol code (one guest-message channel and one browser-event type on the
  existing tables). God files: `BrowserWebviewModel.ts` gets one `case` label and a narrowed
  parameter type, `browser-service.ts` shrinks (`sendHostEvent` removed); new behaviour lives in new
  collaborators (`url-display.ts`, `BrowserUrlDisplayView.ts`, `BrowserExclusiveAccessNotice.ts`,
  `exclusive-access-reporter.ts`). `window.persephone` unchanged (no bridge bump).

## Deferred

**#4 MCP authentication for other local processes.** Requiring a bearer token on the public MCP
endpoint would break every configured client — the user's Claude Code connection, other projects'
`.mcp.json` files, the integration runner's attach mode — none of which Persephone can rewrite. The
exposure is limited: the server is off by default, listens on loopback only, refuses any `Origin` and
foreign `Host`, and a process already running as the same Windows user can do anything the user can.
What remains is other *accounts* on a shared machine (and sandboxed processes that may still reach
loopback).

Options:
1. **Opt-in token** — new setting `mcp.requireToken` (default `false`). When on, Persephone keeps a
   random token in a user-ACL'd file under `userData` (as the private board endpoints already issue
   tokens, `mcp/private-session-endpoints.ts`), requires `Authorization: Bearer <token>` on
   `initialize`, and the MCP settings section shows the setup snippet with the header. Non-breaking,
   but protects only users who turn it on.
2. **Token by default for new setups** — `mcp.requireToken` defaults to `true` only when `mcp.enabled`
   is first switched on after the upgrade; existing enabled setups keep `false` and get a one-time
   notice. Closes the gap for new users without breaking anyone.
3. **Windows named pipe / per-user ACL transport** — strongest, but MCP clients speak HTTP; not
   practical.

**Recommendation:** option 2 (built on option 1's mechanism), as its own task with the settings UI,
the setup snippet in the MCP section and agent guides, and an integration-runner check that attach
mode passes the token. Not done here because it changes the user-visible setup flow.

## Acceptance criteria

- [x] Unfocused, the URL bar shows no userinfo, renders scheme and path dimmed and the host emphasised,
      and a long path or subdomain never pushes the host's right end out of view; focused, the field
      edits the full URL (userinfo dropped).
- [x] Non-loopback `http:` pages show a "Not secure" marker; `https:` and loopback pages do not.
- [x] Entering HTML fullscreen or pointer lock shows a host notice naming the origin and Esc; it
      disappears after a few seconds or on exit.
- [x] A page (navigation, `target=_blank`, `window.open`, or the context-menu item) cannot open a
      board-claimed scheme without a fresh gesture **and**, once per origin/scheme, an Allow in the
      prompt bar; Block is remembered for the session.
- [x] Copied/opened cURL commands are shell-safe for any URL, method, header and body value, entries
      with control characters in URL/method/headers are dropped, and the REST Client still parses
      them.
- [x] A trait payload on a drag the host document did not start is ignored by every trait drop
      target; in-window trait drags and cross-window tab moves still work.
- [x] #4 recorded under "Deferred" with options and a recommendation; #6 points to US-2142.
- [x] `npm run typecheck`, `npm run lint`, `npm run i18n:check` (and `guides:check` if guides change)
      pass.

## Verification

Owned dev instance (`electron .vite/build/main.js --test <file> --profile sec-fix-2145*`), loopback
fixtures only (`127.0.0.1:18175`, the same server as `localhost:18175`, and `*.localhost`, which
Chromium resolves to loopback itself), each instance closed after its run; no OS input, clipboard or
OS drag. Escape and the key-only gesture were sent with Electron's `webContents.sendInputEvent` on the
owned guest (the runner's CDP `site.keyDown` reaches neither the fullscreen/pointer-lock exit nor the
page when focus is in the host). Scripts, logs and screenshots: `<scratchpad>/us2145-verify/`
(`server.mjs`, `v.test.mjs`, `v7.test.mjs`, `fsdbg.test.mjs`, `logs-*`, `run-*.out`, `*.png`).

| # | After the fix | Before |
|---|---|---|
| 1 userinfo | `http://accounts.example.com@127.0.0.1:18175/a` → field value `http://127.0.0.1:18175/a`; unfocused rendering `http://` + **`127.0.0.1:18175`** + `/a` (`urlbar-u1.png`); focused, the full editable URL | shown in full with userinfo |
| 1 long path | 200-char path: host fully shown, path ellipsised at the right (`urlbar-u2.png`) | path shown in full |
| 1 long host | 127-char `…-accounts-example-com.bbbb….localhost` host: cut on the **left**, `….bbbb.localhost:18175` visible (`urlbar-u3.png`); toolbar buttons stay in place | — |
| 1 marker | `urlSecurity()` at runtime: `http://example.com/`, `http://intranet:8080/x` → not-secure; `https://…`, `localhost`, `127.0.0.9`, `[::1]`, `*.localhost`, `file:`, `about:` → no marker; the loopback fixture pages show no chip | no marker anywhere |
| 2 fullscreen | Trusted click → window full screen, notice "http://127.0.0.1:18175 is now full screen. Press Esc to exit full screen." on top of the page (`fs-notice-2.png`, popover in the top layer), gone after 5 s; Esc (`sendInputEvent`) → page and window leave fullscreen | no notice (`fs-1.png` in the reproduction) |
| 2 pointer lock | Trusted click → `pointerLockElement=HTML`, notice "… has hidden your mouse pointer. Press Esc to show it." (`pl-notice.png`); Esc → lock released, notice gone | granted silently |
| 3 board scheme | No input: nothing. Trusted click on A: **no page**, bar "This site wants to open a zzqqtest: link in the board "US2145 Scheme Board"." (`scheme-prompt.png`), tooltip = the URL; **Allow** → board page `zzqqtest:hello?x=1&src=click`; a second click on A → opens without asking. Key press on B (`localhost`): bar again (another origin); **Block** → nothing; another key press → no bar, no page | opened on click or key with no prompt |
| 5 cURL | Show Resources POST entry: `curl 'http://127.0.0.1:18175/x?q=a%27b' -X 'POST' -H 'X-T: a'\'' ; echo POC ; '\''' … --data-raw 'it'\''s'`; fed to bash with `curl` replaced by an argument printer: one call, header value `a' ; echo POC ; '` intact, nothing echoed | quote broken out, `; echo POC ;` outside quotes |
| 5 round trip | `parseHttpRequest` on built commands returns the original header, body and method (`X|calc` stays one quoted word); a header with a newline drops the entry; an ESC body is left out of the command | body escape mis-parsed by the tokenizer |
| 7 forged drag | CDP `Input.dispatchDragEvent` (an external drag the host did not start) carrying a `BrowserTab` trait payload onto tab row 1: **order unchanged** | before the fix, on the same dev build: tabs reordered `c,a,b` |
| 7 in-window | Synthetic host `dragstart` on row 3 → `drop` on row 1: reordered `c,a,b` (nonce honoured); replaying that DataTransfer onto row 3 after `dragend`: ignored | — |

UI suites run against the change: `browser/popups` 19/19, `browser/page-tools` 7/7,
`browser/navigation` 7/7, `browser/tabs` 5/5, `sidebar/explorer` 3/3, `boards/extensions` 11/11,
`browser/automation` 33/35 — the 2 failures are `observe.test.mjs` dialog-policy tests, which now get a
native message box from US-2144's `page-dialog-guard` instead of the automation dialog policy; this
task does not touch JS dialogs (reported, not fixed here; fixed as a US-2144 follow-up, now 35/35).

**Code-only:** the "Not secure" chip on a real non-loopback `http:` page (fixtures must stay on
loopback; the rule was checked at runtime, the chip itself only by code); **Open Link in New Tab** on a
board-scheme link from the context menu (same `handOff` path as the click case); answers being kept per
partition (in-memory map keyed by partition, origin and scheme).
**Hand check:** (1) on an installed build, open a plain-`http:` LAN page: the URL bar shows **Not
secure**. (2) A site's fullscreen video: the notice appears over the video and a real `Esc` exits; a
pointer-lock demo page: a real `Esc` shows the pointer again. (3) Drag a link from a web page onto an
Explorer folder: nothing is moved or imported. Drag a link between two Persephone windows: ignored
(expected); dragging a tab between windows still moves it.

## Files changed

| File | Change |
|---|---|
| `src/renderer/editors/browser/url-display.ts` (new) | URL-bar presentation rules: `stripUrlUserinfo`, `urlSecurity`, `urlDisplayParts`, `originLabel` |
| `src/renderer/editors/browser/BrowserUrlDisplayView.ts` (new) | Unfocused URL rendering and the "Not secure" chip |
| `src/renderer/editors/browser/BrowserExclusiveAccessNotice.ts` (new) | Fullscreen / pointer-lock notice (top-layer popover while fullscreen) |
| `src/preload-webview/exclusive-access-reporter.ts` (new), `src/preload-webview.ts` | Per-frame pointer-lock report |
| `src/ipc/browser-guest-messages.ts` | `pointer-lock` guest message |
| `src/renderer/uikit/Input/InputView.ts`, `Input.css` | `display` slot drawn over the unfocused field |
| `src/renderer/editors/browser/BrowserToolbarView.ts`, `BrowserUrlBarModel.ts`, `BrowserView.css` | URL display, chip, userinfo stripping, notice and URL styles |
| `src/renderer/editors/browser/BrowserWebviewItemView.ts` | Owns the notice; consumes `pointer-lock` |
| `src/main/browser/BrowserGuest.ts`, `src/main/browser-service.ts`, `src/ipc/browser-ipc.ts`, `src/ipc/contracts/browser.ts`, `src/renderer/api/internal/RendererEventsService.ts` | Hand-off is the per-tab `scheme-handoff` browser event; `sendHostEvent` hook and `eOpenPipelineCandidate` removed |
| `src/renderer/editors/browser/BrowserWebviewModel.ts` | `scheme-handoff` shares the `new-window` case; narrowed guest-message type (net 0 lines) |
| `src/renderer/editors/browser/BrowserPageLinkOpener.ts`, `BrowserPromptsModel.ts`, `BrowserPromptBars.ts` | Once-per-origin board-scheme prompt (renderer-local) |
| `src/renderer/content/page-scheme-handoff.ts`, `scheme-registry.ts`, `registry.ts` | Claim check with the board name, session answers, `boardSchemeOwner`, `trustedProviderBoardName` |
| `src/renderer/editors/browser/network-log-links.ts`, `src/renderer/core/utils/curl-parser.ts` | Shell-safe cURL; the tokenizer resets the quote character after a quote closes |
| `src/renderer/core/traits/dnd.ts` | Per-drag host nonce |
| `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts` | `url-not-secure`, `browser-exclusive-access-notice` element entries |
| `src/shared/i18n/en/browser.ts`, `assets/languages/*.lang.json` (17) | 6 new `browser.*` messages |
| `doc/architecture/browser-editor.md`, `trait-system.md`, `key-files.md`, `folder-structure.md` | Developer docs |
| `assets/guides/editors/browser/index.md`, `layout.md`, `assets/guides/boards/content-providers.md`, `assets/guides/whats-new.md` | User docs (the View certificate paragraph moved from the hub to `layout.md` to keep the hub under 10,000 characters) |

**No changes needed:** `src/main/permission-policy-service.ts` (fullscreen/pointer lock stay
granted — the notice is the fix), `src/main/mcp-http-server.ts` (#4 deferred),
`src/renderer/components/icons/favicon-cache.ts` (#6 done in US-2142),
`src/main/drag-model.ts` and the `application/persephone-tab` handlers (inert forged data),
`src/main/browser/user-activation.ts`, `popup-gate.ts` (reused as is).
