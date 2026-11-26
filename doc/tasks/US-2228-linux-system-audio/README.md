# US-2228: System audio and meeting transcript on Linux

[EPIC-215](../../epics/EPIC-215.md) · Planned

## Goal

Enable system-audio capture and meeting transcription on Linux while preserving Windows behavior. Offer computer-audio echo cancellation only if its existing tuning is verified in the Ubuntu VM.

**Implementation state:** Linux capture is enabled; computer-audio cancellation remains disabled with its unverified-tuning reason pending Claude's VM measurement.

## Background

US-2224 measured Electron 44 on Ubuntu 26.04 GNOME Wayland: the existing `{ video: request.frame, audio: "loopback" }` grant produced a working system-audio track without a portal dialog. Chromium did not enumerate monitor sources as audio inputs. The VM's default microphone fails; its Virtual Mic works. See the epic's Capture decisions and Concerns. Linux release packaging is outside this task.

### Verified capture path

`src/shared/platform-features.ts` currently disables both audio features on Linux and supplies only a generic unavailable reason. `src/main/media-grants.ts` also hard-codes `platform: "win32"` for both loopback grants; `src/main/one-shot-frame-grant.ts` enforces it while arming. `src/main/permission-policy-service.ts` checks Windows in both the permission check and display-media handler. The grant is frame-bound, expires and is consumed once; retain these boundaries.

`src/renderer/audio/CaptureSourcePool.ts` rejects computer capture on non-Windows. `src/renderer/api/speech/MicrophoneCapture.ts` independently selects Chromium microphone processing and a private reference based on Windows; cancellation availability, not capture availability, must govern those choices. `src/renderer/editors/monaco/contributions/transcript/TranscriptController.ts` and `TranscriptToolbarContributionView.ts` also gate computer modes on Windows. `src/renderer/audio/dsp/echo-tuning.ts` sets a Windows-measured 64 ms reference lead; the VM measurement has not established cancellation quality.

### Verified surfaces and tests

`src/ipc/main/voice-typing-handlers.ts` denies loopback arming off Windows. `src/main/audio-service.ts` returns `no-handler` for both unavailable capture and cancellation after validating options; board authorization remains separate. `src/renderer/editors/settings/sections/MicrophoneAudioSection.ts` shows processing status but has no cancellation availability notice. Its catalog (`src/renderer/editors/settings/settings-catalog.ts`) supplies settings discovery metadata, and `src/renderer/api/settings-schema.ts` supplies setting comments. `src/shared/platform-capabilities.ts` describes the audio capability but does not explain platform availability. `assets/guides/agents/audio.md` is the normative board API guide; the other affected guide paths are listed below.

`integration-test/tests/capabilities/audio/audio.test.mjs` has separate Windows-tagged computer capture and cancellation tests. `integration-test/tests/capabilities/voice/voice-typing.test.mjs` covers microphone transcript and shortcut, not computer or Both. Owned UI tests use fake media and muted playback (integration-test/README.md); they cannot establish real loopback quality or cancellation. `eslint.config.mjs` lists each direct platform check as a shrinking baseline. No Rust crate or helper participates in this capture path.

## Implementation Plan

- [x] **Platform policy owner:** in `src/shared/platform-features.ts`, turn on Linux capture. Keep cancellation off initially, with a Linux-specific reason such as “Computer-audio cancellation is unavailable on Linux because its echo tuning has not been verified.” Extend the existing `getPlatformFeature`/`unavailableReason` policy to return that reason only when cancellation is unavailable on Linux; when available, the matrix wins. Keep other platforms' reasons and Windows values unchanged. This makes the final enable one matrix value, without changing callers.

  ```ts
  // Before → after (capture; cancellation remains false until measured)
  "audio.computerCapture": { win32: true, linux: false, darwin: false, unsupported: false },
  // →
  "audio.computerCapture": { win32: true, linux: true, darwin: false, unsupported: false },
  ```

