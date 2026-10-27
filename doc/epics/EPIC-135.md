# EPIC-135: Translation service

## Status

**Status:** Active
**Created:** 2026-10-27

## Overview

A new **Translate** board provides a local text-translation service that Persephone and other
boards can call, in the same way the Speech to Text board provides `speech.transcribe`. Persephone
uses it for two features: translating the text in a Monaco page into another language and opening
the result in a new tab, and translating a web page in the Persephone browser into the app
language when the user clicks a Translate button on the toolbar.

## Goals

- A versioned service interface (`text.translate` v1) that any board or Persephone itself can
  discover and call. Persephone has no translation code of its own; it is a consumer.
- A **Translate** board that implements the interface with a local engine. It downloads language
  models on demand, works offline, and needs no API key.
- **Text editor:** "Translate to…" on a Monaco page, for the selection or the whole page, opening
  the translation in a new tab. The source page is never changed.
- **Browser:** a Translate button on the browser toolbar translates the current page in place,
  keeping its layout. Clicking it again shows the original. Nothing is automatic: there is no offer
  bar and no auto-translation (user decision, 2026-10-27).
- Other boards can use the service, for example to translate a live transcript or an agent reply.

## Background (2026-10-27)

- **Whisper cannot do this.** whisper.cpp has a `translate` mode, but it only turns speech into
  English text. It takes no text input, cannot translate into other languages, and the board's
  default `large-v3-turbo` model was trained without translation data. A separate text model is
  needed.
- **Pattern to copy.** The `speech.transcribe` v1 interface is the model for this one: the contract
  lives in `assets/guides/agents/speech-transcribe.md`; consumers find a provider with
  `src/renderer/ui/speech/SpeechTranscriptionProvider.ts` and open a channel with
  `api.connectHostServiceChannel`; the provider board runs a service process
  (`assets/module-service-host.mjs`) and downloads its models on demand (persephone-boards
  `boards/speech-to-text`).
- **App language.** The default target language for the browser button comes from the `language` setting
  (`"auto"` follows the system language).
- **Candidate engines.** See [Research findings](#research-findings-2026-10-27) for the results.
  - **Bergamot** (Mozilla's engine behind Firefox's built-in translation).
  - **OPUS-MT** models (Helsinki-NLP), one model per pair.
  - **NLLB-200** (Meta), one model for about 200 languages.
  - **Small local LLMs** run with llama.cpp, the way the Speech to Text board runs whisper.cpp.
  - **An online LLM** (for example the Claude agent board) as an opt-in engine.

## Research findings (2026-10-27)

Desk research only: nothing has been installed or measured. Items marked *unverified* are for the
proof of concept to settle.

### Recommendation

- **Primary engine: Bergamot, run as WebAssembly inside the board's service process**, with
  Firefox's own models downloaded on demand. It is the only candidate that meets every goal: offline,
  CPU-only, small per-pair models, licences that allow shipping, direct models into English from 59
  languages (including German, Spanish, Japanese and Chinese), and an HTML mode that keeps inline
  markup, which in-page translation needs.
- **Language detection: CLD2**, as Firefox uses (Firefox tried fastText and dropped it for WASM
  performance). The proof of concept confirmed it, and it is the only one tested that tells
  Simplified from Traditional Chinese. It runs over a 1,000 to 4,096 character text sample, with the page's `<html lang>`
  checked first.
- **Optional quality engine, later:** a small translation LLM through llama.cpp (TranslateGemma 4B
  is the current lead), for documents only. It is not part of the proof of concept.
- **Copy Firefox's page-translation design** rather than inventing one; it is described below and in
  enough detail to port.

### Language coverage

The main use is translating pages and documents in languages the user does not read **into English**
(or into the app language), not uk↔en. Firefox's live model list (Remote Settings
`translations-models`, checked 2026-10-27, 116 pairs) has a **direct model into English from 59
languages**:

> af ar az be bg bn bs ca cs da de el es et eu fa fi fr gl gu he hi hr hu id is it ja kn ko lt lv ml
> mr ms mt nb nl nn pl pt ro ru sk sl sq sr sv ta te th tl tr ug uk ur vi zh-Hans zh-Hant

