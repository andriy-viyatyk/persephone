# EPIC-190: UI test coverage, phase 6b — Browser automation, page models, site extensions, certificate, resources, cinema mode, Tor

## Status

**Status:** Completed 2026-11-18
**Created:** 2026-11-18

## Overview

Second half of Phase 6 (Browser) of the [UI test coverage roadmap](../reviews/ui-test-roadmap.md), after
[EPIC-189](EPIC-189.md) (6a, the browser page itself). It covers:

- **Browser automation** on `pages[i].editor`: snapshot and refs, trusted input, form fill, keys, drag, file inputs,
  page queries, `evaluate`, waits, network history, response waits, console and page errors, JavaScript dialogs,
  screenshots and viewport.
- **Page models:** WebMCP tools registered through `document.modelContext`, shown at `pages[i].editor.app`.
- **Site extensions:** saved extensions (create, Trust bar, trust, reload statuses, the action tree, list, remove,
  re-trust after a host change), plus the existing temporary-extension and pop-up tests, which move from
  `editors/browser` into the `browser` area.
- **Certificate view, Show Resources, cinema mode and element fullscreen.**
- **Tor:** what works offline (the missing-`tor.exe` notice and the Tor page state); everything that needs the Tor
  network stays tagged `requires: ["network", "tor"]` and is skipped in normal runs.

It also closes EPIC-189's open item: the bookmarks drawer's Collections tree keeps a deleted bookmark.

The deliverable is the tests plus the bugs they find. New tests use the `app` object style
(`ctx.app.pages[id].editor.…`), with `ctx.call`/`ctx.callText` only where the stand-in cannot express the call (call
options such as `{ dialog: true }`, or an exact string result).

## Goals

- Each module below has tests for every behavior on its checklist that `call` can reach; what it cannot reach is listed
  as uncovered, with the reason.
- Saved site extensions and the certificate view are tested over HTTPS from the runner's own fixture server, with no
  internet.
- Claude fixes each app bug the tests find and adds a `whats-new.md` line for it.
- Every difficulty Codex has working out how to drive the browser, page models and site extensions is recorded in
  [ai-vision-feedback.md](../reviews/ai-vision-feedback.md). These are core ai-vision surfaces.

## Non-goals

- The Translate button (needs the Translate board; Phase 7/8), DevTools, Windows single sign-on, proxies.
- A working certificate viewer: `certificate.view` is provided by the published cert-viewer board (Phase 8a). This
  epic tests the button's state with and without a handler only as far as the bundled app allows.
- The EPIC-187 grid row-insertion decision. It is the user's and stays open.

## Decisions

- **Split check.** One epic is enough if the three Claude tasks land first: the night's test tasks are five, the same
  size as EPIC-189. If time runs short, US-2090 (certificate, resources, cinema, Tor) moves to a Phase 6c and the
  roadmap records it.
- **HTTPS fixture (US-2083).** Saved site extensions inject only on `https:` pages, and the certificate button shows only
  for HTTPS. The runner therefore serves the same fixture tree over HTTPS on `127.0.0.1:17868` with a committed,
  test-only self-signed certificate for `127.0.0.1` and `localhost` (no personal data). A test instance trusts exactly
  that certificate, by SHA-256 fingerprint, and no other: the fingerprint reaches the app through the test-instance
  launch, and a non-test app never accepts an invalid certificate.
- **Module layout.** New modules: `browser/automation/input`, `browser/automation/observe`, `browser/page-models`,
  `browser/site-extensions` (saved + the moved temporary tests), `browser/popups` (moved), `browser/page-tools`
  (certificate, Show Resources, cinema mode, fullscreen) and `browser/tor`. `editors/browser` is removed once its two
  files move.

## Working model

Same as EPIC-189 (unattended overnight run):

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
- Fixture pages live under `integration-test/fixtures/http/browser/<module>/` and are opened with
  `ctx.httpUrl("/browser/<module>/<page>.html")` or, over HTTPS, `ctx.httpsUrl(...)`. The suite has no expected-failure
  marker, so a known app failure that cannot be fixed tonight stays failing and is listed under Open items.

## Area checklists

