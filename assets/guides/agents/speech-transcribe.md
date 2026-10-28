---
title: "Speech Transcription — the speech.transcribe v1 contract"
audience: both
summary: "Normative provider and consumer contract for record-then-transcribe audio, with an optional advertised live feature, over Persephone board service channels."
---

# Speech Transcription — the `speech.transcribe` v1 contract

This is the normative contract for boards that provide or consume `speech.transcribe` version 1. One channel represents one transcription or one provider-description request. The consumer records and streams audio; the provider returns one result or error and closes the channel. The provider owns its engine, data handling, and caller approval policy.

## Declarations and transport

Declare the exact interface version in `board-manifest.json`:

```json
// Provider
{"minAppVersion":"5.0.15","permissions":{"service":true},"serviceInterfaces":[{"id":"speech.transcribe","version":1,"title":"Speech to Text"}]}
// Consumer; also declare permissions.microphone when the page records audio
{"minAppVersion":"5.0.15","uses":[{"id":"speech.transcribe","version":1}],"permissions":{"microphone":true}}
```

`uses` grants messaging access only. It does not grant the provider's permissions or authorize the consumer to approve provider actions. Providers must be trusted and have their own `service` permission. A provider must apply its own approval policy to every caller. If it refuses a caller, close with the platform's normal `connection-refused` code.

Persephone itself can consume `speech.transcribe@1` for Voice Typing. It identifies as caller
`{ id: "persephone", name: "Persephone" }` and supplies the exact `speech.transcribe@1` interface
metadata through a host-owned channel. A provider with `caller-approval-policy = accept-granted`
accepts this reserved interface; `same-board-only` refuses the host caller with
`connection-refused`. The app consumer does not need a board `uses` declaration or microphone
permission because capture is granted separately to the Persephone window.

Use `persephone.services.list("speech.transcribe")` to discover providers and `persephone.services.connect("speech.transcribe", selector, openMessage)` to open a cross-board channel. The provider handles cross-board and same-board opens with `persephone.service.onChannel((channel, openMessage, info) => ...)`. Versions match exactly. See the [Boards guide](./boards.md) for trust, grants, channel limits, and lifecycle behavior.

## Opening requests

`services.connect` sends one opening request. For transcription, use:

```js
{
  type: "transcribe",
  format: { encoding: "pcm-s16le", sampleRate: 16000, channels: 1 },
  languages: ["uk", "en"], // optional ISO 639-1 hints; absent or [] means auto-detect
  prompt: "Persephone, Codex, board", // optional vocabulary hint
  translate: true, // optional; request English text from spoken speech
  live: true // optional; use only when describe advertises "live"
}
```

V1 accepts mono, signed 16-bit little-endian PCM at 16,000 samples per second. `languages` is optional; an absent or empty list asks the provider to detect the language, or to apply its own configured languages. One code asks the provider to transcribe in that language; several codes ask it to keep the transcript in one of them. `prompt` is an optional vocabulary hint. The optional `translate: true` field asks the provider to produce English text from spoken speech. It is an additive open field in v1: omitted or false keeps ordinary transcription behavior, and providers predating this option may ignore it and return their normal transcript. Consumers must still record and handle the result. Providers implementing translation must detect and settle the spoken source language, then produce text using English decoding. A provider may also use its engine's dedicated translation task when the selected model supports it; that task is separate from the meaning of this request field. Providers may reject a different format with `unsupported-format`.

`{ type: "describe" }` asks for provider metadata. The provider answers with one `description` message and closes the channel; it does not start recording or transcription. Send `live: true` only when that provider's `features` includes `"live"`. A provider that does not advertise it ignores the field and handles the request as ordinary v1, so consumers must still support the final result by itself.

## Consumer to provider

After a `transcribe` open, the consumer sends any number of ordered audio messages, then exactly one terminal control message:

