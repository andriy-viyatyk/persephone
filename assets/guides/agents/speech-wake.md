---
title: "Speech Wake — the speech.wake v1 contract"
audience: both
summary: "Normative provider and consumer contract for enrolled wake and stop phrases over board service channels."
---

# Speech Wake — the `speech.wake` v1 contract

This is the normative contract for boards that provide or consume `speech.wake` version 1. One channel handles one operation; only `listen` is long-lived. An enrollment is one clip, never an open-ended session. The provider owns its engine, enrollment data and caller approval policy; the consumer owns capture and assistant state.

## Declarations and transport

Declare the exact interface version in `board-manifest.json`:

```json
// Provider
{"minAppVersion":"5.0.18","permissions":{"service":true},"serviceInterfaces":[{"id":"speech.wake","version":1,"title":"Speech Wake"}]}
// Consumer; declare microphone permission if the board captures audio
{"minAppVersion":"5.0.18","uses":[{"id":"speech.wake","version":1}],"permissions":{"microphone":true}}
```

`uses` grants messaging access only, not the provider's permissions. The provider must be trusted, have its own `service` permission, and apply its caller approval policy to every request. Refuse a caller with the platform close code `connection-refused`. The Persephone host caller is `{ id: "persephone", name: "Persephone" }`, with `info.interface = { id: "speech.wake", version: 1 }`. The `accept-granted` policy accepts this reserved interface; `same-board-only` refuses the host. The app needs no board `uses` declaration; its capture permission is granted separately.

For unified declarations and clients see [Capabilities](capabilities.md). Discover with `persephone.services.list("speech.wake")`, connect with `persephone.services.connect("speech.wake", selector, openMessage)`, and handle opens with `persephone.service.onChannel((channel, openMessage, info) => ...)`. Versions match exactly. See the [Boards guide](./boards.md) for trust, grants and channel lifecycle.

## Opening requests

| Opening request | Consumer messages | Provider replies |
|---|---|---|
| `{ type: "describe" }` | None | `{ type: "description", local: boolean, features: string[], defaultThreshold: number, maxEnrollMs: number }`, then close. |
| `{ type: "enroll", phrase: string, kind: "wake" \| "stop", person: string, format: { encoding: "pcm-s16le", sampleRate: 16000, channels: 1 } }` | Ordered `{ type: "audio", data: ArrayBuffer }`, then `{ type: "end" }` | `{ type: "enrolled", sampleId: string, quality: { accepted: boolean, reason?: string }, match: number \| null }`, then close. |
| `{ type: "list" }` | None | `{ type: "enrollments", phrases: { phrase: string, kind: "wake" \| "stop", person: string, samples: { sampleId: string }[] }[] }`, then close. |
| `{ type: "delete", target: { phrase: string, kind: "wake" \| "stop" } \| { person: string } \| { sampleId: string } }` | None | `{ type: "deleted", count: number }`, then close. |
| `{ type: "listen", format: { encoding: "pcm-s16le", sampleRate: 16000, channels: 1 }, threshold?: number }` | Ordered `audio` messages, then `{ type: "end" }` | Zero or more `{ type: "wake" \| "stop", phrase: string, person: string, score: number, time: number, start?: number }`, then `{ type: "done" }` and close after `end`. |

`local: true` means audio is processed on the user's machine and does not leave it; `local: false` means audio leaves the machine and consumers should disclose that before recording. The assistant must reject a provider advertising `local: false`. `maxEnrollMs` is the finite enrollment clip limit in milliseconds. `features` advertises optional behavior; use `[]` when none is supported.

Phrase and person are nonempty, exact, case-sensitive strings; `kind` is part of phrase identity. `sampleId` is a provider-generated opaque stable ID unique within that provider. An enrollment's `match` is the best score against earlier samples of the same phrase, kind and person, or null when none exist. A rejected clip has no stored sample and returns an empty `sampleId`.

Phrase deletion removes that phrase and kind across people; person deletion removes all that person's samples; sample ID deletion removes exactly one. A zero count is a successful no-op. List returns metadata only. No response contains sample audio or embeddings.

`score` and `match` are finite normalized similarities in [0, 1], higher is closer. A detection meets `score >= threshold`; omitted threshold uses `defaultThreshold`, on the same scale. If an engine measures a distance where lower is closer, the provider converts it to this scale and publishes a `defaultThreshold` on the same scale. Detection `time` is milliseconds from the first input sample to the end of the detected phrase.

Both wake and stop detections may include `start`, the milliseconds from the first input sample to the matched phrase's start, clamped between zero and `time`. Consumers must tolerate its absence. For stop detections without it, the assistant uses `max(0, time - 2500)` as a conservative fallback; that heuristic does not guarantee removal of unusually long phrases or late detections.

## Consumer to provider

Use mono signed 16-bit little-endian PCM at 16 kHz, as in [Speech Transcription](./speech-transcribe.md). Send small ordered `ArrayBuffer` chunks, then `end`. Honor `writable` and `whenWritable()` before sending. Callers must avoid retaining enrollment audio after sending it; transient capture needed to send a clip is permitted. Store recordings and templates in the provider's own board data, never app storage.

