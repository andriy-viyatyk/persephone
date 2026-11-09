# US-1798: DTLN microphone cleaning and loopback echo cancellation

**Status:** Completed. Standalone task; supports [EPIC-139](../../epics/EPIC-139.md).

## Goal

Use DTLN-aec 128 as the single managed microphone cleaning engine, reducing noise everywhere and computer playback when a Windows audio-service microphone has a loopback reference. Preserve speech during double talk.

## Background

The Windows `computer` loopback includes other applications and Persephone's own `audio.play` and browser tabs. It must feed the model continuously before `ComputerAudioGate`. User confirmed a 152 Hz Q8 −18 dB notch after DTLN sounds right. Disabling Chromium AEC for a loopback-backed stream does not remove Persephone audio from the reference; actual cancellation quality still needs validation.

The 2026-11-07 Chromium off/on microphone RMS measurements were 0.0248/0.00014 for `audio.play` tone, 0.00385/0.00015 for another Persephone page tone, and 0.075/0.082 for Firefox YouTube speech (computer stream 0.199). Subsequent film tests found Chromium removed neither other apps' nor Persephone's film audio, and its AGC raised the track 3.6 dB. In the 2026-11-09 lab AEC3 removed up to 18 dB but cut double talk; DTLN-aec 128 removed 21 dB, preserved the user's voice best by ear, and ran at about 0.15× real time single-threaded. Chromium AEC and AEC3 are rejected as the loopback engine.

In three lab recordings loopback `timeMs` was 3–13 ms late relative to mic (cross-correlation lags −3, −4, −13 ms). Reference shift lag − 50 ms worked; AEC3 worked across −13 to −150 ms. Offsets can differ across devices.

User measurements for `.persephone/boards/echo-cancel-lab/recordings/s1794257532119-*`, voice plus loud phone noise without computer audio: 20th-percentile 20 ms-frame noise and 95th-percentile speech levels were −45/−31 dBFS raw and −70/−32 dBFS after DTLN, a 25 dB noise reduction with speech unchanged; an all-zero reference gave identical output. By ear, the former engine removed noise similarly but did not remove YouTube. These are reported measurements on one recording, not a guarantee for all noise.

