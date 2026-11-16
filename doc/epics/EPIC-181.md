# EPIC-181: UI test coverage, phase 1 — foundation and core app

## Status

**Status:** Completed 2026-11-16
**Created:** 2026-11-16

## Overview

Phase 1 of the [UI test coverage roadmap](../reviews/ui-test-roadmap.md). The refactoring roadmap touched almost
the whole codebase. This epic retests the core app (startup, settings, session restore, files, scripting, the MCP
surface itself) by writing scripted tests for it under `integration-test/tests/`. Before that, it grows the
EPIC-180 runner with the pieces every later phase needs. The deliverable is the tests plus the bugs they found.

## Goals

- The runner gains: an `--open` mode (seed the profile, start the app, run no tests, leave it running for test
  authoring), a local fixture HTTP server, `requires` tags with a `--with` opt-in, a second-instance launch helper,
  and a per-area helper convention.
- Each core area below has tests for every behavior on its checklist that `call` can reach. The rest is listed as
  uncovered, with the reason.
- App bugs found are fixed in the running dev app, each with a `whats-new.md` line.
- The epic settles who writes the tests in later phases: Codex or Claude.

## Non-goals

- Shell (tabs, dialogs, menus), the sidebar, editors, the browser, boards: later phases.
- Registering published boards from `../persephone-boards`: moved to Phase 7, where the first test needs it.

## Working model

- **US-2027 (runner)** follows the normal delegated flow: Codex plans (session A), Claude reviews, Codex (Luna)
  implements, Claude checks it live.
- **Test tasks (US-2028..US-2032)** are Codex's end to end *(user decision, 2026-11-16)*. They have no separate
  task document; the checklist in this epic is the plan. Codex (Luna) reads the area's guide and source, explores the
  call tree, writes the tests, runs them and triages the failures. Codex cannot launch Electron, so Claude starts an
  `npm run test:ui -- --open` instance before each Codex run, and Codex runs the tests against it with
  `npm run test:ui -- --attach --area <name>` (added in US-2027). A test that needs a restart or a second launch is
  skipped under `--attach`.
- **Failures:** a test bug Codex fixes. An app bug Codex **does not fix** *(user decision, 2026-11-16)*. A test
  asserts what the app should do (the guide, the UI contract, common sense). It never asserts the app's current
  behavior just to pass. When the app is wrong, Codex leaves the test failing and reports the bug in the task's
  Results block: steps, expected, actual, the failing test. Claude investigates and fixes every reported bug.
- **Claude per task:** reads the new test files to check they test the checklist item properly (real assertions,
  no fixed sleeps, no test that passes without checking anything), and sends corrections back to the same Codex
  session. Claude then investigates and fixes the app bugs the task reported, and reruns those tests.
- **Claude per epic:** runs every new test in the normal launched mode (including the restart and second-instance
  tests `--attach` skips), twice, and fixes anything still failing.
- Each task records its results (tests added, app bugs found, uncovered items) in a `#### Results` block
  under its checklist below.

## Area checklists

### US-2028: Startup, single instance, window — `tests/core/startup/`

- Fresh profile starts and the window is ready (title, one default page or the configured start state).
- A second launch with a file path opens that file in the running instance (no second window, same pid answers).
- A second launch with no arguments focuses the running instance.
- Window state: maximize/restore, and size/position survive a restart (if reachable through `window.*`).
- Closing the last page leaves a usable window.

#### Results

- Tests added in [`startup.test.mjs`](../../integration-test/tests/core/startup/startup.test.mjs):
  - `fresh profile opens a ready window with one default page`
  - `second launch with a file opens it in the existing window`
  - `second launch without arguments keeps one responsive window`
  - `window maximize and restore state follows each action`
  - `last page can close while the window creates a usable page`
  - `window size and position survive an app restart`
