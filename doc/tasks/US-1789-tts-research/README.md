# US-1789: Research — local text-to-speech model and voices (English, Ukrainian)

Epic: [EPIC-139](../../epics/EPIC-139.md) · Phase 0 · Research task (no product code)

## Goal

Choose the speech synthesis engine and voices for the Text to Speech board (BT-082), which provides
`speech.synthesize` for the voice assistant. Gate: the user agrees with the recommendation after
listening.

## Constraints (from the epic)

- **No Windows voices**, not even as a fallback (decision 3).
- **Local, permissive licence.** It ships in a published board.
- **English and Ukrainian**, in the same engine if possible.
- **Runs in a board service** (Node utility process). The reply must start playing before the whole
  text is synthesized.
- Fast on a laptop CPU. A GPU must not be required.

## Candidates

All were run through sherpa-onnx 2.0.1 (Apache-2.0), the runtime the wake-word research already
uses, except Piper, which was run through `piper-tts` because sherpa-onnx can't phonemize for it
(finding 2).

| Model | Licence | Ukrainian | English | Verdict |
|---|---|---|---|---|
| **Supertonic 3** (Supertone), int8, 141 MB | Code MIT; weights OpenRAIL-M (commercial use and redistribution allowed; the use restrictions must travel with the files) | Yes, 31 languages | Yes | **Recommended** |
| Piper `uk_UA-ukrainian_tts` medium (3 speakers) | Model from CC0 data; **phonemizer eSpeak NG is GPL-3.0** | Yes | — | Reference only |
| Piper `uk_UA-lada` x_low | Apache-2.0 data; eSpeak NG GPL | Yes, low quality tier | — | Reference only |
| Piper English (lessac, ryan, hfc) | Datasets non-commercial (CC BY-NC-SA, Blizzard licence) | — | Yes | Rejected: licences |
| Kokoro 82M multi-lang v1.1 | Apache-2.0; needs eSpeak NG for unknown words | **No** | Yes | Rejected: no Ukrainian, ~0.85× real time on 2 threads |
| Kitten TTS mini v0.8 | Apache-2.0; needs a lexicon or eSpeak NG | No | Yes | Rejected: no Ukrainian, no frontend |
| MMS-TTS `ukr` (Meta) | CC BY-NC 4.0 | Yes | — | Rejected: non-commercial |
| XTTS v2, F5-TTS | Non-commercial weights | Partly | Yes | Rejected: licences, GPU-sized |

## Findings

### 1. Supertonic 3 speaks both languages from raw text, fast

- One model and 10 built-in voices for both languages, selected per request with `lang` (`en`,
  `uk`) and a voice index. Output is 44.1 kHz mono.
- **No phonemizer.** It reads Unicode characters directly (`unicode_indexer.bin`), so there is no
  eSpeak NG and no GPL component.
- Speed (Python, 2 CPU threads, int8): 0.11–0.22× real time. A 2.3 s phrase took 0.3–0.5 s and a
  12 s explanation took 1.4–1.7 s. Model load: 0.5–0.6 s.
- **Inside Persephone** (the `tts-test` board, Node service): the model loads in 0.52 s, and the
  first audio plays **0.39 s** after pressing Speak for "Вмикаю фільм на весь екран." (2.32 s of
  speech synthesized in 386 ms, 0.17× real time).

### 2. sherpa-onnx 2.0 has no eSpeak NG frontend

Piper (VITS), Kokoro and Kitten models failed with "no lexicon, and no frontend available"
(Kokoro skipped every word missing from its lexicon). They need eSpeak NG to turn text into
phonemes, and eSpeak NG is GPL-3.0. Shipping it would mean a GPL helper process beside the board.
Supertonic avoids the problem entirely.

### 3. Piper Ukrainian as a reference

Through `piper-tts` 1.8 (GPL, with eSpeak NG), `ukrainian_tts` runs at 0.03–0.04× real time, about
four times faster than Supertonic. Its samples are in the test board for comparison. It would become
the choice only if the user clearly prefers its sound to Supertonic's, and then the GPL phonemizer
question must be solved first.

### 4. Streaming is per sentence

Supertonic produces each request in one piece: the progress callback fires once. Streaming
therefore happens by splitting the text into sentences in the provider and sending each one as soon
as it is ready. Speech starts after the first sentence, not after the whole reply. The test board
does exactly this, splitting long sentences again at commas past 220 characters.

### 5. Electron needs copied audio buffers

In the board's utility process, `generateAsync` failed with "TTS settlement failed" until the
request set `enableExternalBuffer: false`. Electron forbids external ArrayBuffers. Plain Node did
not show the problem. BT-082 must set this flag.

### 6. Listening test (the user)

The `C:\projects\test-boards\tts-test` board (trusted) has presets for English and Ukrainian,
short and explanation text, numbers, all 10 voices one by one, speed, and the Piper samples.

- [x] The user picked **voice 0** as the best (2026-11-06). It is the default for both languages.
- [ ] Number reading in Ukrainian ("UK numbers" preset) was not reported. BT-082 checks it and adds
      a number normalizer if needed.

## Recommendation (agreed with the user, 2026-11-06)

- **Engine:** Supertonic 3 int8 through `sherpa-onnx-node`, in the Text to Speech board's service.
  The model downloads on first use (141 MB) with the Mneme-style model panel.
- **Default voice:** voice 0, for English and Ukrainian. The other 9 stay selectable in settings.
- **Contract hints for US-1784:** `describe` returns the voices (index plus a name the board
  assigns) and the languages; a request carries `text`, `lang`, `voice` and `speed`; audio comes
  back as PCM Float32 chunks, one per sentence, with the sample rate.
- **Licence:** ship the OpenRAIL-M licence text with the downloaded model and mention its use
  restrictions in the board's README.

## Acceptance criteria

- [x] Survey of local models: licence, size, speed, English and Ukrainian.
- [x] Speed measured on CPU, including inside a Persephone board service.
- [x] Streaming approach decided (per sentence).
- [x] The user listened and chose the voice (gate): voice 0.
