# US-1473: `ProxyProvider` and `persephone.providers.register` over the service port

**Status:** Planned · **Epic:** [EPIC-107](../../epics/EPIC-107.md) · **Depends on:** US-1471
board provider registration and EPIC-106's module-service renderer lease

## Goal

Build the missing service-side renderer-port lifecycle and provider host, then install the real
board-provider delegate behind
`src/renderer/content/board-provider-factory.ts`. The resulting renderer-side
`ProxyProvider` forwards `readBinary`, `writeBinary`, `stat`, and `watch` to the trusted
board's module service over the renderer `MessagePort`, while remaining bounded and settling
with a typed provider-unavailable error whenever the service cannot serve the request.

The board implementation lives in the module service, where
`persephone.providers.register(type, implementation)` is available without a board page. This
task does not implement `IProvider.createReadStream(range)`; it leaves a stable request and
subscription seam for US-1474's credit-based frames.

## Background

### Binding decisions

EPIC-107 D1 makes the author-chosen provider type the persisted identity. A board type must be
namespaced with `/` and is registered verbatim; this task must never derive a type from a board
name or root. EPIC-107 D2 keeps first trusted registration wins for both the type and scheme, so
this task must use the existing registration closure and must not add a second registry or replace
the owner-aware registration in `src/renderer/editors/board/custom-editor-registry.ts`.

EPIC-107 D7 and EPIC-106 D3 are the hard availability rule: a service may have no renderer port.
`ProxyProvider` must therefore never wait indefinitely for `acquire()`, a response, a watch
acknowledgement, or a restart. It reuses `SERVICE_REQUEST_DEADLINE_MS` and
`MAX_OUTSTANDING_REQUESTS_PER_SERVICE` from `src/ipc/module-service-channels.ts`; it does not
add a timeout constant, request queue, or supervisor. `src/main/module-service-supervisor.ts`
already owns lazy start, the restart budget, trust revocation, request settling, and port
transfer.

The two service paths are intentionally different:

```text
board frame:  persephone.service.request(message)
              → board-shim.ts → main/board-bridge.ts → module-service-supervisor.request()
              (ordinary main-routed bridge RPC; no renderer MessagePort)

renderer:     ProxyProvider
              → renderer/api/module-service.ts acquire()/request()
              → renderer MessagePort lease
              → utility-process module-service-host.mjs
```

The second path is the only path used by `ProxyProvider`. The board frame's service RPC remains
the ordinary request surface and is not changed into a port request.

The renderer lease is not currently a working end-to-end channel. The supervisor sends
`attach-renderer` and transfers a port, but `assets/module-service-host.mjs` has no handler for
that message, sends no `hello`, and has no service-side counterpart to the renderer's
`hello`/`hello-ack` handling. Consequently `moduleService.acquire()` currently waits for the
renderer lease deadline and times out for today's shipped service. This task must build that
missing host lifecycle; it is not merely a delegate installation.

### Current seams verified in source

- `src/renderer/content/board-provider-factory.ts` has the mutable
  `installBoardProviderFactory()` seam. Its current delegate throws
  `BoardProviderUnavailableError` with code `proxy-provider-not-installed`; the in-flight
  US-1472 work also adds `subscribeBoardProviderAvailability()`, which US-1473 must preserve.
- `src/renderer/editors/board/custom-editor-registry.ts` calls
  `registerProvider(declaration.type, (config) => createBoardProvider(boardRoot,
  declaration.type, config), { origin: "board", owner: boardRoot })` during its guarded,
  synchronous trusted-board rebuild. US-1473 installs the delegate; it does not re-register
  declarations or alter `registry.ts`'s first-wins behavior.
- `src/renderer/content/registry.ts` still owns provider factory lookup and, in the US-1472
  work, the missing/pending placeholder. `src/renderer/content/ContentPipe.ts` already delegates
  `readBinary`, `stat`, `writeBinary`, `watch`, and `toDescriptor` to the provider. No pipe
  redesign is needed for this task.
- `src/renderer/api/module-service.ts` has `ServiceLeaseClient`, `acquire()`, `request()`,
  `loseLease()`, the renderer-side hello/hello-ack handling, request deadlines, and
  pending-request settling. The service side currently sends no `hello`, so this handshake is
  incomplete until this task adds it in the host.