- `npm run test:ui -- --attach --area core/startup`: **2 passed, 0 failed, 4 skipped**. The fresh-profile, both
  second-launch, and bounds-restart checks require an owned launch and were skipped by attach. A temporary attach
  probe confirmed `window.screen.evaluate` can resize and `window.moveToDisplay("primary")` can reposition the live
  window; read-back showed changed bounds and the profile config updated. No `--close` was run.
- App bugs found: **none in the two tests executed**.
- Uncovered: the app call surface has no focused-state or native PID query, so no-argument launch focus and numeric
  same-PID identity cannot be asserted directly; the second-launch tests check successful handoff, one open window,
  and continued primary-call access. The bounds-restart assertion is authored but was not exercised because attach
  skips app restarts; the attach probe verified the resize/reposition and debounced save steps only.

- Claude check (2026-11-16): full launched run of `core/startup` 6/6 twice. The bounds test got a 1 px tolerance:
  saved DIP bounds read back through the 125% display scale round an edge by 1 px. No app bug.

### US-2029: Settings, themes, language — `tests/core/settings/`

- `app.settings` read and write round-trip for a boolean, a number, a string and an enum setting.
- A changed setting survives a restart (`restartApp`).
- An invalid value is rejected or normalized (whatever the schema says; the test records the actual contract).
- Theme switch: each built-in theme applies (theme id reads back), one light and one dark checked visually through a
  snapshot token, custom theme create, apply and delete.
- UI language switch to one shipped pack and back: a known label changes text.
- The settings-change effects that are observable: e.g. word wrap default reaches a newly opened text page.

#### Results

- Tests added in [`settings.test.mjs`](../../integration-test/tests/core/settings/settings.test.mjs):
  - `settings round-trip boolean, number, string, and enum values`
  - `clipboard item limit rejects or normalizes an invalid value`
  - `settings persist through an app restart`
  - `built-in themes apply and custom themes can be created, applied, and deleted`
  - `UI language changes to a shipped pack and returns to the previous language`
  - `word wrap setting initializes a newly opened text page`
- `npm run test:ui -- --attach --area core/settings`: **3 passed, 1 failed, 2 skipped**. The persistence and language tests require an owned launch/restart and are skipped under attach.
- App bug found: set `clipboard.max-items` to `333`, then set it to invalid value `0`. Expected the invalid value to be rejected or normalized to the schema fallback `100`; actual `settings.get("clipboard.max-items")` returns `0`. Failing test: `clipboard item limit rejects or normalizes an invalid value`.
- Uncovered in this attach run: restart persistence and the language-switch UI assertion were not executed because those tests declare `requires: ["launch"]`; attach cannot restart the app. Both tests are authored and require a launched run for verification.

- Claude check (2026-11-16): **app bug fixed** — `clipboard.max-items` had a `range` but no schema `normalize`, so
  `settings.set` stored an out-of-range value (consumers re-normalized it on read, so retention was unaffected).
  Added `normalize: normalizeClipboardMaxItems` in `src/renderer/api/settings-schema.ts`. The language test waited for
  "Темна" but the theme heading is upper-cased by CSS; made it case-insensitive (test bug). Full launched run of
  `core/settings` 6/6 twice. Note: the port settings also have `range` without `normalize`; out of this task's scope.

### US-2030: Session restore — `tests/core/session/`

- Open pages (text, grid, markdown) survive a restart with their editor, content and active page.
- A grouped pair survives a restart as a group.
- An unsaved edit in a new (untitled) page survives a restart.
- A text file deleted between sessions restores as a Monaco page from cache, retains its last content, and shows
  its deleted state.
- Pinned pages keep their pin.

#### Results

- Tests added in [`session.test.mjs`](../../integration-test/tests/core/session/session.test.mjs):
  - `text, grid, markdown, grouped, untitled, active, and pinned pages restore after restart`
  - `a deleted file restores from cache and its tab shows the deleted state`
- `npm run test:ui -- --attach --area core/session`: **0 passed, 0 failed, 2 skipped**. Both tests require an
  owned launch/restart, so attach skipped their bodies as expected.
