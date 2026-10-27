# US-1732: Native memory leak in a board service during live transcription

## Goal

Find and fix the native memory growth in the Speech to Text board service process during long live
transcription, so an hour-long Transcript keeps the service's memory flat.

## Background

Measured on 2026-10-27 (EPIC-134 verification) with the editor Transcript in **Both** mode: two
live `speech.transcribe` channels, Ukrainian YouTube audio, about 15 minutes.

| Process | Start | After 14 min | Trend |
|---|---|---|---|
| Speech to Text service (utility process) | 154 MB | 287 MB | about +9 MB/min, linear, no GC drop |
| whisper-server | 1022 MB | 1023 MB | flat |

A `process.memoryUsage()` probe inside the service, sampled every 30 s for 3 minutes, showed:

- `heapUsed` flat at about 7 MB, `heapTotal` about 9 MB.
- `external` flat at about 10 MB, `arrayBuffers` 0.
- `LiveStream.parts` bounded (50–150 parts), VAD helper `stdin.writableLength` 0.
- `rss` still rising: 143 → 175 MB in 3 minutes.

So the growth is **native memory outside V8's tracked heap and buffers**, not the service's own
JavaScript. Two live channels carry about 3.8 MB/min of raw PCM, so the growth is about 2.3× the
audio rate.

The audio path: renderer `SpeechServiceChannel` → `MessagePort` → main → utility process
(`assets/module-service-host.mjs`, `persephone.service.onChannel`) → service `channel.onMessage`
(`Buffer.from(message.data)`) → `LiveStream.append()` → VAD helper stdin. Each partial pass then
builds a WAV and POSTs it to whisper-server with `fetch` + `FormData` (about two passes per second,
a 25 s window each).

## Implementation Plan

1. [ ] **Reproduce without a person.** Drive a live channel from a script with a recorded PCM file
       at real-time pace (the Speech to Text board's test path or a renderer script), and sample the
       service `rss` every 30 s. Confirm the ~9 MB/min rate with two channels.
2. [ ] **Isolate the layer**, one variable at a time, sampling `rss` for 5 minutes each:
       - one channel instead of two (does it halve?);
       - audio delivered but inference disabled (no `fetch`): points at message transport;
       - inference on a fixed WAV with no incoming audio: points at `fetch`/`FormData`/`Blob`;
       - audio received but neither stored nor forwarded to the VAD helper.
3. [ ] **Fix at the layer found.** Candidates: transferred `ArrayBuffer`s or ports not released in
       the utility-process message path (Electron `MessagePortMain`); undici `FormData`/`Blob`
       bodies retained by keep-alive connections (try a raw `http.request` with a `Buffer` body);
       child-process pipe buffers.
4. [ ] **Verify** with a 30-minute two-channel run: `rss` within ±20 MB of its value after warm-up.

## Concerns / Open Questions

- The leak may be in Electron itself (utility-process messaging). If so, the fix is a workaround
  (for example batching audio into larger, fewer messages) plus an upstream report.
- Whether other board services that stream binary data (Agent Chat) show the same growth is
  unknown; check one once the cause is known.

## Acceptance Criteria

- A two-channel live Transcript running 30 minutes keeps the service process `rss` flat after
  warm-up (±20 MB).
- The cause is named in this document, along with the layer it was found in.
- No unit tests or harnesses are added to the repository; measurement scripts stay outside it.

## Files Changed Summary

| File | Change |
|---|---|
| To be decided after step 2 | `assets/module-service-host.mjs`, `src/main/module-service-*.ts`, or `persephone-boards/boards/speech-to-text/scripts/service.mjs` |
| `doc/active-work.md` | Planned entry |
