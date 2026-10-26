# US-1726: Research pause detection for live transcription

**Epic:** [EPIC-134](../../epics/EPIC-134.md) — Live transcription and meeting transcripts
**Status:** Done 2026-10-26 — recommendation accepted by the user
**Type:** Research — no product code

## Goal

Find out how mature open-source Whisper projects detect pauses and segment a live audio stream,
measure the best candidates against our own engine (whisper.cpp 1.9.5 `whisper-server` in the
Speech to Text board), and recommend one design for EPIC-134 phase 2 (live dictation) that will
also carry phase 4 (meeting transcripts).

## Background

### Our pipeline today

- **Provider:** persephone-boards `boards/speech-to-text/scripts/service.mjs`. It collects 16 kHz
  mono PCM s16le from a `speech.transcribe` v1 channel, wraps it as WAV on `end`, and posts it to
  `whisper-server` `/inference` once. Language handling (`allowedLanguages`, forced retry,
  token-weighted `avg_logprob` confidence) is from BT-058.
- **Runtime:** whisper.cpp v1.9.5 built by BT-055 (`whisper-runtime-1.9.5-r1`, Vulkan,
  `GGML_BACKEND_DL`). Default model: large-v3-turbo q5_0.
- **Measured costs (BT-056/BT-058):** about 3 s warm for 28.6 s of speech; a 2.5 s clip is about
  1.2 s with the language forced and 2.2 s with auto-detection.
- **Consumers:** Persephone voice typing
  (`src/renderer/ui/voice-typing/VoiceTypingController.ts`, 3,200-sample chunks) and Agent Chat
  (`boards/claude-agent/app.js`, `audio-capture-worklet.js`). Both already compute an input level
  for their meters.
- **Contract:** `assets/guides/agents/speech-transcribe.md` (v1) — final text only, no partial
  results.

### The earlier proof of concept

Live transcription during speech was tried before the Speech to Text board and failed. It is not
recorded in either repository; this is the user's account (2026-10-26):

- The agent used a **separate pause-detection model** that split the recording into chunks, each
  meant to hold roughly one word (the user is not sure of the exact granularity).
- The chunks produced **no valid text**. The agent found that **chunks overlapped**: each contained
  audio from neighbouring chunks, so the transcripts were a mess.
- There was no deeper investigation and no second attempt; the user chose to ship record-then-
  transcribe as the first version, which works well for them.

What this suggests for the research (hypotheses to check, not conclusions):

- **Chunks were far too short.** Whisper needs phrase-level context; word-sized clips are where it
  fails most and hallucinates most. Segments should end at real pauses between phrases (hundreds of
  milliseconds of silence), not between words.
- **Overlap was handled wrong.** Overlap (or speech padding) around a cut is normal, but the text
  from the overlapping audio must be de-duplicated, for example by comparing word timestamps or by
  committing only the words two passes agree on. Feeding overlapped clips independently and joining
  their text duplicates and scrambles words.
- **The bug may have been in buffer bookkeeping** (sample offsets of the chunks), not in the idea.
  Any design we adopt must be checked with a test that reconstructs the input from the chunks and
  confirms no audio is duplicated or lost.

Every candidate below is judged against these failure modes: chunk size, overlap handling, and
buffer offsets.

### Candidates to study

Each entry is a starting point; verify the repository, its license, and the claims while
researching.

| Project | Why it is relevant |
|---|---|
| whisper.cpp — `examples/stream` and the built-in VAD (Silero model in GGML form, `--vad` options) | Same engine we ship. Check whether 1.9.5 `whisper-server` accepts VAD parameters, and how `stream` slides its window (`--step`, `--length`, `--keep`). |
| snakers4/silero-vad | The VAD model most projects use (MIT). ONNX and PyTorch builds; thresholds, minimum speech and silence durations, speech padding. |
| ricky0123/vad (`@ricky0123/vad-web`) | Silero VAD in the browser via onnxruntime-web — could run in a board page or an AudioWorklet next to capture. |
| ufal/whisper_streaming (and its successor SimulStreaming) | Live policy: LocalAgreement (commit words two consecutive passes agree on), buffer trimming at sentence ends, VAD/VAC option. |
| collabora/WhisperLive | Client/server live transcription with Silero VAD; how segments are finalised and sent. |
| KoljaB/RealtimeSTT | Two-stage VAD (WebRTC VAD then Silero), pre-recording buffer, post-speech silence, a fast "realtime" model for drafts plus a final model. |
| SYSTRAN/faster-whisper `vad_filter` | Silero parameters chosen for batch transcription of long files (meeting-like input). |
| m-bain/WhisperX | VAD-cut segmentation of long recordings, and why it avoids hallucinations on silence. |
| chidiwilliams/buzz | Desktop app with live recording over whisper.cpp; a product-level view of the same problem. |