- Live call probes confirmed `.txt`, `.grid.csv`, and `.md` editor IDs, group membership, left pin state, and the
  `modified` and content values for an edited untitled page; the probe pages and files were closed/deleted.
- App bugs found: **none observed**; neither test body ran in attach mode.
- Uncovered: restore-failed construction recovery. The call surface has no supported way to make a page editor fail
  construction across a restart; unsupported editor IDs cannot be created through `pages.addEditorPage`, and a
  deleted text file restores through its cache as a normal Monaco page. Restart assertions remain unverified until a
  launched run.

- Claude check (2026-11-16): the restore-failed checklist item was Claude's error (that page is only for a page that
  cannot be constructed); Codex rewrote it to the deleted-file contract. The deleted-file test restarted before the
  watcher had noticed the deletion; it now waits for the page to turn modified and the session to save (test bug).
  Full launched run of `core/session` 2/2 twice. No app bug.

### US-2031: Files — `tests/core/files/`

- `app.fs`: read, write, exists, delete, list, mkdir, copy, rename on files in the profile `work/` folder.
- `pages.openFile`, edit, save: the file on disk changes; dirty marker clears.
- Save as a new path.
- External change: rewrite the file on disk; an unmodified page reloads; a modified page reports the conflict.
- Encoding: open UTF-8 BOM, UTF-16 LE and windows-1252 fixtures; content decodes; save keeps the encoding.
- Line endings: CRLF and LF fixtures keep their line endings on save.
- Recent files: opening adds to the list, the list survives a restart, opening from the list works.
- Encryption: encrypt a page with a password (password dialog), the file on disk is not plain text, reopening shows
  read-only encrypted text with a closed lock; clicking the lock opens the password dialog, the wrong password is
  refused, and the right one decrypts.

#### Results

- Tests added in [`files.test.mjs`](../../integration-test/tests/core/files/files.test.mjs):
  - `app.fs file and directory operations stay within the test work folder`
  - `editing and saving a file updates disk and clears the dirty marker`
  - `external file changes reload an unmodified page`
  - `UTF-8 BOM, UTF-16 LE, and Windows-1252 files decode and keep encoding after save`
  - `CRLF and LF files retain their line endings when saved`
  - `recent files survive restart and open from the Recent Files category`
  - `reopening an encrypted file shows locked content and decrypts from the tab lock`
  - `wrong encryption passwords are rejected and the right password decrypts`
- `npm run test:ui -- --attach --area core/files`: **7 passed, 0 failed, 1 skipped**. The recent-files test
  requires an owned restart and was skipped in attach mode.
- App bugs found: **none**. The Windows-1252 test now uses a realistic Western sentence, checks detected encoding
  after opening and saving, and the encrypted-file test follows the guide's locked-text plus click-to-decrypt flow.
- Uncovered: Save As cannot be completed through the call tree. It opens a native file picker; the exposed
  `main.windows[i].nativeDialog` surface can inspect or dismiss it but cannot select a path. The recent-files
  restart and open-from-list test was authored but skipped by `--attach`; it needs a launched run. Automatic
  Windows-1252 detection is ambiguous for very short samples (for example, a 22-byte sample with three high
  bytes may detect as cp862); the test uses a realistic Western sentence. A modified page's external-change
  conflict is not observable: the call surface exposes `modified`, which is already true before the external write,
  and no watcher event or conflict state for that page.

- Claude check (2026-11-16): both reported bugs were not app regressions. Windows-1252: a 22-byte sample is ambiguous
  and detects as cp862; a realistic sentence detects as windows-1252 (test changed, limitation recorded). Encrypted
  reopen: there has been no automatic password prompt since at least Feb 2026; `assets/guides/encryption.md` was stale
  and now describes the lock-click / Decrypt flow (guide fixed). Recent-files test compared a mixed-separator path
  with the normalized stored path (test bug). Full launched run of `core/files` 8/8 twice.

### US-2032: Scripting core and MCP surface — `tests/core/scripting/`, `tests/core/mcp/`