and from English into 57 of them. Every model goes to or from English, with no pairs between two
other languages. So any language → English is one model, and any other target (for example de→uk)
pivots through English with two models.

Download sizes for the current version of each model (model file + shortlist + vocabulary):
- es→en and de→en (v2.0): about 38 MB.
- ja→en and zh-Hans→en (v2.1): about 54 MB.
- zh-Hant→en (v2.0): about 52 MB.

| Engine | uk↔en | Size | Licence (code / models) | Verdict |
|---|---|---|---|---|
| **Bergamot** (Firefox models) | Both directions in production: en→uk v2.2, uk→en v1.1 | About 17 MB (uk→en) and 32 MB (en→uk) per model, int8, plus a vocabulary and a shortlist file each | MPL-2.0 / MPL-2.0 | **Use** |
| OPUS-MT (CTranslate2 or ONNX) | uk→en confirmed; en→uk unverified | About 300 MB fp32 (unverified), less as int8 | Apache-2.0 | Fallback only: no HTML mode, models from 2020 |
| NLLB-200 600M / 1.3B | Yes | Large | CC-BY-NC, and the model card says it is not for production or document translation | Rejected |
| Tower+ 9B, Aya | Yes | 9B | CC-BY-NC | Rejected |
| TranslateGemma 4B / 12B (llama.cpp) | Ukrainian not confirmed in its 55 languages | 4B Q4 about 2.5 GB (unverified) | Gemma terms | Later, opt-in |
| Hunyuan-MT-7B | Ukrainian listed | 7B | Tencent licence, unverified | Not pursued |
| Chrome Translator / LanguageDetector API | — | — | — | **Does not work in Electron**: the APIs never resolve, and Electron cannot ship Chrome's models for legal reasons ([electron#48567](https://github.com/electron/electron/issues/48567)) |

Bergamot details:
- Firefox lists its models in a public Remote Settings collection (`translations-models`, about 116
  pairs). The files are served from a public Google Cloud bucket through a `models.json` registry.
  The `firefox-translations-models` repo has been archived since 2025-12-15 and points to that
  registry.
- **Pivoting:** models go one way only, and pairs without a direct model go through English (for
  example uk→de is uk→en→de). The service must hide this.
- **Packaging:** the npm package `@browsermt/bergamot-translator` (MPL-2.0) is the WASM build, and
  the repo has a Node example (`node-test.js`). A native build would mean compiling
  bergamot-translator ourselves, so start with WASM.
- **Options:** Firefox calls it with `{ qualityScores: false, alignment: true, html: isHTML }`.
- **Quality:** Mozilla ships a model only when it is within about 5% of Google Translate's COMET
  score. The per-pair dashboard (mozilla.github.io/translations/firefox-models) did not load during
  research, so the uk scores are unverified.
- **Risks:**
  - Mozilla states no terms for downloads by other apps. Pin model versions and keep a mirror (for
    example a release asset in persephone-boards) in case the bucket layout changes.
  - MPL-2.0 is file-level copyleft: if we change Bergamot's files we must publish those changes,
    but our own code is unaffected.

### Page translation: how Firefox does it

The source is `toolkit/components/translations/` in Firefox: `translations-document.sys.mjs`,
`translations-engine.worker.js` and `TranslationsParent.sys.mjs`.

- **Units:**
  - Firefox translates whole block elements, not single text nodes. An element with no block-level
    descendants is one unit and is sent as an HTML fragment (`innerHTML`), so links and emphasis
    survive.
  - An element that contains block-level descendants is subdivided.
  - A unit with no markup is sent as plain text.
- **Skipped:**
  - Elements: `CODE`, `KBD`, `SAMP`, `VAR`, `MATH`, `SCRIPT`, `STYLE`, `TEMPLATE`, `TEXTAREA`,
    `IFRAME`, `NOSCRIPT`, `EMBED` and `OBJECT`.
  - `[translate=no]`, `.notranslate` and `contenteditable`.
  - Elements whose own `lang` differs from the page language.
- **Attributes:**
  - Translated: `title`, `alt`, `aria-label`, `aria-description`, `placeholder` (inputs only) and
    `value` (button-like inputs only).
  - They have their own visibility observers.
