---
title: "Speech Wake — the speech.wake v1 contract"
audience: both
summary: "Provider-owned audio capture and enrolled wake and stop phrase detection."
---

# Speech Wake — the `speech.wake` v1 contract

`speech.wake@1` detects consumer-named phrases using locally enrolled examples. The provider
owns capture, matching, enrollment data and caller approval. A listener sends no audio; one
channel represents one enrollment or one long-lived listener. The provider's `describe()`
reports whether processing is local; consumers requiring local processing must check `local`.
This contract replaces the earlier PCM-channel shape: providers reject `format` and incoming
PCM rather than treating them as a new request.

## Declarations and permissions

A provider declares `speech.wake@1` with `describe`, `list` and `delete` call methods
(10-second timeouts) and `enroll` and `listen` channel methods (15-second establishment
timeouts). `describe` and `list` are agent-visible; `delete`, `enroll` and `listen`
have `agent: false`. Channels are never agent-callable. An agent can read local enrollment metadata,
including person names, using `list`; this is an intentional disclosure to the user's agent.
Call results contain metadata, never audio or embeddings.

The Wake Word provider retains its legacy `serviceInterfaces` declaration alongside explicit
methods. It requires Persephone 5.0.18, bridge 1.51.0, service, microphone and computerAudio
permissions, and `uses: [{ "id": "audio", "version": 1 }]`. A consumer board declares
`uses: [{ "id": "speech.wake", "version": 1 }]`; listening itself does not require that
consumer to hold audio permissions. A consumer choosing a microphone via `audio.devices()`
separately declares `audio@1` and the microphone grant. See [Audio](audio.md) and
[Capabilities](capabilities.md) for the declarations, proxy and authorization.

The provider applies its caller policy on every route. The Wake Word board's `accept-granted`
accepts authorized external callers; `same-board-only` refuses external board, platform and
agent calls and channels. Its own page uses private service channels to the same implementation.
Denied calls reject with `permission-denied`; denied channels close with `connection-refused`.
Authenticated caller context comes from the host. An author-selected caller ID is not proof of
board identity.

## Methods

| Method | Arguments and result |
|---|---|
| `describe()` | Returns `{ local, features, defaultThreshold, maxEnrollMs }`. The Wake Word board reports `true`, `[]`, `0.85` and `3000`. |
| `list(phrase)` | Requires a nonempty exact phrase ID. Returns groups `{ phrase, kind, person, samples }`; each sample includes `sampleId`, `createdAt`, `frontendVersion`, `echoCancel` and `legacyCapture`. |
| `delete(target)` | Requires `{ phrase, kind?, person?, sampleId? }` and returns `{ count }`. All supplied fields intersect; even a sample ID must belong to the supplied phrase. A zero count is a successful no-op. |
| `enroll(open)` | Opens an enrollment channel as described below. |
| `listen(open)` | Opens a listener channel as described below. |

Phrase and person are nonempty, exact, case-sensitive strings. A phrase ID is a consumer-selected
name, not an authenticated ownership or isolation boundary; consumers must coordinate distinct
names. Agent Chat uses `agent-wake` and `agent-stop`. Kind is `wake` or `stop` and is part
of the enrollment identity together with phrase and person. Scores and thresholds are finite
similarities from 0 to 1; higher means closer, not a probability.

## Enrollment

```ts
{ phrase: string; kind: "wake" | "stop"; person: string;
  deviceId?: string; echoCancel?: boolean }
```

The provider captures 2.5 seconds of microphone audio with a 3-second safety limit, processes it
locally, and sends one message then closes:

```ts
{ type: "enrolled"; sampleId: string;
  quality: { accepted: boolean; reason?: string }; match: number | null }
```

`match` is the best score against earlier current samples with the same phrase, kind and person,
or `null` when there are none. A rejected sample has an empty ID and is not stored. Closing the
channel cancels capture and discards transient audio. Samples store embeddings and metadata, not
raw audio. Embeddings contain voice information and should be treated as sensitive.