### Questions the research must answer

1. **Where does VAD run** — in the capture page (AudioWorklet / onnxruntime-web), in the board
   service (Node + ONNX), or inside whisper.cpp? What does each cost in latency and dependencies?
2. **Segmentation policy** — speech threshold, minimum silence to cut (typical 300–800 ms), minimum
   and maximum segment length, padding kept around speech, what happens on a long monologue with no
   pause.
3. **Committing text** — commit per segment, or draft-then-commit (re-transcribe a growing buffer,
   LocalAgreement)? Which gives readable live text with the fewest corrections?
4. **Quality at boundaries** — cut words, and context carried between segments (previous text as
   the prompt), especially for Ukrainian and mixed Ukrainian/English.
5. **Hallucinations** — how each project avoids Whisper inventing text on silence or noise.
6. **Language** — detect once per session vs per segment; interaction with BT-058's allowed list.
7. **Throughput** — GPU time per segment with large-v3-turbo; whether a smaller model for drafts is
   worth it; behaviour over an hour (memory, drift).
8. **Meeting fit** — does the same policy work for two streams (microphone and loopback) in parallel?
9. **License** — what can be reused as code or shipped as a model, versus used only as an idea.

## Implementation plan

All steps done on 2026-10-26. The user accepted the recommendation, including the VAD helper built with the whisper runtime.

1. *(Done 2026-10-26.)* The earlier proof of concept is recorded above.
2. For each candidate, read its segmentation/VAD code and README; record in a **Findings** section
   (added to this document as each one is verified): approach, parameters, license, and the answers
   it gives to the questions above. Cite file paths and versions.
3. Check whisper.cpp v1.9.5 specifically: VAD flags in `whisper-server` and `whisper-cli`, the
   Silero GGML model's size and download source, and whether `/inference` accepts VAD per request.
   Record what the runtime built by BT-055 already supports.
4. Run a small measurement with our runtime, outside the product code (scratch scripts only): one
   recorded Ukrainian and one English clip of 1–2 minutes with natural pauses, segmented by the
   one or two most promising policies — at least one commit-per-pause policy and one
   draft-then-commit policy, so approaches are compared, not just one tried. Check first that the
   segments reassemble into the original audio with no duplicated or missing samples. Record
   segment count, latency from end of speech to committed text, word errors at boundaries, and any
   hallucinated lines.
5. Write a **Recommendation** section: where VAD runs, the segmentation parameters, the
   commit strategy, the contract change needed in `speech.transcribe` (partial/committed messages,
   a `features` entry vs v2), and the consumer changes. List the tasks to create for EPIC-134
   phase 2, with rough size.
6. Present the recommendation to the user. Phase 2 tasks are created only after they agree.

## Findings (2026-10-26)

Sources were read from each project's default branch through the GitHub API, and whisper.cpp at
tag v1.9.5. Licenses were checked against each project's LICENSE file.

### Voice activity detection

| Option | License | What matters for us |
|---|---|---|
| **Silero VAD** (snakers4/silero-vad v6.2.3) | MIT | 2.3 MB ONNX (`silero_vad.onnx`); exactly 512 samples (32 ms) per frame at 16 kHz plus a 64-sample context and an LSTM state, so frames must be fed in order; under 1 ms per frame on one CPU thread. `get_speech_timestamps` defaults: threshold 0.5, off threshold 0.35 (hysteresis), min speech 250 ms, min silence 100 ms, pad 30 ms, a cut over `max_speech_duration_s` lands at the last silence of 98 ms or more. `VADIterator` is the streaming form: 0.5 / 100 ms / 30 ms, with no min or max speech. |
| **whisper.cpp built-in VAD** (since v1.7.6; present in our 1.9.5 runtime) | MIT | A GGML port of Silero; model `ggml-silero-v6.2.0.bin`, 885,098 bytes, from `huggingface.co/ggml-org/whisper-vad`. Our `whisper-server.exe --help` lists `--vad`, `-vm`, `-vt`, `-vspd`, `-vsd`, `-vmsd`, `-vp`, `-vo`. `/inference` also takes `vad`, `vad_threshold`, `vad_min_*`, `vad_max_speech_duration_s`, `vad_speech_pad_ms` and `vad_samples_overlap` per request (`examples/server/server.cpp` lines 594–620); the model path is startup-only. Segment times are mapped back to the original audio. **It only filters silence inside one request: it cannot tell a live stream where to cut.** All inference runs under one mutex, so requests are served one at a time. |
| **@ricky0123/vad-web** v0.0.31 | ISC | Silero in the page: the AudioWorklet frames audio, onnxruntime-web runs the model on the page's main thread. About 13.5 MB of assets to serve (the ORT wasm is 11.2 MB), default model `legacy` (v5/v6 must be chosen), and probably `'wasm-unsafe-eval'` in the CSP (unverified). |
| `@echogarden/fvad-wasm` (WebRTC VAD) | BSD-3 | Tiny and fast, but much worse in noise. |

