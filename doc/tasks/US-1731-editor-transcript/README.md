# US-1731: Transcript button in the text editor

## Goal

Add a live Transcript control to Monaco text pages. It captures the microphone, computer audio, or both, and appends committed speech to the document end. Per the fixed revised EPIC-134 decision, Persephone shows no uncommitted draft text.

This is an EPIC-134 phases 3–4 task under the revised design. Persephone owns capture; there is no board permission or Meeting mode in the Speech to Text board.

## Background

### Existing live transcription pattern

- `src/renderer/ui/voice-typing/VoiceTypingController.ts` discovers registered v1 providers with `api.getBoardServiceProviders("speech.transcribe")`, chooses a provider, sends `{ type: "describe" }`, and opts in only when the description's `features` contains the exact string `"live"`. Its describe cache is keyed by provider id and interface version. Voice typing continues inserting committed segments live; only its draft display is removed under the fixed EPIC-134 decision.
- A transcription open uses mono `pcm-s16le` at 16,000 Hz and `live: true` only after discovery. The controller captures through `getUserMedia()`, uses an `AudioWorklet` to downmix, resample, measure RMS, convert to signed 16-bit PCM, and stream bounded chunks with service-channel backpressure.
- `observeChannel()` currently treats provider `draft` messages as replaceable preview and `segment` as committed text; it continues listening through terminal `result` or `error`, including after sending `end`. The fixed EPIC-134 decision is to remove draft display from Persephone, including the existing Voice Typing overlay; the Transcript consumes committed segments only. Cancellation sends `cancel`, and stop flushes capture, sends `end`, then waits for the terminal provider message.
- Voice typing's insertion, clipboard fallback, shortcut state, optional silence auto-stop, and overlay are consumer-specific. Do not reuse its cursor insertion or session orchestration for transcripts.
- The completed implementation record and contract details are in [US-1728](../US-1728-voice-typing-live/README.md). Its provider discovery, live opt-in, PCM capture, message ordering, and cancellation decisions are the reference behavior.

### Reuse boundary

Planned shared files are `src/renderer/ui/speech/SpeechTranscriptionProvider.ts` (registered-provider discovery, click-time describe/cache, and reactive availability), `src/renderer/ui/speech/SpeechServiceChannel.ts` (channel port routing and backpressure), `src/renderer/ui/speech/PcmAudioCapture.ts` (one-source capture, resampling, RMS, and PCM), and `src/renderer/ui/speech/LiveSpeechSessionCoordinator.ts` (per-window mutual exclusion). The transcript-specific files are `src/renderer/ui/transcript/TranscriptController.ts`, `src/renderer/ui/transcript/TranscriptToolbarContributionView.ts`, and `src/renderer/ui/transcript/TranscriptConsentDialog.ts`.

Create a new page/editor-scoped `TranscriptController` under `src/renderer/ui/transcript/`. Keep the voice typing controller's independent user flow and transcript-specific Monaco editing separate. Extract only demonstrably common mechanics from `VoiceTypingController.ts` into small `src/renderer/ui/speech/` helpers: provider discovery/describe with a shared per-window cache, service-channel port routing/backpressure, and PCM capture/resampling. Give each transcript source its own capture instance and channel; mic and loopback must remain separate so Both mode can label `Me` and `Others` correctly. Avoid a generalized session framework that couples page editing to voice typing's shortcut or clipboard rules.

### Capture and current permission policy

