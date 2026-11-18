# EPIC-193: UI test coverage, phase 8a — published document viewers

## Status

**Status:** Completed 2026-11-18
**Created:** 2026-11-18

## Overview

Phase 8a of the [UI test coverage roadmap](../reviews/ui-test-roadmap.md): the ten document-viewer boards of the
separate `persephone-boards` repository — pdf-viewer, word-viewer, excel-viewer, powerpoint-viewer, drawio-viewer,
font-viewer, pe-viewer, cert-viewer, sqlite-viewer and torrent-viewer. Each board is registered into the test profile
from the local checkout with EPIC-192's helper (`tests/helpers/published-boards.mjs`), and each gets: it opens its
sample file, the main view renders, its primary action works, and its data round-trips where it edits (all ten are
read-only viewers, so in practice: the content read back through the board matches the sample).

The deliverable is the tests plus the bugs they find. New tests use the `app` object style
(`ctx.app.pages[id].editor.…`), with `ctx.call`/`ctx.callText` only where the stand-in cannot express the call.

## Goals

- Every board on the list has tests for its checklist below that `call` can reach; what it cannot reach is listed as
  uncovered, with the reason.
- No test touches the network, GitHub, the real catalog or the user's profile. The torrent tests read metadata only and
  never start a download.
- A bug in a published board is recorded as an open item (file and line) and its test stays failing; the
  `persephone-boards` checkout is read-only. A bug in Persephone itself is fixed here with a `whats-new.md` line.
- Every difficulty Codex has driving the boards is recorded in [ai-vision-feedback.md](../reviews/ai-vision-feedback.md).

## Non-goals

- Phases 8b–8d (apps, agent tools, audio and speech boards).
- Editing or committing anything in `persephone-boards`.
- Catalog install of these boards (covered once in EPIC-192 against the fake catalog).

## Decisions

- **No further split (2026-11-18).** Ten boards, four test tasks grouped by kind, about 3–5 tests per board, roughly
  40 tests. That fits one epic; a task that overruns records its remainder as an open item.
- **New area `published-boards`**, one module per board: `integration-test/tests/published-boards/<board-id>/`.
- **Shared area helper** `integration-test/tests/published-boards/helpers.mjs`, owned by US-2100 and used by the other
  three tasks. Its contract (fixed here so the four plans agree):
  - `openPublishedSample(ctx, boardId, sampleRel)` — registers the board with `registerPublishedBoard`, copies nothing
    else, opens the work copy of `boards-samples/<sampleRel>` (`ctx.fixture`) through the app's normal file-open path
    so the board is chosen by its `fileMasks`, waits for the board frame to be ready, and returns `{ id, editor, root,
    file }`.
  - `closePublishedSample(ctx, handle)` — closes the page and unregisters the board; never throws (cleanup).
  - Tests declare `requires: ["launch", "published-board-checkout"]`, like the EPIC-192 smoke test (attach borrows a
    profile the suite does not reset).
- **Sample files** live in `integration-test/fixtures/boards-samples/<board-id>/`. They are as small as possible, carry
  no personal data, and are either written by Codex (text formats: PDF, draw.io XML, PEM) or produced
  deterministically; small committed binaries are allowed (`integration-test/fixtures/** -text` already covers them).
  A sample copied from `persephone-boards/_test` must be checked for personal data first and its source named in the
  task document.
- **Boards with an AiVision model** (`pages[id].editor.app`: pdf, word, excel, powerpoint, drawio, sqlite) are driven
  through that model; the others (font, pe, cert, torrent) through `editor.evaluate`/`snapshot`.
- **Order.** All four plans run in parallel against this contract. US-2100 is implemented first (the helper); the
  other three are implemented after it lands.

## Working model

Same as EPIC-192 (unattended overnight run):

- **Codex cannot run the suite at all** (the product test host is an Electron utility process its sandbox cannot
  start, even with `--attach`). Codex writes tests from the guides, the boards' source and guides, and `$help` text,
  and checks syntax with `node --check`. **Claude runs the tests and triages** every failure.
- **Two Codex sessions per task, both Luna/high:** session A investigates and writes a short task document (deleted
  when the epic closes); Claude reviews it; session B implements from the corrected document.
- Codex never uses the persephone MCP tool or port 7865, never runs `npm start`, `build-prod` or Electron, never
  commits or stages, and never edits `persephone-boards`.
