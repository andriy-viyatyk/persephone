# Capabilities

Capabilities use a main-process registry and router shared by board pages, board services,
Persephone and agents. They name versioned operations, resolve an eligible provider, authorize the
bound provider again when invoked, and route each method according to its kind. The normative
[capability contract](../../assets/guides/agents/capabilities.md) defines manifest declarations,
migration and client APIs; this page describes the implementation and lifecycle.

Capabilities are distinct from content links. A link resolves content and an editor through the
content pipeline; a capability resolves a provider and operation. A provider may use the content
pipeline, but `ILinkData.target` does not name a capability.

## Ownership and clients

| Owner | Responsibility |
| --- | --- |
| [`src/main/capability-registry.ts`](../../src/main/capability-registry.ts) | Main-process platform and board provider index, snapshots and revision notifications. |
| [`src/main/capability-router.ts`](../../src/main/capability-router.ts) | Caller visibility, resolution, provider binding, reauthorization and dispatch for `call`, board-service `channel`, platform `audio@1` channels and `open`. |
| [`src/main/capability-channel.ts`](../../src/main/capability-channel.ts) | Bounded message/acknowledgement channel returned for channel methods. |
| [`src/shared/capability-contract.ts`](../../src/shared/capability-contract.ts) and [`capability-limits.ts`](../../src/shared/capability-limits.ts) | Declaration normalization, legacy projection, shared method types and limits. |
| [`src/shared/capability-client.ts`](../../src/shared/capability-client.ts) | Builds named-method proxies for clients. |
| [`src/shared/platform-capabilities.ts`](../../src/shared/platform-capabilities.ts) | Metadata for platform providers backed by editor handlers. |
| [`src/renderer/api/capabilities.ts`](../../src/renderer/api/capabilities.ts) | `app.capabilities` client, built-in open dispatch, and legacy renderer projection. |
| [`src/renderer/scripting/ai-vision/namespaces/capabilities.ts`](../../src/renderer/scripting/ai-vision/namespaces/capabilities.ts) | Agent discovery tree and named method calls. |
| [`src/renderer/api/board-capability-transport.ts`](../../src/renderer/api/board-capability-transport.ts) | Legacy board intent delivery and lifecycle for renderer compatibility calls. |
| [`src/main/audio-service.ts`](../../src/main/audio-service.ts) and [`src/renderer/audio/audio-window.ts`](../../src/renderer/audio/audio-window.ts) | Main-owned `audio@1` channel lifecycle and the isolated hidden renderer that owns shared capture/playback resources. |
| [`src/renderer/api/renderer-capability-channel.ts`](../../src/renderer/api/renderer-capability-channel.ts) | Renderer-side ordered channel and acknowledgement implementation shared by board consumers and the audio provider window. |
| [`src/main/permission-policy-service.ts`](../../src/main/permission-policy-service.ts) | Frame-bound one-shot grants for hidden audio-window microphone and Windows loopback capture, separate from Transcript grants. |

Board pages and board services use the bridge `persephone.capabilities` client. They resolve a
provider through `getCapability(id, options?)`, then call named methods on its proxy. Board pages
can also use the legacy discovery and invoke wrappers described below. Persephone scripts use
`app.capabilities.get()` and its named methods for the unified API. The MCP `call` tool exposes
agent-visible methods through this path tree:

```text
capabilities
└── ["<capability-id>"]
    ├── .<method>(...args)
    ├── .providers
    │   └── ["<provider-name>"]   # Pin one eligible provider for this invocation
    └── .$help                   # Methods, signatures, timeout and providers
```

The root `capabilities.$help` lists agent-visible ids. Each id node lists its selected provider,
agent-enabled methods and eligible providers. A channel is discovery-only for agents; it is not
invocable through the agent tree. Agent calls may pin a provider without changing the user's
provider preference.

## Snapshot eligibility, trust and resolution

[`src/main/board-trust-service.ts`](../../src/main/board-trust-service.ts) builds authoritative
board snapshots from trusted roots and enabled bundled boards. A trusted board contributes
declarations only while its grant and bridge compatibility remain valid; a disabled bundled board
is absent. Bundled-board grants and `uses` come from the shipped manifest, while installed-board
grants and `uses` come from persisted trust approval. The registry merges normalized declarations
with platform metadata and publishes a changed snapshot to renderers. Invalid declarations are
reported independently, leaving other valid declarations usable.

