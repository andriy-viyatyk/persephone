---
title: "Errors, Agent Calls, and Examples"
audience: "agent"
summary: "What errors can capability calls return, and how do agents call them?"
---

# Errors, Agent Calls, and Examples

## Errors

All new kinds reject with the same closed union; `CapabilityError` has a readable `message`. Channel close uses the same codes, including normal `channel-closed`. Legacy APIs retain their documented errors.

Boards relying on all capability error codes on the frame route or prompt errors for refused fetch requests require `minBridgeVersion: "1.55.0"` and `minAppVersion: "5.0.19"` or later.

Boards relying on `payload-too-large` or `rejected` for channel sends, on `channel-closed` for a reasonless peer close, or on early-message delivery require `minBridgeVersion: "1.56.0"` and `minAppVersion: "5.0.19"` or later.

| Code | Meaning |
|---|---|
| `no-handler` | No matching declaration, method, provider or registered handler. |
| `untrusted` | Provider or consumer trust is revoked. |
| `handler-closed` | Provider page or service closed before completion. |
| `crashed` | Provider frame or service crashed or reloaded. |
| `cancelled` | Caller cancelled or went away. |
| `timeout` | The end-to-end deadline expired. |
| `cycle` | Inherited handler chain repeats or exceeds depth 8. |
| `payload-too-large` | Request, result or channel message exceeds its transport limit. |
| `busy` | Outstanding request or channel limit reached. |
| `rejected` | Invalid arguments, uncloneable data, provider failure or other refusal without a more specific code. |
| `permission-denied` | Missing grant or permission, hidden agent method, or provider caller-policy refusal. |
| `channel-backpressure` | Send window is full; wait for writable. |
| `channel-closed` | Normal explicit channel closure or use after normal closure. |

## Agent calls

The MCP `call` root retains `capabilities.list()` and `capabilities.handlers(id)` with their legacy discovery behavior. Each id is addressed by bracket notation. `capabilities["speech.synthesize"].$help` lists id, selected provider and version, eligible provider keys/titles/versions, then each visible method's signature and summary; callable methods include returns when declared and timeout, while channel entries say `channel (not callable by agents)`. Hidden methods are omitted entirely. Root `capabilities.$help` lists every capability visible to agents (id, version, title, selected provider name, agent-callable method names); when there are only channels it says `channels only (not callable by agents)`. It then points to `tools` and `pages[i].editor.app`, which remain separate. Explicit provider selection uses `capabilities["speech.synthesize"].providers["<provider-key-or-name>"].speak` and its `$help`; this pins the provider without changing the setting. Unknown ids and providers throw `no-handler`. Over `call` a coded error reads `Error [<code>]: <message>` (for example `Error [rejected]: …`), the same form as in every other namespace. The node's default method resolves using the normal rule on each invocation. The agent bridge uses the largest eligible declaration's method timeout plus 5,000 ms transport allowance, restricted to matching providers when pinned; the renderer resolves the provider at invocation time.

An agent `open` runs through the renderer of the window targeted by MCP `call`: the default window or the specified `windows[i]`. Its `pageId` identifies a page in that window.

Example rendered `capabilities["speech.synthesize"].$help`:

```text
speech.synthesize v1 — selected: text-to-speech (Text to speech)
Providers: text-to-speech — key 3fa2…c901 (Text to speech, v1)
speak(text: string, options?: { lang?: string; voice?: number; speed?: number }) — Speak until finished or interrupted.
  Returns: Completion status
  Timeout: 600000 ms
stop() — Stop current speech.
  Returns: null
  Timeout: 10000 ms
stream(open: { text: string }) — Stream PCM synthesis.
  channel (not callable by agents)
```

Example rendered `capabilities.$help`:

```text
capabilities — registered capabilities; open one with capabilities["<id>"].$help
  speech.synthesize v1 — Text to speech (text-to-speech): speak, stop
  speech.transcribe v1 — Speech to text (speech-to-text): record, transcribeFile
  image.edit v1 — Edit image (excalidraw): open
  agent.session v1 — Agent Chat (agent-chat): channels only (not callable by agents)
  ...
list() — list registrations; handlers(id) — list candidates for an id
Other surfaces: tools (registered scripts); pages[i].editor.app (open board models)
```

```json
{ "path": "capabilities[\"speech.synthesize\"].speak", "args": ["Hello"] }
{ "path": "capabilities[\"speech.synthesize\"].providers[\"text-to-speech\"].stop", "args": [] }
{ "path": "capabilities[\"speech.synthesize\"].$help" }
```

## Examples

Provider manifest excerpt (helper functions in the service are provider-owned):

```json
{
  "service": "service.mjs", "permissions": { "service": true },
  "capabilities": [{ "id": "speech.synthesize", "version": 1, "title": "Text to speech",
    "methods": {
      "speak": { "kind": "call", "summary": "Speak until finished or interrupted.", "args": [
        { "name": "text", "type": "string" },
        { "name": "options", "type": "{ lang?: string; voice?: number; speed?: number }", "optional": true }
      ], "returns": "Completion status", "timeoutMs": 600000 },
      "stop": { "kind": "call", "summary": "Stop current speech.", "returns": "null" },
      "stream": { "kind": "channel", "summary": "Stream PCM synthesis.",
        "args": [{ "name": "open", "type": "{ text: string }" }] }
    }
  }]
}
```

```js
persephone.capabilities.handle("speech.synthesize", "speak", async ([text, options], ctx) => {
  validateSpeech(text, options); // provider validates and checks ctx.caller policy
  return await speakUntilDone(text, options, ctx.signal);
});
persephone.capabilities.handle("speech.synthesize", "stop", async (args, ctx) => {
  authorize(ctx.caller); stopSpeech(); return null;
});
persephone.service.onChannel((channel, open, info) => {
  if (open.type !== "stream" || !allowed(info.caller)) {
    channel.close({ code: "connection-refused", message: "Unsupported or refused." }); return;
  }
  // Install listeners synchronously; streamPcm honors writable/whenWritable and close.
  streamPcm(channel, open);
});
```

Consumer page manifest includes `"uses": [{ "id": "speech.synthesize", "version": 1 }]`:

```js
const speech = await persephone.getCapability("speech.synthesize", { version: 1 });
if (speech) await speech.speak("Hello");
```

See the normative [audio@1 contract](../audio.md) for channel declarations, capture permissions, PCM messages, timestamps and limits.
