# EPIC-192: UI test coverage, phase 7b — published-board helper, fake catalog, Excalidraw, REST Client

## Status

**Status:** Completed 2026-11-18
**Created:** 2026-11-18

## Overview

Second half of Phase 7 (Board platform and bundled boards) of the [UI test coverage roadmap](../reviews/ui-test-roadmap.md),
split from [EPIC-191](EPIC-191.md). It covers what needs new runner or main-process support, plus the two bundled boards:

- **Published-board registration helper:** registers a board from the local `../persephone-boards` checkout
  (`PERSEPHONE_BOARDS_DIR` overrides) into the test profile, and skips with a clear reason when the checkout is missing.
  Phase 8 builds on it.
- **Catalog install, update and roll back** against a fake catalog served by the runner's fixture HTTP server. This
  needs a test-only catalog base URL that only test instances honour.
- **Excalidraw** (bundled `assets/boards/excalidraw`): open a `.excalidraw` file, draw through its API, save, and the
  capability entry points.
- **REST Client** (bundled `assets/boards/rest-client`): a `.rest.json` collection, send a request to the fixture
  server, and its capability entry point.
- **EPIC-191 leftover:** board automation waits for a loading board frame instead of rejecting or blocking.

The deliverable is the tests plus the bugs they find. New tests use the `app` object style
(`ctx.app.boards.…`, `ctx.app.pages[id].editor.…`), with `ctx.call`/`ctx.callText` only where the stand-in cannot
express the call.

## Goals

- Each module below has tests for every behavior on its checklist that `call` can reach; what it cannot reach is listed
  as uncovered, with the reason.
- No test touches the real published-boards catalog, GitHub, the network or the user's profile. The fake catalog comes
  only from the runner's loopback fixture server, and only a test instance honours the override.
- Claude fixes each app bug the tests find and adds a `whats-new.md` line for it.
- Every difficulty Codex has working out how to drive boards, the catalog and the two bundled boards is recorded in
  [ai-vision-feedback.md](../reviews/ai-vision-feedback.md).

## Non-goals

- The published boards themselves (Phase 8). This epic only proves the helper with one smoke test.
- The EPIC-187 grid row-insertion decision. It is the user's and stays open.

## Decisions

- **No further split (2026-11-18).** Five tasks: one runner/product task, three test tasks and one product fix. That
  is the size of EPIC-191. If a task overruns, its remainder is recorded as an open item rather than split again.
- **Test-only catalog URL.** The main process reads a catalog base URL from an environment variable only when
  `isTestInstance()` is true (the pattern of `src/main/test-mode/certificates.ts`), and only accepts a loopback
  `http://127.0.0.1` URL. The suite wrapper sets it for owned runs. An ordinary app never reads it.
- **Fake catalog source.** Catalog boards are committed as plain text folders under `integration-test/fixtures/`; the
  fixture server builds their ZIP archives, sizes and sha256 values at start (no committed binary archives, so a
  fixture edit never leaves a stale checksum).
- **Order.** US-2095 (catalog support and the helper) is planned first; US-2096 (catalog tests) is planned against
  its reviewed plan. US-2097, US-2098 and US-2099 are independent and run in parallel.
- **Module layout.** `boards/catalog`, `boards/published` (helper smoke test), `boards/excalidraw`,
  `boards/rest-client`.

## Working model

Same as EPIC-191 (unattended overnight run):

- **Codex cannot run the suite at all** (the product test host is an Electron utility process its sandbox cannot
  start, even with `--attach`). Codex writes tests from the guides, `$help` text in the source and the API type files,
  and checks syntax with `node --check`. **Claude runs the tests and triages** every failure: a test bug goes back to
  Codex or is a one-line fix; an app bug is Claude's.
- **Two Codex sessions per task, both Luna/high:** session A investigates and writes a short task document (deleted
  when the epic closes); Claude reviews it; session B implements from the corrected document.
- Codex never uses the persephone MCP tool or port 7865, never runs `npm start`, `build-prod` or Electron, and never
  commits or stages.
- Every Codex brief asks for an `AI-VISION FEEDBACK` section; Claude appends each case to
  [ai-vision-feedback.md](../reviews/ai-vision-feedback.md), plus every failure caused by a wrong guess about the API.