New declarations describe named methods of kind `call`, `channel` or `open`. A legacy declaration
without `methods` is normalized to an `open(payload)` method for compatibility. `call` and
`channel` require a declared service entry and service permission; `open` is handled by a board page.
Method descriptions help discovery and do not validate runtime payloads. The handler remains
responsible for payload validation.

Discovery is caller-scoped. A board page or service sees providers allowed by that board's
`uses` entries; a service caller must also be eligible to start its declared service. Agents see
only methods marked `agent: true`. Resolution matches the requested id and major version (default
1), then optional MIME and representation filters. An explicit provider option pins a visible
provider. Otherwise a saved provider preference is used when it remains eligible, then candidates
sort by descending priority with platform winning an equal-priority tie.

`getCapability()` returns a proxy bound to the selected provider key. The key is looked up again
in the current registry when a request arrives; main rechecks that the provider still exists, the
caller still has the matching `uses` grant and service eligibility, and the requested method is
still present. Agent method visibility is also rechecked. Registry changes revoke active work if
this authorization no longer holds. A stale, changed or revoked binding cannot continue calling an
old provider.

The `ctx.caller.id` value passed to board service handlers is descriptive caller metadata, not an
authorization identity. For ordinary boards it is derived from manifest `author/name`, which is
chosen by the board author and may be shared by multiple trusted boards. Providers must not
authorize a caller by this id alone; use the authenticated capability grants and any provider-owned
approval policy.

## Method routing

The main router sends each method kind to its owner:

| Method kind | Route | Result |
| --- | --- | --- |
| `call` | Main authorizes and sends a JSON request to the provider's board service through the module-service supervisor, or dispatches platform-owned audio device enumeration to the audio window. | JSON result from the provider. |
| `channel` | Main opens a provider service channel or dispatches the platform-owned `audio@1` channel to its hidden audio window, then returns a bounded message channel to the caller. | Channel with ordered messages, acknowledgement-based backpressure and close reasons. |
| `open` | Main authorizes and dispatches through the selected renderer, which runs a platform handler or sends a transient intent to the board page. | JSON result, optionally paired with the opened page id for agent calls. |

Calls and channel setup inherit caller identity, cancellation, deadlines and request ancestry. A
board service may call another provider only when its own `uses` grant permits that id/version.
Service-to-service calls propagate the handler chain for cycle detection. A page intent does not
propagate its parent chain back to main for later calls made by that page, so cycle detection does
not currently span that page-intent hop; this remains deferred unless a real cycle is observed.
Channel methods use the service protocol's `type` field and retain the v1 streaming lifecycle. The
capability channel limits each message to 1 MiB and allows 256 messages in flight; service and
channel counts are bounded as specified in
[`src/shared/capability-limits.ts`](../../src/shared/capability-limits.ts).

## Platform-owned `audio@1` methods

`audio` is a reserved platform registration with a `devices()` call and `capture` and `play` channel methods. Unlike a
board capability channel, its provider is not a utility-process service: `CapabilityRouter`
authorizes the caller and delegates to the main-owned `AudioService`. Main lazily creates one
hidden, local-only `BrowserWindow`; it rejects navigation, popups and webviews, validates every
control message against that exact window and main frame, and destroys the window after the final
channel closes and pending device calls finish. Correlated device replies are accepted only from the
current window's main frame and generation; cancellation, deadlines, revocation and window failure
end pending calls. Audio ports are transferred directly between the caller and this window. Main
retains lifecycle and authorization state, but does not relay PCM.

The hidden window owns one `AudioContext`, shared microphone/computer source streams, the PCM
worklet, the computer-only `ComputerAudioGate`, and scheduled playback. Capture keys are source,
device/default and echo-cancellation setting; subscribers close independently, and the source stops
after its final subscriber. A per-subscriber 32-chunk queue isolates slow consumers. Saturation
closes only that subscriber with `channel-backpressure`. The underlying channel still enforces 256
unacknowledged messages and 1 MiB per message. Playback permits at most five queued seconds and
stops with `channel-backpressure` on overflow.

