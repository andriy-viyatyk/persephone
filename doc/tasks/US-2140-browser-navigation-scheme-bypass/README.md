# US-2140: Browser — page-data URLs bypass the navigation scheme block

**Status:** Completed (2026-11-21). Planned, implemented, verified and completed in one authorized
run; design decisions recorded below. One item deferred (see "Deferred").
**Severity:** High (local file disclosure; the most serious finding of the 2026-11-21 browser review).
**Evidence branch:** `upcoming-v5.0.21` @ `4656a6cb`. Reproduced on installed build **5.0.20** and on
the dev build before the fix.

## Goal

Make URLs that come from page-controlled data (context-menu "Open link/image in new tab",
`window.open`/`target=_blank`) go through the same scheme policy that renderer-initiated navigation
already enforces, so a web page cannot open `file:`, `data:` or other blocked schemes as a top-level
document, and so a `file:` document's frames are guarded from its first load.

## What is confirmed (code review, 2026-11-21)

`will-navigate` / `will-frame-navigate` block `file:` and `app-asset:` for navigation inside a
guest (`src/main/browser/BrowserGuest.ts:143-149`, `navigation-scheme-policy.ts:1-17`). But a new
tab is created by setting `webview.src` directly (`BrowserWebviewItemView.ts:40`), which is an
embedder-initiated load — `will-navigate` never fires — and the context menu passes the page's raw
`params.linkURL` into that path:

- `src/renderer/editors/browser/webview-context-menu.ts:84-92` → `model.tabs.addTab(linkURL, …)`.
- `grantFileProtocolExtraPrivileges` stays on (`electron-builder.yml:61-62`), so a `file:` document
  has extra read privileges.
- `doc/architecture/browser-editor.md:255-262` describes a `did-start-navigation` + `wc.stop()`
  check that does not match the code — **the doc hides the gap and should be corrected.**

## Runtime reproduction (5.0.20)

Reproduced on 5.0.20 in an owned test instance:

1. **`file:` link bypass** — left-click on `<a href="file:///C:/Windows/System32/drivers/etc/hosts">`
   does nothing; right-click → **Open Link in New Tab** opens the file in a new tab, text visible.
2. **Local file read from the opened page** — a page opened through that menu path read
   `C:\Windows\win.ini` via `fetch`, XHR **and** iframe `contentDocument`, all three returned the
   content.
3. **`data:` top-level documents** — a `data:text/html,…` URL renders as a top-level tab via the
   context menu, via `target=_blank`, and via `window.open` (Chrome refuses this for
   page-initiated navigation).

Partial / not reproduced:
- "Open Image in New Tab" on a `file:` image opens an image-view page that loads the `file:` URL as
  an image only; no file text was exposed.
- `target=_blank`/`window.open` with a `file:` URL open nothing (safe).
- `javascript:` and `chrome://` from the menu land on `about:blank#blocked`.

Not tested (inferred): a remote attacker HTML reached over a `file:` UNC/WebDAV path, and network
exfiltration of the read bytes. The proven chain needs the attacker's HTML reachable at a `file:`
URL and a user right-click.

Reproduction material: the investigation's `repro\a\` scratch folder (`server.mjs`, `poc.html`,
`a.test.mjs`, `results.md`).

## Background

### Where a browser tab's URL comes from

| Source | Path | Trust |
|---|---|---|
| Address bar, Home, search engine switch | `BrowserUrlBarModel` → `BrowserEditor.navigate()` → `BrowserWebviewModel.load()` (`webview.loadURL`) | User — `file:` and `data:` allowed (as in Chrome) |
| Session restore | `applyRestoreData()` → `BrowserWebviewItemView` sets `webview.src = tab.url` | App — allowed |
| Scripts / MCP / `openUrlInBrowserTab()` / open pipeline (`content/open-actions/browser.ts`) | `BrowserEditor.navigate()` / `addTab()` | App/agent — allowed |
| Bookmarks (drawer, blank page) | `BrowserBookmarksModel` → `tabs.addTab(link.href)` | User's own data — allowed |
| Site-action results (`kind: "url"`, `"links"`, `"video"`) | `validateSiteActionResult()` | Already restricted to `http(s)` without credentials (`site-extension-actions.ts:8-11`) — no change |
| **Context menu "Open Link in New Tab"** | `webview-context-menu.ts` → `model.tabs.addTab(linkURL)` | **Page data — was unchecked** |
| **Context menu "Open Image in New Tab"** | `webview-context-menu.ts` → `pages.openImageInNewTab(srcURL)` (host `<img>`, not a guest) | Page data — loads `file:` as an image only |
| **`target=_blank`, `window.open()` (tab dispositions)** | `BrowserGuest.setWindowOpenHandler` → `"new-window"` event → `BrowserWebviewModel` → `addTab(url)` | **Page data — only Chromium's own checks** |
| **`window.open()` with features (popup window)** | `BrowserGuest.setWindowOpenHandler` → `action: "allow"` → popup `BrowserWindow` | **Page data — `data:` popups allowed** |
| Page-initiated main/sub-frame navigation | `BrowserGuest` `will-navigate`, `will-redirect`, `will-frame-navigate` | Guarded — but only **after** registration (`dom-ready` of the first document) |

