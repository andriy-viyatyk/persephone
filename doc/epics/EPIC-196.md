# EPIC-196: UI test coverage, phase 9a — audio capture source, audio and voice typing

## Status

**Status:** Completed 2026-11-18
**Created:** 2026-11-18

## Overview

Phase 9a of the [UI test coverage roadmap](../reviews/ui-test-roadmap.md). Phase 9 (capabilities and integrations) is
split in two. This part adds the file-backed capture source the roadmap asks for, then tests everything that sits on
the audio module: the `audio@1` capability (capture, playback, devices, the global mute lease), the header's global
mute and capture indicators, window recording, and voice typing. Phase 9b keeps the speech and translation services,
the terminal, `app.proc`, the module service and the proxy/tunnel. Phase 8d (the audio and speech boards) depends on
this epic's capture source and can follow either part.

The deliverable is the tests plus the bugs they find. New tests use the `app` object style
(`ctx.app.pages[id].editor.…`, `ctx.app.boards.…`), with `ctx.call`/`ctx.callText`/`ctx.set` only where the stand-in
cannot express the call. New tests go in the new `capabilities` area: `integration-test/tests/capabilities/<module>/`.

## Goals

- A test instance never opens a real microphone and never plays to a real speaker. Its microphone is a committed WAV
  fixture, so capture tests are deterministic and need no `requires: ["mic"]`.
- `audio@1` capture and playback, the mute lease, the header indicators, window recording and voice typing have tests
  for the checklists below that `call` can reach; what it cannot reach is listed as uncovered, with the reason.
- A bug in Persephone is fixed here with a `whats-new.md` line. Every difficulty Codex has driving the app is recorded
  in [ai-vision-feedback.md](../reviews/ai-vision-feedback.md).

## Non-goals

- Phase 9b: `speech.synthesize`, `speech.wake`, `text.translate`, the terminal, `app.proc`, the module service and the
  proxy/tunnel.
- Phase 8d: the published audio and speech boards.

## Decisions

