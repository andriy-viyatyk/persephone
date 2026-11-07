---
title: "Speech synthesis capability"
audience: both
summary: "Speak text using a speech synthesis provider."
---

# Speech synthesis capability

`speech.synthesize@1` provides speech through the unified [capability registry](capabilities.md).
The Text to Speech board synthesizes locally and plays through Persephone's [audio service](audio.md).
Install its runtime and model explicitly from the board page; requests do not download them.

## Methods

`speak(text, options?)` accepts nonempty text and optional `{ lang?, voice?, speed? }`.
The language is a supported language code. When omitted, text containing Cyrillic defaults to
Ukrainian (`uk`); other text defaults to English (`en`). Voice is a numeric index from 0 to 9;
when omitted, the board's default-voice setting applies. Speed is a finite number from 0.5 to 2
and defaults to 1. There is no board-imposed text-length limit, although transport limits apply.

The call returns `{ status: "finished" | "interrupted" }` when playback completes or is
interrupted. A new `speak` replaces the previous speech. `stop()` stops current speech and
returns `null`. A single speak call has a ten-minute end-to-end timeout including startup,
synthesis and playback. Cancellation or timeout aborts playback.

## Errors

Failures reject with a platform code and a message meant for the caller:

| Code | When |
|---|---|
| `rejected` | Invalid text, speed, voice or language; the model is not installed (install it from the board page); synthesis or playback failed. The message names the case. |
| `busy` | The runtime or model is being installed or deleted. |
| `permission-denied` | The provider's caller approval policy refuses the caller. |
| `no-handler` | The audio service is unavailable to the provider. |
| `timeout` / `cancelled` | The ten-minute deadline passed, or the caller cancelled. |

## Using it

From a board page or service that declares the `uses` entry below:

```js
const speech = await persephone.getCapability("speech.synthesize");
if (speech) {
  const { status } = await speech.speak("The build finished.");
  // status is "finished", or "interrupted" when stop() or a newer speak() cut it off
}
```

An agent calls `capabilities["speech.synthesize"].speak("The build finished.")` through the
`call` tool, and `capabilities["speech.synthesize"].stop()` to cut it off.

## Callers and grants

The board's caller-approval-policy setting may restrict calls to its own page. Board consumers
declare `uses: [{ "id": "speech.synthesize", "version": 1 }]`; providers require the service
permission and authorize each call. See [Capabilities](capabilities.md) for declarations,
discovery, caller grants and cancellation.

The legacy `describe` channel returns
`{ type: "description", local, languages, voices, defaultVoice, sampleRate, encoding }`
and then closes. Voices have numeric `index` and `name` fields; language codes are ISO 639-1.
This metadata does not guarantee that a model is installed. The former PCM-returning `speak`
channel is refused. Consumers should use the callable methods.
