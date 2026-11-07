# US-1786: Voice assistant core

## Goal

Plan the app-owned wake, request capture and feedback core for [EPIC-139](../../epics/EPIC-139.md), with seams for US-1787 and US-1788. Do not implement until the user approves this plan.

## Background

- The epic orders US-1784, BT-082, BT-083 and US-1785 before US-1786, then US-1787 and US-1788. US-1787 owns agent sessions, permissions, instructions, `voice.say` and reply synthesis; US-1788 owns media behavior and full voice interrupts.
- `assets/guides/agents/speech-wake.md` defines `describe`, `enroll`, `list`, `delete` and `listen`, with 16 kHz mono PCM s16le and backpressure. Its event `time` is the end of the phrase in milliseconds from the first input sample. Today it has no start field. The wake provider in `C:/projects/persephone-boards/boards/wake-word/scripts/service.mjs` sends that event; `scripts/engine.mjs` implements subsequence DTW with cost and path length, but currently does not retain a start index. This task extends both provider and guide.
- `C:/projects/persephone-boards/boards/wake-word/app.js` sends `phrase = kind`, defaults person to `Me`, and shows the enrollment response quality and match. `scripts/enrollments.mjs` lists sample IDs only; rejected clips are not stored. Older custom phrase labels can appear in `list`. The provider currently advertises `maxEnrollMs: 3000`, not 2500. A 3000 ms holdback is therefore a tuning choice, not a proven maximum phrase duration plus delivery margin.
- `SpeechTranscriptionProvider.list()` in `src/renderer/ui/speech/SpeechTranscriptionProvider.ts` discovers v1 providers. `VoiceTypingController.openChannel()` in `src/renderer/ui/voice-typing/VoiceTypingController.ts:175` selects the first version-1 entry. `SpeechServiceChannel.ts` wraps a transferred port and flow control; `PcmAudioCapture.ts` converts streams to 16 kHz PCM and supplies levels. Voice typing tracks live drafts/segments and stops on sustained silence only after committed speech and with no pending utterance.
- `TranscriptController.openCapture()` in `src/renderer/ui/transcript/TranscriptController.ts` arms `api.armTranscriptLoopback()`, obtains `getDisplayMedia({audio: true, video: true})`, clears the grant and stops video tracks; it limits computer capture to Windows. `LiveSpeechSessionCoordinator.ts` provides a renderer-local `acquire()`/`isBusy()` lease, but no subscription. It does not coordinate windows.
- `src/main/open-windows.ts:25` tracks normal and `boardRoot` windows; `mainWindow` can be hidden. `setCanQuit()` hides the last normal window at line 166. `MainPageView.ts` mounts the voice-typing overlay and has `appWindow.isBoardMode`.
- `HOST_SERVICE_CHANNEL_POLICIES` in `src/main/module-service-supervisor.ts:65` already allows `speech.wake@1`, `speech.synthesize@1` and `speech.transcribe@1` with prefixes `speech-wake:`, `speech-synthesize:` and `voice-typing:`. `src/renderer/ui/agent-session/` is the US-1785 app session client for US-1787.
- `src/renderer/api/settings.ts` defaults voice typing's silence to 0 and accepts 0, 2000, 3000, 5000 and 10000 ms. Its settings section is `VoiceTypingSettingsSectionView` in `src/renderer/editors/settings/sections/SettingsSections.ts`, registered via `settings-catalog.ts` and `SettingsView.ts`. The assistant has its own nonzero default, decided below.
- `assets/guides/agents/speech-synthesize.md` defines `describe`/`speak`; `C:/projects/persephone-boards/boards/text-to-speech/scripts/service.mjs` provides local speech. This task discovers availability only.

## Implementation Plan

- [x] Add the optional `start` field to the in-repository speech wake guide.
- [x] Add the renderer-local speech lease subscription and the voice assistant types, hooks and tuning constants.
- [x] Add and normalize the four assistant settings and defaults.
- [x] Add the Voice assistant settings section, provider availability, and enrollment controls.
- [x] Pause the assistant during enrollment and release the pause on completion or disposal.
- [ ] Integrate those foundations into the assistant controller and verify them in the manual scenarios below.

