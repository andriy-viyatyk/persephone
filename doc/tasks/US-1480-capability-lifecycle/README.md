# US-1480: Request lifecycle — ids, deadlines, typed rejections, cycle detection, revocation settling

## Status

**Status:** Planned  
**Epic:** [EPIC-108: The capability bus and the in-memory intent channel](../../epics/EPIC-108.md)  
**Wave:** 2, parallel with US-1481  
**Depends on:** US-1479's capability index and `src/ipc/capability-bus-channels.ts` contract; US-1481's `CapabilityTransport` implementation

## Goal

Replace the current direct built-in capability lookup with a renderer-local request bus that gives
every invocation an id, absolute deadline, typed outcome, bounded re-entrancy, payload-size check,
and owner-driven teardown. Board-origin calls use the `CapabilityTransport` contract from EPIC-108;
platform-origin handlers retain their existing direct-call shape and never cross that transport.

This document is planning only. It changes no production source, adds no tests or harnesses, and
does not implement the transport or edit the IPC channels module.

## Background

The source was inspected on 2026-09-20. EPIC-108 decisions D1-D10 are binding, especially D5
(closed error taxonomy), D6 (page-scoped chain and depth), D7 (8 MiB inline payload ceiling), and
D9 (revocation and teardown).

### Current capability implementation

`src/renderer/api/capabilities.ts:1-123` currently seeds a module-level `Map` from
`editorRegistry.getAll()`. `Capabilities.invoke()` validates the built-in `content.view`
representation, looks up one handler by `(id, representation)`, throws a bare
`Error("Unknown capability: …")` when absent, and directly calls the handler. There is no request
id, deadline, cancellation, transport, typed error code, discovery of board candidates, chain,
depth, or pending-request table. The current public overloads are in
`src/renderer/api/types/capabilities.d.ts:41-46`.

The built-in declarations are already carried by `EditorDefinition.capabilities` in
`src/renderer/editors/base/editorRegistry.ts:8-12,66-103` and seeded in
`src/renderer/editors/register-editors.ts:162-173,222-235`. The existing handlers in
`capabilities.ts` create pages or call the draw handler directly. Their result and payload shapes
must remain compatible with the 23 existing `app.capabilities.invoke` call sites; eight is the
number of built-in declarations, not the number of call-site families. The new general signature
is added beneath those typed overloads rather than replacing them.

US-1479 owns the widened registration/index surface. At investigation time
`src/ipc/capability-bus-channels.ts` does not exist, so this task is written against the exact
EPIC-108 seam rather than inventing a local copy. US-1480 consumes these exported names only:

```ts
interface CapabilityTransport {
    dispatch(registration: CapabilityRegistration, request: IntentRequest): Promise<unknown>;
    cancel(registration: CapabilityRegistration, requestId: string): void;
    chainForPage(pageId: string | undefined): { chain: readonly string[]; depth: number };
}
```

The pinned request is exactly:

```ts
interface IntentRequest {
    requestId: string;
    id: string;
    version?: number;
    payload: unknown;
    chain: string[];
    depth: number;
    deadlineAt: number;
}
```

The bus must consume, not implement, `CapabilityTransport`; it must not create or edit
`src/ipc/capability-bus-channels.ts`. US-1481 registers the board implementation at startup. A
`platform` registration continues through the current direct handler function. It is not converted
into a transport request merely to make the implementation uniform.

### Verified cancellation gap

The existing paths stop waiting on the caller side but do not deliver a cancellation message to a
callee:

- `src/main/module-service-supervisor.ts:321-355` stores a request and rejects it locally when its
  timer fires. `src/main/module-service-supervisor.ts:847-853` rejects all pending service
  requests during stop, but the `ServiceParentMessage` union in
  `src/ipc/module-service-channels.ts:45-65` has no cancel message.
- `src/renderer/api/module-service.ts:280-315` deletes the renderer pending entry and rejects on
  timeout; it does not send a cancel to the utility process. Its lease-loss path similarly settles
  the renderer map and closes the port.
- `src/board-shim.ts:430-435` has an `rpc()` request with no timeout at all. Its
  `persephone.call()` path at `:446-468` has only a very long dead-port guard; the host's normal
  timeout rejects the caller, and no cancel envelope exists in `BoardToMain` / `MainToBoard` at
  `src/ipc/board-bridge-channels.ts:214-227`.
