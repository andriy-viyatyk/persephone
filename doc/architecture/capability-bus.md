# Capability Bus

The capability bus is Persephone's renderer-local request surface for asking another module to do
work by id. It is distinct from the content pipeline: links resolve to content and an editor,
while capabilities resolve a handler, carry a structured payload, await a result, and report a
typed failure. A capability handler may use the content pipeline, but `ILinkData.target` never
names a capability.

## Ownership and inputs

The index is derived from two renderer-local inputs:

- platform registrations seeded from the `capabilities` declarations on the built-in editor table;
- declarations in the `capabilities` array of every trusted board manifest, registered during the
  generation-guarded `customEditorRegistry.refresh()` rebuild.

`permissions: ["capabilities"]` is disclosure and lifecycle hygiene. The manifest's
`capabilities` array is the functional trigger, matching the EPIC-108 D8 rule for the other board
axes. Board declarations carry `id`, optional major `version`, `priority`, `accepts`,
`payloadSchema`, and `title`; the registry preserves declaration-level refusal diagnostics.

The wire-only types and limits live in
[`src/ipc/capability-bus-channels.ts`](../../src/ipc/capability-bus-channels.ts). The module has
no renderer or main imports because the board shim consumes the shared shapes. The public index and
built-in direct-call handlers live in
[`src/renderer/api/capabilities.ts`](../../src/renderer/api/capabilities.ts). Lifecycle state is
owned by [`src/renderer/api/capability-bus.ts`](../../src/renderer/api/capability-bus.ts), and
board dispatch is supplied by
[`src/renderer/api/board-capability-transport.ts`](../../src/renderer/api/board-capability-transport.ts).

## Registration and resolution

Registration is a full rebuild, not a second mutable trust registry. Before each trusted-board
rebuild, every board-origin candidate is removed over the board-origin set; platform candidates are
seeded independently and cannot be removed by a board. A malformed declaration is refused without
discarding the board's other declarations, and the refusal is exposed as a capability registration
issue in Board Info.

Resolution follows EPIC-108 D4:

1. Parse an optional `@<major>` suffix at the bus boundary. The suffix is not part of the stored
   id; `list()` exposes separate `id` and `version` fields.
2. Filter by the requested version and optional `accepts` MIME filter.
3. Sort by descending numeric priority. A board declaration defaults to priority 50.
4. On an exact priority tie, a `platform` origin wins over a board origin. Board ties retain
   trusted-list/registration order. All candidates remain discoverable through `list()` and
   `handlers(id)`.
5. A headless winner is out of scope for this bus and settles as `no-handler`.

Discovery is inert: `list()` and `handlers()` read the derived index and never open a handler page.
`CapabilityInfo.handlerKey` is part of the public result because one id can have several handlers;
for example, the built-in `content.view` registrations differ by handler key even when their id is
the same.

## Request lifecycle

The public `invoke()` overloads preserve the typed built-in calls and add a general string-id path.
Built-in `platform` handlers remain direct in-process calls. Board-origin calls enter the lifecycle
bus, which creates a request id, records the caller page (when supplied), inherits its page-scoped
chain/depth, estimates the structured-clone payload, applies the outstanding-request limit, and
sets a deadline.

The board transport resolves the winning declaration in the caller's renderer window. It first
reuses an open handler page for that board in that window; otherwise it opens the board there with
the request as transient `BoardPortInitMsg.intent`. The initial handshake carries
`{ id, version?, requestId, payload }`. Once a page is already open, the renderer sends the same
request shape as a `capabilities:intent` host-frame message. In both cases the board settles with
`capabilities:intent:result`, and a board-originated result is normalized to `{ pageId, result }`.

```text
caller page
    │ app.capabilities.invoke(id, payload)
    ▼
capability index → winner/filters/version/priority → capability bus state
    │                                                   │ deadline/cancel/teardown
    ▼                                                   ▼
board transport → existing frame or open board → intent handler
                                                   │ resolve(value) / reject(reason)
                                                   ▼
                                      { pageId, result } or typed error
```

`CapabilityTransport` is deliberately narrow: `dispatch(registration, request)`, best-effort
`cancel(registration, requestId)`, and `chainForPage(pageId)`. `BoardWebview` validates origin,
source, iframe identity, and generation before accepting a settlement. Pending records are removed
on every terminal path, and a second settlement is ignored.

## Intent contract for board authors

The shim exposes `persephone.intent.get()`, `onRequest(callback)`, `resolve(value)`, and
`reject(reason)`. A handler must settle every delivered request. If it never calls `resolve()` or
`reject()`, the caller waits until its deadline; the platform then sends a best-effort cancel, but
cannot stop work already running in the board.

The initial request is transient handshake metadata, not page state. A reused handler page receives
later requests over the host-frame channel. The board shim tracks request ids so an intent is
delivered at most once, and the platform never re-delivers it. A handler that may be retried by an
agent must use `requestId` as its idempotency key.

Payloads use structured clone at board boundaries and are capped at
`MAX_INTENT_PAYLOAD_BYTES` (8 MiB) for board-bound requests. The broker does not write the payload
to page state, restore data, persisted link data, or disk, and a restored page does not receive it
again. This is an in-memory broker policy, not an OS guarantee: memory can be paged and Chromium
can keep its own caches.

## Failure taxonomy

`CapabilityError.code` is the closed ten-value contract exposed to script and board callers:

| Code | Raised when |
|---|---|
| `no-handler` | No declaration matches the id, version, or filter; a headless winner is also out of scope. |
| `untrusted` | The handler board is untrusted at resolution or becomes untrusted in flight. |
| `handler-closed` | The handler page or frame closes before settlement. |
| `crashed` | The handler frame errors or reloads during the request. |
| `cancelled` | The caller cancels, its page closes, or the renderer is closing. |
| `timeout` | The deadline elapses; the platform stops waiting and sends best-effort cancel. |
| `cycle` | The winning `handlerKey` is already in the inherited chain or maximum depth is exceeded. |
| `payload-too-large` | The estimated board-bound structured payload exceeds 8 MiB. |
| `busy` | The selected handler has `MAX_OUTSTANDING_INTENTS_PER_HANDLER` requests in flight. |
| `rejected` | The handler calls `reject()` or an unclassified payload/transport failure occurs. |

Timeout and cancellation are signals, not process termination. The platform never re-delivers a
timed-out request, and a late handler settlement is ignored after the caller has been rejected.
Untrust and page/frame teardown settle their own pending records and release page-chain and
outstanding-handler state; they do not merely stop future dispatch.

## D1: renderer-local by design

EPIC-108 D1 intentionally diverges from the roadmap's proposed main-owned capability registry. The
index is a pure function of built-in editor bytes and trusted manifests. Every renderer already
re-reads those manifests through `boardTrust.subscribePaths()` and rebuilds its board registrations,
so separate renderer-local derived indexes agree without duplicating the 636-line renderer
manifest normalizer in main or adding a registry broadcast protocol.

The trade-off is explicit: there is no cross-window routing. A request is resolved and served in
the caller's window, so a live handler page in another window is not a route target. A future phase
that needs that behavior must add a main-side routing table keyed by `(boardRoot, windowIndex)` and
a forwarding envelope; the derived index itself does not need to move. `registryChanged(kind)` is
therefore not part of this subsystem.

The bus also deliberately does not implement the deferred `DataHandle` store, headless
service-backed handlers, or capability catalog installation. Those are later-phase consumers with
their own protocol and measurement triggers.