- [x] **One-shot grant owner:** in `src/main/media-grants.ts`, use `getPlatformFeature("audio.computerCapture")` to configure eligibility for both `transcriptLoopbackGrant` and `audioWindowLoopbackGrant`. Replace the generic `platform` option in `src/main/one-shot-frame-grant.ts` with an injected eligibility predicate, preserving the transcript's clear-before-check and audio window's validate-before-clear ordering, expiry, frame binding, target validation, one-shot consumption and destruction cleanup. The generic grant owns lifecycle, not platform policy; the existing grant instances supply policy. Remove unused platform options and direct checks. No new protocol or message.
- [x] **Permission owner:** in `src/main/permission-policy-service.ts`, replace all three Windows checks, including `isTranscriptDisplay`, `isAudioWindowDisplay`, and `installAppDisplayMedia`, with `getPlatformFeature("audio.computerCapture").available`. Preserve the existing request shape checks, grant consumption, sender/frame validation, deny callback, and `{ video: request.frame, audio: "loopback" }` grant. In `src/ipc/main/voice-typing-handlers.ts`, use the same feature in `armTranscriptLoopback`, retaining `permission-denied` and `requireAppWindow`.
- [x] **Board capture owner:** in `src/main/audio-service.ts` `validateCapture`, independently query `audio.computerCapture` for `source === "computer"` and `audio.computerCancellation` for `cancelComputerAudio === true`. Keep option validation order and `no-handler`, using the feature's reason for unavailable cases; leave `BoardGrant` permission enforcement intact. In `src/renderer/audio/CaptureSourcePool.ts`, replace its Windows check with the capture feature and its reason; reuse its existing guarded display capture and source pool.

  ```ts
  // Before → after (same pattern for each feature)
  if (argument.source === "computer" && process.platform !== "win32") throw codedError("no-handler", "Computer audio capture is supported on Windows only.");
  // →
  const captureFeature = getPlatformFeature("audio.computerCapture");
  if (argument.source === "computer" && !captureFeature.available) throw codedError("no-handler", captureFeature.reason);
  ```

- [x] **Speech and transcript owners:** in `src/renderer/api/speech/MicrophoneCapture.ts`, use `audio.computerCancellation` for all three Windows decisions: request Chromium `echoCancellation` when unavailable, choose `noiseSuppression` using `microphone.clean` and cancellation availability, and acquire `openPrivateLoopback` only when available. Preserve Windows settings and Linux's existing fallback. In `src/renderer/editors/monaco/contributions/transcript/TranscriptController.ts` and `TranscriptToolbarContributionView.ts`, use `audio.computerCapture` for the start guard and disabled modes. When capture is unavailable, append the feature reason to each disabled item label via an English catalog message; `MenuItem` has no tooltip field. Keep available labels unchanged. In `src/renderer/api/speech/private-loopback.ts`, replace the Windows-specific missing-track error with platform-neutral wording. Update the translator notes in `src/shared/i18n/en/transcript.ts`.

  ```ts
  // Before → after (reference; requestMicrophone uses the same cancellation feature)
  referenceAcquire: process.platform === "win32" ? () => openPrivateLoopback(captureContext, options.borrowedLoopbackStream?.()) : undefined,
  // →
  referenceAcquire: getPlatformFeature("audio.computerCancellation").available ? () => openPrivateLoopback(captureContext, options.borrowedLoopbackStream?.()) : undefined,
  ```