### Existing policy

- `src/main/browser/navigation-scheme-policy.ts` — `getNavigationScheme(url)`: `blocked`
  (`file:`, `app-asset:`), `chromium` (`http`, `https`, `about`, `blob`, `mailto`, `tel`),
  `external` (anything else, including `data:`/`javascript:`/custom schemes), `invalid`.
- `BrowserGuest.handleNavigation` (main): `blocked` → prevent; `external` → prevent and, after a
  recent user activation, hand to the host as `eOpenPipelineCandidate`, where
  `RendererEventsService.handlePipelineCandidate` opens it only if a trusted board claimed the
  scheme (`isBoardClaimedScheme`).
- `popup-policy.ts` `attachPopupNavigationGuards()` — the same scheme guards for popup windows.

### Timing gap found during planning

`BrowserGuest` attaches its listeners when the renderer registers the guest, which happens on the
first `dom-ready`. A document loaded by `webview.src` (a new tab) has already parsed and started its
subframes by then, so `will-frame-navigate` misses them: this is why the A2 iframe read succeeded in
a new tab while the same page loaded into an *existing* (registered) tab had its `file:` iframe
blocked. `setWindowOpenHandler` is likewise unset until registration.

## Design decisions

1. **One shared policy owner.** The scheme classification moves to
   `src/shared/browser-navigation-policy.ts` so main and renderer apply the identical rule. A new
   `getPageOpenAction(url)` names the page-open rule once: `chromium` → **open**, `external` →
   **hand off** (only a trusted board's claimed scheme consumes it; `data:`/`javascript:` and every
   other unclaimed scheme are dropped), `blocked`/`invalid` → **refuse**. This is exactly the rule
   `will-navigate` already applies, now also used for new tabs and windows.
2. **Main enforces page-initiated window opens.** `BrowserGuest`'s and popups' window-open handlers
   run `getPageOpenAction` first: non-`open` URLs are denied; `external` URLs go through the same
   activation-gated host hand-off as `will-navigate` (extracted to `BrowserGuest.handOffExternal`).
3. **Renderer owns page-sourced URLs it opens itself.** New collaborator
   `BrowserPageLinkOpener` (`editors/browser/BrowserPageLinkOpener.ts`, composed by `BrowserEditor`
   as `pageLinks`) is the only path for page-supplied URLs: the context-menu link and image items and
   the `"new-window"` event. Trusted sources (address bar, restore, scripts, bookmarks) keep calling
   `navigate()`/`addTab()` unchanged — so `file:` still opens from the address bar and restore.
   Moving the `"new-window"` logic out of `BrowserWebviewModel` (a §2.3 god file) shrinks it.
4. **Guards attach at guest creation.** A new `src/main/browser/navigation-scheme-guards.ts`
   (`attachNavigationSchemeGuards`, formerly `attachPopupNavigationGuards`) is attached to every
   webview guest in `web-contents-created`, together with a deny-all window-open handler that
   registration replaces. `BrowserGuest` drops its now-duplicate `will-redirect` /
   `will-frame-navigate` listeners and keeps `will-navigate` for the external hand-off.
5. **Feedback.** A user-chosen menu item that is refused shows one notification
   (`browser.pageUrlRefused`). Page-initiated opens are refused silently, as in Chrome.
6. **Images.** "Open Image in New Tab" refuses only `blocked` sources (`file:`, `app-asset:`); `data:`
   images still open, because the image viewer renders them in the host, not as a guest document.
7. **Not changed:** the `blocked` `did-start-navigation` event / renderer `goBack()` branch (verified
   at runtime that Chromium stops `http`→`file:` before `will-navigate`; out of scope), site-action
   validation (already `http(s)` only), bookmarks and Show Resources (user-confirmed / user-clicked).

## Implementation plan

- [x] **Shared policy.** Create `src/shared/browser-navigation-policy.ts` with the moved contents of
  `src/main/browser/navigation-scheme-policy.ts` (`USER_ACTIVATION_WINDOW_MS`, `NavigationScheme`,
  `getNavigationScheme`) plus:
  ```ts
  export type PageOpenAction = "open" | "handoff" | "refuse";
  export function getPageOpenAction(url: string): PageOpenAction {
      const scheme = getNavigationScheme(url);
      if (scheme === "chromium") return "open";
      if (scheme === "external") return "handoff";
      return "refuse";
  }
  ```
  Delete `src/main/browser/navigation-scheme-policy.ts`.