Capture chunks are 16 kHz mono signed 16-bit PCM in 200 ms frames. The worklet maps its first sample
to the audio window's monotonic `performance.now()` origin using `AudioContext.getOutputTimestamp()`
and advances timestamps from output samples. Each hidden-window creation gets a new process-local
integer epoch; times can be compared only within an epoch. Computer capture applies RMS open/close
thresholds 0.01/0.006 with 400 ms pre-roll and 500 ms tail. It suppresses delivery in gated silence
while preserving source timestamps across gaps. Microphone capture remains continuous.

Board pages and services need trusted status, exact `audio@1` `uses`, and the source grant:
`microphone` for device listing and microphone capture or explicit `computerAudio` for Windows loopback. A service
must also have its service permission. Playback requires `uses` only. Platform callers need no board
grant, while agents can discover the channel declarations but cannot invoke channels or the hidden device call. Authorization
is repeated while active; revocation closes the stream. The audio window receives independent,
one-use, expiry- and frame-bound microphone and loopback permission grants from main. It never
reuses or weakens the existing Transcript loopback grant.

Device enumeration runs in the capture origin without arming a grant or opening a stream. Chromium
may return an empty or limited list and empty labels; IDs can change and should be refreshed on demand.

The normative payloads, timestamp and gate contract, permissions, caller shapes and resource limits
are in the [audio capability guide](../../assets/guides/agents/audio.md). Echo cancellation follows
the browser constraint for microphone capture; its effectiveness and absolute physical timing have
not been measured.

For `open`, main binds the selected registration and sends the request to the renderer selected for
the caller. The renderer validates platform-owned payloads where required and either invokes a
built-in editor handler or passes a transient `IntentEnvelope` to
[`board-capability-transport.ts`](../../src/renderer/api/board-capability-transport.ts). The
transport opens a board in the caller's window or reuses a page for the same board root. A
declaration with `alwaysOpensNewPage` always creates a fresh page. Routes to a page are reserved in
FIFO order; only the head is sent, after the initial host handshake and frame readiness. The
active request context is removed before the next one starts, so the frame handles one intent at a
time. A request is never routed to a handler page in a different window.

The intent lifecycle, including `requestId`, `resolve(value, { discardPage? })`, `reject(reason)`,
frame validation and cancellation, is implemented by
[`BoardWebview.ts`](../../src/renderer/editors/board/BoardWebview.ts) and
[`board-shim.ts`](../../src/board-shim.ts). A page opened for the first request receives its
intent in the initial board-port message; a reused page receives the intent over the host-frame
message channel. `discardPage` is separate from the opaque result and discards only a page created
for that request. A late or duplicate settlement cannot settle a later request.

```text
board page ─┐                       ┌─ call ──────> board service
board service ── getCapability() ──> main registry/router ─ channel ─> board service
app.capabilities ─┘                       │
                                          └─ open ─> renderer ─> platform handler or board intent
MCP call ─ capabilities["<id>"] ─> same authorized provider/method routing
```

## Deadlines, cancellation, limits and errors

Methods default to a 10,000 ms deadline; declarations may set a longer timeout up to 600,000 ms.
Nested work is bounded by the parent's remaining deadline. Agent calls add a five-second bridge
allowance to let the call result reach the agent surface. Cancellation propagates from the caller,
its page/window or service owner; timeouts and teardown settle the caller and send best-effort
cancellation to active work. Open intents are cancelled on caller closure, provider revocation,
handler page/frame failure or renderer shutdown. Board intent cancellation cannot forcibly stop
arbitrary handler JavaScript, so the shim ignores late settlement after cancellation.

The shared limits include 32 declarations per board, 32 methods per declaration, 16 arguments per
method, 512 characters for summaries/descriptions, an 8 MiB JSON argument/result limit for
service calls, a maximum invocation depth of 8, and 32 outstanding calls per handler. Channel
message and concurrency limits are listed in `capability-limits.ts`. These limits are enforced at
the relevant normalization, routing and transport boundaries; schema-like text in a declaration
is descriptive metadata.

