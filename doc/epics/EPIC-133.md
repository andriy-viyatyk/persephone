# EPIC-133: Speech to text — a `speech.transcribe` contract and a Whisper provider board

## Status

**Status:** Completed 2026-10-26
**Created:** 2026-10-25

## Overview

Let the user speak instead of type: click a voice button, talk, click again, and the words land in
the input. Persephone itself stays a registry. It reserves one cross-board service interface,
`speech.transcribe`, and documents its contract. A new **Speech to Text** board provides it with a
local Whisper engine, and Agent Chat is the first consumer. Any other board can provide the same
interface with a different engine — for example, a model that is better for another language —
and any board can use whichever provider is installed.

Version 1 is deliberately **record, then transcribe**: start/stop button, text after stop. Live
typing while speaking and auto-stop after silence are planned follow-ups (see *Future work*).

## Goals

- Persephone reserves `speech.transcribe` and ships a normative v1 contract guide, so providers and
  consumers can be written independently.
- The Speech to Text board transcribes Ukrainian and English (and Whisper's other languages)
  locally, on the GPU where possible, with no cloud service and no API key.
- First use downloads the engine and model with progress and checksum verification; the board zip
  stays small.
- Agent Chat shows a voice button only when a `speech.transcribe` provider is installed, and puts
  the transcribed text into the message input.

## Background (verified 2026-10-25)

### The platform already has what this needs

- **Cross-board service interfaces** (EPIC-131 Phase 0). A provider declares
  `serviceInterfaces: [{ id, version, title }]`; a consumer declares `uses: [{ id, version }]`,
  finds providers with `persephone.services.list(id)` and opens a channel with
  `persephone.services.connect(id, { provider, version }, openMessage)`. The provider's service
  starts lazily on connect; **no provider page opens**, so the user stays in the consumer.
  Documented in `assets/guides/agents/boards.md` and `doc/architecture/overview.md`.
- **Channel limits fit audio.** Page → service traffic is count-bounded only (256-message window);
  service → page payloads are capped at 1 MiB, which only matters for results (text).
  16 kHz mono 16-bit PCM is 32 KB/s, so a one-second chunk is far below any limit.
- **Only board pages can call `services.connect` today.** That suits this epic: the consumer page
  records the microphone and streams audio to the provider's service.
- **Platform-reserved ids** live in `PLATFORM_SERVICE_INTERFACE_IDS`
  (`src/shared/board-manifest-utils.ts:5`, today `agent.session` only). Any other id must have the
  form `author/name`. Reserving an id is a validation change only; nothing restricts which boards
  may provide it.
- **Precedent for a contract guide:** `assets/guides/agents/agent-session.md`, registered as the MCP
  resource `persephone://guides/agent-session` in `src/main/mcp/manifest.ts` and listed in
  `assets/guides/agents/index.md`.
- **Microphone:** boards declare `permissions.microphone: true`; the grant feeds the board iframe's
  `allow` list (`BoardWebview.ts`, `iframeFeaturesForGrant`) and `permission-policy-service.ts`
  answers the media request.
- **A service may spawn programs.** Agent Chat runs the Claude and Codex CLIs from its service with
  only the `service` permission (`network: false`).

### Engine measurements (2026-10-25, this machine: Core Ultra 7 265H, Intel Arc iGPU)

whisper.cpp v1.9.5, model `ggml-large-v3-turbo-q5_0.bin` (574 MB), the user's own Sound Recorder
clips (~15 s Ukrainian, ~30 s English):

| Build | Ukrainian | English | Accuracy |
|---|---|---|---|
| CPU (OpenBLAS, 8 threads) | 15.2 s | 32.3 s | near-verbatim |
| Vulkan, warm (incl. ~0.8 s model load) | 5.1 s | 5.5 s | identical to CPU |

- Language auto-detection was correct for both clips (p = 0.986 uk, 0.998 en).
- Proper names were the only Ukrainian errors ("Persephone" → "персифоні"); the initial-prompt
  vocabulary hint is the planned fix.
- `large-v3-turbo` has **no translate task**: `-tr` returned Ukrainian. Agents read Ukrainian, so
  v1 does not need translation.
- Model load and the first-run shader compile dominate a cold call; a resident engine leaves
  roughly 1.1–1.3 s of GPU time per 30 s of audio. Expect ~2–3 s from stop to text for a typical
  message (estimate, not measured).
- Windows voice typing (Win+H) was rejected by the user: no usable Ukrainian, poor with accented
  English.
- The live-streaming experiment with whisper.cpp's `whisper-stream` demo was inconclusive and is
  **not** evidence against Whisper: the demo transcribes blind 6-second windows without context,
  its energy-threshold pause detector never fired for the user's headset, and its `--save-audio`
  in pause mode appends overlapping 2-second windows, so its recordings could not be analysed.
- Building the Vulkan engine needs the Vulkan SDK and a short build path (the shader generator's
  nested build exceeds MAX_PATH under a deep folder). End users need neither: the Vulkan loader
  ships with GPU drivers.

## Design

### The `speech.transcribe` v1 contract

One channel is one transcription. The consumer streams audio while recording, ends the stream, and
receives one result; the provider then closes the channel.

**Open message** (sent by `services.connect`):

```js
{
    type: "transcribe",
    format: { encoding: "pcm-s16le", sampleRate: 16000, channels: 1 },
    languages: ["uk", "en"],   // optional ISO 639-1 hints; absent or [] = auto-detect
    prompt: "Persephone, Codex, board", // optional vocabulary hint
}
```

or `{ type: "describe" }`, which asks for the provider's description and closes after replying.

**Consumer → provider:** `{ type: "audio", data: ArrayBuffer }` (any number, in order),
`{ type: "end" }`, or `{ type: "cancel" }`.

**Provider → consumer:**

- `{ type: "status", state: "preparing" | "listening" | "transcribing", detail? }` —
  `preparing` means loading an already-installed engine/model and may carry `{ progress }`; downloads
  are user-triggered separately, while a request made before installation returns `not-ready`.
- `{ type: "result", text, language, audioMs, elapsedMs }` — then the provider closes.
- `{ type: "error", code, message }` — then the provider closes. Codes: `not-ready` (engine or
  model not installed; the message says how to fix it), `unsupported-format`, `too-long`,
  `engine-failed`, `cancelled`.
- `{ type: "description", engine, model, languages: "auto" | string[], local: boolean,
  maxAudioMs, features: string[] }` — the answer to `describe`. `local: false` warns consumers
  that audio leaves the machine; v1 `features` is `[]`.

**Rules:** consumers ignore unknown message types and unknown fields, which leaves room for live
partials in a later version (announced through `features`). The provider caps one recording at
`maxAudioMs` (Speech to Text: 5 minutes). The provider applies its own approval policy to callers
and may refuse with the normal `connection-refused` close.

The final wording is US-1723's job; the guide is normative and the board tasks implement it.

### Speech to Text board (`speech-to-text`, persephone-boards)

- **Service** implements `speech.transcribe` v1. It runs whisper.cpp's `whisper-server` as a child
  process bound to `127.0.0.1`, started lazily on the first request and stopped after an idle
  timeout (setting, default 10 minutes) to free the model's memory. Requests are queued; one
  transcription at a time.
- **Engine and model download on first use**, into the board's data folder: a runtime archive
  (Vulkan build, plus a CPU build to fall back to when Vulkan fails to start) and the selected
  model from `huggingface.co/ggerganov/whisper.cpp`. Both are pinned by SHA-256 in the board's
  code. The board zip contains no binaries.
- **Runtime archive** is built by a GitHub Actions workflow in persephone-boards from a pinned
  whisper.cpp tag and attached to a dedicated release (e.g. `speech-to-text-runtime-v1.9.5`), so
  the board downloads what the project built rather than a third-party binary.
- **Settings:** model (default `large-v3-turbo` q5_0; smaller choices for weaker machines),
  language hints, vocabulary prompt, use GPU, idle unload minutes.
- **Page — engine and models**, modelled on Mneme's model panel
  (`src/renderer/editors/mneme-config/ModelPanel.ts`): the engine runtime and a list of models,
  each with its size, status (not installed / downloading / verifying / ready / failed), a progress
  bar showing bytes done and total, and Download, Cancel, Remove and Use buttons. The service does
  the downloading into a `.part` file, resumes an interrupted download with HTTP range requests,
  verifies the SHA-256 before renaming it, and reports progress to the page over a service
  channel, so a download keeps going while the page is closed. Nothing downloads until the user
  clicks Download; a consumer's request before then gets `not-ready` with a pointer to this page.
  Models and runtime live in the board's data folder, so board updates never re-download them.
- **Page — test recorder:** a level meter, a microphone picker, and the last result with its
  timing; the place to check that a microphone works before using it elsewhere.
- **Permissions:** `service`, `microphone` (test recorder), and `network` only if the page itself
  downloads; the service performs the downloads.

### Agent Chat voice button (consumer, persephone-boards)

- Manifest gains `uses: [{ id: "speech.transcribe", version: 1 }]` and `microphone: true`.
- The composer shows a voice button only when `services.list("speech.transcribe")` returns a
  provider. With several, a board setting picks one; default is the first.
- Click to start: capture via `getUserMedia` into an `AudioContext` at 16 kHz, stream PCM chunks
  to the provider. Click again (or Esc to cancel) to stop. The button shows recording time,
  then "transcribing".
- The text is inserted at the composer's cursor. It is **not** sent automatically in v1.
- Errors use the existing dismissible error panel; `not-ready` tells the user to open Speech to
  Text to finish setup.

## Linked Tasks

| Task | Repo | Title | Status |
|------|------|-------|--------|
| US-1723 | persephone | Reserve `speech.transcribe` and publish its v1 contract guide | Done |
| BT-055 | persephone-boards | Whisper runtime build workflow and release | Done (`whisper-runtime-1.9.5-r1`) |
| BT-056 | persephone-boards | Speech to Text board — `speech.transcribe` provider | Done (user-tested 2026-10-26; unpublished until 5.0.15) |
| BT-057 | persephone-boards | Agent Chat voice input | Planned |

Order: US-1723 first (the contract the board tasks implement), then BT-055, BT-056, BT-057.
BT-056 and BT-057 need a Persephone build that accepts the reserved id; both boards set
`minAppVersion` to the release that ships US-1723 (5.0.15 if it lands this cycle).

## Concerns and open questions

1. **Pre-reservation compatibility (resolved).** An older build rejects the bare id because it is
   neither reserved nor in `author/name` form. `normalizeServiceDeclarations` reports the invalid
   declaration and skips it; `parseBoardManifest` retains the rest of the manifest and records a
   `service-interface` issue. Board Info exposes that issue as a warning, and the main trust
   snapshot also omits the declaration through the shared normalizer. This is not whole-board
   rejection, a custom-editor registration issue, or a crash. Boards should set `minAppVersion`
   to the Persephone release that adds the reservation. No bridge-version bump is needed because
   the service APIs already exist; only manifest validation changes.
2. **Runtime hosting.** A release in persephone-boards keeps the download under the project's
   control, but the Publish Boards workflow treats `*-vX.Y.Z` tags as board releases. BT-055 must
   choose a tag shape the board publisher ignores.
3. **CPU fallback.** Our Vulkan build was not compiled with dynamically loaded backends; on a
   machine without a working Vulkan driver it may fail to start rather than fall back. BT-055
   decides between shipping two builds and a `GGML_BACKEND_DL` build that loads the Vulkan backend
   optionally.
4. **Download size.** The default model is 574 MB and the Vulkan runtime about 50 MB. The page
   must show sizes before downloading and allow a smaller model.
5. **Microphone choice lives with the consumer** because the consumer records. Agent Chat uses the
   default input device in v1; a shared capture helper with a device picker is future work.
6. **whisper-server API details** (language auto-detect output, prompt parameter, accepting raw
   PCM versus WAV) must be verified against the pinned tag in BT-056, not assumed.

## Licensing

Everything the epic uses is under permissive licenses (verified 2026-10-25 from the sources and
license pages):

| Component | License | How it reaches the user |
|---|---|---|
| whisper.cpp and ggml (ggml authors) | MIT | Built by BT-055, shipped in the runtime zip |
| cpp-httplib 0.20.0, nlohmann/json 3.11.2, miniaudio 0.11.24, stb_vorbis 1.22 | MIT; miniaudio public domain or MIT-0; stb_vorbis MIT or public domain | Compiled into `whisper-server` |
| Whisper model weights (OpenAI) | MIT | Downloaded by the user from `huggingface.co/ggerganov/whisper.cpp` |
| Vulkan SDK and headers | Apache-2.0 | Build time only; never shipped |

- The runtime zip carries a `licenses/` folder with every notice above. The build checks each
  notice against the upstream source and fails if it changed.
- The Speech to Text board shows a Third-party licenses section crediting OpenAI for the model
  and the ggml authors for the engine, and links the bundled notices.
- Model weights are never hosted by Persephone or persephone-boards; the user's own click
  downloads them from Hugging Face.
- The MSVC runtime is linked statically, so no Microsoft redistributable is shipped.

## Future work

- **Live typing:** a grey draft of the phrase being spoken, replaced by committed text at each
  pause (Silero VAD segmentation plus short-context re-transcription), announced as a `features`
  entry.
- **Auto-stop after silence** (configurable, e.g. 2.5 s) and optional auto-send with a cancellable
  countdown.
- A reusable voice-capture component in `boards-assets` so other consumers do not reimplement
  capture, resampling and device selection.
- A Persephone-wide dictation hotkey that types into any focused field, using whichever provider
  is installed.

## Notes

### 2026-10-25
- User decision: speech-to-text is a board, not a Persephone feature; Persephone only registers
  the capability so engines for other languages can be swapped in.
- User decision: v1 is start/stop then transcribe; live typing is a later version.
- Contract shape, engine (whisper.cpp, `large-v3-turbo` q5_0, Vulkan), lazy download and
  `whisper-server` residency recommended by Claude from the measurements above.
- User decision: models and the engine runtime are never part of the board zip. The board page has
  a Mneme-style download UI, so board releases stay small and updates keep the downloaded files.

### 2026-10-26
- BT-055 published `whisper-runtime-1.9.5-r1` (zip SHA-256 `f3db3e57…e1d046`). With the published
  engine on the Intel Arc machine, the 15 s Ukrainian clip took 5.8 s cold and 2.6 s warm; the CI
  runner without a GPU fell back to CPU automatically.
- whisper-server's `language_probabilities` costs a second language-detection pass per request, so
  the provider sends `no_language_probabilities=true` and maps the reported language name to its
  ISO code (BT-056).
