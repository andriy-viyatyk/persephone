# EPIC-189: UI test coverage, phase 6a — Browser page: navigation, tabs, zoom, profiles, bookmarks, downloads, permissions

## Status

**Status:** Completed 2026-11-18
**Created:** 2026-11-18

## Overview

First half of Phase 6 (Browser) of the [UI test coverage roadmap](../reviews/ui-test-roadmap.md). Phase 6 is too
large for one night, so it is split:

- **6a (this epic): the browser page itself.** Navigation and the URL bar, Back / Forward / Reload / Home / Stop,
  inner browser tabs, page zoom, browser profiles and Incognito, bookmarks, downloads, site permissions and the
  blocked-popups bar. Every page comes from the runner's local HTTP fixture server (`ctx.httpUrl`); no test needs the
  internet or Tor.
- **6b (next epic): automation and extensions.** The browser automation operations and page models (snapshot, input,
  waits, network history, JS dialogs, screenshots, WebMCP `editor.app`), site extensions (trust, run, manage; the
  existing `editors/browser` site-extension and pop-up tests move into the `browser` area then), certificate view
  (needs an HTTPS fixture), Show Resources, cinema mode and fullscreen, and Tor (`requires: ["network", "tor"]`).

It also closes EPIC-186's open item: the browser `reload()` resolved before the navigation committed.

The deliverable is the tests plus the bugs they find. New tests use the `app` object style
(`ctx.app.pages[id].editor.…`), with `ctx.call` only where the stand-in cannot express the call (call options such as
`{ dialog: true }`).

## Goals

- Each module below has tests for every behavior on its checklist that `call` can reach. Whatever `call` cannot reach
  is listed as uncovered, with the reason.
- `pages[i].editor.reload()` waits for the reloaded document, and never stops a load instead.
- The fixture server serves HTML pages as HTML and offers a download route, so browser tests need no private servers.
- Claude fixes each app bug the tests find and adds a `whats-new.md` line for it.
- Every difficulty Codex has working out how to drive the browser is recorded in
  [ai-vision-feedback.md](../reviews/ai-vision-feedback.md). Browser automation is a main ai-vision surface.

## Non-goals

- Everything listed under 6b above.
- The Translate button (needs the Translate board; Phase 7/8), DevTools (`F12` opens a separate DevTools window that
  `call` cannot inspect), Windows single sign-on and proxy routing (need a real network setup).
- Moving the existing `editors/browser` tests. They stay where they are until 6b owns site extensions and pop-ups.

## Working model

Same as EPIC-188 (unattended overnight run):

- **Codex cannot run the suite at all** (the product test host is an Electron utility process its sandbox cannot
  start, even with `--attach`). Codex writes tests from the guides, `$help` text in the source, the API type files and
  the editor source, and checks syntax with `node --check`. **Claude runs the tests and triages** every failure: a test
  bug goes back to Codex or is a one-line fix; an app bug is Claude's.
- **Two Codex sessions per test task, both Luna/high:** session A investigates and writes a short task document
  (deleted when the epic closes) listing each test with its exact call paths and the source line that proves the path
  exists; Claude reviews it; session B writes the tests from the corrected document.
- Codex never uses the persephone MCP tool or port 7865, never runs `npm start`, `build-prod` or Electron, and never
  commits or stages.
- Every Codex brief asks for an `AI-VISION FEEDBACK` section; Claude appends each case to
  [ai-vision-feedback.md](../reviews/ai-vision-feedback.md), plus every failure caused by a wrong guess about the API.
- Every test works only inside its own folder under `ctx.fixture(...)` and closes what it opens. The suite has no
  expected-failure marker, so a known app failure that cannot be fixed tonight stays failing and is listed under Open
  items.
- **Fixture pages.** Static HTML pages live under `integration-test/fixtures/http/browser/<module>/` (UTF-8, no BOM,
  LF, final newline) and are opened with `ctx.httpUrl("/browser/<module>/<page>.html")`. Each module owns its folder.
  Dynamic behavior uses the server's routes: `/status?code=N`, `/redirect?to=/path&status=N`, `/delay?ms=N`, `/echo`,
  and the new `/download?name=<file>[&bytes=N][&chunks=N&ms=N]`.

