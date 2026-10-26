# EPIC-134: Live transcription and meeting transcripts

## Status

**Status:** Active
**Created:** 2026-10-26

## Overview

EPIC-133 shipped speech to text as **record, then transcribe**: nothing appears until you stop.
This epic makes the text appear while you speak, committed phrase by phrase at each pause, and then
reuses the same machinery to transcribe long recordings — a Teams meeting, for example — from the
microphone and the audio the computer plays, into a timestamped transcript saved on disk.

Everything rests on one capability the platform does not have yet: **reliable pause detection**
in a live audio stream. An earlier proof of concept of live transcription failed, so the epic
starts with research into how existing open-source Whisper projects detect pauses and segment
speech, before any design is fixed.

## Goals

- While dictating (Alt+V / Right Ctrl voice typing, the Agent Chat mic button), text appears at
  each natural pause instead of only after stop.
- Optional auto-stop after a configurable silence.
- Boards can capture the computer's audio output (loopback) as well as the microphone, behind an
  explicit board permission the user approves.
- The Speech to Text board can transcribe an hour-long meeting live: chunks cut at pauses, each
  line timestamped and labelled **Me** (microphone) or **Others** (computer audio), appended to a
  transcript file as it goes.
- All processing stays local: no cloud service, no API key.

## Background (verified 2026-10-26)

- **Provider.** The Speech to Text board (persephone-boards `boards/speech-to-text`, v1.0.1) runs
  whisper.cpp 1.9.5 `whisper-server` on demand and calls `/inference` once per recording. The
  service receives 16 kHz mono PCM s16le over a `speech.transcribe` v1 channel and replies with
  one final transcript. About 3 s warm for 28.6 s of speech on the GPU; a 2.5 s clip takes about
  1.2 s with the language forced and 2.2 s with auto-detection (BT-058 measurements).
- **Contract.** `speech.transcribe` v1 is documented in `assets/guides/agents/speech-transcribe.md`.
  It has no partial-result messages; adding them is a contract change (a `features` entry or v2).
- **Consumers.** Persephone voice typing (`src/renderer/ui/voice-typing/VoiceTypingController.ts`)
  and Agent Chat (`boards/claude-agent/app.js`) stream PCM and insert the final text.
- **System audio.** Chromium can capture what the computer plays: the main process grants it with
  `session.setDisplayMediaRequestHandler(..., { audio: "loopback" })`. Persephone exposes no such
  capture to boards today; it would follow the microphone permission pattern (EPIC-119
  off-by-default manifest permissions, the trust dialog listing the grant).
- **Speakers.** whisper.cpp cannot tell speakers apart in mixed audio. Keeping the microphone and
  loopback as separate streams gives **Me** / **Others** labels for free; naming individual remote
  speakers would need a diarization model and is out of scope.
- **Earlier proof of concept.** Live transcription during speech was tried before the Speech to
  Text board and failed: a separate pause-detection model cut the audio into very short (roughly
  word-sized) chunks that overlapped one another, and the transcripts were unusable. It was not
  investigated further. Details and the hypotheses to check are in US-1726.

## Phases

1. **Pause detection research** (US-1726) — survey open-source projects that already pair Whisper
   with voice-activity detection and live segmentation, measure the candidates against our engine,
   and recommend a design. Gate: the user agrees with the recommendation.
2. **Live dictation** — segmenting in the provider, partial/committed text in the
   `speech.transcribe` contract, voice typing and Agent Chat showing text as it is committed;
   optional auto-stop after silence. Tasks planned after phase 1.
3. **System audio capture for boards** — a Persephone permission and API for loopback audio.
4. **Meeting transcripts** — a Meeting mode in the Speech to Text board: microphone + loopback as
   two labelled sources, long-running chunked transcription, a live transcript view saved to a file.

Phases 3–4 depend on phase 2's segmentation; phase 3 can be built in parallel with phase 2.

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| [US-1726](../tasks/US-1726-pause-detection-research/README.md) | Research pause detection for live transcription | Done |

Phase-2 tasks proposed by US-1726, to be created when phase 2 starts:

| Task | Repo | Size |
|---|---|---|
| Streaming VAD helper in the whisper runtime (new revision of the BT-055 build) | persephone-boards | M |
| Live segmentation in the Speech to Text service: VAD, hybrid drafts and commits, absolute offsets | persephone-boards | L |
| `speech.transcribe` live feature: guide and contract (`draft`, `segment`) | persephone | S |
| Voice typing: insert committed segments as they arrive, draft in the overlay, optional auto-stop | persephone | M |
| Agent Chat: live insertion with a grey draft | persephone-boards | S |
| Audio left-context for short utterances (measure first) | persephone-boards | M |

## Risks and concerns

- **Hallucinations on short or silent segments.** Whisper invents text ("Thank you.",
  "Дякую за перегляд!") on silence and very short clips; segmentation must not feed it silence.
- **Words cut at segment boundaries**, and lost context between segments (the previous text as a
  prompt is the usual remedy).
- **Language detection on short segments** — BT-058 already showed short phrases drift into other
  languages; per-segment auto-detection may be worse than per-recording.
- **GPU cost** of transcribing every segment, and of re-transcribing drafts, during an hour-long
  meeting while the user's other work runs.
- **Consent and data.** Recording a meeting without telling the participants can be unlawful where
  every party's consent is required, and may break company policy. Meeting audio can contain
  sensitive or regulated data. The feature should remind the user to announce the recording, and
  transcripts stay local.
- **Licenses.** Ideas can come from any project; code or models we ship must be MIT/Apache/BSD
  compatible (Silero VAD is MIT).

## Notes

### 2026-10-26
- Created on the user's request after asking whether meetings could be transcribed from computer
  audio. User decision: start with pause detection, since live dictation is needed on its own and
  meeting transcription builds on it; research existing open-source Whisper projects first.
- Epic placed in **Planned**, not Active; moved to Active when US-1726 started.
- US-1726 done; user accepted its design: Silero VAD in the Speech to Text service, run by a small
  helper built with the whisper runtime over whisper.cpp's streaming VAD API; the hybrid policy
  (draft at a 500 ms pause, commit the whole utterance at a 1200 ms pause, 1 s pre-roll, full audio
  context — `-ac` reduction ruled out after it caused repetition on Ukrainian); an additive `live`
  feature in `speech.transcribe` v1. Measured: English 0/40 word errors vs whole-file, Ukrainian
  3/28, all in one short isolated phrase that 15 s of preceding audio fixes (a later, measured
  step).
