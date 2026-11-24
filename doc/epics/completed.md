## EPIC-210 — Web-app test feedback, round 2

Completed 2026-11-24. 14 items from rewriting an external pilot suite (233 tests) on 5.0.22, each checked against the
source and routed to a task (replaces the feedback task US-2185). Runner calls now return whole values unless the test
passes `maxLength`, so failure capture and `storageState()` no longer fail on large replies
(`test-host/model-call-options.ts`, `failure-bundle.ts`). `label=` matches a wrapping label's own text, without the
nested control's text (`automation/page-scripts.ts`). Windows can be named (`windows[i].name`, saved across restarts,
shown in the title; `main/window-names.ts`). `--attach --window name:<n>` selects a named window, and
`--window-name <n>` creates or reuses one and keeps it open. The run prints its test window at start. `ctx.waitFor`
takes `{ retryErrors }`; `waitForDownload()` returns `mimeType` and a redacted `url`; `--summary-only` prints just the
summary, which now names the failing step. Calling a page-model member that isn't listed in `aiVision.members` now
hints at the descriptor list. The guide gaps are filled. The "lost trusted click" (item 11) was reproduced on a fixture.
It is an app-readiness race (the click hit a same-named placeholder button), so it was closed without code changes;
the guides advise waiting for the app to be ready. Completion skills by Codex (Luna). Epic document:
[EPIC-210](EPIC-210.md).

- [x] **Runner reads whole values (US-2186).**
- [x] **`label=` uses the label's own text (US-2187).**
- [x] **Lost trusted click after a re-render (US-2188)** — not a Persephone bug; closed with findings.
- [x] **Named test windows (US-2189).**
- [x] **Runner API gaps: `retryErrors`, download MIME/URL, `--summary-only`, member hint (US-2190).**
- [x] **Web-app test guide gaps, round 2 (US-2191).**

## EPIC-209 — Guides and scaffolding for web-app tests

Completed 2026-11-23. Step 7, the last step, of the [web-app testing review](../reviews/web-app-testing-review.md)
roadmap (G5, G7, H3, H4, H5). A temporary extension's `scriptPath` takes a file, an ordered list or a folder (direct
`.js` files in name order), concatenated into one shared scope with errors mapped to `file:line`
(`editors/browser/temporary-extension-sources.ts`). `--reporter json-lines` writes a versioned JSON event stream to
stdout (`run-start`, `test-start`, `test-end`, `hook-failure`, `run-end`); all human output, test `console.*` and an
owned app's stdout go to stderr (`test-host/json-lines-reporter.ts`). `persephone-test --init <folder>` writes a
generic offline starter suite from `assets/test-suite-template/` (loopback fixture page, two-file model, smoke test,
run script, `AGENTS.md`), refuses a non-empty folder, and starts no window (`main/test-mode/init-suite.ts`). New guide
page `web-app-tests/browser-models-and-playwright.md` (matchers, session pages, test-window scope, Playwright →
Persephone table, model vs test) and a "Test models" section in `temporary-site-extensions.md`; stale `allowNavigation`
and hover help text corrected. Bridge 1.63.0. Completion skills by Codex (Luna). Epic document: [EPIC-209](EPIC-209.md).

- [x] **Page model in several files (US-2176).**
- [x] **`--reporter json-lines` on stdout (US-2177).**
- [x] **`persephone-test --init <folder>` starter suite (US-2178).**
- [x] **Web-app test guides and test-model section (US-2179).**

## EPIC-208 — Input fidelity for web-app tests

Completed 2026-11-22. Step 6 of the [web-app testing review](../reviews/web-app-testing-review.md) roadmap (E2, E3,
E5, G2; US-2138 items 5, 10, 17 and the bridge half of 2) plus two EPIC-207 follow-ups. `hover()` forces CSS `:hover`
on the target and its composed ancestors (CDP `CSS.forcePseudoState` in `automation/hover-pseudo-state.ts`, cleared by
`CSS.disable` at the next pointer action); `click` reveals a hover-hidden target once after a "not visible" result
(`hoverFirst: false` opts out) and the error names `hover()`. Trusted locator clicks wait one frame after the move and
re-resolve a target replaced by a hover handler; browser/board left clicks whose press and release produced no
`click` fail with `click-not-dispatched` naming A → B (`checkClick: false` opts out; `automation/lost-click.ts`).
`mouseDown`/`mouseMove`/`mouseUp`/`wheel` on browser, board and `window.screen` (`automation/pointer-actions.ts`), held
buttons and keys released at test end on `ctx.usePage` pages. A page model stays reachable across a same-document
navigation (no clear on `did-start-loading`; a read during a probe waits up to 250 ms). One native lifecycle listener
per WebContents/event (`onWebContentsGone`); a click whose popup closes on press counts as delivered. Fixed an
EPIC-207 regression that stopped every site/temporary extension from injecting. Bridge 1.62.0. Completion skills by
Codex (Luna). Epic document: [EPIC-208](EPIC-208.md).

- [x] **EPIC-207 follow-ups: destroyed-listener leak, click that closes its popup (US-2171).**
- [x] **`hover()` applies CSS `:hover`; click hovers first (US-2172).**
- [x] **Detect a click that produced no `click` (US-2173).**
- [x] **Low-level pointer members (US-2174).**
- [x] **Page model reachable across a same-document navigation (US-2175).**

## EPIC-207 — Page environment for web-app tests

Completed 2026-11-22. Step 5 of the [web-app testing review](../reviews/web-app-testing-review.md) roadmap (F1–F7;
US-2138 items 3 storage half, 9, 19, 20). Init scripts at document start (`addInitScript`/`removeInitScript`/
`clearInitScripts`, CDP `Page.addScriptToEvaluateOnNewDocument` in `cdp/cdp-init-scripts.ts`, restored after a
debugger reattach). Test powers (`storageState`, `waitForDownload`, `route`, `clipboard`) only on pages the agent
opened or `ctx.usePage` adopted (`agentMayUseBrowserTestPower`, hidden runner members `adoptForTestRun`/
`releaseFromTestRun`). `storageState()` (HttpOnly cookies via `Network.getCookies`, current-origin Web Storage) and
`ctx.openBrowser(url, { storageState })` applied before the first page script; state never reaches runner logs,
reports, bundles or the MCP request log. `storage.set/clear`. `waitForDownload()` saves under an app temp root, the
runner copies into the run folder (realpath-confined) and attaches it. Declarative `route`/`unroute`/`unrouteAll` over
CDP `Fetch` (page-scoped, request stage, last route wins; routed outcomes logged as metadata). Page-scoped
`clipboard.arm/readText/writeText` (page-side recorder, never an OS clipboard read). `clock.install/fastForward/
uninstall` (time keeps flowing). Bridge 1.61.0. Completion skills by Codex (Luna). Epic document:
[EPIC-207](EPIC-207.md).