## Area checklists

### US-2076: Browser `reload()` waits for the reloaded page — product fix (Claude)

- Found in EPIC-186: `pages[i].editor.reload()` called `reloadOrStop()` and resolved at once, so a test that read the
  page right after it could see the old document. Worse, on a page still loading it **stopped** the load.
- Fix: `BrowserWebviewModel.reload()` always reloads (with the translation reset and the site-extension navigation
  notice that `reloadOrStop` had); `reloadOrStop` (toolbar, `Ctrl+R`/`F5`) delegates to it. The facade's `reload()`
  takes the same options as `back()` (`waitUntil`, `timeout`, `tabId` active only) and waits through
  `navigateBackAndWait`, resolving `{ url, status }`. `BrowserTargetModel.reload()` (used by `navigateAndWait` to the
  same URL) reloads instead of possibly stopping.
- Files: `src/renderer/editors/browser/BrowserWebviewModel.ts`, `BrowserTargetModel.ts`,
  `src/renderer/scripting/api-wrapper/BrowserEditorFacade.ts`, both `browser-editor.d.ts` copies, the Waits table in
  `assets/guides/agents/browser.md`, a `whats-new.md` line. Proven by the `browser/navigation` reload tests.

### US-2077: HTTP fixture server: content types and downloads — runner (Claude)

- The fixture server sent every file as `text/plain`, so an HTML fixture rendered as source. It now maps common
  extensions (`.html`, `.css`, `.js`, `.json`, `.svg`, `.png`, `.jpg`, `.gif`, `.ico`, `.wav`, `.mp4`); unknown
  extensions stay `text/plain`.
- New `/download?name=<file>[&bytes=N][&chunks=N&ms=N]` route: an `attachment` with a deterministic text body
  (`bytes` up to 4 MiB), optionally streamed in `chunks` (1–200) with `ms` (≤ 2000) between them, so a test can watch
  or cancel a running download.
- File: `integration-test/lib/http-fixtures.mjs`.

### US-2078: Navigation and the URL bar — `tests/browser/navigation/`

- Open a fixture page with `ctx.openBrowser` and `pages.openUrlInBrowserTab`; `url` / `title` / `activeTab` follow it.
- `navigate`, `navigateAndWait` (result `{ url, status }`), link clicks inside the page; a redirect lands on its target;
  an HTTP error status resolves with that status.
- Back, Forward and Home (facade methods and the toolbar buttons `toolbar-back`, `toolbar-forward`, `toolbar-home`);
  disabled state with no history; `back()` with no history rejects with `No back history`.
- `reload()` waits for the reloaded document (a page that counts its loads); `reload()` on a still-loading page
  reloads instead of stopping; toolbar Reload while loading becomes Stop.
- URL bar: type a URL and press Enter; `Ctrl+L` focuses it; the history suggestions show visited pages and filter
  while typing; a search term goes to the selected search engine (only checked as far as it stays offline: the
  engine choice and the URL it would load, without loading it).

### US-2079: Inner browser tabs and page zoom — `tests/browser/tabs/`

- `addTab(url)`, `tabs`, `switchTab`, `closeTab`; the `+` button opens a blank tab with the URL bar focused; a
  `target="_blank"` link opens a new inner tab.
- Each tab keeps its own URL, history and title; closing the last tab (whatever the app does then).
- Page zoom: the `toolbar-page-zoom` button and its popover presets; the page sees the zoom (`devicePixelRatio` or
  layout width); each tab keeps its own zoom across a navigation; zoom survives a session restore (`requires:
  ["launch"]`) — the recent restored-page zoom fix; `Ctrl+=`, `Ctrl+-`, `Ctrl+0` with focus in the page.

### US-2080: Profiles, Incognito and bookmarks — `tests/browser/profiles/`

- A browser profile created through settings (`settings.browserProfiles` or the Settings page) opens with
  `openBrowser(url, { profile })`; storage (localStorage or a cookie set by the page) is isolated between the default
  profile, a named profile and Incognito; Incognito storage is gone after its page closes.