- `src/renderer/editors/board/BoardWebview.ts:320-400` handles the existing host-frame request /
  reply messages, but there is no intent cancel delivery path. Its pending AiVision calls are
  rejected locally by `onDispose()` at `:122-153`; that is not a callee cancellation protocol.

Therefore the deadline-to-handler cancel required by D5 and D9 is new protocol supplied by the
capability bus plus US-1481, not wiring around an existing cancel method.

### Revocation and teardown seams

D9 is designed around the following verified source behavior:

- `src/renderer/api/board-trust.ts:87-94` exposes the in-memory
  `boardTrust.subscribePaths()` subscription. It fires after the trusted path list changes; it is
  not a filesystem watcher. `isTrusted()` at `:70-75` is ancestor-aware and must be used when
  checking a registration's `boardRoot`.
- `src/renderer/editors/board/custom-editor-registry.ts:184-191` subscribes to that same trust
  signal and calls `refresh()`. `refresh()` at `:202-347` asynchronously re-reads trusted
  manifests, then synchronously rebuilds state. At `:287-292` it removes every board-origin
  provider/scheme registration, including registrations whose owners have disappeared from the
  current trusted list, before installing the current declarations. US-1479 must put capability
  registration rebuild/release on this same refresh path; US-1480 must not create a second
  registration lifecycle.
- `src/renderer/api/pages/PageModel.ts:69-90` has one public `onClose` callback, not an event
  subscription. Add an additive disposal subscription to `PageModel` that returns an unsubscribe
  function and fires from `dispose()` at `:803-820`; `PageModel.close()` still invokes `onClose`
  at `:745-760`. `src/renderer/api/pages/PagesModel.ts:64-105` continues to own that callback,
  and `PagesModel.detachPage()` continues to clear it at `:113-125` without disposing the page.
  The bus subscribes to the new disposal notification instead of composing or replacing
  `onClose`, so a cross-window transfer retains the lifecycle hook until the page is truly disposed.
- A board frame is disposed by `BoardWebview.onDispose()` at `:122-153`, which closes its port and
  rejects existing host-side AiVision work. The transport implementation must turn a board intent
  frame/page disposal into the pinned `handler-closed` or `crashed` rejection; the bus cannot infer
  that from `CapabilityTransport` without a dispatch rejection.
- `src/renderer/core/state/events.ts:48-49` defines `windowClosing`, and
  `src/renderer/api/internal/GlobalEventService.ts:253-255` sends it from `beforeunload`. The bus
  subscribes to this event as its renderer-window owner backstop and settles every remaining local
  request as `cancelled`.

The exact settlement drivers will be:

| Lifecycle condition | Driver | Bus action |
|---|---|---|
| Board untrusted | `boardTrust.subscribePaths()` callback; check each pending board registration with `boardTrust.isTrusted(boardRoot)` | Settle `untrusted`, call best-effort `transport.cancel()`, remove the pending record and its page-chain ownership immediately. `customEditorRegistry.refresh()` then removes the registration from the index over the board-origin set. |
| Handler page/frame closes | Typed `dispatch()` rejection from the US-1481 transport | Settle `handler-closed`; release the handler page's chain through the same pending-record cleanup. |
| Handler frame errors/reloads | Typed `dispatch()` rejection from the US-1481 transport | Settle `crashed`; do not retry or re-deliver. |
| Caller page disposes | Additive `PageModel` disposal subscription installed by the bus for the request's `pageId` | Settle `cancelled` and call `transport.cancel()`; the existing `onClose` callback remains untouched, including across cross-window transfer. |
| Caller renderer window closes | `windowClosing` subscription | Settle all local requests as `cancelled` and best-effort cancel board dispatches. |
| Caller cancellation | `AbortSignal` supplied in invocation options, routed through the bus's one-shot cancel primitive | Settle `cancelled` and call `transport.cancel()` once. |
| Deadline | Per-request timer derived from `deadlineAt` | Settle `timeout` first, then deliver one best-effort `transport.cancel()`; the bus does not claim that handler work stopped. |

The board-trust subscription is deliberately the immediate settlement driver. The bus must not wait
for the asynchronous manifest reads in `customEditorRegistry.refresh()`, because a stale registration
could otherwise accept a new request during the refresh window. Resolution and dispatch also perform
an `isTrusted(boardRoot)` check, making this race fail closed. Refresh remains the authoritative
registration rebuild/release seam owned by US-1479.

## Implementation Plan

### 1. Add the owned request state machine in `src/renderer/api/capability-bus.ts`