## Area checklists

### US-2095: Catalog test support and the published-board helper

- Main process: a test-only catalog base URL (`published-boards-service.ts`), honoured only by a test instance and
  only for a loopback URL; the board-archive download follows the catalog's absolute archive URLs.
- Runner: the fixture server serves a fake catalog (`boards-manifest.json`, per-board `versions-manifest.json`, ZIP
  archives built at start); the wrapper passes the URL to owned runs.
- The registration helper: copies a board from the `../persephone-boards` checkout into the profile's `work/` folder
  and registers it; a test that needs the checkout is skipped with a clear reason when it is missing.
- One smoke test in `boards/published` that registers and opens one checkout board.

### US-2096: Catalog install, update and roll back — `tests/boards/catalog/`

- `boards.searchPublished` (whole catalog, query), `boards.getPublishedVersions` (newest first, `compatible`,
  `installed`).
- `boards.downloadPublished` (inert on disk, not trusted; a specific version; an incompatible version refused; a
  checksum mismatch refused).
- `boards.installPublished` fresh install through Board Info (Download → Register, trust dialog).
- Update and roll back an installed board (`installPublished(id, { version })`), `checkPublishedUpdates(true)`,
  `boards.list()` install fields.
- `boards.uninstallBoard` (confirmation, folder removed, trust removed).

### US-2097: Excalidraw — `tests/boards/excalidraw/`

- Open a `.excalidraw` fixture file: the bundled board is the editor and the drawing loads.
- Draw through its API, save, and the file on disk holds the change; dirty state.
- Switch to the text editor and back; the `image.edit` and `diagram.edit` capability entry points (Mermaid
  conversion).

### US-2098: REST Client — `tests/boards/rest-client/`

- Open a `.rest.json` collection fixture; the requests are listed.
- Send a request to the fixture HTTP server and see the response (status, body, headers); a failing request.
- Edit and save a request; the `http.request.open` capability entry point.

### US-2099: Board automation waits for a loading frame

- While a board reloads, `pages[i].editor.reload()`, `evaluate` and the other frame automation members wait (bounded)
  for the new frame instead of rejecting with "Board frame not ready" or blocking for the caller's whole wait.
- Remove the polling workaround from `tests/boards/lifecycle/lifecycle.test.mjs`.

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-2095 | Catalog test support and the published-board helper | Done |
| US-2096 | Tests: catalog install, update and roll back | Done |
| US-2097 | Tests: Excalidraw | Done |
| US-2098 | Tests: REST Client | Done |
| US-2099 | Board automation waits for a loading frame | Done |

## Results

- **US-2095:** `src/main/test-mode/published-boards-catalog.ts` owns the test-only catalog base
  (`PERSEPHONE_TEST_BOARDS_CATALOG_URL`): read only by a test instance, only `http://127.0.0.1:<port>`, and a test
  instance with no valid value fetches no catalog at all (fail closed). The fixture server serves
  `/boards-catalog/` (catalog, version histories, a screenshot, ZIP archives built at start from
  `fixtures/boards-catalog/<id>/<version>/`): `us2095-versioned` 1.0.0 / 1.1.0 / 99.0.0 (incompatible) and
  `us2095-bad-sha` (wrong checksum). The wrapper passes the URL to owned runs only. The cross-area helper
  `tests/helpers/published-boards.mjs` copies one board from the `../persephone-boards` checkout
  (`PERSEPHONE_BOARDS_DIR` overrides) into `work/` and trusts it; the `published-board-checkout` requirement is
  enabled automatically when the checkout exists, otherwise the test is skipped with the expected path in the reason
  (`--with` rejects the tag). Smoke test `boards/published` (chess).
- **US-2096:** 10 tests in `boards/catalog/`: search and its annotations, version history, download (latest, a chosen
  version, the incompatible version refused, the bad checksum refused, nothing left behind), a fresh install through
  Board Info (Download, Register, trust dialog, version list, screenshot URL from the fake base), roll back and update
  of an open board (close-pages dialog, markers on disk and in the frame, `checkPublishedUpdates`), uninstall cancel
  and confirm.
- **US-2097:** 7 tests in `boards/excalidraw/`: a `.excalidraw` file opens the bundled board with no trust prompt,
  `addImage` marks the page modified and save writes it, switch to text and back, an empty board, `image.edit`,
  `diagram.edit` (converted and `conversion-failed`).
