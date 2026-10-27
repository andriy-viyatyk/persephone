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
  Its additive `live` feature advertises optional draft previews and final utterance segments through
  `features`; consumers still handle the final result alone when a provider does not advertise it.
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
| BT-060 (persephone-boards) | Streaming VAD helper in the whisper runtime (`whisper-runtime-1.9.5-r2`) | Implemented |
| BT-061 (persephone-boards) | Live segmentation in the Speech to Text service | Implemented |
| US-1727 | `speech.transcribe` live feature: guide and contract (`draft`, `segment`) | Implemented |
| [US-1728](../tasks/US-1728-voice-typing-live/README.md) | Voice typing — live text as you speak | Implemented |
| [US-1729](../tasks/US-1729-board-service-locale/README.md) | Give board services the app locale | Implemented |
| [US-1730](../tasks/US-1730-board-multiselect-setting/README.md) | Multi-select board setting | Implemented |
| BT-062 (persephone-boards) | Streaming partial commits (local agreement): words typed 2–4 at a time while speaking | Implemented |
| BT-063, BT-064, BT-065 (persephone-boards) | Speech to Text main screen, app-language default, language picker | Implemented |
| BT-066 (persephone-boards) | Agent Chat: live insertion of committed phrases (phase 2) | Planned |
| [US-1731](../tasks/US-1731-editor-transcript/README.md) | Transcript button in the text editor: microphone and computer audio typed live (phases 3–4) | Planned |
| BT-067 (persephone-boards) | Speech to Text: hour-long live sessions (no duration cap for live, bounded memory and queue) | Planned |

The proposed audio left-context task is covered by BT-062: committed text is the prompt and the
uncommitted audio window carries the left context.

## Design decisions for phases 3–4 (2026-10-27, revised the same day)

The user chose to build the remaining phases before closing the epic, then moved meeting
transcription out of the Speech to Text board and into the text editor. A first plan (a board
`systemAudio` permission plus a Meeting section in the board) was replaced before implementation.

**No draft text in Persephone (user decision).** Uncommitted draft text is not shown anywhere in
Persephone: voice typing, the editor transcript and Agent Chat insert committed phrases only. Live
drafts stay visible only in the Speech to Text board's own test panel. US-1731 removes the grey
draft that US-1728 added to voice typing.

**Transcript in the text editor (US-1731).**
- A **Transcript** button on the Monaco text page toolbar, shown only when a `speech.transcribe`
  provider advertising `live` is available (the same discovery voice typing uses).
- Clicking it offers **Both**, **Computer audio**, **Microphone (me)**. While running, the button
  shows an audio level indicator and reads **Stop**; clicking it again stops.
- Text is typed live and always **appended to the end of the page**, never at the cursor: the user
  may click, select or copy text while it runs. In **Both** mode each committed utterance starts a new line labelled
  `Me:` or `Others:`; with one source, each utterance is a new line without a label.
- Persephone captures the computer's audio itself. No board permission is needed: the app session's
  display-media handler answers a one-shot request armed by the transcript controller with
  `audio: "loopback"` and the requesting app frame as the video source (verified on Electron 43 in
  a standalone probe: a "System audio" track that stays live after the video track stops). Windows
  only.
- Two live `speech.transcribe` channels run side by side. Transcription continues while the tab is
  inactive and stops when the page closes or leaves the text editor. The text lives in the page
  content, so the unsaved-content cache keeps it; the user saves the page as usual.
- No consent notice (user decision): the Transcript is a general tool (a call, a video playing on
  the computer, dictating notes), not a meeting recorder, and a dialog on start is only friction.
  Everything stays local.
- Not handled: echo when speakers are used without headphones, and naming individual speakers.

**Hour-long live sessions (BT-067, persephone-boards).**
- The `speech.transcribe` contract states that `maxAudioMs` limits non-live requests; a live
  request is not capped by total length (US-1731 updates the guide). The Speech to Text service
  drops its byte cap for live requests and keeps per-request memory flat: a bounded audio window,
  a rolling prompt tail, no per-segment arrays.
- Both channels share one whisper-server. Under load the service skips draft and partial jobs
  first and never drops a committed segment.

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