### Live transcription policies

| Project | License | How it commits text | What we take from it |
|---|---|---|---|
| **KoljaB/RealtimeSTT** (`RealtimeSTT/core/*.py`) | MIT | Two-stage VAD (WebRTC, then Silero at sensitivity 0.4); 1.0 s pre-roll ring buffer; end of speech after 0.16 s silence candidate + 0.6 s post-speech silence; minimum recording 0.5 s. **The whole utterance is transcribed once at the pause and committed atomically — no stitching.** An optional preview model re-transcribes the growing utterance (every 0.2 s) and a stabilizer (2 confirmations over 0.6 s) keeps it from flickering; the final text replaces the preview. | The dictation pattern. |
| **ufal/whisper_streaming** (`whisper_online.py`) | MIT | Re-transcribes one growing buffer every 1 s; **LocalAgreement-2** commits the longest common prefix of the last two hypotheses, so committed words never change. Drops words that start before the last commit, removes a repeated 1–5-word n-gram at the boundary, trims audio only at the end of a committed segment (buffer over 15 s), keeps offsets in absolute samples, prompts with the last 200 characters of trimmed committed text. The VAC mode (Silero, 500 ms silence, 100 ms pad) resets at each utterance and flushes the tail at its end. | The way to commit inside a long utterance and to keep offsets right over an hour. |
| ufal/SimulStreaming | MIT | AlignAtt: stops decoding where cross-attention nears the audio end. Needs PyTorch decoder internals. | Not usable through whisper.cpp's public API (unverified). |
| **collabora/WhisperLive** | MIT | Transcribes from `timestamp_offset`; commits every Whisper segment but the last and moves the offset to its end; force-commits a partial unchanged for 10 iterations; drops segments with `no_speech_prob` > 0.45; trims the buffer at 45 s. | A simpler alternative for long recordings, plus the stall rule. |
| **whisper.cpp `examples/stream`** | MIT | Sliding window (step 3 s, length 10 s, keep 200 ms) that redraws a line with no de-duplication; its `--step 0` VAD mode is a simple energy test and does not clear the buffer, so the same speech can be transcribed twice. | What not to copy. |
| faster-whisper `vad.py`; whisperX `merge_chunks` | MIT; BSD-2 | For files: silence 2000 ms, pad 400 ms; whisperX packs VAD segments into chunks of up to 30 s, each decoded with its original offset. | The meeting packing idea. |

Every project avoids exactly what failed in the earlier proof of concept. None transcribes
word-sized fragments independently and joins the text: each transcribes a whole utterance, or
re-transcribes from the last commit point inside one buffer, and cuts audio only where text is
already committed.

### Measurements on our engine

Scratch simulator (outside both repos): Silero VAD (ONNX, Python) on 512-sample frames fed in
order as if live; segments cut at pauses with 200 ms padding and **no overlap** (asserted for every
run); each segment posted to a scratch `whisper-server` 1.9.5 (large-v3-turbo q5_0, Vulkan on the
integrated Intel GPU, language forced to `en`) with the last 200 characters of committed text as
the prompt. The test clip is 38.2 s of English text-to-speech with pauses of 200–2500 ms and a
14 s sentence with no pause longer than 350 ms. Latency is measured from the end of speech to the
committed text (the silence wait plus inference).