- **The capture source is Chromium's fake media device, switched on by test mode (2026-11-18).** Probed before the
  epic was written: Electron 44 with `use-fake-device-for-media-stream` and `use-file-for-fake-audio-capture=<wav>`
  feeds the WAV into `getUserMedia` (a 440 Hz tone read back at RMS 0.258, spectral peak 445 Hz) and lists
  "Fake Default Audio Input", "Fake Audio Input 1", "Fake Audio Input 2". This keeps the whole product capture path
  (device resolution, Persephone's media grants, `PcmAudioCapture`, the cleaning worklet, `CaptureSourcePool`) under
  test and adds no fake source to the audio module itself. Owner: a new `src/main/test-mode/media-capture.ts`, applied
  from `setupMainProcess` (`src/main/main-setup.ts`) before the app is ready, only when `isTestInstance()`:
  - always `use-fake-device-for-media-stream` and `mute-audio`, so no test instance reaches a real microphone or
    speaker even when no WAV is named;
  - `use-file-for-fake-audio-capture=<path>` only when `PERSEPHONE_TEST_AUDIO_CAPTURE_FILE` names an existing `.wav`
    file (the same env-variable pattern as `PERSEPHONE_TEST_BOARDS_CATALOG_URL`, `test-mode/published-boards-catalog.ts`).
  The suite wrapper passes the variable to owned launches and `--open`, pointing at a committed fixture under
  `integration-test/fixtures/audio/`. The fake camera that comes with the switch is acceptable: no test uses a camera.
- **The fake device also replaces Windows loopback (2026-11-18, second probe).** With the same switches, a
  `getDisplayMedia` request answered with `audio: "loopback"` returned a "System audio" track carrying the WAV's tone
  (spectral peak 445 Hz). So in a test instance the loopback reference that voice typing and Transcript open on Windows,
  and `audio@1` computer capture, read the fixture, never the real system mix. Computer capture is therefore testable;
  `cancelComputerAudio` is checked only for delivery, because its reference is the same signal as the microphone.
- **`mute-audio` mutes Chromium output, not Persephone's global mute.** The app's mute state (`webContents.audioMuted`,
  the header indicator) stays independent, so global-mute tests still observe the real feature.
- **Voice assistant UI no longer exists.** Only a settings migration (`settings-schema.ts:145`) remains; wake-word
  listening moved to the wake-word board (Phase 8d). Not a gap.
- **Voice typing needs a `speech.transcribe` provider**, which only boards supply. The tests use a fixture board whose
  service implements the contract offline (it answers with fixed text), so the whole path runs: the toolbar or
  command, capture from the fake microphone, the provider channel, and text inserted into the editor.
- **Voice typing's shortcut is a call gap (2026-11-18).** Voice typing starts only from its shortcut, which
  `src/main/voice-typing-controller.ts` reads in the window's `before-input-event`. `window.screen.pressKey` sends keys
  through CDP `Input.dispatchKeyEvent`, which never reaches that event (Ctrl+= zoom is unreachable the same way); a
  probe showed `webContents.sendInputEvent` does. Changing how app-window keys are delivered would touch every shortcut
  test, so it is an open item, not done unattended. The Transcript toolbar covers the same microphone capture and
  `speech.transcribe` session path.
- **Area `capabilities`**, modules `audio`, `recording` and `voice` (final names in the task plans). Board fixtures
  live in `fixtures/boards/<module>/`. A board helper shared with the `boards` area moves to `tests/helpers/`.
- **Split:** three tasks. US-2109 (the capture source) is a product change and lands first; US-2110 and US-2111 plan in
  parallel against the interface above.

## Working model

Same as EPIC-195 (unattended overnight run):

- **Codex cannot run the suite at all** (the product test host is an Electron utility process its sandbox cannot
  start, even with `--attach`). Codex writes tests from the guides, the source and `$help` text, and checks syntax with
  `node --check` (plus `npm run typecheck` and `npm run lint` for product code). **Claude runs the tests and triages.**
- **Two Codex sessions per task, both Luna/high:** session A investigates and writes a short task document (deleted
  when the epic closes); Claude reviews it; session B implements from the corrected document.
- Codex never uses the persephone MCP tool or port 7865, never runs `npm start`, `build-prod` or Electron, never
  commits or stages, and never edits `persephone-boards`.
- Every Codex brief asks for an `AI-VISION FEEDBACK` section; Claude appends each case to
  [ai-vision-feedback.md](../reviews/ai-vision-feedback.md), plus every failure caused by a wrong guess about the API.

## Area checklists

### US-2109: File-backed capture source (test mode)

- `src/main/test-mode/media-capture.ts` and its call in `setupMainProcess`, per Decisions.
- A small committed WAV fixture (mono, 16-bit, a few seconds, loud enough to survive the default cleaning) and the
  wrapper passing `PERSEPHONE_TEST_AUDIO_CAPTURE_FILE` to owned launches and `--open`.
- `doc/standards/integration-tests.md` and the ui-tests skill describe it (at epic close through `/document`).

### US-2110: `audio@1`, global mute and window recording

- A fixture board consuming `audio@1`: `devices()` lists the fake inputs; microphone capture delivers chunks of the
  documented shape (16 kHz, 6,400 bytes, increasing `timeMs`, one `epoch`) that are not silence; `processing: "raw"`
  works; two consumers share one source and closing one keeps the other; invalid options are rejected with the
  documented codes.
- The capture indicator in the header is on while a capture is open and off after it closes.
- `play`: a short buffer reports `ended` with `finished`; `stop` reports `stopped`; invalid sample rates and chunks are
  rejected.
- `muteApp()`: the lease turns on global mute and its header indicator; `release()` turns it off; the header
  indicator's own action releases all leases.
- Window recording (if `call` drives it): start, stop, a result file with the documented fields; discard removes it.

### US-2111: Voice typing

- A fixture `speech.transcribe` provider board (offline, fixed text).
- Voice typing in a text page: start it, the overlay shows the listening state, the provider's text is inserted at
  the cursor, stop ends the session and releases capture.
- No provider: the voice-typing control reports that no provider is available.
- The Transcript toolbar in Monaco, if `call` reaches it.

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-2109 | File-backed capture source (test mode) | Done |
| US-2110 | Tests: `audio@1`, global mute, window recording | Done |
| US-2111 | Tests: voice typing | Done |

## Results

- **US-2109:** `src/main/test-mode/media-capture.ts` appends `use-fake-device-for-media-stream` and `mute-audio` in
  every test instance and `use-file-for-fake-audio-capture` when `PERSEPHONE_TEST_AUDIO_CAPTURE_FILE` names a WAV.
  `integration-test/run.mjs` writes a 4-second 48 kHz amplitude-modulated sweep to `<profile>/test-audio-capture.wav`
  after each profile reset and passes it to owned launches only. `--open` and attach are unchanged; every capture,
  playback and voice test declares `requires: ["launch"]`, so it never runs against an app with a real microphone.
- **US-2110:** fixture board `fixtures/boards/audio/audio-board/` (page consumer of `audio@1`, metrics computed in the
  board). `capabilities/audio` 11 tests: fake device labels, default and raw capture (shape, epoch, `timeMs`, raw RMS),
  two consumers sharing a source, rejected options, computer capture of the fake loopback, `cancelComputerAudio`
  delivery, playback `finished` and `stopped`, rejected playback input, the mute lease and its header indicator, and the
  header action releasing all leases. `capabilities/recording` 1 test: record the window, profile-local file, discard
  from the player. The board helpers moved to `tests/helpers/boards.mjs` (cross-area). Triage: an `ArrayBuffer`
  argument cannot cross `call` (the board builds it); the chunk-size contract (below).
- **US-2111:** fixture provider `fixtures/boards/voice/fixture-transcriber/` (offline `speech.transcribe@1`, fixed
  text after audio arrives). `capabilities/voice` 2 tests: the Transcript toolbar is hidden with no provider, and a
  microphone Transcript session inserts the provider's text and stops. Triage: selectors scoped to the page slot, the
  unsaved page left to runner cleanup, the two shortcut-driven voice-typing tests removed (call gap, Decisions).
- **Fixed (Claude), guide:** `agents/audio.md` said every capture chunk is 6,400 bytes; a discontinuity (the loopback
  reference starting, a dropped queue, a restart) deliberately flushes a shorter chunk so the next `timeMs` stays exact.
  The guide now says so. No product bug was found.

## Concerns

1. **The default cleaning may remove a pure tone.** DTLN noise removal runs on default microphone capture; a stationary
   tone can read back near silence. The fixture should be speech-like (an amplitude-modulated, varying signal) and the
   loudness assertion should use `processing: "raw"`, with default processing checked only for delivery.
2. **Media permission.** Capture from the hidden audio window goes through Persephone's one-shot media grants; a fixture
   board must be trusted with the right `uses` and permissions, or capture is refused before the fake device is used.
3. **Global switches touch every test.** `use-fake-device-for-media-stream` and `mute-audio` apply to every test
   instance, so the full run must show no change in the browser and video areas.

## Open items

1. **Carried over:** the EPIC-187 grid row-insertion decision (user's call; its test stays failing); the EPIC-194
   Theme Editor `previewStatus` board bug (its test stays failing).
2. **Uncovered:** voice typing through its shortcut, its overlay and its missing-provider alert (call gap, Decisions);
   Transcript's computer-audio and Both modes (reachable, left for 9b or later; the loopback is the fixture in a test
   instance); window recording pause/resume and the page and editor regions.
3. **Proposed (not done):** deliver app-window `window.screen.pressKey` through `webContents.sendInputEvent`, so
   main-process shortcuts (voice typing, zoom) become testable; list `audio-capture-indicator` in the header
   `ui.elements` declarations and `screens/header.md`; add `hideStatusChrome?` to the `recording.start` signature.

## Notes

### 2026-11-18
- Created from the roadmap's Phase 9 after EPIC-195 closed. Phase 9 split into 9a (this epic) and 9b.
- Planning: 3 Luna runs in parallel. Claude's corrections: `--open` stays unchanged and capture tests require `launch`
  (US-2109); a 48 kHz fixture; a second probe showed the fake device also feeds Windows loopback, so computer capture
  moved into scope (US-2110); the helper move is owned by US-2110. Implementation: 3 Luna runs, no follow-ups; Claude
  fixed the five triage items directly (each a few lines).
- `capabilities` area: 14 passed, 0 failed.
- Full launched run (`--with git,mneme`), 478 tests: **474 passed, 2 failed, 2 skipped** (Tor). Failures: the EPIC-187
  grid decision and the EPIC-194 Theme Editor board bug, as at EPIC-195. 14 new tests; no other change, so the fake
  device and `mute-audio` in every test instance changed nothing in the browser and video areas.
- Completion skills on Codex (Luna): review found nothing; document updated `integration-tests.md`,
  `integration-test/README.md`, the ui-tests skill, `key-files.md` and `folder-structure.md`; userdoc confirmed the
  `agents/audio.md` correction. typecheck, lint, guides:check and i18n:check pass; no catalog messages changed. Task
  folders deleted at close.
- Next: Phase 9b (speech and translation services, terminal, `app.proc`, module service, proxy/tunnel) or Phase 8d,
  which this epic unblocked.