- Import the constants, `CapabilityErrorCode`, `CapabilityOrigin`, `CapabilityRegistration`,
  `IntentRequest`, and `CapabilityTransport` types from the US-1479 channels module. Do not declare
  replacement local constants or wire messages.
- Export a typed `CapabilityError` carrying the closed `code`, a readable `message`, and the
  `requestId` when a request exists. Preserve transport-provided messages, including a handler's
  `rejected` message, while normalizing unknown transport failures to the appropriate typed code.
- Keep a `Map<string, PendingIntent>` keyed by `requestId`. Each record owns the selected
  registration, request, caller `pageId`, deadline timer, settlement callbacks, and a settled flag
  (or equivalent map-identity guard). Keep a second count map keyed by
  `registration.handlerKey` for `MAX_OUTSTANDING_INTENTS_PER_HANDLER`.
- Generate `requestId` with `crypto.randomUUID()` at the bus boundary. Never reuse it and never
  invoke `dispatch()` a second time after timeout, cancellation, untrust, a handler failure, or a
  late result. A late settlement sees no pending map entry and is a no-op.
- Implement one private `settle()` path that clears the deadline timer, removes the pending record,
  decrements the handler count, unsubscribes the owning page's disposal listener, and resolves or
  rejects exactly once. Cancellation delivery is an explicit argument to this path so timeout,
  caller close, abort, and untrust cannot accidentally omit it.
- Install the two process-lifetime renderer subscriptions when the bus is initialized:
  `boardTrust.subscribePaths()` for immediate board revocation and `windowClosing.subscribe()` for
  final local teardown. Every callback is idempotent and safe when a request has already settled.
- For a request with a caller `pageId`, find the actual `PageModel` through `pagesModel.findPage()`
  and subscribe to its new additive disposal notification. Store the returned unsubscribe with the
  pending record; disposal settles all requests owned by that page and calls transport cancellation
  for board handlers. Do not alter the existing `onClose` contract or `PagesModel.attachPage()` /
  `detachPage()` behavior. If the page cannot be found, retain the request's window-level backstop
  and do not fabricate a page owner.

Before → after lifecycle shape:

```ts
// Before: capabilities.ts looks up one handler and returns its direct promise.
const handler = handlers.get(capabilityKey(id, representation));
if (!handler) throw new Error(`Unknown capability: ${id}`);
return handler(payload);

// After: the bus owns the pending entry, timer, owner hooks, and typed settlement.
return capabilityBus.invoke(registration, payload, {
    pageId: options?.pageId,
    signal: options?.signal,
    deadlineMs: options?.deadlineMs,
});
```

### 2. Build the pinned `IntentRequest` and enforce lifecycle limits

- Parse a version suffix such as `image.edit@1` at the bus boundary. Store the bare id in
  `request.id` and the numeric major in `request.version`; unpinned calls omit `version`.
- Ask `transport.chainForPage(pageId)` for the current page-scoped chain/depth. Reject with
  `cycle` before dispatch if `registration.handlerKey` is already in the returned chain or the
  returned depth is `>= MAX_INTENT_DEPTH`. Otherwise copy the returned chain/depth into the
  request. Do not maintain an async-continuation chain in the bus; D6 explicitly makes it page
  scoped.
- Compute `deadlineAt` as an absolute timestamp from the exported `INTENT_DEADLINE_MS` (or the
  validated per-call deadline option if US-1479 exposes that option). Schedule from the remaining
  time, not from a second relative timer after dispatch.
- Reject `payload-too-large` before registering or dispatching when the structured-value size
  estimate exceeds `MAX_INTENT_PAYLOAD_BYTES`. The message must name both the constant and the
  numeric byte limit.
- Measure size with a single bounded traversal, not `JSON.stringify()`: count UTF-8 bytes for
  strings and object keys, fixed clone overhead for primitives and containers, exact `byteLength`
  for `ArrayBuffer`/typed-array views, and `Blob.size` when present. Track visited object identities
  in a `WeakSet` so cycles and shared references cannot recurse forever or be counted repeatedly.
  Treat unsupported/uncloneable values as a normal structured-clone validation failure mapped to
  `rejected`; never silently truncate or stringify a `Uint8Array`. Stop traversal as soon as the
  running conservative estimate exceeds the exported cap.
