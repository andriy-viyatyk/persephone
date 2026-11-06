---
title: "Speech Synthesis — the speech.synthesize v1 contract"
audience: both
summary: "Normative provider and consumer contract for streamed speech synthesis over board service channels."
---

# Speech Synthesis — the `speech.synthesize` v1 contract

This is the normative contract for boards that provide or consume `speech.synthesize` version 1. One channel handles one operation. The provider owns its engine and caller approval policy; the consumer owns playback.

## Declarations and transport

Declare the exact interface version in `board-manifest.json`:

```json
// Provider
{"minAppVersion":"5.0.18","permissions":{"service":true},"serviceInterfaces":[{"id":"speech.synthesize","version":1,"title":"Speech Synthesis"}]}
// Consumer
{"minAppVersion":"5.0.18","uses":[{"id":"speech.synthesize","version":1}]}
```

`uses` grants messaging access only, not the provider's permissions. The provider must be trusted, have its own `service` permission, and apply its caller approval policy to every request. Refuse a caller with the platform close code `connection-refused`. The Persephone host caller is `{ id: "persephone", name: "Persephone" }`, with `info.interface = { id: "speech.synthesize", version: 1 }`. The `accept-granted` policy accepts this reserved interface; `same-board-only` refuses the host. The app needs no board `uses` declaration.

Discover with `persephone.services.list("speech.synthesize")`, connect with `persephone.services.connect("speech.synthesize", selector, openMessage)`, and handle opens with `persephone.service.onChannel((channel, openMessage, info) => ...)`. Versions match exactly. See the [Boards guide](./boards.md) for trust, grants and channel lifecycle.

## Opening requests

| Request | Meaning |
|---|---|
| `{ type: "describe" }` | Return provider metadata and close. |
| `{ type: "speak", text: string, lang: string, voice?: number, speed?: number }` | Synthesize text in the requested ISO 639-1 language. |

Omitted `voice` selects `description.defaultVoice`; omitted `speed` is 1. Speed is a finite positive multiplier. Providers should accept at least 0.5–2 and return `invalid-argument` for an out-of-range speed. Validate all inputs and reject unsupported language and voice selections. No request starts a download. `describe` is metadata, not a guarantee that a model is installed.

## Consumer to provider

The opening request contains all input. The consumer cancels by closing the channel. All messages are structured-cloneable.

## Provider to consumer

| Message | Meaning |
|---|---|
| `{ type: "description", local: boolean, languages: string[], voices: { index: number, name: string }[], defaultVoice: number, sampleRate: number, encoding: "pcm-f32le" }` | Reply to `describe`, then close. |
| `{ type: "audio", data: ArrayBuffer, sampleRate: number, encoding: "pcm-f32le", sentence: number, text: string }` | Ordered audio chunk for `speak`. |
| `{ type: "done" }` | Synthesis finished; send after all audio, then close. |
| `{ type: "error", code: string, message: string }` | Terminal failure; send and close. |

Description language codes are ISO 639-1. Voice indices are stable within a provider and `defaultVoice` must occur in `voices`. The description's sample rate is the default output rate in Hz. `local: true` means audio is processed on the user's machine and does not leave it; `local: false` means audio leaves the machine and consumers should disclose that before use.

Audio is mono IEEE Float32 PCM, little-endian, with only whole samples in `data`. Each message gives its actual sample rate in Hz. `sentence` is a zero-based index; a sentence may span several consecutive messages, each repeating that sentence's `text`. V1 consumers must reject any encoding other than `pcm-f32le` without playback, whether advertised in a description or received in audio. The explicit encoding field permits future encodings without changing the interface version.

Use terminal errors `not-ready` (engine or model absent), `invalid-argument` (invalid input or speed), `unsupported-language`, `unsupported-voice`, and `engine-failed`. Explain the failure in `message`. Provider refusal uses the platform close reason `connection-refused`.

## Lifecycle and limits

Check approval before every operation. On failure send an error and close; on consumer close, stop work and release request resources. Register message and close handlers before any await; messages arriving without a handler are not replayed. Honor `writable` and `whenWritable()` in both directions. Service-to-page serialized messages are limited to 1 MiB and each direction permits 256 unacknowledged messages. Keep each audio payload at or under 256 KiB. Node providers run in an Electron utility process, which rejects external ArrayBuffers: copy native audio into an ordinary buffer before sending it (with `sherpa-onnx-node`, pass `enableExternalBuffer: false`).

## Forward compatibility

Consumers ignore unknown message types and fields. Providers preserve v1 field meanings and required behavior. Incompatible changes require a new interface version and guide.

## Minimal consumer

```js
const provider = (await persephone.services.list("speech.synthesize")).find(p => p.version === 1);
if (!provider) throw new Error("No synthesis provider");
// receiveOne registers message and close handlers, rejects errors, and resolves the description.
const description = await receiveOne(await persephone.services.connect("speech.synthesize",
  { provider: provider.provider, version: 1 }, { type: "describe" }));
if (description.encoding !== "pcm-f32le") throw new Error("Unsupported encoding");
const channel = await persephone.services.connect("speech.synthesize",
  { provider: provider.provider, version: 1 }, { type: "speak", text: "Hello.", lang: "en" });
channel.onMessage(message => {
  if (message.type === "audio") {
    if (message.encoding !== "pcm-f32le") { stopPlayback(); channel.close(); return; }
    queuePlayback(message.data, message.sampleRate, message.sentence, message.text);
  }
  if (message.type === "done") finishPlayback();
  if (message.type === "error") { stopPlayback(); showError(message.code, message.message); }
});
channel.onClose(() => stopPendingWork());
// On cancellation: stopPlayback(); channel.close();
```

## Minimal provider

```js
persephone.service.onChannel(async (channel, open, info) => {
  channel.onMessage(message => bufferEarlyMessage(message)); // before any await
  channel.onClose(() => cancelWorkAndReleaseResources());
  if (!approvalPolicyAllows(info)) {
    channel.close({ code: "connection-refused", message: "Caller refused." }); return;
  }
  try {
    if (open.type === "describe") {
      channel.send({ type: "description", local: true, languages: ["en"],
        voices: [{ index: 0, name: "Default" }], defaultVoice: 0, sampleRate: 24000, encoding: "pcm-f32le" });
    } else if (open.type === "speak") {
      await validateAndCheckInstalled(open); // throws a contract error; never downloads
      for await (const chunk of synthesizeCopiedChunks(open)) {
        if (!channel.writable) await channel.whenWritable();
        channel.send({ type: "audio", ...chunk, encoding: "pcm-f32le" });
      }
      if (!channel.writable) await channel.whenWritable();
      channel.send({ type: "done" });
    } else throw contractError("invalid-argument");
  } catch (error) {
    if (!channel.writable) await channel.whenWritable();
    channel.send(toContractError(error));
  } finally { channel.close(); }
});
```

Helper names represent provider-owned validation, engine, cancellation, and error mapping. Production code must stop sending after close and handle cancellation races.
