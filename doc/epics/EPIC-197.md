# EPIC-197: UI test coverage, phase 8d — published audio and speech boards

## Status

**Status:** Completed 2026-11-18
**Created:** 2026-11-18

## Overview

Phase 8d of the [UI test coverage roadmap](../reviews/ui-test-roadmap.md): the audio and speech boards of the separate
`persephone-boards` repository — audio-player, speech-to-text, text-to-speech and wake-word. It builds on EPIC-196's
file-backed capture source (Chromium's fake media device fed from a generated WAV, owned test instances only) and on
the published-board helpers (`tests/helpers/published-boards.mjs`, `tests/published-boards/helpers.mjs`).

The deliverable is the tests plus the bugs they find. New tests use the `app` object style
(`ctx.app.pages[id].editor.…`, `ctx.app.boards.…`), with `ctx.call`/`ctx.callText`/`ctx.set` only where the stand-in
cannot express the call. Tests live in `integration-test/tests/published-boards/<board-id>/`.

## Goals

- Each board has tests for the checklist below that `call` can reach offline; what it cannot reach is listed as
  uncovered, with the reason.
- No test touches the network, a model download, a real AI or speech provider, a real microphone or speaker, the
  user's profile or the user's real `%LOCALAPPDATA%`. All audio is synthetic.
- A bug in a published board is recorded as an open item (file and line) and its test stays failing; the
  `persephone-boards` checkout is read-only. A bug in Persephone is fixed here with a `whats-new.md` line.
- Every difficulty Codex has driving the boards is recorded in [ai-vision-feedback.md](../reviews/ai-vision-feedback.md).

## Non-goals

- Phase 9b (the speech and translation services as app capabilities, terminal, `app.proc`, module service, proxy).
- Installing whisper.cpp, Supertonic or any model: every install path downloads, so it is network.
- Editing or committing anything in `persephone-boards`.

## Decisions

- **Test instances get a profile-local `%LOCALAPPDATA%` (2026-11-18).** speech-to-text, text-to-speech and wake-word
  keep runtimes, models and enrollments under `%LOCALAPPDATA%\Persephone\board-data\<board>`
  (`speech-to-text/scripts/downloads.mjs:27-29`, `text-to-speech/scripts/downloads.mjs:29-31`,
  `wake-word/scripts/enrollments.mjs:7-11`), and their services read it as soon as the board opens. Instead of leaving
  three of the four boards uncovered (as translate and claude-agent were), test mode now redirects it, which EPIC-195
  proposed. Owner: `src/main/test-mode/local-app-data.ts`, called from `setupMainProcess` before any child process
  starts, only when `isTestInstance()`. It sets the main process's `LOCALAPPDATA` to
  `<userData>/test-local-app-data`, so every spawner inherits it (board services build their environment from
  `process.env`, `module-service/process.ts` `buildServiceEnvironment`). Probed before any board was opened: in an
  owned test instance both the main process and the renderer report the profile folder. `USERPROFILE` and `APPDATA`
  are unchanged (no board in this phase reads them). A guard test checks that a board service sees the profile folder.
- **`--open` and `--attach` instances are not test instances** (the runner starts `--open` without `--test-instance`),
  so they keep the real `%LOCALAPPDATA%`, a real microphone and real speakers. Every test in this epic therefore
  declares `requires: ["launch", "published-board-checkout"]`, and triage never opens these boards in an `--open`
  instance.
- **No model is installed.** With the sandbox, speech-to-text and text-to-speech start with nothing installed. Their
  Install and Download buttons fetch from GitHub, Hugging Face and npm, so tests never click them. Covered: the board
  renders its not-installed state, the provider capability is registered and answers `describe`, and a request without
  an engine fails with the documented error instead of hanging. Transcription and synthesis themselves are uncovered.
- **Wake-word ships its models** (`model/`, vendored ONNX Runtime Web), so its engine runs offline. The board notes say
  Silero VAD rejects synthetic audio, so positive enrollment and detection cannot be tested with the fixture WAV; the
  tests cover what the synthetic signal can reach (empty enrollments, describe/list/delete, listen open and close, an
  enrollment that rejects non-speech) and list detection as uncovered.
- **Audio player plays a synthetic WAV written at test start.** Owned test instances run with `mute-audio`, so nothing
  reaches a speaker. The board's `editor.app` model (`ai-vision.js`) is preferred over DOM automation.
- **Split:** US-2112 (the sandbox, product change by Claude, plus a guard test) lands first; US-2113..US-2115 plan in
  parallel.

## Working model

Same as EPIC-196 (unattended overnight run):

- **Codex cannot run the suite at all.** Codex writes tests from the guides, the boards' source and `$help` text, and
  checks syntax with `node --check`. **Claude runs the tests and triages.**
- **Two Codex sessions per task, both Luna/high:** session A investigates and writes a short task document (deleted
  when the epic closes); Claude reviews it; session B implements from the corrected document.
- Codex never uses the persephone MCP tool or port 7865, never runs `npm start`, `build-prod` or Electron, never
  commits or stages, and never edits `persephone-boards`.
- Every Codex brief asks for an `AI-VISION FEEDBACK` section; Claude appends each case to
  [ai-vision-feedback.md](../reviews/ai-vision-feedback.md), plus every failure caused by a wrong guess about the API.

## Area checklists

### US-2112: Profile-local `%LOCALAPPDATA%` in test instances

- `src/main/test-mode/local-app-data.ts` and its call in `setupMainProcess`, per Decisions.
- A guard test: a fixture board service reports `process.env.LOCALAPPDATA`, which lies under the test profile.

### US-2113: Audio Player

- A synthetic WAV opens in the board (the stream-host page), the player renders, and the track's duration and title
  are reported.
- Play and pause through the board model; position advances while playing.
- A synthetic `.m3u` playlist of two WAVs opens as a queue; next/previous move between them.
- A synthetic catalog (`*.music.link.json`) lists its tracks; a search narrows them.

### US-2114: Speech to Text and Text to Speech

- Each board opens (no file), renders its not-installed model/runtime state, and offers Install without starting a
  download.
- The `speech.transcribe` and `speech.synthesize` providers are registered and answer what they can without an engine
  (`describe`, the not-ready error), and a caller gets an error, not a hang.
- With speech-to-text registered, the Transcript toolbar is offered on a text page.
- Board settings render; nothing is written outside the test profile.

### US-2115: Wake Word

- The board opens, lists the fake microphones, and shows no enrollments.
- `speech.wake` `describe` and `list` answer; `delete` on an unknown phrase reports zero.
- Listening opens on the fake microphone and closes cleanly; enrollment from the synthetic signal is rejected as
  non-speech (if the board reports it), and nothing is stored.

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-2112 | Profile-local `%LOCALAPPDATA%` in test instances | Done |
| US-2113 | Tests: Audio Player | Done |
| US-2114 | Tests: Speech to Text, Text to Speech | Done |
| US-2115 | Tests: Wake Word | Done |

## Results

- **US-2112:** `src/main/test-mode/local-app-data.ts` (Claude). Guard test `boards/bridge/service-environment.test.mjs`
  with fixture `fixtures/boards/bridge/service-environment-board/`: a board service reports the profile folder. After
  every run the real `board-data` folders of the three boards were unchanged (modification times checked only).
- **US-2113:** `published-boards/audio-player` 4 tests from WAVs, an `.m3u` and a catalog written at test start:
  playback through the model (title, duration, position, pause), light mode for a directly opened WAV, the playlist
  queue, catalog listing and search. Triage: the light-mode chip shows the title without its extension (test fixed).
  **Board bug:** the model's `next()` replaces an imported playlist with a one-item source queue, so Previous is
  disabled after it; that test stays failing.
- **US-2114:** `speech-to-text` 6 tests and `text-to-speech` 4 tests: the not-installed state (no download clicked),
  provider registration and channel `describe` through the board's own service channel, the not-ready channel error,
  `transcribeFile`/`speak` rejecting with the documented message, the Transcript toolbar offered once Speech to Text is
  registered, and the board settings rows. Triage: display strings from the language packs, error codes do not survive
  `call` (call gap), boolean settings lacked `data-name` (product bug, fixed).
- **US-2115:** `wake-word` 4 tests: fake microphones listed and no enrollments, `describe`/`list` and a zero-count
  delete, a synthetic recording rejected with a quality reason and nothing stored, and listening without an enrollment
  reporting `no-enrollments` without opening capture. Triage: the plan expected the review dialog; the board rejects
  synthetic audio before review (as Decisions said).
- **Fixed (Claude):** boolean and folder board settings had no `data-name="board-setting-<id>"`
  (`BoardSettingsSection.ts` now passes `name`).

## Concerns

1. **A sandbox gap would touch real data.** The redirect is the only thing between a test and the user's
   `board-data`. The guard test fails loudly if it stops working; each board test also runs only in owned instances.
2. **Board processes outlive the page.** Services stop asynchronously after the page closes; the helper's cleanup must
   not race the next test's registration.
3. **Synthetic audio limits speech coverage.** Detection and transcription need real speech and installed models.

## Open items

1. **Board bug (persephone-boards, read-only):** Audio Player `editor.app.next()` calls `ctx.play(item)` =
   `playModelItem` (`audio-player/ai-vision.js:222`, `audio-player/app.js:122-131`), which for an item not in the
   catalog calls `queue.enqueue(null, href)` (`source-queue.js:84`) and replaces the playing playlist with a one-item
   source queue (probe: mode `catalog` → `source`, Previous disabled). The M3U test stays failing.
2. **Call gap:** a coded error loses its code over `call` (`src/main/mcp/tools/call-tools.ts` `toCallResult` prints only
   the message), although `agents/capabilities/errors-agent-calls-examples.md` lists codes agents can see. Proposed:
   carry the code in the envelope and in `ctx.call` errors.
3. **Board docs:** wake-word README presents the loudness gate as the enrollment path; it is a fallback for a missing VAD
   model. Audio Player docs do not say light mode has no model.
4. **Uncovered:** transcription, synthesis and wake detection (need installed models, downloads or real speech);
   installing anything; Audio Player folder import, catalog edits and PLS; agent calls of channel methods (by design).
5. **Carried over:** the EPIC-187 grid row-insertion decision; the EPIC-194 Theme Editor board bug.

## Notes

### 2026-11-18
- Created after EPIC-196 closed. Board survey: three boards use the real `%LOCALAPPDATA%`; the test-mode redirect was
  written and probed first (owned instance: main and renderer report `…\integration-test\.profile\test-local-app-data`).
- Planning: 3 Luna runs in parallel. Claude's corrections: US-2113 (no `previous()` on the model; samples under
  `boards-samples/`; a light-mode test added); US-2114 (generate the WAV instead of committing it); US-2115 approved.
  Implementation: 4 Luna runs plus 2 fix rounds (wake-word rejection, speech display strings and error codes).
- New modules, run twice: 34 passed, 1 failed (the Audio Player board bug), same result both times.
- Full launched run (`--with git,mneme`), 497 tests: **492 passed, 3 failed, 2 skipped** (Tor). Failures: the EPIC-187
  grid decision, the EPIC-194 Theme Editor board bug, and the Audio Player `next()` board bug (new). 19 new tests.
- Completion skills on Codex (Luna): review found nothing; document updated `integration-tests.md`,
  `integration-test/README.md`, the ui-tests skill and `key-files.md`; userdoc no change (`whats-new.md` already had
  both lines). typecheck, lint and guides:check pass; no catalog messages changed. 10 ai-vision entries. Task folders
  deleted at close.
- Next: Phase 9b (speech and translation services, terminal, `app.proc`, module service, proxy/tunnel), the last phase.