- Enforce `MAX_OUTSTANDING_INTENTS_PER_HANDLER` before dispatch using `handlerKey`, including
  requests that are still waiting for a board page to answer. A capacity refusal is a typed `busy`
  error with a message naming the handler and `MAX_OUTSTANDING_INTENTS_PER_HANDLER`; consume the
  `busy` code supplied by US-1479 and do not define another code.

Before → after request shape:

```ts
// Before: no correlation or deadline crosses the current board bridge.
post({ kind: "call", id, request });

// After: every capability dispatch is correlated and carries D6/D7/D9 state.
const request: IntentRequest = {
    requestId: crypto.randomUUID(),
    id: bareId,
    ...(version === undefined ? {} : { version }),
    payload,
    chain: [...chainState.chain],
    depth: chainState.depth,
    deadlineAt,
};
await transport.dispatch(registration, request); // exactly once
```

### 3. Implement the closed D5 failure taxonomy

Every code must be reachable through the following concrete path; no ad-hoc string-only errors may
escape a bus-owned request:

| Code | Bus trigger and required behavior |
|---|---|
| `no-handler` | Resolver finds no matching id, version, or `accepts` candidate; include the requested id/version in the message. |
| `untrusted` | A board registration is already untrusted at resolution/dispatch, or its board becomes untrusted through `boardTrust.subscribePaths()`. |
| `handler-closed` | Transport reports handler page/frame disposal before settlement. |
| `crashed` | Transport reports a handler frame error or board reload failure. |
| `cancelled` | Caller aborts the supplied signal, caller page closes, or renderer window closes. |
| `timeout` | The absolute deadline elapses; reject first and then call transport cancel once. |
| `cycle` | Winning `handlerKey` is in the page chain, or current depth is at least `MAX_INTENT_DEPTH`. |
| `payload-too-large` | Conservative structured-value estimate exceeds `MAX_INTENT_PAYLOAD_BYTES`; message names the limit. |
| `busy` | The winning handler already has `MAX_OUTSTANDING_INTENTS_PER_HANDLER` requests outstanding; preserve the capacity reason in the message. |
| `rejected` | Handler returns the transport's explicit rejection, built-in direct handler throws a handler-level failure, or the structured-clone guard refuses the call; preserve the handler message. |

Transport errors must be normalized structurally from `{ code, message }` / `CapabilityError` rather
than parsed from arbitrary error text. The bus must preserve a handler's `rejected` message and
never convert a late result into a second resolve/reject.

### 4. Delegate from `src/renderer/api/capabilities.ts` without changing built-in shape

- Keep the existing built-in handler functions and their lazy draw import. Extend the in-memory
  index through the US-1479 registration surface; do not duplicate manifest parsing or board
  registration in this file.
- Instantiate the renderer-local bus once and provide it the transport registration seam that
  US-1481 fills at startup. The bus may reject board dispatches before that registration as
  `handler-closed`/`crashed` only if the transport contract supplies that typed result; it must not
  invent a second board bridge.
- Resolve candidates with the D4 ordering already pinned by EPIC-108: numeric priority, platform
  over board on ties, and trusted-list order for tied boards. Keep losers available to
  `handlers(id)` through the US-1479 index. `invoke()` uses only the winning registration.
- Preserve the four existing typed overloads and add the general open-id overload with optional
  lifecycle options (at minimum caller `pageId` for D6 and an `AbortSignal` for caller cancel).
  Existing two-argument built-in call sites must compile and continue receiving their current direct
  result types.
- Do not edit `src/renderer/editors/mermaid/MermaidEditor.ts`; its
  `Awaited<ReturnType<typeof app.capabilities.invoke>>` landmine belongs to US-1479, which owns
  the widened signature change.
- For `platform` origin, call the current `CapabilityHandler(payload)` directly and return its
  existing page/result shape. Do not call `CapabilityTransport.dispatch()` or
  `CapabilityTransport.cancel()` for platform handlers. Convert a direct handler failure to a
  `CapabilityError` with code `rejected`, retaining its readable message and the original thrown
  value as `cause` so `errMessage()` and existing `guard()` call sites lose no detail.
- For `board` origin, call the new bus path and return the transport's resolved value unchanged,
  including the US-1481 `{ pageId, result? }` result envelope. The bus must not open pages itself;
  D3 page selection and intent delivery belong to the board transport.

Before → after invocation boundary:

