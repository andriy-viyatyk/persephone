# US-1798: Loopback-referenced echo canceller for the audio service

**Status:** Planned, to be investigated in the future. Not part of an epic.

## Goal

Remove sound played by **other applications** (Firefox, VLC, any player) from the audio service's
microphone stream. The canceller uses the `computer` loopback stream as its echo reference, so a
board capturing the microphone doesn't hear a film's dialogue playing on the same computer.

## Background

- **Audio service:** the `audio` capability (US-1790) captures the microphone and the computer's own
  sound in a hidden audio window, on one shared clock (`epoch` + `timeMs`). The main files are
  `src/main/audio-service.ts` and `src/renderer/audio/audio-window.ts`, and the contract is
  `assets/guides/agents/audio.md`.
- **Current echo cancellation:** the microphone stream has `echoCancel` (default `true`), which maps
  to Chromium's `echoCancellation` constraint.
- **Measured 2026-11-07 (US-1790)** on the user's speakers. Values are microphone RMS:

  | Source | Cancel off | Cancel on |
  |---|---|---|
  | Tone via `audio.play` | 0.0248 | 0.00014 |
  | Tone from another Persephone page | 0.00385 | 0.00015 |
  | YouTube speech in Firefox (computer stream 0.199) | 0.075 | 0.082 |

  Chromium cancels everything Persephone plays, but nothing other apps play.
- **Why it matters:** the voice assistant (EPIC-139) must not wake on a name spoken by a film. Until
  this task lands, the only defence for other apps' sound is the Wake Word board's detection rule
  (EPIC-139 decision 4): ignore a microphone detection that has a matching computer-stream
  detection.

## Investigation to do

- **Canceller engine:** a wasm build of speexdsp (`speex_echo_*`) or a WebRTC AEC3 port, run in an
  AudioWorklet or a worker in the audio window. Check the licence, size and CPU cost at 16 kHz mono.
- **Delay:** the alignment and drift between the loopback and the microphone. The shared clock gives
  a first estimate, and the filter has to cover the room and TV delay (often 50–300 ms).
- **Gating:** the computer stream is level-gated. The canceller needs the reference ungated, or must
  treat gaps as silence.
- **API shape:** a new microphone option, such as `echoCancel: "all"` or a separate
  `cancelComputer: true`, plus how it is shared under the existing capture key.
- **Measurement:** use the US-1790 method (microphone RMS with the canceller on and off) on the
  user's TV and on speakers, with film speech playing in Firefox or VLC. Also check how many Wake
  Word false triggers remain.

## Concerns

- Room echo on a TV is long and nonlinear. Expect the echo to be reduced, not removed.
- The CPU cost runs continuously while Wake mode is on.
- When the user speaks over the film (double talk), the canceller must not damage the user's own
  voice.

## Acceptance Criteria

To be written after investigation.
