---
title: "Text Translation — the text.translate v1 contract"
audience: both
summary: "Normative provider and consumer contract for language detection, keyed text or HTML translation, and explicit model downloads over board service channels."
---

# Text Translation — the `text.translate` v1 contract

This is the normative contract for boards that provide or consume `text.translate` version 1. A
channel describes a provider, detects a language, translates one batch, or downloads the models for
one directed source/target request. The provider owns its engine, model registry, downloads, and
caller approval policy. Persephone is a host consumer and does not translate text locally.

## Declarations, trust, and transport

Declare the interface in `board-manifest.json`:

```json
// Provider
{"permissions":{"service":true},"serviceInterfaces":[{"id":"text.translate","version":1,"title":"Text Translation"}]}
// Consumer
{"uses":[{"id":"text.translate","version":1}]}
```

Consumers need no provider permissions. A `uses` declaration grants messaging access only; the
provider must be trusted and have its own `service` permission. Persephone trust-gates a compatible
platform provider before opening a host channel. Providers must check their own caller approval
policy before every `describe`, `detect`, `translate`, and `download` operation. They may allow or
refuse the host caller `{ id: "persephone", name: "Persephone" }` under that policy. The host
channel supplies `info.interface = { id: "text.translate", version: 1 }`. A refusal uses the
platform close reason `connection-refused`.

Boards discover providers with `persephone.services.list("text.translate")` and open channels with
`persephone.services.connect("text.translate", selector, openMessage)`. Providers handle both
same-board and cross-board requests with `persephone.service.onChannel`. See the [Boards guide](./boards.md)
for channel lifecycle, backpressure, trust, and grants.

## Opening messages

The opening message selects exactly one operation:

```js
{ type: "describe" }
{ type: "detect", text: "A bounded plain-text sample", htmlLang: "uk" } // htmlLang optional
{ type: "translate", id: "batch-17", from: "uk", to: "de", priority: "visible",
  items: [{ key: "p-1", text: "Привіт", format: "text" }] }
{ type: "download", from: "uk", to: "de" }
```

`from` is optional on `translate`; when omitted, the provider detects for each batch. `to` is
required. `priority` is optional and defaults to `background`; accepted values are `visible`,
`near`, and `background`. Keys are unique within a batch and remain unchanged in its result. `text`
is plain text. `html` is an HTML fragment whose text is translated while inline markup is preserved.
Browser callers send attribute values as `text` items through this same keyed operation; there is
no separate attribute request shape.

## Provider replies

`describe` returns one `description` and closes:

```js
{ type: "description", engine: "Bergamot", model: "Firefox desktop models v3",
  pairs: [{ from: "uk", to: "en", installed: true, sizeBytes: 24000000 }],
  features: ["detect", "html", "download-progress"] }
```

`pairs` lists directed model pairs. `sizeBytes` is the total advertised download size for that
directed pair. It describes direct models, not every end-to-end route the provider supports. A
translation request may use a direct pair or a route pivoted through English. For a pivot, a single
`download` request installs both legs and reports each leg separately. `engine`, `model`, supported
pairs, and stable feature names describe the provider's current implementation. Consumers must not
infer optional behavior that is not advertised.

`detect` returns one `detection` and closes:

```js
{ type: "detection", language: "uk", confidence: "high", sampleChars: 1200,
  candidates: [{ language: "uk", score: 0.91 }, { language: "ru", score: 0.06 }] }
```

`language` and candidate languages are normalized BCP-47 codes. `confidence` is `high` or `low`;
`sampleChars` reports the number of sampled characters. `candidates` contains zero to three
alternatives in descending score order. Providers use CLD2. Consumers with a page's `htmlLang`
check it first and use provider detection on a bounded 1,000–4,096 character sample when needed.
Short text can have low confidence. A consumer detects once per page or document, lets the user
correct the source language using the candidate list, and passes the chosen `from` on every batch.
Changing the source selection affects subsequent batches.

For `translate`, the provider sends zero or more progress messages and then exactly one terminal
message:

```js
{ type: "progress", id: "batch-17", done: 3, total: 8 }
{ type: "result", id: "batch-17", items: [
  { key: "p-1", ok: true, text: "Hallo" },
  { key: "p-2", ok: false, error: { code: "engine-failed", message: "This item could not be translated." } }
] }
{ type: "error", code: "not-ready", message: "Download the required language models first." }
```

`done` counts completed input items and `total` is the input item count. `id` correlates progress and
terminal messages. A failed item does not fail successful siblings. Request-wide failures use
`error`; item failures carry their own `code` and `message`.

For `download`, the provider sends zero or more byte-progress messages and then one terminal reply:

```js
{ type: "download-progress", from: "uk", to: "de", leg: { from: "uk", to: "en" },
  loadedBytes: 12000000, totalBytes: 24000000 }
{ type: "download-result", from: "uk", to: "de", installed: true }
```

For a pivot, `leg` identifies which directed model is downloading. A failed or cancelled download
ends with `error` using `download-failed` or `cancelled`.

## Readiness, consent, cancellation, and limits