- [x] **Main guards.** Create `src/main/browser/navigation-scheme-guards.ts`:
  `attachNavigationSchemeGuards(contents)` (body of `attachPopupNavigationGuards`) and
  `guardBrowserGuestAtCreation(contents)` = `globalMuteService.register(contents, "webview")` +
  `attachNavigationSchemeGuards(contents)` + `contents.setWindowOpenHandler(() => ({ action: "deny" }))`.
  `popup-policy.ts` imports `attachNavigationSchemeGuards` and its window-open handler denies
  `getPageOpenAction(url) !== "open"` first.
- [x] **browser-service.ts** `initializeBrowserService`: replace
  `if (contents.getType() === "webview") globalMuteService.register(contents, "webview");` with
  `if (contents.getType() === "webview") guardBrowserGuestAtCreation(contents);` (no net growth).
- [x] **BrowserGuest.ts:** import from the shared module; remove the `will-redirect` and
  `will-frame-navigate` listeners (now attached at creation); extract
  `private handOffExternal(url)` from `handleNavigation`; at the top of `setWindowOpenHandler`:
  ```ts
  const action = getPageOpenAction(url);
  if (action !== "open") {
      if (action === "handoff") this.handOffExternal(url);
      return { action: "deny" };
  }
  ```
- [x] **Renderer hand-off helper.** Create `src/renderer/content/page-scheme-handoff.ts`:
  `openPageSchemeCandidate(url): Promise<boolean>` — board-claimed scheme → `openRawLink`, returns
  whether it was claimed. `RendererEventsService.handlePipelineCandidate` delegates to it.
- [x] **BrowserPageLinkOpener.ts** (new, `editors/browser/`): `openLink(url, sourceTabId, origin:
  "menu" | "page")` (refuse → notify for `menu`; hand-off → `openPageSchemeCandidate` for `menu`,
  ignored for `page` because main already handed it off; open → rate limit for `page`, `addTab` in the
  source tab's group, `browserUrlChanged` claim check) and `openImage(srcURL)` (refuse `blocked`
  sources; otherwise the existing session-source + `pages.openImageInNewTab` code).
- [x] **BrowserEditor.ts:** compose `readonly pageLinks = new BrowserPageLinkOpener(this)`.
- [x] **BrowserWebviewModel.ts:** `"new-window"` case → `this.model.pageLinks.openLink(data.url,
  internalTabId, "page")`; drop the moved code and unused imports.
- [x] **webview-context-menu.ts:** link item → `model.pageLinks.openLink(linkURL, internalTabId,
  "menu")`; image item → `void model.pageLinks.openImage(srcURL)`.
- [x] **i18n:** `browser.pageUrlRefused` in `src/shared/i18n/en/browser.ts`; translate into all 17
  packs in `assets/languages/`.
- [x] **Docs:** `browser-editor.md` (§ New Window Handling, § 5 Protocol blocking rewritten to the
  real mechanism, context-menu table, key files, "Why the Main Process Bridge"), `key-files.md`,
  `folder-structure.md`.
- [x] Gates: `npm run typecheck`, `npm run lint`, `npm run i18n:check`.

## Deferred

**Extra `file:` privileges for documents the user opens on purpose.** With the fix, no page-data path
can put a `file:` document in a guest, and its frames are guarded from the first load. A `file:` page
that the user opens deliberately (address bar, restore, script) can still `fetch`/XHR other local
files, because the `grantFileProtocolExtraPrivileges` fuse is on (verified: A6 below). Chrome denies
this. Options:

1. Serve the production app window from a privileged custom scheme (e.g. `app://`) instead of
   `loadFile`, then turn the fuse off in `electron-builder.yml`. Matches Chrome for every `file:`
   document. Large: the production window loads ES-module chunks over `file://`, which depends on the
   fuse; needs a production build to verify (not allowed in this run).
2. Intercept `file:` on browser sessions (`session.protocol.handle("file", …)`) and refuse
   non-navigation requests. Fragile: the handler cannot reliably tell `fetch` from `<img>`, and it
   would sit in front of every local page the user views.

**Recommendation:** option 1 as its own task (it also hardens the app window).

## Acceptance criteria

- [x] No context-menu, `window.open` or `target=_blank` path can open `file:`, `data:` or
  `app-asset:` as a top-level guest document (tab or popup window).
- [x] A `file:` document's subframes and redirects are guarded from its first load (no
  registration-time gap).
- [x] The address bar can still open a `file:` URL the user types, and session restore is unchanged.
- [x] `http(s)` links still open in new tabs through the menu, `target=_blank` and `window.open`.
- [x] The architecture doc matches the code.