Capability failures use the closed `CapabilityErrorCode` union in
`capability-contract.ts`: `no-handler`, `untrusted`, `handler-closed`, `crashed`, `cancelled`,
`timeout`, `cycle`, `payload-too-large`, `busy`, `rejected`, `permission-denied`,
`channel-backpressure` and `channel-closed`. Platform payload validation may also reject with a
specific validation message before provider dispatch.

## Legacy wrappers and transport

Legacy APIs remain compatibility projections, not the unified provider API:

- Board `persephone.capabilities.list()` and `invoke()` retain the legacy discovery shape and
  renderer intent transport. Legacy invocation is trust-gated; it does not acquire the new
  `getCapability()` caller-`uses` authorization semantics. `list()` now reads the main unified
  index and filters providers according to the board caller's grant.
- Script `app.capabilities.list()` and `handlers(id)` remain synchronous legacy projections of
  the main index. `app.capabilities.invoke()` keeps the legacy call signature and projects a board
  outcome: a handler result without a page is returned raw; with a page id it adds `pageId` to an
  object result or returns `{ pageId }` for primitive, array or absent results. The board client
  preserves its legacy top-level `{ pageId, result }` outcome shape.
- Legacy `persephone.services.list()` and `connect()` continue to expose their v1 service
  interfaces and streaming channels. Their discovery and wire protocol are not replaced by named
  capability methods; they continue to be governed by service trust and the v1 service contract.

The old renderer modules `capability-bus.ts`, `board-capability-transport.ts` and
`capability-bus-channels.ts` remain for compatibility wrappers and their legacy wire transport.
Unified method lookup, caller authorization and dispatch are main-owned. Do not use the legacy
handler index or its result projection as the contract for `getCapability()` proxies or agent
calls.

## Well-known capability: `certificate.view`

<a id="well-known-capability-certificateview"></a>

Persephone defines `certificate.view@1` for a board that renders a Chromium TLS certificate chain.
The browser's site-info popover calls it with `{ title, certificates, source? }`, where `title` is
the active page hostname, `certificates` is a non-empty leaf-first array of canonical base64 DER
strings, and `source.url` is the HTTPS page URL when known. Before selecting a provider, the
renderer validates the object shape, non-empty title and chain, canonical base64 encoding, the DER
sequence tag (`0x30`), optional string `source.url`, and a 256 KiB maximum total decoded chain.
Invalid input is rejected before handler dispatch. If no handler is available, the browser opens a
PEM bundle in the text editor. The board's requested page title is retained for both bundled
content-host boards and ordinary boards; the board manifest name does not replace it. See
[`certificate-view.ts`](../../src/renderer/api/certificate-view.ts) and the browser editor's
[certificate flow](browser-editor.md).

## Well-known capability: `theme.edit`

<a id="well-known-capability-themeedit"></a>

Persephone defines `theme.edit@1` for Settings to hand a theme to an installed Theme Editor board.
Its payload is `{ mode: "edit", themeId }` or `{ mode: "new" }`. The platform validates the
object and mode before resolving a provider: `edit` requires a non-empty `themeId`; `new` rejects
any `themeId` property. Manifest `payloadSchema` remains descriptive, so this validation is part
of Persephone's public contract. Callers can pin version 1 and allow extra time for a cold board
startup:

```ts
await app.capabilities.invoke("theme.edit", { mode: "edit", themeId }, {
    version: 1,
    deadlineMs: 30_000,
});
await app.capabilities.invoke("theme.edit", { mode: "new" }, { version: 1, deadlineMs: 30_000 });
```

Settings applies and persists the selected theme before an edit request; a new request leaves the
active theme unchanged. If no handler exists, Settings opens Tools & Editors on Search boards and
shows installation guidance. A timeout reports “Theme editor did not respond”; it is not treated
as provider absence. Other capability failures retain their actual message. The `themes: true`
board permission is independently required only for a board using `persephone.themes.*`; it does
not gate platform-to-board `theme.edit` dispatch. The Theme Editor receives fresh and reused
requests through `persephone.intent.onRequest()`. It should validate id, version and payload, then
resolve a valid request promptly before loading source or opening a dialog. With no
`alwaysOpensNewPage` declaration, an existing page for the winning board is focused and reused.
See [`theme-edit.ts`](../../src/renderer/api/theme-edit.ts) and preserve the
`well-known-capability-themeedit` anchor for links to this section.