- **Order:** IntersectionObservers send what is on screen first, then what is near it. Text far off
  screen is not sent until the user scrolls near it.
- **Dynamic pages:**
  - A MutationObserver re-queues units that change, and cancels their pending requests.
  - The observer is paused while Firefox writes translations. Writes are batched every 25 ms.
  - A cache stops it re-translating its own output.
- **Text handling:**
  - Leading and trailing whitespace is stripped before translating and put back afterwards.
  - Soft hyphens are removed.
  - Empty strings are never sent.
- **Frames:** each frame, including cross-origin iframes, gets its own instance. Open shadow roots
  are observed.
- **Restore:** "Show original" puts the original nodes back.
- **Framework risk:** single-page apps (React and others) crash or freeze when a translator detaches
  or merges text nodes they own. Where possible, prefer changing `nodeValue` in place and keep an
  original↔translated map.

### Browser behaviour (user decision, 2026-10-27)

Firefox's offer table is **not** used. Translation is always explicit:

- **A Translate toggle button on the browser toolbar.** Clicking it:
  1. Detects the page language, from the `<html lang>` attribute and the provider's `detect` on a
     1,000 to 4,096 character text sample. If the two disagree and detection is confident, the
     detected language wins.
  2. Translates straight away if the model is installed. If it is not, it asks to download it
     (showing the size), downloads it with progress, and then translates.
  3. If the page is already in the target language, it says so and does nothing.
- **While it is on,** the button stays active and content the page adds later is translated too.
  A popup on the button shows the detected language with a dropdown to correct it.
- **Clicking it again** turns translation off and restores the original.
- **One page load only.** A reload or navigation shows the page untranslated, with the button off.
- **No offer bar, no auto-translate, no "always" or "never" lists.**

**The user never has to name the source language.** Pages and editor text are detected
automatically. The UI shows the detected language, for example "Translated from Japanese", with a
dropdown to correct it. Short text, such as a short selection in the editor, gives a less reliable
guess, so the correction matters most there. Telling Japanese from Chinese is reliable because
Japanese text mixes kana with kanji; the PoC should confirm this, and also Simplified versus
Traditional Chinese.

### Contract shape (`text.translate` v1 draft, for US-1734)

Modelled on Firefox's engine messages: `translation-request` (`sourceText`, `isHTML`),
`translation-response` (`targetText`), `cancel-single-translation` and `discard-translation-queue`.

```
describe → { pairs: [{ from, to, installed, sizeBytes }] }
request  → { id, from?, to, scope?, priority?: "visible" | "near" | "background",
             items: [{ key, text, format: "text" | "html" }] }
progress ← { id, done, total }   and   { type: "download", pair, loaded, total }
response ← { id, items: [{ key, ok: true, text } | { key, ok: false, error }] }
cancel   → { id } | { scope }    // scope = one page, so leaving a page drops its queue
```

The service handles pivoting through English, loads models lazily, and keeps one engine per pair.

### Documents (design, not researched)

No primary source covers document translation, so this is the plan for the text editor:

- **Markdown:** parse it and translate only text nodes and link labels. Leave code fences, inline
  code, URLs and raw HTML unchanged.
- **Granularity:** send one paragraph or list item per item, so the line structure is kept. Split
  long paragraphs into sentences with `Intl.Segmenter`.
- **Code files:** translate comments only, as a later option.
- **Line layout:** keep list markers and indentation outside the translated text.

### Proof of concept (2026-10-27)

A throwaway proof of concept in `C:\projects\translate-poc`, outside both repos. Codex wrote and ran
it, using these assets:

- **Engine:** Firefox's current engine (Bergamot WASM 4.0, from the `translations-wasm-v2`
  collection), driven the way Firefox's `translations-engine.worker.js` drives it, in plain Node 24.
  That is the same runtime as a board service process.
- **Models:** Firefox's current desktop models (v3.0, from `translations-models-v2`). The download
  files are zstd-compressed and decompressed with `node:zlib`.
- **Pages:** the Wikipedia "Coffee" article in each language.

Results:

