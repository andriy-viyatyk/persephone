# US-1783: Research — wake-word engine and the microphone-plus-loopback rule

Epic: [EPIC-139](../../epics/EPIC-139.md) · Phase 0 · Research task (no product code)

## Goal

Pick the wake-word engine for the voice assistant. Measure it with the user's voice and a film
playing, and check that decision 3a works: ignore the name when the computer's own audio says it
too. Gate: the user agrees with the recommendation.

## Constraints (from the epic)

- **Not Whisper.** No heavy model running all the time.
- **Local only, permissive licence.** It ships in a published board.
- **The user can choose any name** in settings, so retraining per name is not acceptable.
- **Runs in a board service.** Same pattern as Speech to Text: a native helper downloaded on first
  use, fed PCM over stdin.

## Candidates

| Engine | Licence | Custom names | Verdict |
|---|---|---|---|
| **sherpa-onnx keyword spotting** (k2-fsa) | Apache-2.0 (code); models from the same project | Any phrase, as text, with no training. Phoneme models take a pronunciation; BPE models take text | **Chosen for measurement** |
| openWakeWord | Library permissive; **pretrained models and training data CC-BY-NC-SA 4.0** | Needs a training run per name | Rejected: non-commercial models, and training per name |
| Vosk with a grammar | Apache-2.0 | Words must already be in the model's vocabulary; "Persephone" and "Persy" are uncertain | Not measured; sherpa-onnx covers the same need better |
| Porcupine (Picovoice) | Proprietary, access key | Through their console | Rejected (epic) |
| Whisper, gated by voice activity | MIT | Any | Rejected by user decision |