- Bookmarks: the `url-bookmark-toggle` star adds and removes the current page; the `toolbar-bookmarks` drawer lists
  it and opens it; bookmarks are per profile.
- The test profile's settings are restored at the end of each test.

### US-2081: Downloads — `tests/browser/downloads/`

- A link to `/download?name=…` downloads into the profile's download folder (under the test profile's `work/` or
  wherever the setting points; the test sets it to its own fixture folder and restores it); the file content matches.
- The `downloads` call-tree node and the `toolbar-downloads` popup list the entry with its state; a slow download
  (`chunks`/`ms`) shows progress and can be cancelled; **Clear** removes finished entries.
- **Open in Persephone** opens a completed text download in a tab. **Open in Windows Default App** and **Show in
  Folder** start external programs and are uncovered.

### US-2082: Site permissions and blocked pop-ups — `tests/browser/permissions/`

- A fixture page that requests a permission the test machine can answer without hardware (notifications, clipboard
  read): the prompt bar (`browser-permission-prompt`) shows the origin; Allow and Block are remembered and the page
  sees the result; the `url-site-permissions` popover shows the choice; Reset returns it to Ask.
- A page that opens pop-ups faster than the rate limit shows the blocked-popups bar (`popup-blocked-bar`); Allow lets
  them open; Dismiss hides the bar.

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-2076 | Browser `reload()` waits for the reloaded page | Done |
| US-2077 | HTTP fixture server: content types and downloads | Done |
| US-2078 | Tests: navigation and the URL bar | Done |
| US-2079 | Tests: inner browser tabs and page zoom | Done |
| US-2080 | Tests: profiles, Incognito and bookmarks | Done |
| US-2081 | Tests: downloads | Done |
| US-2082 | Tests: site permissions and blocked pop-ups | Done |

## Results

- **US-2076** (Claude): `reload(options?)` always reloads and waits like `back()`; covered by two `browser/navigation`
  tests. The existing site-extension reload tests pass with it.
- **US-2077** (Claude): content types and `/download`; the image and video modules still pass.
- **US-2078:** 7 tests in `navigation.test.mjs`: metadata and the `openUrlInBrowserTab` reuse of the active page, link
  navigation, redirects and HTTP error status, Back/Forward/Home (facade and toolbar, disabled on a fresh tab), reload
  waiting for the new document, reload of a still-loading page (toolbar shows Stop), URL bar (Ctrl+L, Enter, visited
  pages on focus), offline search-engine choice. Guide fix: typing in the URL bar lists earlier search queries, not
  visited pages.
- **US-2079:** 5 tests in `tabs.test.mjs`: addTab/switchTab/closeTab with per-tab history and the last-tab blank tab,
  `target=_blank`, the `+` button focusing the URL bar, all zoom presets checked through the page's
  `devicePixelRatio` and kept per tab across navigation, zoom restored after an app restart (`requires: ["launch"]`).
- **US-2080:** 3 tests in `profiles.test.mjs`: localStorage isolated between the default profile, a named profile and
  Incognito (gone after close); star add/edit, drawer open in a new tab and delete through the row menu; bookmarks kept
  per profile. **App bug fixed:** the Link editor's Tags and Hostnames lists kept a deleted link's entries and counts.
  **Open:** the drawer's Collections tree keeps a deleted link, so the star/drawer test stays failing.
- **US-2081:** 3 tests in `downloads.test.mjs`: a download completes into the test folder with its content and Clear
  removes it; progress and the popup's Cancel; Open in Persephone. **Call gap closed:** a test instance saves downloads
  to `<profile>/test-downloads` without the native Save dialog. **App bugs fixed:** a finished download kept its last
  throttled byte count; the popup rebuilt its rows on every progress event, so a Cancel click could be lost.
- **US-2082:** 3 tests in `permissions.test.mjs`: notification prompt Allow and Block for the fixture origin, the Site
  permissions popover state and Reset back to Ask; the blocked-pop-ups bar from a `window.open` burst, Dismiss, and
  Allow letting a whole burst open.
- Module test time (launched run): navigation 11 s, tabs 11 s, profiles 17 s, downloads 5 s, permissions 5 s, plus one
  app start each.

