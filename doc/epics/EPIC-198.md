# EPIC-198: UI test coverage, phase 9b — services, processes, terminal and proxy

## Status

**Status:** Completed 2026-11-18
**Created:** 2026-11-18

## Overview

Phase 9b of the [UI test coverage roadmap](../reviews/ui-test-roadmap.md), its last phase. It takes what EPIC-196's
split left for 9b: the speech and translation services as Persephone consumes them, the terminal, `app.proc`, the
module service (board service processes) and the proxy/tunnel. Tests go in the existing `capabilities` area,
`integration-test/tests/capabilities/<module>/`, with fixture boards under `fixtures/boards/<module>/`.

The deliverable is the tests plus the bugs they find. New tests use the `app` object style (`ctx.app...`), with
`ctx.call`/`ctx.callText`/`ctx.set`/`ctx.script` only where the stand-in cannot express the call.

## Goals

- Each module has tests for the checklist below that `call` can reach offline; what it cannot reach is listed as
  uncovered, with the reason.
- Nothing touches the internet, a real AI, speech or translation provider, an API key, a real account, Tor, a git
  remote, a real microphone or speaker, or the user's real profile. Model downloads and npm installs from the registry
  count as network and are never triggered.
- Every process a test starts (through `app.proc`, a board service or the terminal launcher) is harmless,
  short-lived and ended by the test.
- A bug in Persephone is fixed here with a `whats-new.md` line; a test never bends to current behavior.
- Every difficulty Codex has driving the app is recorded in [ai-vision-feedback.md](../reviews/ai-vision-feedback.md).

## Non-goals

- Published boards (Phase 8). The speech boards' own engines stay uncovered (EPIC-197).
- Tor (`requires: ["network", "tor"]` stays opt-in, Phase 6b).
- Voice typing through its shortcut (EPIC-196: CDP keys cannot reach the main-process `before-input-event`).

## Decisions

- **Scope survey (Claude, 2026-11-18).**
  - *Speech and translation services:* Persephone consumes `speech.transcribe` (Transcript toolbar, covered in 9a;
    voice typing) and `text.translate` (Monaco Translate text toolbar/dialog, `src/renderer/editors/monaco/contributions/translate/`;
    browser page translation, `BrowserTranslationController.ts`, `BrowserPageTranslationController.ts`; workflow in
    `src/renderer/api/translation/`). It consumes no `speech.synthesize` or `speech.wake`; for those only provider
    discovery through `capabilities` is testable. Tests use an offline fixture provider board (deterministic
    "translation", no engine), as 9a did for `speech.transcribe` (`fixtures/boards/voice/fixture-transcriber`).
  - *Terminal:* there is no embedded terminal. "Open terminal here" runs `terminal.command` through
    `cmd /c start "" /D <dir> <command>` (`src/main/terminal-launcher.ts`, `src/renderer/api/terminal.ts`). A test sets
    `terminal.command` to a fixture `.cmd` that writes a marker file in its working directory and exits, so the window
    closes by itself. The auto-detect path (empty setting) opens a real `pwsh -NoExit` that stays open, so it is
    never triggered.
  - *`app.proc`:* `proc.execute` is in the call tree (`scripting/ai-vision/namespaces/proc.ts`); handles stream
    through `src/main/command-runner.ts`. Commands are `node -e` one-liners or `cmd /c` builtins that end on their own
    or are killed by the test.
  - *Module service:* board service processes (`src/main/module-service/`, `module-service-supervisor.ts`,
    `src/renderer/api/module-service.ts`, `module-service-status.ts`). `boards/bridge` already covers the service
    environment; 9b adds lifecycle (start on demand, status, stop with the last page, crash and restart budget, leases)
    from a fixture board.
  - *Proxy/tunnel:* `app.fetch(url, { proxy })` tunnels through SOCKS5 or HTTP CONNECT
    (`src/renderer/api/proxy-tunnel.ts`, `node-fetch.ts`), and browser profiles can carry a proxied network
    (`src/main/session-proxy.ts`, `browser-default-network`). Tests start their own loopback HTTP CONNECT and SOCKS5
    proxies in the test host (`node:net`, ephemeral ports; tests already start `node:http` servers) and prove that
    requests went through them. Chromium sends loopback hosts direct, so browser-profile tests use a non-resolvable host
    name that only the test proxy maps to the fixture server. The egress-IP lookup (`ipinfo.io`, `freeipapi.com`) is
    internet and is never triggered.
- **One owned run covers it all.** Fake media and the profile-local `%LOCALAPPDATA%` exist only in owned test instances,
  so tests that open a board service or a capture path declare `requires: ["launch"]`.
