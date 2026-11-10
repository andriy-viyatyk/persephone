# Capabilities

**Status:** The unified registry, client API and agent surface are implemented, and bundled boards use the `methods` form. External board migration remains in BT-087 (EPIC-140).

This is the normative contract for the unified capability registry. A capability has an id, a major version and named methods. A provider can be a trusted board or `persephone`. A consumer can be a board page, board service, Persephone or an agent. Method-specific contracts, including [audio capture and playback](audio.md), [speech synthesis](speech-synthesize.md), [transcription](speech-transcribe.md), [wake](speech-wake.md) and [translation](text-translate.md), continue to define their data and behavior. The examples below illustrate new methods, not a replacement for those v1 streaming contracts.

## Manifest

Declare `capabilities` as an array of at most 32 declarations. A board providing `call` or `channel` declares a `service` entry and `permissions.service: true`; `open` is served by its page. Providers using `persephone.capabilities.handle` must set `minBridgeVersion` to `1.50.0`. Board pages and services using `getCapability` must set `minBridgeVersion` to `1.51.0`. A declaration is independently rejected and reported in Board Info when invalid; other valid declarations remain available. Unknown fields are ignored. Limits below apply to new declarations; legacy normalization is specified separately.

| Field | Contract |
|---|---|
| `id` | Required string, at most 160 characters. At least two dot-separated segments matching `[a-z][a-z0-9-]*`; no `@`, slash or whitespace. Platform ids `audio`, `text.open`, `content.view`, `image.edit`, `diagram.edit`, `http.request.open`, `certificate.view`, `theme.edit`, `agent.session`, `speech.transcribe`, `speech.synthesize`, `speech.wake` and `text.translate` are reserved contracts; boards may implement them only in accordance with their platform contract. The entire `system.` prefix is reserved for Persephone itself; boards must not provide a `system.*` id. A board-owned id must not equal a reserved id or extend it with another segment. Board-owned ids should start with a vendor segment; the manifest's free-text `author` does not determine that segment. Boards declaring the same board-owned id are competing providers, resolved by the normal rules. |
| `version` | Positive safe integer major version; default `1`. Versions match exactly. |
| `title` | Optional string, trimmed, at most 120 characters; empty becomes absent. Display falls back to id. |
| `priority` | Finite number; default `50`; higher wins. |
| `accepts` | Optional array of nonempty MIME strings; absent means unrestricted, an empty array matches no supplied MIME. Matching is exact and case-sensitive, with no wildcard expansion. |
| `representation` | Optional nonempty string; absent means unrestricted. Every board `content.view` declaration must supply it. |
| `alwaysOpensNewPage` | Optional boolean, default `false`; applies to `open`. |
| `methods` | Required nonempty object for new declarations; at most 32 entries. Names match `[A-Za-z][A-Za-z0-9_]*`, maximum 64 characters; `providers`, `$help`, `provider` and `then` are reserved in new declarations; synthesized legacy method names are unaffected. As with any JSON object, a repeated method name keeps the last definition. |

Each method is an object with these fields; unknown fields are ignored.

| Field | Contract |
|---|---|
| `kind` | Required: `call`, `channel`, or `open`. |
| `summary` | Required nonempty string, at most 512 characters. |
| `args` | Optional ordered array, default `[]`, at most 16 descriptors. Each is `{ name, type, optional?, description? }`: `name` matches `[A-Za-z][A-Za-z0-9_]*` and is unique; `type` is a nonempty human-readable TypeScript type expression, at most 512 characters; `optional` is boolean, default `false`; `description` is an optional string of at most 512 characters. Required arguments precede optional arguments. |
| `returns` | Optional human-readable string, at most 512 characters; absent means unspecified. For `open`, this describes the method's `result` value only; the agent surface wraps it with the optional `pageId`. |
| `timeoutMs` | Positive safe integer milliseconds, default 10,000, maximum 600,000. End-to-end deadline for `call` and `open`, and channel establishment only for `channel`. |
| `agent` | Boolean, default `true`; `false` hides the method from agent discovery and invocation. Channels are never callable by agents. |

Descriptors describe positional JSON arguments, generate signatures and typed discovery, and are not an executable schema. Providers validate argument values and results; platform-defined payload checks such as `certificate.view` and `theme.edit` remain in force. `call` and `open` arguments/results must be JSON values (no `undefined`, non-finite numbers, functions, cycles or binary values); use `null` for no result. A channel method takes one JSON object argument, default `{}`, whose `type` is supplied by the router; it must not contain `type`. Channel data remains structured-cloneable, including binary data.

## Migration