## Concerns

1. **Size.** Five test tasks plus two small fixes. If the night runs short, US-2082 moves to 6b and the roadmap
   records it.
2. **The browser area starts slowly.** Each module gets a fresh app; the browser webview adds start-up time. Watch the
   module run times against the roadmap's 3-minute budget.
3. **Search engines need the internet.** Tests check the engine choice and the URL Persephone builds, never load it.
4. **Downloads write to disk.** The download folder setting points at the test's own fixture folder and is restored.
5. **Permissions without hardware.** Only notifications and clipboard read can be prompted on the test machine; camera
   and microphone are not exercised.

## Open items

1. **Bookmarks drawer Collections tree keeps a deleted link** (US-2080). After Delete through the row menu, the list and
   the file are empty but the drawer's Collections tree still shows the link. The test `bookmark star adds or edits the
   current page and the drawer opens it in a new tab` stays failing. Probably the Link editor's category tree refresh
   (`LinkCategoryPanel` / `TreeProviderViewModel` watch path); not investigated to the end tonight.
2. **Carried over from EPIC-187:** the grid row-insertion decision (`Ctrl+Insert adds an unsorted row and is blocked
   while sorted or filtered` stays failing until the user decides). The EPIC-185 env-vars test passed in this run.
3. **Uncovered:** the page-zoom shortcuts (automation key input does not reach the guest's `before-input-event`, so
   Persephone's browser shortcuts never run from `pressKey`; noted in `agents/browser.md`); the URL bar's filtering of
   earlier search queries and the search URL an engine would load (need the internet); Open in Windows Default App and
   Show in Folder (external programs); camera and microphone permissions (hardware).
4. **Dead code:** `BrowserBookmarksModel.handleBookmarkLinkClick` has no callers since EPIC-023.
5. **API gaps recorded for the ai-vision review** (26 entries in [ai-vision-feedback.md](../reviews/ai-vision-feedback.md)):
   `ctx.openBrowser` returns no page id; icon buttons have no accessible name; the browser facade's `elements` omit the
   permission controls; `waitFor` conditions are exclusive; the downloads row buttons and drawer rows have no names.

## Notes

### 2026-11-18
- Created from the roadmap's Phase 6. Split into 6a (browser page) and 6b (automation, site extensions, certificate,
  Show Resources, cinema mode, Tor); the split is recorded in the roadmap.
- Decision on EPIC-186's open item: fix it here (US-2076). The browser tests rely on `reload()`, and the fix is small.
  Claude made it directly, together with the fixture-server change (US-2077), before planning started, so the plans
  can rely on both.
- A shared area helper `tests/browser/helpers.mjs` (`openBrowserPage` returning `{ id, editor }`, `activatePage`,
  `closeBrowserPage`, `fixturePage`) was written by Claude before the five implementations ran in parallel, so they
  did not collide on it.
- Planning ran for all five test tasks in parallel (Codex Luna); Claude reviewed each plan and folded the corrections
  into the implementation brief (session B). Corrections that mattered: the star does not remove a bookmark (the epic's
  own wording was wrong), the drawer opens bookmarks in a new tab, the Save-dialog blocker was closed in the app rather
  than worked around, and the URL-bar "bug" was a guide wording problem.
- Triage: downloads found three app problems (fixed); the other modules failed on test guesses (JSON-parsed strings,
  inactive pages' DOM, exclusive `waitFor` options, wrong DOM structure, a UIKit menu that is not in `menus`). One
  round went back to Codex (navigation); the rest Claude fixed as one-liners. The keyboard-zoom test was removed as
  undrivable, with the reason recorded.
- Completion skills on Codex (Luna): review found nothing; document updated `browser-editor.md`, `folder-structure.md`,
  `key-files.md` and `integration-tests.md`; userdoc clarified the URL suggestions and the live Tags/Hostnames lists.
  typecheck, lint and guides:check pass; no catalog messages changed. Task folders deleted at close.
- Full launched run (`--with git,mneme`): 262 tests, **259 passed, 2 failed (open items 1 and 2), 1 skipped** (Tor);
  21 new tests.