- `src/main/module-service-supervisor.ts` transfers one renderer port in
  `transferRendererPort()`, starts the service with request mode, rejects in-flight work on
  exit/untrust/quit, and restarts an unexpectedly exited service within its existing budget. It
  must remain the only lifecycle owner.
- `assets/module-service-host.mjs` currently injects only `persephone.storage`, imports the
  board-relative service entry, and listens only for `storage-response`; it does not forward
  ordinary requests and has no `attach-renderer`, `drop-renderer`, or `hello` lifecycle. The
  service entry owns its own `parentPort` protocol. The host must newly claim the transferred
  renderer port, perform the lease handshake, and dispatch provider operations there.
- `src/renderer/api/types/io.provider.d.ts` requires `type`, `displayName`, `sourceUrl`,
  `restorable`, `writable`, `readBinary()`, and `toDescriptor()`; `writeBinary`, `stat`, `watch`,
  and `createReadStream` are optional. `src/renderer/api/types/io.pipe.d.ts` defines
  `IPipeDescriptor` as `{ provider, transformers, encoding? }`.
- `src/board-shim.ts`'s current `service.request()` calls `rpc("serviceRequest", [message])`,
  while `src/main/board-bridge.ts` routes that method directly to
  `moduleServiceSupervisor.request()` with `SERVICE_REQUEST_DEADLINE_MS`. The shim also uses the
  board MessagePort for its own `rpc`, but that port is the board-frame bridge, not the renderer
  service lease.
- Binary structured clone is already used by the repository: `BoardPipeReadSuccess.data` is a
  `Uint8Array` in `src/ipc/board-pipe-channels.ts`, `capturePageRegion` returns `Uint8Array`
  through the renderer endpoint API, and `src/main/board-bridge.ts` accepts typed-array views
  without base64. The provider protocol will carry `Uint8Array` directly; it will not base64
  encode a `Buffer`.
- `src/shared/board-pipe-constants.ts` sets `MAX_BOARD_PIPE_CHUNK_BYTES` to 1 MiB and
  `MAX_BUFFERED_PIPE_BYTES` to 256 MiB. The former bounds board-pipe replies; the latter is the
  existing logical buffer ceiling. A provider `readBinary()` result is a bounded one-shot value,
  not a multi-GB transport.

### Where the implementation lives

The authoritative implementation is the trusted module service, not the board frame. The service
entry runs in the `utilityProcess` and can retain JavaScript functions, open files, and keep
watchers alive when no board page exists. `assets/module-service-host.mjs` owns the registration
map and invokes the registered implementation with the descriptor config.

`window.persephone.providers.register()` is not a usable frame capability. A function-valued
implementation cannot cross the board frame's structured-clone RPC, and any closure retained by
the frame would disappear when that frame unloads. The board shim will expose a small, explicit
service-only guard for this namespace so a frame call fails synchronously with a typed
`provider-registration-service-only` error; it will not marshal callbacks or create a second
frame-backed provider. The matching declaration in
`src/renderer/editors/board/board-api.d.ts` documents that service scripts, not board frames, call
the registration API. A frame may still use the existing `persephone.service.request()` for
ordinary application messages.

The host's new `parentPort` listener deliberately coexists with the service entry's existing
listener. Node delivers each parent-port message to both listeners: the host claims only
`attach-renderer` and `drop-renderer`, while the entry has no branch for those kinds and ignores
them. The host must not handle ordinary parent-port `kind: "request"` messages. Provider traffic
uses the transferred renderer `MessagePort`, which the service entry never listens to. Routing a
provider operation through parentPort as `kind: "request"` would make the demo entry's
`handleRequest` answer it too (its default branch posts an `unknown-operation` error), producing
two responses for one `requestId`.

The service-side authoring shape is:

```js
// assets/module-service-host.mjs injects this before importing service.mjs.
persephone.providers.register("demo/mem", {
    writable: true,
    async readBinary(config) { /* return Buffer or Uint8Array */ },
    async writeBinary(config, data) { /* data is Uint8Array */ },
    async stat(config) { /* return { exists, size?, mtime? } */ },
    watch(config, callback) { /* return a synchronous disposer */ },
});
```