| Existing declaration or API | Required mapping |
|---|---|
| `capabilities` entry without `methods` | Preserve its id, version (default 1), priority, filters, title, `payloadSchema`, `headless` and `alwaysOpensNewPage`; synthesize `open(payload)` of kind `open`, with descriptive `payloadSchema`, default deadline 10 seconds and agent visibility. Preserve legacy validation, `@major` parsing and headless `no-handler` behavior. |
| `serviceInterfaces` entry | Preserve its exact id/version/title and service; synthesize channel methods for its known open types. Use the v1 host policy table: `speech.transcribe`: `describe`, `transcribe`; `speech.synthesize`: `describe`, `speak`; `speech.wake`: `describe`, `enroll`, `list`, `delete`, `listen`; `text.translate`: `describe`, `detect`, `translate`, `download`. Also map the `agent.session` v1 contract's `describe`, `list-sessions` and `open`. Other types come from an optional legacy `openTypes` string array on that entry; do not invent types. Synthesized legacy method names are exempt from the new method-name grammar and remain exact; a hyphenated name is accessible only with bracket notation, e.g. `proxy["list-sessions"](...)`. New declarations must follow the grammar. Existing manifests need not add `openTypes`: an unknown type remains usable through legacy `services.connect` with its unchanged open message and authorization, but is not discoverable as a named proxy method until declared. Legacy `author/name` ids remain accessible exactly as written through wrappers and discovery; new declarations use dot ids. |
| Both declarations for the same board/id/version | Merge distinct methods; explicit new `methods` win on name collision. Preserve legacy `services.connect` behavior, including a colliding open type. |
| `uses` | Existing `{ id, version }` entries grant that exact capability major version, including platform providers; the trust dialog displays them. Existing entries and slash ids retain their meaning. New grants use the new id grammar. |

Existing `persephone.capabilities.invoke`, `persephone.services.list/connect`, `app.capabilities.invoke`, and `handlers` remain wrappers, preserving their signatures, discovery and result projections, legacy board bus gates, `deadlineMs`, filters, and existing error codes. `services.connect` forwards the original open object unchanged. The legacy board bus `list` requires `appScripting`; legacy `invoke` requires trust only. Existing board intent FIFO, request-bound settlement, `discardPage`, caller-window page reuse and fresh-page rules remain intact. Board page and service `persephone.capabilities.list()` instead returns the unified, grant-filtered provider list without `appScripting`; no bundled board or surveyed persephone-boards board calls the former board list API. Bundled manifests and prose guide migrations are tracked in US-1797, and external manifests in BT-087.

## Resolution and discovery

Main owns the trusted, enabled registry and removes registrations immediately on disable or trust revocation. `getCapability` resolves once and returns a provider-bound proxy; it never silently switches provider in flight. `providers(id)` lists all currently visible candidates, including losing versions and filters, without starting services. The platform provider key is `persephone`; `handlerKey` distinguishes registrations within it. A board provider key is the board's existing storage identity, `boardRootKey(root)` (`src/main/board-root-key.ts`: lowercase SHA-256 hex of the normalized board root). It needs no new persistence: it is stable across app restarts, board updates in place, disablement and trust changes, and a board at a different root (for example a development copy next to the installed one) is a different provider. Discovery also returns each provider's manifest `name`; agent paths and `getCapability({ provider })` accept that name in place of the key when exactly one visible provider of the capability has it, otherwise they reject `no-handler` and the caller must use the key. The legacy `services.list()` `provider` value stays as it is for the legacy wrappers.

For a request, filter by id and exact major (default 1), and requested MIME and representation. A missing candidate filter is unrestricted; representation otherwise matches exactly, and MIME is an exact array membership test. `content.view.open` derives representation from its payload. Then choose, in order: an explicit `provider` option; the user's eligible choice in the persisted Persephone setting `capabilities.preferredProviders` (an object mapping capability id to provider key); highest priority; platform on a tie; board registration order. An explicit provider that has no eligible candidate returns no proxy, never falls back. An unavailable or ineligible preference is ignored, not deleted. If multiple eligible registrations belong to the selected provider, apply priority and registration order within it. For filtering before binding, `getCapability` accepts `filter`; callers of payload-dependent `open` must supply it when needed. An omitted version means major 1, not latest.

## Client API

The declarations below describe the common runtime shape; provider-specific declarations refine the proxy methods. Calls reject with `CapabilityError` (`code` and `message`). `get` returns `null` when no candidate matches; an explicit call through a stale proxy rejects with the appropriate error. Discovery for boards is restricted to granted id/version pairs.

