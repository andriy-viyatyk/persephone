---
title: "Audio capability"
audience: agent
summary: "Normative contract for shared microphone and computer audio capture and PCM playback."
---

# Audio capability

`audio@1` is a Persephone platform capability for board pages and board services. It provides
shared live capture and playback over capability channels. It does not recognize speech, detect
wake words, transcribe, or record to disk. Board code owns downstream processing and must apply
its own caller approval policy.

The capability is reserved: boards cannot register an `audio` provider. A consumer manifest must
declare `uses: [{ "id": "audio", "version": 1 }]`, set `minBridgeVersion: "1.51.0"`, and set
`minAppVersion: "5.0.18"` or later. A board service also
needs `permissions.service: true`. See [Capabilities](capabilities.md) for the bridge and channel
contract.

## Methods

The platform provider is `persephone`, version 1, with two agent-visible channel declarations:

| Method | `open` argument | Use |
|---|---|---|
| `capture` | `{ source: "microphone" | "computer"; deviceId?: string; echoCancel?: boolean }` | Receive shared PCM capture chunks. |
| `play` | `{ sampleRate: number }` | Send mono float32 PCM for playback. |

Both channels have a 15-second establishment timeout. The declaration has `agent: true` so MCP
help can explain the methods; agent callers cannot invoke channel methods. There is no agent-callable
audio method. Page and service code use the standard `getCapability` API:

```js
const audio = await persephone.getCapability("audio", { version: 1 });
if (!audio) throw new Error("audio@1 is unavailable");

const capture = await audio.capture({ source: "microphone", echoCancel: true });
capture.onMessage(message => {
  if (message.type === "chunk") consumePcm(message);
});
// Closing this channel releases only this consumer's subscription.
capture.close();
```

`capture` accepts only `source`, optional `deviceId`, and optional `echoCancel`. `source` is
required. `deviceId` must be a nonempty device id and applies only to microphone capture. If omitted,
the browser's current default input is used. `echoCancel` must be boolean when supplied; it defaults
to `true` for microphone capture. Computer capture rejects both `deviceId` and `echoCancel` and is
available on Windows only. Unsupported systems reject with `no-handler`.

`play` accepts only an integer `sampleRate` from 8,000 through 192,000 Hz. Its channel sends these
messages:

```ts
{ type: "chunk"; data: ArrayBuffer } // mono little-endian float32 PCM
{ type: "end" }                      // finish after queued audio plays
{ type: "stop" }                     // cancel scheduled audio immediately
```

Every float sample must be finite. A chunk must be nonempty, have a byte length divisible by four,
and fit within the capability channel's 1 MiB message limit. Playback uses the declared sample
rate; Web Audio resamples to the shared output context. The channel closes after reporting
`{ type: "ended", epoch, status: "finished" | "stopped" }`. `end` reports `finished` after all
scheduled audio has played. `stop` cancels queued and scheduled audio and reports `stopped`. Closing
the channel also cancels playback. The five-second queued-audio limit is enforced across scheduled
audio; overflow closes the channel with `channel-backpressure`.

## Capture message

Each capture chunk is:

```ts
{
  type: "chunk";
  epoch: number;
  timeMs: number;
  sampleRate: 16000;
  data: ArrayBuffer; // mono signed 16-bit little-endian PCM
}
```

Each emitted chunk contains 3,200 samples (200 ms, 6,400 bytes). Derive duration from the buffer
length and sample rate. `timeMs` is the estimated monotonic window-relative time of the first sample,
not message arrival time or wall-clock time. All sources in one audio-window lifetime share this
clock. Compare timestamps only when `epoch` matches. `epoch` is an integer assigned by main for each
audio-window creation; it is process-local and resets when Persephone restarts. A recreated window
has a new epoch, so timestamps across epochs are incomparable. Playback `ended` messages use the
same epoch.

Audio device and OS buffering, plus the output-timestamp mapping, limit absolute alignment accuracy.
Do not treat this clock as a measurement of physical sound arrival or claim echo cancellation
effectiveness from `echoCancel` alone.

## Sharing, gate and lifecycle

Microphone sources are shared by `(source, deviceId-or-default, echoCancel)`; omitted
`echoCancel` and `true` share the same source. Computer capture has one shared source key. Each
consumer receives its own independently closable channel. Closing one consumer does not stop other
subscribers; the underlying stream and worklet stop after the final subscriber closes. Playback
channels are independent and do not create capture or set the capture indicator.

Only computer audio passes through the audio gate. The gate opens at RMS 0.01, closes at RMS 0.006,
keeps 400 ms of pre-roll and 500 ms of tail, and suppresses chunk delivery during gated silence.
It does not stop OS capture or the worklet. Original `timeMs` values are retained across the gaps;
a timestamp gap therefore represents gated silence. Microphone chunks are continuous and are never
gated by this service.

Install a message listener immediately after opening a channel. Channels do not replay earlier
chunks. Each subscriber has a separate 32-chunk pending queue; if that queue fills, only that slow
subscriber closes with `channel-backpressure`. Consumers should process chunks promptly and bound
their own work queues. Audio channel data uses the standard 256-unacknowledged-message and 1 MiB per
message limits as well.

Capture ends when its channel closes, the caller disappears, authorization is revoked, the audio
window fails, or Persephone shuts down. Device and operating-system failures close the channel with
an error message. Closing the final capture channel destroys the hidden audio window. A capture
indicator reflects active capture channels; gated silence still counts as capture.

## Permissions

| Caller | Capture and playback requirements |
|---|---|
| Board page | Trusted and enabled board; exact `audio@1` in `uses`; `microphone` permission for microphone capture or explicit `computerAudio` permission for computer capture. Playback needs `uses` only. |
| Board service | Same requirements as a page, and the board's service must be eligible and `permissions.service` granted. |
| Persephone platform caller | May capture or play without board grants. |
| Agent | Cannot invoke either channel, despite their visibility in help. |

Permissions are rechecked at channel setup and while it is active. Revoking trust, `uses`, or the
source permission closes affected channels. A channel grants access only to that caller's own
stream; it cannot stop another caller's playback or capture. Board services and pages must not
infer identity from `caller.id`, which is author-chosen metadata.

Persephone uses separate, one-use, short-lived, frame-bound grants for the hidden audio window's
microphone and Windows loopback requests. These grants are armed only by main immediately before
the browser request, consumed by that exact live frame, and never exposed through the board bridge.
Computer capture requests Windows display audio and discards the video track. Normal browser,
Transcript and voice-typing permission paths remain separate.