`readBinary`, `writeBinary`, `stat`, and `watch` receive the persisted provider `config`; the
implementation's `writable` capability is announced to the renderer when the renderer lease is
attached. `displayName` and `sourceUrl` remain renderer metadata derived from the descriptor:
`displayName` uses `config.displayName`, then `config.url`, then the type; `sourceUrl` uses
`config.sourceUrl`, then `config.url`, then the type. `restorable` is always `true` because the
descriptor contains the board type and config. A provider descriptor may carry a `writable`
capability hint, but the service announcement is authoritative and a write is rejected when the
registered implementation has no write operation.

## Implementation Plan

### 1. Verify the current lease is dead, then verify the new host lifecycle

Before changing the host, exercise the shipped demo service through the renderer path and confirm
that `moduleService.acquire(boardRoot)` (or the existing renderer provider path that invokes it)
waits for `SERVICE_RENDERER_LEASE_TIMEOUT_MS` and rejects because no service-side `hello` arrives.
After the host change, repeat the same runtime check and confirm that the host claims
`attach-renderer`, posts `hello` with the transferred `generation` and `leaseNonce`, receives the
renderer `hello-ack`, and only then serves a provider request over the renderer port. Also verify
the existing no-page-open main-routed request separately; EPIC-106's recorded observation that a
request returned from a real `utilityProcess` was the `requestModuleService` path in
`src/ipc/main/board-handlers.ts`, not evidence that the renderer lease already worked.

### 2. Define the provider wire contract beside the existing service channels

Change `src/ipc/module-service-channels.ts` by adding dependency-free types for the nested
provider messages and the unsolicited provider frames. Keep the existing outer
`RendererServiceMessage` request/response envelopes and `ServiceParentMessage` lifecycle
envelopes; provider messages are the `message`/`result` payload carried by those existing
channels.

The request shape is one of these operations:

```ts
// Renderer → module service, inside RendererServiceMessage.kind === "request".
interface ProviderRequest {
    kind: "provider";
    operation: "readBinary" | "writeBinary" | "stat" | "watchSubscribe" | "watchUnsubscribe";
    type: string;                         // exact namespaced manifest type
    config: Record<string, unknown>;      // persisted descriptor config
    subscriptionId?: string;              // watch operations only
    data?: Uint8Array;                    // writeBinary only; structured clone, never base64
}

type ProviderResult =
    | { kind: "provider-result"; operation: "readBinary"; ok: true; data: Uint8Array }
    | { kind: "provider-result"; operation: "writeBinary"; ok: true }
    | { kind: "provider-result"; operation: "stat"; ok: true; stat: ProviderWireStat }
    | { kind: "provider-result"; operation: "watchSubscribe" | "watchUnsubscribe"; ok: true }
    | { kind: "provider-result"; ok: false; error: ProviderWireError };

interface ProviderWireStat {
    exists: boolean;
    size?: number;
    mtime?: string;
}

interface ProviderWireError {
    kind: "provider-error";
    code: "provider-not-registered" | "provider-read-only" | "provider-invalid-result"
        | "provider-failed" | "provider-payload-too-large";
    message: string;
}

interface ProviderEvent {
    kind: "provider-event";
    subscriptionId: string;
    event: string;
}

interface ProviderCapabilities {
    kind: "provider-capabilities";
    type: string;
    writable: boolean;
}
```

The exact final names may be shortened to match project style, but the discriminants are
mandatory. `ProviderEvent` and `ProviderCapabilities` are unsolicited variants added to the
existing `RendererServiceMessage` union; request results remain correlated by the existing outer
`requestId`. A provider implementation failure is a successful outer service response carrying
`{ kind: "provider-result", ok: false, error: ... }`; a transport/lifecycle failure remains an
outer rejected request (`service-timeout`, `service-exited`, `untrusted`, `service-failed`,
`service-busy`, `trust-not-ready`, or `service-not-declared`). `ProxyProvider` maps every outer
failure to the existing US-1472 `ProviderUnavailableError` with the original lifecycle code,
while preserving a provider error as a distinct `ProviderOperationError`. US-1473 must not
introduce a second provider-unavailable class. This prevents a board's own read failure
from being confused with a missing renderer port.

Use `Uint8Array` on the wire. The renderer converts a successful read to `Buffer` for the
`IProvider` contract, and converts a `Buffer` passed to `writeBinary` to a `Uint8Array` before
posting. There is no base64 field and no JSON serialization of binary payloads. Validate the
typed-array shape at both host boundaries so a malformed service result becomes
`provider-invalid-result`, not a renderer crash.