## Verification

**Runtime (owned dev test instance, `--profile sec-fix-2140`, loopback fixtures on 127.0.0.1:18140/18141,
same signals as the investigation).** Before = current dev build before the change; after = with it.

| # | Case | Before | After |
|---|---|---|---|
| A1 | Menu "Open Link in New Tab" on `file:///C:/Windows/System32/drivers/etc/hosts` | New tab, hosts text visible | No tab (notification) |
| A2 | Same on a `file:` `poc.html` that reads `win.ini` | Tab; fetch, XHR and iframe all `READ` | No tab |
| A3 | Menu on `data:`, `app-asset:`, `persephone-guide:` links | Tabs created (`data:` rendered) | No tabs |
| A3 | Menu on `javascript:` link | `about:blank#blocked` tab | Same (Chromium rewrites the link target before the menu) |
| A3 | Menu on an `http:` link | Opens | Opens ("ok page") |
| A4 | `target=_blank` `data:` / `window.open('data:…')` (tab) | Tab renders `data:` document | No tab |
| A4 | `window.open('data:…', …, 'width=400,height=300')` (popup window) | Popup window created | No popup |
| A4 | `target=_blank` / `window.open` to `http:` | Opens | Opens |
| A5 | Menu "Open Image in New Tab", `file:` image / normal image | (repro: image-view page for both) | `file:` refused (no new page); normal image opens a page |
| A6 | Trusted `editor.navigate(file:///…/poc.html)` in an existing tab | Loads; fetch/XHR `READ`, iframe blocked | Same — address-bar `file:` still works; fetch/XHR is the deferred item |
| A8 | Trusted `editor.addTab(file:///…/poc.html)` (new guest) | — (A2 shows the same `src` path reading through the iframe) | iframe blocked from the first load; fetch/XHR `READ` (deferred) |
| A7 | Left-click on a `file:` link on a page with history | Stays on the page | (unchanged code path) |

**Code-only:** session restore (`webview.src` from saved tabs — unchanged path), the
creation-time deny-all window-open handler before registration, `will-redirect` to a blocked scheme,
board-claimed scheme hand-off from the menu (`openPageSchemeCandidate`).

**Hand check:** the refusal notification text on a real right-click (the run drove the menu through
`menus[0].click`; the toast was not captured).

Gates: `npm run typecheck`, `npm run lint`, `npm run i18n:check` (17/17 packs 1685/1685, no stale
hashes), `npm run guides:check` pass.

## Files changed

| File | Change |
|---|---|
| `src/shared/browser-navigation-policy.ts` | New (moved policy + `getPageOpenAction`) |
| `src/main/browser/navigation-scheme-policy.ts` | Deleted (moved) |
| `src/main/browser/navigation-scheme-guards.ts` | New: scheme guards, creation-time guest guard |
| `src/main/browser/popup-policy.ts` | Uses shared guards; window-open policy check |
| `src/main/browser/BrowserGuest.ts` | Window-open policy check, `handOffExternal`, drops duplicate listeners |
| `src/main/browser-service.ts` | Creation-time guard call (replaces the mute-register line) |
| `src/renderer/content/page-scheme-handoff.ts` | New: board-claimed scheme hand-off |
| `src/renderer/api/internal/RendererEventsService.ts` | Delegates to `openPageSchemeCandidate` |
| `src/renderer/editors/browser/BrowserPageLinkOpener.ts` | New collaborator |
| `src/renderer/editors/browser/BrowserEditor.ts` | Composes `pageLinks` |
| `src/renderer/editors/browser/BrowserWebviewModel.ts` | `"new-window"` delegates (shrinks) |
| `src/renderer/editors/browser/webview-context-menu.ts` | Link/image items delegate |
| `src/shared/i18n/en/browser.ts`, `assets/languages/*.lang.json` | `browser.pageUrlRefused` |
| `doc/architecture/browser-editor.md`, `key-files.md`, `folder-structure.md` | Updated |
| `assets/guides/editors/browser/index.md`, `assets/guides/whats-new.md` | User note and release note |

Note for parallel tasks: `src/main/browser/navigation-scheme-policy.ts` (cited by US-2145) moved to
`src/shared/browser-navigation-policy.ts`; the board-scheme hand-off (US-2145 "board-scheme open without
prompt") now has one owner, `content/page-scheme-handoff.ts`.

**No changes needed:** `BrowserWebviewItemView.ts`, `BrowserTabsModel.ts`, `BrowserUrlBarModel.ts`,
`browser-pages.ts`, `site-extension-actions.ts`, `BrowserSiteExtensionController.ts`,
`BrowserBookmarksModel.ts`, `content/open-actions/browser.ts`, `electron-builder.yml`.
