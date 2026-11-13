# EPIC-162: Refactoring Phase 6.3 — voice and speech: speech home, `SpeechSessionClient`, `MicrophoneCapture`, `VoiceTypingService`, audio window split, main `VoiceTypingController` and one-shot media grants

## Status

**Status:** Completed 2026-11-13
**Created:** 2026-11-13

## Overview

This is the twenty-second epic of the [refactoring roadmap](../refactoring-roadmap.md) and covers roadmap item **6.3,
Voice and speech**, in full: SHL-2 in `doc/reviews/refactoring-2026-11/10-shell-scripting.md`, CORE-12 in
`04-api-core.md`, and MAIN-8 and MAIN-9 in `01-main.md`. Item 6.2 closed with [EPIC-161](EPIC-161.md).

The code was checked on 2026-11-13, after EPIC-161. Line numbers in the reports have drifted; the current state:

- **Already done by earlier epics.** SHL-3 (Phase 1.2): one host-service port router (`api/service-channel-ports.ts`,
  `serviceChannelPorts.claim`) and the shared channel (`shared/service-channel.ts`, `openDomServiceChannel`); the
  duplicate-router port leak is gone. CORE-12's constant work (Phase 0.3): every `persephone:audio-*` name lives in
  `src/ipc/audio-channels.ts` and the client error codes have one source. `JsonFileStore` exists
  (`src/main/json-file-store.ts`, Phase 1.5).
- **Not done.** Roadmap item 2.2's speech slice never ran: the speech services and the DSP classes still live in
  `src/renderer/ui/speech/` (12 files), and the separate audio-window entry (`src/renderer/audio/audio-window.ts`)
  imports DSP classes from the main window's `ui/` folder.
- `ui/voice-typing/VoiceTypingController.ts` is 586 lines: shortcut/settings sync, provider discovery, the
  `speech.transcribe` channel open and `as { type?: unknown; … }` message decoding, microphone arm/`getUserMedia`/clear,
  PCM capture and send queue, segment insertion with clipboard fallback and final-result reconciliation, the
  median-level auto-stop and inactivity stop, overlay state and error-to-i18n mapping. `MainPageView` constructs it.
  The overlay state type is declared in `VoiceTypingOverlayView` and imported by the controller. The `"Alt+V"` /
  `"Alt+Shift+V"` defaults are repeated in the controller and in main's `open-window.ts`.
- `ui/transcript/TranscriptController.ts` (272) repeats the provider channel open, the `getUserMedia` constraints with
  arm/clear and the capture wiring (`microphoneOptions`, `reportMicrophoneStatus`, `openPrivateLoopback`,
  `watchMicrophoneSettings`). `SpeechTranscriptionProvider.open` is an unused third copy of the channel open.
- `audio/audio-window.ts` (492) is a procedural module: capture-source pooling with reference counts/restarts/per-device
  cleaning, playback scheduling, device enumeration and the IPC wiring, on module-level maps.
- `src/main/open-window.ts` (637) carries about 150 lines of voice-typing state machine (shortcut matching, right-Ctrl
  tap, session/control-session, `executeJavaScript` insertion with deadlines and clipboard fallback), reached from
  `browser-service.ts` through `openWindows.findByWindow(parent)?.handleGuestVoiceTypingInput(...)`, and statically
  imports `getBoardRootForHost` from `board-protocol-service`.
- `src/main/permission-policy-service.ts` (650) has five one-shot media grants (recording, voice typing, transcript
  loopback, audio-window microphone, audio-window loopback), each with its own map, arm/clear/has/consume functions and
  `Date.now() + 5000` / `setTimeout(…, 5100)`, plus persistent per-profile site decisions (synchronous writes) and the
  board-origin subframe policy.

## Goals

- **One speech home.** Speech services (provider discovery, the live-session coordinator, microphone settings,
  private loopback, the new session client and microphone capture) live in `src/renderer/api/speech/`; the DSP classes
  (`PcmAudioCapture`, `ComputerAudioGate`, `LoopbackReference`, the DTLN pipeline/engine/worker, cleaning types) and
  anything the audio window needs live in `src/renderer/audio/dsp/` (or `src/renderer/audio/`). `ui/speech/` is gone;
  the audio window no longer imports from `ui/`.