- **US-2098:** 8 tests in `boards/rest-client/`: a `.rest.json` collection, matching `.json` content offered in the
  editor switch, GET / POST (echo) / 404 / connection refused (new loopback-only `/refused` fixture route), save an
  edited request, `http.request.open`.
- **US-2099 (product fix):** a board `reload()` no longer needs the old frame (it skips the automation pre-flights);
  frame automation waits up to 5 s for a loading main frame; a CDP call whose board frame is replaced or detached is
  retried once on the new frame or fails promptly, while calls on a live frame keep their own timeouts. The
  lifecycle test's polling workaround is removed.
- **Also fixed (Claude):** a capability `open` method's `$help` "Returns:" line now shows the `{ pageId?, result }`
  envelope the call returns. Review of the US-2099 implementation restored the re-resolve-once fallback for a stale
  session on an unchanged registration.
- **Run time:** the `boards` area runs 78 tests green (US-2099's lifecycle regression included).

## Concerns

1. **The catalog override is a security surface.** It must never be honoured outside a test instance, and only for a
   loopback HTTP URL. A review finding here is must-fix.
2. **Excalidraw and REST Client are large boards.** Their frames take time to start; split a module if it passes three
   minutes.
3. **The checkout may be missing** on another machine. The helper's tests skip with a reason; they never fail.

## Open items

1. **Carried over:** the EPIC-187 grid row-insertion decision (user's call; its test stays failing) and the
   intermittent EPIC-185 env-vars test (failed in both full runs this time; not investigated further tonight).
2. **Uncovered:** the catalog's automatic 24-hour refresh (the seed gates it; tests force a refresh); cancelling an
   archive download in progress; a catalog transport failure; the update path's busy/veto refusal; the Excalidraw
   `library-path` setting (board settings are written only through the Settings page); a malformed REST Client
   collection, request cancellation and TLS; the published boards themselves (Phase 8).
3. **API gaps recorded for the ai-vision review** (15 entries in [ai-vision-feedback.md](../reviews/ai-vision-feedback.md)):
   no save member on a board content-host page (tests switch to Monaco to save); bundled boards are not in
   `boards.list()`; Board Info Download/Register are UI-only; `searchPublished` names the latest version `version`
   while `boards.list()[i].installed` uses `latestVersion`; `pages.closePage` has no discard option for unsaved pages.

## Notes

### 2026-11-18
- Created from the roadmap's Phase 7b after EPIC-191 closed.
- Planning (5 Luna runs; corrections for US-2095 and US-2099) and implementation (5 Luna runs, two test-fix rounds).
  Review corrections that mattered: US-2099's `reload()` rejection came from the automation pre-flight
  (`automationBegin`), not the reload, and the CDP bound had to apply only to a replaced or detached frame, never to a
  live command; US-2095's checkout skip belongs to the wrapper, not the product host.
- Triage: one product fix (`$help` of capability `open` methods) and test guesses (the `{ pageId, result }` envelope,
  `capabilities.invoke`, content masks opening a board, reading a JSON string through the stand-in, `boardRoot` after
  an editor switch, unsaved pages closed by the test, path separators, `latestVersion`). The HTML "Show Resources" test failed once in the first full run (a single snapshot read right after the page opened); it
  now waits for the rendered collection.
- Completion skills on Codex (Luna): review fixed one non-null assertion; document updated `integration-tests.md`, the
  runner README, the ui-tests skill, `web-app-tests.md`, `key-files.md`, `editors.md` and `scripting.md`; userdoc
  updated the boards `testing` and `published-boards` guides, `draw.md` and the REST Client board guide. typecheck,
  lint and guides:check pass; no catalog messages changed. Task folders deleted at close.
- Full launched runs (`--with git,mneme`), 403 tests: first **398 passed, 3 failed, 2 skipped**; second (after the
  review touched `cdp-service.ts`) **399 passed, 2 failed, 2 skipped** (Tor). Failures: the EPIC-187 grid decision,
  the intermittent EPIC-185 env-vars test, and once the HTML "Show Resources" test (fixed, `editors/html` green).
  26 new tests; the `boards` area is 78 tests, green.