- **Error codes over `call`.** EPIC-197 left open that a coded error loses its code over `call`
  (`src/main/mcp/tools/call-tools.ts` `toCallResult`). Claude fixes it in this epic (US-2120) if time allows, since the
  service tests here hit the same gap.
- **Split:** four test tasks plan in parallel (US-2116..US-2119); US-2120 is Claude's product change.

## Working model

Same as EPIC-197 (unattended overnight run):

- **Codex cannot run the suite at all.** Codex writes tests from the guides, the source and `$help` text, and checks
  syntax with `node --check`. **Claude runs the tests and triages.**
- **Two Codex sessions per task, both Luna/high:** session A investigates and writes a short task document (deleted
  when the epic closes); Claude reviews it; session B implements from the corrected document.
- Codex never uses the persephone MCP tool or port 7865, never runs `npm start`, `build-prod` or Electron, never
  commits or stages, and never edits `persephone-boards`.
- Every Codex brief asks for an `AI-VISION FEEDBACK` section; Claude appends each case to
  [ai-vision-feedback.md](../reviews/ai-vision-feedback.md), plus every failure caused by a wrong guess about the API.

## Area checklists

### US-2116: Translation and speech services

- An offline fixture `text.translate` provider board registers; `capabilities` lists it; provider discovery for
  `speech.synthesize` from a second fixture provider.
- Monaco Translate text: the toolbar is offered with a provider, the dialog translates a text page through the fixture
  provider, and the result lands where the guide says.
- Browser page translation of a fixture HTTP page through the same provider, and restoring the original.
- A provider that refuses or fails: the user sees the documented error, nothing hangs.

### US-2117: `app.proc` and the terminal

- `proc.execute`: one-shot text and JSON, a non-zero exit code, streaming stdout/stderr, stdin, `cwd` and `env`,
  `shell: false`, a spawn failure, and `kill` of a long-running child.
- "Open terminal here" from the Explorer (or menu-bar folder) with a fixture `.cmd` as `terminal.command`: the marker
  shows the right working directory; an invalid folder reports the documented warning.

### US-2118: Module service

