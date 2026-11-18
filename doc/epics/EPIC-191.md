# EPIC-191: UI test coverage, phase 7a — Board platform: lifecycle, permissions, Board Info, bridge

## Status

**Status:** Completed 2026-11-18
**Created:** 2026-11-18

## Overview

First half of Phase 7 (Board platform and bundled boards) of the [UI test coverage roadmap](../reviews/ui-test-roadmap.md).
It covers the board platform itself, driven through `boards.*`, `dialogs[i]`, `pages[i].editor` of a board page and the
`window.persephone` bridge inside small fixture boards:

- **Lifecycle:** create a blank board and the Demo board, open, list, edit a file and reload, rename, unregister, the
  trust dialog for a foreign board, and board-mode windows.
- **Permissions and Board Info:** off-by-default manifest permissions refused by the bridge, the trust dialog's grant
  list, the permissions-changed dialog after a manifest widens its grants, the legacy-manifest note, and the Board Info
  page (properties, unregister).
- **Bridge:** `persephone.execute`, `executeNode`, `persephone.call` (`appScripting`), file access, board vars, shared
  storage, settings, i18n and `persephone.version`, each checked from a fixture board in
  `integration-test/fixtures/boards/`.
- **Board extensions:** a board registered as a custom editor for a file mask, content providers, capability handlers
  and board services.

The deliverable is the tests plus the bugs they find. New tests use the `app` object style
(`ctx.app.boards.…`, `ctx.app.pages[id].editor.…`), with `ctx.call`/`ctx.callText` only where the stand-in cannot
express the call (call options such as `{ dialog: true }`, or an exact string result).

## Goals

- Each module below has tests for every behavior on its checklist that `call` can reach; what it cannot reach is listed
  as uncovered, with the reason.
- Every fixture board lives in the test profile's `work/` copy; no test touches the user's profile, the user's trusted
  boards or the real published-boards catalog.
- Claude fixes each app bug the tests find and adds a `whats-new.md` line for it.
- Every difficulty Codex has working out how to drive boards and the bridge is recorded in
  [ai-vision-feedback.md](../reviews/ai-vision-feedback.md).

## Non-goals (Phase 7b)

- The published-board registration helper (from `../persephone-boards`), catalog install / update / roll back against
  a fake catalog on the fixture server (needs a test-only catalog base URL in the main process), and the bundled
  Excalidraw and REST Client boards. These are Phase 7b.
- The EPIC-187 grid row-insertion decision. It is the user's and stays open.

## Decisions

- **Split (2026-11-18).** Phase 7 is too large for one night: the platform alone is four test tasks, the size of
  EPIC-189/190. 7a takes lifecycle, permissions, Board Info and the bridge, which need no product changes to test.
  7b takes everything that needs new runner or main-process support (the registration helper, a fake catalog) plus the
  two bundled boards. The roadmap records the split.
- **Trust in tests.** A board created with `boards.createBoard`/`createDemoBoard` is auto-trusted, as for an agent. A
  fixture board copied from `fixtures/boards/` is foreign, so it is trusted through `boards.registerBoard(root)` with
  `{ dialog: true }` and a click on **Trust Board**. A shared `tests/boards/helpers.mjs` owns that step so only the
  trust-dialog tests drive the dialog in detail.
- **Fixture boards.** Each task gets its own folder under `integration-test/fixtures/boards/` (no sharing between
  tasks, so the four plans can run in parallel). Boards are never nested: one board per folder. Tests that change a
  fixture board's files reset them at test start.
- **Module layout.** New area `boards`: modules `boards/lifecycle`, `boards/permissions`, `boards/info`,
  `boards/bridge`, `boards/extensions`.

## Working model

Same as EPIC-190 (unattended overnight run):

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

## Area checklists

### US-2091: Board lifecycle — `tests/boards/lifecycle/`

- `boards.createBoard(name, dir)` scaffold (files, manifest with every permission `false`, auto-trusted, name collision
  error), `boards.createDemoBoard`, `boards.openBoard` (tab opens, reused on a second call), `boards.list()` fields.