`translate` MUST NOT download models. Before accepting work, the provider checks that every required
direct or pivot leg is installed. If not, it sends terminal `not-ready` and closes. Consumers show
the advertised pair sizes, obtain explicit user consent, and then open the separate `download`
operation. `download` is the only operation that may fetch model files. Each download independently
passes the provider's caller approval policy.

One channel carries one operation. `describe` and `detect` each answer once and close. A `translate`
channel carries exactly one batch; `{ type: "cancel" }` or closing that channel cancels only that
batch. A `download` channel uses the same cancel message and close behavior. Providers release
request work when cancellation or close occurs. `scope` is not part of the protocol: clients group
their own operation channels by page/document scope and cancel every channel in a scope when it
ends. Closing a scope also removes that scope's queued client work.

Providers process queued `visible` work before `near`, then `background`, preserving FIFO within
each priority. Only queued work may be reordered. Providers apply backpressure and honor channel
`writable` and `whenWritable()` before sending. A provider splits accepted batches into internal
engine calls of at most 8 items and 8,192 code units each; consumers need not split for those engine
limits.

Hard v1 limits are 32 items and 64,000 Unicode code points across all item text in one translate
message. A serialized message must also remain below the platform's 1 MiB limit. Reject the whole
over-limit batch with `too-large`; never silently truncate. Detect samples are bounded to 4,096
characters. The platform permits 16 channels per consumer board ID/page. Board consumers should
allow at most 4 in-flight translate channels, queue the rest client-side by priority, and keep at
least one channel slot free for `describe`, `detect`, or `download`.

Use these stable error codes:

| Code | Meaning |
|---|---|
| `not-ready` | A required model leg is absent; no translation work or download was started. |
| `unsupported-language-pair` | No supported route exists for the requested languages. |
| `unsupported-format` | An item uses an unsupported format. |
| `too-large` | The request exceeds an item, code-point, sample, or serialized-message limit. |
| `engine-failed` | Translation or detection failed in the engine. |
| `download-failed` | A model download failed. |
| `cancelled` | The consumer cancelled the operation. |

`connection-refused` is reserved for the platform channel close reason. Providers may add fields to
v1 messages; consumers ignore unknown fields and unknown message types. Providers ignore unknown
request fields and reject unknown operation types without treating them as a different operation.
Changing existing meanings or wire shapes incompatibly requires a new interface version.

## Persephone consumers

Persephone's host caller is already trust- and permission-gated by the platform and needs no board
`uses` declaration. Its renderer client discovers `text.translate@1` providers, then opens a
channel for each operation. US-1735 selects text/plain or Markdown items. US-1736 sends page HTML
fragments and attribute values. Neither sends a DOM or whole document; only the requested item
strings cross the channel. Both detect once, pass the selected `from` on every batch, and group
request channels by local page/document scope for cancellation.

Browser translation starts only when the user activates the explicit toolbar toggle. It detects
the page, reports that the page is already in the target language and does nothing in that case.
Otherwise it translates when ready, or asks before downloading missing models, shows download
progress, then translates. There is no offer bar or automatic translation.

## Minimal board consumer

```js
const providers = (await persephone.services.list("text.translate")).filter(x => x.version === 1);
const provider = providers[0];
const description = await receiveOne(await persephone.services.connect("text.translate",
  { provider: provider.provider, version: 1 }, { type: "describe" }));
const pair = description.pairs.find(x => x.from === "uk" && x.to === "de");
if (!pair?.installed) {
  if (!await askUser(`Download models (${pair?.sizeBytes ?? "unknown"} bytes)?`)) return;
  const download = await persephone.services.connect("text.translate", { provider: provider.provider, version: 1 },
    { type: "download", from: "uk", to: "de" });
  download.onMessage(message => {
    if (message.type === "download-progress") showProgress(message.leg, message.loadedBytes, message.totalBytes);
    if (message.type === "download-result" || message.type === "error") finishDownload(message);
  });
  // To cancel: download.send({ type: "cancel" }) or download.close().
}
const detected = await receiveOne(await persephone.services.connect("text.translate",
  { provider: provider.provider, version: 1 }, { type: "detect", text: sample }));
const channel = await persephone.services.connect("text.translate", { provider: provider.provider, version: 1 }, {
  type: "translate", id: "page-1", from: detected.language, to: "de", priority: "visible",
  items: [{ key: "heading", text: "Hello <em>world</em>", format: "html" },
    { key: "caption", text: "Hello", format: "text" }],
});
channel.onMessage(message => {
  if (message.type === "progress") showProgress(message.done, message.total);
  if (message.type === "result") for (const item of message.items) {
    if (item.ok) apply(item.key, item.text);
    else showItemError(item.key, item.error.code, item.error.message);
  }
  if (message.type === "error") showError(message.code, message.message);
});
// To cancel this batch: channel.send({ type: "cancel" }) or channel.close().
```

The helper names in this example stand for the board's own promise/UI code. The board must register
listeners promptly, honor backpressure, cap in-flight translation channels at four, and cancel all
channels and queued requests belonging to a page/document scope when that scope closes.