- A fixture board service starts when its page needs it and reports its status. It keeps running after the last page
  closes (as `agents/boards/services.md` documents) until `boards.stopService` stops it. *(Corrected 2026-11-18: the
  first draft said it stops with the last page; Codex's plan caught the conflict with the guide.)*
- A crashing service restarts within its restart budget and stops after it; status and Board Info reflect it.
- Board service settings reach the service; a second page shares one service (lease) where the contract says so.

### US-2119: Proxy and tunnel

- `app.fetch` through a test-local HTTP CONNECT proxy and a SOCKS5 proxy (shorthand, `socks5h://`, credentials);
  an unreachable proxy fails closed; invalid proxy strings report the documented `TypeError`.
- A browser profile with a proxied network loads a fixture page through the test proxy; with the proxy down it fails
  to load instead of going direct.

### US-2120: Error codes over `call` (Claude)

- A coded renderer error keeps its code in the `call` result and in `ctx.call` errors.

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-2116 | Tests: translation and speech services | Done |
| US-2117 | Tests: `app.proc` and terminal | Done |
| US-2118 | Tests: module service | Done |
| US-2119 | Tests: proxy and tunnel | Done |
| US-2120 | Error codes over `call` | Done |

## Results

- **US-2116:** `capabilities/translate` 4 tests and `capabilities/speech` 2 tests, with offline fixture providers
  `fixtures/boards/translate/fixture-translator` (legacy `text.translate` service interface, deterministic
  "Fixture translation: …", installed pairs so no download path is reached) and
  `fixtures/boards/speech/fixture-speech-synthesizer` (`capabilities` form): provider discovery in `capabilities.$help`,
  Monaco Translate text creating a result page, a provider failure shown as a warning with no result page, browser page
  translation of a fixture HTTP page and its restore, and `speech.synthesize` discovery plus agent calls (`stop()`,
  `speak()` rejecting with `error.code === "rejected"`). Triage: the fixture lacked `minBridgeVersion` (open item 1);
  calls while the dialog is open need `{ dialog: true }`; `openUrlInBrowserTab` returns an id; a method path needs `[]`.
- **US-2117:** `capabilities/proc` 6 tests (one-shot text/JSON/bytes, non-zero exit, streaming, stdin/cwd/env/`shell: false`,
  spawn failure, kill with the PID gone) and `capabilities/terminal` 2 tests ("Open Terminal here" from a menu-bar folder
  with a fixture `.cmd` that writes its working directory and exits; the "Not a folder" warning). Triage: the `.cmd`
  needed a plain `exit` (a batch file under `start` keeps its window), a regex escaped outside its template string,
  a call while the popup menu was open, `waitFor`'s return value. No console window was left behind.
- **US-2118:** `capabilities/module-service` 6 tests with fixtures `fixtures/boards/module-service/{round-trip-board,
  settings-board,crash-board}`: lazy start and status, a page channel round trip, the service surviving its last page
  until `stopService`, two pages sharing one service, a declared setting read by the service, and a crashing service
  failing after three exits with Board Info showing it. Triage: the board menu renders outside the page slot.
- **US-2119:** `capabilities/proxy` 8 tests with test-host SOCKS5 and HTTP CONNECT proxies on ephemeral loopback ports:
  `app.fetch` through shorthand, `socks5://` with credentials, `socks5h://` resolving `fixture.invalid` at the proxy,
  HTTP CONNECT with credentials, an unreachable proxy failing closed, the invalid-scheme `TypeError`, and the default
  browser profile loading `http://fixture.invalid/…` through the proxy and failing when it stops. The egress-IP dialog
  is never opened. Triage: a JSON page body read through `evaluate` came back as an object.
- **US-2120 (Claude):** capability errors keep their code over `call`: the agent tree appends `[code: <code>]`
  (`namespaces/capabilities.ts` `agentError`), and the test host sets `error.code` from it (`src/test-host/client.ts`).
  The two EPIC-197 speech-board tests now assert `rejected`. Other namespaces still lose codes inside the `ai-vision`
  package resolver.
- **Also in this commit (orchestrator):** `src/main/stdio-guard.ts`, called from `src/main.ts`, stops the EPIPE
  error dialog when the console that started Persephone has closed.

## Concerns

1. **Real windows and processes.** The terminal test opens a real console window; the fixture `.cmd` must exit on its
   own. `app.proc` children must be killed in `finally`.
2. **Proxy tests must prove routing.** A fetch that succeeds directly looks like a pass; the test proxy counts the
   connections it served.
3. **Service processes outlive pages.** Cleanup must wait for a service to stop before the next test registers the
   same board.

## Open items

1. **Legacy service interfaces ignore board compatibility.** A board with object-form `permissions` and no
   `minBridgeVersion` is incompatible (`version-utils.ts:71-78`), so the capability registry drops its declarations
   (`board-trust-snapshot-builder.ts:140`), but its legacy `serviceInterfaces` still serve host consumers (the Monaco
   Translate toolbar and Transcript used it). One rule should apply to both; `capabilities.$help` gives no hint why a
   provider is missing. The 9a transcriber fixture has the same manifest shape.
2. **Error codes in other namespaces.** US-2120 covers `capabilities[...]`; a coded error from any other namespace
   still loses its code inside the `ai-vision` resolver (`errMessage`). Proposed: carry `code` in the resolver's
   envelope (package change).
3. **Small reach gaps:** the menu-bar folder "Open Terminal here" item has no id; the browser translation popover has no
   `data-name` and its state is not in the call tree; `proc.$help` does not list the handle members; `app.fetch` is
   missing from the app-object guide.
4. **Uncovered:** terminal auto-detection (opens a real `pwsh -NoExit` that stays open); model downloads and real
   translation or speech engines; the egress-IP / proxy info dialog (internet lookup); HTTPS through a proxy; named
   browser profiles with a proxy; Tor (opt-in, Phase 6b); voice typing by shortcut (EPIC-196).
5. **Carried over (baseline failures):** the EPIC-187 grid row-insertion decision, the EPIC-194 Theme Editor board bug,
   the EPIC-197 Audio Player `next()` board bug.

## Notes

### 2026-11-18
- Created after EPIC-197 closed. Scope survey above.
- Planning: 4 Luna runs in parallel. Claude's corrections: US-2116 (speech fixture folder, a coded-error agent-call
  test, where the failure appears, default languages); US-2117 (the warning shows the thrown message); US-2118 (the
  service survives its last page, restart count, failed-reason assertion); US-2119 approved with three notes.
  Implementation: 4 Luna runs plus 1 fix round (translate); Claude fixed six one-line test bugs during triage.
- US-2120 (Claude) landed first; the speech-board tests ran green with the new code assertions.
- New modules: 28 tests, green twice (once alone, once in the full run).
- Full launched run (`--with git,mneme`), 525 tests: **520 passed, 3 failed, 2 skipped** (Tor). The failures are the
  three carried-over items. No product bug found by the new tests.
- Completion skills on Codex (Luna): review found nothing; document updated `integration-tests.md`,
  `integration-test/README.md`, the ui-tests skill, `capabilities.md` and `key-files.md`; userdoc no change.
  19 ai-vision entries. Task folders deleted at close. This was the last roadmap phase.