- [x] **Init scripts at document start (US-2165).**
- [x] **Storage state and storage helpers (US-2166).**
- [x] **Captured downloads (US-2167).**
- [x] **Declarative request routing (US-2168).**
- [x] **Page-scoped clipboard (US-2169).**
- [x] **Fake clock (US-2170).**

## EPIC-206 — Locators for browser automation

Completed 2026-11-22. Step 4 of the [web-app testing review](../reviews/web-app-testing-review.md) roadmap (D0–D5,
G6). Every caller-supplied selector now resolves through one page-side grammar (`resolveCandidates` in
`automation/page-scripts.ts`) and one host entry (`automation/selector-execution.ts`); `fullscreen(selector)` stays
a CSS-only main-process exception. Engines `role=` (role, name and states from Chromium's accessibility tree, so they
agree with the snapshot), `label=`, `placeholder=`, `testid=`, `title=`, `alt=`, `ref=` and the existing `text=`;
`>>` chaining, `nth=N`, `:has-text()`/`:visible` CSS suffixes, and a JSON-safe object form compiled to the same
grammar. Page models get `runtime.ref` (ordinary `e<id>` refs, clicked with trusted input), `visible`,
`accessibleName`, `setValue`, `waitFor`, `afterReturn`. Locator reads `count`, `isVisible`, `isEnabled`,
`isChecked`, `innerText`, `allInnerTexts`, `boundingBox`, bulk `query(locator, { fields })`, and
`waitForFunction`. Bridge 1.60.0. `[include-hidden]` adds nothing in practice (Chromium's AX query omits hidden
nodes). Completion skills by Codex (Luna). Epic document: [EPIC-206](EPIC-206.md).

- [x] **One selector resolution path (US-2160).**
- [x] **Selector engines (US-2161).**
- [x] **Chaining, filters and the object form (US-2162).**
- [x] **Model refs and runtime helpers (US-2163).**
- [x] **Locator read members and waitForFunction (US-2164).**

## EPIC-205 — Test structure for web-app tests

Completed 2026-11-22. Step 3 of the [web-app testing review](../reviews/web-app-testing-review.md) roadmap (B2, B4,
B7, and the `waitFor` message of US-2138 item 24). `ctx.expect.poll(fn, { timeout, interval, message })` takes every
matcher including `.not`; an error from the callback (a member that is not there yet) counts as "not yet", and a
timeout shows the message, the expected side and the last actual value or error. `ctx.waitFor` takes `message`. One
poll loop (`src/test-host/poll.ts`) serves both. Every test attempt is bounded: default 300 000 ms, `--test-timeout
<ms>` (0 = none), per-test `{ timeout }`, all scaled by `--timeout-scale`; a timed-out attempt reports `Test timed out
after N ms; last step: …`, its abandoned body's later calls are refused, and failure capture, `afterEach` and cleanup
still run. Test files can export `beforeAll`, `beforeEach`, `afterEach`, `afterAll`; a failing `beforeAll` is one
located `<beforeAll>` failure and the file's tests are `not-run`. `runner.ts` shrank from 286 to 151 lines
(`test-file-run.ts`, `test-result.ts`, `file-hooks.ts`, `file-hook-run.ts`). Completion skills by Codex (Luna).
Epic document: [EPIC-205](EPIC-205.md).

- [x] **Polling assertions and wait messages (US-2157).**
- [x] **Per-test timeout (US-2158).**
- [x] **File-level hooks (US-2159).**

## EPIC-204 — Test window and session pages for web-app tests

Completed 2026-11-22. Step 2 of the [web-app testing review](../reviews/web-app-testing-review.md) roadmap (A1, A2,
A3, A4, C1, C2). `--attach` opens its own test window (`windows.createTestWindow`, closed and forgotten at run
end) or uses one picked with `--window <index or title>`; every runner and test call is scoped to it by
`src/test-host/test-window.ts`, and `ctx.root` reaches the whole app. Window indexes are allocated
monotonically. Cleanup closes menus and dialogs again, only in the test window. Attention from another window and a
closed or replaced test window are an **environment stop** (exit 3, `not-run` tests, cause in the reports;
runner bookkeeping reads are retried, test calls never replayed). `ctx.usePage({ url, title })` adopts an open,
signed-in page in the test window and never closes it. A failed test captures the pages under test (never the window
in attached runs) and writes a failure bundle (URL, title, page errors, console errors, failed requests; no headers
or bodies, query values redacted). The web-app test guide became a hub with two pages. Completion skills by Codex
(Luna). Epic document: [EPIC-204](EPIC-204.md).

- [x] **Runner test window for attached runs (US-2153).**
- [x] **Attention from other windows: retry, then environment stop (US-2154).**
- [x] **Session pages: `ctx.usePage` (US-2155).**
- [x] **Failure capture of pages under test and failure bundle (US-2156).**

## EPIC-203 — Browser automation fixes for web-app tests