### US-2083: HTTPS fixture server and test-instance certificate trust — runner (Claude)

- `integration-test/lib/http-fixtures.mjs` serves the same routes over HTTPS on `127.0.0.1:17868` with a committed
  test certificate; `ctx.httpsUrl(path)` in `integration-test/test-setup.mjs`.
- A test instance accepts that certificate (and only it) for browser pages; outside test mode nothing changes.

### US-2084: Move the `editors/browser` tests into the `browser` area (Claude)

- `popups.test.mjs` → `tests/browser/popups/`, `temporary-site-extensions.test.mjs` → `tests/browser/site-extensions/`;
  imports fixed; test names unchanged, so a baseline still matches by name.

### US-2085: Bookmarks drawer keeps a deleted bookmark — product fix (Claude)

- EPIC-189 open item 1: after Delete through the drawer's row menu, the Collections tree still lists the link. Fix the
  owner and remove the dead `BrowserBookmarksModel.handleBookmarkLinkClick` if it is trivial.

### US-2086: Automation input and queries — `tests/browser/automation/input/`

- `snapshot` (`interactive`, `root` ref, `maxNodes`/`maxChars` shortening), actions by ref, CSS selector and `text=`;
  strict-mode error on several visible matches and `{ nth }`; actionability errors for hidden or covered elements and
  `{ force: true }`.
- `click`, `hover` (script pointer listeners), `type` (replace, `slowly`, `submit`), `clear`, `select` (single and
  multiple), `check`/`uncheck` (including through a label), `fillForm` (ordered, names the failing field),
  `pressKey`/`keyDown`/`keyUp`, `drag`, `setInputFiles` with a fixture file, `{ synthetic: true }`.
- `getText`, `getValue`, `getAttribute`, `getHtml`, `exists`, `evaluate` with args.

### US-2087: Automation waits, diagnostics, dialogs and screenshots — `tests/browser/automation/observe/`

- `waitFor` (`selector` states, `text`, `textGone`, `time`), `waitForSelector`, `waitForURL` (string and RegExp),
  `waitForNavigation`, `wait`; timeouts reject.
- `networkRequests` (with and without bodies), `waitForResponse` (string, RegExp, `includeBody`, HTTP error status),
  `consoleMessages`, `pageErrors`.
- JavaScript dialogs: the default dismiss during automation, `dialogs()` state, `accept`/`dismiss`/`manual` policy and
  `handleDialog(accept, promptText)`.
- `screenshot` (PNG/JPEG, `target`, `fullPage`), `setViewport`/`clearViewport` seen by the page.

### US-2088: Page models (WebMCP) — `tests/browser/page-models/`

- A fixture page registering tools through `document.modelContext`: `editor.app` appears, `$help` lists the tools,
  a hyphenated tool name maps to a valid member, a call passes its object argument and returns the result, tools added
  or removed later change `app`, removing the last tool removes `app`; Incognito pages do not get WebMCP.
- A page that also publishes its own model keeps its members, with the tools under `app.webmcp`.

### US-2089: Saved site extensions — `tests/browser/site-extensions/`

- `siteExtensions.create` (scaffold, `requiresTrust`), the page's Trust bar and `siteExtensionTrustPrompt`,
  `trustSiteExtension()`, `siteExtensions.reload(pageId)` statuses (`injected` with `registered`, `waiting-for-user`,
  `no-extension`, `extension-error`, `not-current` on HTTP), the model at `editor.app`, `setActions` and
  `siteActions`/`runSiteAction` results (message, text, links, a multi-video `choice-required` and
  `chooseSiteActionResult`), `siteExtensions.list()` fields, a host change asking for trust again, disable, and
  `siteExtensions.remove(id)` with its confirmation.
- The Tools & Editors → Site extensions tab is already covered by `tools/tools-hub`; only cross-checks belong here.

### US-2090: Certificate view, Show Resources, cinema mode, fullscreen, Tor — `tests/browser/page-tools/`, `tests/browser/tor/`

- Certificate: the `site-certificate-view` button appears in the site popover for an HTTPS page, not for HTTP, and its
  state without a `certificate.view` handler.