| Pair | Download | Model load | Speed (source chars/s, CPU, 1 thread) |
|---|---:|---:|---:|
| de→en | 24 MB | 110 ms | 2,862 |
| es→en | 25 MB | 69 ms | 2,565 |
| ja→en | 46 MB | 132 ms | 1,631 |
| zh-Hans→en | 48 MB | 133 ms | 996 |
| zh-Hant→en | 36 MB | 113 ms | 1,008 |
| de→uk (pivot via en) | 24 + 24 MB | 186 ms | 682 |

- **Quality:** German and Spanish read naturally. Japanese and Chinese are understandable but
  rougher; for example, part of one word was left untranslated ("coffee ノキ"). Short strings such as
  headings are good.
- **HTML mode:** links and bold text survived in all five languages.
- **Detection:**
  - Firefox's CLD2 runs in Node, as a worker thread. It labelled Japanese `ja`, Simplified Chinese `zh` and Traditional Chinese `zh-Hant`.
  - `eld` and `cld3-asm` never confused Japanese with Chinese, but they say only `zh` for both Chinese scripts.
  - CLD3 misread some short Spanish and Japanese snippets as Latin and Serbian (`la`, `sr`).
  - A simple check that counts characters that differ between Simplified and Traditional Chinese
    got both pages right. On snippets it was sure for 9 of 10 per page; the tenth was uncertain.
- **Memory:** each pair was measured in a fresh process.

  | Run | Peak RSS | WASM heap |
  |---|---:|---:|
  | de→en | 327 MiB | 58 MiB loaded → 235 MiB after translating |
  | es→en | 412 MiB | 48 → 338 MiB |
  | ja→en / zh-Hans→en | about 495 MiB | 91 → 434 MiB |
  | zh-Hant→en | 398 MiB | 70 → 329 MiB |
  | de→uk pivot (two models) | 407 MiB | 97 → 348 MiB |

  Loading a model is cheap; a second model in the same WASM instance added 43 MiB. Most of the memory
  is the heap growing while it translates, and an Emscripten heap never shrinks. Lowering Bergamot's
  `workspace` option from 128 to 16 changed nothing. **Consequences:**
  - Keep one WASM instance holding every loaded model.
  - Run it in a worker that is terminated after an idle period to give the memory back.
  - Keep translation batches small to limit how far the heap grows.

## Plan

Two repos are involved:
- **persephone-boards** gets the engine and the Translate board (BT tasks).
- **persephone** gets the contract, the host plumbing and the two consumers (US tasks).

Codex writes each task document as the task starts.

### Contract and host

- **US-1734 — `text.translate` v1 contract and host consumer.**
  - Write `assets/guides/agents/text-translate.md`, using the draft above (`describe`, `detect`,
    `translate` with keyed text or HTML items, progress, cancel by id or scope, model-download
    progress).
  - Add the interface to `PLATFORM_SERVICE_INTERFACE_IDS` in `src/shared/board-manifest-utils.ts`.
  - Generalise `connectHostServiceChannel` in `src/main/module-service-supervisor.ts`, which today
    accepts `speech.transcribe` only, to allow a set of interfaces, each with its own allowed open
    types.
  - Add a renderer client next to `src/renderer/ui/speech/SpeechTranscriptionProvider.ts` to discover
    providers, detect languages and translate batches.
  - Bump the bridge version if the board API changes.

### Translate board

- **BT-069 — Bergamot runtime.** An engine module the service process loads:
  - **Vendored engine:** the Firefox WASM and glue, vendored with their MPL-2.0 notices.
  - **Model registry:** read from Remote Settings `translations-models-v2`, desktop variants only.
  - **Downloads:** on demand, with hash checks against `decompressedHash`, zstd decompression and a
    local cache folder.
  - **Pivot through English.**
  - **Lifecycle:**
    - One WASM instance, in a worker thread, holding the loaded models.
    - Models are loaded lazily.
    - The worker is terminated after an idle period, because the heap never shrinks.
    - Batches are capped in size to limit how far the heap grows.
  - **Mirror:** a pinned mirror URL as a fallback.