| Message | Fields | Meaning |
|---|---|---|
| `audio` | `data: ArrayBuffer` | An ordered chunk of PCM s16le audio in the opening format. |
| `end` | — | No more audio; finish the recording and transcribe it. |
| `cancel` | — | Cancel this transcription. |

Respect channel backpressure with `writable` and `whenWritable()` before sending. Chunks should be small enough for timely delivery. A provider may reject a non-live request whose accumulated duration exceeds its advertised `maxAudioMs`; it must not silently truncate and report that as a complete transcription. `maxAudioMs` is not a total-duration cap for requests opened with `live: true`.

## Provider to consumer

All provider messages are structured-cloneable objects with a string `type` discriminator.

| Message | Fields | Meaning |
|---|---|---|
| `status` | `state: "preparing" \| "listening" \| "transcribing"`, optional `detail` | `listening` is sent once immediately after accepting a `transcribe` open. `preparing` means loading an already-installed engine/model and may include numeric `detail.progress`; downloads are not part of a transcription request. `transcribing` means the provider is processing the completed audio. |
| `draft` | `utterance`, `text`, `startMs`, `endMs` | Optional live preview for one utterance. Text is trimmed. Covers only the utterance's text not yet sent as a segment. A newer draft replaces the previous draft for that utterance; no draft is sent after the utterance's last segment, and an utterance may have no draft. |
| `segment` | `utterance`, `text`, `language`, `startMs`, `endMs` | Optional live final text. Text is trimmed. One utterance may produce several segments while the user is still speaking; each carries only new text, never repeating an earlier segment. Segments arrive in order, by utterance and within an utterance; utterance ids may skip. |
| `result` | `text`, `language`, `audioMs`, `elapsedMs` | The single successful transcription result. `language` is the ISO 639-1 code the provider detected or was instructed to use, or `""` when unknown. Send this once, then close. |
| `error` | `code`, `message` | A terminal failure. Send a useful explanation, then close. |
| `description` | `engine`, `model`, `languages`, `local`, `maxAudioMs`, `features` | Provider metadata returned only for `describe`. |

`languages` in a description is `"auto"` or an array of supported language codes. `local: true` means the audio is processed on the user's machine and does not leave it; `local: false` means audio leaves the machine and consumers should disclose that before recording. `maxAudioMs` is the provider's maximum duration for a non-live request, in milliseconds. A live request has no total-duration cap; providers must instead keep audio context, prompt history, and queued work bounded. V1 `features` is an array of optional behaviors the provider supports (for example, `"live"` and `"translate"`); providers with no optional features return `[]`. `"translate"` means the provider handles `translate: true` as English-output dictation. It does not promise a particular underlying engine task. Speech to Text advertises `"translate"` for every model because its English decoding path is available for all its models, including Large v3 Turbo; its use of Whisper's dedicated translate task remains model-dependent. Consumers must not infer behavior that the provider did not advertise.

Use these v1 error codes:

| Code | Meaning |
|---|---|
| `not-ready` | Required engine or model is not installed. The provider sends this immediately when it receives a `transcribe` open, before accepting it, and closes. `message` explains how the user can make it ready. |
| `unsupported-format` | The opening format is unsupported. |
| `too-long` | A non-live request exceeds `maxAudioMs`. The provider sends this as soon as accumulated audio exceeds the limit, then closes; it does not wait for `end`. Live requests are not rejected for total duration. |
| `engine-failed` | The transcription engine failed. |
| `cancelled` | The consumer cancelled the operation. |

The provider may also refuse the connection before accepting the open request with the platform close code `connection-refused`.

## Lifecycle and limits