### 3. Add the service-side registration and dispatch host

In `assets/module-service-host.mjs`, extend the existing injected `globalThis.persephone` object
with `providers.register(type, implementation)` before importing the board service entry.

- Accept one exact, non-empty, namespaced type per service registration; reject malformed
  implementations and duplicate types with a deterministic service-side error. Do not silently
  replace a registration. The manifest/renderer registry remains the owner of board-vs-board
  collisions; the service map only answers whether this service implements its declared type.
- Validate `readBinary` and `toDescriptor`-equivalent provider capability requirements at
  registration. `writeBinary`, `stat`, and `watch` remain optional, matching `IProvider`.
- Add the missing host-side renderer lease lifecycle: claim `attach-renderer` and its transferred
  port, retain the `generation` and `leaseNonce`, post `hello` carrying both values, wait for the
  renderer's `hello-ack`, and only then announce registered type capabilities (especially
  `writable`) and serve provider requests on that renderer port. Claim `drop-renderer` for the
  matching generation/nonce, close the port, settle its pending provider work, and dispose its
  subscriptions. On process exit, close the port and perform best-effort local cleanup.
- Keep the service entry's own `parentPort` listener unchanged alongside the host listener. Node
  invokes both listeners; the host claims only `attach-renderer` and `drop-renderer`, and the
  entry ignores those kinds because they match no branch. Do not route provider operations over
  parentPort as `kind: "request"`: the entry's existing handler would also answer them with its
  `unknown-operation` error, causing two responses for one `requestId`. Provider requests and
  provider events must use only the renderer `MessagePort`, which the entry never listens to.
- For `watchSubscribe`, call the implementation's `watch(config, callback)` and store the returned
  disposer by `(type, subscriptionId)`. For `watchUnsubscribe`, invoke and remove that disposer.
  If the renderer lease disappears or the service exits, invoke all disposers before the process
  dies; a later lease replay creates fresh service-side subscriptions.
- Catch implementation errors as provider-result errors. Use a readable fallback through the
  existing `errMessage` rule in TypeScript callers; the JavaScript host must never post a raw
  thrown value as if it were a transport failure. A missing type returns
  `provider-not-registered` without starting another service.
- Reject a one-shot `readBinary` or `writeBinary` payload over `MAX_BUFFERED_PIPE_BYTES` before
  posting it to the renderer. This is the existing 256 MiB logical buffer ceiling, not a new
  provider-specific number. `MAX_BOARD_PIPE_CHUNK_BYTES` remains the bound for US-1475's
  main↔renderer board-pipe replies, not a reason to split this task's response into an ad-hoc
  second protocol.

Before:

```js
const persephone = globalThis.persephone ?? {};
persephone.storage = { /* existing storage adapter */ };
globalThis.persephone = persephone;
await import(pathToFileURL(serviceEntry).href);
```

After:

```js
const persephone = globalThis.persephone ?? {};
persephone.storage = { /* existing storage adapter */ };
persephone.providers = createProviderRegistry(rendererLease);
globalThis.persephone = persephone;
await import(pathToFileURL(serviceEntry).href);
```

The existing `assets/demo-board/scripts/service.mjs` fixture remains ordinary service-only code in
this task; it is the only shipped service and US-1477 must update it to exercise the new provider
API and authoring shape. US-1473 must not add fixture changes.

### 4. Extend the renderer lease client for capability frames and replayable subscriptions

In `src/renderer/api/module-service.ts`, keep `acquire()` and `request()` as the single transport
entry points, and add the smallest internal provider-lease support needed by `ProxyProvider`:

- Handle `ProviderEvent` messages without treating them as request responses. Route them by
  `subscriptionId` to the live callback and ignore late events after disposal.
- Cache per-board/type capability announcements for the lifetime of the renderer. Reset a type's
  live capability on lease loss and update it on the next attachment; expose a direct callback or
  getter for `ProxyProvider.writable` rather than adding a second provider registry.
- Keep active watch intents keyed by board root, type, config, and subscription id. On a new
  `hello` after a renderer lease is attached—including after the supervisor has restarted the
  service—reissue each `watchSubscribe` with the normal `request()` deadline. Do not use a
  permanent retry timer. A replay failure settles its attempt and leaves only the caller-owned
  subscription intent for a later lease; it cannot leave a Promise pending.