Completed 2026-11-22. Step 1b of the [web-app testing review](../reviews/web-app-testing-review.md) roadmap
(E1, E4, E6, E7, G1, G3, G4, H1, H2, A5). Trusted input scrolls a target inside its own scroll containers before the
hit test and names a clipping container when it stays clipped; `focus(locator)` and `{ focus: "focus" }` on keyboard
calls avoid the click; `drag(source, { by })`, an outside `targetPosition`, `steps` and `holdMs`; `clickAt` / `dragTo`
on browser and board pages. Page-model calls report `page-navigated` (or `{ navigated: true }` with the
`allowNavigation` call option), fail a cut reply with `result-truncated` instead of returning 220 of 365 rows, and keep
key order (the sort came from Chromium's CDP by-value transfer; `evaluate` keeps it, documented). The runner reads
models unbounded by default. Hidden Playwright aliases (`dblclick`, `fill`, `press`, `goto`, …) and one-line
suggestions (`getByRole`, `locator`, `waitForLoadState`, …) through `patches/ai-vision+1.4.0.patch`; an automation
right-click no longer opens Persephone's browser menu unless `nativeMenu: true`. Bridge 1.59.0. **Open:** upstream the
ai-vision patch and drop it; `app.call` in scripts and boards has no `allowNavigation`; `evaluate` key order (roadmap
step 4). Completion skills by Codex (Luna). Epic document: [EPIC-203](EPIC-203.md).

- [x] **Browser input: scroll containers, focus, drag by offset, coordinates (US-2150).**
- [x] **Page-model replies: navigation, truncation, key order (US-2151).**
- [x] **Playwright names, "did you mean", automation right-click (US-2152).**

## EPIC-202 — Web-app test runner fixes

Completed 2026-11-22. Step 1a of the [web-app testing review](../reviews/web-app-testing-review.md) roadmap
(B1, B3, B5, B6, C3, C4, C5), all in `src/test-host/`. `ctx.expect` has the Jest/Playwright matcher set, `.not` and
`expect(value, message)` (`src/test-host/expect.ts`); an unknown matcher lists the supported ones and a stand-in is
refused with "await it first". `test.skip`, `test.only` and `test.fails(name, fn, { reason })`; new statuses
`expected-failure`, `unexpected-pass` (fails the run) and `flaky`; `--retries <n>` (each attempt fully set up and
cleaned, `src/test-host/test-attempt.ts`) and `--grep <regex>`. The runner asks for `hints: "never"`; an unknown member
without a close suggestion adds `List members: ctx.call("<path>.$help")`. Results carry the test file's `file:line`
(`src/test-host/source-location.ts`) and the console ends with a `Summary:` block. **Deviation:** no full member list
in `tests.log` (not available with `hints: "never"`). **Open:** no `--help` in the Rust `persephone-test` launcher;
the integration suite's own `test()` has no modifiers. Completion skills by Codex (Luna). Epic document:
[EPIC-202](EPIC-202.md).

- [x] **Complete the `expect` matcher set (US-2147).**
- [x] **Test modifiers, `--grep` and `--retries` (US-2148).**
- [x] **Short, located failures (US-2149).**

## EPIC-201 — Board data and network isolation

Completed 2026-11-19. Board services get a profile-scoped data folder in `PERSEPHONE_BOARD_DATA`
(`src/main/board-process-environment.ts`, `src/shared/board/board-data-id.ts`). The default profile keeps
`%LOCALAPPDATA%\Persephone\board-data`; named and test profiles use `<userData>\board-data`. Nothing is migrated or deleted.
Translate, Agent Chat and the speech boards use it and fall back on an older Persephone. `network: false` is documented,
not enforced, for services: the permissions guide and the trust dialog now say a service or a started program can use
files and the network. Translate no longer goes online when it opens. Torrent Viewer inspects a `.torrent` offline and
joins the swarm only on open or download. Test instances run board processes in an environment sandbox: profile-local
home, app-data, Claude and Codex config, a system-only `PATH` plus `test-bin\node.cmd`, and no `CLAUDECODE` /
`CLAUDE_CODE_*`. New tests cover Translate, Torrent Viewer and Agent Chat. **Board fix:** Agent Chat's "no CLI" message
could never appear (1.5.1). Boards are on `persephone-boards` `develop` (3f1f573), unpublished: translate 1.0.2,
claude-agent 1.5.1, torrent-viewer 1.11.0, speech-to-text 1.5.1, text-to-speech 1.1.1. **Open:** the Agent Chat
`send` / `messages` / `waitIdle` guide examples were not run live (they need a signed-in CLI); `persephone.execute("cmd.exe
/d /c …")` returns empty output inside a board. Completion skills by Codex (Luna). Epic document: [EPIC-201](EPIC-201.md).

- [x] **Host: profile-scoped data root for board services (US-2132).**
- [x] **Boards use the host data root (US-2133).**
- [x] **Network honesty: `network: false` and services (US-2134).**
- [x] **Torrent Viewer: offline metadata mode (US-2135).**
- [x] **Test mode: environment sandbox for board processes (US-2136).**

## EPIC-200 — Published boards: bugs and documentation found by the UI test roadmap

Completed 2026-11-19. Board fixes in `persephone-boards` (`develop`, 51505fa, unpublished), tracked here.
**Fixed:** Theme Editor `previewStatus.pending` now settles; Audio Player playlist `next()`, plus `previous()` and a
documented light mode without a model; PowerPoint Viewer reports parse errors as `editor.app.error` (partial decks keep
the slides read) instead of an empty deck. **Docs:** five board `CLAUDE.md` / README files corrected; agent guides gained
result examples, 1-based notes and a model-coverage table (also in `published-boards.md`). Sixteen boards got one patch
bump each (listed in the epic). Agent Chat result examples moved to EPIC-201. Completion skills by Codex (Luna). Epic
document: [EPIC-200](EPIC-200.md).

- [x] **Theme Editor: `previewStatus.pending` never settles (US-2127).**
- [x] **Audio Player: playlist `next()`, light-mode model, `previous()` (US-2128).**
- [x] **PowerPoint Viewer: report parse errors instead of an empty deck (US-2129).**
- [x] **Board docs that disagree with the board (US-2130).**
- [x] **Agent guides: result shapes and model coverage (US-2131).**

## EPIC-199 — Agent surface fixes from the ai-vision feedback log

Completed 2026-11-19. Fixes for the agent problems that recurred across the UI test roadmap
([ai-vision-feedback.md](../reviews/ai-vision-feedback.md)). Interactive snapshots name icon buttons and tree rows the way
a user sees them, and menus carry ids. `$help` gives return types and lists every member and option (a
`describe-tables-check` runs in lint). `pressKey` reaches main-process shortcuts (`src/main/cdp-key-input.ts`).
`pages.openFolder` and `pages[id].save()` close two call gaps. Error codes survive `call` in every namespace through
`ai-vision` 1.4.0 (`Error [<code>]: …`; the capability-only `[code: …]` wrapper is gone). The test host keeps strings as
strings (`persephone/resultType`), and `web-app-tests.md` has one section of boundary rules. Guides and `$help` were
swept for the open doc entries. Grid: inserting while sorted or filtered is documented as it works (before the focused
row in file order), closing the EPIC-187 decision. **Open:** a board's `persephone.call()` still drops error codes (needs a
`BOARD_BRIDGE_VERSION` bump); a Ctrl/Alt shortcut followed at once by typing may reach the app out of order.
Final run (dev, 2026-11-19, about 23 minutes), 544 tests: 534 passed, 1 failed, 9 skipped; the failure (a popup navigation wait in `browser/popups`) passed on re-run, 19/19, and no known failures remain. Completion skills by Codex (Luna). Epic document: [EPIC-199](EPIC-199.md).

