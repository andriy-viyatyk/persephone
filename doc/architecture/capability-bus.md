# Capability bus

The capability bus is Persephone's renderer-local request surface for asking another module to do
work by id. It is distinct from the content pipeline: a link resolves to content and an editor,
while a capability resolves a handler, carries a structured payload, awaits a result, and reports a
typed failure. A handler may use the content pipeline, but `ILinkData.target` never names a
capability.

## Ownership and public surface

The index is a derived view of two inputs in each renderer:

- platform registrations seeded from the `capabilities` declarations on the built-in editor table;
- declarations in the `capabilities` array of every trusted or bundled board manifest, installed
  during the generation-guarded custom-editor-registry rebuild.

The built-in direct-call handlers remain in `src/renderer/api/capabilities.ts`. The request
lifecycle is in `src/renderer/api/capability-bus.ts`; board dispatch is in
`src/renderer/api/board-capability-transport.ts`. The wire-only types and limits are in
`src/ipc/capability-bus-channels.ts`. That module has no renderer or main imports because the
board shim consumes the shared shapes.

`app.capabilities` and the board `persephone.capabilities` surface provide:

- `list()` — discover all registrations in the current renderer without opening a handler;
- `handlers(id)` — inspect the candidates for one id, including losing candidates;
- `invoke(id, payload, options?)` — resolve by id, optionally pin a major version, and await the
  result. Board calls may return `{ pageId, result }`; `pageId` is absent when a handler returns a
  value without opening a page.

`handlerKey` is part of discovery because several registrations can share an id. The public index
also preserves `version`, `priority`, `origin`, `accepts`, `payloadSchema`, `title`, and
`headless` where present.

## Registration and resolution

The board manifest's `capabilities` array is the functional registration axis. The matching
`"capabilities"` value in `permissions` discloses the surface in trust and Board Info; it is not a
second gate or a security boundary. A malformed declaration is refused independently and reported
as a capability registration issue, without discarding the board's valid declarations.

Declarations have a non-empty id with no whitespace or `@`, an integer major `version` (default
1), numeric `priority` (default 50), and optional `accepts`, `payloadSchema`, `title`, and
`headless`. Vendor prefixes are recommended for board-owned ids. `payloadSchema` is descriptive;
the handler validates its own payload. A headless declaration is preserved in the index, but a
winning headless handler is outside this channel and settles as `no-handler`.

Resolution is deterministic:

1. Parse an optional `@<major>` suffix at the bus boundary. The suffix is not stored in the id.
2. Filter by requested version and optional `accepts` MIME filter.
3. Sort by descending numeric priority.
4. On an exact priority tie, a platform registration wins. Board registration order breaks
   board-to-board ties.

Built-in registrations cannot be removed by a board; a board can only outrank one. Multiple boards
may declare the same id and all candidates remain discoverable. A refresh removes board-origin
entries over the complete board-origin set before rebuilding from the current trusted and enabled
bundled manifests, so untrust or disabling a bundled board cannot leave a stale registration behind.

## Request routing

Resolution and service happen in the caller's renderer window. For a board handler, the transport
first reuses an open page for that board in that window and activates it. If none exists, it opens
the board there and carries the first request as transient `BoardPortInitMsg.intent`. A request is
never routed to a live handler page in another window.

The page-open and reused-page paths converge on the same intent request:

```text
caller page
    │ app.capabilities.invoke(id, payload)
    ▼
derived index → winner/version/filter/priority → capability bus state
    │                                                │ deadline/cancel/teardown
    ▼                                                ▼
board transport → existing frame or opened board → intent handler
                                                   │ resolve(value) / reject(reason)
                                                   ▼
                                      { pageId, result } or typed error
```

Platform handlers are direct in-process calls and do not cross the board transport. Their payloads
are not subject to the board structured-clone ceiling. The bus does not implement headless,
service-backed capability routing, cross-window forwarding, a capability catalog, or a large-data
handle store.

## Wire contracts

There are two distinct board channels. The board-to-main `MessagePort` carries `BoardToMain` and
`MainToBoard` RPC, runner, storage, service, theme, and AiVision traffic. Capability intent
delivery is on the board-to-host-renderer `window.postMessage` channel, not on that port.

`src/ipc/capability-bus-channels.ts` is the dependency-free lifecycle contract. It defines the
ten error codes, declaration and registration records, `IntentRequest` (`requestId`, `id`, optional
version, payload, chain, depth, and deadline), `IntentSettlement`, the four limits, and the narrow
`CapabilityTransport` seam (`dispatch`, best-effort `cancel`, and `chainForPage`).

`src/ipc/board-bridge-channels.ts` defines the host-frame messages. Every declared capability
message has a sender and receiver with the same shape:

| Direction | Message | Purpose |
|---|---|---|
| renderer → board | `capabilities:intent` | Deliver a request to an already-open handler frame. |
| board → renderer | `capabilities:intent:result` | Settle that request with a result or typed error. |
| renderer → board | `capabilities:intent:cancel` | Best-effort cancellation after caller cancel, timeout, or teardown. |
| board → renderer | `board:capabilities:list` | Ask for registrations visible in this renderer. |
| renderer → board | `capabilities:list:result` | Return the discovery result or an error. |
| board → renderer | `board:capabilities:invoke` | Request an id, payload, optional version, and deadline. |
| renderer → board | `capabilities:invoke:result` | Return top-level `pageId`/`result` or an error. |

