# EPIC-195: UI test coverage, phase 8c — published agent tools

## Status

**Status:** Completed 2026-11-18
**Created:** 2026-11-18

## Overview

Phase 8c of the [UI test coverage roadmap](../reviews/ui-test-roadmap.md): the agent-tool boards of the separate
`persephone-boards` repository — agent-log-viewer, aivision-explorer and claude-agent. Each covered board is
registered into the test profile from the local checkout with EPIC-192's helper
(`tests/helpers/published-boards.mjs`) and opened with the EPIC-193/194 area helpers
(`tests/published-boards/helpers.mjs`). Each gets: it opens, the main view renders, its primary action works.

The deliverable is the tests plus the bugs they find. New tests use the `app` object style
(`ctx.app.pages[id].editor.…`), with `ctx.call`/`ctx.callText`/`ctx.set` only where the stand-in cannot express the
call. Neither covered board exposes an `editor.app` model, so tests drive and read the board DOM through the board
page's automation (`editor.snapshot`, `editor.evaluate`, `editor.click`, … — whatever `$help` documents).

## Goals

- agent-log-viewer and aivision-explorer have tests for their checklists below that `call` can reach; what it cannot
  reach is listed as uncovered, with the reason.
- No test touches the network, a real AI provider, an API key, a real account, the user's profile or the user's real
  agent logs. All logs are synthetic and written by the tests.
- A bug in a published board is recorded as an open item (file and line) and its test stays failing; the
  `persephone-boards` checkout is read-only. A bug in Persephone itself is fixed here with a `whats-new.md` line.
- Every difficulty Codex has driving the boards is recorded in [ai-vision-feedback.md](../reviews/ai-vision-feedback.md).
  aivision-explorer is itself an ai-vision surface, so its plan reviews it in detail.

## Non-goals

- Phase 8d (audio and speech boards).
- Editing or committing anything in `persephone-boards`.
- Catalog install of these boards (covered once in EPIC-192 against the fake catalog).

## Decisions

- **claude-agent (Agent Chat) is uncovered (2026-11-18).** Opening the board runs its resident service, and the page
  lists sessions on load (`app.js:1617`, `list-sessions`). That reads the user's real Claude transcripts under
  `CLAUDE_CONFIG_DIR` or `~/.claude/projects` (`scripts/providers/claude.mjs:290`), resolves the real `claude` and
  `codex` CLIs from `PATH` (`scripts/claude-executable.mjs:15`, `scripts/providers/codex.mjs:55`) and starts
  `codex app-server` to list Codex threads and models, which can reach OpenAI. It also reads and writes its
  instructions and group-chat data in the user's real `%LOCALAPPDATA%\Persephone\board-data\claude-agent`
  (`scripts/service.mjs:31-33,159-161`). The test instance inherits the user's environment (`integration-test/run.mjs:413`),
  so none of this can be isolated per module tonight. Even the "no CLI configured" error state needs `PATH`,
  `USERPROFILE`, `CLAUDE_CONFIG_DIR`, `CODEX_HOME` and `LOCALAPPDATA` redirected for board processes. Recorded as an
  open item: a test-mode environment sandbox for board processes would make it coverable.