- Show Resources (browser page menu): opens the page's resources as a links page.
- Cinema mode on a fixture video (button on hover, expand, `Esc` restores), `editor.fullscreen()` /
  `exitFullscreen()` results.
- Tor: the offline behavior (opening a Tor page with no `tor.exe` path), and the network-dependent checks tagged
  `requires: ["network", "tor"]`.

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-2083 | HTTPS fixture server and test-instance certificate trust | Done |
| US-2084 | Move the `editors/browser` tests into the `browser` area | Done |
| US-2085 | Bookmarks drawer keeps a deleted bookmark | Done (test bug, not an app bug) |
| US-2086 | Tests: automation input and queries | Done |
| US-2087 | Tests: automation waits, diagnostics, dialogs, screenshots | Done |
| US-2088 | Tests: page models (WebMCP) | Done |
| US-2089 | Tests: saved site extensions | Done |
| US-2090 | Tests: certificate view, Show Resources, cinema mode, fullscreen, Tor | Done |

## Results

- **US-2083** (Claude): `integration-test/lib/http-fixtures.mjs` serves the fixture tree on HTTP 17867 and HTTPS 17868
  with a committed test-only certificate (`integration-test/lib/tls/`, 127.0.0.1 and localhost, 20 years);
  `ctx.httpsUrl(path)`. `src/main/test-mode/certificates.ts`: a test instance (`--test-instance`) accepts a certificate
  error only for a SHA-256 fingerprint listed in `PERSEPHONE_TEST_TRUSTED_CERTIFICATES`; the wrapper passes the
  fixture's fingerprint. Ordinary app runs never install the handler. `--open`/`--attach` instances are not test
  instances, so HTTPS fixtures need an owned run.
- **US-2084** (Claude): `popups.test.mjs` → `tests/browser/popups/`, `temporary-site-extensions.test.mjs` →
  `tests/browser/site-extensions/`; names unchanged; `editors/browser` is gone.
- **US-2085** (Claude): **not an app bug.** Virtualized trees keep recycled rows attached but hidden; the EPIC-189 test
  read the drawer's `textContent`, which still contained the deleted row. It now reads `innerText` and passes. Also
  fixed a read race in the same test (JSON read while the app was writing). Dead
  `BrowserBookmarksModel.handleBookmarkLinkClick` removed.
- **US-2086:** 18 tests in `automation/input/input.test.mjs`: snapshot refs and shortening, ref / CSS / `text=`
  locators, strict mode and `nth`, actionability and `force`, click and hover, type (replace, slowly, submit,
  contenteditable), clear, select (no hit-test), check/uncheck through a label, fillForm order and failure, held keys,
  drag, setInputFiles, synthetic input, the five queries, evaluate with args.
- **US-2087:** 16 tests in `automation/observe/observe.test.mjs`: waitFor selector states, text/textGone, time and
  wait, waitForSelector, timeouts, waitForURL and waitForResponse (exact and `{ regex }`), waitForNavigation, network
  history with and without bodies, HTTP error responses, console and page errors, dialog policies, viewport.
- **US-2088:** 8 tests in `page-models/page-models.test.mjs`: WebMCP tools in `editor.app` with help and cautions,
  object-argument calls, hyphenated-name mapping, late registration, removal down to no `app`, grouping beside a
  page-published model under `app.webmcp`, Incognito without WebMCP, no empty `app`.
- **US-2089:** 12 tests in `site-extensions/saved-site-extensions.test.mjs` (HTTPS fixture): create and fetch-host
  validation, Trust bar and `trustSiteExtension()`, reload statuses, the model at `editor.app`, message / text / links
  / url action results, video choice, invalid action tree and clearing, list fields and conflicts, re-trust after a
  host change (`changed`), disable from the Tools hub, remove with confirmation.
- **US-2090:** 7 tests in `page-tools/page-tools.test.mjs` (certificate button and PEM fallback over HTTPS, no
  certificate on HTTP, Show Resources, cinema mode button, expand and `Esc`, fullscreen of the main video and by
  selector) and 2 in `tor/tor.test.mjs` (offline: a Tor page without `tor.exe` is refused with the setup notice;
  `requires: ["network", "tor"]`: a Tor page reports `IsTor`, using `PERSEPHONE_TEST_TOR_EXE`).