- On a lease loss, reject ordinary pending requests as the current code does and mark subscriptions
  for replay. If the service restarts, one normal `acquire()`/port transfer replays them. If no
  renderer port ever attaches, the subscription has no pending request and no callback; disposing
  it removes the retained intent.
- Keep the existing concurrency check. Watch acknowledgement and unsubscribe requests count
  against `MAX_OUTSTANDING_REQUESTS_PER_SERVICE`, and all attempts use
  `SERVICE_REQUEST_DEADLINE_MS`.

No change is needed in `src/main/module-service-supervisor.ts`: its `transferRendererPort()`,
restart budget, trust checks, and in-flight settling are reused unchanged. No new main endpoint is
needed; adding a second `requestModuleService` path would violate EPIC-106 D3.

### 5. Implement `ProxyProvider` as the renderer-side `IProvider`

Add `src/renderer/content/providers/ProxyProvider.ts` with a direct import of the existing
provider types and `moduleService`.

Constructor state:

- Keep the current `boardRoot`, exact namespaced `providerType`, and the original config object.
- Report `type` as the exact provider type. Report `displayName` and `sourceUrl` from the config
  fallback order documented in Background. Report `restorable: true`.
- Report `writable` from the live service capability, falling back to a descriptor hint only
  until the service announces the registered implementation. A read-only implementation remains
  read-only even if a caller invokes `writeBinary`; the operation returns the typed
  `provider-read-only` error.
- `toDescriptor()` returns `{ type: providerType, config: originalConfig }`, retaining the board
  config and every unknown field. It must not serialize the absolute board root; the current
  trusted declaration supplies that root when the factory is reconstructed.

Operation behavior:

```ts
// Before: current board-provider-factory delegate
let boardProviderFactory: BoardProviderFactory = (boardRoot, providerType) => {
    throw new BoardProviderUnavailableError(boardRoot, providerType);
};

// After: the same seam, installed once during renderer bootstrap
installBoardProviderFactory(
    (boardRoot, providerType, config) => new ProxyProvider(boardRoot, providerType, config),
);
```

- `readBinary()` sends `ProviderRequest.operation = "readBinary"`, awaits the existing lease
  request, validates the discriminated result and byte length, and returns `Buffer.from(data)`.
- `writeBinary(data)` sends a cloned `Uint8Array` only when the provider is writable and the
  payload is no larger than `MAX_BUFFERED_PIPE_BYTES`; otherwise it rejects immediately with a
  typed provider error. It never silently truncates or base64-encodes.
- `stat()` sends `"stat"`; it validates `exists`, optional finite `size`, and optional string
  `mtime` before returning `IProviderStat`.
- `watch(callback)` creates a unique subscription id and returns a synchronous disposer. It starts
  a bounded asynchronous subscribe attempt, but never makes the caller await it. If the service
  is absent, stopped, untrusted, has no renderer port, or never registered the type, the attempt
  settles with provider-unavailable and no callback is delivered. If it was acknowledged, a
  service event invokes the callback; a lease loss marks it for replay after the next hello.
- Calling the disposer before the subscribe acknowledgement marks the id cancelled, removes the
  renderer intent, and makes a racing acknowledgement immediately send/complete an unsubscribe;
  no service callback is retained. Calling it after acknowledgement sends a bounded unsubscribe
  and removes the local event route. Calling it twice is harmless.
- `dispose()` disposes all active watch subscriptions and prevents future replay. It does not
  stop the board service; service lifecycle remains the supervisor's responsibility.
- Do not implement `createReadStream` in this class in US-1473. Leave it absent so the existing
  `ContentPipe` fallback behavior is preserved until US-1474 installs the framed stream path.

### 6. Install the factory without changing US-1472's placeholder boundary

In `src/renderer/content/board-provider-factory.ts`, import the new class and install the
delegate from the renderer's normal content initialization path. The installation is a small
addition to the existing seam; it preserves US-1472's availability-listener API and does not
change `registerProvider`, `createProviderFromDescriptor`, or the first-wins registry.

The exact line between the two tasks is:

```text
type/factory absent from the renderer registry
  → US-1472 MissingProvider/PendingProvider; preserve the descriptor; never start a service

type/factory registered for a trusted board
  → ProxyProvider; service may be stopped or absent; request through moduleService and map
    transport failure to typed provider-unavailable
```

US-1472's pending state may use `moduleService.acquire()` to wait for the service registration
notification, but it must not wrap a live `ProxyProvider` with a second service starter. Once the
board-owned factory is installed, the proxy itself uses the existing request/acquire path and
owns only operation and watch transport. The service host's `provider-not-registered` result is a
provider-unavailable/provider-operation distinction, not a second MissingProvider registry
decision and not a reason to start another supervisor.

### 7. Make the frame API restriction explicit

In `src/board-shim.ts`, add the `providers` namespace only as a service-only guard. Its
`register(type, implementation)` validates neither implementation nor transport; it throws the
typed `provider-registration-service-only` error immediately. It must not touch the existing
`host` namespace or change `rpc("serviceRequest", ...)`.

Mirror that public board-facing declaration in
`src/renderer/editors/board/board-api.d.ts`. This file is the hand-maintained board bridge
contract, not the `src/renderer/api/types/*.d.ts` script-type tree. No `IProvider` type changes
are required, so `assets/editor-types/io.provider.d.ts` and `_imports.txt` remain byte-identical.

### 8. Verify bounded behavior and restart/restore semantics

Use the repository's normal typecheck, lint, and production build checks only. Do not add unit
tests or test harnesses. Verification must cover a trusted service-only board with no page open,
an attached service port, no attached service port, stopped/untrusted service, service exit and
restart, absent service registration, read/write/stat error replies, watch disposal races, and
binary payloads.

For a persisted pipe, `ContentPipe.toDescriptor()` already writes the provider descriptor into
`IPipeDescriptor`; `ProxyProvider.toDescriptor()` must preserve the exact namespaced type and
config. On restart, the trusted-board registry resolves the current board root for that type. If
the board folder moved, the old absolute root is not read from the descriptor: a refreshed trusted
declaration at the new root binds the provider there. If the type is no longer registered, US-1472
returns the original descriptor through its placeholder; the proxy must not guess a board from the
type prefix.

US-1474 will add `createReadStream(range)` as a separate framed operation in the same provider
protocol. It should reuse `ProviderRequest`'s exact type/config correlation, the renderer lease
and lifecycle error mapping, `MAX_BOARD_PIPE_CHUNK_BYTES` for bounded `Uint8Array` chunks, and
`MAX_BUFFERED_PIPE_BYTES` only for explicit buffered fallback. The new operation must add
credit/grant, chunk, end, error, and cancel frames plus a bounded in-flight window; it must not
change `ProxyProvider` metadata, descriptor serialization, ordinary request deadlines, or watch
lifetime.

## Concerns

### Service registration cannot be a frame closure

The no-page-open criterion rules out storing implementation functions in the board frame. A frame
registration would either fail structured clone or disappear on iframe close. The service-only
guard is deliberate. The service's module remains the sole authoring location, and a service-only
board can register a provider before any board page is opened.

### Provider and transport errors must remain distinct

The service host must not put a board implementation exception in the outer `error` field because
`module-service.ts` maps that field to lifecycle failure. The inner discriminated result carries
provider failures; the outer rejection carries unavailable transport. This distinction is what lets
the placeholder remain reserved for absent registration while a registered provider can report its
own read/write/stat error.

### Watch is the leak surface

The local subscription intent is retained only while the caller owns the disposer. The disposer
always removes the local route, cancels replay, and asks the service to dispose the service-side
watch after an acknowledgement race. Service exit disposes service callbacks; a new lease replays
only still-owned intents. A missing port creates no unresolved promise and no callback.

The shipped service entry handles `shutdown` with immediate `process.exit(0)`, so host-side watch
disposers may not run on that path. This is acceptable for process-owned resources because the
process and OS reclaim them; US-1473 must not await an asynchronous flush before exit. A future
service that holds a network subscription, lock, or similar external resource must make cleanup
idempotent and resilient to process termination, or define a separate graceful-shutdown protocol;
the provider registration contract does not promise that disposers run during immediate shutdown.

### Binary bounds and large resources