```ts
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type CapabilityErrorCode = "no-handler" | "untrusted" | "handler-closed" | "crashed" |
  "cancelled" | "timeout" | "cycle" | "payload-too-large" | "busy" | "rejected" |
  "permission-denied" | "channel-backpressure" | "channel-closed";
interface CapabilityMethod { kind: "call" | "channel" | "open"; summary: string;
  args: readonly { name: string; type: string; optional?: boolean; description?: string }[];
  returns?: string; timeoutMs: number; agent: boolean }
interface CapabilityProvider { id: string; version: number; provider: string; handlerKey: string;
  title?: string; priority: number; origin: "platform" | "board"; accepts?: readonly string[];
  representation?: string; methods: Readonly<Record<string, CapabilityMethod>> }
interface CapabilityChannel { send(value: unknown): void; readonly writable: boolean;
  whenWritable(): Promise<void>; onMessage(fn: (value: unknown) => void): () => void;
  onClose(fn: (reason: { code: CapabilityErrorCode; message: string }) => void): () => void;
  close(reason?: { code: CapabilityErrorCode; message: string }): void }
interface CapabilityProxy { readonly provider: CapabilityProvider;
  // Declared call: (...args: Json[]) => Promise<Json>
  // Declared channel: (open?: { [key: string]: Json }) => Promise<CapabilityChannel>
  // Declared open: (payload: Json) => Promise<{ pageId?: string; result: Json }>
  [method: string]: unknown }
interface CapabilityOptions { version?: number; provider?: string;
  filter?: { mime?: string; representation?: string } }
interface CapabilityDiscovery { providers(id: string): Promise<readonly CapabilityProvider[]>;
  list(): Promise<readonly CapabilityProvider[]> }
// Board page and board service:
declare const persephone: { getCapability(id: string, options?: CapabilityOptions): Promise<CapabilityProxy | null>;
  capabilities: CapabilityDiscovery };
// Persephone renderer: app.capabilities.get(id, options?) has the same signature.
```

`pageId` is present when a page was opened or reused; direct platform handlers may omit it. For a bound `open`, a payload incompatible with its bound filters rejects `no-handler`. A caller may discard the proxy and resolve again with different filters. Open method declarations have exactly one payload descriptor. Services register `call` handlers with `persephone.capabilities.handle(id, method, handler)`; registration must match a declared `call`, is unique per id/method, and returns an unsubscribe function. Register all `handle()` handlers synchronously during service startup, like `onChannel`, before awaiting `getCapability()` or other asynchronous initialization. After startup completes, a `capability-call` for an unregistered method rejects `no-handler`; the host does not wait for a late registration. A registered handler may call `getCapability()` when it runs. The handler receives `(args, ctx)`, where `args` is the positional JSON array and `ctx` has `signal: AbortSignal` and `caller: { id: string, name: string, kind: "board-page" | "board-service" | "platform" | "agent" }`. Main supplies this metadata rather than accepting it from the request payload. For board callers, `caller.id` is the manifest's `author/name` when present; it is author-chosen and may be shared by two trusted boards, so providers must not authorize by this id alone.

## Routing, lifecycle and wire

The following logical messages are normative across the main routing boundary; implementations may use existing IPC envelopes internally. Request ids are unique per live request. The provider is reauthorized immediately before dispatch and on trust or grant change. `call` and `channel` start the selected service lazily. A provider's existing `onRequest` remains independent of `handle`.

| Kind | Messages and behavior |
|---|---|
| `call` | Main sends `{ kind: "capability-call", requestId, id, version, method, args, caller, deadlineAt }` to the host, which invokes the registered handler. Host replies `{ kind: "capability-result", requestId, result }` or `{ kind: "capability-result", requestId, error: { code, message } }`. The router checks JSON/size, and delivers exactly one settlement. Unregistered handlers reject `no-handler`. A thrown error with a recognized `code` keeps its code and message, so set `code` (for example `rejected`) when the message is meant for the caller; any other thrown error becomes `rejected` with a generic message. |
| `channel` | Main sends the existing `{ kind: "channel-open", channelId, boardId, generation, openMessage, info }` plus a transferred port. `openMessage` is `{ ...argument, type: method }`; `info.interface` is `{ id, version }`, and `info.caller` identifies the authenticated caller. The service receives it through existing `persephone.service.onChannel(channel, openMessage, info)`. The returned handle is the existing ordered bidirectional channel. Data and acknowledgements carry monotonically increasing sequence numbers; close carries `{ code, message }`. Establishment timeout closes a late port. |
| `open` | Route to the existing page intent `{ id, version, requestId, payload }`, with chain, depth and deadline, and settle as `{ pageId?, result }`. Board pages use `persephone.intent.onRequest`, `resolve` and `reject`; platform editors use their existing handlers. |