- Persephone already grants its own renderer microphone access through `armVoiceTypingMediaGrant()` / `clearVoiceTypingMediaGrant()` in `src/main/permission-policy-service.ts`; `src/ipc/main/core-handlers.ts::armVoiceTypingMicrophone()` validates the app main frame before arming it. The permission handler consumes that short-lived one-shot grant for an audio-only `media` request.
- `window.screen.recording` uses the separate `armRecordingMediaGrant()` / `clearRecordingMediaGrant()` path. `src/renderer/api/window-screen.ts` exposes the API, and `src/main/recording-service.ts` arms the grant for the owner `WebContents`; `handleCheck()` and `handleRequest()` allow its app-main-frame video-only desktop request. Preserve these two existing grant paths and their meanings.
- `installSession()` installs `setDisplayMediaRequestHandler()` on `appSession`; today its callback always returns `callback({})`. `handleCheck()` rejects app-main-frame `display-capture` because only `APP_ALLOW` permissions and one-shot `media` requests pass. `handleRequest()` rejects it in the app main-frame branch and explicitly denies it for browser-profile sessions. The revised implementation changes these two policy handlers only for an armed Transcript request from the Persephone app frame; every unarmed, malformed, unrelated, or non-Windows request stays denied.
- The previous document's Electron 43.0.0 standalone probe remains a verified finding: with `defaultSession.setDisplayMediaRequestHandler()` and `getDisplayMedia({ audio: true, video: true })`, Electron supplied a non-null requesting frame and both requested flags; returning `{ audio: "loopback", video: request.frame }` produced an `index.html` video track and a `System audio` track. Stopping the video track left audio live and usable by an `AudioContext`. The probe used `file://` and did not include Persephone's permission handlers or a `board://` frame; it verifies Electron's API combination, not app integration.
- For Transcript, add an expiring one-shot loopback grant tied to the app `WebContents`/main frame. On Windows and only while the grant is armed, the display-media callback returns `{ video: request.frame, audio: "loopback" }` and consumes the grant. Otherwise it returns `{}`. In `handleCheck()` and `handleRequest()`, allow `display-capture` only for that same armed app request. Clear the grant on use, timeout, page/session cancellation, renderer destruction, and failed capture startup. Do not add a board `systemAudio` flag, alter browser-profile policy, or expose a screen source.
- Loopback audio is Windows-only. The menu must not offer Computer audio or Both on other platforms; microphone-only transcription remains available.

### Monaco toolbar, document edits, and lifecycle

- `src/renderer/editors/base/PageToolbarView.ts` provides left and right content slots. `TextChromeView` in the same folder provides `toolbarContributions` and `rightToolbarContributions` slots, and `src/renderer/editors/monaco/index.ts::MonacoEditorView` currently puts its reactive word-wrap control in the right slot. Add the Transcript contribution through the Monaco editor's right toolbar contribution; do not change generic toolbar behavior for other editors.
- `PageToolbarView` and the current `MonacoToolbarBitsView` use `IconButtonView`, `VanillaView`, model subscriptions, and `data-name` for shell controls. The Transcript control and its menu items need stable `data-name` values documented in `doc/architecture/ui-element-contract.md`. Follow `src/renderer/uikit/CLAUDE.md`: compose existing UIKit controls, use `t()` and English source catalog entries, use theme tokens only for colors, and use co-located static CSS for app-owned styling. Do not add a new UIKit primitive unless it is reusable without Persephone APIs.
- Provider discovery returns registered provider metadata, not feature metadata (`BoardServiceProvider` in `src/ipc/board-bridge-channels.ts` has no `features` field). Calling `describe` may start the board service, so never describe while rendering or refreshing toolbar visibility. Show the Transcript button when at least one `speech.transcribe@1` provider is registered, refreshing reactively when providers are registered or removed. On click, choose the provider and describe it; if it does not advertise `live`, show a localized notification and do not start capture. If provider registration/removal has no renderer-visible change event, add a narrowly scoped event/refresh path.
- Every committed utterance is appended at the Monaco model's current end through a Monaco edit. Preserve the user's selections/cursor and undo history; use explicit append ranges and undo stops, and restore selections after each commit. Never insert at the caret. In Both mode prefix each committed utterance with `Me: ` or `Others: ` and put each on a new line. In single-source mode put each utterance on a new line without a label. Normalize only the boundary newline needed to keep utterances on separate lines; preserve existing document text.
- Do not render provider drafts in Persephone. Process committed segments only; clear any transcript-side temporary state on terminal result/error, stop, cancellation, and disposal. Before an append, detect whether the editor was already at the end; keep it at the end only in that case. Do not steal focus or move a selection when a background page receives a segment.
- Continue capture and appends while the page tab is inactive. Stop and release both sources/channels when the page closes, its main editor switches away from Monaco, or the app window quits. Do not tie the session to tab focus or the toolbar view's visibility. Enforce one transcript session at a time per app window, including when started from different pages.
- Voice typing is app-window scoped from `MainPageView` and uses a separate microphone grant and main-process state. Add a shared live-speech session coordinator so a Transcript and voice typing cannot capture/insert simultaneously in one window; reject a second start with localized feedback and leave the active session intact. Keep separate sessions possible in separate app windows.