One channel handles one request. The provider checks its approval policy before describing or accepting any request. For `transcribe`, it checks readiness at open: if the required engine or model is not installed, it immediately sends `not-ready` and closes without accepting the request or starting a download. Otherwise it accepts the request and sends `listening` exactly once, immediately. Consumers may start streaming as soon as `connect` resolves; they must not wait for `listening`. A service channel delivers each message only to the handlers registered when it arrives, so the provider registers `channel.onMessage` at the start of `onChannel`, before any `await`, and keeps what arrives until it accepts the request; otherwise early audio and even `end` are lost. The provider buffers audio received while it loads the already-installed engine/model. In live mode, `draft` and `segment` messages may arrive while `listening`; `preparing` may also appear during `listening` if the engine is still loading when the first live job starts. After `end`, the provider sends `transcribing`, the remaining `draft` and `segment` messages, then exactly one `result` or `error`; the result keeps the v1 fields. For the Speech to Text provider, `result.text` is the nonempty segment texts joined with one space, and each segment's `startMs`/`endMs` is an offset from the first audio sample. Once it has committed text backed by at least two seconds of speech, that provider may fix the detected language for the rest of the live stream; each segment includes its own `language`. Without `live`, the normal status order is `listening` → after `end`, optional `preparing` → `transcribing` → exactly one `result` or `error`. Terminal pre-accept errors such as `not-ready` or `unsupported-format` may close without a status; `too-long` is sent immediately during streaming if the limit is exceeded, without waiting for `end`. `preparing` only reports loading an installed engine/model; first-run downloads are user-triggered separately. If the consumer sends `cancel`, stop work, send `error` with code `cancelled` when the channel is still writable, and close. On any `error`, the consumer stops microphone capture. If the channel closes first, stop recording/transcription work and release request-scoped resources. Do not keep sending after close.

Each provider advertises its own `maxAudioMs` and enforces that limit for non-live requests. Speech to Text advertises five minutes for non-live requests; other providers may choose a different finite limit. Live requests may continue without a total-duration cap, but providers must bound retained audio context, prompt/history state, and queued work. Keep provider-to-consumer messages within the platform's 1 MiB serialized-message limit and obey channel backpressure. A single result contains text and timing, not audio.

## Forward compatibility

Consumers must ignore unknown provider message types and unknown fields on known messages. Providers may add fields to v1 messages, but must preserve the meaning of existing fields and behavior. New optional behavior is advertised through `features`; do not infer behavior without its feature being advertised. The additive `"live"` feature keeps v1 and is opt-in through `live: true`; providers that do not support it handle the request as ordinary v1, so consumers must continue to handle a final result without live messages. The optional `translate: true` field also keeps v1: legacy providers may ignore it, while consumers retain their normal result insertion behavior. An incompatible protocol change requires a new interface version and a separate contract.

## Minimal consumer

The capture implementation below is abbreviated: an `AudioWorklet` captures mono samples, resamples to 16 kHz if necessary, converts each sample to signed PCM s16le, and calls `sendChunk(ArrayBuffer)` as chunks are ready.

```js
const providers = await persephone.services.list("speech.transcribe");
if (providers.length === 0) throw new Error("No speech.transcribe provider is installed");

const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
const channel = await persephone.services.connect("speech.transcribe", {
  provider: providers[0].provider, version: 1,
}, {
  type: "transcribe",
  format: { encoding: "pcm-s16le", sampleRate: 16000, channels: 1 },
  languages: ["uk", "en"],
  prompt: "Persephone, Codex, board",
});
channel.onMessage(message => {
  if (message.type === "status") showStatus(message.state, message.detail);
  if (message.type === "result") insertAtCursor(message.text);
  if (message.type === "error") {
    stopCapture();
    showError(message.code, message.message);
  }
});
function stopCapture() {
  stopWorklet();
  stream.getTracks().forEach(track => track.stop());
}
// The worklet emits ArrayBuffer chunks after conversion to 16 kHz PCM s16le.
async function sendChunk(data) {
  if (!channel.writable) await channel.whenWritable();
  channel.send({ type: "audio", data });
}
// On the user's stop action: flush the last chunk, release the microphone, then end the stream.
await stopWorkletAndFlush(sendChunk);
stream.getTracks().forEach(track => track.stop());
channel.send({ type: "end" });
```