`readBinary()` is intentionally not a multi-GB API. Both host and renderer enforce the existing
`MAX_BUFFERED_PIPE_BYTES` ceiling. The 1 MiB `MAX_BOARD_PIPE_CHUNK_BYTES` limit remains specific
to the already-shipped board-pipe response path. Large media must use US-1474's ranged stream;
that task provides backpressure rather than raising this task's buffer cap.

### Descriptor ownership after a move

The persisted descriptor carries the stable author type and provider config, not a location-derived
board root. A moved board works only after its current root is trusted and re-registers the same
type; otherwise the page keeps the original descriptor in US-1472's placeholder. A competing
trusted board cannot silently capture the descriptor because D2's first-owner registration remains
the only winner rule.

### Standards and boundaries

Implementation must use direct imports, `errMessage`/`guard` for caught values, and `file-path`
utilities instead of `require("path")`. No colors or UI styling are introduced. Do not modify
`src/renderer/content/registry.ts` or the US-1472 consumer files except for an unavoidable API
compatibility fix discovered during implementation. Do not edit `doc/active-work.md` or
`doc/epics/EPIC-107.md`.

## Acceptance Criteria

- A trusted board's module service can call `persephone.providers.register("author/type", impl)`
  before any board page is open; a frame closure cannot remove that service registration.
- A board frame cannot install a function-valued provider. Its service-only guard fails with the
  typed registration error and leaves the existing frame `service` and `host` behavior unchanged.
- The trusted declaration's existing `createBoardProvider(boardRoot, type, config)` seam creates a
  `ProxyProvider` without changing owner-aware registry registration or D1/D2 type semantics.
- `readBinary`, `writeBinary`, and `stat` use the renderer `MessagePort` lease, carry the exact
  namespaced type and config, return validated values, and carry binary as structured-cloned
  `Uint8Array` without base64.
- An implementation error is an inner typed provider error; no-port, not-started, stopped,
  untrusted, service-exited, terminal service failure, timeout, busy, and missing service
  registration settle as typed provider-unavailable errors. No method or watch acknowledgement
  can hang beyond the existing service deadline vocabulary.
- `readBinary` and `writeBinary` reject payloads above `MAX_BUFFERED_PIPE_BYTES`; no unrelated
  provider buffer limit is introduced, and `MAX_BOARD_PIPE_CHUNK_BYTES` remains reserved for
  bounded board-pipe replies.
- `watch` returns a synchronous disposer in every state. An absent service yields no callback and
  no pending Promise; disposing before acknowledgement prevents the service-side callback. A
  surviving subscription is re-established after a supervisor restart and a new renderer lease;
  disposed subscriptions are never replayed.
- `toDescriptor()` preserves the exact namespaced type and board config in the provider member of
  `IPipeDescriptor`. A moved board resolves through the current trusted declaration; an absent
  declaration remains US-1472's unchanged placeholder descriptor.
- US-1472's MissingProvider/PendingProvider remains the only absent-factory/placeholder boundary;
  `ProxyProvider` does not start a second service supervisor or claim a missing registry type.
- `createReadStream(range)` is absent from this task's implementation, while the ordinary provider
  request correlation and bounded byte/error framing leave US-1474 able to add credit-based
  ranged frames without changing descriptors, metadata, or watch lifetime.
- No unit tests or test harnesses are added; the normal typecheck, lint, and production build
  gates pass when implementation begins.

## Files Changed

| File | Planned change |
|---|---|
| `src/renderer/content/providers/ProxyProvider.ts` | Add the renderer-side `IProvider` proxy, metadata, bounded operations, typed error mapping, descriptor round-trip, and replayable watch lifecycle. |
| `src/renderer/content/board-provider-factory.ts` | Install the `ProxyProvider` delegate behind the existing mutable factory seam. |
| `src/ipc/module-service-channels.ts` | Add dependency-free provider request/result/error/event wire types and discriminants to the existing service-channel vocabulary. |
| `src/renderer/api/module-service.ts` | Route provider payloads over the existing lease, handle capability/event frames, and replay owned watch subscriptions after a new lease. |
| `assets/module-service-host.mjs` | Add the missing attach/hello/ack/drop renderer-port lifecycle, inject service-side `persephone.providers.register`, dispatch provider operations only over the renderer port, enforce binary bounds, and manage service-side watch disposers/events. |
| `src/board-shim.ts` | Add the explicit service-only `providers` guard without changing the existing `host` namespace or frame service RPC. |
| `src/renderer/editors/board/board-api.d.ts` | Mirror the service-only board bridge declaration and its typed failure contract. |