## Provider to consumer

All messages are structured-cloneable objects. A provider sends terminal `{ type: "error", code, message }` and closes on failure:

| Code | Meaning |
|---|---|
| `not-ready` | The engine or model is not installed. |
| `no-enrollments` | No samples are enrolled; send at `listen` open before accepting audio, then close. |
| `unsupported-format` | The input format is unsupported. |
| `too-long` | An enrollment exceeds `maxEnrollMs`. |
| `invalid-argument` | A request or input is invalid. |
| `engine-failed` | The engine failed. |

Provider refusal uses the platform close reason `connection-refused`. Requests never start a model download.

## Lifecycle and limits

Register message and close handlers at the start of `onChannel`, before any await, and buffer early messages while accepting the request or loading an installed engine. Messages without a registered handler are not replayed. Enforce the advertised finite `maxEnrollMs` as audio arrives: immediately send `too-long` and close when exceeded; never truncate. A `listen` channel has no total-duration cap, but bounds retained audio and queued work. It emits both wake and stop events regardless of assistant state; the consumer decides which matter. V1 has no kind filter and the provider has no assistant-state model.

Closing cancels either operation and releases resources. Honor `writable` and `whenWritable()` in both directions. Service-to-page serialized messages are limited to 1 MiB and each direction permits 256 unacknowledged messages. Separate `listen` channels support microphone and loopback detection. Comparing event times requires aligned capture origins and is the consumer's responsibility.

## Forward compatibility

Consumers ignore unknown message types and fields. Providers preserve v1 field meanings and required behavior. Advertise new optional behavior through `features`; incompatible changes require a new interface version and guide.

## Minimal consumer

```js
const provider = (await persephone.services.list("speech.wake")).find(p => p.version === 1);
if (!provider) throw new Error("No wake provider");
const selector = { provider: provider.provider, version: 1 };
const format = { encoding: "pcm-s16le", sampleRate: 16000, channels: 1 };
// receiveOne registers message and close handlers and rejects terminal errors or refusal.
const describe = await receiveOne(await persephone.services.connect("speech.wake", selector, { type: "describe" }));
if (!describe.local) throw new Error("A local provider is required");
const enrolled = await openStream({ type: "enroll", phrase: "Hello", kind: "wake", person: "Alex", format });
await sendCapture(enrolled, enrollmentChunks); // discard each clip chunk after sending
await waitForOperation(enrolled); // wait for enrolled or reject on error/close
const listing = await receiveOne(await persephone.services.connect("speech.wake", selector, { type: "list" }));
const microphone = await openStream({ type: "listen", format });
const loopback = await openStream({ type: "listen", format });
// Capture origins must be aligned before comparing events between these independent streams.
void sendCapture(microphone, microphoneChunks);
void sendCapture(loopback, loopbackChunks);

async function openStream(open) {
  const channel = await persephone.services.connect("speech.wake", selector, open);
  channel.onMessage(message => {
    if (message.type === "wake" || message.type === "stop") handleDetection(message);
    if (message.type === "enrolled" || message.type === "done") finishOperation(message);
    if (message.type === "error") { stopCapture(channel); showError(message.code, message.message); }
  });
  channel.onClose(() => stopCapture(channel));
  return channel;
}
async function sendCapture(channel, chunks) {
  for await (const data of chunks) {
    if (!channel.writable) await channel.whenWritable();
    channel.send({ type: "audio", data });
  }
  if (!channel.writable) await channel.whenWritable();
  channel.send({ type: "end" });
}
// On cancellation: stopCapture(channel); channel.close();
// When removing a sample, after listening has ended:
const deleted = await receiveOne(await persephone.services.connect("speech.wake", selector,
  { type: "delete", target: { sampleId: listing.phrases[0].samples[0].sampleId } }));
```

## Minimal provider

```js
persephone.service.onChannel(async (channel, open, info) => {
  const early = [];
  const stopEarly = channel.onMessage(message => early.push(message));
  channel.onClose(() => cancelWorkAndReleaseResources());
  if (!approvalPolicyAllows(info)) {
    channel.close({ code: "connection-refused", message: "Caller refused." }); return;
  }
  try {
    // Validate, check installed readiness and enrollment availability before accepting audio.
    const operation = await prepareOperation(open); // never downloads
    const handle = message => operation.enqueueInOrder(message); // enforce maxEnrollMs immediately
    stopEarly();
    channel.onMessage(handle);
    for (const message of early) handle(message);
    for await (const reply of operation.replies()) {
      if (!channel.writable) await channel.whenWritable();
      channel.send(reply); // description, enrolled, enrollments, deleted, detection or done
    }
  } catch (error) {
    if (!channel.writable) await channel.whenWritable();
    channel.send(toContractError(error));
  } finally { channel.close(); }
});
```

Helper names represent provider-owned validation, storage, engine, cancellation, and error mapping. Production code must stop sending after close and handle cancellation races.