The consumer needs the manifest's `uses` declaration and microphone permission because it owns capture. For live requests, insert each `segment` as final text when it arrives, adding a separator before it when needed; several segments of one utterance are consecutive pieces of it; show `draft.text` only as a replaceable preview, never as committed text. On `result`, do not insert `result.text` again if segments were inserted: it contains the same text joined by single spaces. A consumer that ignored live messages uses `result.text` as before. Consumers must not send or submit transcribed text automatically unless their own UX explicitly asks the user.

Dictation consumers may opt into the app-wide auto-stop duration through `persephone.voiceTyping` (board bridge 1.44.0). Feature-detect the API before using it because older Persephone apps do not expose it. Its configured duration is shared with Persephone voice typing; consumer-specific recording and stop behavior remains the board's responsibility.

## Minimal provider

```js
persephone.service.onChannel(async (channel, open, info) => {
  // Collect before any await: messages that arrive with no handler registered are dropped.
  const early = [];
  const stopEarly = channel.onMessage(message => early.push(message));
  // Check first: even describe and malformed requests disclose nothing to refused callers.
  if (!approvalPolicyAllows(info)) {
    channel.close({ code: "connection-refused", message: "This provider does not accept this caller." });
    return;
  }
  if (open?.type === "describe") {
    channel.send({
      type: "description", engine: "Example Engine", model: "Example Model",
      languages: "auto", local: true, maxAudioMs: 300000, features: [],
    });
    channel.close();
    return;
  }
  if (open?.type !== "transcribe") {
    channel.close({ code: "connection-refused", message: "Unsupported request." });
    return;
  }
  // Check before accepting the request so the consumer can stop capture immediately.
  if (!await isEngineAndModelInstalled()) {
    channel.send({ type: "error", code: "not-ready", message: "Install the engine and model in this provider board first." });
    channel.close();
    return;
  }
  if (open.format?.encoding !== "pcm-s16le" || open.format.sampleRate !== 16000 || open.format.channels !== 1) {
    channel.send({ type: "error", code: "unsupported-format", message: "Use mono PCM s16le at 16 kHz." });
    channel.close();
    return;
  }
  channel.send({ type: "status", state: "listening" });
  const engineReady = loadInstalledEngineAndModel();
  const chunks = [];
  let receivedAudioMs = 0;
  const handle = async message => {
    if (message.type === "audio") {
      receivedAudioMs += durationMs(message.data);
      if (receivedAudioMs > 300000) {
        channel.send({ type: "error", code: "too-long", message: "Recording exceeds this provider's five-minute limit." });
        channel.close();
        return;
      }
      chunks.push(message.data);
    }
    if (message.type === "cancel") {
      await cancelTranscription();
      channel.send({ type: "error", code: "cancelled", message: "Transcription cancelled." });
      channel.close();
    }
    if (message.type === "end") {
      if (!engineIsLoaded()) channel.send({ type: "status", state: "preparing" });
      try {
        await engineReady;
        channel.send({ type: "status", state: "transcribing" });
        const result = await transcribe(chunks, open.format, open.languages, open.prompt);
        channel.send({ type: "result", ...result });
      } catch (error) {
        channel.send({ type: "error", code: "engine-failed", message: "Transcription failed." });
      } finally {
        channel.close();
      }
    }
  };
  // Swap the collector for the real handler, then replay what arrived during the checks above.
  stopEarly();
  channel.onMessage(handle);
  for (const message of early) void handle(message);
});
```

This skeleton leaves engine setup, PCM accumulation, cancellation races, and error mapping to the provider. A production provider must validate the format, enforce `maxAudioMs` while audio arrives, send `not-ready` immediately before accepting a request when the engine/model is not installed, buffer audio while loading an installed engine/model, map failures to the defined error codes, and ensure terminal messages are sent only once. It must not trust caller-supplied audio or metadata merely because the caller has a `uses` grant.