Deadlines start at invocation, include startup and queueing, and use the method timeout. On deadline, send `{ kind: "capability-cancel", requestId, reason: "timeout" }`, abort `ctx.signal`, and reject `timeout`. Caller cancellation, closed caller page/service or renderer shutdown similarly send cancellation and reject `cancelled`. MCP client interruption does not currently cancel an in-flight capability call; its method deadline still applies. Revocation rejects `untrusted`; a closed handler is `handler-closed`, a crashed service/frame `crashed`. Cancellation is best effort: providers must observe the signal and release work; side effects already performed are not rolled back. Ignore late settlements. Apply the existing 8 MiB board-bound intent limit, depth 8 and 32 outstanding per handler; calls also count against the existing 32 outstanding service requests. Service-to-service calls propagate the handler chain and reject repeated handlers. A page intent does not propagate its parent chain back to main for later calls made by that page, so cycle detection does not span that hop; this remains deferred unless a real cycle is observed. For channels retain 16 per consumer board, 128 per service, 256 unacknowledged messages per direction and 1 MiB per serialized message. `send` throws `channel-backpressure` when full; wait for `whenWritable()` and retry. A message over 1 MiB serialized throws `payload-too-large` and a value that cannot be structured-cloned throws `rejected`; board pages cannot measure serialized size, so page-to-service sends are bounded by the 256-message window only. Messages that arrive while no `onMessage` listener is registered are held, unacknowledged, and delivered in order to the next listener; a sender that fills the window gets `channel-backpressure`. A peer that closes without a reason reports `channel-closed`; a peer that disappears reports `handler-closed` on a capability channel and `service-exited` on a service channel. Closing is idempotent; caller closure, provider exit, revocation and explicit close notify both ends, reject writable waiters and release resources. Provider-specific channel protocol errors remain message payloads; legacy wrapper close reasons retain their existing codes.

## Authorization

| Caller | Discovery and invocation |
|---|---|
| Board page | Trusted, enabled consumer and exact `uses` grant; no `appScripting` for the new API. The legacy bus keeps its existing gates: `list` requires `appScripting`, while `invoke` requires trust only. |
| Board service | Same trust and exact `uses` grant; no `appScripting` for the new API. Its own service requires `service` permission. |
| Persephone renderer | Platform access, no `uses` or `appScripting`; registry authorization replaces the old host allowlist for the new API. |
| Agent via MCP `call` | No board `uses` or `appScripting`; only declared, agent-visible `call` and `open` methods. Channels are discovery-only. |

Every board provider must remain trusted and enabled; service providers also need a valid service and granted `service` permission. Recheck both consumer grant and provider trust during startup and in flight; revocation cancels requests and closes channels. Grants authorize messaging, not the provider's filesystem, microphone or other privileges. Providers apply their own caller approval policy, including for `persephone` and agents; denial is `permission-denied`. `agent: false` is enforced by main as well as hidden in help, including on explicit-provider paths. It does not restrict board or platform callers. Legacy APIs retain their current gates; a board's separate `persephone.call` or MCP endpoint still needs `appScripting`.

For board pages the new `open` method deliberately requires `uses` but not `appScripting`: it opens a provider page with a payload, the grant is disclosed in the trust dialog, and the provider validates that payload.

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

The MCP `call` root retains `capabilities.list()` and `capabilities.handlers(id)` with their legacy discovery behavior. Each id is addressed by bracket notation. `capabilities["speech.synthesize"].$help` lists id, selected provider and version, eligible provider keys/titles/versions, then each visible method's signature and summary; callable methods include returns when declared and timeout, while channel entries say `channel (not callable by agents)`. Hidden methods are omitted entirely. Root `capabilities.$help` lists every capability visible to agents (id, version, title, selected provider name, agent-callable method names); when there are only channels it says `channels only (not callable by agents)`. It then points to `tools` and `pages[i].editor.app`, which remain separate. Explicit provider selection uses `capabilities["speech.synthesize"].providers["<provider-key-or-name>"].speak` and its `$help`; this pins the provider without changing the setting. Unknown ids and providers throw `no-handler`. The node's default method resolves using the normal rule on each invocation. The agent bridge uses the largest eligible declaration's method timeout plus 5,000 ms transport allowance, restricted to matching providers when pinned; the renderer resolves the provider at invocation time.

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

See the normative [audio@1 contract](audio.md) for channel declarations, capture permissions, PCM messages, timestamps and limits.