- [x] **Settings.** In `src/renderer/api/settings.ts` add `voice-assistant.enabled` (false), `voice-assistant.microphone` (empty is system default), `voice-assistant.silence-ms` (default 2000; choices 2000, 3000, 5000, 10000; normalize invalid or 0 to 2000), and `voice-assistant.threshold` (null means omit and use provider default; otherwise finite 0–1). Update key type, descriptions, defaults, setting and load normalization. Add the section in `src/renderer/editors/settings/settings-catalog.ts`, register its factory in `src/renderer/editors/settings/SettingsView.ts`, and implement `src/renderer/editors/settings/sections/VoiceAssistantSection.ts` with existing UIKit controls. Enumerate audio inputs, refresh on `devicechange`, show a missing saved device and permission errors.
- [x] **Enrollment.** Person field defaults to `Me`; no phrase field. Record wake and record stop separately, opening `enroll` with `phrase: kind`, person, kind and required PCM format. Limit clips to the lesser of the provider's `maxEnrollMs` and 2500 ms; allow finish/cancel, respect backpressure and discard PCM. Show quality, reason and match for each recording made in the current settings session; list earlier samples without scores. Group `list` by person/kind and any legacy custom phrase; delete by `sampleId`, refresh after mutation. Never store audio, embeddings or enrollment metadata in Persephone settings.
- [x] Enrollment in any settings window invokes `Endpoint.voiceAssistantPause({ reason: "enrollment", active: true })` before capture and sends false in `finally`, disposal and capture failure. Main tracks active senders so one finishing recording cannot clear another's pause, removes a sender's pause on destruction, and relays aggregate pause to the owner via `EventEndpoint.eVoiceAssistantPause`. While paused, stop assistant wake channels/capture; resume when all enrollment pauses clear. Add a small subscription hook to `src/renderer/ui/speech/LiveSpeechSessionCoordinator.ts`: notify listeners when `acquire()`/release changes `isBusy()`. The assistant observes the owner renderer's existing voice-typing/transcript lease without acquiring it; pause while busy and resume after release. Concurrent captures in other windows are allowed.
  - [x] Main-process enrollment pause aggregation and owner relay.
- [x] **Provider availability.** Follow voice typing's `openChannel()` selection: first v1 returned by `api.getBoardServiceProviders("speech.wake")`, then `describe`; only start if `local === true`. Do not select a remote provider. Report missing, not-ready, non-local, no enrollments, refusal, device and capture errors. Show “Install the Wake Word board to use voice assistant” when absent. Discover `speech.synthesize@1` without speaking; when absent show “Install the Text to Speech board for spoken replies; replies will appear as text” in settings and when relevant in the indicator. TTS absence never blocks capture. On wake service/channel close, stop both captures and channels, show status and retry discovery/describe/listen after `PROVIDER_RETRY_MS`; cancel retries on disable, pause, ownership loss or disposal. Refresh provider status when settings opens.
- [ ] **Wake contract and board, part of this task.** Update `assets/guides/agents/speech-wake.md`: add optional `start`, milliseconds from first input sample to matched phrase start, to both event types; consumers tolerate absence and use the fallback below. In the separate `persephone-boards` repository on `develop`, change `boards/wake-word/scripts/engine.mjs`: propagate the start column alongside each DTW predecessor as `subsequenceDistance()` computes its path; return `{ distance, startIndex }`, preserving Infinity behavior for empty inputs. Update `sampleDistance()` to consume `.distance`. In `boards/wake-word/scripts/service.mjs` retain sample-end metadata alongside embedding vectors in history, adjust for `matchWindow()`'s sliced history, retain the winning match's start index, and convert its embedding position to input milliseconds using `TEMPLATE.stepSamples`, the frontend's `sampleEnd` and the embedding window/lead geometry. Preserve existing matching, score, refractory and `time` behavior. Clamp `start` to `[0, time]`; examine `StreamingFrontend` and `encodeTemplate` padding and 76-frame window when determining the conservative phrase boundary. Use a numerical distance when calling `similarity`. Verify on real recordings that the emitted boundary covers the start of the spoken word and does not regress enrollment matching.
- [x] **Owner.** In `src/main/open-windows.ts`, retain the existing `mainWindow` semantics; maintain renderer-ready state and recompute `owner = first normal (!boardRoot) window that is visible and whose renderer is ready`. Broadcast `EventEndpoint.eVoiceAssistantOwnerChanged` with `{ windowId: number | null }` to all normal windows. Use Electron `BrowserWindow.id` consistently; expose the current id to each renderer through `Endpoint.voiceAssistantGetOwner` returning `{ windowId, ownerWindowId }` so late subscribers can initialize. Recompute in the `ready` callback at `open-windows.ts:48`, and after record removal in `windowOnClose` at line 81. In `src/main/open-window.ts`, register `show`, `hide`, `focus`, `closed` and `webContents` crash/reload listeners near the existing `ready-to-show` and `close` handlers at lines 151–185; notify `OpenWindows` through callbacks, clear ready on crash/reload, and recompute. The readiness signal comes through `src/ipc/main/window-handlers.ts:22`; adjust that handler/readiness callback so reload can set ready again. This covers close-to-tray at `open-windows.ts:166` and `hideWindows`/`showWindows` at lines 328–336. On owner change each renderer starts or stops its controller; no acknowledgement, process-wide lease or generation protocol. Brief overlap on handoff is accepted. Board windows never own capture; no visible normal window means none listens.
  - [x] Main-process ownership and renderer IPC transport.