The initial request is instead the `intent` member of `BoardPortInitMsg`; it contains `id`,
optional `version`, `requestId`, and `payload`. The renderer sends no initial host-frame intent
for a page opened specifically for that request. The board shim accepts only messages from the
host parent and the expected origin. `BoardWebview` checks the sender, origin, frame identity, and
generation before accepting a result. A board-originated result keeps `pageId` at the top level of
the invoke reply contract; it is not nested inside `result`.

The shim exposes `persephone.intent.get()`, `onRequest(callback)`, `resolve(value)`, and
`reject(reason)`. `onRequest` returns an unsubscribe and immediately delivers an already-active
request. A handler should key idempotency on `requestId`, settle every request, and treat
`resolve`/`reject` as referring to the currently active request. The shim tracks delivered request
ids, so a reused page receives each request at most once. A late settlement is ignored once that
request is cancelled or settled; it cannot settle a newer request.

## Lifecycle, revocation, and teardown

The bus creates a request id, records the caller page when supplied, inherits that page's chain and
depth, estimates board-bound clone size, checks the per-handler outstanding limit, and starts a
deadline timer. Each pending record owns its timer, abort listener, and optional
`PageModel.disposed` subscription. All are released on every terminal path. The bus also releases
the per-handler concurrency slot when it settles.

The board transport owns a separate pending map for dispatched requests. It subscribes to trust
changes and frame registration, attaches a page-disposal subscriber only while the request is
live, and removes it during settlement. Its page-scoped chain map is keyed by page id and then by
request id, so concurrent requests cannot overwrite or delete one another's chain state. A chain
entry is removed with its request; an empty page map is removed as well.

`PageModel.disposed` fires exactly once at the start of true page disposal, before editor teardown.
The bus and board transport unsubscribe there, while the transport also clears initial transient
intent metadata. Trust revocation settles affected requests as `untrusted`, page/frame disposal
settles handler requests as `handler-closed`, caller-page disposal settles them as `cancelled`,
and renderer shutdown cancels remaining requests. Timeout and cancellation settle the caller first
and send a best-effort cancel to the board. Every settlement path is idempotent; a late frame reply
is ignored. The platform never re-delivers an intent.

## Payload and failure contract

Board-bound payloads use structured clone at the frame boundary and are capped at
`MAX_INTENT_PAYLOAD_BYTES` (8 MiB). The bus estimates clone size before dispatch; an unsupported
clone value or a `DataCloneError` is `rejected`, while a frame failure is `crashed`. Payloads are
transient broker data: they are not page state, persisted link data, or an application-written
file. This is a broker policy, not an operating-system guarantee about memory paging or browser
caches.

The closed `CapabilityErrorCode` contract is:

| Code | Raised when |
|---|---|
| `no-handler` | No declaration matches the id, version, or filter; a winning headless declaration is out of scope. |
| `untrusted` | The handler board is untrusted at resolution or in flight. |
| `handler-closed` | The handler page or frame closes before settlement. |
| `crashed` | The handler frame errors or reloads during the request. |
| `cancelled` | The caller cancels, its page closes, or the renderer is closing. |
| `timeout` | The deadline elapses; the platform stops waiting and sends best-effort cancel. |
| `cycle` | The handler is already in the inherited chain or the depth limit is exceeded. |
| `payload-too-large` | The board-bound estimate exceeds 8 MiB. |
| `busy` | The selected handler reaches its outstanding-request limit, or a frame is already serving another request. |
| `rejected` | The handler calls `reject`, the payload cannot be cloned, or no more specific transport error applies. |

## Design consequences

These are the ten binding consequences of the current design, stated without tying the
architecture to a task history:

1. The capability index remains renderer-local and derived. Trust changes rebuild it in each
   renderer; there is no main-owned registry or `registryChanged` broadcast.
2. Links may carry a capability id when opening content is the capability request. For example,
   `target: "image.edit"` routes a `data:image/*` URL through the image-edit capability and
   `addDrawPage()` remains the page-producing implementation. Layer 2 may set or override the
   target before Layer 3 consumes it; ordinary content links still resolve through the normal pipe.
3. Caller-window routing is the rule. Reuse or open the winning handler page in the caller's
   window; cross-window handler routing requires a future main-side forwarding protocol.
4. Registrations coexist and resolve by priority, platform tie-break, and board registration order;
   versions are major, pin-able, and separate from the stored id.
5. The failure taxonomy is closed and each code has an observable trigger, including clone refusal
   as `rejected` and headless dispatch as `no-handler`.
6. Re-entrancy is bounded by a page-scoped handler chain plus `MAX_INTENT_DEPTH` (8), not by depth
   alone. Concurrent live requests have independent chain entries.
7. Inline structured clone is the deliberately bounded first data path. A future handle/stream
   store is justified when the Excalidraw-sized `image.edit` payload exceeds 8 MiB in ordinary use
   or clone cost exceeds roughly 50 ms at p95.
8. The manifest array activates registration; `permissions` discloses the surface and supports
   lifecycle presentation but is not a second functional or security gate.
9. Revocation and teardown are first-class: pending records, timers, abort/page subscriptions,
   handler slots, transient intent metadata, and page-chain entries cannot outlive their owner.
10. Verification is live and non-destructive: discovery, repeated reused-page calls, board-to-board
    calls, window routing, typed failures, and untrust settlement are observable through the
    script/MCP surfaces; verification boards are disposable and need no trust mutation on an
    existing user board.