- **`SpeechSessionClient`** opens a typed `speech.transcribe` session (`open({ live, translate })` → `onStatus`,
  `onDraft`, `onSegment`, `onResult`, `onError`, `sendAudio`, `end`, `cancel`); all protocol decoding sits there.
- **`MicrophoneCapture.open({ loopbackReference, onChunk, onLevel, onFailed })`** owns arm/clear IPC, the constraints,
  `resolveMicrophoneDevice`, `PcmAudioCapture` with cleaning, loopback and the settings watch. `PcmAudioCapture.start`
  takes an options object instead of positional parameters.
- **Voice typing split:** `VoiceTypingSession` (one dictation's state machine, lease, timer), `LiveTextInserter` (pure,
  injected `insert(text)` port), `SpeechAutoStop` (thresholds in one commented constants block), and an app-level
  **`VoiceTypingService`** started from bootstrap that owns shortcut/settings sync and sessions and exposes
  `state: TOneState<VoiceTypingOverlayState>`; `VoiceTypingOverlayView` binds to it; `MainPageView` no longer constructs
  a service.
- **Slim `TranscriptController`** (about 120 lines): two `MicrophoneCapture`/display sources, two `SpeechSessionClient`
  sessions and `append()`.
- **Audio window split:** `audio/CaptureSourcePool.ts`, `audio/PlaybackChannel.ts`, and `audio-window.ts` as a thin
  host that wires IPC to them.
- **Main:** `src/main/voice-typing-controller.ts` (`VoiceTypingController`, one per window, composed by `OpenWindow`;
  `handleInput`, `setShortcuts`, `setState`, `insertText`); board-origin lookup injected into `OpenWindow` as a narrow
  `(host) => root | undefined` instead of a static import of `board-protocol-service`.
- **Main:** `OneShotFrameGrant` (`arm`, `has`, `consume`, `clear`) with one instance per grant kind in
  `src/main/media-grants.ts` and one named TTL constant; `SitePermissionStore` on `JsonFileStore`;
  `permission-policy-service` keeps `handleCheck`/`handleRequest` and composes the two.

## Decisions this epic acts on

- **Scope.** All of roadmap item 6.3 in six tasks, plus the speech/DSP slice of item 2.2 that SHL-2 and CORE-12
  depend on ("the new speech service home"). Nothing of 6.3 remains if all six land.
- **D8 — resolved: voice typing and transcripts keep their own in-window capture stack; they do not use the audio
  service.** Reasons:
  - The audio service is a *board capability* (`PLATFORM_AUDIO_CAPABILITY_ID`): channels are bound to a `BoardGrant`,
    counted against `MAX_SERVICE_CHANNELS_PER_BOARD`, subject to global mute and the capability router, and run in a
    separate audio window process. Voice typing and transcripts are app features of the window the user is typing in;
    routing them through the board capability would change their permission model (their one-shot grants are bound to
    the main window frame) and add a cross-process hop for every 16 kHz PCM chunk on a latency-sensitive path (the
    microphone opens in parallel with the provider channel so the first syllable is not lost).
  - Both stacks share the same algorithms once the DSP classes live in `audio/dsp/`; after this epic the in-window side
    is one `MicrophoneCapture` used by both controllers and the audio-window side is one `CaptureSourcePool`. The
    duplication D8 worried about is reduced to two thin owners over one DSP library.
  - Switching later stays a small change: `MicrophoneCapture` is the single seam a future audio-service backend would
    replace.
- **Order.** Folder move, pure (US-1922) → `SpeechSessionClient` + `MicrophoneCapture` + slim `TranscriptController`
  (US-1923) → voice typing split and `VoiceTypingService` (US-1924) → audio window split (US-1925) → main
  `VoiceTypingController` (US-1926) → `OneShotFrameGrant` + `SitePermissionStore` (US-1927). US-1925..1927 are
  independent of each other and of US-1923/1924.