- **The published-board copy skips runtime files (2026-11-18).** `registerPublishedBoard` copies the whole board
  folder, including git-ignored runtime files: every board's `ui.log` (the bridge's runtime log from the user's own
  sessions) and agent-log-viewer's `cache/summaries.json` (summaries and recent sources of the user's real logs,
  `scripts/log-server.mjs:20,212-215`). A copied cache would put the user's data into the test board and its reports.
  The helper in `tests/helpers/published-boards.mjs` gets a copy filter (owned there, used by every published-board
  test): skip `ui.log`, `node_modules/`, `.git/`, `*.zip`, and the plain entries of the board's own `.gitignore`
  (a name, or a directory with trailing `/`; no globbing beyond what those two boards' files need). Owned by US-2107.
- **agent-log-viewer presets are never clicked.** The "Claude Code" and "Codex" preset buttons open the user's real
  `~/.claude/projects` and `~/.codex/sessions` (`log-server.mjs:367-369`). Tests may not click them and may not read
  or assert their titles or paths (they contain the user's home path). Logs are opened by path: a synthetic `.jsonl`
  file via `pages.openFile`, or a synthetic folder whose path matches a `folderMasks` entry
  (`…/.claude/projects/<project>/`) under `ctx.fixture(...)`.
- **Synthetic logs only.** The tests write Claude Code and Codex CLI `.jsonl` logs at test start (or commit small ones
  under `fixtures/boards-samples/agent-log-viewer/`), built from the parsers' expected record shapes
  (`scripts/parsers/claude-code.mjs`, `codex.mjs`). The board's own synthetic generator
  (`persephone-boards/_test/agent-log-viewer/generate-fixtures.mjs`) may be read for record shapes, never run against
  the user's home, and nothing under `~/.claude` or `~/.codex` is read. Content is invented text with no personal data.
- **aivision-explorer operations are harmless.** Read and Invoke only on members without side effects outside the
  test (or on the test's own pages); a member with a `caution` is exercised by cancelling the confirmation, and
  confirmed only when its effect is safe and cleaned up. No assignment to a setting unless the test restores it.
- **Area `published-boards`**, one module per board: `integration-test/tests/published-boards/<board-id>/`. Tests
  declare `requires: ["launch", "published-board-checkout"]`.
- **Split:** two tasks, planned in parallel; US-2107 lands its helper change first (it is the only shared code).
- **No bridge version bump for the `events.wait` fix (2026-11-18).** The board-call fix below changes no
  `window.persephone` member or signature; it makes `persephone.call("events.wait")` behave as documented. Boards need
  nothing to feature-detect.

## Working model

Same as EPIC-194 (unattended overnight run):

- **Codex cannot run the suite at all** (the product test host is an Electron utility process its sandbox cannot
  start, even with `--attach`). Codex writes tests from the guides, the boards' source, and `$help` text, and checks
  syntax with `node --check`. **Claude runs the tests and triages** every failure.
- **Two Codex sessions per task, both Luna/high:** session A investigates and writes a short task document (deleted
  when the epic closes); Claude reviews it; session B implements from the corrected document.
- Codex never uses the persephone MCP tool or port 7865, never runs `npm start`, `build-prod` or Electron, never
  commits or stages, and never edits `persephone-boards`.
- Every Codex brief asks for an `AI-VISION FEEDBACK` section; Claude appends each case to
  [ai-vision-feedback.md](../reviews/ai-vision-feedback.md), plus every failure caused by a wrong guess about the API.

## Area checklists

### US-2107: Agent Log Viewer (and the runtime-file copy filter)

- The copy filter above, in `registerPublishedBoard`.
- A synthetic Claude Code `.jsonl` opens in the board's session view: the conversation renders as turns, a tool call is
  paired with its result, an edit shows a diff, and the token usage in the header matches the synthetic `usage`
  (counted once per message id).
- A synthetic Codex CLI `.jsonl` opens: turns render and token usage follows the cumulative `token_count` deltas.
- Find (or filters) in the session view locates a turn by text.
- A synthetic folder matching the Claude `folderMasks` opens as the session list: both sessions listed, sort and
  content search work, the daily usage chart renders.
- An unknown record type does not break rendering; the `showCost` setting shows an estimated cost when on (restored
  after) if `call` reaches board settings.

### US-2108: AiVision Explorer

- The board opens without a file, passes the root preflight, and the tree shows the root members (`pages`, `boards`, …,
  plus the green `helpSearch` and `events` rows).
- Expanding a node lists its children and members; selecting a leaf shows the Agent tab's returned value and hint,
  matching what `call` returns for the same path; a `$help` row shows prose and no Hint block.
- The Members tab lists the selected node's members with the count on the tab; Read from the Members tab opens a
  result dialog, not the Agent tab.
- Help search finds a known topic; selecting a result does not invoke a method.
- The events panel shows recent events and a new event (caused by the test) arrives.
- Invoke a harmless method and see its result; a cautioned member asks for confirmation and Cancel does nothing.
- A board page that was never activated shows the activation hint instead of `app`.

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-2107 | Copy filter; tests: Agent Log Viewer | Done |
| US-2108 | Tests: AiVision Explorer | Done |

## Results

- **US-2107:** the copy filter in `registerPublishedBoard` (verified: the copy holds no `cache/` and only the test run's
  own `ui.log`). `agent-log-viewer` 3 tests from synthetic logs written at test start under
  `…/.claude/projects/…` and `…/.codex/sessions/…`: a Claude session (two turns, tool call paired with its result, the
  edit diff, usage of a repeated message id counted once, an unknown record skipped), a Codex session (turns and
  cumulative `token_count` deltas), and find in the session view. One triage fix (the result is the second `.out`).
- **US-2108:** `aivision-explorer` 7 tests: root preflight and tree, expand `pages` and read `version` and `$help`
  against `call`, Members count against `$describe` with Read in a result dialog, help search selecting
  `pages.addEmptyPage` without invoking it, a `remote-notify` event arriving in the Events tab, Invoke of
  `events.recent([5])`, and Cancel on the cautioned `pages[i].grouped`. Triage: waits after every action, `{ text }`
  results, the Events tab revealed through its tree row, the minimal `aiVision` descriptor for the notify probe, and
  "Not read yet." as the search-selection expectation.
- **Fixed (Claude):** a board's `persephone.call("events.wait")` started from cursor 0 on every call and returned the
  oldest retained event, so a board's live event feed never saw a new event
  (`src/renderer/api/boards/board-host-rpc.ts`: per-frame cursor). The Events test failed before the fix.

## Concerns

1. **No board models.** Both boards are driven through DOM automation; selectors come from board source and may be
   fragile. Prefer `data-name`/ids the board sets on purpose.
2. **Long-lived processes.** agent-log-viewer's `log-server.mjs` is a resident `executeNode` process and may watch the
   opened log; closing the page must stop it before the next test removes the copy (the helper's `rm` retries).
3. **aivision-explorer reflects the whole app**: the root member list changes as Persephone grows. Assert members the
   guides call stable and compare with a `call` made in the same test rather than a hardcoded full list.
4. **The checkout may be missing** on another machine. Tests skip with a reason; they never fail.

## Open items

1. **Carried over:** the EPIC-187 grid row-insertion decision (user's call; its test stays failing); the EPIC-194
   Theme Editor `previewStatus` board bug (its test stays failing).
2. **Uncovered:** claude-agent (see Decisions); Agent Log Viewer's folder session list, sorting, content search and
   daily chart (reachable only through the native folder picker; `folderMasks` is not a folder claim), its
   `showCost` estimate (no call route sets a board setting), subagent drill-down and live tail; AiVision Explorer's
   never-activated-page hint (no call creates an unactivated board page) and Assign.
3. **persephone-boards (read-only here, for the board owner):**
   - `boards/aivision-explorer/CLAUDE.md:50` quotes version `1.0.5` / `minAppVersion` `5.0.3` (manifest: `1.1.0` /
     `5.0.10`), and its Run & test section points at `editor.app`, which the board does not expose.
   - `boards/agent-log-viewer/CLAUDE.md` does not list the record shapes the parsers accept.
   - `boards/claude-agent`: opening it reads the user's real `~/.claude/projects`, resolves the real CLIs from `PATH`
     and stores data in the real `%LOCALAPPDATA%` (see Decisions).
   - No board bug made a test fail.
4. **Proposed (not done):** a test-mode environment sandbox for board processes, which would let claude-agent's offline
   states be tested; `boards.settings(root)` get/set; a test-mode answer for native open dialogs.

## Notes

### 2026-11-18
- Created from the roadmap's Phase 8c after EPIC-194 closed. claude-agent left uncovered (see Decisions).
- Planning: 2 Luna runs in parallel, one correction round each (US-2107: click the tool `summary`, wait for the
  diff and find results; US-2108: no `ui.notify` trigger, page row path from `$describe`, no deep-equal on
  `events.recent`). Implementation: 2 Luna runs plus one follow-up (US-2108 waits and `{ text }` results). The
  `page-activated` trigger the plan settled on is suppressed for agent-initiated switches; Claude replaced it with a
  board-frame `remote-notify`, which exposed the `events.wait` cursor bug.
- Completion skills on Codex (Luna): review found nothing; document updated `scripting.md`, `key-files.md`,
  `integration-tests.md`, `integration-test/README.md`, the ui-tests skill and `boards/files-and-app-access.md`;
  userdoc updated `boards/bridge-integration.md`. typecheck, lint and guides:check pass; no catalog messages changed.
  Task folders deleted at close.
- Full launched run (`--with git,mneme`), 464 tests: **460 passed, 2 failed, 2 skipped** (Tor). Failures: the EPIC-187
  grid decision and the EPIC-194 Theme Editor `previewStatus` board bug. 10 new tests, all others as at EPIC-194.
- The `published-boards` area reran with the same result (60 passed, 1 failed: the Theme Editor board bug).
