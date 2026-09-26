# US-1518: A content read has no deadline; cancellation is the only release

**Epic:** [EPIC-113](../../epics/EPIC-113.md) — D6 is binding for this document and is not
re-argued below: **a content read waits until the page closes or the user deletes the source.**
D5, D7, D11 and D14 are also binding as established precedent (capability-announcement pattern,
per-page/per-resource concurrency, trust-is-the-only-gate, both-sides-of-the-wire validation).

This document **corrects one factual premise inside D6** — the "shared budget" trap — against the
actual source. The correction does not reopen D6's decision (no deadline; cancel on close or
delete); it changes what requirement 3 below has to build, because the mechanism the epic assumed
does not exist in the form described. See "Correcting D6's shared-budget claim" below.

## Goal

Remove the 10 s deadline from the two provider operations that serve **content** —
`readBinary` and `readRange` — replacing it with two release paths that already exist for
everything else (page close, explicit board-side deletion) plus one that does not yet exist on the
wire (an explicit cancel message that actually reaches the service process and frees its request
slot). Everything that is not a content read keeps its 10 s deadline unchanged.

## Scope note

Per the epic's suggested order, this task follows US-1474 (ranged reads), which shipped the
`readRange` operation this task must make cancellable. US-1521 (`persephone.content.open()`) and
US-1519 (media player) are separate, later tasks; nothing here depends on them, and nothing here
should require rework when they land — the cancel/no-deadline mechanism below is keyed to the
**operation** (`readBinary` / `readRange`) and the **pipe/page**, not to any particular caller.

## Background — verified against source

### The wire and its three (really four) deadline sites

`SERVICE_REQUEST_DEADLINE_MS = 10_000` and `MAX_OUTSTANDING_REQUESTS_PER_SERVICE = 32` are both
defined once, in `src/ipc/module-service-channels.ts:12-13` — the deliberately import-free wire
contract file (its own header: *"no renderer or main implementation imports"*).

The constant is consumed as a **default timeout** in four places, not three — the brief's list
missed one that turns out to be load-bearing:

1. **`src/renderer/api/module-service.ts:294-301`** (renderer client `request()`) — per-request
   timer in `client.pending`, guarded by
   `Number.isFinite(deadlineMs) && (deadlineMs ?? 0) > 0`.
2. **`src/main/module-service-supervisor.ts:341-346`** (main supervisor `request()`) — per-request
   timer in `record.requests`, same guard shape (`Number.isFinite(deadlineMs) && deadlineMs > 0`).
3. **`assets/module-service-host.mjs`'s `withDeadline()` (`:212-222`)** — races a provider
   implementation call against `deadlineMs`, a single value fixed for the process's whole lifetime
   (passed once via `process.argv`, set at `module-service-supervisor.ts:576`,
   `String(SERVICE_REQUEST_DEADLINE_MS)`).
4. **`assets/module-service-host.mjs`'s `handleRendererRequest()` (`:344-351`) — NOT named in the
   brief, but a fourth, independent enforcement point.** This is a *second*, outer timer, wrapping
   the **whole round trip** of one renderer-originated provider request (validate → dispatch →
   reply), started the instant the request is accepted (`:344`) and cleared only when
   `finishProviderRequest()` runs (`:322`). It fires **even if `withDeadline()`'s inner race is
   removed** — so removing only `withDeadline()`'s wrap around `readBinary`/`readRange` is not
   suficient; this outer timer independently replies `provider-failed` /
   `"Provider operation timed out."` at the same `deadlineMs` and must be skipped for the same two
   operations. Confirmed by reading `handleRendererRequest()` line by line: the timer at `:344` is
   set unconditionally for every accepted request, before `executeProviderRequest()` is even
   invoked; `executeProviderRequest()`'s own `withDeadline()` calls are a nested, redundant race for
   `readBinary`/`readRange`/`writeBinary`/`stat`, while `watchSubscribe`/`watchUnsubscribe` are only
   covered by this outer timer (they never call `withDeadline()` — see `executeProviderRequest()`
   `:283-317`).

Both `request()` functions' guards were checked directly: `Number.isFinite(Infinity)` is `false`,
so `Infinity` falls through to the `SERVICE_REQUEST_DEADLINE_MS` default in both places, and so does
`0` (fails `> 0`). Confirmed exactly as the brief states — **an explicit sentinel is required.**

### Correcting D6's shared-budget claim

D6 states: *"Provider reads from the renderer go over the MessagePort path (`module-service.ts:280-313`)
into a `client.pending` map capped at `MAX_OUTSTANDING_REQUESTS_PER_SERVICE` = 32. The board frame's
own `persephone.service.request()` calls — status, metadata, and 'delete this torrent' — share that
map and that cap."*

**This is not what the source does today.** Traced end to end:

- A **provider read** (`ProxyProvider.readBinary()` / `.fetchRange()`, `ProxyProvider.ts:112-132`)
  calls `moduleService.request()` in the **renderer** (`module-service.ts:284-319`), which posts
  directly on `client.port` — a `MessagePort` attached to the utility process via a one-time
  `attach-renderer` handshake (`transferRendererPort()`, `module-service-supervisor.ts:358-419`).
  This never touches main's request bookkeeping; it is tracked **only** by `client.pending`
  (renderer) and its mirror, `lease.pending` (host, `assets/module-service-host.mjs:340-352`).
