# EPIC-135: Translation service

## Status

**Status:** Planned
**Created:** 2026-10-27

## Overview

A new **Translate** board provides a local text-translation service that Persephone and other
boards can call, in the same way the Speech to Text board provides `speech.transcribe`. Persephone
uses it for two features: translating the text in a Monaco page into another language and opening
the result in a new tab, and translating a web page in the Persephone browser into the app
language, the way Chrome offers to.

## Goals

- A versioned service interface (`text.translate` v1) that any board or Persephone itself can
  discover and call. Persephone has no translation code of its own; it is a consumer.
- A **Translate** board that implements the interface with a local engine. It downloads language
  models on demand, works offline, and needs no API key.
- **Text editor:** "Translate to…" on a Monaco page, for the selection or the whole page, opening
  the translation in a new tab. The source page is never changed.
- **Browser:** when a page's language differs from the app language, offer to translate it. The
  page is translated in place, keeping its layout, and "Show original" restores it.
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
- **App language.** The target language for the browser offer comes from the `language` setting
  (`"auto"` follows the system language).
- **Candidate engines.** Verify each one in phase 1; nothing below has been measured yet.
  - **Bergamot** (Mozilla's engine behind Firefox's built-in translation). It runs on the CPU, uses
    small models per language pair, and has an HTML mode that keeps markup. Many pairs go through
    English.
  - **OPUS-MT** models (Helsinki-NLP), one model per pair, run with CTranslate2 or ONNX Runtime.
  - **NLLB-200** (Meta): one model for about 200 languages, but much larger, and its license may
    rule out redistribution.
  - **An LLM** (for example the Claude agent board) as an optional online engine. It gives better
    quality and can follow context, but needs a network connection and an account.

## Phases

1. **Engine research.** For the candidates, compare:
   - quality on uk↔en and one other pair;
   - speed on CPU for a page of text;
   - model size and memory use;
   - whether the license allows downloading the models from the board;
   - support for HTML or markup;
   - language detection (needed for the browser offer).

   Recommend an engine. **Gate:** the user agrees.
2. **Contract.** Define `text.translate` v1:
   - requests carrying plain text or HTML fragments, with the source language optional (detect it
     when missing);
   - batching for many short strings (web page text nodes);
   - progress and cancellation;
   - a `describe` reply listing the supported pairs and which ones are installed.

   Write the agent guide alongside `speech-transcribe.md`.
3. **Translate board.** Implement the service and the model downloads, with board settings for the
   installed languages and a test panel.
4. **Text editor.** A "Translate to…" command: pick the target language, translate the selection or
   the whole page, and open the result in a new tab with the same editor type.
5. **Browser page translation.**
   - Detect the page language and offer translation when it differs from the app language.
   - Translate the visible text in batches.
   - Keep translating content that the page adds later.
   - Restore the original on request.
6. **Optional follow-ups.** Live translation of a transcript (EPIC-134), and agent tools for
   translation.

## Concerns / Open Questions

- **Quality versus size.** Small offline models translate noticeably worse than an LLM. Should the
  board offer an online engine as an opt-in?
- **Licenses.** Model licenses differ (some are non-commercial) and decide which models the board
  may download.
- **Browser pages.** Translating in place has to survive pages that re-render (single-page apps).
  Text inside inputs, attributes such as `title` and `alt`, and iframes each need a decision.
- **Privacy.** A local engine keeps page and document text on the machine. Any online engine must
  say clearly that text leaves it.
- **Where the browser offer lives.** It could be a bar in the browser editor or a toolbar button. It
  should be quiet and remember "never translate this language/site".

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| — | Tasks are created when the epic starts | — |

## Notes

### 2026-10-27
- Epic recorded at the user's request and placed under Planned. No work has started.