`deviceId` must come from the audio service's `devices()`, not the board page's browser
enumeration. IDs may change and labels can be empty; refresh the list and fall back to the default
device when needed. `echoCancel` defaults to `true` and is recorded on new samples. Use the same
value for enrollment and listening. Migrated pre-change samples are marked `legacyCapture: true`
and `echoCancel: false`; current-version legacy templates remain matchable with echo cancellation
on, although changed processing can reduce their scores. Older incompatible frontend versions stay
listable and deletable but are not matched.

## Listening

```ts
{ phrases: string[]; sources: ("microphone" | "computer")[];
  deviceId?: string; threshold?: number; echoCancel?: boolean }
```

Both lists must be nonempty and unique; unknown fields are rejected. The threshold is in [0, 1]
and defaults to 0.85. Microphone options are invalid without `microphone`. With microphone
selected, the provider also captures and spots computer audio internally for suppression, even
when `computer` is not selected for reporting. Computer-only listening does not capture the
microphone. Missing current templates for the requested phrases yields `no-enrollments`; the
provider does not expand the filter.

Once required capture and spotters are ready, the channel sends
`{ type: "status", status: "listening" }`, then accepted detections:

```ts
{ type: "detection"; phrase: string; kind: "wake" | "stop"; person: string;
  score: number; time: { epoch: number; timeMs: number };
  start: { epoch: number; timeMs: number } }
```

Both times use the shared audio-service clock in milliseconds; `start` is a conservative onset
estimate, clamped to available contiguous input and no later than `time`. Compare times only
within the same epoch. They are not exact physical sound-arrival measurements. Capture gaps reset
matching history rather than joining unrelated segments. When the epoch changes the provider
discards pending detections and matching/suppression history, sends
`{ type: "status", status: "reset", epoch }`, and rebuilds alignment or fails closed. Consumers
must discard in-flight request timing and begin anew on reset.

The detection message does not identify its source. When both sources are selected, detections
from either source use the same message shape.

For each microphone hit, the provider suppresses it if a same-phrase computer hit meeting that
listener's threshold occurs in the inclusive interval from 1500 ms before to 300 ms after the
microphone detection, regardless of kind or person. Computer-only internal hits are not reported.
Computer audio is gated and can arrive with 400 ms pre-roll. A microphone detection is held for
300 + 400 + 200 ms past its audio time, typically adding about 0.8–1 second of delivery latency.
The consumer must retain request audio by audio-clock timestamp across this delay so it does not
lose the beginning of a request. The provider releases a hit when the deadline and already queued
computer work have passed without a match. Late computer audio, missed detections and imperfect
echo cancellation can defeat suppression; independent speech with the same phrase can be
suppressed. Threshold, onset and processing margin need real-environment calibration.

## Lifecycle and errors

Register channel message and close listeners immediately after opening; messages are not replayed.
Status and error objects are protocol messages. A terminal
`{ type: "error", code, message }` is followed by close on capture or engine failure; examples
include `no-enrollments`, `rejected`, `no-handler`, `permission-denied` and
`channel-backpressure`. Channel close reasons also report provider refusal, revocation or
transport failure. Close cancels enrollment or listening without a `done` message. Each capture
is reference-counted, so closing one dependent does not stop other listeners or enrollment.
Providers bound queues, respect channel writability, and fail affected operations visibly on
overflow or loss of synchronization. No operation downloads a model.

## Consumer example

```js
const wake = await persephone.getCapability("speech.wake", { version: 1 });
if (!wake) throw new Error("No wake provider");
const description = await wake.describe();
if (!description.local) throw new Error("A local provider is required");
const samples = await wake.list("agent-wake");
const channel = await wake.listen({
  phrases: ["agent-wake", "agent-stop"],
  sources: ["microphone"],
  echoCancel: true,
});
channel.onMessage(message => {
  if (message.type === "status" && message.status === "reset") discardRequestTiming();
  if (message.type === "detection") handleDetection(message);
  if (message.type === "error") reportError(message.code, message.message);
});
channel.onClose(reason => releaseListener(reason));
// Later: channel.close();
// To remove one sample: await wake.delete({ phrase: "agent-wake", sampleId: samples[0].samples[0].sampleId });
```

The helper functions are consumer-owned. To enroll, call `wake.enroll({ phrase, kind, person,
echoCancel: true })`, immediately register listeners, and wait for `enrolled` or an error.
Consumers ignore unknown message types and fields; incompatible semantic changes require a new
major version.
