# EPIC-194: UI test coverage, phase 8b — published apps

## Status

**Status:** Completed 2026-11-18
**Created:** 2026-11-18

## Overview

Phase 8b of the [UI test coverage roadmap](../reviews/ui-test-roadmap.md): the app boards of the separate
`persephone-boards` repository — todo, notebook, gem-keep, chess, translate, theme-editor and force-graph. Each board
is registered into the test profile from the local checkout with EPIC-192's helper
(`tests/helpers/published-boards.mjs`), and each gets: it opens (its sample file, or the board itself when it has no
file type), the main view renders, its primary action works, and its data round-trips where it edits (an edit made
through the board's model or UI is saved and read back from the file).

The deliverable is the tests plus the bugs they find. New tests use the `app` object style
(`ctx.app.pages[id].editor.…`), with `ctx.call`/`ctx.callText` only where the stand-in cannot express the call.

## Goals

- Every board on the list has tests for its checklist below that `call` can reach; what it cannot reach is listed as
  uncovered, with the reason.
- No test touches the network, GitHub, the real catalog, real accounts or the user's profile.
- A bug in a published board is recorded as an open item (file and line) and its test stays failing; the
  `persephone-boards` checkout is read-only. A bug in Persephone itself is fixed here with a `whats-new.md` line.
- Every difficulty Codex has driving the boards is recorded in [ai-vision-feedback.md](../reviews/ai-vision-feedback.md).

## Non-goals

- Phases 8c–8d (agent tools, audio and speech boards).
- Editing or committing anything in `persephone-boards`.
- Catalog install of these boards (covered once in EPIC-192 against the fake catalog).

## Decisions

- **Translate is uncovered (2026-11-18).** Opening the board opens its management channel, whose snapshot calls
  `selectedModels()` → `TranslationAssets.discover()`, which fetches the model registry from
  `https://firefox.settings.services.mozilla.com/v1/` (`translate/scripts/translation-assets.mjs:9,147-172`,
  `scripts/service.mjs:206-207`). Its data root is `%LOCALAPPDATA%\Persephone\board-data\translate`
  (`translation-assets.mjs:29-32`), which is the user's real local data folder, not the test profile. Even
  detection needs `selectedModels()` (`service.mjs:49-51`). Tests must touch neither the network nor the user's
  profile, so the board stays uncovered until it can run from an injected registry and data root.
- **No further split.** Six boards in three test tasks, about 3–6 tests per board, roughly 30 tests. That fits one
  epic; a task that overruns records its remainder as an open item.
- **Area `published-boards`** (from EPIC-193), one module per board: `integration-test/tests/published-boards/<board-id>/`.
- **Shared area helper** `integration-test/tests/published-boards/helpers.mjs` (EPIC-193) already has
  `openPublishedSample(ctx, boardId, sampleRel)` and `closePublishedSample(ctx, handle)` for file-backed boards. This
  epic adds, owned by US-2105 and used by US-2106:
  - `openPublishedBoard(ctx, boardId)` — registers the board with `registerPublishedBoard`, opens it with
    `boards.openBoard(root)` the way `tests/boards/helpers.mjs` `openBoardPage` does (reuse that function, do not copy
    it), waits for the active page and `frameReady`, and returns `{ id, editor, root }`. The returned handle is closed
    with the existing `closePublishedSample(ctx, handle)`.
  - Tests declare `requires: ["launch", "published-board-checkout"]`, like the EPIC-193 tests.
- **Sample files** live in `integration-test/fixtures/boards-samples/<board-id>/` (text formats written by Codex) or
  are written at test start under `ctx.fixture(...)`. They are small, synthetic and carry no personal data. Nothing is
  copied from `persephone-boards/_test` or from a board's `examples/` folder without checking it for personal data and
  naming its source in the task document; synthetic samples are preferred.
- **Mutable samples are reset at test start** (`fs.write` of the fixture content) and edits are verified by reading the
  saved file back with `ctx.callText("fs.read", ...)`.
- **App state a board changes is restored.** Theme Editor saves themes into the test profile and may preview or select
  a theme; each test deletes the themes it created and restores the theme setting in `finally`.
- **Order.** All three plans run in parallel against this contract. US-2105 (the helper) is implemented first; US-2104
  and US-2106 are implemented after it lands.

## Working model

Same as EPIC-193 (unattended overnight run):

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

### US-2104: Todo and Notebook

- **todo:** a `.todo.json` opens in the board; lists, items and tags render from the sample; adding, completing and
  editing an item through the model (or UI) is saved to the file; search filters items; the Lists & Tags secondary
  view if reachable.
- **notebook:** a `.note.json` opens in the board; notes, categories and tags render from the sample; adding or editing
  a note is saved to the file; search finds a note; the Categories & Tags secondary view if reachable.

### US-2105: Helper, Force Graph and Theme Editor

- The `openPublishedBoard` helper above.
- **force-graph:** a `.fg.json` opens in the board; nodes and links read back through the model match the sample;
  adding or changing a node or link is saved to the file; a malformed file reports an error instead of a blank view.
- **theme-editor:** the board opens (directly, and through the `theme.edit` capability `open` if `call` reaches it);
  creating a theme from base colors derives the rest; saving makes it selectable in the app's theme list; renaming or
  deleting it; the contrast check reports a low-contrast pair. Created themes are deleted and the theme setting
  restored at the end of every test.

### US-2106: Chess and Gem Keep

- **chess:** the board opens with the start position; the model reads the position; a legal move through the model is
  applied and an illegal one is rejected; the side chat and arrows the agent can draw; a new game resets.
- **gem-keep:** the board opens and the 3D view renders (canvas present, not 0×0); the level list reads from the
  board's `levels/index.json`; starting a level shows the game HUD; what else `evaluate`/`snapshot` can reach without
  timing-dependent gameplay.

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-2104 | Tests: Todo, Notebook | Done |
| US-2105 | Helper; tests: Force Graph, Theme Editor | Done |
| US-2106 | Tests: Chess, Gem Keep | Done |

## Results

- **US-2104:** `todo` 3 tests (sample lists/items/tags and the Lists & Tags view; add, complete and edit an item saved
  to the file; search by title and tag through `ctx.set`) and `notebook` 3 tests (notes, categories, tags and the
  Categories & Tags view; add and edit a note saved to the file; content search). Committed synthetic samples under
  `fixtures/boards-samples/{todo,notebook}/`, copied to the work file at test start. Green on the first run.
- **US-2105:** `openPublishedBoard(ctx, boardId)` in the area helper (reuses `openBoardPage`). `force-graph` 3 tests
  (nodes and links read back, node and link edits saved through the model's `save()`, malformed JSON shows the error
  panel; samples written at test start). `theme-editor` 5 tests (derive from base colors, save and select a custom
  theme, rename then delete, low-contrast pair, open through the `theme.edit` capability); every test deletes the
  themes it created and restores `settings.theme`. One test stays failing on a board bug (open item 3).
- **US-2106:** `chess` 4 tests (start position, legal and illegal agent moves, chat and arrows, new game) and `gem-keep`
  3 tests (WebGL canvas and level menu, three ordered levels with only the first unlocked, Green Meadow's starting HUD
  without starting a wave). WebGL works in the test instance.
- **Call gap closed (Claude):** the test `ctx` could not assign a writable property; `ctx.set(path, value)` sends the
  `call` tool's `value`, and assigning through `ctx.app` now throws and names `ctx.set` (`src/test-host/`).
- **Fixed (Claude):** `call` reported any result object with `pending: true` (a board model's status object) as
  "script execution is still in progress", so it could not be read (`src/main/mcp/tools/call-tools.ts`).
- **Triage fixes (Claude):** `themes.list` read with `maxLength`; the Gem Keep level selector scoped to `#level-list`;
  Theme Editor cleanup reverts first and deletes only themes still listed.

## Concerns

1. **WebGL in the test instance.** Gem Keep needs WebGL; if the test instance has no GPU context the board may show an
   error. Then the test asserts what renders and the 3D view is listed as uncovered.
2. **Theme state.** A theme left behind or left selected would leak into later modules; the runner re-seeds the profile
   between modules, but tests in the same module must clean up.
3. **The checkout may be missing** on another machine. Tests skip with a reason; they never fail.

## Open items

1. **Carried over:** the EPIC-187 grid row-insertion decision (user's call; its test stays failing).
2. **Uncovered:** Translate (see Decisions); Todo/Notebook drag-and-drop ordering and comments UI; Notebook grid and
   preview views; Force Graph canvas interaction, groups and BFS visibility; Theme Editor import/export (native file
   dialogs), randomize and generated sets; Chess user moves by mouse, `waitForTurn` and resign; Gem Keep gameplay
   (waves, towers, spells, results), which is timing-dependent.
3. **persephone-boards (read-only here, for the board owner):**
   - `boards/theme-editor/app.js:1283-1312`: `queueDraftRefresh` never clears `state.previewTimer` after the timer
     fires, so `previewStatus.pending` (`app.js:1667`) stays `true` forever after the first edit. The test
     `theme-editor` › "opens and derives a draft from base colors" asserts that it settles and stays failing.
   - `boards/notebook/CLAUDE.md` calls `nav.js` (the Categories & Tags view) a placeholder; it is implemented.
   - `boards/translate`: opening the board contacts the Mozilla model registry and stores data in the user's real
     `%LOCALAPPDATA%\Persephone\board-data\translate`; the README does not say that opening goes online.

## Notes

### 2026-11-18
- Created from the roadmap's Phase 8b after EPIC-193 closed. Translate left uncovered (see Decisions).
- Planning: 3 Luna runs in parallel against the helper contract, one correction round each (US-2104: assignment needs
  `ctx.set`, model entries carry `kind`; US-2105: per-field link checks, capability-test cleanup; US-2106: `lastMove`
  color is `"white"`, Gem Keep starts with 255 gold). Implementation: 3 Luna runs plus one follow-up (Theme Editor
  waits). Triage by Claude: the `call` `pending` collision (product fix), `themes.list` `maxLength`, the Gem Keep
  selector, the Theme Editor cleanup order.
- Completion skills on Codex (Luna): review found nothing; document updated `integration-test/README.md`,
  `integration-tests.md`, the ui-tests skill, `key-files.md` and `boards/testing.md`; userdoc found nothing more.
  typecheck, lint and guides:check pass; no catalog messages changed. Task folders deleted at close.
- Full launched run (`--with git,mneme`), 454 tests: **450 passed, 2 failed, 2 skipped** (Tor). Failures: the EPIC-187
  grid decision and the Theme Editor `previewStatus` board bug (open item 3). 21 new tests, all others as at EPIC-193.
- Launch flake (EPIC-193 open item 4) did not recur in about 15 app launches this run; still not investigated
  beyond reading the readiness loop (`src/test-host/client.ts` retries until the startup deadline; MCP starts only
  once a renderer window actuates `mcp.enabled`, so a renderer that never loads would look the same).