- **BT-070 — Translate board v1.0.0.**
  - **Service:** the `text.translate@1` provider, built on BT-069.
  - **Language detection:** Firefox's CLD2, run in a worker thread; it is the only detector tested that
    tells Simplified from Traditional Chinese.
  - **Board page:** pick and download languages, remove them, show sizes, and a test panel for
    pasting text.
  - **Release:** `minAppVersion` is the Persephone release that ships US-1734. The board stays
    unpublished until then.

### Consumers in Persephone

- **US-1735 — "Translate to…" in the text editor.**
  - **Scope:** a command for the selection or the whole page.
  - **Languages:** the target is chosen from installed and available languages, with the last choice
    remembered; the source is detected and shown with an override.
  - **Segmentation:**
    - Markdown: translate text and link labels, keep code fences, inline code and URLs.
    - Plain text: one paragraph per item, keeping the line layout.
  - **Output:** a new tab with the same editor type.
  - **Feedback:** progress and cancel.
- **US-1736 — In-page translation engine for browser pages.** A script injected into each frame,
  porting Firefox's `translations-document` design:
  - **Units:** block-level units sent as HTML fragments.
  - **Skipped:** the exclusion list, `translate="no"` and `contenteditable`.
  - **Attributes:** the translatable attribute list.
  - **Order:** what is on screen first, then what is near it.
  - **Changes:** a MutationObserver that is paused while translations are written, with writes
    batched.
  - **Restore:** "Show original".
  - **Framework safety:** prefer changing `nodeValue` in place.
  - **Transport:** batches go through the renderer to the provider.
- **US-1737 — Translate button in the browser.** The flow is in
  [Browser behaviour](#browser-behaviour-user-decision-2026-10-27).
  - **The toggle button:** turns translation on and off.
  - **Detecting the page language:** with a dropdown to correct it.
  - **Model downloads:** asks before downloading a missing model, then shows progress.
  - **The target:** a "Translate pages into" setting, defaulting to the app language.
  - **Page lifetime:** translation lasts for the current page load only.

### Order

1. US-1734 and BT-069 can run in parallel.
2. BT-070 (needs both).
3. US-1735: the first end-to-end use, and the easiest to judge.
4. US-1736, then US-1737.
5. Epic close: `/review`, `/document` and `/userdoc` for the US tasks.

Optional follow-ups after the epic:
- live translation of a transcript (EPIC-134);
- agent tools for translation;
- an opt-in LLM engine (TranslateGemma via llama.cpp) for documents.

## Concerns / Open Questions

- **Quality versus size.** Small offline models translate noticeably worse than an LLM. Should the
  board offer an online engine as an opt-in?
- **Licenses.** Model licenses differ (some are non-commercial) and decide which models the board
  may download.
- **Browser pages.** Translating in place has to survive pages that re-render (single-page apps).
  Text inside inputs, attributes such as `title` and `alt`, and iframes each need a decision.
- **Privacy.** A local engine keeps page and document text on the machine. Any online engine must
  say clearly that text leaves it.
- **Where the browser control lives.** Decided: an explicit toolbar toggle button, with no offer
  bar (see Browser behaviour).

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| [US-1734](../tasks/US-1734-text-translate-contract/README.md) | `text.translate` v1 contract and host consumer | Planned |
| BT-069 | Bergamot runtime (persephone-boards) | Planned |
| BT-070 | Translate board v1.0.0 (persephone-boards) | Planned |
| [US-1735](../tasks/US-1735-translate-text-page/README.md) | "Translate to…" in the text editor | Planned |
| [US-1736](../tasks/US-1736-browser-page-translation/README.md) | In-page translation engine for browser pages | Planned |
| [US-1737](../tasks/US-1737-browser-translate-button/README.md) | Translate toggle button in the browser | Planned |

## Notes

### 2026-10-27
- Epic recorded at the user's request and placed under Planned. No work has started.
- Desk research done by two research agents: one on engines, one on how Firefox translates
  pages; I verified the open points myself where I could.
  - Recommended: Bergamot (WASM) with Firefox's models, CLD2 for language detection, and Firefox's
    page-translation design.
  - Proof of concept run (see above). Bergamot is confirmed: the speed, the HTML mode and the
    detection all work.
  - The user moved the epic to Active, and the plan was split into US-1734 – US-1737 and
    BT-069 – BT-070.