The following files need **no additional changes in US-1473**: `src/renderer/content/registry.ts`
(including the in-flight US-1472 placeholder/declaration work),
`src/renderer/content/ContentPipe.ts`, `src/renderer/content/scheme-registry.ts`,
`src/renderer/editors/board/custom-editor-registry.ts`,
`src/renderer/editors/board/board-manifest.ts`,
`src/main/module-service-supervisor.ts`, `src/main/board-bridge.ts`,
`src/ipc/api-types.ts`, `src/ipc/renderer/api.ts`, `src/renderer/api/types/io.provider.d.ts`,
`src/renderer/api/types/io.pipe.d.ts`, `assets/editor-types/io.provider.d.ts`,
`assets/editor-types/io.pipe.d.ts`, `assets/editor-types/_imports.txt`,
`doc/active-work.md`, and `doc/epics/EPIC-107.md`.
US-1472 owns the placeholder and pending consumer files; US-1474 owns ranged streaming; US-1477
owns the required update to the shipped `assets/demo-board/scripts/service.mjs` fixture and the
authoring guide; that fixture is deliberately not changed in US-1473.

## Live verification, 2026-09-20 (Claude)

**The epic's central claim is proven end to end.** With the Demo board declaring
`contentProviders: [{ "type": "demo/mem", "schemes": ["mem"] }]` and its service registering a
trivial `demo/mem` implementation, opening `mem://demo/final.txt` produced a page whose content was
`hello from the demo board service` — bytes generated inside the board's `utilityProcess`,
delivered to the renderer over the `MessagePort` lease, **with no board page open**. That is the
whole purpose of Phase C.

### A Phase B defect had to be fixed first: the port transfer was broken

`moduleService.acquire()` could never have worked. `ModuleServiceSupervisor.transferRendererPort()`
posted the port **inside the message body as well as in the transfer list**:

```ts
process.postMessage(
    { kind: "attach-renderer", generation, leaseNonce, rendererPort: port2 },
    [port2],
);
```

A `MessagePortMain` is not structured-cloneable as a message value; a transferred port arrives on
the receiving side in `event.ports`. So every attach threw *"object could not be cloned"* and was
swallowed as `renderer-port-attach-failed`. The very next statement in the same function does it
correctly for the renderer (`target.postMessage(endpoint, { boardRoot, generation, leaseNonce }, [port1])`,
port only in the transfer list), so the two halves of one function disagreed.

Nobody noticed because **no service implemented the receiving side**, so the lease was never
exercised — see the note in `doc/epics/EPIC-107.md`. Fixed in three places:

- `src/main/module-service-supervisor.ts` — the port travels only in the transfer list;
- `src/ipc/module-service-channels.ts` — `attach-renderer` no longer declares `rendererPort` in the body;
- `assets/module-service-host.mjs` — `attachRenderer(message, event.ports[0])`.

### Also observed

- The supervisor's **restart budget and service log capture work**: a deliberately broken service
  entry (a syntax error in the fixture) produced three restarts, a terminal
  `failed` / `process-exit-before-ready` state with `restartCount: 3`, and three
  `Failed to load module service entry … Invalid or unexpected token` lines captured to the board's
  `ui.log`. An explicit `app.boards.startService(root)` then cleared the failed state and the
  service came up `running` with a pid — confirming EPIC-106 D4's explicit-restart rule.
- US-1472's declaration discovery names the board correctly in the unavailable message:
  `Provider "demo/mem" from board "…\.persephone\boards\Demo" is unavailable.`

### Gap found, not fixed

**A page opened while the provider's service was down does not recover when the service later
starts.** After the service reached `running`, an already-open `mem://` page stayed blank; only a
newly opened page got its content. EPIC-107 criterion 4 covers the *untrust → re-trust* cycle with
a `MissingProvider`; this is the adjacent case of a **registered** type whose `ProxyProvider` was
unavailable at read time, and it has no recovery trigger today. Recorded in the roadmap's
*Needs user verification* for a decision: either the availability signal should also re-read pages
whose `ProxyProvider` failed, or the page should offer an explicit retry.