### Consent, contract, and guides

- Before the user's first Transcript capture, show a one-time localized consent notice reminding them to tell participants recording is happening, that transcription is local, and recommending headphones to avoid capturing remote speech through the microphone. Store acknowledgement once per user in app settings through `src/renderer/api/settings.ts` (for example, `transcript.consent-acknowledged`, default `false`); do not store it per window, page, or board. For Both mode, follow this order: show consent if needed; after its confirm click, arm the loopback grant and await the IPC response; call `getDisplayMedia()`; stop its video track; then call `getUserMedia()`. The armed app-frame display-media handler does not require `request.userGesture`, so the arm IPC round trip does not depend on transient activation. When consent was already acknowledged, start at grant arming after the menu click; do not assume activation survives the IPC round trip.
- Update `assets/guides/agents/speech-transcribe.md`: `maxAudioMs` caps non-live requests; a request opened with `live: true` is not capped by total duration, while the provider must keep bounded audio/history/queue memory. Keep this as an additive v1 contract clarification; it does not add a bridge method or change the board bridge surface. Follow the guide's existing compatibility rule: only an incompatible contract change requires a new speech interface version. Do not bump `src/shared/board-bridge-version.ts` for this consumer-only behavior. No guide-specific version field is present; the embedded guide is identified by its `speech-transcribe` guide id.
- Update the existing Voice Typing user guide at `assets/guides/shortcuts.md` with the Transcript button and its source menu, running/Stop state, appended text/draft behavior, Windows-only computer audio, consent, and stop lifecycle. Keep `assets/guides/agents/speech-transcribe.md` as the normative contract; update `assets/guides/agents/index.md` only if its summary needs to mention the in-app Transcript consumer.
- Add English UI strings to the appropriate flat catalog under `src/shared/i18n/en/` and call `t()` from the UI. Keep each sentence in one message and add translator notes for consent and source labels as needed, per `doc/standards/localization.md`.
- Update `doc/architecture/ui-element-contract.md` for the new stable toolbar/menu/running-control `data-name` handles and `doc/architecture/key-files.md` for new controller/helper ownership. `doc/active-work.md` already links this task under EPIC-134 and needs no change.

## Implementation Plan

1. [x] **Extract shared speech mechanics and provider discovery.** Add focused helpers under `src/renderer/ui/speech/` for registered-provider listing (without describe), click-time provider describe (`features.includes("live")`, cache by provider id/version), service-channel port routing/backpressure, and one-source PCM capture/resampling to mono 16 kHz s16le. Keep `VoiceTypingController`'s committed-segment insertion, shortcut, clipboard fallback, and auto-stop semantics in `src/renderer/ui/voice-typing/VoiceTypingController.ts`; migrate shared mechanics and remove only its draft display per the fixed EPIC-134 decision. Refresh registered-provider availability reactively when providers register or are removed; toolbar refresh must not start a board service.

2. [x] **Add transcript/session orchestration.** Create `src/renderer/ui/transcript/TranscriptController.ts` and supporting types/views. For each selected source, acquire a separate stream, capture pipeline, and live service channel. Open one live request per source with `{ type: "transcribe", format: { encoding: "pcm-s16le", sampleRate: 16000, channels: 1 }, live: true }`; keep channels independent, identify source on each callback, serialize committed Monaco edits, ignore provider drafts, and reconcile terminal result without duplicating delivered segments. Handle startup failure by stopping every source/channel already acquired. Implement stop (`end`, flush, await terminal result), cancel (`cancel`), channel error/close cleanup, and disposal idempotently.

3. [x] **Add the app-frame loopback grant.** In `src/main/permission-policy-service.ts`, add a short-lived, one-shot grant keyed to an app `WebContents` and cleanup on timeout/destruction. In the `appSession` `setDisplayMediaRequestHandler()` callback, validate Windows, an armed grant, a live app main frame, and the request frame's ownership; on success consume the grant and call `callback({ video: request.frame, audio: "loopback" })`; otherwise retain `callback({})`. Special-case `display-capture` in both `handleCheck()` and `handleRequest()` to allow only that same armed app main-frame request. Leave profile-session denials, `armVoiceTypingMediaGrant()` and `armRecordingMediaGrant()` behavior intact.