- Every Codex brief asks for an `AI-VISION FEEDBACK` section; Claude appends each case to
  [ai-vision-feedback.md](../reviews/ai-vision-feedback.md), plus every failure caused by a wrong guess about the API.

## Area checklists

### US-2100: Area helper, PDF Viewer and draw.io Viewer

- The area helper above; sample fixtures for both boards.
- **pdf-viewer:** a `.pdf` opens in the board (not the built-in viewer); `getStats()` page count and text layer;
  `getText()` of a page matches the sample; `search()` finds a term on the right page; `goToPage()` moves the view.
- **drawio-viewer:** a `.drawio` file opens in the board; the diagram renders; its model reads pages, shapes and labels
  matching the sample.

### US-2101: Office viewers — word, excel, powerpoint

- **word-viewer:** a `.docx` opens; text and headings read back through the model.
- **excel-viewer:** an `.xlsx` opens; sheet names and cell values read back; switching sheet.
- **powerpoint-viewer:** a `.pptx` opens; slide count and slide text read back; moving to a slide.

### US-2102: Binary-format viewers — font, pe, cert

- **font-viewer:** a font file opens; family/style metadata and a glyph preview render.
- **pe-viewer:** a PE file opens; headers, sections and imports render.
- **cert-viewer:** a certificate (PEM/DER) opens; subject, issuer, validity and fingerprint render.

### US-2103: SQLite Viewer and Torrent Viewer

- **sqlite-viewer:** a database opens; tables listed (incl. the Tables secondary view if reachable); a `SELECT`
  returns the expected rows; an invalid query reports an error; read-only (a write statement is refused).
- **torrent-viewer:** a `.torrent` opens; name, file list and sizes render from metadata only; no download or swarm
  connection is started by the test.

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-2100 | Area helper; tests: PDF Viewer, draw.io Viewer | Done |
| US-2101 | Tests: Word, Excel, PowerPoint viewers | Done |
| US-2102 | Tests: Font, PE, Certificate viewers | Done |
| US-2103 | Tests: SQLite Viewer, Torrent Viewer | Done |

## Results

- **US-2100:** the area helper `tests/published-boards/helpers.mjs` (`openPublishedSample` opens the work copy through
  `pages.openFile`, checks the `board-editor:` id and the normalized `boardRoot`, waits for the active page and
  `frameReady`; `closePublishedSample`; `samePublishedRoot`). `pdf-viewer` 4 tests (a three-page PDF built at test
  start with checked xref offsets: render, `getStats`/`getText`, `search`, `goToPage`); `drawio-viewer` 3 tests (a
  two-page `.drawio` fixture: render, pages/shapes/labels, page switch).
- **US-2101:** `office-samples.mjs` builds stored-only ZIP packages (`node:zlib` `crc32`) at test start; 3 tests each for
  `word-viewer` (render, text, headings/outline), `excel-viewer` (two sheets, cells with a cached formula result, sheet
  switch) and `powerpoint-viewer` (two slides, titles/text, `goToSlide`). The first PPTX lacked parts pptx-preview
  needs (theme line styles, `p:defaultTextStyle`); fixed in the sample writer.
- **US-2102:** `font-viewer` 3 tests (KaTeX Main Regular, MIT; metadata, glyph page, corrupt file), `pe-viewer` 4 tests
  (a PE32+ image built from bytes: headers, sections, `KERNEL32.dll!ExitProcess` import, corrupt file),
  `cert-viewer` 3 tests (self-signed PEM and DER with a fake subject and frozen fingerprints, corrupt file).
- **US-2103:** `sqlite-viewer` 4 tests (a generated two-table database: tables in the model and the Tables secondary
  view, SELECT rows, an invalid query, a refused write with the file bytes unchanged). Torrent Viewer uncovered.
- **Runner/helper:** the published-board copy's `rm` retries, because a board process killed on page close (sqlite
  db-server holding `lib/vec0.dll`) can still hold a file for a moment.
- **Fixed (Claude):** the EPIC-185 env-vars flake (see Notes): EnvVarsEditor lost the last edit on close + Save, and
  trusted clicks did not scroll an element clipped by a scrolling panel.
- **Run time:** the `published-boards` area is 30 tests in 10 modules, green twice in a row; 55 s of test time plus one
  app launch per module.