- [x] **Snapshot names: icon buttons, tree rows, menu ids, missing `data-name`s (US-2121).**
- [x] **`$help` return types and member drift (US-2122).**
- [x] **`pressKey` reaches main-process shortcuts (US-2123).**
- [x] **Call gaps: open a folder, save any page, error codes everywhere (US-2124).**
- [x] **Test host value fidelity and call options (US-2125).**
- [x] **Guide and `$help` sweep for the open doc entries (US-2126).**

## EPIC-198 — UI test coverage, phase 9b: services, processes, terminal and proxy

Completed 2026-11-18. Phase 9b of the [UI test coverage roadmap](../reviews/ui-test-roadmap.md), its last phase: 28 new
tests in `integration-test/tests/capabilities/`: translate (4) and speech (2) with offline fixture providers (Monaco
Translate text, browser page translation and restore, a failing provider, `speech.synthesize` discovery and agent
calls), proc (6: one-shot, streaming, stdin/cwd/env, `shell: false`, spawn failure, kill), terminal (2: "Open Terminal
here" with a fixture `.cmd` that exits, the "Not a folder" warning), module-service (6: lazy start, channel round
trip, surviving the last page, two-page sharing, settings, crash budget and Board Info) and proxy (8: `app.fetch`
through test-host SOCKS5 and HTTP CONNECT proxies, credentials, remote name resolution, fail-closed, a proxied default
browser profile). Codex (Luna) planned and wrote the tests; Claude reviewed, ran and triaged, and recorded 19 cases in
[ai-vision-feedback.md](../reviews/ai-vision-feedback.md). **Fixed:** capability errors keep their code over `call`
(`[code: <code>]` suffix, `error.code` in tests; US-2120); the main process no longer shows an EPIPE dialog when its
console has closed (orchestrator fix, same commit). **Open:** legacy `serviceInterfaces` ignore board compatibility
while the capability registry applies it; codes still lost in other namespaces (`ai-vision` resolver); small reach gaps
(menu-bar terminal item id, translation popover `data-name`, `proc.$help` handle members, `app.fetch` in the
app-object guide); carried over: the EPIC-187 grid decision, the EPIC-194 Theme Editor and EPIC-197 Audio Player board
bugs. **Uncovered:** terminal auto-detection, downloads and real engines, the egress-IP dialog, HTTPS through a proxy,
named proxied profiles, Tor. Final launched run (`--with git,mneme`), 525 tests: 520 passed, 3 failed (the three
carried-over items), 2 skipped (Tor). Completion skills by Codex (Luna). Epic document: [EPIC-198](EPIC-198.md).

- [x] **Tests: translation and speech services (US-2116).**
- [x] **Tests: `app.proc` and terminal (US-2117).**
- [x] **Tests: module service (US-2118).**
- [x] **Tests: proxy and tunnel (US-2119).**
- [x] **Error codes over `call` (US-2120).**

## EPIC-197 — UI test coverage, phase 8d: published audio and speech boards