4. [x] **Expose a narrow renderer capture request.** Add a Transcript loopback arm/clear or one-shot request endpoint in `src/ipc/api-types.ts`, `src/ipc/renderer/api.ts`, and `src/ipc/main/core-handlers.ts`. Validate `event.senderFrame === event.sender.mainFrame` and the registered app window before arming; bind the grant to `event.sender.id`. For Both mode after any required consent confirm click, arm the grant and await the IPC response, then call `getDisplayMedia({ audio: true, video: true })`, stop the returned video track immediately, and call `getUserMedia()` for the microphone. The app-frame handler admits this armed request without checking `request.userGesture`, so transient activation need not survive the IPC round trip. On non-Windows, do not call display capture.

5. [x] **Integrate controller with Monaco page ownership.** Add a page/editor-owned Transcript controller for the Monaco text editor in `src/renderer/editors/monaco/MonacoEditor.ts` or its owning model/view integration. Bind disposal to page close/editor switch away/model disposal rather than active-tab focus. Coordinate the single per-window live-speech lease with `VoiceTypingController` in `src/renderer/ui/app/MainPageView.ts` and voice typing start handling. Release the lease and all captures on app-window quit/disposal.

6. [x] **Add the toolbar affordance and source menu.** In `src/renderer/editors/monaco/index.ts`, contribute a reactive Transcript control through `TextChromeView.rightToolbarContributions`; use `PageToolbarView`/existing UIKit button and menu primitives. Render the button when at least one `speech.transcribe@1` provider is registered, without describing or starting its service. Its dropdown has exactly **Both**, **Computer audio**, and **Microphone (me)**. Hide/disable computer audio choices off Windows. On click, describe the chosen provider; if it does not advertise `live`, show a localized notification and do not capture. While recording, show a live level indicator and translated **Stop** action. Subscribe to provider registration/removal and controller state so availability and running UI update without remounting unrelated toolbar controls. Add all `data-name` handles to `doc/architecture/ui-element-contract.md`.

7. [x] **Append committed segments.** Use Monaco's model/editor API in the Transcript-specific view/controller to append each committed segment at the current model end. Prefix with a newline as needed, apply speaker labels only in Both mode, preserve all selections and cursor position, and bracket edits with undo stops so commits undo as sensible units. Ignore live `draft` messages for display and never add draft text to model content. Keep the viewport at the end only if it was already at the end before the update. Clear temporary state on terminal result/error, stop, cancel, and disposal.

8. [x] **~~Add one-time consent~~ (removed by user decision, see Implementation notes) and localized copy.** Add `transcript.consent-acknowledged` to `AppSettingsKey`, default state, persisted settings serialization, and settings comments in `src/renderer/api/settings.ts`. Show a localized confirmation dialog before the user's first Transcript capture; save acknowledgement only after affirmative confirmation. Recommend headphones to reduce remote speech leaking into the microphone. Add English catalog messages under the appropriate `src/shared/i18n/en/` area and call `t()` at the controls/dialog. Follow `doc/standards/localization.md` for translator notes and whole-sentence messages.

9. [x] **Clarify the live contract and user/developer documentation.** In `assets/guides/agents/speech-transcribe.md`, define `maxAudioMs` as the cap for non-live requests only; live requests may continue without a total-duration cap, with bounded provider memory and bounded work queues. Update `assets/guides/shortcuts.md` with Transcript use and its behavior. Update `assets/guides/agents/index.md` only if needed for discoverability. Add the Transcript controls to `doc/architecture/ui-element-contract.md` and new controller/helper rows to `doc/architecture/key-files.md`. No board bridge version bump or board permission docs are required.

10. [ ] **Verify integrated behavior manually during implementation.** On Windows, use a real app-frame Transcript action and confirm the one-shot request succeeds, the video track stops, and loopback audio remains live. Confirm unarmed, expired, wrong-frame, non-Windows, browser-profile, and other display-capture requests remain denied; existing voice typing and screen recording still work. Exercise each source mode, committed segments, stop/cancel/error, user selection/cursor stability, undo, conditional scroll-to-end, inactive-tab continuation, editor switch/page close/app quit, one-time consent, localized controls, and mutual exclusion with voice typing. Confirm toolbar refresh performs provider listing only, and a provider without `live` gets a localized rejection on click. Do not add or run unit tests for this task.