- [x] **Status.** Add `Endpoint.voiceAssistantStatus` accepting `{ state, requestText?, replyText?, notice? }`; main caches the owner's latest ephemeral status and forwards it via `EventEndpoint.eVoiceAssistantStatus` to the focused visible normal window, and again when another normal window receives focus. Clear the cache on disable/owner loss and do not persist or log text. Add endpoints and events in `src/ipc/api-types.ts` and handlers in `src/ipc/main/core-handlers.ts`; use existing sender handling. Mount controller and overlay in normal windows from `src/renderer/ui/app/MainPageView.ts`, and stop channels, tracks, timers and pending work on pause, loss, close or disposal. Do not transfer an in-flight request across owners.
  - [x] Main-process status cache, focus relay and renderer IPC transport.
- [x] **Wake and loopback.** Add `src/renderer/ui/voice-assistant/VoiceAssistantController.ts`, `WakeServiceProvider.ts` and `voice-assistant-constants.ts`. Reuse `createSpeechServiceChannel`, `SpeechTranscriptionProvider`, pending-port routing, ordered bounded queues, `PcmAudioCapture`, microphone grant and transcript loopback capture. Open one mic and one loopback `listen` channel for the session; local describe precedes capture. Gate loopback using RMS level, pre-roll, hysteresis and tail; keep its channel open and send no audio while gated. Use the segment mapping below for event times; timestamps must be based on actual capture samples, not event arrival. If existing `PcmAudioCapture` callbacks cannot supply sufficiently accurate capture timing, extend it with sample timestamps. When loopback is unsupported or fails, continue mic-only and show “Computer-audio protection unavailable” in indicator and settings.
  - [x] Wake provider discovery, local description and service channel client.
- [ ] Compare wake detections for matching phrase/person using mapped capture times: loopback may lead mic by up to `LOOPBACK_LEAD_MAX_MS` or lag by up to `LOOPBACK_LAG_MAX_MS`. Keep mic request audio buffered beginning at its wake event, wait only lag plus delivery allowance, and discard it on suppression. On acceptance play the rising beep and begin transcription using buffered post-wake audio. Late loopback hits are logged but cannot retroactively suppress a decision. Debug log paired times, signed loopback-to-mic delta and scores only, never voice or request text. To measure, play an enrolled name through the intended TV, inspect paired delta logs from several trials at the listening position, and repeat while speaking over playback. External TV apps and phones are not protected; overlapping matching user speech may be suppressed.
  - [x] Implement correlation, buffered acceptance and timing diagnostics; TV measurement remains manual validation.