```ts
// Before: only closed built-in ids exist and unknown ids have a bare Error.
invoke(id: CapabilityId, payload: unknown): Promise<CapabilityResult> {
    const handler = handlers.get(capabilityKey(id, representation));
    if (!handler) throw new Error(`Unknown capability: ${id}`);
    return handler(payload);
}

// After: built-ins remain direct; board candidates enter the lifecycle bus.
invoke(id: string, payload: unknown, options?: CapabilityInvokeOptions) {
    const registration = resolveWinningRegistration(parseCapabilityId(id), payload);
    if (!registration) return Promise.reject(noHandlerError(id));
    if (registration.origin === "platform") return invokeBuiltIn(registration, payload);
    return capabilityBus.invoke(registration, payload, options);
}
```

### 5. Keep ownership and registration release aligned with US-1479

- The bus's trust callback must settle pending records by `registration.boardRoot`, never by the
  current trusted list alone. This is the same board-origin principle as
  `customEditorRegistry.refresh()` and prevents an already-untrusted board from disappearing from
  the list before its in-flight request is settled.
- A board that is re-trusted receives newly rebuilt registrations; old request ids are not retried
  or resurrected. At-most-once applies across untrust/retrust.
- Inline payloads have no `DataHandle` to release in this epic. “Release handles” in D9 means the
  pending request, timer, page chain ownership, concurrency slot, and any transport-side request
  reference are all released. The deferred `DataHandle` store remains outside this task.

## Concerns / Open Questions

All implementation questions are resolved for this plan:

- **Page ownership.** The seam is an additive disposal subscription on `PageModel`, fired by
  `dispose()` and returning an unsubscribe function; it is not a composition workaround around
  `onClose`. `PagesModel.attachPage()` / `detachPage()` and the existing `onClose` contract remain
  unchanged. Because detach clears `onClose` without disposing the page, a cross-window transfer
  retains the bus's disposal listener until the transferred page is truly torn down. The
  `windowClosing` subscription remains the renderer-window backstop for anything still local.
- **Untrust timing.** `boardTrust.subscribePaths()` drives immediate settlement; the bus will not
  await `customEditorRegistry.refresh()`. The refresh remains the one registration rebuild/release
  seam, and any later refresh callback is only an idempotent reconciliation.
- **Caller identity.** Existing two-argument in-renderer call sites have no explicit caller page.
  The general lifecycle options carry `pageId`; US-1481 supplies the board page id at its host
  boundary. When no page id is supplied, `chainForPage(undefined)` is used and only the renderer
  window backstop owns the request. US-1479 must keep the public type declaration aligned with this
  runtime option.
- **Cancellation API.** The public caller cancellation hook is an `AbortSignal`; the bus's
  internal `cancel(requestId)` primitive is used by the signal, page-close, window-close, and
  deadline paths. This preserves the existing Promise-returning `invoke()` surface while making
  the D5 “caller called cancel()” action observable.
- **Capacity code.** D5 assigns `busy` to a winning handler that already has
  `MAX_OUTSTANDING_INTENTS_PER_HANDLER` requests outstanding. US-1479 owns and supplies that
  code; US-1480 consumes it and keeps `rejected` for handler or cloneability refusal.
- **Payload measurement.** A conservative traversal is deterministic, handles binary values, and
  avoids JSON's lossy treatment of typed arrays and cycles. It may reject a value whose actual
  browser clone is smaller, but it cannot permit an obviously oversized payload or perform a
  silent truncation. The 8 MiB threshold and future `DataHandle` trigger remain D7's decision.
- **Transport absence during this investigation.** `src/ipc/capability-bus-channels.ts` is not in
  the current tree. The implementation must import the landed US-1479 contract and adapt only to
  its pinned names/shapes; it must not create a temporary local interface or edit US-1481 files.
- **No tests or harnesses.** This repository's task workflow uses live verification through MCP;
  this task adds no unit tests, test fixtures, or test harnesses.

## Acceptance Criteria

- [ ] Every board-capability request contains exactly the pinned lifecycle fields: unique
  `requestId`, bare `id`, optional numeric `version`, original structured `payload`, page-scoped
  `chain`, `depth`, and absolute `deadlineAt`.
- [ ] `dispatch()` is called at most once per request id. Late transport results, duplicate
  settlements, and repeated teardown signals are no-ops; no pending entry or concurrency slot
  survives its owner.