## Before → After

Current app-session display-media policy:

```ts
// Before: src/main/permission-policy-service.ts::installSession
if (ses === appSession) ses.setDisplayMediaRequestHandler((_request, callback) => callback({}));

// After: armed, Windows-only Transcript request; all other requests remain denied
if (ses === appSession) ses.setDisplayMediaRequestHandler((request, callback) => {
    if (process.platform !== "win32" || !consumeTranscriptGrant(request.frame)) {
        callback({});
        return;
    }
    callback({ video: request.frame, audio: "loopback" });
});
```

Current versus requested live-request semantics:

```md
<!-- Before: maxAudioMs caps every recording. -->
Each provider advertises maxAudioMs and enforces that limit for one recording.

<!-- After: a live request has no total-duration cap; provider memory and queues stay bounded. -->
Each provider enforces maxAudioMs for non-live requests. A live request is not capped by total
duration; the provider keeps only bounded audio context, prompt history, and queued work.
```

## Concerns / Open Questions

- The renderer has a provider snapshot API and module-service status events, but no clearly exposed provider-list changed subscription. During implementation, confirm which lifecycle event covers provider registration/removal; add a narrow event if service-status changes alone miss provider availability. Do not use describe as a visibility probe because it can start the service.
- Multiple `speech.transcribe@1` live providers may be present. Use the same provider selection ordering as Voice Typing unless product review requires a chooser; do not add another menu item beyond the three source modes.
- The one-time, per-user consent copy must say that participants should be told and that audio is processed locally; recommend headphones. Confirm the final wording in the localized dialog; no consent is recorded until the user accepts.
- Without headphones, the microphone also hears the computer speakers. Remote speech can therefore appear twice in Both mode: once as `Others` from loopback and again as `Me` through microphone bleed. Transcription does not identify individual remote speakers; this task adds neither echo cancellation for loopback nor speaker diarization.

## Acceptance Criteria

- A Monaco text page shows Transcript when at least one `speech.transcribe@1` provider is registered, without starting it just to render the toolbar; provider registration/removal updates the button reactively. On click, the selected provider is described; if `live` is absent, a localized notification appears and capture does not start.
- The source menu contains Both, Computer audio, and Microphone (me). Computer audio is available only on Windows. Running state shows an audio level indicator and Stop.
- Capture uses separate mic/loopback tracks and separate live channels at mono 16 kHz PCM. The app frame gets one Windows loopback display-capture grant only while armed; all other display-capture requests remain denied. The returned frame-backed video track is stopped immediately.
- No provider draft is displayed in Persephone. Voice typing continues inserting committed segments live; only its draft display is removed. Each transcript utterance is appended at the end, without moving user selections/cursor; undo remains sane and scrolling follows the end only when already there.
- Both mode appends one new line per utterance with `Me: ` / `Others: ` labels; single-source mode appends one unlabeled line per utterance.
- A transcript continues while its tab is inactive and stops on page close, switch away from Monaco, or app quit. At most one transcript runs per app window. Transcript and Voice Typing cannot run together in the same window; starting one while the other is active leaves the current session intact and reports the conflict.
- The user's first Transcript start requires a one-time consent acknowledgement persisted in app settings. For Both, after confirmation the app awaits loopback arming, starts display capture and stops video, then starts microphone capture; no `request.userGesture` check is required for the armed app-frame display request. UI strings are localized through the English source catalog and `t()`.
- The `speech.transcribe` v1 guide says `maxAudioMs` limits only non-live requests and that live requests have bounded provider memory but no total-duration cap. No board `systemAudio` permission or board bridge API/version change is introduced.
- The Voice Typing guide, UI element contract, and architecture key-files index describe the new user-facing controls and code ownership. `doc/active-work.md` remains correct without edits.
- No unit tests are added or run for this task document.

## Files Changed Summary