- A board's **`persephone.service.request(message)`** call (`board-shim.ts:1486-1490`,
  `rpc("serviceRequest", [message])`) is handled by **`board-bridge.ts:261`**:
  `serviceRequest: (entry, args) => moduleServiceSupervisor.request(...)` — the **main-process**
  supervisor's own `request()` (`module-service-supervisor.ts:321-356`), tracked in `record.requests`
  / `record.pendingRequestSlots`, a map that lives in **main**, not the renderer. It reaches the
  service process over a **different Node channel** — `record.process.postMessage({kind:"request",...})`
  on the utility process's own `parentPort` (the main↔utility-process channel established by
  `utilityProcess.fork()`), not the `MessagePort` lease used for provider traffic.
  `src/renderer/api/boards.ts:412-422` (`app.boards.requestService`, the renderer script-API
  equivalent used by `persephone.service.request`) states this explicitly in its own comment:
  *"Routed through MAIN, not over the renderer MessagePort lease. The lease is reserved for
  high-volume provider traffic (Phase C's `ProxyProvider`) and a service is not obliged to
  implement that port at all."*
- **On the service-host side, these two channels are answered by two different scripts.**
  `assets/module-service-host.mjs` (the platform's own injected script) only ever handles `"request"`
  messages arriving on the **lease** `MessagePort` (`handleRendererRequest()`, wired inside
  `attachRenderer()`'s `port.on("message", ...)`, `:378-397`) — these are exclusively provider
  protocol (`validProviderRequest()` requires `message.kind === "provider"`). A `"request"` message
  arriving on the utility process's raw **`parentPort`** (main → service, the control-plane path) is
  **not handled by `module-service-host.mjs` at all** — grepped exhaustively; its only two
  `parentPort.on("message", ...)` listeners handle `"storage-response"` (`:72-84`) and
  `"attach-renderer"`/`"drop-renderer"` (`:412-421`). It is instead the **board's own declared
  service script** that listens on `process.parentPort` directly and answers it — confirmed against
  two real examples, `assets/demo-board/scripts/service.mjs:23-136` and
  `persephone-boards/_test/range-provider-test/scripts/service.mjs`'s bottom section, both of which
  register `parentPort.on("message", ...)`, branch on `"init"`/`"probe"`/`"shutdown"`/`"request"`,
  and reply with `parentPort.postMessage({kind:"response", requestId, result})` themselves. This is
  also documented as deliberate in `doc/tasks/US-1473-proxy-provider/README.md:128-130`: *"The host
  must not handle ordinary parent-port `kind: 'request'` messages. Provider traffic ... a provider
  operation through parentPort as `kind: 'request'` would make the demo entry's [handler] also
  answer them."*

**Conclusion: `client.pending` (provider reads) and `record.requests` (a board's own
`persephone.service.request()` / `app.boards.requestService()` control calls) are two separate maps,
in two separate processes, reached over two separate transports.** Filling one does not, by itself,
block the other. The epic's central worked example — "enough forever-waiting reads and the board's
own... 'delete this torrent'... fails `service-busy`" — does not occur through this path, because
that delete call never contends for `client.pending`/`lease.pending` slots at all.

**This does not mean requirement 3 is moot — it means the real risk is narrower and different, and
is confirmed in the source:**

`client.pending`/`lease.pending` is shared by **every provider operation the platform itself issues
against one board's service**, across every registered provider `type` and every open resource of
that board — `readBinary`, `readRange`, `writeBinary`, `stat`, `watchSubscribe`, `watchUnsubscribe`
all share the one 32-slot pool per board root (`getClient(boardRoot)`,
`module-service.ts:120-137`, keyed only by `boardRoot`). Concretely: `ProxyProvider.stat()`
(`ProxyProvider.ts:213-225`) is what `resolveTotalSize()` calls on **every** page backed by that
board's providers (`board-pipe-handler.ts:91-130`), and it goes through the same `client.pending`
map as a stalled `readRange`. So a torrent board with several files stalled on cold-swarm reads
would, under the *current* accounting, eventually make **`stat()` for a different file of the same
board** — and therefore opening or resuming any other page from that board — fail with
`service-busy`, once 32 slots are exhausted. That is a real, source-confirmed instance of "a content
read blocks something that needs to keep working," even though it is not the specific control-plane
call D6 names. The fix designed below (operation-kind accounting split) resolves this actual risk;
whether it also happens to satisfy D6's literal wording is moot once the wording is corrected.

**`moduleServiceSupervisor.request()` / `record.requests` needs no change from this task.** It never
carries a content read (see above), so it never needs the no-deadline sentinel, and its accounting
is already isolated from provider traffic. It stays part of the "Files needing NO changes" list
below.

**There is a third pool sharing main's budget, and it is worth naming explicitly so nobody
rediscovers it while working on this task.** `src/main/module-service-storage.ts:37-38`
(`ModuleServiceStorageAdapter.handle()`) gates its own `this.pending` map on
`this.pending.size + this.context.getOutstandingRequestCount() >= MAX_OUTSTANDING_REQUESTS_PER_SERVICE`,
where `getOutstandingRequestCount()` (`module-service-supervisor.ts:233`) returns
`record.pendingRequestSlots + record.requests.size` — the **same** counter `moduleServiceSupervisor.request()`
itself checks. So main-process accounting is actually a combined budget across **three** things: the
board's own `persephone.service.request()`/`app.boards.requestService()` calls (`record.requests`),
transient service-start attempts (`record.pendingRequestSlots`), and a service's own outbound
`persephone.storage.*` calls back to main (`ModuleServiceStorageAdapter.pending`). All three are
control-plane traffic — none of them is a content read, none of them is touched by this task's
sentinel or accounting-split work, and this task does not change `getOutstandingRequestCount()` or
either of its callers. Named here so a future reader who finds a second "shares a cap" relationship
doesn't have to re-derive it: it exists, it is unrelated to the renderer/host pools this task
changes, and it is explicitly out of scope.

### `invalidateBoardPipePage()` today — traced exactly

`PagesModel.ts:114-126` (`detachPage`) calls `invalidateBoardPipePage(pageId)` from
`board-pipe-handler.ts:238-245` on every page detach (close, replace, etc. — anywhere `detachPage`
runs). What it actually does:

```ts
export function invalidateBoardPipePage(pageId: string): void {
    pipeMemos.delete(pageId);
    for (const [requestId, pending] of pendingReads) {
        if (pending.pageId !== pageId) continue;
        pending.cancelled = true;
        pendingReads.delete(requestId);
    }
}
```

`pendingReads` is `board-pipe-handler.ts`'s **own** local map, keyed by the **board-pipe IPC**
`requestId` (`BOARD_PIPE_READ_CHANNEL`'s request id — main↔renderer, unrelated to the module-service
wire's `requestId`), created per call in `handleRequest()` (`:208-230`). Marking `cancelled = true`
and deleting the entry only prevents this file's own `.then()`/`.catch()` from calling `reply()`
once `readChunk()` eventually settles (`:213-229`, both branches check
`pendingReads.get(request.requestId) === pending` before replying). **It does nothing to the
in-flight work `readChunk()` kicked off** — `pipe.createReadStream(boundedRange)` /
`pipe.readBinary()` keep running underneath, each backed (through `ProxyProvider`) by a live entry
in `client.pending`. Today that entry is still bounded by the 10 s timer, so the leak is invisible —
it self-resolves within 10 s regardless of the page having closed. **Once the deadline is removed,
this becomes a real, permanent leak**: the module-service request slot, and (if the board's
implementation is still running) the utility process's work, never stop. This is exactly the
"cancellation exists [only] in the renderer's own bookkeeping, not on the wire" gap D6 names, and it
is now precisely located: `invalidateBoardPipePage()` has no handle to anything below
`board-pipe-handler.ts` — no reference to the `ProxyProvider` request, no `AbortController`, no
`requestId` on the module-service wire.

### `readBinary`/`readRange` today, exactly (for the design below)

- `ProxyProvider.readBinary()` (`ProxyProvider.ts:134-146`) → `this.request("readBinary")` →
  `moduleService.request(boardRoot, message)` — **no `deadlineMs` argument is ever passed today**;
  every caller relies on the default.
- `ProxyProvider.fetchRange()` (`:198-211`, added by US-1474) → `this.request("readRange", { range })`
  → same `moduleService.request()`, same implicit default.
- Host side, `executeProviderRequest()` (`module-service-host.mjs:236-263`): `readBinary` and
  `readRange` each call `withDeadline(Promise.resolve(implementation.readXxx(...)))`, then validate
  the result shape and size, exactly mirroring each other.
- Neither operation is given any cancellation token today. `implementation.readBinary(config)` /
  `implementation.readRange(config, range)` are called with no extra argument; a board has no way to
  observe that Persephone has stopped caring.

### Service-process-death and other release paths — confirmed already correct, need no new work

Traced directly, per the brief's request:

- **Renderer reload / lease lost:** `loseLease()` (`module-service.ts:231-255`) clears
  `client.capabilities`/`client.rangeCapabilities`, closes the port, and calls
  `rejectPending(client, code)` (`:223-229`), which rejects **every** entry in `client.pending`
  (unconditionally, not filtered by operation) and clears its timer. Confirmed this needs no
  change: it already rejects "no-deadline" pending entries exactly the same way, since the reject
  path doesn't look at the timer at all — a request with **no** timer (the no-deadline case) is
  still just a `PendingRequest` sitting in the map, and `rejectPending` iterates the map, not timers.
- **Service crash / untrust / explicit stop (main-side):** `stopRecord()`
  (`module-service-supervisor.ts:~780-845`) calls `rejectRequests(record, stopCode)` (`:847-853`,
  rejects every `record.requests` entry — the **control-plane** pool, confirmed unaffected by this
  task) and `failLease(record, record.lease, leaseReason)` (`:855-869`), which posts
  `{kind:"lease-lost", reason}` to the renderer over the (still-open) lease port and closes it.
  Renderer's `handleMessage()` (`module-service.ts:207-210`) turns that into
  `loseLease(client, leaseLossCode(reason))`, which — as above — rejects all of `client.pending`,
  no-deadline entries included. **No new work needed here; this path is orthogonal to timers.**
- **App quit:** `moduleService.dispose()` (`module-service.ts:414-424`) calls `loseLease(client, "quit")`
  for every client — same rejection path, same conclusion.
- **Explicit delete in the board:** per D6, "the board destroys its own resource; the read fails
  naturally" — this is the board's own responsibility (its `readRange`/`readBinary` implementation
  can itself throw once its backing resource is gone) and needs no platform mechanism. Confirmed
  nothing in this repo currently depends on a platform-level "resource deleted" signal.

**Net effect for this task: only the "page closes while its own read is still outstanding" case is
missing a real release, and only because `invalidateBoardPipePage()` has no wire access — every
other path already tears down `client.pending` unconditionally.**

### Nothing else in the app relies on the 10 s content-read deadline (checked)

Searched every consumer of `ProxyProvider.readBinary()` / `.createReadStream()` /
`pipe.readBinary()` reachable from a board provider:

- `board-pipe-handler.ts` (`readBuffered()`, `readChunk()`) — the board-pipe IPC path serving
  `stream-host`/`content-host` pages; no separate timeout of its own, no spinner with no cancel
  affordance (the page itself owns whatever loading UI it has, e.g. a `<video>` element's native
  buffering state).
- `BoardEditorModel.ts:98-106` — the `editorSources: "any"` cache-materialization path
  (`pdf-viewer`/`word-viewer`/`powerpoint-viewer`), which calls `pipe.readBinary()` to build a local
  cache file before other editors' `getFilePath()` works. No caller-side timeout wraps this call.
- `src/renderer/content/registry.ts:501-529` (`readOnce()`) — **checked and confirmed unaffected**:
  its own `SERVICE_REQUEST_DEADLINE_MS`-based `withDeadline()` wraps only
  `whenProviderDeclarationsReady()` (waiting for the board's manifest/declaration to register) and
  `acquireBoardProvider(...)` (waiting for the service to start/attach) — both about **provider
  availability**, not the read itself. The actual content read, `immediate.readBinary()` at `:522`,
  happens **after** that deadline has already resolved and is not wrapped by it. This file needs no
  change.
- `ImageEditor.ts:135`, Monaco's text loading (via `TextFileIOModel`) — both call `pipe.readBinary()`/
  `readText()` with no additional timeout of their own; they already wait as long as the promise
  takes. Removing the platform's 10 s ceiling only lengthens how long they're willing to wait, which
  is the intended behavior change, not a regression — there is no UI spinner-with-no-cancel
  introduced by this, because none of these paths render a spinner today at all (checked: opening a
  board-scheme page shows the editor's default "nothing to show yet" state, not a loading spinner).
- **Capability-bus (`src/renderer/api/capability-bus.ts:237-241`, `INTENT_DEADLINE_MS`) is a wholly
  separate deadline mechanism** for capability invocations, unrelated to provider reads; not
  touched. `board-shim.ts:1471` / `BoardWebview.ts:919`'s `deadlineMs` on capability calls is the
  same, separate mechanism. Confirmed by reading `capability-bus.ts:230-290`: it has its own
  `INTENT_DEADLINE_MS` default and its own `deadlineAt` bookkeeping, no shared code with
  `module-service.ts`.
- **`module-service-status.ts:33`** (`getModuleServiceStatuses()`) uses
  `withTimeout(request, SERVICE_REQUEST_DEADLINE_MS, undefined)` for a **status snapshot** fetch —
  this is explicitly a control/metadata call (D6's own "status" example) and correctly keeps its
  deadline; not touched.
- **`module-service-storage.ts`** (`persephone.storage.*` from a board frame) has its **own**
  independent request map and deadline (`:38`, `:50`, both referencing
  `MAX_OUTSTANDING_REQUESTS_PER_SERVICE`/`SERVICE_REQUEST_DEADLINE_MS` as constants, not shared
  state with either `client.pending` or `record.requests`). Storage reads are small JSON values, not
  content; out of scope, unaffected, needs no change.

**Conclusion for requirement 6: no UI in the app assumes a provider read fails within 10 s. The
only consumer that reasons about time at all is the fixture board itself, which documents the
current 10 s failure as a known, temporary limitation to be closed by this task
(`persephone-boards/_test/range-provider-test/README.md`, "Known limitation" section).**

## Design decisions

### 1. Which operations lose the deadline

**`readBinary` and `readRange`. Nothing else.** Both are the two ways bytes actually reach a pipe —
`hasDirectStream()` (`board-pipe-handler.ts:85-89`) chooses between them, and `readBuffered()`
(`:64-83`) makes clear `readBinary` is not just "the small case": it is the **whole-resource**
fallback for exactly the same demand-driven reads `readRange` serves when a provider doesn't
implement ranging (US-1474's `_test/range-provider-test` `test/norange` provider proves this — a
2 MB or even a rejected 300 MB request goes through `readBinary` alone). Both are triggered by the
same thing: a user asked to see (or open) bytes that live behind a board provider, and nothing else
is harmed by the wait. `writeBinary`, `stat`, `watchSubscribe`, `watchUnsubscribe` keep their 10 s
deadline: `stat()` is literally D6's own "metadata" example, and `writeBinary` is not a
demand-driven read — it is board-authored persistence, already bounded by
`MAX_BUFFERED_PIPE_BYTES`, and a hung write should fail loudly rather than hold a slot forever.

### 2. The sentinel: `Infinity`

`deadlineMs` stays typed `number | undefined` everywhere it appears today (no new union member, no
new string constant to keep in sync across the wire). **`Infinity` is the sentinel**, and the two
existing guards are corrected to treat it as a first-class value rather than falling through:

```ts
// Before (both module-service.ts:294-296 and module-service-supervisor.ts:341):
const timeout = Number.isFinite(deadlineMs) && deadlineMs > 0 ? deadlineMs : SERVICE_REQUEST_DEADLINE_MS;

// After:
const timeout = deadlineMs === Infinity
    ? undefined // no timer at all
    : (Number.isFinite(deadlineMs) && (deadlineMs as number) > 0 ? deadlineMs as number : SERVICE_REQUEST_DEADLINE_MS);
```

Rejected alternatives: `0` is already meaningful ("use the default") and reusing it for the
opposite meaning would silently change behavior anywhere a caller passes `0` by accident. A new
string literal (`"none"`) would need a second type threaded through `ProviderRequest`/`request()`
signatures purely for this one flag. `Infinity` needs no new type, structured-clones correctly
across the `MessagePort` (verified: the structured clone algorithm handles `Infinity` like any other
IEEE-754 double — it is not JSON, so there is no `JSON.stringify` round trip to lose it), and already
fails the **old** guard, which is exactly the evidence that adopting it is not accidentally
compatible with any existing caller — every current caller that would hit the old fallback path
keeps doing so; only call sites that are updated to pass `Infinity` explicitly get the new behavior.

**The sentinel's failure mode is itself a reason to choose it, and is worth stating outright rather
than leaving implicit.** Because `Infinity` fails the *old*, unmodified guard
(`Number.isFinite(deadlineMs) && deadlineMs > 0`), any call site this task's implementer misses —
or any future call site that forgets to special-case it — does not silently produce an unkillable
read. It falls back to `SERVICE_REQUEST_DEADLINE_MS`, i.e. **today's behavior**: the read fails after
10 s instead of hanging forever. An incomplete rollout of this task degrades to the status quo, not
to a new failure mode. This is not incidental — it is the reason `Infinity` was chosen over, say, a
sentinel that the old guard would treat as "valid and enormous" (which would hang forever if a call
site were missed). A later reader tempted to "clean up" the three-way branch in decision 2 into
something that treats `Infinity` uniformly with other numbers should know this asymmetry is
deliberate and must be preserved.

`assets/module-service-host.mjs`'s `withDeadline()` (site 3) does not need this sentinel — see
decision 4 below, it is removed entirely for the two content operations rather than special-cased.

### 3. Passing the sentinel down for exactly two operations

`ProxyProvider.request()` (`ProxyProvider.ts:112-132`) gains a `deadlineMs` argument, applied only
by `readBinary()` and `fetchRange()`:

```ts
async readBinary(): Promise<Buffer> {
    const result = await this.request("readBinary", {}, Infinity);
    // ...unchanged validation...
}

private async fetchRange(range: { start: number; end: number }, signal?: AbortSignal): Promise<Buffer> {
    const result = await this.request("readRange", { range }, Infinity, signal);
    // ...unchanged validation...
}
```

`writeBinary()`, `stat()`, and `watch()`'s underlying `request()` calls pass no `deadlineMs` (or
`undefined`), keeping the 10 s default exactly as today.

### 4. Host side: two independent timers to remove for `readBinary`/`readRange`, an `AbortController` to add

`handleRendererRequest()` (`module-service-host.mjs:327-361`) currently always starts the **outer**
per-request timer (`:344-351`) before dispatching. It is changed to skip that timer for
`readBinary`/`readRange`, creating an `AbortController` in its place:

```js
const isContentRead = request.operation === "readBinary" || request.operation === "readRange";
const controller = isContentRead ? new AbortController() : undefined;
const timer = isContentRead ? undefined : setTimeout(() => {
    if (!lease.pending.delete(message.requestId)) return;
    postRenderer(lease.port, {
        kind: "response",
        requestId: message.requestId,
        result: providerFailure("provider-failed", "Provider operation timed out."),
    });
}, deadlineMs);
lease.pending.set(message.requestId, { timer, controller, operation: request.operation });
void executeProviderRequest(lease, request, controller).then(/* unchanged */);
```

`executeProviderRequest(lease, request, controller)` gains the `controller` parameter and, in the
`readBinary`/`readRange` branches only, calls the implementation **without** `withDeadline()` and
passes the signal as an extra argument the implementation may ignore:

```js
if (request.operation === "readBinary") {
    const data = await Promise.resolve(implementation.readBinary(request.config, { signal: controller?.signal }));
    // ...unchanged validation...
}
if (request.operation === "readRange") {
    if (typeof implementation.readRange !== "function") { /* unchanged */ }
    const data = await Promise.resolve(
        implementation.readRange(request.config, request.range, { signal: controller?.signal }),
    );
    // ...unchanged validation...
}
```

`writeBinary`/`stat`/`watch*` branches are untouched — they keep calling through `withDeadline()`
exactly as today.

**Why both an `AbortSignal` and unconditional discarding, not one or the other (answers the task's
open question directly):** the fixture board's own `stall` implementation
(`persephone-boards/_test/range-provider-test/scripts/service.mjs`, `applyControls()`) is
`return new Promise(() => {})` — a promise that **never** settles and never inspects any signal.
**No cancellation design that depends on the board's implementation cooperating can pass this task's
own acceptance scenario**, because the fixture that defines the scenario is written not to
cooperate. So the platform-side discard (freeing `lease.pending`'s slot and, on the renderer side,
`client.pending`'s slot — see below) is the part that **must** work unconditionally; the
`AbortSignal` is offered so a well-behaved provider (a real torrent client, unlike this fixture) can
stop real work early, but nothing on the release path may depend on it being honored. This resolves
the task's question "does the board get a signal, is the result discarded, or both" as **both, with
discarding load-bearing and the signal a courtesy**.

**The contract for a board author, stated precisely for the guide text (decision-4 follow-through,
not deferred to "Files Changed"): honoring the signal is optional; tolerating its presence is
mandatory.** Concretely:

- An implementation written before this task (two-argument `readRange(config, range)`, one-argument
  `readBinary(config)`) keeps working exactly as before — the platform now calls it with one extra
  trailing argument it has never declared and therefore never reads. This is why the typing change
  must be **additive** (a new optional parameter appended at the end, never a change to an existing
  parameter's position or type): `board-api.d.ts`'s `register()` implementation shape widens
  `readRange?(config, range, options?: { signal?: AbortSignal })` and
  `readBinary(config, options?: { signal?: AbortSignal })`, and both existing two/one-argument
  implementations still typecheck against these signatures without modification.
- An implementation that chooses to honor the signal gets something concrete for the effort: it can
  abort a real in-flight operation — closing a socket, canceling a torrent piece request, aborting an
  `AbortController`-aware `fetch()` — the moment Persephone stops waiting, instead of that work
  running to completion (or forever, for a genuinely stalled source) with nobody left to receive the
  result. This is the difference between "the platform stops waiting" (guaranteed, by this task,
  regardless of the board) and "the underlying work actually stops" (only if the board wires the
  signal through to it).
- A board that ignores the signal is not broken and is not penalized: this is exactly the fixture's
  own `stall` behavior (`new Promise(() => {})`, never inspects anything) and this task's acceptance
  criteria are written to pass against that fixture unmodified.

`assets/guides/boards.md`'s new paragraph (Files Changed, below) states this contract in those terms
rather than only documenting the new parameter's shape.

### 5. The wire cancel message

New `RendererServiceMessage` variant (`module-service-channels.ts`), renderer→host only, no
response expected:

```ts
export type RendererServiceMessage =
    | { kind: "hello"; generation: number; leaseNonce: string }
    | { kind: "hello-ack"; generation: number; leaseNonce: string }
    | { kind: "request"; requestId: string; message: unknown }
    | { kind: "cancel"; requestId: string }               // NEW
    | { kind: "response"; requestId: string; result?: unknown; error?: unknown }
    | ProviderEvent
    | ProviderCapabilities
    | { kind: "lease-lost"; reason: RendererLeaseLostReason };
```

Host side, inside `attachRenderer()`'s existing `port.on("message", ...)` (`:378-397`), add a branch
before the fallthrough to `handleRendererRequest`:

```js
if (nested.kind === "cancel" && typeof nested.requestId === "string") {
    const pending = lease.pending.get(nested.requestId);
    if (pending) {
        if (pending.timer) clearTimeout(pending.timer);
        lease.pending.delete(nested.requestId);
        pending.controller?.abort();
    }
    return;
}
```

No response is sent for a cancel — the renderer has already settled its side locally (see below) by
the time it sends this message, so any eventual host-side settlement of the (now discarded, and
possibly never-resolving) implementation promise is inert: `finishProviderRequest()`
(`:319-325`) already no-ops when `lease.pending.get(requestId)` is missing, which is exactly the
state after a cancel.

### 6. Renderer side: `moduleService` gains cancellation, `ProxyProvider` and the pipe chain thread an `AbortSignal`

`module-service.ts`'s `request()` gains an optional `signal`:

```ts
function request(
    boardRoot: string,
    message: unknown,
    deadlineMs?: number,
    signal?: AbortSignal,
): Promise<unknown> {
    // ...existing setup through requestId, timeout computation (decision 2)...
    return new Promise<unknown>((resolve, reject) => {
        const timer = timeout === undefined ? undefined : setTimeout(() => {
            client.pending.delete(requestId);
            reject(errorForCode("service-timeout"));
        }, timeout);
        const onAbort = (): void => {
            if (!client.pending.delete(requestId)) return;
            if (timer) clearTimeout(timer);
            reject(errorForCode("provider-cancelled"));
            if (client.port && client.state === "attached") {
                try {
                    client.port.postMessage({ kind: "cancel", requestId } satisfies RendererServiceMessage);
                } catch {
                    // The port may already be gone; loseLease() will have rejected this already.
                }
            }
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        client.pending.set(requestId, { resolve, reject, timer });
        // ...unchanged acquire()/postMessage logic; on normal settlement, remove the abort listener too...
    });
}
```

(`"provider-cancelled"` is added to `lifecycleCodes` in the same file, alongside the existing set at
`:56-68`, so `errorForCode`/`errorCode` round-trip it the same way every other lifecycle error does.)

`ProxyProvider.request()` (`ProxyProvider.ts:112-132`) widens to accept and forward `deadlineMs` and
`signal`:

```ts
private async request(
    operation: ProviderOperation,
    extras: Partial<Pick<ProviderRequest, "subscriptionId" | "data" | "range">> = {},
    deadlineMs?: number,
    signal?: AbortSignal,
): Promise<Extract<ProviderResult, { ok: true }>> {
    // ...unchanged body, forwarding deadlineMs/signal into moduleService.request(...)...
}
```

`readBinary()` calls `this.request("readBinary", {}, Infinity)` — **no signal**, because
`IProvider.readBinary()` (`io.provider.d.ts:40`) has no options parameter today and this task does
not widen it (see "Not doing" below): the buffered whole-resource path has exactly one caller shape
(`ContentPipe.readBinary()` → `provider.readBinary()`), and none of the buffered-path callers
(`readBuffered()` in `board-pipe-handler.ts`, `BoardEditorModel.ts`'s cache materialization) track a
per-call cancellation token today — they key cancellation off the **page**, and a page-level cancel
for the buffered path is satisfied by not caring about the eventual settlement (the same "discard,
don't depend on cooperation" answer as decision 4), which needs no signal at all: dropping interest
in the `Promise` and letting the request time out **never** — i.e., leaking one `client.pending`
slot for the life of the board's service — is not acceptable, so buffered-path cancellation instead
happens by boardRoot-wide cancellation on the same trigger as ranged-path cancellation; see decision
7's "what actually calls cancel" for the exact mechanism, which covers both.

`createReadStream()`/`fetchRange()` **do** get a signal, because `board-pipe-handler.ts` already
creates one stream per bounded chunk request and is already tracking that request individually in
its own `pendingReads` map — the natural place to hold an `AbortController` per in-flight chunk:

```ts
// IProvider (io.provider.d.ts) — range stays the same shape; add an options param.
createReadStream?(
    range?: { start: number; end: number },
    options?: { signal?: AbortSignal },
): NodeJS.ReadableStream;

// IContentPipe (io.pipe.d.ts) — same widening.
createReadStream(range?: { start: number; end: number }, options?: { signal?: AbortSignal }): NodeJS.ReadableStream;
```

`ContentPipe.createReadStream()` forwards `options` to `provider.createReadStream(range, options)`
when delegating directly (`ContentPipe.ts:77-80`); its own buffered fallback (`:82-91`, used when
transformers are present) ignores `options` — acceptable, because a transformed board pipe already
falls back to `readBinary()`'s buffered path, covered by the boardRoot-wide mechanism above, not
per-chunk cancellation.

`FileProvider.createReadStream()`/`HttpProvider.createReadStream()` ignore the new second parameter
(no behavior change; `fs.createReadStream` even accepts a `signal` option natively, but wiring that
up is out of scope — these are not board providers and are not part of D6's problem).

`ProxyProvider.buildRangeStream()`/`fetchRange()` accept and forward the signal:

```ts
get createReadStream(): ((range?, options?) => NodeJS.ReadableStream) | undefined {
    if (!this.rangeReadable) return undefined;
    return (range, options) => this.buildRangeStream(range, options?.signal);
}

private buildRangeStream(range?: { start: number; end: number }, signal?: AbortSignal): NodeJS.ReadableStream {
    const fetched = range ? this.fetchRange(range, signal) : this.readBinary();
    // ...unchanged Readable.from wrapper...
}
```

### 7. `board-pipe-handler.ts`: an `AbortController` per pending chunk read, aborted on page invalidation

`PendingRead` gains a controller and the operation stops relying on the boolean alone:

```ts
interface PendingRead {
    pageId: string;
    cancelled: boolean;
    controller: AbortController;
}
```

`handleRequest()` creates the controller and passes it through to `readChunk()`, which threads it
into `pipe.createReadStream(boundedRange, { signal: pending.controller.signal })`:

```ts
function handleRequest(rawRequest: unknown): void {
    // ...unchanged guard...
    const pending: PendingRead = { pageId: request.pageId, cancelled: false, controller: new AbortController() };
    pendingReads.set(request.requestId, pending);
    void readChunk(request, pending.controller.signal)
        .then(/* unchanged */)
        .catch(/* unchanged */)
        .finally(/* unchanged */);
}
```

`readChunk(request, signal)` passes `signal` into the `hasDirectStream(pipe)` branch only:

```ts
const data = hasDirectStream(pipe)
    ? await collectChunk(pipe.createReadStream(boundedRange, { signal }))
    : (await readBuffered(pipe, memo)).subarray(boundedRange.start, boundedRange.end + 1);
```

`invalidateBoardPipePage()` calls `.abort()` before deleting:

```ts
export function invalidateBoardPipePage(pageId: string): void {
    pipeMemos.delete(pageId);
    for (const [requestId, pending] of pendingReads) {
        if (pending.pageId !== pageId) continue;
        pending.cancelled = true;
        pending.controller.abort();
        pendingReads.delete(requestId);
    }
}
```

This closes the exact leak traced above: aborting the signal fires `onAbort` inside
`module-service.ts`'s `request()` (decision 6), which rejects and removes the `client.pending`
entry and sends `{kind:"cancel", requestId}` to the host, which removes `lease.pending`'s entry and
best-effort aborts the board's implementation (decision 4/5). `collectChunk()`'s `for await` loop
(`:132-145`) also stops cleanly: the stream produced by `Readable.from` is not itself destroyed by
this path (aborting `fetched`'s underlying request doesn't reach into the generator), but since the
promise it's awaiting now rejects (once `readRange`'s `request()` call rejects with
`provider-cancelled`), the generator throws, `collectChunk`'s `for await` throws, and `readChunk()`'s
promise rejects — landing in `handleRequest()`'s `.catch()`, which is already guarded by
`pendingReads.get(...) === pending` and correctly no-ops since the entry was already deleted by
`invalidateBoardPipePage()`.

**The buffered path (`readBuffered()` → `pipe.readBinary()`) is not given a per-request signal** (see
decision 6). Its cancellation is coarser: the boardRoot-wide mechanism below.

### 7a. Supersession — an abandoned chunk request must cancel itself even when the page stays open

**Section 7's `AbortController` is aborted only by `invalidateBoardPipePage()`, i.e. only on page
close. That is not enough, and leaving it there would make the uncounted pool (decision 9) unsafe.**
Traced concretely: a `<video>` element playing a pipe-backed file (US-1519, but the mechanism below
is `board-protocol-service.ts`, which already exists today) seeks by issuing a **new** HTTP `Range`
request; Chromium does not wait for the previous one to finish — it abandons it. Each `Range`
request drives `serveBoardPipe()` (`board-protocol-service.ts:290-384`), whose `ReadableStream`
`start(controller)` callback loops, calling `boardPipeService.read(host, pageId, undefined, {start,
end})` (`:357-362`) for each successive chunk and awaiting it before enqueuing and asking for the
next. **Today this `ReadableStream` declares no `cancel()` handler**, and the code never reads
`request.signal` (the inbound `GlobalRequest`'s own abort signal) — both checked directly against
`board-protocol-service.ts`'s full text. When Chromium abandons the HTTP request, nothing here is
told. The `while` loop keeps awaiting whatever `boardPipeService.read()` call it last issued,
indefinitely once this task removes the deadline — on a page that is still open, so `invalidateBoardPipePage()`
never runs, and the reads accumulate at the pace of scrubbing.

**This is a genuine gap in the current source**, confirmed by reading `board-pipe-service.ts` and
`board-protocol-service.ts` line by line: `boardPipeService.read()` (`:60-92`) has no cancellation
parameter, and `serveBoardPipe`'s stream has no `cancel` algorithm. Without a fix, decision 9's
"every content read is guaranteed to end" claim is false for exactly this case — a chunk request
whose *consumer* (the HTTP client / Chromium) has moved on, but whose *page* has not closed.

**Resolution — wire both signals the Web platform offers for this, propagated down the same
requestId used throughout this document:**

`board-pipe-service.ts`'s `read()` gains an optional `AbortSignal`:

```ts
read(
    host: string,
    pageId: string,
    rangeHeader?: string,
    range?: ByteRange,
    signal?: AbortSignal,
): Promise<BoardPipeReadReply> {
    // ...unchanged owner lookup and requestId/request construction...
    if (signal?.aborted) return Promise.reject(new BoardPipeError(503, "Board pipe read was cancelled."));
    return new Promise<BoardPipeReadReply>((resolve, reject) => {
        const pending: PendingRead = { pageId, webContents: owner.webContents, resolve, reject };
        this.pending.set(requestId, pending);
        const onAbort = (): void => {
            if (!this.pending.delete(requestId)) return;
            reject(new BoardPipeError(503, "Board pipe read was cancelled."));
            try {
                owner.webContents.send(BOARD_PIPE_CANCEL_CHANNEL, { requestId } satisfies BoardPipeCancelMessage);
            } catch {
                // The renderer may already be gone; nothing left to cancel.
            }
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        try {
            owner.webContents.send(BOARD_PIPE_READ_CHANNEL, request);
        } catch (error) {
            this.pending.delete(requestId);
            reject(new BoardPipeError(503, "The board renderer is unavailable."));
        }
    });
}
```

(`handleReply()` should also remove the abort listener on normal settlement so it doesn't fire late
against a reused signal; a `WeakMap`/closure-local flag is enough — implementation detail, not a
design question.)

New wire message, `src/ipc/board-pipe-channels.ts`:

```ts
export const BOARD_PIPE_CANCEL_CHANNEL = "board-pipe:cancel" as const;
export interface BoardPipeCancelMessage { requestId: string }
```

`board-pipe-handler.ts` listens for it (alongside its existing `BOARD_PIPE_READ_CHANNEL` listener in
`initBoardPipeHandler()`) and aborts the **one matching** `pendingReads` entry — not the whole page:

```ts
function handleCancel(rawMessage: unknown): void {
    const message = rawMessage as BoardPipeCancelMessage | undefined;
    if (!message || typeof message.requestId !== "string") return;
    const pending = pendingReads.get(message.requestId);
    if (!pending) return;
    pending.cancelled = true;
    pending.controller.abort();
    pendingReads.delete(message.requestId);
}
```

`board-protocol-service.ts`'s `serveBoardPipe()` creates **one `AbortController` per HTTP request**
(covering both the first read, done before the stream exists, and every continuation read inside the
stream's loop), aborts it from **two** sources — the inbound request's own signal, and the
`ReadableStream`'s `cancel()` algorithm (the Streams-spec-defined callback invoked when the stream's
consumer stops reading it, which is the mechanism that fires when Chromium abandons an in-flight
response body) — and passes its signal into every `boardPipeService.read(...)` call:

```ts
async function serveBoardPipe(host: string, pageId: string, rangeHeader: string | undefined, requestSignal?: AbortSignal): Promise<Response> {
    const abort = new AbortController();
    requestSignal?.addEventListener("abort", () => abort.abort(), { once: true });

    let first: BoardPipeReadReply;
    try {
        first = await boardPipeService.read(host, pageId, rangeHeader, undefined, abort.signal);
    } catch (error: unknown) { /* unchanged */ }
    // ...unchanged validation of `first`...

    const body = new ReadableStream<Uint8Array>({
        start(controller) {
            void (async () => {
                try {
                    controller.enqueue(first.data);
                    let nextStart = first.range!.end + 1;
                    while (nextStart <= requestedRange.end) {
                        if (abort.signal.aborted) return; // consumer gone; stop asking for more
                        const nextEnd = Math.min(requestedRange.end, nextStart + MAX_BOARD_PIPE_CHUNK_BYTES - 1);
                        const chunk = await boardPipeService.read(host, pageId, undefined, { start: nextStart, end: nextEnd }, abort.signal);
                        // ...unchanged validation and enqueue...
                    }
                    controller.close();
                } catch (error: unknown) {
                    if (abort.signal.aborted) return; // cancellation, not a real failure — nothing to report
                    controller.error(new Error(errMessage(error, "Board pipe unavailable.")));
                }
            })();
        },
        cancel(reason) {
            abort.abort(reason);
        },
    });
    return new Response(body, { status, headers });
}
```

`serveBoardFile()`'s call site passes `request.signal` through:
`serveBoardPipe(host, pageId, request.headers.get("Range") || undefined, request.signal)`.

**This closes the exact scenario named in the correction**, using the same requestId-based
cancel-and-discard pattern this document already establishes for page-close (section 7) and the
module-service wire (sections 5-6) — no new design vocabulary, just one more trigger feeding the
same `AbortController`s.

**Honesty about what could not be verified by reading source alone:** whether `ReadableStream`'s
`cancel()` algorithm and `GlobalRequest.signal` actually fire, in Electron's `protocol.handle`
implementation, when Chromium's own network layer abandons an in-flight request to a custom
protocol, is standard Web Streams/Fetch behavior (the spec requires a stream's underlying source to
receive `cancel()` when its consumer disconnects) but **is a runtime guarantee of Electron's
implementation, not something this repository's TypeScript source proves**. `electron.d.ts`'s
`protocol.handle()` JSDoc (checked directly) does not document this behavior either way. **The
implementer must confirm this empirically** before treating decision 9's uncounted pool as fully
safe: open the fixture as a `stream-host` page (or, once available, a real video), issue several
rapid seeks against a slow/stalled resource, and confirm via the fixture's counters that abandoned
chunk requests are actually cancelled (their `readRange` calls stop appearing as still-outstanding)
rather than merely superseded in the UI while continuing to run underneath. If empirical testing
shows `cancel()`/`request.signal` do **not** fire for this case, the fallback is *not* to add a cap,
high-water mark, or warning threshold back onto content reads — that would reintroduce exactly the
arbitrary number D6 removed the deadline to get rid of. The fallback is to find whichever signal
Electron *does* expose for this case (a `close`/`aborted` event on `request` itself is one candidate
under the Fetch API), and if none exists, to record the accumulation as a named, bounded limitation
in Concerns below rather than silently reintroducing a cap.

### 8. Boardroot-wide cancellation for the buffered path and for anything else still outstanding when a board is fully torn down

Two triggers already exist that should cancel **every** outstanding content read for a board root,
not just one page's: `loseLease()` and app quit already do this unconditionally for all of
`client.pending` (see "Service-process-death" above) — no new code needed there, since a rejected
`client.pending` entry is exactly what a `readBinary()` caller is awaiting, whether or not it had a
signal. The only genuinely new gap this section closes is: **a page closes while its buffered
`readBinary()` read (not a ranged chunk) is still outstanding, and no other page of the same board
is affected.** Given `readBuffered()`'s memo is per-page (`pipeMemos.get(request.pageId)`,
`board-pipe-handler.ts:159-163`), and a buffered read is the **whole resource** (not a chunk), this
case is rarer in practice (a stalled buffered read only happens for a `test/norange`-shaped provider
with no ranging at all) but must still be closed for D6 to hold universally. Resolution: give
`readBuffered()`'s `pipe.readBinary()` call the **same per-page `AbortController`** used for ranged
chunks, by widening `IProvider.readBinary()` to accept the same `{ signal }` options object as
`createReadStream` (a smaller, consistent change instead of the "not doing" carve-out floated
earlier in this document — corrected here for internal consistency):

```ts
// io.provider.d.ts
readBinary(options?: { signal?: AbortSignal }): Promise<Buffer>;
```

`ContentPipe.readBinary()` forwards it; `ProxyProvider.readBinary(options?)` forwards `options?.signal`
into `this.request("readBinary", {}, Infinity, options?.signal)`; `readBuffered()` in
`board-pipe-handler.ts` passes `pipe.readBinary({ signal: pending.controller.signal })` using the
**same controller already created in `handleRequest()`** for that page's current chunk request —
correct because `readBuffered()`'s memo is per-page, so only one buffered read is ever in flight per
page at a time, and `invalidateBoardPipePage()` already aborts that page's live controller.
`FileProvider.readBinary()`/`HttpProvider.readBinary()` ignore the new options param, unaffected.

### 9. Accounting split — resolving the actual risk found in "Correcting D6's shared-budget claim"

`client.pending` (renderer) and `lease.pending` (host) each split their **cap enforcement**, not
their storage, by operation kind. Both maps stay single `Map`s (no new data structure), but the
32-slot check only counts **control** operations (`writeBinary`, `stat`, `watchSubscribe`,
`watchUnsubscribe`); `readBinary`/`readRange` entries are stored in the same map (for the existing
lease/reject/loseLease code paths to keep working unconditionally over "the whole map") but are
**not counted** against the cap:

```ts
// module-service.ts — request(), replacing the existing cap check
const isContentRead = (message as ProviderRequest)?.operation === "readBinary"
    || (message as ProviderRequest)?.operation === "readRange";
if (!isContentRead) {
    const controlCount = [...client.pending.values()].filter((p) => !p.isContentRead).length;
    if (controlCount >= MAX_OUTSTANDING_REQUESTS_PER_SERVICE) {
        return Promise.reject(errorForCode("service-busy"));
    }
}
```

(`PendingRequest` gains an `isContentRead: boolean` field set at insertion.) The mirrored change
applies to `handleRendererRequest()`'s `lease.pending.size >= requestCap` check
(`module-service-host.mjs:340-343`), filtering the same way.

**Why an uncounted pool rather than a second, separately-capped pool:** a hard cap on content reads
would reintroduce exactly the problem D6 removed the deadline to avoid — an arbitrary number that
has no relationship to how many files a user or a torrent board's own logic legitimately wants open
at once (D7: per-page, per-resource concurrency must not be foreclosed). Since content reads no
longer have a timer that could leak indefinitely without a release path (this task's whole point),
an unbounded count is safe: every content read is now guaranteed to end via page-close,
board-provider-deletion, service-crash/untrust/quit, an abandoned HTTP request (section 7a), or
explicit cancel — never silently. The 32-slot cap keeps protecting what it always protected — a
runaway number of **quick control calls** — while no longer being incidentally exhausted by
long-lived reads.

**This safety argument depends on section 7a, not on page-close alone.** Page-close cancels every
outstanding read for a page at once, but a page can accumulate unbounded reads on its own without
ever closing — a `<video>` scrubbing a stalled source issues a fresh chunk request per seek, and
Chromium abandons the previous one without closing the page. Section 7a closes that gap by wiring
the abandoned request's own cancellation (the `ReadableStream`'s `cancel()` algorithm and the
inbound `Request`'s `signal`) into the same per-`requestId` `AbortController` page-close already
uses. If section 7a's mechanism turns out not to fire reliably (see its "Honesty about what could
not be verified" note), this uncounted-pool argument no longer holds for the video-scrub case, and
that must be recorded as a named limitation rather than patched over with a cap.

**Main's `record.requests` (control-plane, `persephone.service.request()`) needs no accounting
change** — confirmed above it never carries content reads, so its existing single-pool 32-cap
already does exactly what it always did, unaffected by anything else in this task.

### 10. Visibility — "a board can know a read is outstanding" (D6's explicit, not-retrofittable requirement)

**The board's own service code already knows, trivially: it is the thing executing
`readRange`/`readBinary` while the platform waits.** Nothing new is needed for the board's *service*
to observe that a read of its own is in flight — it is inside that very call. What does not yet
exist is a way for **the app side (the page, or a future EPIC-114 "waiting for peers" indicator)** to
know a content read is outstanding, without polling or guessing from a lack of response.

Following the task's instruction to prefer something already on the wire: **reuse the
`provider-capabilities` announcement's existing update mechanism, not its message shape.** Add one
more field, computed and pushed the same way `writable`/`rangeReadable` already are — but as a
**count that changes as content reads start and finish**, not a static capability flag. Concretely:

- Host side (`module-service-host.mjs`): track `activeContentReads` per `(lease)` (a single number
  covers the whole service; per-`type` granularity is not needed — nothing in the epic asks for it,
  and D6's own text says "a board" is waiting, not "a specific resource"). Increment it in
  `handleRendererRequest()` when accepting a `readBinary`/`readRange` request, decrement it in
  `finishProviderRequest()` and in the new cancel handler (decision 5). Reuse the **existing**
  `postRenderer(lease.port, {...})` transport (no new IPC channel) to push
  `{ kind: "content-read-count", count }` whenever the count changes.
- Renderer side (`module-service.ts`): a new `RendererServiceMessage` variant
  `{ kind: "content-read-count"; count: number }`, stored per client
  (`client.activeContentReads: number`), exposed via `moduleService.activeContentReads(boardRoot): number`
  — a plain getter, mirroring `providerWritable()`/`providerRangeReadable()`'s existing shape exactly
  (no new subscription primitive to build; a consumer that wants live updates reads the getter
  inside whatever polling/render loop it already has, the same way `app.boards.list()`'s
  `service.state` is already consumed).

This satisfies "prefer something already on the wire" literally: no new channel, no new transport —
one more field on the announcement message type that already exists for exactly this purpose
(telling the renderer something changed about a board's service), and one more getter next to two
that already exist. Building the actual "waiting for peers" UI is explicitly EPIC-114's problem
(per D6); this task only has to make the number available, which it now is.

## Files needing NO changes (verified — do not re-investigate)

- `src/main/module-service-supervisor.ts`'s `request()` / `record.requests` / `record.pendingRequestSlots`
  — confirmed above to never carry a content read; the control-plane pool for
  `persephone.service.request()` / `app.boards.requestService()` is untouched.
- `src/ipc/main/board-handlers.ts` / `src/main/board-bridge.ts` — the control-plane RPC surface;
  unaffected.
- `src/main/module-service-storage.ts` — `persephone.storage.*`'s own request map
  (`ModuleServiceStorageAdapter.pending`), which shares main's combined budget with `record.requests`
  via `getOutstandingRequestCount()` (see "the third pool," in "Correcting D6's shared-budget claim"
  above) — confirmed control-plane traffic, unrelated to provider reads, unaffected by this task.
- `src/renderer/api/module-service-status.ts` — status snapshot fetch; correctly keeps
  `SERVICE_REQUEST_DEADLINE_MS`, this is D6's own "status" example of what must keep a deadline.
- `src/renderer/content/registry.ts` — its `SERVICE_REQUEST_DEADLINE_MS` usage wraps provider
  *availability* waits, not the content read itself; traced and confirmed above.
- `src/renderer/api/capability-bus.ts`, `board-shim.ts`'s capability `deadlineMs`,
  `BoardWebview.ts:919` — a wholly separate, pre-existing deadline mechanism for capability
  invocations; not shared code with `module-service.ts`.
- `src/renderer/content/providers/FileProvider.ts`, `HttpProvider.ts` — never go through
  `ProxyProvider`/the module-service wire; the new `options` parameters on `IProvider` methods are
  optional and both files can ignore them with zero behavior change.
- `src/main/board-protocol-service.ts` — the existing bounded-pull continuation loop
  (`board-pipe-handler.ts`'s caller); it drives per-chunk requests over IPC to the renderer and is
  unaffected by what happens *inside* one chunk's resolution.
- `src/renderer/editors/board/board-manifest.ts`, `custom-editor-registry.ts` — no manifest field is
  added or changed by this task; the sentinel and cancellation are runtime-only, exactly like
  `writable`/`rangeReadable` before them.

## Concerns / open questions

- **Section 7a's cancellation trigger (`ReadableStream.cancel()` / `Request.signal` firing when
  Chromium abandons an in-flight `board://` protocol response) is standard Web Streams/Fetch
  behavior but is not verified against this repository's Electron version by running the app.** This
  is the one genuinely open item this document could not close by reading source alone — see 7a's
  "Honesty about what could not be verified." The implementer must smoke-test it (rapid seeks against
  a slow/stalled fixture resource, confirming abandoned chunk reads actually stop rather than merely
  going unobserved) before relying on the uncounted content-read pool (decision 9) as fully safe for
  the video-scrub scenario. If it does not fire, the resolution is to find an alternative Electron
  signal for the same event, or to record the accumulation as a named, bounded limitation — not to
  reintroduce a cap on content reads.
- **Whether `Infinity` survives structured clone across the `MessagePort` was verified conceptually
  from the structured clone algorithm's handling of IEEE-754 doubles (it is not a JSON transport);
  this document did not run the app to confirm it byte-for-byte over the real port. Flagged for the
  implementer to smoke-test in the running app before relying on it (open the stall fixture, confirm
  the read genuinely never times out, rather than trusting this reasoning alone).**
- **The host-side `activeContentReads` counter (decision 10) is scoped to the whole lease, not per
  resource/type.** If EPIC-114 later needs "which specific file is stalled," that is additional,
  separate wiring (likely inside the board's own UI, which already knows exactly what it's waiting
  on) — not a gap in this task, since D6 only asks that "a board can know **a** read is outstanding."

## Acceptance criteria

Maps to EPIC-113's global acceptance items 6 and 7; the fixture board's `stall=1` scenario is the
primary verification vehicle, per its own README's "Known limitation" section, which names this
task by number as the thing that closes it.

1. **Fixture `stall=1` scenario, small resource:** opening
   `rangetest://fixture/notes.rangefix?stall=1` (or the fixture's own "Stall indefinitely" console
   button) results in a read that is still pending well past 10 s (verified by waiting at least
   15 s and confirming no `503`/timeout has been returned) — where today it fails at ~10 005 ms per
   the epic's own measurement.
2. **Closing the page releases it promptly.** With the stalled scenario's page open and its read
   still outstanding, closing the page causes (observable via the fixture's counters/`lastRanges`
   and via `moduleService`'s new `activeContentReads` getter) the corresponding `client.pending` and
   `lease.pending` entries to be removed within a short, bounded time (not 10 s) — a `{kind:"cancel"}`
   message was sent and the host's `lease.pending` size decremented accordingly.
3. **Several stalled reads outstanding, board control still works.** With several `stall=1` pages of
   the same fixture board open simultaneously (enough to have previously approached the 32-slot
   cap under the pre-fix, single-pool accounting — this needs at least ~32 concurrent stalled reads
   to be a meaningful stress test, or a temporarily lowered test cap), `persephone.service.request({op:"counters"})`
   (the fixture's own control-plane call) and a fresh `stat()` against the fixture's **other**,
   non-stalled provider (`test/norange`, or the same provider with different query params) both
   still succeed — proving the accounting split in decision 9, not just the absence of the epic's
   originally-assumed (and corrected) shared-map trap.
4. **A resource with `delay` but no `stall` still completes correctly** (regression check: the
   non-stalled path, including the fixture's own delay/size scenarios and the existing US-1474
   acceptance items 1-9, all still pass after this task's changes to `executeProviderRequest()` and
   `handleRendererRequest()`).
5. **`writeBinary`/`stat`/`watch*` still enforce the 10 s deadline** — verified via a temporary hung
   `stat()` (or by inspection, since the code path for these operations is explicitly unchanged by
   this task) failing at ~10 s exactly as before.
6. **Service crash while a content read is outstanding still rejects it immediately** (not after
   10 s, since there is no longer a timer to wait out) — verified by triggering the fixture's
   `{op:"crash"}` control message (from `assets/demo-board`'s pattern, or adding one to the fixture)
   while a `stall=1` read is outstanding, confirming the read rejects at the moment of crash
   detection, not later.
7. **Supersession (section 7a): scrubbing a stalled `stream-host` page does not accumulate pending
   reads.** Open a `stall=1`/`delay`-heavy fixture scenario as a `stream-host` page, issue several
   rapid `Range` requests against it (simulating `<video>` seeking — e.g. repeated `fetch()` calls
   with different `Range` headers against the page's own `board://.../__pipe/...` URL, superseding
   each other), and confirm — via the fixture's `readRange` call counter and via
   `moduleService.activeContentReads(boardRoot)` — that abandoned reads are cancelled rather than
   accumulating, **without the page ever closing**. This is the scenario the "MUST FIX — supersession"
   correction named directly, and it must pass without any cap on content reads.

## Files Changed

| File | Change |
|---|---|
| `src/ipc/module-service-channels.ts` | New `RendererServiceMessage` variant `{kind:"cancel", requestId}`; new `content-read-count` variant; new lifecycle-adjacent error code `provider-cancelled` documented (added to the renderer's own `lifecycleCodes`, not this file's `ProviderWireErrorCode`, since it never crosses as a `ProviderResult` — it's synthesized locally on cancel) |
| `src/renderer/api/module-service.ts` | `Infinity` sentinel handling in `request()`'s timeout computation; `signal` param on `request()`; `onAbort` wiring + `{kind:"cancel"}` postMessage; `PendingRequest.isContentRead` + cap-check filtered by it; `client.activeContentReads` field + `providerActiveContentReads()`/`moduleService.activeContentReads()`; `"provider-cancelled"` added to `lifecycleCodes` |
| `assets/module-service-host.mjs` | `handleRendererRequest()`: skip the outer timer and create an `AbortController` for `readBinary`/`readRange`; new `"cancel"` branch inside `attachRenderer()`'s port listener; `lease.pending` cap check filtered to control operations; `activeContentReads` counter + `content-read-count` push on change; `executeProviderRequest()`: drop `withDeadline()` for `readBinary`/`readRange`, pass `{signal}` as an extra argument to both implementations |
| `src/main/module-service-supervisor.ts` | No change (see "Files needing NO changes") |
| `src/renderer/content/providers/ProxyProvider.ts` | `request()` gains `deadlineMs`/`signal` params; `readBinary()` passes `Infinity` + forwards a caller `signal`; `fetchRange()`/`createReadStream` getter accept and forward `signal` |
| `src/renderer/api/types/io.provider.d.ts` | `readBinary(options?: {signal?})`; `createReadStream?(range?, options?: {signal?})` |
| `src/renderer/api/types/io.pipe.d.ts` | `IContentPipe.createReadStream(range?, options?: {signal?})` (and `readBinary` if this interface separately declares it — confirm signature at implementation time) |
| `src/renderer/content/ContentPipe.ts` | Forward `options` through `createReadStream()`/`readBinary()` to the underlying provider when delegating directly |
| `src/renderer/editors/board/board-pipe-handler.ts` | `PendingRead.controller: AbortController`; `handleRequest()` creates it; `readChunk()` threads `signal` into `createReadStream()`/`readBinary()`; `invalidateBoardPipePage()` calls `.abort()` before deleting; new `handleCancel()` listening on `BOARD_PIPE_CANCEL_CHANNEL`, aborting one matching `pendingReads` entry by `requestId` (section 7a) |
| `src/ipc/board-pipe-channels.ts` | New `BOARD_PIPE_CANCEL_CHANNEL` + `BoardPipeCancelMessage` (section 7a) |
| `src/main/board-pipe-service.ts` | `read()` gains an optional `signal?: AbortSignal` param; on abort, rejects and removes the pending entry and sends `BOARD_PIPE_CANCEL_CHANNEL` to the owning `webContents` (section 7a) |
| `src/main/board-protocol-service.ts` | `serveBoardPipe()` creates one `AbortController` per HTTP request, wires it from both `request.signal` and the response `ReadableStream`'s new `cancel()` algorithm, and passes its signal into every `boardPipeService.read(...)` call, including the continuation loop (section 7a) |
| `src/renderer/editors/board/board-api.d.ts` | `readBinary(config, options?: {signal?})`, `readRange(config, range, options?: {signal?})` — both additions are optional and backward compatible with existing registered implementations |
| `assets/guides/boards.md` | Document the optional third-argument `signal` on `readRange`/second-argument on `readBinary`; document that a content read now has no deadline and is released by page close, service teardown, or an explicit cancel — a board is not required to honor the signal for correctness |
| `persephone-boards/_test/range-provider-test/README.md` | **Not edited by this task** (separate repo, separate deliverable) — flagged for the implementer to update the fixture's own "Known limitation" section once this ships, so the documented gap doesn't go stale the way `assets/guides/boards.md:965-968` did after US-1474 |

## Not doing (explicitly out of scope, recorded so it isn't rediscovered)

- **Per-resource / per-type visibility granularity** (decision 10's open question) — EPIC-114's
  concern if it turns out to be needed.
- **Real cancellation for `FileProvider`/`HttpProvider`** — the new `signal` option threads through
  their interfaces but neither implementation is changed to actually pass it to `fs.createReadStream`
  or an HTTP abort controller; they are not part of D6's problem (local files and HTTP already
  complete quickly or fail on their own).
- **Changing `record.requests`' cap or timeout** — confirmed unnecessary; see "Correcting D6's
  shared-budget claim."
- **A UI affordance for "waiting for peers"** — explicitly EPIC-114's, per D6's own text.