- [ ] All ten D5 codes are reachable and typed: unknown/pinned-version calls produce
  `no-handler`; trust loss produces `untrusted`; handler disposal produces `handler-closed`; frame
  failure/reload produces `crashed`; abort/page/window close produces `cancelled`; deadline produces
  `timeout`; chain/depth violations produce `cycle`; oversize payloads produce
  `payload-too-large` naming `MAX_INTENT_PAYLOAD_BYTES`; capacity produces `busy`; handler
  rejection and cloneability refusal produce `rejected` with a readable message.
- [ ] A timeout rejects the caller and delivers one best-effort `cancel` through the transport; it
  does not claim or assume the handler's work stopped, and it never re-delivers the original request.
- [ ] A caller `PageModel` disposal settles its requests as `cancelled`, including after a
  cross-window page transfer, and sends transport cancellation; the existing `onClose` callback
  remains unchanged. Handler page/frame disposal settles as `handler-closed`, while handler
  errors/reloads settle as `crashed`.
- [ ] `boardTrust.subscribePaths()` settles every pending request owned by a board that is no longer
  trusted as `untrusted`, releases its request/page/slot state, and prevents a stale registration
  from dispatching during asynchronous `customEditorRegistry.refresh()`. Re-trust creates new
  registrations without replaying old request ids.
- [ ] Cycle detection checks both the winning `handlerKey` in the inherited chain and
  `depth >= MAX_INTENT_DEPTH`; an unrelated page-scoped request starts with an empty chain and
  depth zero.
- [ ] The payload estimator handles strings, nested structured values, cycles/shared references,
  `ArrayBuffer`/typed arrays, and `Blob` sizes without JSON stringification; it rejects over-limit
  values before dispatch and preserves binary payloads inline below the cap.
- [ ] The per-handler outstanding count enforces `MAX_OUTSTANDING_INTENTS_PER_HANDLER` without
  adding a new error code, and counts requests waiting for a handler settlement until they are
  settled.
- [ ] Built-in platform handlers keep their direct-call path and existing overload/result behavior;
  they do not call the board transport. Board results preserve the transport's `{ pageId, result? }`
  envelope.
- [ ] No files listed as protected below are changed; no unit tests or harnesses are added. After
  implementation, `npm run typecheck`, `npm run lint`, and `npm run build-prod` pass, followed by
  EPIC-108's live MCP checks for timeout cancel, caller close, handler close, untrust settling,
  cycle detection, payload cap, and duplicate settlement.

## Files Changed Summary

| File | Planned change | Changed by this planning task |
|---|---|---|
| `src/renderer/api/capability-bus.ts` | New renderer-local lifecycle state machine: request ids, deadlines, typed errors, transport dispatch/cancel, chain/depth, payload estimate, per-handler cap, trust/page/window teardown, and idempotent settlement. | No |
| `src/renderer/api/capabilities.ts` | Delegate registration resolution to the lifecycle bus for board-origin handlers while retaining direct platform handlers and existing overloads. | No |
| `src/ipc/capability-bus-channels.ts` | US-1479-owned wire/type contract consumed by this task; do not create or edit here. | No |
| `src/renderer/api/types/capabilities.d.ts` and `assets/editor-types/capabilities.d.ts` | US-1479-owned public type widening; keep aligned with its landed `invoke()` options, but do not duplicate or edit from US-1480. | No |
| `src/renderer/api/board-trust.ts` | Existing `subscribePaths()` / `isTrusted()` seam read by the bus; no change. | No |
| `src/renderer/editors/board/custom-editor-registry.ts` | US-1479-owned capability rebuild/release seam; no change in US-1480. | No |
| `src/renderer/api/pages/PageModel.ts` | Additive disposal subscription fired from `dispose()`, returning an unsubscribe for each owning-page request; preserve the existing `onClose` contract. | No |
| `src/renderer/api/pages/PagesModel.ts` | Existing `attachPage()` / `detachPage()` and `onClose` ownership remain unchanged. | No |
| `src/renderer/editors/board/BoardWebview.ts`, `src/board-shim.ts`, `src/ipc/board-bridge-channels.ts`, `src/renderer/api/boards.ts` | US-1481 bridge/shim/board surface; no change. | No |
| `src/renderer/editors/board/board-manifest.ts`, board-info files, trust-dialog files | US-1479 manifest/disclosure surfaces; no change. | No |
| `src/main/module-service-supervisor.ts`, `src/renderer/api/module-service.ts` | Existing service lifecycle inspected as the concurrency/settlement model; no change. | No |
| `doc/tasks/US-1480-capability-lifecycle/README.md` | This investigation and implementation plan. | Yes |