- Edit a board file on disk and `pages[i].editor.reload()` shows the change; the starter button runs its backend script.
- `boards.renameBoard` (folder moves, an open page follows), `boards.unregisterBoard` (trust and pin removed).
- A foreign board: `registerBoard` → trust dialog → **Trust Board** opens it; **Cancel** leaves it untrusted
  (`shell/dialogs` already covers the Cancel path; only cross-check here).
- `boards.openBoardWindow(root)` for a trusted board and its rejection for an untrusted one; `boards.createShortcut`
  with an explicit `.lnk` path inside the fixture folder.

### US-2092: Permissions and Board Info — `tests/boards/permissions/`, `tests/boards/info/`

- A fixture board with every permission `false`: each gated bridge call (`execute`, file access, `call`, network,
  notifications, themes…) is refused with a clear error; the same board with one grant enabled succeeds for that grant.
- The trust dialog lists the declared grants (`permissions`, `permissionLines`); widening a trusted board's manifest
  shows the permissions-changed dialog (`change`), accept and decline paths.
- A legacy manifest (no permissions object) is labelled in `boards.list()` (`deprecationNote`).
- Board Info page: opens for a board, shows its normalized manifest properties, unregister from it.

### US-2093: Bridge — `tests/boards/bridge/`

- From a fixture board's page (`pages[i].editor` automation / `evaluate` in the board frame): `persephone.version`,
  `execute` (stdout JSON result, a failing script's error), `executeNode`, `persephone.call` into the app,
  file read/write/list within granted scope, board vars (`persephone.var`) against a fixture store, shared storage,
  board settings (manifest-declared defaults, change, reset), `persephone.i18n.t`.

### US-2094: Board extensions — `tests/boards/extensions/`

- A board declared as the editor for a file mask: opening a matching fixture file offers / opens the board editor,
  the board reads and saves the file's content (round trip), editor switching back to text.
- Content providers: a board provider's URL scheme read through `io` / `openRawLink`.
- Capabilities: a fixture board provides a capability; `capabilities.*` lists it and a call reaches it.
- Board services: a declared service starts, answers `boards.requestService`, stops.

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-2091 | Tests: board lifecycle | Done |
| US-2092 | Tests: permissions and Board Info | Done |
| US-2093 | Tests: bridge | Done |
| US-2094 | Tests: board extensions (editors, providers, capabilities, services) | Done |

## Results

- **US-2091:** 12 tests in `lifecycle/lifecycle.test.mjs` and the area helper `tests/boards/helpers.mjs`
  (`fixtureBoard`, `resetBoardFile`, `trustFixtureBoard`, `openBoardPage`, `closeBoardPage`, `untrustBoard`,
  `waitForBoardDialog`): create (scaffold, all-false grants, auto-trust, name collision), the Demo board, open and
  reuse, `boards.list()` fields, reload from disk, wiring the starter to its backend (edit, reload, accept the
  permissions-changed dialog), rename, unregister and its pin, a foreign board trusted through the dialog, board-mode
  windows (open, reuse, untrusted refusal), shortcuts.
- **US-2092:** 12 tests in `permissions/permissions.test.mjs` (the trust dialog's grant list; `execute`, file,
  `appScripting`, `network` and `themes` refusals; the same calls granted; permissions-changed accept and dismiss;
  legacy manifests' `deprecationNote`) and 2 in `info/info.test.mjs` (Board Info properties, unregister from it).
- **US-2093:** 16 tests in `bridge/bridge.test.mjs` and `bridge/bridge-state.test.mjs`: `persephone.version`,
  `execute` (result, failure, arguments), `executeNode`, `persephone.call` with and without `appScripting`, board-scope
  files and the refusal outside it, board vars (owner and isolation), shared storage, settings (default, change from
  the Settings page, reset), i18n, page state and visibility.
- **US-2094:** 10 tests in `extensions/`: a board as the editor of `*.us2094` files (default editor, read, save to
  disk, switch to text and back), a folder claim opened from the Explorer, a service-registered content provider,
  capability discovery and call, board services (lazy request, start and stop).
- **App bugs fixed (Claude):** `boards.openBoard` opened a second tab for an already-open board; a board created
  from the Demo template lost its author when no default author is set, so its declared settings were rejected with an
  error toast; the product test host failed any step whose string result started with `Error: ` (a page returning
  `String(error)`). **Call gap closed:** `boards.requestService`/`startService`/`stopService` on the call tree.
  **Guide fixes:** the boards hub and testing page gave wrong return shapes for `createBoard`/`openBoard` and described
  a starter `boardScript()` helper that does not exist; the `createShortcut` member summary gave the wrong result.
- **Run time:** the `boards` area runs in about 90 s (5 modules, 52 tests); green twice in a row, and again after
  the last fix.

## Concerns

1. **Board windows.** A board-mode window is a second `BrowserWindow`; the call tree may not reach into it. If not,
   the test checks what `call` can see (window list, focus) and the rest is uncovered.
2. **Backend scripts spawn OS processes.** `execute` tests need Node on PATH in the test instance; if not, they are
   reported, not skipped silently.
3. **Module time.** Board pages are slow to start; split a module by feature if it passes 3 minutes.

## Open items

1. **Carried over:** the EPIC-187 grid row-insertion decision (user's call; its test stays failing). The EPIC-185
   env-vars test failed again in the full run. Investigated: the button is clickable once the section has scrolled,
   and a hit-test wait plus `scrollIntoView` made the second open in that test fail instead; the experiment was
   reverted. Still intermittent, cause not found.
2. **Board automation during a reload:** while a board reloads (after accepting the permissions-changed dialog),
   `reload()` rejects with "Board frame not ready" and an `evaluate` can block for the caller's whole wait. The test
   polls `reload()`; the facade should wait for the loading frame (recorded in ai-vision-feedback).
3. **Uncovered:** device permissions (camera, microphone, geolocation, computer audio), clipboard read and browser
   notifications (iframe feature policies, not bridge errors; no hardware in the test profile); `openExternal`
   refusal (it is logged, not reported to the frame, and a test must not risk launching an external app); native
   Save dialog of `createShortcut`; OS focus of a board window; board setting types other than string;
   `fileSystem: "full"` and picker grants. Phase 7b: the published-board registration helper, catalog install /
   update / roll back against a fake catalog, Excalidraw and REST Client.
4. **API gaps recorded for the ai-vision review** (21 entries in [ai-vision-feedback.md](../reviews/ai-vision-feedback.md)):
   no call member opens Board Info; board settings cannot be set over `call`; bridge permission errors carry `code`
   for files but not for `call`; the `windows[i]` summary's `pageCount` disagrees with `pages.count`;
   `pages.openFile(folder)` makes a workspace page, not the folder's board editor.

## Notes

### 2026-11-18
- Created from the roadmap's Phase 7, split into 7a (this epic) and 7b.
- Planning (4 parallel Luna runs, one correction round each) and implementation (4 Luna runs, one fix round for
  US-2094). Review corrections that mattered: string `evaluate` (functions cannot cross `call`), one board per
  fixture folder with test data outside boards, no manifest flip-and-retrust in bridge tests, a fake scheme instead of
  `mailto:` (then left uncovered), the service call gap closed instead of routed through `ctx.script`.
- Triage: three app bugs and one call gap (above); the rest were test guesses (dialog waits without
  `{ dialog: true }`, `editorSwitches.options` shape, `createShortcut` result, `windows[i].pages` summary, missing
  frame-ready waits, `board-view` vs `board-editor:<root>`, an error `code` that `call` denials do not carry).
- Completion skills on Codex (Luna): review found nothing; document updated `integration-tests.md`, the runner
  README, the ui-tests skill and `key-files.md`; userdoc updated the boards `services`, `testing` and
  `folder-editor` guides. typecheck, lint and guides:check pass (the hub was trimmed under its 10,000-character
  limit); no catalog messages changed. Task folders deleted at close.
- Full launched run (`--with git,mneme`): 377 tests, **372 passed, 3 failed, 2 skipped** (Tor). Failures: the EPIC-187
  grid decision, the intermittent EPIC-185 env-vars test, and the lifecycle starter-backend test (intermittent read
  during a board reload; fixed afterwards, passed 3 of 3 alone, and the `boards` area reran green, 52 passed).
  52 new tests.