- **App bugs fixed (Claude):** `getText`/`getValue`/`getAttribute`/`getHtml`/`exists` missing from the browser
  editor's call tree; `keyDown()` modifiers forgotten by the next `pressKey()` (held keys were keyed by a per-call
  `CdpSession` object); `type()` right after opening a page could land in the URL bar (a new page's 100 ms URL-bar focus is
  skipped once a page is loading, and a trusted click focuses the webview); a site action `url` result that opened a new tab reported `not-current`. **Call gap closed:**
  `waitForURL`/`waitForResponse` accept `{ regex, flags? }` over `call`. **Docs:** `select()` and `networkRequests`
  describe entries corrected; the browser guide says `window.prompt()` is unavailable in browser pages.
- **Runner:** the seed sets `link-open-behavior` to `internal-browser`, so a test can no longer launch the machine's
  default browser (the url-action test did, on loopback fixture URLs, before this).

## Concerns

1. **Certificate trust is security-sensitive.** The acceptance must be limited to test instances and to the exact
   fixture fingerprint; it is reviewed at close.
2. **Module time.** Automation modules can grow; split by feature if one passes 3 minutes.
3. **Tor needs the network.** Only the offline behavior runs by default.

## Open items

1. **Carried over from EPIC-187:** the grid row-insertion decision (user's call; its test stays failing).
   The EPIC-185 env-vars test failed again in the final run (intermittent: the Settings panel covers "Open Environment
   Variables" when it is clicked); not investigated tonight.
2. **Uncovered:** browser `screenshot()` results (the test context cannot return image blocks); `window.prompt()`
   (unavailable in Electron guest pages, so `handleDialog`'s `promptText` is untestable); the certificate viewer itself
   (`certificate.view` comes from the cert-viewer board, Phase 8a); cinema mode inside nested frames; Tor through the
   network (runs only with `--with network,tor` and `PERSEPHONE_TEST_TOR_EXE`); the `webmcp_2` namespace collision.
3. **API gaps recorded for the ai-vision review** (25 entries in [ai-vision-feedback.md](../reviews/ai-vision-feedback.md)):
   no `showResources()` member; the `siteExtensionTrustPrompt` field names and the remove handshake are not in the
   guide; `$describe`'s `node: true` is undocumented; awaiting a node returns its summary, not its values.

## Notes

### 2026-11-18
- Created from the roadmap's Phase 6b. The HTTPS fixture, the test move and the bookmarks fix are Claude's and land
  before the test plans need them; the five test tasks plan in parallel on Codex Luna.
- Split check: one epic was enough; no Phase 6c.
- Planning (5 parallel Luna runs) and implementation (5 parallel Luna runs, then one fix round each for US-2086..2089)
  as in EPIC-189. Review corrections that mattered: held-key assertions by event, RegExp waits made reachable instead
  of left uncovered, cinema mode waits for the 1 s attach retry, a tagged Tor network test.
- Triage: four app bugs (above), one call gap, one runner seed fix; the rest were test guesses (descriptor shapes,
  JSON-parsed values, `undefined` as `null`, the prompt field names, fixture duplicates). The EPIC-189 bookmarks
  "bug" was a test reading hidden pooled rows.
- Final fixes after the first full run: the new page's delayed URL-bar focus is skipped once a page is loading (the
  input module's `fillForm` tests failed intermittently on it); the EPIC-189 Ctrl+L test had passed only because of that
  focus and now focuses a toolbar control first.
- Completion skills on Codex (Luna): review found nothing; document updated `integration-tests.md`, the runner README,
  the ui-tests skill, `key-files.md` and `folder-structure.md`; userdoc updated `web-app-tests.md`, `browser.md` and
  `site-extensions.md`. typecheck, lint and guides:check pass; no catalog messages changed. Task folders deleted at close.
- Full launched run (`--with git,mneme`): 325 tests, **320 passed, 3 failed, 2 skipped** (Tor). Failures: the EPIC-187
  grid decision, the intermittent EPIC-185 env-vars test, and the Ctrl+L test (fixed afterwards; browser area rerun
  green (112 passed, 2 skipped)). 63 new tests.