| File | Planned change |
|---|---|
| `src/renderer/ui/speech/` (new focused helpers) | Shared provider describe/cache, channel routing/backpressure, PCM capture/resampling, and per-window live-speech coordination. |
| `src/renderer/ui/voice-typing/VoiceTypingController.ts` | Migrate shared mechanics; remove draft display while retaining voice-typing-specific lifecycle, shortcut, silence, and clipboard behavior. |
| `src/renderer/ui/transcript/` (new controller and supporting views) | Own source channels, transcript session, commit handling, consent prompt orchestration, and cleanup. |
| `src/renderer/editors/monaco/MonacoEditor.ts` and `src/renderer/editors/monaco/index.ts` | Tie controller lifetime to Monaco page/editor and contribute reactive toolbar control. |
| `src/renderer/editors/base/PageToolbarView.ts` and `src/renderer/editors/base/TextChromeView.ts` | No structural changes expected; use existing toolbar slots. |
| `src/main/permission-policy-service.ts` | Add one-shot app-frame loopback grant; allow `display-capture` only for the armed app request in `handleCheck()` and `handleRequest()`; preserve existing voice and recording grants. |
| `src/ipc/api-types.ts`, `src/ipc/renderer/api.ts`, `src/ipc/main/core-handlers.ts` | Add main-frame validated arm/clear path for Transcript loopback capture. |
| `src/renderer/api/settings.ts` | Persist the one-time consent acknowledgement in app settings. |
| `src/renderer/ui/app/MainPageView.ts` | Coordinate Transcript and Voice Typing leases and dispose app-window speech ownership. |
| `src/shared/i18n/en/` (appropriate flat catalog) | Add Transcript, source-mode, running/Stop, conflict, and consent messages with translator notes. |
| `assets/guides/agents/speech-transcribe.md` | Clarify non-live `maxAudioMs` cap and uncapped-duration live behavior with bounded provider memory/queues. |
| `assets/guides/shortcuts.md` | Add Transcript button, source modes, capture limitation, consent, and lifecycle. |
| `assets/guides/agents/index.md` | Update the speech guide summary only if needed. |
| `doc/architecture/ui-element-contract.md` | Document stable Transcript toolbar and menu `data-name` selectors. |
| `doc/architecture/key-files.md` | Index transcript controller and shared speech helper ownership. |
| `src/shared/board-bridge-version.ts` | No change: no board bridge method or board capability changes. |
| `doc/active-work.md` | No change: US-1731 already links to this task under EPIC-134. |
| `doc/epics/EPIC-134.md` | No change: revised phases 3–4 design is fixed and already links US-1731. |
| `src/renderer/ui/voice-typing/VoiceTypingOverlayView.ts` | Remove draft rendering per the fixed EPIC-134 decision; retain status, duration, and meter behavior. |
| `src/main/recording-service.ts` | No change expected; screen recording retains its existing one-shot grant. |
| `src/renderer/editors/board/BoardWebview.ts` and board permission/trust files | No change: boards do not receive system-audio permission. |
| `assets/guides/agents/boards.md`, `assets/guides/boards.md`, and board templates | No change: no board permission or board-side capture API is added. |
| `src/shared/board-bridge-version.ts` and `src/ipc/board-bridge-channels.ts` | No change to board bridge version or provider discovery shape; provider feature metadata still comes from `describe`. |

## Implementation notes (verified live, 2026-10-27)

- `getDisplayMedia()` from the app frame reaches the permission handler as `media` with an empty
  `mediaTypes` list, never as `display-capture`. The armed Transcript grant is therefore checked on
  that `media` path in `handleRequest()`; the planned `display-capture` branches were removed.
- The app session is created (and run through `installSession()`) before `appSession` is assigned, so
  the display-media handler was never registered on it, which was a pre-existing latent bug. It is now
  registered by `installAppDisplayMedia()` from the `ready` handler.
- Segments of one utterance continue the same line; a new utterance, the other source, or any other
  edit to the document starts a new line.
- In Both mode the level meter shows the louder of the two sources.
- Found during verification and fixed in BT-067: the live prompt must hold only words whose audio has
  left the window, or Whisper skips ahead and words are lost.
- The one-time consent notice (step 8) was removed after testing at the user's request: Transcript is
  a general tool (calls, a video on the computer, dictating notes), and a dialog on start is only
  friction. The `transcript.consent-acknowledged` setting and its strings are gone; the user guide
  recommends headphones for Both mode instead.