| Policy | Segments | Word errors (of 89) | Latency avg / max | Inference calls / total time |
|---|---|---|---|---|
| Whole clip in one request (today's mode) | 1 | 0 | — (5.0 s after stop) | 1 / 5.0 s |
| Cut at 300 ms silence | 10 | 1 ("and" → "in") | 2.05 / 2.24 s | 10 / 17.3 s |
| Cut at 500 ms silence | 6 | 0 | 2.32 / 3.22 s | 6 / 10.1 s |
| Cut at 800 ms silence | 6 | 0 | 2.38 / 3.40 s | 6 / 9.7 s |
| 500 ms, server started with `-ac 768` (15.4 s window) | 6 | 0 | **1.26 / 1.34 s** | 6 / 4.8 s |
| …the same without the prompt | 6 | 0 | 1.11 / 1.15 s | 6 / 3.9 s |
| …with a 1 s draft re-transcription while speaking | 6 | 0 | 1.16 / 1.28 s | **34 / 23.8 s** |
| …with forced cuts at 5 s (quietest frame of the last 3 s) | 10 | 0 | 1.60 / 3.60 s | 10 / 6.1 s |

What the numbers say:

- **Phrase-sized segments at real pauses work.** 500 ms is the sweet spot: 300 ms cut inside
  sentences and cost a word, and 800 ms added latency for no gain.
- **Each request has a fixed cost**: Whisper pads every clip to a 30 s window, so a one-word clip
  took about 1.4 s. Starting the server with a smaller audio context (`-ac 768`, about 15 s) halved
  the cost with no errors on this clip, **but it made Whisper repeat a sentence on the user's
  Ukrainian recording (below), so it is ruled out.**
- **Forced cuts mid-sentence stayed correct** ("…because the type" / "definitions were not
  updated…"), because the cut lands on the quietest frame and the prompt carries the context.
- **Drafts are expensive**: re-transcribing every second while speaking took 5× the inference time
  (23.8 s of GPU time for 38 s of audio, 62% of real time on this integrated GPU). That is
  affordable for short dictation, not for an hour-long meeting.
- The prompt did not change the words on this clip; it should matter more for casing and
  punctuation across cuts and for mixed languages.

#### The user's own voice

Two microphone recordings by the user (MP3, 48 kHz stereo, decoded to 16 kHz mono in Persephone's
renderer): 28.6 s of Ukrainian and 31.8 s of English, with natural thinking pauses mid-sentence.
There was no hand-written reference, so the reference is the whole file transcribed in one request
on a full-window server (the language forced). Word errors below count differences from that.
The converted copies were deleted after the measurement.

| Policy (500 ms pause unless noted) | Ukrainian (of 28) | English (of 40) | Latency avg |
|---|---|---|---|
| Commit per pause, 200 ms pad, full window | 5 | 3 | 1.76 / 1.55 s |
| …same, `-ac 768` | 5 | 3 | 1.07 / 1.02 s |
| …500 ms pre-roll, `-ac 768` | **16 — first sentence repeated twice** | 3 | 1.10 / 1.02 s |
| Commit per pause, 1000 ms pre-roll, 300 ms pad, full window | 4 | — | 1.60 s |
| **Hybrid: draft at 500 ms, commit the whole utterance at 1200 ms, 1000 ms pre-roll, 300 ms pad, max 25 s, full window** | **3** | **0** | 2.6 / 2.3 s |

What the real voice showed:

- **Thinking pauses happen mid-sentence.** A 500 ms cut split "у моїй" into "ум." / "моїй" and
  clipped phrase starts. Committing per short pause is not good enough for real dictation; the
  **hybrid** (short pause → draft, long pause → re-transcribe the whole utterance and commit) fixed
  every mid-sentence split.
- **Pre-roll matters.** 1 s of audio before detected speech (RealtimeSTT's value) took English from
  3 errors to 0.
- **`-ac 768` is ruled out.** It halved latency but made Whisper repeat a whole sentence on an 8.5 s
  Ukrainian segment; the full window never did. Keep the default audio context.
- **A short phrase on its own is the remaining failure.** All 3 Ukrainian errors are in the final
  2.6 s phrase "Це був тест голосу", which came back as "Щось це був тест улоса". The segment bounds
  are not the cause (VAD speech 24.2–26.8 s; every window from 22.6 to 28.6 s gave the same text),
  and the text prompt does not fix it. **Preceding audio does:** transcribing from 13.6 s (15 s of
  audio) returned "Це був тест голосу." exactly, and from 17.0 s (11.6 s) nearly ("Ось це…"), at
  about 2.2 s per call instead of 1.1 s. Whisper needs a few seconds of the speaker's voice to
  settle on accent and language; a prompt cannot supply that.
- No text was hallucinated from room noise or silence: Silero kept every non-speech stretch out.

The sample is small (one minute in total, one speaker, one machine); the parameters below are a
starting point to tune in phase 2, not final values.

## Recommendation

1. **Where VAD runs: in the Speech to Text board's service,** on the PCM frames it already
   receives. Not in the consumers: Persephone voice typing, Agent Chat and any future consumer get
   live text without each shipping a VAD, and the page stays light. Not inside whisper.cpp's
   request: its VAD only filters a buffer it is given and cannot decide where a live stream ends.
   Two ways to run Silero in the service, to decide when planning the first phase-2 task:
   - **A small VAD helper built with the whisper runtime** (BT-055 workflow, a new runtime
     revision): a few lines of C++ over whisper.cpp's own streaming VAD API
     (`whisper_vad_detect_speech_no_reset`), reading PCM on stdin and printing frame probabilities,
     with the 0.9 MB `ggml-silero-v6.2.0.bin` model. Same engine, same license, no new dependency.
     **Chosen by the user (2026-10-26).**
   - onnxruntime in Node with the 2.3 MB `silero_vad.onnx`: no C++ work, but the service has to
     carry the ONNX Runtime binaries (wasm about 11 MB, or a native package).
2. **Segmentation (starting values):** speech threshold 0.5, off threshold 0.35; 1.0 s pre-roll;
   300 ms padding after speech; a draft at a 500 ms pause; the utterance ends at a 1200 ms pause;
   speech under 250 ms is dropped; an utterance is capped at 25 s and cut at the quietest frame of
   its last 3 s. Segments never overlap, and every cut is tracked in absolute samples.
3. **Commit strategy: the hybrid.** At each short pause the utterance so far is transcribed as a
   *draft* that consumers show but do not insert. At the long pause the whole utterance is
   transcribed once and committed; committed text never changes. The prompt carries the last 200
   characters of committed text. Keep the full 30 s audio context.
4. **Second step, measured before it ships: audio left-context.** To fix short isolated phrases,
   transcribe each utterance with up to about 15 s of preceding audio and keep only the words after
   the previous commit, using word timestamps and whisper_streaming's n-gram de-duplication at the
   boundary. It costs about twice the GPU time per utterance, so it can be a setting, or apply only
   to utterances shorter than a few seconds.
5. **Contract:** an additive `speech.transcribe` v1 feature (a `features` entry such as `"live"`)
   rather than v2. A consumer asks for it on `open`; the provider then also sends `draft` messages
   (replaceable text for the current utterance) and `segment` messages (committed text), and still
   ends with the usual final `result`. Consumers that do not ask keep today's behaviour.
6. **Consumers:** voice typing inserts each committed segment at the caret as it arrives and shows
   the draft in its overlay; Agent Chat inserts committed segments into the prompt and shows the
   draft in grey. Optional auto-stop after a configurable silence (for example 2.5 s).
7. **Meetings (phase 4)** reuse the same VAD with one state per stream (microphone, loopback), and
   commit utterances without drafts to save GPU time. `whisper-server` serves one request at a
   time, so the two streams share a fair queue.

### Proposed phase-2 tasks

| Task | Repo | Size |
|---|---|---|
| Streaming VAD helper in the whisper runtime (new revision of the BT-055 build) | persephone-boards | M |
| Live segmentation in the Speech to Text service: VAD, hybrid drafts and commits, absolute offsets | persephone-boards | L |
| `speech.transcribe` live feature: guide and contract (`draft`, `segment`) | persephone | S |
| Voice typing: insert committed segments as they arrive, draft in the overlay, optional auto-stop | persephone | M |
| Agent Chat: live insertion with a grey draft | persephone-boards | S |
| Audio left-context for short utterances (measure first) | persephone-boards | M |

## Concerns

- The earlier failure is now explained by the findings: word-sized chunks transcribed separately
  and joined. The recommended design transcribes whole phrases with no overlapping audio.
- Some candidates are Python projects; their ideas transfer, their code does not. Reuse code only
  from MIT/Apache/BSD sources.
- Measurements on one machine (the user's GPU) may not hold on CPU-only machines; note CPU numbers
  where the runtime falls back.

## Acceptance criteria

- The earlier proof of concept and its failure are recorded.
- Findings cover at least whisper.cpp's own VAD/stream, Silero VAD, one draft-then-commit project
  (whisper_streaming or RealtimeSTT), and one browser VAD option, each with its license.
- whisper.cpp 1.9.5's VAD support in our runtime is confirmed or ruled out.
- Measured results on our engine for at least one segmentation policy.
- A recommendation the user accepts, with the list of phase-2 tasks.

## Files changed

| File | Change |
|---|---|
| `doc/tasks/US-1726-pause-detection-research/README.md` | This document: findings, measurements, recommendation |
| `doc/epics/EPIC-134.md` | Earlier-POC note and phase-2 task list once agreed |

No product code changes. Scratch measurement scripts stay outside both repositories. No changes in
`src/`, `assets/`, or persephone-boards.