Sources: [sherpa-onnx KWS docs](https://k2-fsa.github.io/sherpa/onnx/kws/index.html),
[pretrained KWS models](https://k2-fsa.github.io/sherpa/onnx/kws/pretrained_models/index.html),
[JavaScript keyword spotter API](https://k2-fsa.github.io/sherpa/onnx/javascript-api/examples/api_keyword_spotter.html).

### sherpa-onnx models

| Model | Keyword format | Size (int8 encoder) |
|---|---|---|
| `kws-zipformer-zh-en-3M-2025-12-20` | Phonemes (ARPAbet, `en.phone` lexicon) | ~4.6 MB encoder, ~38 MB folder incl. both latency variants |
| `kws-zipformer-gigaspeech-3.3M-2024-01-01` | BPE tokens | ~4.8 MB encoder, ~19 MB folder |

## Findings so far (2026-11-06, this laptop: Intel CPU, default devices)

The harness and models are in the session scratchpad (`kws/`). sherpa-onnx 2.0.1 Python package,
run in an isolated virtual environment.

### 1. Synthetic smoke test (Windows SAPI voices David and Zira, 16 clips, 68 s)

- Positives: "Persephone, play the next episode", "Hey Persy, make the video full screen", "Okay.
  Persephone. Search…", "Persy, stop."
- Negatives: person / telephone / perspective; "Percy Jackson … television"; persevered /
  persistent / persimmon; ordinary speech.

| Model | Names found | False triggers | CPU (1 thread) |
|---|---|---|---|
| **zh-en phoneme** | **8 / 8** | 0, except "Percy" (see below) | real-time factor 0.014 (~1.4% of a core) |
| gigaspeech BPE | 2 / 8 | 0 | 0.015 |

- **The phoneme model wins clearly.** It needs a pronunciation for each name. "Persephone" and
  "Persy" are not in its lexicon, so the harness adds `PERSEPHONE P ER0 S EH1 F AH0 N IY0` and
  `PERSY P ER1 S IY0`. The product must therefore turn a user-typed name into phonemes: a
  grapheme-to-phoneme step, or a pronunciation field with a sensible default. That is an
  implementation question for BT-083.
- **"Persy" sounds exactly like "Percy"** (same phonemes in the CMU lexicon). Any engine will wake
  on "Percy Jackson". This is a property of the name, not of the model.

### 2. Live harness (`wake_live.py`): microphone + computer audio

- It captures the microphone and WASAPI loopback of the default output at the same time, runs one
  spotter per stream, and applies decision 3a. A microphone hit wakes the assistant only if the
  loopback had no hit for the same name within ±1.5 s; it waits 0.6 s for a late loopback hit.
- **A silence gate** skips spotting computer audio while nothing plays. Spotting must replay
  ~500 ms of lead-in when the gate opens: without it, a name at the very start of a sound was
  missed.
- **Loopback detection works.** Clips played into the headphones were caught on the loopback
  stream: 4 / 4 once the lead-in was added. The one miss in the first run happened while the
  user's music was playing at the same time, mixed with the clip.
- **CPU:** microphone ~1.5% of one core, computer audio ~0.9% (gated). Both together cost under
  2.5% of a single core.
- About 20 s of the user's music produced no false triggers. That is far too little to count; the
  film test below is the real measure.

### 3. The whole rule, with clips played through speakers into the room

All 16 clips were played through the laptop speakers, so the microphone heard them while the
computer's audio carried them.

| Clip | Run 1 | Run 2 |
|---|---|---|
| "Percy Jackson" (2 clips) | suppressed / suppressed | missed on the mic / **WAKE** (computer-audio spotter missed it) |
| Names (8 clips) | 6 suppressed, 1 **WAKE**, 1 missed by both | 5 suppressed, 1 **WAKE**, 2 missed |
| Look-alike words (8 clips) | nothing | nothing |

- **Delay** from computer audio to the microphone through the laptop speakers: **+0.06 to +0.42 s**.
- **Every false WAKE came from the computer-audio spotter missing a word the microphone caught.**
  The keyword-matching rule is only as good as the spotter's recall on computer audio.
- **The misses look like capture loss, not model weakness.** The capture library reported "data
  discontinuity" warnings in those runs. In a later run through the Creative speakers (the
  "Headphones (Realtek)" device), the computer-audio spotter caught **10 / 10** (8 names, 2
  "Percy"). The same clips as files gave 8 / 8. The product captures through Chromium, not this
  Python library, so its loss rate has to be measured there.
- **The echo comparison is weak on this laptop.** Plain normalized cross-correlation between the
  microphone's last 1.2 s and the computer audio scored only **0.19–0.42** for real echoes. The
  Intel Smart Sound microphone array processes its own signal. GCC-PHAT (whitened correlation) is
  the next thing to try offline, against a baseline of unrelated audio, before anything relies on
  it.
- In the Creative-speaker run the microphone recorded digital silence (−95 dB) throughout, from
  before the first clip. Its results for that run are void; the microphone itself needs checking.

### Direction for the recommendation (provisional)

1. Keep the keyword-match rule (decision 3a) as the primary test, because it measured cleanly when
   capture was clean.
2. Add a second, independent signal, so one spotter miss does not become a wake. Options, in order:
   - computer audio was **playing speech** in the window before the microphone hit: a voice-activity
     check on the loopback, which is cheap and does not depend on recognizing the name. Then
     require a confirmation, or a higher threshold, instead of waking at once;
   - a GCC-PHAT echo match, if offline tests show it separates echoes from unrelated audio.
3. Measure capture loss in Chromium's loopback (BT-083 / US-1786) before trusting any rule.

## Measurement plan — needs the user

Each run writes `wake_log.csv` and prints a summary. The command, run from the scratchpad `kws`
folder:

```
venv\Scripts\python -I wake_live.py --minutes 20
```

1. **Your voice, quiet room** (5 min). Say "Persephone …" and "Persy …" about 20 times each, at
   normal distance and from the sofa, in English and in a Ukrainian sentence. Count the misses.
   Repeat with `--threshold 0.15` and `0.35` if the misses or false triggers are off.
2. **A film through the TV** (20–30 min, laptop connected over HDMI, TV as the output device,
   `--speaker "<TV device name>"`). Don't speak. Count the wakes: these are false triggers that got
   through the rule, and every "suppressed" line is one the rule caught.
3. **Both.** Film playing; say the names now and then. Count misses, and any time your own call
   was suppressed.
4. **Delay.** The `loopback_offset_s` column of suppressed rows is the measured
   computer-to-microphone delay through the TV. It sets the real window.

### Ukrainian

- The spotter does not need to understand Ukrainian. It matches the name's sound pattern and
  treats everything else as background, and the request after the name goes to Whisper.
- **Pronunciation differs.** English "Persephone" is *per-SEF-o-nee*; Ukrainian "Персефона" is
  *per-se-FO-na*. Each name can carry several pronunciations, so add Ukrainian variants written
  with the nearest English phonemes:
  - `PERSEFONA P EH1 R S EH0 F OW1 N AH0`
  - `PERSI P EH1 R S IY0` (close to `PERSY`)

  The harness accepts them with `--names PERSEPHONE,PERSEFONA,PERSY` once they are in
  `custom.phone`.
- **Unknown false-trigger rate on Ukrainian speech.** The model was trained on English and
  Chinese only. Measurement 2 must include a **Ukrainian-dubbed** film as well as an English one.
- In the product, a name's pronunciations come from the BT-083 grapheme-to-phoneme step, with
  room for more than one variant per name.

### 4. The user's real voice (Wake Word Test board, 2026-11-06)

A test board (`C:\projects\test-boards\wake-word-test`) runs sherpa-onnx in its service on
microphone audio from the page and logs every catch. It saves the received audio to
`last-session.wav` for offline analysis.

- **Pipeline verified.** Synthetic clips played through the laptop speakers were all caught through
  the board (3 / 3, peak −7 dB).
- **The user's voice: sherpa-onnx fails.** The user said "Персефона", "Персі" and "hey Persy" about
  10 times in total. The board caught nothing.
  - Offline, Whisper large-v3-turbo transcribed the take as **"Парсифона, парси"** (English mode:
    "Parsifona, Percy"). The user's pronunciation is *PAR-si-FO-na*, not the *PER-se-* that was
    assumed.
  - Sweeping 12 pronunciation variants, including the matching `P AA1 R S IH0 F OW1 N AH0`, over
    thresholds 0.25 → 0.05 found **at most 1 of ~10**.
  - Conclusion: the 3M English/Chinese model does not generalize to a Ukrainian speaker. The
    synthetic English voices passed only because they match its training data.
- **Vosk with the Ukrainian model works.** `vosk-model-small-uk-v3-small` is 137 MB, Apache-2.0.
  On the same take, **free decoding** produced
  `персефона персі вона перші персі персефона персі`: 5 names recognized out of about 7–9, plus
  two misrecognitions ("вона", "перші").
  - The real-time factor was **0.09**, about 9% of one core, roughly 6× the cost of sherpa-onnx
    but still small.
  - **Grammar mode returned nothing** with this model, even when restricted to the two names, so
    it does not fit this purpose. Spotting means free decoding plus a text match.
  - Both names are already in its 1.69 M-word vocabulary, so no pronunciation entry is needed.

### 5. Enrollment: query-by-example in the user's own voice

Each person records the name a few times; detection compares live audio with those recordings.

- **Features.** openWakeWord's melspectrogram + speech-embedding ONNX models give one 96-d vector per
  80 ms, from a 0.8 s window.
  - The backbone is Google's `speech_embedding` (TF Hub, Apache-2.0), but the openWakeWord README
    puts *all included models* under CC-BY-NC-SA. Research use is fine; **for the product, export
    Google's original Apache-2.0 model ourselves.**
- **Matching.** Subsequence DTW over cosine distance. Each template is matched against the last
  `2L+4` embeddings; the score is the mean cost along the path.
- **Offline on the user's take**, with Vosk word timings used to cut templates:
  - a "Персефона" template scored 0.05–0.09 against the user's other "Персефона"s, against ≥ 0.25
    for silence and other voices;
  - the short "Персі" separated worse (pauses scored 0.08–0.09, partly because the templates
    included trailing silence).
- **Board simulation** (2 templates, threshold 0.15): hits on all three "Парсифона"s (best 0.03–0.07),
  everything else 0.22–0.31, one extra hit on a "парси" right after a name. **~5% of one core.**
- **Test board:** `C:\projects\test-boards\wake-enroll-test`.
  - Enroll: a person name, then "Record sample" (2.5 s). Each sample's match to the same person's
    earlier samples is shown.
  - Live test: a closest-match meter, hits, and near misses.
  - Templates are saved in `enroll/templates.json`, each sample as a WAV, and the live session in
    `last-session.wav`.
  - Trimming uses the noise floor (20th percentile) and keeps the run around the loudest step.
    Browser gain control is off: with it on, a synthetic test sample came out as 2.4 s of "speech".

### 6. The user's own tests on the enrollment board

- **Session 1** (four enrolled samples, one each of "Парся", "Парсефона", "Луна", "Луна"): the user
  said mostly names. Replayed: 6 hits for the 6 names spoken, none on "ти мене чуєш" (closest
  0.17) or "як мене чути" (≥ 0.19). Each name matched its own sample at 0.08–0.11.
- **Session 2** (42 s of continuous Ukrainian speech about the test itself, with the names inside
  sentences and called out): **6 hits, every one on a name, none on ordinary words.**
- **Intonation.** A called "Луна!" / "Persy!" triggered every time; the same name mentioned in an
  ordinary sentence mostly did not ("І Луна працює, якщо я просто говорю" produced no hit). The
  user wants this behavior: talking *about* the assistant must not wake it.
- The threshold is 0.15. At 0.12, one called "Луна" was missed. The margin to ordinary speech is
  ~0.03–0.05 with one sample per name; more samples per name should widen it, to be confirmed in
  BT-083.

## Recommendation (agreed with the user, 2026-11-06)

1. **Wake and stop words are enrolled in the user's voice**: query-by-example over speech
   embeddings, as in EPIC-139 decision 2a. Text keyword spotting (sherpa-onnx) is rejected because
   it failed on the user's pronunciation. Vosk is rejected for continuous wake detection, at ~9% of
   a core with a misrecognition rate the enrollment approach does not have.
2. **Engine:** melspectrogram + Google `speech_embedding` (exported by us from the Apache-2.0
   release), one embedding per 80 ms, with subsequence DTW against every enrolled sample. Default
   threshold 0.15, about 5% of one core.
3. **Enrollment UX** (settings): about 5 samples per name and per person. Show each sample's match
   to the earlier ones and reject samples with too little speech or too much noise. The 2.5 s
   recording window worked.
4. **Stop words** use the same engine and enrollment (kind `stop`).
5. **Delivery:** a `speech.wake` provider board running `onnxruntime-node` in its service
   (verified to load in Node; 33 MB once trimmed to Windows x64), with models downloaded on first
   use like Speech to Text.
6. **The loopback rule (decision 3a) stays,** but it matters less: template matching is
   speaker-dependent, and other voices scored 0.23–0.28 against one person's samples. The film
   test (measurement 2) moves to BT-083, where the real provider can run on both streams.

### Earlier direction (superseded by the recommendation above)

- **The wake engine must understand the user's language.** For a Ukrainian speaker, a Ukrainian
  speech model with a text match on the name beats an English keyword spotter.
- Next candidates:
  1. Vosk Ukrainian (small), free decoding with a fuzzy text match (персефона / персі / парсі…);
  2. a sherpa-onnx **streaming ASR** model that covers Ukrainian, if one exists (lighter runtime,
     same project as before).
- Delivery for Vosk: a small helper process (as with `whisper-vad-helper.exe`) or the Python
  package for research only. The Node `vosk` package relies on `ffi-napi`, a risk inside
  Electron's utility process. This still needs checking.
- The language model follows the user's language, so the board's settings need a language and a
  model download per language. English users keep a choice between an English model and
  sherpa-onnx.

## Open questions for the recommendation

- The default names. Drop "Persy" because of "Percy", or keep it and rely on the loopback rule
  for TV audio? A real person called Percy in the room would still wake it.
- The threshold and boost defaults, from measurements 1–3.
- How a typed name becomes phonemes (BT-083).
- The Node path: `sherpa-onnx-node` (native addon in the board) or a small helper `.exe` built in
  CI, like `whisper-vad-helper.exe`. The second matches the Speech to Text pattern and keeps
  `node_modules` out of the board.

## Acceptance criteria

- [x] Engine candidates surveyed, with licences, and one chosen for measurement
- [x] Synthetic smoke test and a live two-stream harness working
- [x] Measurement 1 (the user's voice) done; measurements 2–4 (film, both, delay) moved to BT-083
- [x] Recommendation written: engine, model, thresholds, enrollment, delivery
- [x] User agrees with the recommendation (2026-11-06)