## Concerns

1. **Board start-up time.** Large viewers (pdf.js, the Office renderers, torrent's service with 58 MB of
   `node_modules`) take time to start and to copy; a module that passes three minutes is split.
2. **Torrent network.** The torrent board's service may join a swarm or DHT on open. If it cannot be kept offline, the
   test is limited to what renders before any network activity, or the board is listed as uncovered.
3. **The checkout may be missing** on another machine. Tests skip with a reason; they never fail.

## Open items

1. **Carried over:** the EPIC-187 grid row-insertion decision (user's call; its test stays failing).
2. **Uncovered:** Torrent Viewer (opening a `.torrent` starts WebTorrent DHT discovery; needs an offline metadata mode
   in the board); PDF scans, outline, exports and remote sources; draw.io compressed diagrams and exports; Word/Excel
   legacy formats, search, sort and filter; PowerPoint notes, images and charts; OTF/WOFF fonts, PE32 and exports,
   PFX/PKCS#7 certificates and chains.
3. **persephone-boards (read-only here, for the board owner):**
   - `boards/pdf-viewer/CLAUDE.md:119-123` says priority 200 over a built-in PDF editor at 100; the manifest has 100
     and Persephone has no built-in `.pdf` editor.
   - `boards/torrent-viewer` README/manifest "metadata only until you open something" does not say that opening joins
     DHT (`scripts/service.mjs:103-112`).
   - `boards/powerpoint-viewer`: a package pptx-preview cannot parse shows "This deck has no slides." with no error
     surfaced to the user or the model.
   - `boards/pe-viewer/lang/en.json:48` (`note.imports`): "1 libraries, 1 imported symbols" (no singular form).
   - `persephone-boards/_test/sample.db` contains real author names; not reused as a fixture.
4. **Launch flake:** twice an app start (`--open`, and once a module launch) never reached MCP ("MCP did not become
   ready: fetch failed"), with an empty `app-main.log`; both passed on retry. Not investigated.

## Notes

### 2026-11-18
- Created from the roadmap's Phase 8a after EPIC-192 closed.
- **EPIC-185 env-vars flake investigated and fixed (Claude).** It reproduced 4/4 in isolation. Two causes: (1) the
  Environment Variables editor serializes edits after a 300 ms debounce, and closing the page right after an edit
  and choosing Save in the prompt saved the file without that edit (LinkEditor already flushed in `confirmRelease`;
  EnvVarsEditor now does the same and counts an unserialized change as modified); (2) trusted clicks scrolled an
  element into view only when it was outside the window, so a button clipped by the Settings page's scroll panel failed
  with "covered by" its own panel until the timeout (`automation/locator.ts` now scrolls it into view and retries).
  The module then passed 5/5.
- **Torrent Viewer uncovered (decision).** Opening a `.torrent` resolves it through WebTorrent with default options,
  which start DHT discovery (`torrent-viewer/scripts/service.mjs:103-112`, `node_modules/webtorrent/index.js:130-158`),
  even with no trackers or web seeds. Tests must not touch the network, so the board stays uncovered until it offers
  an offline metadata mode.
- **Fixture data.** `persephone-boards/_test/sample.db` holds real author names, so it is not reused; every sample is
  synthetic (generated database, test-built PDF/Office/PE/torrent bytes, a self-signed certificate with a fake subject,
  the MIT-licensed KaTeX Main font).
- Planning: 4 Luna runs in parallel against the helper contract fixed in this document, one correction round
  (US-2100: compare the board editor id by prefix and normalized root). Implementation: 4 Luna runs plus two follow-ups
  (the US-2100 run first wrote only the helper; the PPTX sample lacked parts pptx-preview needs). Triage fixes by
  Claude: `getTables()` field `rowCount`, and the `rm` retry in the published-board helper.
- Completion skills on Codex (Luna): review found nothing; document updated `integration-test/README.md`,
  `integration-tests.md`, `key-files.md` and the ui-tests skill; userdoc updated `boards/testing.md`. typecheck, lint
  and guides:check pass; no catalog messages changed. Task folders deleted at close.
- Full launched run (`--with git,mneme`), 433 tests: **430 passed, 1 failed, 2 skipped** (Tor). The failure is the
  EPIC-187 grid decision; the EPIC-185 env-vars test passed (and 5/5 in isolation after the fixes).