- [x] **Request lifecycle.** Implement the state table and handler below. While listening, hold the newest `STOP_HOLDBACK_MS` of PCM and stream only older audio to a live-capable transcription provider. On stop, translate `start` to mic sample offset; if absent use `max(0, time - LONGEST_PHRASE_MS)`. Split held chunks at that boundary, send only earlier audio, flush and send `end`; on silence flush all held audio then end. Ignore stop after completion. Live text may lag about three seconds. On sustained silence follow voice typing's committed segment/no pending utterance behavior; empty/cancelled requests return to waiting without handoff. Respect writable/whenWritable and bounded queues; release all samples after use. Play falling tone when sending. The 3 s holdback and fallback are practical heuristics, not an absolute guarantee against unusually long phrases or delayed detections; log late boundaries without audio/text.
- [x] **Indicator.** Add `src/renderer/ui/voice-assistant/VoiceAssistantOverlayView.ts` and co-located CSS; follow `doc/standards/component-guide.md` and `src/renderer/uikit/CLAUDE.md`: owned `VanillaView`, semantic status, `data-type`/`data-name`, scoped app CSS and theme colors. Show waiting/mic active, listening and live request, thinking, speaking and reply, unavailable/text-only notices. Keep final request visible until next request or disable when no handler exists.
- [x] **English strings.** Add `src/shared/i18n/en/settings.ts` keys `voiceAssistantTitle`, `voiceAssistantDescription`, `voiceAssistantEnabled`, `voiceAssistantMicrophone`, `voiceAssistantDefaultMicrophone`, `voiceAssistantSilence`, `voiceAssistantThreshold`, `voiceAssistantProviderDefault`, `voiceAssistantEnroll`, `voiceAssistantPerson`, `voiceAssistantPersonPlaceholder`, `voiceAssistantRecordWake`, `voiceAssistantRecordStop`, `voiceAssistantRecording`, `voiceAssistantSample`, `voiceAssistantDelete`, `voiceAssistantQualityAccepted`, `voiceAssistantQualityRejected`, `voiceAssistantFirstSample`, `voiceAssistantMatch`, `voiceAssistantWakeMissing`, `voiceAssistantTtsMissing`, `voiceAssistantProviderNotLocal`, `voiceAssistantProviderNotReady`, `voiceAssistantProviderRefused`, `voiceAssistantNoEnrollments`, `voiceAssistantDeviceMissing`, `voiceAssistantCaptureFailed`, `voiceAssistantLoopbackUnavailable`. Add `src/shared/i18n/en/voiceAssistant.ts` keys `off`, `waiting`, `listening`, `thinking`, `speaking`, `wakeMissing`, `ttsMissing`, `loopbackUnavailable`, `paused`, `providerFailed`, `cancelled`; register catalog and message types in `src/shared/i18n/en/index.ts`. Add localized quality reasons and errors required by the provider. Translate at epic close.
- [ ] **Manual validation.** Enroll multiple people and kinds; delete/reopen; check local/non-local, missing, refused, not-ready and restarted providers; microphone failure; stop and silence at 2000 ms; loopback film-only and film-plus-user, gate pauses and timing logs; mic-only fallback; owner close, tray hide/show, board window, voice typing, transcript and enrollment from another window; rapid cancellation and late opens; focus relay and text-only fallback. Verify no audio is stored in settings and capture stops when hidden. Run relevant build/lint checks. No unit tests or test harnesses.

### Settings scope

This task includes enable, enrollment, microphone, silence and sensitivity, and wake/TTS availability. Agent provider/model/effort, instructions, limits, voice/speed and new conversation are US-1787; media behavior and interrupt configuration are US-1788.

### State, seams and sound

Add `src/renderer/ui/voice-assistant/VoiceAssistantTypes.ts` and `VoiceAssistantHooks.ts`. The owner controller imports the shared hooks; US-1787 registers its handler with `setVoiceRequestHandler` during normal-window initialization and unregisters it on disposal. Hooks are per renderer, so register in each normal renderer that can become owner. The controller owns an `AbortController` for the current handler and aborts it on stop, disable, owner loss or disposal. US-1788 registers the interrupt callback; this task does not detect voice interrupts.

```ts
export type VoiceAssistantState = "off" | "waiting" | "listening" | "thinking" | "speaking";
export interface WakeEvent {
    type: "wake" | "stop";
    phrase: string;
    person: string;
    score: number;
    time: number;   // ms from first input sample, phrase end
    start?: number; // ms from first input sample, phrase start
}
export interface VoiceRequestHandler {
    handle(req: { text: string; person: string }, ctx: {
        signal: AbortSignal;
        setReply(text: string): void;
        setSpeaking(on: boolean): void;
    }): Promise<void>;
}
export function setVoiceRequestHandler(handler: VoiceRequestHandler | null): void;
export type VoiceInterruptHandler = () => void | Promise<void>;
export function setVoiceInterruptHandler(handler: VoiceInterruptHandler | null): void;
```

| State | Event | Next state and action |
|---|---|---|
| off | enabled, owner, ready and not paused | waiting; open capture |
| waiting | accepted mic wake | listening; retain person and buffered request, rising tone |
| listening | stop or silence, nonempty result | thinking; falling tone, invoke handler once |
| listening | empty result or cancel | waiting; discard request |
| thinking | handler `setSpeaking(true)` | speaking; show reply |
| speaking | handler `setSpeaking(false)` | thinking; preserve reply |
| thinking or speaking | handler settles | waiting; retain displayed text |
| thinking | no handler | waiting; retain request text |
| any | disabled, owner lost, capture paused or fatal error | off; release resources and abort handler |