Completed 2026-11-18. Phase 8d of the [UI test coverage roadmap](../reviews/ui-test-roadmap.md): 19 new tests.
**Added:** test instances get a profile-local `%LOCALAPPDATA%` (`src/main/test-mode/local-app-data.ts`, set before any
child process starts), so the Speech to Text, Text to Speech and Wake Word services keep their data in the test
profile; a guard test checks a board service sees it. `--open`/attach instances are not test instances, so every test
here requires `launch`. Tests in `integration-test/tests/published-boards/`: audio-player (4, synthetic WAVs, an
`.m3u` and a catalog written at test start), speech-to-text (6) and text-to-speech (4) in their not-installed state
(no download is ever clicked), wake-word (4, the fake microphone's synthetic signal is rejected and nothing is stored).
Codex (Luna) planned and wrote the tests; Claude reviewed, ran and triaged, and recorded 10 cases in
[ai-vision-feedback.md](../reviews/ai-vision-feedback.md). **Fixed:** boolean and folder board settings had no
`data-name="board-setting-<id>"`. **Open:** Audio Player board bug (`editor.app.next()` replaces an imported playlist
with a one-item source queue, `audio-player/ai-vision.js:222`, `app.js:122-131`; its test stays failing); coded errors
lose their code over `call` (`call-tools.ts` `toCallResult`); board doc notes for the owner (wake-word README's
loudness gate, Audio Player light mode has no model); carried over: the EPIC-187 grid decision and the EPIC-194 Theme
Editor board bug. **Uncovered:** transcription, synthesis and wake detection (model downloads, real speech), installs,
Audio Player folder import, catalog edits and PLS. Final launched run (`--with git,mneme`), 497 tests: 492 passed,
3 failed (the three open board/decision items), 2 skipped (Tor). Next: Phase 9b, the last phase. Completion skills by
Codex (Luna). Epic document: [EPIC-197](EPIC-197.md).

- [x] **Profile-local `%LOCALAPPDATA%` in test instances (US-2112).**
- [x] **Tests: Audio Player (US-2113).**
- [x] **Tests: Speech to Text, Text to Speech (US-2114).**
- [x] **Tests: Wake Word (US-2115).**

## EPIC-196 — UI test coverage, phase 9a: audio capture source, audio and voice typing

Completed 2026-11-18. Phase 9a of the [UI test coverage roadmap](../reviews/ui-test-roadmap.md); Phase 9 was split,
and 9b keeps the speech and translation services, the terminal, `app.proc`, the module service and the proxy/tunnel.
**Added:** a file-backed capture source for test instances. `src/main/test-mode/media-capture.ts` turns on Chromium's
fake media device and `mute-audio` in every test instance, and the suite feeds the fake microphone a generated WAV
(`PERSEPHONE_TEST_AUDIO_CAPTURE_FILE`, owned launches only). Probes showed the fake device also replaces Windows
loopback, so no test reads a real microphone, speaker or system mix; capture tests require `launch`, so attach never
runs them. 14 new tests in the new `capabilities` area: `audio@1` capture (default, raw, shared consumers, computer
capture, `cancelComputerAudio`), playback, rejected input, the mute lease and header indicators (11), window recording
(1), and the Transcript toolbar with an offline `speech.transcribe` fixture provider (2). Board test helpers moved to
`tests/helpers/boards.mjs`. Codex (Luna) planned and wrote the tests; Claude reviewed, ran and triaged, and recorded
11 cases in [ai-vision-feedback.md](../reviews/ai-vision-feedback.md). **Fixed:** `agents/audio.md` said every capture
chunk is 6,400 bytes; a discontinuity flushes a shorter one. No product bug found. **Open:** the EPIC-187 grid decision
and the EPIC-194 Theme Editor board bug (carried over). **Uncovered:** voice typing through its shortcut (CDP keys from
`window.screen.pressKey` never reach the main-process `before-input-event`; delivering them through
`webContents.sendInputEvent` is proposed), its overlay and missing-provider alert; Transcript's computer and Both
modes; recording pause/resume and page regions. Final launched run (`--with git,mneme`), 478 tests: 474 passed,
2 failed (both carried over), 2 skipped (Tor). Next: Phase 9b or Phase 8d. Completion skills by Codex (Luna). Epic
document: [EPIC-196](EPIC-196.md).

- [x] **File-backed capture source, test mode (US-2109).**
- [x] **Tests: `audio@1`, global mute, window recording (US-2110).**
- [x] **Tests: voice typing / Transcript (US-2111).**

## EPIC-195 — UI test coverage, phase 8c: published agent tools

Completed 2026-11-18. Phase 8c of the [UI test coverage roadmap](../reviews/ui-test-roadmap.md): 10 new tests in
`integration-test/tests/published-boards/` for agent-log-viewer (3, from synthetic Claude Code and Codex logs written at
test start) and aivision-explorer (7, each display checked against the same `call`). Codex (Luna) planned and wrote the
tests blind; Claude reviewed, ran and triaged, and recorded 15 cases in
[ai-vision-feedback.md](../reviews/ai-vision-feedback.md). **Test support:** the published-board copy skips git-ignored
runtime files (`ui.log`, Agent Log Viewer's `cache/`), which hold data from the user's own sessions. **Fixed:** a
board's `persephone.call("events.wait")` started at cursor 0 on every call and returned the oldest retained event, so a
board's live event feed never saw a new one; each board frame now keeps its own cursor. **Open:** the EPIC-187 grid
row-insertion decision; the EPIC-194 Theme Editor board bug; `persephone-boards` doc defects for the board owner
(aivision-explorer `CLAUDE.md` versions and `editor.app` note, agent-log-viewer record shapes). **Uncovered:**
claude-agent (opening it reads the user's real `~/.claude/projects`, resolves the real CLIs from `PATH` and stores data
in the real `%LOCALAPPDATA%`; a test-mode environment sandbox for board processes is proposed); Agent Log Viewer's
folder session list (native picker only) and cost setting (no call route sets a board setting); the Explorer's
never-activated-page hint. Final launched run (`--with git,mneme`), 464 tests: 460 passed, 2 failed (both carried
over), 2 skipped (Tor). Phase 8d (audio and speech) is next. Completion skills by Codex (Luna). Epic document:
[EPIC-195](EPIC-195.md).

- [x] **Copy filter; tests: Agent Log Viewer (US-2107).**
- [x] **Tests: AiVision Explorer (US-2108).**

## EPIC-194 — UI test coverage, phase 8b: published apps

Completed 2026-11-18. Phase 8b of the [UI test coverage roadmap](../reviews/ui-test-roadmap.md): 21 new tests in
`integration-test/tests/published-boards/` for six app boards of the `persephone-boards` checkout (todo, notebook,
force-graph, theme-editor, chess, gem-keep). File boards open through `openPublishedSample`; boards without a file type
through the new area helper `openPublishedBoard`. Samples are synthetic (committed Todo and Notebook files, graphs
written at test start). Codex (Luna) planned and wrote the tests blind; Claude reviewed, ran and triaged, and recorded
13 cases in [ai-vision-feedback.md](../reviews/ai-vision-feedback.md). **Call gap closed:** the test `ctx` could not
assign a writable property; `ctx.set(path, value)` sends the assignment, and assigning through `ctx.app` now throws.
**Fixed:** `call` reported any result object with `pending: true` (a board model's status) as a still-running script,
so it could not be read. **Open:** the EPIC-187 grid row-insertion decision; `persephone-boards` defects for the board
owner (theme-editor `previewStatus.pending` never settles, `theme-editor/app.js:1283-1312`, its test stays failing;
notebook `CLAUDE.md` calls the implemented `nav.js` a placeholder; translate goes online on open and stores data in
the real `%LOCALAPPDATA%`). **Uncovered:** Translate (network and user data folder), plus drag-and-drop, native file
dialogs, canvas interaction and timing-dependent gameplay. Final launched run (`--with git,mneme`), 454 tests: 450
passed, 2 failed (grid decision, theme-editor board bug), 2 skipped (Tor); the area reran with the same result. Phase
8c (agent tools) is next. Completion skills by Codex (Luna). Epic document: [EPIC-194](EPIC-194.md).

- [x] **Tests: Todo, Notebook (US-2104).**
- [x] **Helper; tests: Force Graph, Theme Editor (US-2105).**
- [x] **Tests: Chess, Gem Keep (US-2106).**

## EPIC-193 — UI test coverage, phase 8a: published document viewers

Completed 2026-11-18. Phase 8a of the [UI test coverage roadmap](../reviews/ui-test-roadmap.md): 30 new tests in
`integration-test/tests/published-boards/` for nine boards of the `persephone-boards` checkout (pdf, drawio, word,
excel, powerpoint, font, pe, cert, sqlite viewers), registered with EPIC-192's helper and opened through
`pages.openFile` by the area helper `openPublishedSample`. Every sample is synthetic: PDF, Office ZIP packages and a
PE32+ image are built at test start; a generated SQLite database, a two-page `.drawio`, a self-signed certificate with a
fake subject and the MIT-licensed KaTeX Main font are committed. Codex (Luna) planned and wrote the tests blind;
Claude reviewed, ran and triaged, and recorded 10 cases in [ai-vision-feedback.md](../reviews/ai-vision-feedback.md).
**Fixed:** the intermittent EPIC-185 env-vars test had two product causes: the Environment Variables editor lost the
last edit on close + Save (pending serialize now flushed in `confirmRelease`, as in LinkEditor), and trusted clicks did
not scroll an element clipped by a scrolling panel (`automation/locator.ts`). The published-board copy's `rm` retries
while a closed board's process releases its files. **Open:** the EPIC-187 grid row-insertion decision; four
`persephone-boards` doc/UI defects for the board owner (pdf-viewer priority note, torrent-viewer DHT wording,
powerpoint-viewer silent parse failure, pe-viewer plural); an occasional app launch that never reaches MCP.
**Uncovered:** Torrent Viewer (opening starts DHT discovery), plus each viewer's secondary formats and exports. Final
launched run (`--with git,mneme`), 433 tests: 430 passed, 1 failed (grid decision), 2 skipped (Tor). Phase 8b (apps) is
next. Completion skills by Codex (Luna). Epic document: [EPIC-193](EPIC-193.md).

- [x] **Area helper; tests: PDF Viewer, draw.io Viewer (US-2100).**
- [x] **Tests: Word, Excel, PowerPoint viewers (US-2101).**
- [x] **Tests: Font, PE, Certificate viewers (US-2102).**
- [x] **Tests: SQLite Viewer, Torrent Viewer (US-2103).**

## EPIC-192 — UI test coverage, phase 7b: published-board helper, fake catalog, Excalidraw, REST Client

Completed 2026-11-18. Second half of Phase 7 of the [UI test coverage roadmap](../reviews/ui-test-roadmap.md): 26 new
tests in `integration-test/tests/boards/` (`catalog`, `excalidraw`, `rest-client`, `published`); the suite is 403
tests. Codex (Luna) planned and wrote the tests blind; Claude reviewed, ran and triaged, and recorded 15 cases in
[ai-vision-feedback.md](../reviews/ai-vision-feedback.md). **Runner and test support:** a fake published-boards
catalog on the fixture server (`/boards-catalog/`, ZIP archives built at start from `fixtures/boards-catalog/`), read
only by a test instance through `PERSEPHONE_TEST_BOARDS_CATALOG_URL` (loopback only, fail closed); a `/refused` route;
the published-board helper `tests/helpers/published-boards.mjs` with an automatic `published-board-checkout`
requirement that skips with the expected path when `../persephone-boards` is missing. **Fixed:** board automation
during a reload (EPIC-191 open item): `reload()` no longer needs the old frame, frame calls wait for a loading frame,
and a call whose frame is replaced retries once on the new one; the `$help` of a capability `open` method now shows
the `{ pageId?, result }` envelope. The intermittent HTML "Show Resources" test waits for the rendered collection.
**Open:** the EPIC-187 grid row-insertion decision; the intermittent EPIC-185 env-vars test. **Uncovered:** the
catalog's automatic refresh, download cancel, catalog transport failures, the update busy refusal, the Excalidraw
library setting, malformed REST Client collections, cancellation and TLS. Final launched run (`--with git,mneme`): 399
passed, 2 failed, 2 skipped. Phase 8a (published document viewers) is next. Completion skills by Codex (Luna). Epic
document: [EPIC-192](EPIC-192.md).

- [x] **Catalog test support and the published-board helper (US-2095).**
- [x] **Catalog install, update and roll back (US-2096).**
- [x] **Excalidraw (US-2097).**
- [x] **REST Client (US-2098).**
- [x] **Board automation waits for a loading frame (US-2099).**

## EPIC-191 — UI test coverage, phase 7a: board platform (lifecycle, permissions, Board Info, bridge, extensions)

Completed 2026-11-18. First half of Phase 7 of the [UI test coverage roadmap](../reviews/ui-test-roadmap.md): 52 new
tests in the new `integration-test/tests/boards/` area (`lifecycle`, `permissions`, `info`, `bridge`,
`extensions`) with the area helper `tests/boards/helpers.mjs` and fixture boards under
`integration-test/fixtures/boards/<module>/` (one board per folder, trusted through the real dialog); the suite is 377
tests. Codex (Luna) planned and wrote the tests blind; Claude reviewed, ran and triaged, and recorded 21 cases in
[ai-vision-feedback.md](../reviews/ai-vision-feedback.md). **Fixed:** `boards.openBoard` opened a second tab for an
open board; a Demo-template board lost its author on a fresh profile, so its settings were rejected; the product test
host failed any step whose string result began with `Error: `. **Call gap closed:** `boards.requestService` /
`startService` / `stopService`. **Guide fixes:** `createBoard`/`openBoard` return shapes, the starter `app.js`, the
`createShortcut` summary. **Open:** the EPIC-187 grid decision; the intermittent EPIC-185 env-vars test (investigated,
not fixed); board automation during a reload rejects or blocks instead of waiting for the frame. **Uncovered:** device
permissions, clipboard read and notifications (feature policies), `openExternal` refusal, native Save dialog, board
window OS focus. Phase 7b (published-board registration helper, fake catalog install, Excalidraw, REST Client) is
next. Final launched run (`--with git,mneme`): 372 passed, 3 failed, 2 skipped; the one new failure was fixed
afterwards and the `boards` area reran green (52 passed). Completion skills by Codex (Luna). Epic document:
[EPIC-191](EPIC-191.md).

- [x] **Board lifecycle (US-2091).**
- [x] **Permissions and Board Info (US-2092).**
- [x] **Bridge (US-2093).**
- [x] **Board extensions (US-2094).**

## EPIC-190 — UI test coverage, phase 6b: browser automation, page models, site extensions, page tools, Tor

Completed 2026-11-18. Second half of Phase 6 of the [UI test coverage roadmap](../reviews/ui-test-roadmap.md): 63 new
tests in `integration-test/tests/browser/` (`automation/input`, `automation/observe`, `page-models`, `site-extensions`,
`page-tools`, `tor`); the `editors/browser` pop-up and temporary-extension tests moved into the `browser` area; the
suite is 325 tests. Codex (Luna) planned and wrote the tests blind; Claude reviewed, ran and triaged, and recorded 25
cases in [ai-vision-feedback.md](../reviews/ai-vision-feedback.md). **Runner:** an HTTPS fixture server
(127.0.0.1:17868, committed test-only certificate, `ctx.httpsUrl`), trusted only by test instances through
`PERSEPHONE_TEST_TRUSTED_CERTIFICATES`; the seed sets `link-open-behavior` to `internal-browser`, so tests never open
the OS browser. **Fixed:** `getText`/`getValue`/`getAttribute`/`getHtml`/`exists` were missing from the browser
editor's call tree; `keyDown()` modifiers were forgotten by the next `pressKey()`; text typed right after opening a page
could land in the URL bar (late URL-bar focus); a site action `url` result opening a new tab reported `not-current`.
**Call gap closed:** `waitForURL`/`waitForResponse` accept `{ regex, flags? }`. **EPIC-189 open item closed:** the
bookmarks "bug" was a test reading hidden pooled tree rows. **Open:** the EPIC-187 grid row-insertion decision; the
EPIC-185 env-vars test failed again (intermittent: Settings panel covers the button). **Uncovered:** browser screenshot
results, `window.prompt()` (unavailable in Electron pages), the certificate viewer itself (Phase 8a), cinema mode in
nested frames, Tor through the network (`--with network,tor` plus `PERSEPHONE_TEST_TOR_EXE`). Final launched run
(`--with git,mneme`): 320 passed, 3 failed, 2 skipped; the one new failure (the Ctrl+L test had relied on the URL-bar
focus bug) was fixed afterwards and the browser area rerun green (112 passed, 2 skipped). Completion skills by Codex (Luna). Epic
document: [EPIC-190](EPIC-190.md).

- [x] **HTTPS fixture server and test-instance certificate trust (US-2083).**
- [x] **Move the `editors/browser` tests into the `browser` area (US-2084).**
- [x] **Bookmarks drawer keeps a deleted bookmark: a test bug (US-2085).**
- [x] **Automation input and queries (US-2086).**
- [x] **Automation waits, diagnostics, dialogs and viewport (US-2087).**
- [x] **Page models and WebMCP (US-2088).**
- [x] **Saved site extensions (US-2089).**
- [x] **Certificate view, Show Resources, cinema mode, fullscreen, Tor (US-2090).**

## EPIC-189 — UI test coverage, phase 6a: Browser page

Completed 2026-11-18. First half of Phase 6 of the [UI test coverage roadmap](../reviews/ui-test-roadmap.md): 21 new
tests in the new `integration-test/tests/browser/` area (`navigation`, `tabs`, `profiles`, `downloads`,
`permissions`), all against the runner's fixture server, with a shared `tests/browser/helpers.mjs`; the suite is 262
tests. Codex (Luna) planned and wrote the tests blind; Claude reviewed, ran and triaged, and recorded 26 cases in
[ai-vision-feedback.md](../reviews/ai-vision-feedback.md). **Fixed:** `pages[i].editor.reload()` resolved before the
page reloaded and stopped a loading page (EPIC-186 open item); a finished download kept a stale byte count; the
downloads popup rebuilt its rows on every progress event, so a Cancel click could be lost; the Link editor's Tags and
Hostnames lists kept a deleted link. **Runner/app test support:** the fixture server serves real content types and a
`/download` route; a test instance saves downloads to `<profile>/test-downloads` without the Save dialog. **Guide
fixes:** URL-bar suggestions, browser shortcuts not reachable from `pressKey`. **Open:** the bookmarks drawer's
Collections tree keeps a deleted link (test stays failing); the EPIC-187 grid row-insertion decision. **Uncovered:**
keyboard page zoom, search-query filtering and engine URLs (internet), Open in Windows Default App and Show in Folder,
camera and microphone. Phase 6b (automation, site extensions, certificate, Show Resources, cinema mode, Tor) is next.
Final launched run (`--with git,mneme`): 259 passed, 2 failed, 1 skipped. Completion skills by Codex (Luna). Epic
document: [EPIC-189](EPIC-189.md).

- [x] **Browser `reload()` waits for the reloaded page (US-2076).**
- [x] **HTTP fixture server: content types and downloads (US-2077).**
- [x] **Navigation and the URL bar (US-2078).**
- [x] **Inner browser tabs and page zoom (US-2079).**
- [x] **Profiles, Incognito and bookmarks (US-2080).**
- [x] **Downloads (US-2081).**
- [x] **Site permissions and blocked pop-ups (US-2082).**

## EPIC-188 — UI test coverage, phase 5b: clipboard, MCP inspector, Folder View, agent tools, Git, Mneme

Completed 2026-11-18. Second half of Phase 5 of the [UI test coverage roadmap](../reviews/ui-test-roadmap.md): 20 new
tests in `integration-test/tests/tools/` (`clipboard`, `mcp-inspector`, `agent-tools`, `git` with `requires: ["git"]`,
`mneme` with `requires: ["mneme"]`) and `integration-test/tests/editors/folder/`; the suite is 241 tests. Codex (Luna)
planned and wrote every test blind; Claude reviewed, ran and triaged, and recorded 24 cases in
[ai-vision-feedback.md](../reviews/ai-vision-feedback.md). **Runner fix (EPIC-187 leftover):** per-test cleanup now
discards a test's own unsaved pages, dismisses a leftover renderer dialog or popup menu (failing the test that left it),
and closes editorless workspace pages, so one stray dialog no longer fails the rest of a module. **App bug fixed:**
stopping Mneme while its page loaded the status showed "Mneme status failed: Connection closed". **Guide fix:**
`folder.md` says a subfolder inherits its parent's layout. **Open:** the EPIC-187 grid row-insertion decision and the
EPIC-185 env-vars failure are carried over. **Uncovered:** Git Pull/Push and remembered layout, Mneme vector/hybrid
search and model download, Mneme's native Add root picker. Final launched run (`--with git,mneme`): 238 passed, 2
failed, 1 skipped. Completion skills by Codex (Luna). Epic document: [EPIC-188](EPIC-188.md).

- [x] **Runner cleanup answers a stray "Unsaved Changes" dialog (US-2069).**
- [x] **Clipboard history (US-2070).**
- [x] **MCP Inspector (US-2071).**
- [x] **Folder View (US-2072).**
- [x] **Agent tools and toolset editor (US-2073).**
- [x] **Git Tree (US-2074).**
- [x] **Mneme (US-2075).**

## EPIC-187 — UI test coverage, phase 5a: Grid, Settings, Tools hub, About

Completed 2026-11-18. First half of Phase 5 of the [UI test coverage roadmap](../reviews/ui-test-roadmap.md): 33 new
tests, 16 in `integration-test/tests/editors/grid/` and 17 in the new `tools` area (`settings-page`, `tools-hub`,
`guides`); the suite is 221 tests. First coverage epic on the product runner: Codex (Luna) planned and wrote every test
blind (it cannot start the app), Claude ran and triaged, and every wrong guess about the API went into
[ai-vision-feedback.md](../reviews/ai-vision-feedback.md) (21 entries). **App bugs fixed:** every app-window highlight
failed because the CSP blocked the overlay's inline script; the Settings scroll-spy stopped following the scroll after
a scroll made while a Content tree jump settled; a JSONL file with a bad line showed a partial table (an edit would
have dropped the rest of the file); a mouse pick in Edit Columns' filter-type list closed the popup. **Runner fix:**
the test app fetched the published-boards catalog from GitHub at every start; the seed now keeps it offline.
**Open:** the guide says sorting or filtering disables grid row insertion, but the editor always allows it (test stays
failing); runner cleanup does not answer a stray "Unsaved Changes" dialog, so one can fail the rest of a module; the
EPIC-185 env-vars failure is carried over. **Uncovered:** grid column drag, populated Search boards filtering, F1's
fallback to the contents. Final launched run (`--with git`): 218 passed, 2 failed, 1 skipped. Completion skills by
Codex (Luna). Epic document: [EPIC-187](EPIC-187.md).

- [x] **Grid editor (US-2065).**
- [x] **Settings page (US-2066).**
- [x] **Tools & Editors hub (US-2067).**
- [x] **About page and guides (US-2068).**

## EPIC-186 — Persephone test runner for web applications

Completed 2026-11-18. `persephone.exe --test <file|folder>` (and the console wrapper `persephone-test.exe`) runs
`.test.mjs` regression checks against the user's own web apps without an LLM: a windowless controller starts a test
host utility process, which launches an owned app instance (or attaches with `--attach`) and drives it over MCP. Tests
use an `app` stand-in that maps property chains to `call` paths, `ctx.openBrowser` with a logged-in browser profile,
per-test cleanup of pages and pop-ups, `report.md|json`, `last-failed.json` / `--rerun-failed`, failure screenshots,
and JSON Lines logs (`tests.log`, `app-main.log`, `app-console.log`, `site-console.log`, `network.log`; no headers or
bodies). Agent guide: `guides/agents/web-app-tests.md`. **Proof:** the 188-test integration suite moved onto the
product runner (`integration-test/run.mjs` is now a wrapper with `--test-setup`, `--test-selection`, `--with`,
`--baseline`) and was rewritten to the `app` object; the final owned run matched the baseline exactly (185 passed, the
known EPIC-185 env-vars failure, 2 opt-in skips). The packaged `--app` target passed smoke and all startup tests.
**App fixes found by the suite:** clicks right after a sidebar panel expands could hit the neighbouring row (actionability
now needs two stable frames); the reported failing step is the step that threw, not a later cleanup step.
**Open:** browser `reload()` resolves before the navigation commits, so a site-extension test can race on fast builds;
the `app` stand-in cannot pass call options (`{ dialog: true }`, `maxLength`), so about 150 test calls keep `ctx.call`;
`--prod` was not run (needs the dev server stopped). Completion skills by Codex (Luna). Epic document:
[EPIC-186](EPIC-186.md).

- [x] **`--test` controller mode (US-2056).**
- [x] **`app` object over `call` paths (US-2057).**
- [x] **Test helpers, results and logs options (US-2058).**
- [x] **Test-mode console and network logs (US-2059).**
- [x] **Agent guide for web-app tests (US-2060).**
- [x] **Integration suite on the product runner (US-2061).**
- [x] **Rewrite `core` and `sidebar` tests (US-2062).**
- [x] **Rewrite `shell` tests (US-2063).**
- [x] **Rewrite `editors` tests (US-2064).**

## EPIC-185 — UI test coverage, phase 4b: viewer editors

Completed 2026-11-17. Second half of Phase 4 of the [UI test coverage roadmap](../reviews/ui-test-roadmap.md): 34 new
tests under `integration-test/tests/editors/` (HTML and SVG preview, Image Viewer, Log View, Link editor, Environment
Variables editor, Video Player); the suite is 158 tests. **Two app bugs fixed:** `openLinks` opened an `Empty` tab
because it never made the Link editor the page's main editor (Show Resources, `app.pages.openLinks`, site-extension
link lists, multi-file drops). A Link editor change made within the 300 ms serialize debounce was lost on close or
editor switch. **Guide fix:** `video.md` now says Open in VLC appears whenever playback fails. Tests generate their own
PNG and WAV files; the only committed binaries are a 74-byte PNG and a 16 KB WAV under `fixtures/http/`. Env-vars tests
point `board-vars.file` at a fixture store and restore it. **Uncovered:** HLS playback (no encoder), Image Save original
and Save as PNG (native dialog only), clipboard contents. Same working model as EPIC-184; completion skills by Codex
(Luna). Epic document: [EPIC-185](EPIC-185.md).

- [x] **HTML and SVG preview (US-2048).**
- [x] **Image Viewer (US-2049).**
- [x] **Log View (US-2050).**
- [x] **Link editor (US-2051).**
- [x] **Environment Variables editor (US-2052).**
- [x] **Video Player (US-2053).**

## EPIC-184 — UI test coverage, phase 4a: text and document editors

Completed 2026-11-17. First half of Phase 4 of the [UI test coverage roadmap](../reviews/ui-test-roadmap.md): 26 new
tests under `integration-test/tests/editors/` (Monaco editing, Markdown preview, Mermaid, compare mode and Git diff,
editor switching), with the area helper in `tests/editors/helpers.mjs`; the suite is 124 tests. **No app bugs found.**
Claude's checks corrected test errors instead: undo back to the saved text keeps `modified` by design, and redo is
`Ctrl+Shift+Z` because `Ctrl+Y` is Delete Line. They also tightened weak assertions. The Git diff test builds its own
repository inside its fixture folder and runs only with `--with git`. **Uncovered:** Mermaid copy-to-clipboard
contents (the call completes; the clipboard image is not read back). The viewer editors follow in phase 4b. Same working
model as EPIC-183; completion skills by Codex (Luna). Epic document: [EPIC-184](EPIC-184.md).

- [x] **Text editor (US-2043).**
- [x] **Markdown preview (US-2044).**
- [x] **Mermaid (US-2045).**
- [x] **Compare and Git diff (US-2046).**
- [x] **Editor switching (US-2047).**

## EPIC-183 — UI test coverage, phase 3: page sidebar and Explorer

Completed 2026-11-17. Phase 3 of the [UI test coverage roadmap](../reviews/ui-test-roadmap.md): 16 new tests under
`integration-test/tests/sidebar/` (Explorer, Search, Open Tabs / Recent Files / Script Library / Tools & Editors /
Boards / Clipboard panels, external file watching and zip archives) with shared helpers in
`tests/helpers/sidebar-helpers.mjs`; the suite is 103 tests. **App bugs found and fixed:** `window.screen.drag` on an
Explorer file row froze the app (the row handed the drag to the native `webContents.startDrag`, whose modal loop blocks
the main process until a real mouse release; app-window drags now fail fast with a clear error, and the tree and the
file-drag handoff respect `defaultPrevented`); the Open Tabs list stopped showing new pages (it mutated one props object
in place, so `ListBoxModel.update` saw no change; it now passes a fresh object). **Dev-tooling fix:** the Vite watcher
held handles on test folders, leaving renamed-then-deleted folders "delete pending" (EPERM on profile reset);
`vite.renderer.config.ts` now ignores `integration-test/**`. **Uncovered:** drag-drop between Explorer folders (no
synthetic drag in the app window), closing a page from Open Tabs (no close action). Same working model as EPIC-182;
completion skills by Codex (Luna). Epic document: [EPIC-183](EPIC-183.md).

- [x] **Explorer panel (US-2039).**
- [x] **Search panel (US-2040).**
- [x] **Other sidebar panels (US-2041).**
- [x] **Watching and archives (US-2042).**

