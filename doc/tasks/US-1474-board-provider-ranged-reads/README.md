# US-1474: Ranged reads must reach a board-implemented content provider

**Epic:** [EPIC-113](../../epics/EPIC-113.md) — D5, D7, D8, D11, D13 and D14 are binding for this
document; none are re-argued below. Also the pre-committed deferral from
[EPIC-107 D11](../../epics/EPIC-107.md).

## Scope note (read first)

The investigation brief that produced this document explicitly excludes the `_test/` fixture board
that EPIC-113 D13 assigns to US-1474 ("it lives in the separate `persephone-boards` repo and is a
separate deliverable"). **This creates a gap the epic owner should reconcile**: D13's stated reason
for building the fixture under US-1474 is "without a fixture every acceptance item here would wait
on EPIC-114 — defeating the split." Implementing only this document's plan leaves EPIC-113
unverifiable standalone until a fixture board exists somewhere. That fixture is not designed here —
it is a `persephone-boards` repo deliverable and needs its own task in that repo's tracker.

Also out of scope, per the brief: the no-deadline/cancellation work (US-1518 — the new operation
uses today's `SERVICE_REQUEST_DEADLINE_MS` like every other provider operation), and
`persephone.content.open()` (US-1521).

## Goal

Let a range reach a board-implemented content provider running in the module service, so a pipe
backed by that provider can be opened and seeked without Persephone buffering the whole resource
first — closing the gap `board-pipe-handler.ts:84-88` falls back on today and the documented gap at
`assets/guides/boards.md:965-968`.

## Background

### The wire today (verified against source)

`src/ipc/module-service-channels.ts` is the complete, deliberately import-free wire contract
between the renderer and a board's module-service utility process (its header comment: *"This file
deliberately contains no renderer or main implementation imports so that the wire contract can be
consumed by the service adapter"* — it has zero `import` statements). The provider sub-protocol:

```ts
// lines 85-137 (today)
export type ProviderOperation =
    | "readBinary"
    | "writeBinary"
    | "stat"
    | "watchSubscribe"
    | "watchUnsubscribe";

export interface ProviderRequest {
    kind: "provider";
    operation: ProviderOperation;
    type: string;
    config: Record<string, unknown>;
    subscriptionId?: string;
    data?: Uint8Array;
}

export type ProviderWireErrorCode =
    | "provider-not-registered"
    | "provider-read-only"
    | "provider-invalid-result"
    | "provider-failed"
    | "provider-payload-too-large";

export interface ProviderWireError {
    kind: "provider-error";
    code: ProviderWireErrorCode;
    message: string;
}

export type ProviderResult =
    | { kind: "provider-result"; operation: "readBinary"; ok: true; data: Uint8Array }
    | { kind: "provider-result"; operation: "writeBinary"; ok: true }
    | { kind: "provider-result"; operation: "stat"; ok: true; stat: ProviderWireStat }
    | { kind: "provider-result"; operation: "watchSubscribe" | "watchUnsubscribe"; ok: true }
    | { kind: "provider-result"; ok: false; error: ProviderWireError };

export interface ProviderCapabilities {
    kind: "provider-capabilities";
    type: string;
    writable: boolean;
}
```

**Framing/transport:** a request/response pair is one `{ kind: "request", requestId, message }` /
`{ kind: "response", requestId, result }` (or `error`) exchange over a raw `MessagePort`
(`MessagePortMain` on the main/service side, a plain `MessagePort` in the renderer) —
`src/renderer/api/module-service.ts:280-315` (renderer `request()`, `postMessage`) and
`assets/module-service-host.mjs:293-327` (`handleRendererRequest`, `postRenderer`). Binary payloads
(`Uint8Array`) cross as structured-clone values, copied on the way (`copyBytes()` in
`module-service-host.mjs:44-48`; `Buffer.from(result.data)` in `ProxyProvider.ts:140`) — **not**
Transferables, so a payload is real memory in both processes simultaneously (cited directly in
EPIC-113 D14). The failure envelope is `{ kind: "provider-result", ok: false, error: { kind:
"provider-error", code, message } }`; `ProxyProvider.request()` (`ProxyProvider.ts:107-127`) turns
that into a thrown `ProviderOperationError(code, message)`, and lifecycle failures (service crashed,
untrusted, etc.) are separately mapped to `Error` by `module-service.ts:77-93` from a different,
smaller `lifecycleCodes` set — the two error channels do not overlap.

**Capability announcement, not a manifest flag:** `writable` is not asked from the manifest. It is
computed by the service host from what the board actually registered
(`implementation.writable === true && typeof implementation.writeBinary === "function"`,
`module-service-host.mjs:107`) and pushed to the renderer as a `provider-capabilities` message the
moment the renderer attaches and the service entry has loaded (`announceCapabilities()`,
`module-service-host.mjs:101-110`, called from the `hello-ack` handler at `:359` and from
`registerProvider()` at `:162`). The renderer stores it in
`client.capabilities: Map<string, boolean>` (`module-service.ts:45`, `handleMessage`'s
`"provider-capabilities"` branch, `:187-192`) and `ProxyProvider.writable` reads it via
`moduleService.providerWritable(boardRoot, type)` with a pre-attachment fallback
(`ProxyProvider.ts:84-87`). **This exact mechanism is reused below for range support** — it is not
a new pattern, and this document treats it as the established precedent for "how a board-registered
method's presence becomes known to `ProxyProvider`" rather than inventing something new.

### `IProvider.createReadStream` — exact existing contract

`src/renderer/api/types/io.provider.d.ts:48`:

```ts
createReadStream?(range?: { start: number; end: number }): NodeJS.ReadableStream;
```

Optional, synchronous return (no `Promise` wrapper — the *stream* is returned immediately; data can
still arrive asynchronously through it), inclusive `end`. A real implementation,
`src/renderer/content/providers/FileProvider.ts:29-32`:

```ts
createReadStream(range?: { start: number; end: number }): NodeJS.ReadableStream {
    const options = range ? { start: range.start, end: range.end } : undefined;
    return nodefs.createReadStream(this.filePath, options);
}
```

— a real Node `Readable` (`fs.createReadStream`), range optional (omit → whole file).
`ContentPipe.createReadStream` (`src/renderer/content/ContentPipe.ts:77-92`) delegates straight to
`provider.createReadStream(range)` when there are no transformers, and otherwise falls back to
`readBinary()` sliced and wrapped in a one-shot `Readable.from((async function* () { yield await
read; })())` — **this exact fallback shape is the adapter pattern reused below for `ProxyProvider`**,
because a `ProxyProvider` ranged read is fundamentally "await one bounded reply, then hand it out as
a stream," not real chunked streaming.

`board-pipe-handler.ts` (`src/renderer/editors/board/board-pipe-handler.ts`):

- `hasDirectStream(pipe)` (`:85-89`): `pipe.transformers.length === 0 && typeof
  pipe.provider.createReadStream === "function" && typeof pipe.provider.stat === "function"`.
- `collectChunk(stream)` (`:126-139`): consumes the stream with `for await`, concatenates chunks
  into one `Buffer`, and **destroys the stream and throws** if the running total exceeds
  `MAX_BOARD_PIPE_CHUNK_BYTES` (1 MB, `src/shared/board-pipe-constants.ts:2`) — so whatever
  `createReadStream()` returns, `board-pipe-handler.ts` never accepts more than 1 MB from it either.
- The actual call site, `readChunk()` (`:176-181`):
  ```ts
  const boundedRange = {
      start: selected.start,
      end: Math.min(selected.end, selected.start + MAX_BOARD_PIPE_CHUNK_BYTES - 1),
  };
  const data = hasDirectStream(pipe)
      ? await collectChunk(pipe.createReadStream(boundedRange))
      : (await readBuffered(pipe, memo)).subarray(boundedRange.start, boundedRange.end + 1);
  ```
  **The range handed to `createReadStream` is already clamped to ≤ 1 MB before this call.** A
  `ProxyProvider.createReadStream(range)` implementation therefore only ever needs to serve a single
  bounded window per invocation — never a genuinely open-ended stream.

**Design conclusion (answers "does the wire need multi-reply streaming"):** No. The caller
(`board-pipe-handler.ts:176-181`, itself driven by `board-protocol-service.ts:342-383`'s
continuation loop — it requests the next ≤1 MB range only after the previous one is fully consumed,
which is D5's "bounded pull") never asks a provider for more than
`MAX_BOARD_PIPE_CHUNK_BYTES` at once. **One bounded request/response pair per `createReadStream()`
call is enough.** The new operation is shaped exactly like `readBinary` — a single request in, a
single `Uint8Array` result out — with a `range` added to the request. `ProxyProvider.createReadStream`
then wraps that one awaited reply in a `Readable.from` one-shot generator, identical to
`ContentPipe.ts:82-91`'s existing fallback adapter. This keeps D5's "no new transport" and needs no
change to `board-pipe-handler.ts`, `ContentPipe.ts`, or `board-protocol-service.ts` at all.

### `stat()` and total size (answers "does the ranged path need a size it cannot get")

`stat()` is **already** a full round trip to the board's provider (`"stat"` is an existing
`ProviderOperation`; `ProxyProvider.stat()`, `ProxyProvider.ts:162-174`) and already returns
`{ exists, size?, mtime? }`. Nothing new is needed on the wire for size. What **is** required, and
is not new machinery but an authoring requirement to document: `hasDirectStream()` requires
`typeof pipe.provider.stat === "function"` — `ProxyProvider.stat` is always present as a plain
method, so this is always true for a board provider. The actual gate is whether `stat()`'s *board
implementation* is present and returns a `size` — today `stat()` is optional per
`assets/guides/boards.md:177` ("`stat()` … are optional"). **A board that adds ranged reads must
also implement `stat()` returning `size`** — `resolveTotalSize()`
(`board-pipe-handler.ts:112-117`) throws `"The board pipe provider did not report a usable resource
size."` otherwise once `hasDirectStream()` is true. This is a guide-content requirement, not a code
change (see the guide section below).

### Range past EOF and open-ended ranges (traced, not assumed)

Both are already handled entirely inside `board-pipe-handler.ts`, **before** any provider is
called, and need no new logic:

- **Past EOF:** `parseRangeHeader()` (`src/shared/range-utils.ts:8-33`) returns `null` when `start
  >= totalSize`. `validContinuationRange()` (`board-pipe-handler.ts:141-145`) likewise rejects
  `range.end >= totalSize`. In `readChunk()`, a `null` `selected` short-circuits to a success reply
  with `range: null, data: new Uint8Array()` (`:165-174`) — the provider is never invoked.
- **Open-ended (`bytes=1000-`):** `parseRangeHeader()` sets `end = totalSize - 1` (the whole
  remainder), then `readChunk()`'s `boundedRange` clamps `end` to `start + MAX_BOARD_PIPE_CHUNK_BYTES
  - 1` (`:176-179`) before it ever reaches `createReadStream`. So an open-ended range never reaches
  a provider as an open-ended range — it always arrives pre-bounded to ≤ 1 MB.

**Consequence for the new operation:** it never needs to represent "read to EOF" or "no range" on
the wire. `range: { start, end }` is always a concrete, pre-bounded, inclusive pair by the time it
would be sent. The new `ProviderRequest.range` field can be **required** whenever `operation ===
"readRange"` (no `undefined`/open-ended case to design for).

### How a board declares and implements a provider today (before/after)

**Manifest** (`board-manifest.json`, unchanged by this task — confirmed: no new manifest field is
needed, since range support is discovered at runtime the same way `writable` already is):

```json
{ "contentProviders": [{ "type": "acme/mem", "schemes": ["mem"] }] }
```

`BoardContentProviderDeclaration` (`src/renderer/editors/board/board-manifest.ts:49-52`) is just
`{ type: string; schemes?: string[] }` — confirmed no `range`/`seekable` field exists or is implied
anywhere in `normalizeContentProviders()` (`:419-438`).

**Service module, before** (`assets/guides/boards.md:167-174`, and the ambient type at
`board-api.d.ts:289-303`):

```js
persephone.providers.register("acme/mem", {
    readBinary(config) {
        return new TextEncoder().encode(`content for ${config.name}`);
    },
    stat() {
        return { exists: true };
    },
});
```

**Service module, after** (this task adds a `readRange` member; everything else unchanged):

```js
persephone.providers.register("acme/mem", {
    readBinary(config) { /* unchanged */ },
    readRange(config, range) {
        const data = loadFromWherever(config);
        return data.subarray(range.start, range.end + 1); // ≤ range length, ≤ 1 MB
    },
    stat(config) {
        return { exists: true, size: totalSizeOf(config) }; // size now required for seeking
    },
});
```

**Naming: the board-facing member is `readRange`, not `createReadStream`.** The renderer-side
`IProvider.createReadStream(range)` returns a `NodeJS.ReadableStream` (`io.provider.d.ts:48`). The
board-facing member returns a `Uint8Array` — the same shape as `readBinary`, just bounded to a
range. Naming both `createReadStream` would tell a board author, correctly reading the obvious
sense of that name, to hand back a `Readable`; structured clone would then fail opaquely, nowhere
near the real mistake. `readRange` is named after the **wire operation** it implements
(`"readRange"`, section 1) instead, keeping `createReadStream` exclusively the renderer-side
`IProvider` concept it already is. (This corrects an earlier draft of this document, which used
`createReadStream` for the board-facing member too.)

`registerProvider()`'s implementation-shape validation (`module-service-host.mjs:148-163`) currently
whitelists `["writeBinary", "stat", "watch"]` as the only optional methods allowed besides the
mandatory `readBinary`; `readRange` must be added to that whitelist or registration of a provider
that adds it throws `provider-registration-invalid-implementation`.

## Design: the new operation

### Why `ProxyProvider.createReadStream` cannot simply always exist

`hasDirectStream()`'s gate (`typeof pipe.provider.createReadStream === "function"`) is what makes
"a provider that doesn't support ranging behaves exactly as before" work with no flag (D5). But if
`ProxyProvider` declared `createReadStream` as an ordinary class method, **every** board provider
would suddenly satisfy that check, including ones whose service module never implements ranging —
and the service would reject the resulting `"readRange"` request, breaking exactly the providers D5
says must keep working unchanged.

The fix mirrors `writable` exactly: the service host announces whether the *specific registered
implementation* has a `readRange` function, over the **same** `provider-capabilities` message
already used for `writable`, and `ProxyProvider` exposes `createReadStream` as a **getter** that
returns `undefined` when the capability is unknown-or-false, and a bound function otherwise — so
`typeof pipe.provider.createReadStream` is `"function"` only when the board actually implements
`readRange`. This is not a new pattern in this file: `ProxyProvider.get writable()`
(`ProxyProvider.ts:82-85`) already does exactly this — a capability-driven getter reading
`moduleService.providerWritable(this.boardRoot, this.type)` — and the new `createReadStream` getter
is a second instance of that same shape, in the same file, reading a second capability map.

**Deliberate asymmetry with `writable` — do not "fix" it later.** `writable`'s getter falls back to
`this.config.writable === true` when the capability is not yet known (`ProxyProvider.ts:84-87`).
`rangeReadable` must have **no such fallback**. A config-based fallback would let a board declare
ranging (e.g. via its own `config.rangeReadable` or similar) that its service module never actually
implements, defeating D5's "absence is the buffered path" guarantee — the whole point is that only
the service's own announcement of what it registered can turn the getter on. The getter must read
`moduleService.providerRangeReadable(...) === true` and nothing else.

**Timing was checked, not assumed — the capability is always known before `hasDirectStream()`'s
answer matters, and the mechanism is not "announce on attach."** `announceCapabilities()` itself is
gated on `!rendererLease?.attached || !serviceEntryLoaded` (`module-service-host.mjs:101-102`) — it
is a no-op unless **both** conditions are satisfied. There are two call sites, one per condition,
and correctness comes from **whichever completes second firing the actual announcement**:

1. `registerProvider()` (`:162`) calls it after `persephone.providers.register(...)` runs during
   `await import(serviceEntry)` — at that moment `serviceEntryLoaded` is still `false` (it is not
   set until the import resolves, `:397`), so this call is a no-op on a cold start where the
   renderer has not yet attached either. It only actually announces if the renderer had *already*
   attached by the time the service module registers its provider.
2. The `hello-ack` handler (`:359`) calls it after the renderer attaches — a no-op if
   `serviceEntryLoaded` is still `false` (entry still loading).
3. After `await import(serviceEntry)` resolves, `serviceEntryLoaded = true` is set and
   `announceCapabilities()` is called again immediately, with **no intervening `await`**
   (`module-service-host.mjs:397-398`) — so no renderer request can be handled in between. If the
   renderer had already attached by then, this call is the one that actually posts
   `provider-capabilities`.
4. Either way, a provider `"request"` message cannot be *served* before both conditions hold: before
   attachment, there is no `rendererLease` to receive it; before the entry loads, no provider is
   registered at all and `executeProviderRequest()` answers `provider-not-registered`
   (`:220`) rather than mis-serving it. So the renderer either has the capability already announced
   by the time any request could get a real answer, or the request itself fails cleanly with a typed
   error — there is no third case where a request is served against a capability the renderer
   doesn't yet know about.
5. Because a `MessagePort` preserves order per direction, once the announcement is actually posted
   (whichever call site did it) it is received before any subsequent `response` on that same port.
6. Even the very first synchronous `hasDirectStream()` check inside `resolveTotalSize()`
   (`board-pipe-handler.ts:95-110`) is protected by existing code, independent of the above: when it
   is momentarily `false`, that function does **not** commit to buffered mode — it still awaits
   `pipe.stat()` first (a real round trip), and only after that completes does it **re-read**
   `pipe.provider.createReadStream` (`:100-107`) to decide the final branch. `readChunk()`'s own
   later `hasDirectStream(pipe)` check (`:180`) runs after `resolveTotalSize()` has already awaited,
   so it also sees the settled capability. **This re-read is load-bearing — see the dedicated note
   in the implementation plan below.**

This is exactly the same race `ProxyProvider.writable` already lives with today (shipped code), so
this is a precedent being extended, not a new risk being introduced.

## Implementation plan

### 1. `src/ipc/module-service-channels.ts` — wire types

No imports are added (the file's own header states it is deliberately import-free); the range shape
is inlined rather than imported from `src/shared/range-utils.ts`'s `ByteRange`.

```ts
// operation union
export type ProviderOperation =
    | "readBinary"
    | "readRange"
    | "writeBinary"
    | "stat"
    | "watchSubscribe"
    | "watchUnsubscribe";

// request — add an inline range, required only for "readRange"
export interface ProviderRequest {
    kind: "provider";
    operation: ProviderOperation;
    type: string;
    config: Record<string, unknown>;
    subscriptionId?: string;
    data?: Uint8Array;
    range?: { start: number; end: number };
}

// new wire error code — mirrors provider-read-only's "capability the provider doesn't have"
export type ProviderWireErrorCode =
    | "provider-not-registered"
    | "provider-read-only"
    | "provider-range-unsupported"
    | "provider-invalid-result"
    | "provider-failed"
    | "provider-payload-too-large";

// new result variant
export type ProviderResult =
    | { kind: "provider-result"; operation: "readBinary"; ok: true; data: Uint8Array }
    | { kind: "provider-result"; operation: "readRange"; ok: true; data: Uint8Array }
    | { kind: "provider-result"; operation: "writeBinary"; ok: true }
    | { kind: "provider-result"; operation: "stat"; ok: true; stat: ProviderWireStat }
    | { kind: "provider-result"; operation: "watchSubscribe" | "watchUnsubscribe"; ok: true }
    | { kind: "provider-result"; ok: false; error: ProviderWireError };

// capability announcement gains the new flag
export interface ProviderCapabilities {
    kind: "provider-capabilities";
    type: string;
    writable: boolean;
    rangeReadable: boolean;
}
```

### 2. `assets/module-service-host.mjs` — service-side execution

Add a duplicated constant (mirrors the existing `MAX_BUFFERED_PIPE_BYTES` duplication at `:16` with
the same reasoning — this host is dependency-free and cannot import the TS constant):

```js
// Mirrors src/shared/board-pipe-constants.ts MAX_BOARD_PIPE_CHUNK_BYTES.
const MAX_BOARD_PIPE_CHUNK_BYTES = 1024 * 1024;
```

Extend the optional-method whitelist in `registerProvider()` (`:155`):

```js
for (const method of ["writeBinary", "stat", "watch", "readRange"]) {
```

Extend `validProviderRequest()` (`:175-192`) — add `"readRange"` to the accepted operations and
validate the range shape/bound (mirrors the existing `writeBinary` size check just above it):

```js
function validProviderRequest(message) {
    if (!isRecord(message) || message.kind !== "provider") return "Expected a provider request.";
    if (!["readBinary", "readRange", "writeBinary", "stat", "watchSubscribe", "watchUnsubscribe"]
        .includes(message.operation)) {
        return "Unknown provider operation.";
    }
    if (typeof message.type !== "string" || message.type.length === 0 || !isRecord(message.config)) {
        return "Malformed provider request.";
    }
    if ((message.operation === "watchSubscribe" || message.operation === "watchUnsubscribe")
        && (typeof message.subscriptionId !== "string" || message.subscriptionId.length === 0)) {
        return "Malformed provider subscription request.";
    }
    if (message.operation === "writeBinary"
        && (!isUint8Array(message.data) || message.data.byteLength > MAX_BUFFERED_PIPE_BYTES)) {
        return "Malformed or oversized provider payload.";
    }
    if (message.operation === "readRange") {
        const range = message.range;
        if (!isRecord(range)
            || !Number.isInteger(range.start) || range.start < 0
            || !Number.isInteger(range.end) || range.end < range.start
            || (range.end - range.start + 1) > MAX_BOARD_PIPE_CHUNK_BYTES) {
            return "Malformed or oversized provider range.";
        }
    }
    return undefined;
}
```

Add a branch to `executeProviderRequest()` (`:218-283`), placed after the existing `readBinary`
branch (`:222-229`) — mirrors it, with the D14 overrun check against the *requested range length*
rather than `MAX_BUFFERED_PIPE_BYTES`:

```js
if (request.operation === "readRange") {
    if (typeof implementation.readRange !== "function") {
        return providerFailure(
            "provider-range-unsupported",
            `Provider "${request.type}" does not support ranged reads.`,
        );
    }
    const data = await withDeadline(
        Promise.resolve(implementation.readRange(request.config, request.range)),
    );
    if (!isUint8Array(data)) {
        return providerFailure("provider-invalid-result", "readRange() must return a Uint8Array.");
    }
    const requestedLength = request.range.end - request.range.start + 1;
    if (data.byteLength > requestedLength) {
        return providerFailure("provider-payload-too-large", "readRange() exceeded the requested range.");
    }
    return { kind: "provider-result", operation: "readRange", ok: true, data: copyBytes(data) };
}
```

Extend `announceCapabilities()` (`:101-110`) — unchanged gating (`!rendererLease?.attached ||
!serviceEntryLoaded`, called from both `registerProvider()`'s `:162` and the `hello-ack` handler's
`:359`, plus again from `:398` right after `serviceEntryLoaded` becomes `true`; see the Design
section's timing walkthrough above):

```js
function announceCapabilities() {
    if (!rendererLease?.attached || !serviceEntryLoaded) return;
    for (const [type, implementation] of providers) {
        postRenderer(rendererLease.port, {
            kind: "provider-capabilities",
            type,
            writable: implementation.writable === true && typeof implementation.writeBinary === "function",
            rangeReadable: typeof implementation.readRange === "function",
        });
    }
}
```

### 3. `src/renderer/api/module-service.ts` — track and expose the capability

Add a second capability map alongside the existing one, on `ServiceLeaseClient` (`:36-49`):

```ts
interface ServiceLeaseClient {
    // ...unchanged fields...
    capabilities: Map<string, boolean>;
    rangeCapabilities: Map<string, boolean>; // NEW
    // ...
}
```

Initialize it in `getClient()` (`:119-135`, alongside `capabilities: new Map()`), clear it in
`loseLease()` (`:228-251`, alongside `client.capabilities.clear();`), and populate it in
`handleMessage()`'s `"provider-capabilities"` branch (`:187-192`):

```ts
if (message.kind === "provider-capabilities") {
    if (client.state === "attached" && typeof message.type === "string") {
        client.capabilities.set(message.type, message.writable === true);
        client.rangeCapabilities.set(message.type, message.rangeReadable === true);
    }
    return;
}
```

Add an accessor mirroring `providerWritable()` (`:400-403`) and export it from the `moduleService`
object (`:417-423`):

```ts
function providerRangeReadable(boardRoot: string, type: string): boolean | undefined {
    const client = clients.get(normalizeRoot(boardRoot));
    return client?.rangeCapabilities.get(type);
}

export const moduleService = {
    acquire,
    request,
    subscribeProvider,
    providerWritable,
    providerRangeReadable, // NEW
    dispose,
};
```

### 4. `src/renderer/content/providers/ProxyProvider.ts` — the renderer-side adapter

Import the new constant alongside the existing one (`:9`):

```ts
import { MAX_BOARD_PIPE_CHUNK_BYTES, MAX_BUFFERED_PIPE_BYTES } from "../../../shared/board-pipe-constants";
```

Add a module-scope `require("stream")`, matching the established pattern at `link-utils.ts:6-10`
(`const url = require("url")`, commented: *"`require` rather than `import` because Vite externalizes
Node builtins into broken browser stubs when statically imported"*) — the same reasoning applies to
`"stream"`, and calling `require` once per module rather than once per `createReadStream()`
invocation (i.e. potentially once per megabyte transferred) avoids repeating the lookup on a hot
path:

```ts
// Node's `stream` module for `Readable.from`. `require` rather than `import` because Vite
// externalizes Node builtins into broken browser stubs when statically imported — same pattern
// as link-utils.ts's `require("url")`.
const { Readable } = require("stream") as typeof import("stream");
```

Widen the `extras` type on `requestMessage()` and `request()` (`:94-105`, `:107-127`) to allow
`range`:

```ts
private requestMessage(
    operation: ProviderOperation,
    extras: Partial<Pick<ProviderRequest, "subscriptionId" | "data" | "range">> = {},
): ProviderRequest { /* unchanged body */ }

private async request(
    operation: ProviderOperation,
    extras: Partial<Pick<ProviderRequest, "subscriptionId" | "data" | "range">> = {},
): Promise<Extract<ProviderResult, { ok: true }>> { /* unchanged body */ }
```

Add the capability-gated getter and the fetch/adapter methods (new, placed after `writeBinary()`,
before `stat()`):

```ts
private get rangeReadable(): boolean {
    return moduleService.providerRangeReadable(this.boardRoot, this.type) === true;
}

/** Present only when the board's registered implementation has `readRange` — mirrors
 *  `get writable()` above (`:82-85`, reading `moduleService.providerWritable(...)`) so
 *  `hasDirectStream()` (board-pipe-handler.ts) sees an absent method, not a function that would
 *  fail, for a provider that never implements ranging. Deliberately asymmetric with `writable`:
 *  there is NO `this.config`-based fallback here. `writable` falls back to `config.writable ===
 *  true` before the capability is known; `rangeReadable` must not, or a board could declare
 *  ranging support its service module never implements and defeat D5's "absence is the buffered
 *  path" guarantee. Do not add a config fallback to "fix" this inconsistency. */
get createReadStream(): ((range?: { start: number; end: number }) => NodeJS.ReadableStream) | undefined {
    if (!this.rangeReadable) return undefined;
    return (range) => this.buildRangeStream(range);
}

private buildRangeStream(range?: { start: number; end: number }): NodeJS.ReadableStream {
    if (!range) {
        // board-pipe-handler.ts always supplies a bounded range (readChunk():176-181); an
        // unranged call would otherwise silently ask a board provider to serve an unbounded read.
        return Readable.from((async function* (): AsyncGenerator<Uint8Array> {
            throw new ProviderOperationError(
                "provider-invalid-result",
                "ProxyProvider.createReadStream() requires an explicit range.",
            );
        })());
    }
    const fetched = this.fetchRange(range);
    return Readable.from((async function* () {
        yield await fetched;
    })());
}

private async fetchRange(range: { start: number; end: number }): Promise<Buffer> {
    const result = await this.request("readRange", { range });
    if (result.operation !== "readRange" || !isUint8Array(result.data)) {
        throw invalidResult("readRange");
    }
    const requestedLength = range.end - range.start + 1;
    if (result.data.byteLength > requestedLength) {
        throw new ProviderOperationError(
            "provider-payload-too-large",
            "createReadStream() exceeded the requested range.",
        );
    }
    return Buffer.from(result.data);
}
```

(`isUint8Array` and `invalidResult` are the existing module-level helpers at `:19-23` and `:59-64`;
`ProviderOperationError` is the existing class at `:44-52`.)

### 5. `src/renderer/editors/board/board-api.d.ts` — board-facing typings

Extend the `register()` implementation shape (`:289-303`) with the new optional member, placed
after `readBinary` to read as its ranged sibling:

```ts
register(type: string, implementation: {
    readBinary(config: Record<string, unknown>): Promise<Uint8Array> | Uint8Array;
    readRange?(
        config: Record<string, unknown>,
        range: { start: number; end: number },
    ): Promise<Uint8Array> | Uint8Array;
    writeBinary?(config: Record<string, unknown>, data: Uint8Array): Promise<void> | void;
    stat?(config: Record<string, unknown>): Promise<{
        exists: boolean;
        size?: number;
        mtime?: string;
    }> | {
        exists: boolean;
        size?: number;
        mtime?: string;
    };
    watch?(config: Record<string, unknown>, callback: (event: string) => void): (() => void) | void;
    writable?: boolean;
}): never;
```

### 6. `assets/guides/boards.md` — authoring instructions

Insert after the existing paragraph at line 177 (`` `readBinary()` must return a `Uint8Array`; … ``)
— **do not touch lines 965-968** (the "Seeking-provider support is not implemented yet" sentence in
the Stream-host section); that correction is US-1520's, per the epic's explicit split. Leaving it
stale for one more task is intentional and already decided.

```markdown
Add `readRange(config, range)` to serve ranged reads without buffering the whole resource into
memory first — this is what lets the built-in editors (Monaco, Image, the media player) and a
`stream-host` page's `persephone.host.streamUrl()` seek through a board's own provider. `range` is
`{ start, end }` (inclusive byte offsets); **return a `Uint8Array`, the same as `readBinary()` —
never a stream** (Persephone's own pipe layer has a separate, unrelated streaming concept with a
similarly-named method; `readRange` is not that — it is a bounded, byte-returning read, like
`readBinary()` but for a slice). Return at most `range.end - range.start + 1` bytes, and never more
than 1 MB in one call — the platform pulls a large read as a sequence of bounded requests and asks
again for the next range once the previous one is consumed:

```js
persephone.providers.register("acme/mem", {
    readBinary(config) { /* ... */ },
    readRange(config, range) {
        const data = loadFromWherever(config);
        return data.subarray(range.start, range.end + 1);
    },
    stat(config) {
        return { exists: true, size: totalSizeOf(config) };
    },
});
```

`readRange` is optional and detected automatically from what you register — nothing in
`board-manifest.json` declares it. A provider that omits it keeps working exactly as before: every
read still goes through `readBinary()`, buffered and capped at 256 MB. Adding `readRange` also
means `stat()` must now return a `size` — seeking needs a length to seek against, and a resource
over 256 MB can only be opened through the ranged path.
```

### 7. `src/renderer/editors/board/board-pipe-handler.ts` — one defensive comment, no logic change

`resolveTotalSize()`'s re-read of `pipe.provider.createReadStream` after awaiting `pipe.stat()`
(`:100-107`) is what makes the capability-arrival race in the Design section above harmless — it was
written for an unrelated reason (deciding whether an already-buffered read counts as the size), but
this task now **depends on it** to correctly upgrade a cold-start page to the ranged path once
capabilities have settled. Add a comment marking that dependency so a future refactor that "just
reuses the earlier `hasDirectStream()` result" does not silently reintroduce the race — the failure
mode would be silent (every read for a ranged-capable provider downgrades to a 256 MB buffered read,
or throws `"The board pipe has no bounded streaming provider."` for anything larger), and would look
like a board bug rather than a platform regression:

```ts
if (typeof pipe.provider.createReadStream !== "function"
    && stat.size > MAX_BUFFERED_PIPE_BYTES) {
    throw new Error("The board pipe has no bounded streaming provider.");
}
if (typeof pipe.provider.createReadStream === "function") {
    // Deliberate re-read, not a redundant duplicate of the hasDirectStream() check above: this
    // runs AFTER pipe.stat() has round-tripped, by which point the provider-capabilities
    // announcement is guaranteed to have arrived (see US-1474's task doc, "Timing was checked").
    // Reusing the earlier hasDirectStream() result here would silently downgrade every
    // ranged-capable board provider to the buffered path on a cold start.
    memo.totalSize = stat.size;
    return stat.size;
}
```

## Files needing NO changes (verified, do not re-investigate)

- `src/renderer/editors/board/board-pipe-handler.ts` — **one comment added (step 7 above), no
  logic change.** `hasDirectStream()`, `collectChunk()`, `resolveTotalSize()` and `readChunk()`
  already gate purely on `typeof pipe.provider.createReadStream`/`.stat` being functions and already
  clamp ranges to `MAX_BOARD_PIPE_CHUNK_BYTES` before calling the provider. The capability-getter
  design above makes the existing gate correct with no behavioral edits — only the load-bearing
  re-read needs its dependency documented.
- `src/renderer/content/ContentPipe.ts` — `createReadStream()` already delegates to
  `provider.createReadStream(range)` when present; no change needed.
- `src/main/board-protocol-service.ts` — the continuation-range loop (`:342-383`) is the existing
  bounded pull; it drives `board-pipe-handler.ts`, not the provider wire, and is unaffected.
- `src/renderer/editors/board/board-manifest.ts` / `custom-editor-registry.ts` — no manifest field
  is added; provider declaration and registration are unchanged.
- `src/renderer/content/providers/FileProvider.ts`, `HttpProvider.ts` — unaffected; they already
  implement `createReadStream` directly and never go through `ProxyProvider`.
- `src/main/module-service-supervisor.ts` — its `request()` (`:321-356`) serves
  `persephone.service.request()` (a board frame's own control-plane channel via `board-bridge.ts`),
  a separate request map from the renderer↔service `MessagePort` path used for provider RPC
  (`module-service.ts`). Not touched by this task; the two maps' interaction is US-1518's D6 concern.
- `src/renderer/api/types/io.provider.d.ts`, `io.pipe.d.ts` — `createReadStream?(range?)` is already
  the correct interface shape; `ProxyProvider` conforms to it via the getter, no interface change
  needed.

## Concerns / open questions

*(All resolved below; none block implementation.)*

- **D13's fixture board is not designed here** — see the Scope note at the top. Flag to the epic
  owner before treating EPIC-113's acceptance list as verifiable.
- **`assets/guides/agents/boards.md:373-377,704-706`** documents the same "no `createReadStream`,
  falls back to buffered `readBinary()`" gap and will be stale the moment this ships. It was not
  named in this task's scope (only `assets/guides/boards.md` was) and is not touched here; flag for
  whoever runs US-1520, alongside `doc/epics/EPIC-113.md`'s own overview text (already excluded from
  edits by this task's hard rules).
- **Getter-as-optional-method typing** — confirmed precedented in the very file being edited:
  `ProxyProvider.get writable()` (`ProxyProvider.ts:82-85`) already reads a capability map through a
  getter this way; `createReadStream` is a second instance of the same shape, not a new pattern.
- **Capability-arrival race** — traced above; protected both by message ordering (capabilities
  always precede the first request's response) and independently by `resolveTotalSize()`'s existing
  stat-then-recheck structure. No timer or synchronization primitive needs to be added.
- **New error code `provider-range-unsupported`** — added rather than reusing
  `provider-not-registered` (misleading: the type *is* registered) or `provider-read-only` (wrong
  axis). In practice this code should be unreachable through normal use, because `ProxyProvider`
  only ever emits a `"readRange"` request when its capability getter already reports
  `rangeReadable`; it exists as the defensive, typed answer for the race window this document
  otherwise argues cannot be observed, mirroring why `provider-payload-too-large` already exists
  for an equally-defensive check on `readBinary`.

## Acceptance criteria

Maps to EPIC-113's global acceptance items 2–4 (item order matches the epic's list):

1. A board provider that implements `createReadStream(config, range)` and `stat()` (returning
   `size`) serves a `Range` request through `ProxyProvider` without any call to `readBinary()` for
   that read — observable via a `console.log`/counter added temporarily to the test provider's
   `readBinary` vs. `createReadStream`.
2. A resource whose `stat().size` exceeds `MAX_BUFFERED_PIPE_BYTES` (256 MB) opens and seeks when
   the provider implements `createReadStream`; the existing 256 MB ceiling remains enforced for a
   provider that does not.
3. Seeking near the end of a large resource results in a `createReadStream` call whose `range` is
   near the end, not a scan from the start — verified via the same instrumentation as (1).
4. A provider that implements only `readBinary`/`stat`/`writeBinary`/`watch` (no
   `createReadStream`) behaves identically to today: `hasDirectStream()` is `false`, every read is
   buffered, and no new wire message (`readRange`, the new capability field) changes its behavior
   or is rejected as unrecognized.
5. A malformed range from the renderer (out of order, non-integer, or exceeding
   `MAX_BOARD_PIPE_CHUNK_BYTES`) is rejected by the service host with `provider-invalid-result`
   before it reaches the board's `createReadStream`.
6. A provider whose `readRange` returns more bytes than the requested range is rejected with
   `provider-payload-too-large`, both when the service host itself catches the overrun and (as a
   second, independent check) if it somehow reached the renderer, by `ProxyProvider.fetchRange()`.
7. **Cold start:** the very first open, in a fresh session, of a page backed by a ranged-capable
   board provider — no prior request has ever gone to that board's service — results in the first
   read being served through `readRange`, not a buffered `readBinary()`. This is the case the
   Design section's timing argument and `resolveTotalSize()`'s re-read (step 7) exist to guarantee;
   it must be exercised directly rather than only inferred from the argument.

## Files Changed

| File | Change |
|---|---|
| `src/ipc/module-service-channels.ts` | New `"readRange"` operation, `ProviderRequest.range`, new `ProviderResult` variant, new `provider-range-unsupported` error code, `ProviderCapabilities.rangeReadable` |
| `assets/module-service-host.mjs` | Duplicated `MAX_BOARD_PIPE_CHUNK_BYTES`, `registerProvider()` whitelist, `validProviderRequest()` range validation, `executeProviderRequest()` new branch, `announceCapabilities()` new field |
| `src/renderer/api/module-service.ts` | `ServiceLeaseClient.rangeCapabilities` map, populate/clear it, new `providerRangeReadable()`, exported from `moduleService` |
| `src/renderer/content/providers/ProxyProvider.ts` | New `createReadStream` getter (renderer-side `IProvider` member), `rangeReadable` getter (no config fallback), module-scope `require("stream")`, `buildRangeStream()`/`fetchRange()`, widened `extras` type on `requestMessage()`/`request()` |
| `src/renderer/editors/board/board-api.d.ts` | `register()` implementation shape gains optional `readRange` |
| `assets/guides/boards.md` | New authoring paragraph + example after line 177 documenting `readRange` (bytes, not a stream) (leave 965-968 for US-1520) |
| `src/renderer/editors/board/board-pipe-handler.ts` | Comment only, on `resolveTotalSize()`'s existing re-read — no logic change |