- [x] **Not offered is data:** show the cancellation feature's reason in `src/renderer/editors/settings/sections/MicrophoneAudioSection.ts` when unavailable, using the existing section/text utilities and an English catalog message in `src/shared/i18n/en/settings.ts`. Update the Microphone Audio discovery description in `src/renderer/editors/settings/settings-catalog.ts` and `microphone.clean` comment in `src/renderer/api/settings-schema.ts` to expose the same feature-derived reason through settings and MCP settings help. Review audio capability help via `src/shared/platform-capabilities.ts`; make its capture summary use the same feature-derived availability and reason, keeping its signature and IDs unchanged. Use the existing `getPlatformFeature` rather than independent platform conditions. Translate catalog additions at epic close, not in this task.
- [x] Update `assets/guides/agents/audio.md`, `assets/guides/boards/trust-and-permissions.md`, `assets/guides/editors/monaco.md`, `assets/guides/shortcuts.md`, and `assets/guides/screens/settings.md`: capture works on Windows and Linux; distinguish cancellation and state its unverified Linux reason if it remains off. Correct Linux-facing Windows-default microphone wording in settings English messages and guide without changing device selection behavior. Reflect the final measurement outcome consistently.
- [x] Remove the eliminated entries from `existingPlatformChecks` in `eslint.config.mjs`: voice-typing handlers, audio service, one-shot grant, permission policy, microphone capture, capture pool, transcript controller and toolbar. Do not increase another allowance. Use direct imports from shared; no `await import()` or import-zone workaround. None of these owners is a roadmap §2.3 god file; do not grow one. Any genuinely new platform-specific behavior belongs in a focused collaborator beside its owner; the measured common Electron path needs none. Existing frame grants, feature lookup, board authorization and audio capture classes are the extension points. No helper startup is introduced; EPIC-215's helper-failure policy applies when helpers are used.
- [x] Add focused coverage in `integration-test/tests/capabilities/voice/voice-typing.test.mjs` for computer and Both transcript start, delivered fixture text, stop and cleanup. In `integration-test/tests/capabilities/audio/audio.test.mjs`, keep the computer capture test's `windows` tag for Claude to drop after its VM run; retain the cancellation tag while Linux is off. Add an unavailable cancellation `no-handler`/reason check where the harness can assert platform availability; test unauthorized/unarmed frame denial and single-use grants through existing test facilities without weakening them. Verify UI reason in settings and MCP help. Do not claim fake-media chunk delivery measures cancellation quality.

### Verification for the implementer on Windows

Run `npm run typecheck`, `npm run lint`, `npm run build-prod`, and `npm run guides:check` (guides are changed). Run `cargo build --release --manifest-path <crate>/Cargo.toml` for each touched Rust crate; no Rust changes are planned, so no cargo build is required unless scope changes. Do not run the app, Linux commands, or live UI checks as Codex. Do not trigger Linux CI automatically. Ask Claude to carry out the following and record results before considering implementation verified.

### Live checks for Claude

- [ ] On Windows, run the affected UI areas `npm run test:ui -- --area capabilities/audio,capabilities/voice` and manually verify computer capture, microphone voice typing, computer/Both transcript, board permission denial, and cancellation behavior remain unchanged. Check settings and MCP help.
- [ ] In the Ubuntu 26.04 GNOME Wayland VM, sync and run according to `doc/linux-development.md`; run `npm run test:ui -- --prod --area capabilities/audio,capabilities/voice`. Confirm the computer test actually runs after dropping its Windows tag. Select the working Virtual Mic if the VM default source fails. In the live app play known audio and confirm board computer capture, transcript Computer and Both (Me/Others), stop/restart and cleanup; confirm untrusted/unarmed capture is denied. Check Linux settings, MCP help, and guide text for cancellation's actual state. Verify ordinary microphone capture still works with Chromium fallback while cancellation is off.
- [x] **Not run (Claude, 2026-11-27):** a digital PipeWire loopback cannot validate the Windows-measured delay tuning for real Linux hardware, so cancellation stays off with its reason (see the epic Concerns). Original step: Measure cancellation in one VM session before deciding whether to enable it: use a PipeWire null sink and `pw-loopback` to route the output monitor into Virtual Mic. Play a known synthetic speech-like signal and record microphone PCM with cancellation off and on, temporarily flipping only the Linux cancellation matrix value in the VM build. Compare residual RMS and attenuation over repeated runs. Enable cancellation only if it measurably and repeatably reduces echo; if the route or result cannot be verified, restore Linux `false` and retain its reason. Do not adjust `echo-tuning.ts` to force enablement. If verified, make the one-line Linux matrix change and update the guide wording, then run the cancellation UI test on both platforms and drop its Windows tag only after it passes. This virtual route does not represent every physical device.