- **Pure move first.** US-1922 moves files and rewrites imports only; no body changes. The DTLN worker is a worker
  entry: the plan must find every place that names its path (Vite config, `new Worker(new URL(...))`) and move them
  together.
- **Behaviour is kept** (§8: move code without changing behaviour, one extraction per change). Timing-sensitive paths
  that must stay exactly as they are: microphone and channel open in parallel with buffering until the channel is
  accepted; stop-before-accept and cancel-before-open paths; the arm → `getUserMedia` → clear ordering; the audio
  window's "channel-ready" handshake ordering; main's "consume on display-media handler only" rule; grant TTLs (5000 /
  5100 ms) and their `destroyed` cleanup. The `describeFeatures(provider, session.mode === "translate")` call passes
  "is translate" as the `refresh` flag: the plan states whether that is intended, and keeps today's behaviour under an
  honest name either way.
- **Contracts that must not change:** settings keys (`voice-typing.*`, `microphone.*`, transcript settings) and their
  defaults; the `speech.transcribe` provider protocol and the open message shape; IPC channel names and the
  `src/ipc/contracts/voice-typing.ts` contract; i18n keys and the messages users see; the `data-name` contract; the
  script API and MCP `call`; persisted site permission decisions (file name, location and format read/written by
  `SitePermissionStore` must match today's, including the profile keying). `window.persephone` is not touched, so no
  `BOARD_BRIDGE_VERSION` bump — a plan that changes the board-facing audio capability surface is sent back.
- **No new protocol code** (guardrail 1). Channels use `openDomServiceChannel` / `serviceChannelPorts`; IPC uses the
  EPIC-156 contracts in `src/ipc/contracts/`; requests use `PendingRequests`. `SpeechSessionClient` decodes messages of
  an existing protocol; it adds no correlator, ack window or error envelope.
- **Owners.** `api/speech/` (renderer speech services, `SpeechSessionClient`, `MicrophoneCapture`); `audio/dsp/` (DSP);
  `ui/voice-typing/` keeps views only plus `VoiceTypingService` only if the plan shows `api/` would need to import `ui/`
  — the default home for `VoiceTypingService`, `VoiceTypingSession`, `LiveTextInserter` and `SpeechAutoStop` is
  `src/renderer/api/speech/voice-typing/`; `audio/` for `CaptureSourcePool` / `PlaybackChannel`;
  `src/main/voice-typing-controller.ts`; `src/main/one-shot-frame-grant.ts` + `src/main/media-grants.ts`;
  `src/main/site-permission-store.ts`. Shortcut defaults get one owner in `src/shared/voice-typing-shortcut.ts`.
- **Imports.** No `await import()` to dodge a cycle (guardrail 5). The audio-window entry must not import `ui/` or
  app-state `api/` modules (it is a separate window). The main `VoiceTypingController` must not import `open-window.ts`.
- **God files only shrink** (guardrail 3): `VoiceTypingController.ts` (586) is replaced; `TranscriptController.ts`
  (272), `audio-window.ts` (492), `open-window.ts` (637), `permission-policy-service.ts` (650) and `MainPageView.ts`
  (479) must end smaller.
- **Privacy during verification.** No live check starts microphone capture, loopback/system-audio recording,
  transcription or voice typing. Live checks confirm the app starts, the settings page and a text page mount, and the
  audio window starts without console errors; the rest is code-path review. The §8 voice flows are left to a manual
  test by the user.

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-1922 | Speech services to `api/speech/`, DSP to `audio/dsp/` (pure move) | Done |
| US-1923 | `SpeechSessionClient`, `MicrophoneCapture`, slim `TranscriptController` | Done |
| US-1924 | Voice typing split: `VoiceTypingSession`, `LiveTextInserter`, `SpeechAutoStop`, app-level `VoiceTypingService` | Done |
| US-1925 | Audio window split: `CaptureSourcePool`, `PlaybackChannel`, thin host | Done |
| US-1926 | Main `VoiceTypingController` out of `OpenWindow`; injected board-origin lookup | Done |
| US-1927 | `OneShotFrameGrant` media grants and `SitePermissionStore` | Done |

### Task notes for the planners

- **All tasks.** Name the owner of every moved rule and the helper reused. List line counts before/after for the files
  named under "God files only shrink". For every exported symbol that moves, list its importers and update them (no
  re-export shims). List the timing-sensitive paths the task touches and show, step by step, that the order of awaits,
  IPC calls and state changes is unchanged.
- **US-1922.** Map every file in `ui/speech/` to its destination with the reason (who imports it: main window, audio
  window, worker). Both copies of `microphone-cleaning-types.ts` (`shared/` and `ui/speech/`) — say which stays and why.
  Worker path references. Moves and import rewrites only.
- **US-1923.** Table of every `speech.transcribe` message type and field decoded today in `VoiceTypingController`,
  `TranscriptController` and `SpeechTranscriptionProvider`, and the typed event each becomes. `MicrophoneCapture`
  options per caller (voice typing vs each transcript source), including constraints, loopback reference and the
  settings watch. Every `PcmAudioCapture.start` caller and its options object. Delete the unused
  `SpeechTranscriptionProvider.open`.
- **US-1924.** For each of `LiveTextInserter`, `SpeechAutoStop`, `VoiceTypingSession`, `VoiceTypingService`: the
  methods/fields moved from the controller (with today's line ranges), the constants block, and the bootstrap
  registration point (show it starts before the first shortcut event can arrive, and is disposed where the controller
  was). The overlay binding through `TOneState`. Error-to-i18n mapping unchanged.
- **US-1925.** Module state → owning class table; IPC handler → method table; the channel-ready handshake order before
  and after.
- **US-1926.** Every `OpenWindow` voice member → controller member; `browser-service`'s guest forwarding and
  `open-windows.ts`'s `setVoiceTypingConfig/State` callers; disposal on window close; the board-origin injection point.
- **US-1927.** Each of the five grant kinds: today's map/arm/has/consume/clear functions, frame binding, platform
  condition, callers (with file), and the `OneShotFrameGrant` options it gets. `handleRequest`'s booleans and clear calls
  before → after. `SitePermissionStore`: today's file path, format, load time and write timing; show the
  `JsonFileStore` adapter reads and writes the same file (synchronous vs debounced writes: state which, keep durability
  on quit).

## Remainder

Nothing of roadmap item 6.3 remains as planned work. Deliberately not done, recorded for a later epic:

- **The rest of roadmap item 2.2** (`SecondaryViewsModel`/`panel-key`, dialog models, translation services, editor
  categories, the transcript/translate Monaco contributions). Only the speech/DSP slice moved here.
- **`OneShotFrameGrant` option flags.** The class reproduces each grant's existing arm quirks (clear before or after
  the platform check, validate before clear, lazy listener cleanup on an expired voice-typing `has`) through option
  flags, so behaviour is byte-for-byte the old one. Collapsing them into one arm order is a small behaviour change
  (which stale grant gets cleared when an arm is refused) and was left out on purpose.
- **`TranscriptController`** ended at 243 lines, not the report's estimated ~120: what remains is transcript lifecycle
  policy (source order, terminal handling, backpressure) and `append()`; moving that into generic helpers would have
  spread transcript rules across the speech module.

## Out of scope

- Routing voice typing or transcripts through the audio service (D8, decided above).
- The rest of roadmap item 2.2 (`SecondaryViewsModel`, dialog models, translation services, editor categories,
  transcript/translate contributions move to `editors/monaco/contributions`); only the speech/DSP slice is done here.
- Any change to the board-facing audio capability, `window.persephone`, MCP `call`, settings keys or i18n messages.
- US-1873 (board docs) stays in Planned.

## Notes

### 2026-11-13
- Epic created after EPIC-161. Current state re-checked against the code (see Overview). D8 decided (see decisions).

### 2026-11-13 — implementation and close
- All six tasks implemented and staged in one unattended run; plans by Codex (Luna, the policy pick while the weekly
  window was tight), reviewed against the source and the roadmap guardrails; Codex Luna implemented. Typecheck, lint
  and build-prod passed after each task, and every task was checked live on a cold `npm start` through the MCP HTTP
  endpoint.
- **Live checks (capture-free, per the privacy rule).** The app renders and restores its pages; the Settings page and
  its microphone section mount; the hidden audio window loads and answers device enumeration through
  `CaptureSourcePool` with labelled devices (this arms the audio-window microphone grant and needs the permission
  *check* to pass through the new `OneShotFrameGrant` — enumeration only, no stream is opened); a new text page mounts
  Monaco and the transcript toolbar button; the voice-typing overlay mounts bound to `voiceTypingService.state` with
  no startup alerts. **Not exercised live (needs a manual test by the user):** the voice typing shortcut flows
  (Alt+V, Alt+Shift+V, right-Ctrl tap, Escape cancel, insertion into the app and into a browser/board frame,
  clipboard fallback), auto-stop and inactivity stop, transcript with microphone, computer audio (loopback) and both,
  board audio capture and playback, screen recording (recording grant), and browser site-permission prompts and saved
  decisions (`SitePermissionStore`).
- **Sizes (wc -l), epic start → end.** `VoiceTypingController.ts` (renderer) 586 → deleted (`VoiceTypingService` 159,
  `VoiceTypingSession` 401, `LiveTextInserter` 96, `SpeechAutoStop` 85, plus `SpeechSessionClient` 132 and
  `MicrophoneCapture` 96 shared with transcripts); `TranscriptController.ts` 272 → 243; `audio-window.ts` 492 → 106
  (`CaptureSourcePool` 330, `PlaybackChannel` 130); `open-window.ts` 637 → 485 (`voice-typing-controller.ts` 187);
  `permission-policy-service.ts` 650 → 306 (`one-shot-frame-grant.ts` 103, `media-grants.ts` 94,
  `site-permission-store.ts` 249); `MainPageView.ts` 479 → 470.
- **Decision refinements (plan review).** US-1922: the ui-local `microphone-cleaning-types.ts` (only `ECHO_TUNING`)
  became `audio/dsp/echo-tuning.ts`; `microphone-device.ts` went to `audio/dsp/` because the audio window uses it.
  US-1923: `SpeechTranscriptionProvider.open` was already gone; `SpeechSessionClient.open()` resolves when the port
  is wrapped and a separate `accepted` promise resolves on `status: listening`, with handlers attached in the same
  tick; the translate-mode `describeFeatures` refresh flag is intended (translate sessions bypass the feature cache)
  and is kept. US-1924: `VoiceTypingService` starts from the renderer startup table (`events` phase, right after
  `settings-effects`) and lives for the renderer lifetime; the plan's ad hoc start in `src/renderer.ts` with disposal
  in `MainPageView` was sent back as asymmetric ownership. US-1926: `getBoardRootForHost` keeps its string return
  (the plan's `BoardRoot` conversion would have touched four unrelated callers); main-frame navigation does not clear
  voice sessions (the plan claimed it did), and `close()` clears only the session while the close event clears both —
  kept exactly. US-1927: the grant timers keep their "only if the current entry expired" guard; the existing
  `JsonFileStore` instance moved as is (synchronous writes).
- **Review.** `/review` removed three non-null assertions / definite-assignment fields (`MicrophoneCapture`,
  `SpeechSessionClient`, `VoiceTypingSession`); `/document` updated `overview.md`, `folder-structure.md`,
  `key-files.md`, `browser-editor.md`, `capabilities.md` and the folder summary in `doc/agents-common.md` (it
  omitted `src/renderer/audio/`); `/userdoc` needed no changes. No English catalog messages changed;
  `npm run i18n:check` reports every pack complete.
- **Deliberate behaviour changes.** None intended. Voice typing now subscribes to shortcut events during startup (the
  `events` phase) instead of after the shell mounts, and is no longer cancelled by shell-view teardown (main clears its
  sessions when the window closes).