Handler rejection shows an error and returns to waiting if still enabled/owner. Ignore late callbacks after cancellation. A later US-1788 interrupt calls the registered hook and aborts the current handler; no trigger is implemented now.

Use Web Audio oscillators with a gain envelope: rising tone 660 to 880 Hz over 120 ms; falling tone 880 to 660 Hz over 120 ms. Ramp gain linearly 0 to 0.08 in 10 ms, hold until 100 ms, ramp to 0 at 120 ms; stop oscillator and close/disconnect resources. No sound files.

### Constants and capture-time mapping

Keep tuning values together in `src/renderer/ui/voice-assistant/voice-assistant-constants.ts`:

```ts
export const LOOPBACK_LEAD_MAX_MS = 1500; // ms: output can precede the microphone through TV processing.
export const LOOPBACK_LAG_MAX_MS = 300; // ms: allow loopback detection to follow mic due to jitter.
export const DELIVERY_ALLOWANCE_MS = 300; // ms: additional time for provider delivery.
export const STOP_HOLDBACK_MS = 3000; // ms: delay PCM so a stop can be cut before transcription.
export const LONGEST_PHRASE_MS = 2500; // ms: conservative fallback when start is absent.
export const LOOPBACK_GATE_OPEN_RMS = 0.01; // normalized RMS: start forwarding audible output.
export const LOOPBACK_GATE_CLOSE_RMS = 0.006; // normalized RMS: hysteresis prevents gate chatter.
export const LOOPBACK_PREROLL_MS = 400; // ms: retain audio before gate opening.
export const LOOPBACK_TAIL_MS = 500; // ms: keep forwarding brief quiet gaps.
export const PROVIDER_RETRY_MS = 1500; // ms: back off after a provider restart.
export const MAX_QUEUED_CHUNKS = 32; // chunks: bound memory under channel backpressure.
export const CHANNEL_OPEN_TIMEOUT_MS = 15000; // ms: bound provider readiness wait.
```

Each loopback gate opening appends a segment at the first forwarded sample. `captureTimeMs` and mic origin share the same monotonic clock. Event offsets are based on the number of samples actually sent, not wall-clock duration. Keep segments until no pending detection can reference them; handle a `start` and `time` that fall in different segments separately.

```ts
interface SentSegment { sentSampleOffset: number; captureTimeMs: number }
const SAMPLE_RATE = 16_000;
function toCaptureTime(eventMs: number, segments: readonly SentSegment[]): number | undefined {
    const sample = eventMs * SAMPLE_RATE / 1000;
    const segment = [...segments].reverse().find(item => item.sentSampleOffset <= sample);
    return segment && segment.captureTimeMs + (sample - segment.sentSampleOffset) * 1000 / SAMPLE_RATE;
}
// Gate opens: segments.push({ sentSampleOffset: samplesSent, captureTimeMs: firstChunkCaptureTimeMs });
// After each ordered send: samplesSent += pcm.byteLength / 2; gate closed: send nothing.
```

Account for pre-roll when setting `firstChunkCaptureTimeMs`. Match against `micTime - LOOPBACK_LEAD_MAX_MS` through `micTime + LOOPBACK_LAG_MAX_MS`, and wait `LOOPBACK_LAG_MAX_MS + DELIVERY_ALLOWANCE_MS` after the mic detection arrives. An event arriving after the decision is diagnostic only.

### Existing-file edit anchors

These snippets give insertion points; include imports, types, handlers and cleanup.

```ts
// src/renderer/api/settings.ts — before
| "voice-typing.auto-stop-silence-ms"
// after
| "voice-typing.auto-stop-silence-ms"
| "voice-assistant.enabled" | "voice-assistant.microphone"
| "voice-assistant.silence-ms" | "voice-assistant.threshold"
```

```ts
// src/renderer/editors/settings/SettingsView.ts — before
"voice-typing": () => new VoiceTypingSettingsSectionView({}),
// after
"voice-typing": () => new VoiceTypingSettingsSectionView({}),
"voice-assistant": () => new VoiceAssistantSectionView({}),
```

```ts
// src/renderer/ui/app/MainPageView.ts — before
this.voiceTypingController.start();
// after
this.voiceTypingController.start();
if (!appWindow.isBoardMode) this.startVoiceAssistant();
```

```js
// boards/wake-word/scripts/service.mjs — before
const distance = subsequenceDistance(sample.embeddings, matchWindow(sample.embeddings, history));
// after: use vectors from history records, retain path start and numeric distance
const match = subsequenceDistance(sample.embeddings, matchWindow(sample.embeddings, history).map(item => item.vector));
const distance = match.distance;
```