## Concerns

- Loopback capture is measured; cancellation delay and effectiveness are not. The default is unavailable until Claude provides positive evidence; a VM virtual route cannot represent all acoustic devices. No open decision blocks implementation.
- The VM default source failed in US-2224; use Virtual Mic and verify the actual route. Do not treat a fake-media test as the measurement.
- Keep US-2229 clipboard-specific files outside this task. The matrix, settings catalog, settings schema and English settings catalog are shared with US-2229; coordinate and preserve its concurrent edits in those shared files and the tracking files.


## Acceptance Criteria

- Linux computer audio works through board capture and transcript Computer/Both with existing permission and one-shot frame protections; Windows behavior is unchanged.
- All capture and cancellation decisions use the appropriate platform feature; the direct-check allowlist shrinks. Cancellation defaults off on Linux with a reason visible in settings, MCP help and guides unless Claude verifies it and enables the one matrix value.
- English UI copy is catalogued, guides reflect measured behavior, and affected tests and Windows checks above pass. Claude records Windows and VM live results and cancellation decision.
- No new IPC protocol, import-zone bypass, helper requirement, or roadmap §2.3 god-file growth.


## Files Changed

| Path | Planned change |
|---|---|
| `src/shared/platform-features.ts` | Capture matrix and cancellation reason; optional one-line cancellation enable after measurement |
| `src/main/media-grants.ts`, `src/main/one-shot-frame-grant.ts`, `src/main/permission-policy-service.ts`, `src/ipc/main/voice-typing-handlers.ts` | Feature-driven existing frame grants and permission checks |
| `src/main/audio-service.ts`, `src/renderer/audio/CaptureSourcePool.ts` | Feature-driven board capture and cancellation validation |
| `src/renderer/api/speech/MicrophoneCapture.ts`, `src/renderer/api/speech/private-loopback.ts` | Feature-driven reference and microphone fallback; neutral error |
| `src/renderer/editors/monaco/contributions/transcript/TranscriptController.ts`, `TranscriptToolbarContributionView.ts`, `src/shared/i18n/en/transcript.ts` | Transcript availability and copy |
| `src/renderer/editors/settings/sections/MicrophoneAudioSection.ts`, `src/renderer/editors/settings/settings-catalog.ts`, `src/renderer/api/settings-schema.ts`, `src/shared/i18n/en/settings.ts`, `src/shared/platform-capabilities.ts` | Availability reason in settings and discoverable help |
| `eslint.config.mjs` | Shrink platform-check baseline |
| `integration-test/tests/capabilities/audio/audio.test.mjs`, `integration-test/tests/capabilities/voice/voice-typing.test.mjs` | Capture, transcript and availability coverage; conditional tag removal |
| `assets/guides/agents/audio.md`, `assets/guides/boards/trust-and-permissions.md`, `assets/guides/editors/monaco.md`, `assets/guides/shortcuts.md`, `assets/guides/screens/settings.md` | Correct platform and cancellation descriptions |
| `doc/tasks/US-2228-linux-system-audio/README.md`, `doc/active-work.md`, `doc/epics/EPIC-215.md` | Plan, task link and recorded measurement outcome |

**No changes:** `src/renderer/audio/dsp/echo-tuning.ts` and the DSP pipeline (unless a separate, evidence-backed task retunes it); `src/shared/platform.ts` (US-2225's `helperExecutableName` is unrelated); `mneme/`, `snip-tool/`, IPC contracts, board bridge version, Linux packaging, and US-2229 clipboard files. The existing Electron loopback grant needs no new helper.