- Run a JS script against a page: `page.content` transform lands in the page.
- Run a TS script: types are erased and it runs.
- `page.grouped` output: script output goes to the grouped page, which is created on demand.
- `app` and `io` basics from a script: `app.pages`, `app.fs`, `io.createPipe` over a fixture file and over the
  fixture HTTP server.
- Log View: a script's log output appears with its levels.
- A script error is reported (message reaches the result) without wedging the page.
- An inline script dialog (input or confirm) is answered through `{dialog: true}`.
- Script library: a script in the library runs from the library panel command.
- MCP surface: root `$help` lists the namespaces; a bad path returns a useful error; `maxLength` truncation and its
  marker; a call timeout returns a timeout error; the attention/pending protocol on a dialog the test opens.

#### Results

- Tests added:
  - [`scripting.test.mjs`](../../integration-test/tests/core/scripting/scripting.test.mjs):
    - `JavaScript and TypeScript transform their page and create grouped output`
    - `app and io read pages, fixture files, and fixture HTTP responses`
    - `script log output is visible in grouped Log View with its levels`
    - `script errors reach the result and leave the page usable`
    - `an inline script input dialog can be answered through the dialog-aware call`
    - `a selected script-library entry runs from the related-script panel command`
  - [`mcp.test.mjs`](../../integration-test/tests/core/mcp/mcp.test.mjs):
    - `the MCP call description and root help expose the live object-model namespaces`
    - `an invalid MCP path reports a useful member hint`
    - `maxLength truncation returns a bounded body and an explicit marker`
    - `a bounded automation wait returns a timeout error`
- `npm run test:ui -- --attach --area core/scripting,core/mcp`: **10 passed, 0 failed, 0 skipped**.
- App bugs found: **none**.
- Uncovered: **none**; every checklist item was reached through the call surface in attach mode.

- Claude check (2026-11-16): launched run of `core/scripting,core/mcp` passes. **Epic pass:** the first full run
  failed `fresh profile...` because a restart between modules restored the previous module's session; the runner now
  stops, re-seeds the profile and starts the app between modules (`run.mjs`, `prepareProfile({ ports })`). Full suite
  44/44 twice, about 130 s.

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-2027 | Runner additions: `--open`, fixture HTTP server, `requires`/`--with`, second-instance helper, area helpers | Done |
| US-2028 | Tests: startup, single instance, window | Done |
| US-2029 | Tests: settings, themes, language | Done |
| US-2030 | Tests: session restore | Done |
| US-2031 | Tests: files, encoding, recent, encryption | Done |
| US-2032 | Tests: scripting core and MCP surface | Done |

## Concerns

1. **Restart-heavy areas are slow.** Session and settings tests restart the app. Group the restarts (several
   checks per restart) rather than one restart per assertion.
2. **Codex cannot launch the app.** It runs tests with `--attach` against an instance Claude started. If a sandboxed
   Codex cannot reach `127.0.0.1:17865`, that is found in the first test task, and the fallback is Claude running
   the tests Codex wrote.
3. **Test contract versus current behavior.** Where the guide and the app disagree, the test follows the guide when
   the app is clearly wrong (an app bug), and follows the app when the guide is just stale (fix the guide).

## Notes

### 2026-11-16
- Created from the roadmap's Phase 1. Board registration moved to Phase 7.
- US-2027 implemented (Codex plan on Terra, Luna implementation, plus the area/module follow-up) and verified live:
  `--open`, `--attach`, `--list`, area prefixes, skips, the fixture HTTP server, second launch, `--close`.
- **App bug found (fixed by Claude):** `src/main/e-store.ts` built its electron-store at import time, before
  `main.ts` applied `--profile`, so every named profile read and wrote the default profile's `config.json` (window
  position, board/site-extension trust, site permissions, downloads, UI preferences). The store is now created on
  first use. Found because the test window opened over the user's main window. The test seed now has
  `seed/config.json`, which pins the test window to the primary monitor's top-left corner.