The git-ignored `.persephone/boards/echo-cancel-lab/dtln-worker.js` and `vendor/dtln-aec/reference-run.py` are the proven reference. DTLN-aec 128 (MIT, https://github.com/breizhn/DTLN-aec) is a two-model ONNX pipeline converted using tf2onnx 1.17, opset 17, checked against TFLite to 5e-5. ONNX Runtime Web 1.31.1 (MIT) uses WASM in a worker with one thread.

`src/renderer/audio/audio-window.ts` shares one device-selected-rate `AudioContext`, a computer source and microphones keyed by requested options, and gates 200 ms computer PCM chunks. `PcmAudioCapture` taps context-rate frames; `LoopbackReference` aligns them and `DtlnAudioPipeline` processes them at 16 kHz. Transcript and voice typing consume mono 16 kHz s16le.

## Implementation plan

1. [x] **Settings and scope.** Keep `microphone.clean` as the switch for DTLN noise cleaning when no consumer requests computer-sound removal, plus existing `microphone.attenuation-db` (default 30, 0 unlimited) and device `microphone.notches`. No computer-sound settings key or sub-option: each consumer requests its reference. Run DTLN whenever `microphone.clean` is on or a Windows consumer requests computer-sound removal. A request enables DTLN and its noise removal even when `microphone.clean` is off; without a request, cleaning on uses zero reference and cleaning off keeps the direct path. The attenuation limit and device notch settings apply whenever DTLN runs. Changes to cleaning reconfigure captures without releasing a still-requested reference. Update help in `src/renderer/api/settings.ts`, `src/renderer/editors/settings/settings-catalog.ts`, `src/renderer/editors/settings/sections/SettingsSections.ts`, `src/shared/i18n/en/settings.ts` and `assets/guides/screens/settings.md`: explain that consumer-requested loopback runs DTLN noise removal even with cleaning off, along with attenuation and consumer-requested loopback, without adding a setting. Translate changed English messages at completion. Keep `src/renderer/ui/speech/microphone-settings.ts` subscriptions for private capture settings.

2. [x] **Board contract.** Add `cancelComputerAudio?: boolean` to `CaptureOptions` in `src/renderer/audio/audio-window.ts` and `validateCapture` in `src/main/audio-service.ts`; default false. Accept only booleans for microphones; reject the option on `computer` capture and reject its presence with `processing: "raw"`, even false, as a microphone-processing option incompatible with raw. On non-Windows reject **true** with `no-handler`, matching existing unsupported `computer` capture; omitted/false still capture a microphone normally. Include the validated option in the returned open message. Update `src/main/capability-registry.ts` capture argument description and `assets/guides/agents/audio.md`.

   ```ts
   // Before: validateCapture key allowlist
   ["source", "deviceId", "echoCancel", "processing"]
   // After
   ["source", "deviceId", "echoCancel", "processing", "cancelComputerAudio"]
   // Before: sourceKey microphone suffix
   `${options.processing ?? "default"}\u0000${options.processing === "raw" ? false : options.echoCancel ?? true}`
   // After: default/false share, true is a different underlying source
   `${options.processing ?? "default"}\u0000${options.processing === "raw" ? false : options.echoCancel ?? true}\u0000${options.cancelComputerAudio ?? false}`
   ```

   In `src/shared/board-bridge-version.ts` bump `BOARD_BRIDGE_VERSION` from `1.53.0` to `1.54.0`; guide boards using the option to declare `minBridgeVersion: "1.54.0"` and the shipping `minAppVersion`. Preserve `audio@1` and independent source subscribers. `echoCancel` controls Chromium AEC, default true; `cancelComputerAudio: true` enables DTLN loopback regardless of `echoCancel` and `microphone.clean` on Windows. When both are true, switch Chromium AEC off because DTLN's loopback includes Persephone playback; if loopback acquisition later fails, remain on zero-reference DTLN with a visible status until retry/restart, rather than silently re-enabling Chromium.

   ```ts
   // Before: requestStreamNow
   echoCancellation: options.processing === "raw" ? false : options.echoCancel ?? true,
   // After: loopbackRequested includes Windows, default processing and cancelComputerAudio === true, regardless of microphone.clean
   echoCancellation: options.processing === "raw" || loopbackRequested ? false : options.echoCancel ?? true,
   ```

   `src/main/audio-service.ts` `authorize` continues to require `microphone` for this option, not `computerAudio`: internal reference samples stay inside Persephone and never reach the board. Direct `computer` channels still require `computerAudio`. Explain the internal loopback and indicator in the guide; no recording starts merely because an option exists.

3. [x] **Shared reference helper.** Add `src/renderer/ui/speech/LoopbackReference.ts` with one API for all three callers, for example `LoopbackReference.start({ context, acquire, onPair, onStatus })`, `pushMicrophone(samples, frame)`, `pushReference(samples, frame)`, and idempotent `stop()`. `acquire` returns a reference lease exposing timestamped raw context-rate frames and `release()`; callers supply their existing already-owned stream/tap or a grant-protected opener, so the helper never opens a second source in Transcript Both or the audio window. It resamples mic and reference independently to 16 kHz, aligns on shared-context frame timestamps using `ECHO_TUNING`, emits ordered paired 128-sample hops to `DtlnAudioPipeline`, and switches to zero reference with status on 300 ms stall/acquisition failure. Require reference and mic taps to originate from **the exact same AudioContext**; stop/release only what the helper owns. Preserve raw float fanout and buffer ownership, serialize acquisition, bound rings/queues, and handle cancellation during startup, retry, source end and final close. Use the helper for zero-reference mode too, without an alignment wait.

4. [x] **Audio-service sharing.** In `src/renderer/audio/audio-window.ts`, extend `SharedSource`, `acquireSource`, `releaseSource`, `attach`, `finish` and `onCaptureChunk` with internal reference leases alongside subscribers. The helper's `acquire` uses the existing one-key computer source, serialized `requestStream` and one-use audio-window grant, tapping context-rate float frames before `ComputerAudioGate`; it must never open another computer source if a board already has one. Keep board computer delivery gated and 200 ms as today. Release a lease on last requesting mic, request removal, restart, failure or stop; preserve source while any subscriber/lease remains.

   ```ts
   // Before: releaseSource
   if (source.subscribers.size) return;
   // After
   if (source.subscribers.size || source.referenceLeases.size) return;
   // Before → after: publishCaptureCount counts every active source including internal loopback
   [...sources.values()].filter((source) => source.active).length
   ```

   Verify `publishCaptureCount` and `src/main/audio-service.ts` final-close paths keep the dot/tray indicator on while internal loopback is running, including last-channel close races; stop loopback before publishing zero and destroying the window. Failure falls back to zero reference with a visible status, while DTLN noise cleaning continues.

5. [x] **Transcript and voice typing.** `src/renderer/ui/transcript/TranscriptController.ts` currently passes `undefined` as the context to both `PcmAudioCapture.start` calls, so each creates a private context. In `start` create and own one session `AudioContext`; pass it to both captures in `openCapture` and close it once in `finish` after both taps/captures stop. On Windows, request loopback independently of `microphone.clean` for `"microphone"` and `"both"`; `"computer"` has no mic cancellation. In Both, retain the computer `MediaStream` opened first, attach a raw pre-processing tap to that same stream/context through the helper, and keep the normal computer transcription capture untouched. This reduces computer audio entering the separately labelled `Me:` stream, without changing `Others:`. In microphone-only mode use the helper's grant-protected opener for one internal reference. Keep cleanup ownership explicit: stopping the helper must not stop a borrowed Both stream; stop it only after both uses finish. If internal reference acquisition fails, continue mic transcription with zero-reference cleaning and report status; failure of the explicitly selected computer source retains its existing error behavior.

   ```ts
   // Before: TranscriptController.openCapture calls capture.start with private context
   }, undefined, source.kind === "microphone" ? microphoneOptions(stream) : undefined, status);
   // After: both captures share the session context; microphone receives the helper's reference
   }, this.audioContext, source.kind === "microphone" ? microphoneOptions(stream) : undefined, status);
   ```

   In `src/renderer/ui/voice-typing/VoiceTypingController.ts` `openMicrophone`, `startCapture`, `stopCapture` and session teardown, request a reference on Windows independently of `microphone.clean`, open it on the same context passed to the mic capture, and stop/close owned stream and context on every stop, cancel and startup race. Preserve zero reference on non-Windows and when not requested. For both controllers disable Chromium AEC while a loopback-backed pipeline is requested; preserve old Chromium AEC otherwise. In `src/renderer/ui/speech/PcmAudioCapture.ts` `reconfigureMicrophone`, replace its current `!this.ownsContext` early return with a safe shared-context reconfiguration path that preserves the session context and other source, and pass an explicit per-capture effective constraint/context/reference policy so toggling clean or retry cannot re-enable Chromium on a requested DTLN loopback or close a borrowed shared context:

   ```ts
   // Before
   await stream.getAudioTracks()[0]?.applyConstraints({ channelCount: 1, echoCancellation: true, noiseSuppression: !next.enabled, autoGainControl: true });
   // After: engineEnabled = next.enabled || loopbackRequested; recompute the Chromium constraint
   await stream.getAudioTracks()[0]?.applyConstraints({ channelCount: 1, echoCancellation: effectiveEchoCancellation, noiseSuppression: !engineEnabled, autoGainControl: true });
   ```

   `api.armVoiceTypingMicrophone()` grants audio input only. Transcript already calls `api.armTranscriptLoopback()` / `clearTranscriptLoopback()` around `getDisplayMedia({ audio: true, video: true })`; these existing guarded endpoints in `src/ipc/main/core-handlers.ts` accept a live app main frame, and `src/main/permission-policy-service.ts` binds the Windows-only grant to that frame for five seconds, checks it for empty-media-types permission and consumes it once in `installAppDisplayMedia` before returning `audio: "loopback"`. Reuse this path for both private openers without weakening sender/frame checks or adding a voice-typing display permission. Serialize arm/request/clear per app window because a new grant replaces the previous one; stop video immediately, check an audio track exists, and clear in `finally`. If existing endpoint names are kept, document their broader internal use; change `src/ipc/api-types.ts`, `src/ipc/renderer/api.ts`, and `src/ipc/main/core-handlers.ts` only if renamed. Ensure `requestStreamNow` and private `getUserMedia` also set `noiseSuppression` from effective DTLN engine activity rather than `microphone.clean` alone. The current audio-service dot counts service sources only; ensure private reference activity is visibly indicated by Transcript/voice-typing active UI, and if using the generic dot for them, aggregate separately owned counts rather than letting audio-service `setAudioCaptureCount(0)` erase them.


6. [ ] **Vendor and load models/runtime.** Copy `dtln_aec_128_1.onnx` and `_2.onnx` into `assets/vendor/dtln-aec/` (2,004,210 and 5,284,713 bytes) with MIT license and conversion/provenance README. Copy ORT 1.31.1 `ort.wasm.bundle.min.mjs` and `ort-wasm-simd-threaded.wasm` (14,848,852 bytes) into `assets/vendor/onnxruntime-web/` with MIT notice. Do not ship `ort.wasm.min.mjs` or `ort-wasm-simd-threaded.mjs`. Statically import the bundle from the cleaning worker so Vite bundles it; fetch the WASM and both models as bytes from `app-asset://vendor/...`, set `ort.env.wasm.wasmBinary`, `numThreads = 1`, `proxy = false`, leave `wasmPaths` unset, then `InferenceSession.create(Uint8Array)` for each model. Do not import scripts from `app-asset:`. Add exactly those three fetched asset paths to the CORS allowlist in `src/main/main-setup.ts`.

   Progress: copied models and runtime, integrated the worker and CORS entries. Offline app and packaged verification remain.

   Cached official ORT 1.31.1 `package/dist/ort.wasm.bundle.min.mjs` is 77,024 bytes; inspection found one `import(` and one `ort-wasm-simd-threaded.mjs` reference. Its `po` loader selects embedded `io` glue with no `wasmPaths` override and supplied WASM bytes; dynamic import remains a fallback branch. Verify no external MJS request in dev and packaged builds. `electron-builder.yml` ships `assets` as extraResources. `audio.html` has `worker-src 'self' blob:`, `script-src 'self' blob: 'unsafe-eval'`, and `connect-src 'self' app-asset: ws://localhost:5273`; verify actual worker, fetch and WASM initialization offline under these rules and make only necessary CSP changes. Also verify the main window CSP for private captures.

7. [x] **Replace the engine, preserving the reference algorithm.** Use `src/renderer/ui/speech/DtlnAudioPipeline.ts` and `src/renderer/ui/speech/dtln-cleaning-worker.ts` to own one persistent sequential DTLN worker per cleaned microphone, for both audio-window and private `PcmAudioCapture` callers. Port `.persephone/boards/echo-cancel-lab/dtln-worker.js` and `vendor/dtln-aec/reference-run.py`: 16 kHz mono, 512-point real FFT, sliding 512-sample blocks, 128-sample hop, 384-sample initial padding; model 1 uses mic and reference magnitudes and recurrent state, multiplies its mask into complex mic spectrum, inverse FFT; model 2 uses that time block, loopback time block and state; overlap-add and emit 128 samples. Preserve numeric casts, FFT normalization and both states across hops. Model 1 takes `input_3` mic `[1,1,257]`, `input_4` reference magnitude and `input_5` state; model 2 takes `input_6` masked block `[1,1,512]`, `input_7` reference block and `input_8` state. Each returns `Identity` and `Identity_1` state. Initialize both sessions once per worker, WASM provider, unity gain. Deliver zero reference for non-Windows, unrequested references, and failed or stalled reference streams. Use no input gain stage: the proven model uses unity input; verify quiet speech by ear. Keep raw-aligned samples for step 8.


8. [x] **16 kHz, notch and attenuation.** Extract/generalize stateful windowed-sinc `resample()` in `src/renderer/ui/speech/LoopbackReference.ts` for independent input/output rates and preserved history/low-pass filtering. In `src/renderer/ui/speech/PcmAudioCapture.ts` `start`, tap timestamped context-rate floats before `consume`; resample mic and ungated loopback independently to 16 kHz before DTLN. Both the audio-window shared context and private context must use their actual `context.sampleRate`, not assume 48 kHz. Chain is context → 16 kHz → DTLN → attenuation limit → device notch at 16 kHz → existing 16 kHz s16le chunker. No 16→48→16 round trip. With cleaning off and no reference request, retain the current direct capture path and no notch; when a request runs DTLN, apply the configured attenuation and enabled device notch.

   ```ts
   // Before: worklet samples in PcmAudioCapture.start
   if (this.cleaning) this.cleaning.push(data.data);
   else this.consume(data.data, onChunk, this.context?.sampleRate ?? OUTPUT_SAMPLE_RATE);
   // After: cleaning owns context→16 kHz conversion and accepts timestamped reference separately
   if (this.cleaning) this.cleaning.push(data.data, data.frame);
   else this.consume(data.data, onChunk, this.context?.sampleRate ?? OUTPUT_SAMPLE_RATE);

   // Before: the former notch configuration
   const w = 2 * Math.PI * n.frequency / 48000;
   // After: apply the notch after DTLN at the model's output rate
   const w = 2 * Math.PI * n.frequency / 16000;
   ```

   Existing settings accept notch frequencies through 20,000 Hz, above the new 8 kHz Nyquist limit: preserve stored profiles without silently rewriting them, bypass an enabled notch at or above 8,000 Hz, and show an explanation in Settings; restrict newly entered frequencies to 20–7,999 Hz in `SettingsSections.ts` while retaining legacy values on load in `settings.ts`. Verify this migration behavior manually. Preserve notch state and coefficient smoothing across hops, resetting on discontinuities; adjust smoothing for 16 kHz to preserve its time constant. Implement attenuation as a **frame-RMS floor** on the time-aligned dry and model output: for nonzero `att`, `floor = rms(raw_aligned) * 10**(-att/20)`; scale the wet hop to a target RMS clamped between that floor and dry RMS, with a guarded zero-wet case using scaled dry. For `att === 0`, use unmodified DTLN. This bounds suppression and gain at hop RMS level rather than individual samples or frequencies, avoids the phase cancellation and level boost of adding dry to wet, and must not clip samples (apply a final headroom limiter). Smooth gain transitions while maintaining the RMS bound where headroom permits; the final limiter can override the lower bound to prevent clipping. Evaluate musical artifacts and speech by ear. A frame-RMS bound approximates the former spectral attenuation limit; document it in Settings help. The 8 kHz band limit is acceptable for the existing 16 kHz PCM consumers. Keep source `timeMs` with each async output instead of mutable `currentInputFrame`.

9. [ ] **Align the reference.** Add to `src/renderer/ui/speech/microphone-cleaning-types.ts` a commented constants block:

   ```ts
   // Later loopback timestamp makes the reference lead delayed mic (lab shift −64 ms).
   export const ECHO_TUNING = { referenceLeadMs: 64, referenceStallMs: 300, maxPendingMs: 500 } as const;
   ```

   The DTLN hop whose mic samples end at capture time `t` pairs with reference samples ending at `t + 64 ms`; process it only after reference through `t + 64 ms` arrives. This is lab shift −64 ms, approximately 51–61 ms physical lead for the observed late timestamps. Use common 16 kHz sample-time rounding and a bounded ring; pad only startup. If required reference is still absent after 300 ms, report reference failure and switch to zero reference, keeping DTLN noise cleaning; do not silently treat a stall as real silence. Reset alignment, model LSTM/overlap and resampler state on gaps, reference recovery or device changes; retain monotonic sample timestamps. Do not impose the 64 ms wait on deliberate zero-reference captures. Planning estimate: loopback path 64 ms alignment + 24 ms DTLN lookahead + 0–200 ms chunk accumulation = **88–288 ms**; zero reference is **24–224 ms**, both plus inference, resampling, devices and scheduling. Verify actual end-to-end latency.

10. [x] **Queues, recovery and status.** `DtlnAudioPipeline` bounds worker pending samples and handles worker/status fallbacks for 128-sample/8 ms DTLN hops, ordered serial session runs, sequence/ack and at most 500 ms queued audio. Measure ratio, backlog and missed deadlines. Load asynchronously with a 10-second deadline and bounded buffering, delivering uncleaned microphone while initializing. If loopback acquisition, track, device or stall fails, use zero reference and report it separately from model cleaning status. On model/WASM/worker failure or sustained overload, fall back to uncancelled, uncleaned microphone (or notch-only if available) and report cleaning failure; do not send `reportSourceStatus(..., "failed", ...)`, which closes audio-service channels and private captures. Discard stale generation outputs, preserve timestamps and reset state at transitions. Reacquire loopback on ended track/default output change; resume only with aligned reference. Extend `src/ipc/audio-channels.ts`, `src/main/audio-service.ts` and `SettingsSections.ts` to prevent simultaneous cleaning and reference statuses masking one another. Ensure retry, settings, stop and grant races cannot deadlock or leak.

11. [ ] **Docs, parity and A/B gate.** Update `assets/guides/agents/audio.md` for `echoCancel`, shared reference, permissions, raw bypass, default cleaning, fallback, timing and gated board stream; update `assets/guides/screens/settings.md` Microphone Audio help and existing setting controls; explain in both guides that a consumer request runs DTLN noise removal even when `microphone.clean` is off; update Settings help/English catalog and `doc/epics/EPIC-139.md` while retaining Wake Word's matching-detection safety net. Update any relevant developer docs, including `doc/architecture/ui-element-contract.md` and `doc/architecture/scripting.md` setting lists. Make a dev-only `execute_script` recipe or temporary uncommitted script feeding `.persephone/boards/echo-cancel-lab/recordings/s1794256805572-raw.wav` and `s1794256805572-reference.wav` through the app's actual worker at unity gain, unlimited attenuation (`0`), notch disabled and lab shift −64 ms; run the lab DTLN 128 with identical inputs/shift, compare aligned float samples including startup and state continuity (max absolute difference ≤ 5e-5), and record commands/results. Generate lab output if needed; do not compare Chromium output.

   The user accepted the three-noise listening comparison; see Validation. Other exercises remain unreported: Windows dev/packaged offline, Transcript source combinations, non-Windows and unrequested zero reference, sharing, gate, indicator, permissions, stall, slow worker, model failure, retry, default-device change and final close. CPU, queue, latency and Wake Word false-trigger measurements remain unreported.

12. [ ] **Remove the retired engine.** Remove its vendor assets and notices, CORS entry, unused worker and pipeline, tuning constants, and obsolete help and translations. The unused code, CORS entry, and tuning have been removed; the vendor directory remains because the command policy rejected deletion.

## Validation

- **2026-11-09:** The user compared fan, keyboard, and music/TV noise by ear and judged DTLN acceptable in all three. The user also tested Transcript, voice typing, and `cancelComputerAudio` live and judged DTLN acceptable. No numerical measurements were supplied.
- The runtime initialized and both models ran on zero input under Node using local WASM bytes. App-worker parity, offline packaged/CSP checks, measured latency, and the remaining device, recovery and Wake Word exercises have not been reported.
- All five changed microphone messages are translated in every built-in pack with current English hashes. `npm run i18n:check` and direct `node scripts/i18n-check.mjs` both hit `spawn EPERM` in esbuild; the checker's exported `runI18nCheck()` was run with Node and a TypeScript transpile hook and reported 1673/1673 for all 17 packs, with no stale hashes.

## Concerns / Open questions

- Consumer-requested loopback adds capture and CPU while eligible; the global cleaning setting alone does not acquire loopback. Models/runtime add ~22 MB decimal.
- Private captures formerly processed at 48 kHz; DTLN limits processing to 16 kHz / 8 kHz bandwidth. Transcript and voice typing already request 16 kHz PCM, so their delivered format is unchanged, but quality can still differ; include them in listening checks.
- The 64 ms policy covers observed lags only; output buffering, drift, device changes and room echo vary. Confirm measured offset and double talk on target devices. Reference loss must remain visible even while zero-reference cleaning succeeds.
- Existing notch profiles can contain frequencies at or above 8 kHz; these are preserved but bypassed with an explanation because they cannot be applied after 16 kHz resampling.
- The RMS attenuation floor differs from a frequency-bin limit. Check noise character, transients and clipping at 0, 30 and 100 dB; acceptance depends on user judgment. Model load/worker failure remains a visible uncleaned fallback, unlike loopback failure.

## Acceptance criteria

- [ ] `microphone.clean` enables zero-reference DTLN when no loopback is requested; a consumer request runs DTLN with loopback and noise removal even if it is off. Boards opt in with `cancelComputerAudio`, default false; non-Windows rejects true with `no-handler`, raw rejects the option. `echoCancel` controls Chromium; DTLN reference is independent and disables Chromium while requested, including reference failure fallback. Cleaning off with no request retains the direct path and Chromium follows `echoCancel`; configured attenuation and notch apply whenever DTLN runs. Bridge version and guide require 1.54.0.
- [ ] One ungated audio-service loopback is shared through leases with board subscribers, and streams with different opt-in values have separate source keys. Only microphone permission is needed for internal reference; direct computer capture still requires `computerAudio`. The capture indicator stays on while internal loopback runs. Transcript Both reuses its computer stream on one context, microphone-only and voice typing open one reference via the guarded grant, and computer-only has no cancellation. Failure/stall reports zero-reference fallback without stopping noise cleaning or exposing PCM.
- [ ] Manual app-worker/lab parity for `s1794256805572` is within 5e-5 at unity gain, unlimited attenuation and notch off; two-model ORT WASM runs locally with correct licenses, one thread, both window CSPs, dev and packaged offline.
- [ ] Context-rate inputs convert to 16 kHz, then DTLN → bounded attenuation → 16 kHz device notch → PCM; no 48 kHz round trip. Bounds, zero/unlimited, no clipping, settings changes and speech quality are manually verified.
- [ ] Timestamp pairing uses `t + 64 ms`, 300 ms stall fallback and bounded queues. Timestamps stay monotonic; zero-reference paths avoid the 64 ms alignment wait. Measure latency against the estimates and report model/loopback failures distinctly.
- [ ] User accepts the three specified noise types by ear before the former assets and code are removed. Manual device, sharing, capture, recovery, CPU and Wake Word checks are recorded; guide and EPIC-139 reflect behavior, and English UI text is translated at completion.

## Files changed

| File | Planned change |
|---|---|
| `src/renderer/audio/audio-window.ts` | Shared ungated reference leases, settings, timing and lifecycle. |
| `src/renderer/ui/speech/PcmAudioCapture.ts`, `DtlnAudioPipeline.ts`, `DtlnEngine.ts`, `dtln-cleaning-worker.ts`, `microphone-cleaning-types.ts`, `LoopbackReference.ts` | DTLN, shared reference helper, resampling, 16 kHz notch, attenuation, queue and tuning. |
| `src/renderer/ui/speech/microphone-settings.ts`, `src/renderer/ui/transcript/TranscriptController.ts`, `src/renderer/ui/voice-typing/VoiceTypingController.ts` | Private capture settings, shared context and consumer-requested reference lifetimes. |
| `src/renderer/api/settings.ts`, `src/renderer/editors/settings/settings-catalog.ts`, `src/renderer/editors/settings/sections/SettingsSections.ts`, `src/shared/i18n/en/settings.ts` | Existing settings help, notch range and independent status; no new setting. |
| `src/ipc/audio-channels.ts`, `src/main/audio-service.ts`, `src/main/capability-registry.ts`, `src/shared/board-bridge-version.ts` | Board option validation/schema, bridge 1.54.0, separate status and lifecycle. |
| `assets/vendor/dtln-aec/`, `assets/vendor/onnxruntime-web/` | Models, ORT bundle/WASM, provenance and licenses. |
| `src/main/main-setup.ts`, `audio.html` and main window CSP if needed | Narrow CORS entries and any necessary CSP adjustments. |
| `assets/guides/agents/audio.md`, `assets/guides/screens/settings.md`, `doc/epics/EPIC-139.md`, relevant `doc/architecture/` files | Update current contracts, Settings guide and architecture references. |
| `assets/languages/` at completion | Translate new and changed English UI messages. |

## Files needing no change

- `src/renderer/ui/speech/ComputerAudioGate.ts`: tap reference before the existing gate.
- `src/renderer/ui/speech/microphone-device.ts`: retain real-device resolution for notch selection.
- `src/main/permission-policy-service.ts`, `src/ipc/api-types.ts`, `src/ipc/renderer/api.ts`, `src/ipc/main/core-handlers.ts`: reuse existing guarded Transcript grant endpoints for private capture; no changes if names are kept. Board permission declarations remain unchanged.
- `src/renderer/ui/app/MainPageView.ts`, `src/main/audio-capture-state.ts`, `src/main/tray-setup.ts`: existing generic indicator suffices if source count/lifecycle stays correct.
- `electron-builder.yml`: existing extraResources ships assets; verify packaged output.