## Concerns and decisions

1. **Stop boundary:** optional `start` is implemented in this task, with the requested 3000 ms holdback and 2500 ms fallback. The current provider permits 3000 ms enrollment and does not bound delivery time, so unusually long or late matches can escape the held tail. Measure and tune against real recordings; do not present this heuristic as a contractual guarantee.
2. **Enrollment scores:** decided: show quality and match for samples recorded in the current settings session only; earlier listed samples have no scores. No provider metadata extension is needed.
3. **Silence:** decided: default 2000 ms, with no off choice, because voice typing's default 0 would make requests never end without a stop word.
4. **Scope:** keep one task, including the additive guide and wake board changes. Ownership and local speech coordination are intentionally small; agent wiring and TV polish remain in later tasks.

## Acceptance Criteria

- [ ] Settings and enrollment work as scoped; disabled by default, person defaults to `Me`, current-session scores are truthful, and no voice data is stored in app settings.
- [ ] Only a local wake provider receives capture; errors, absent wake/TTS and unavailable loopback have actionable status. Loopback failure continues mic-only. Restarted wake service reconnects after backoff.
- [ ] First visible ready normal window owns wake capture; board and hidden windows do not. Owner changes stop/start capture, status follows focus, local voice typing/transcript and enrollment from any window pause the assistant.
- [ ] Asymmetric correlation uses capture-time segment mapping and the gate; accepted wake preserves buffered request and plays the rising tone. Late loopback hits are logged. Timing diagnostics permit TV measurement without audio/text logs.
- [ ] Updated guide and board emit optional start; the 3 s holdback cuts stop audio using start or fallback in normal recordings; silence flushes held audio at 2000 ms by default. Live text, falling tone, person and final request reach the seam; no handler returns to waiting with text visible.
- [ ] Speaking/reply and interrupt hooks are available; no agent session, TTS playback, media muting or full voice interrupts are implemented here.
- [ ] Manual scenarios and relevant build/lint checks pass; no unit tests or harnesses are added.

## Files Changed

| Path | Planned change |
|---|---|
| `assets/guides/agents/speech-wake.md` | Optional `start` contract and compatibility. |
| `C:/projects/persephone-boards/boards/wake-word/scripts/engine.mjs`, `service.mjs` | DTW start and event; separate repository, `develop`. |
| `src/renderer/api/settings.ts` | Keys, defaults and normalization. |
| `src/renderer/editors/settings/settings-catalog.ts`, `src/renderer/editors/settings/SettingsView.ts`, `src/renderer/editors/settings/sections/VoiceAssistantSection.ts` | Section, factory and enrollment. |
| `src/shared/i18n/en/settings.ts`, `src/shared/i18n/en/index.ts`, `src/shared/i18n/en/voiceAssistant.ts` | English messages and catalog registration. |
| `src/renderer/ui/voice-assistant/VoiceAssistantController.ts`, `WakeServiceProvider.ts`, `VoiceAssistantTypes.ts`, `VoiceAssistantHooks.ts`, `voice-assistant-constants.ts`, `VoiceAssistantOverlayView.ts`, `VoiceAssistantOverlayView.css` | Controller, service, seams, constants and overlay. |
| `src/renderer/ui/app/MainPageView.ts` | Normal-window lifecycle and overlay. |
| `src/renderer/ui/speech/LiveSpeechSessionCoordinator.ts` | Add busy-state subscription only. |
| `src/renderer/ui/speech/PcmAudioCapture.ts` | Add sample timestamps if needed for accurate segment mapping. |
| `src/main/open-windows.ts`, `src/main/open-window.ts`, `src/ipc/api-types.ts`, `src/ipc/main/core-handlers.ts`, `src/ipc/main/window-handlers.ts` | Owner, pause, focus/status relay and readiness. |
| `doc/tasks/US-1786-voice-assistant-core/README.md`, `doc/active-work.md`, `doc/epics/EPIC-139.md` | Plan and tracking. |

**No changes:** `src/renderer/ui/voice-typing/VoiceTypingController.ts` and `src/renderer/ui/transcript/TranscriptController.ts` (existing renderer-local lease); `src/main/module-service-supervisor.ts` (policies already exist); `src/renderer/ui/speech/SpeechServiceChannel.ts` and `SpeechTranscriptionProvider.ts` (reuse); `src/renderer/ui/agent-session/` and synthesis board (US-1787); media/browser playback (US-1788).
