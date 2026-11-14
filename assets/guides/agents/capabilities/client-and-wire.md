---
title: "Client and Wire"
audience: "agent"
summary: "How do clients call capabilities over the wire, authorize them, and migrate to the current API?"
---

# Client and Wire

## Migration

| Existing declaration or API | Required mapping |
|---|---|
| `capabilities` entry without `methods` | Preserve its id, version (default 1), priority, filters, title, `payloadSchema`, `headless` and `alwaysOpensNewPage`; synthesize `open(payload)` of kind `open`, with descriptive `payloadSchema`, default deadline 10 seconds and agent visibility. Preserve legacy validation, `@major` parsing and headless `no-handler` behavior. |
| `serviceInterfaces` entry | Preserve its exact id/version/title and service; synthesize channel methods for its known open types. Use the v1 host policy table: `speech.transcribe`: `describe`, `transcribe`; `speech.synthesize`: `describe`, `speak`; `speech.wake`: `describe`, `enroll`, `list`, `delete`, `listen`; `text.translate`: `describe`, `detect`, `translate`, `download`. Also map the `agent.session` v1 contract's `describe`, `list-sessions` and `open`. Other types come from an optional legacy `openTypes` string array on that entry; do not invent types. Synthesized legacy method names are exempt from the new method-name grammar and remain exact; a hyphenated name is accessible only with bracket notation, e.g. `proxy["list-sessions"](../...)`. New declarations must follow the grammar. Existing manifests need not add `openTypes`: an unknown type remains usable through legacy `services.connect` with its unchanged open message and authorization, but is not discoverable as a named proxy method until declared. Legacy `author/name` ids remain accessible exactly as written through wrappers and discovery; new declarations use dot ids. |
| Both declarations for the same board/id/version | Merge distinct methods; explicit new `methods` win on name collision. Preserve legacy `services.connect` behavior, including a colliding open type. |
| `uses` | Existing `{ id, version }` entries grant that exact capability major version, including platform providers; the trust dialog displays them. Existing entries and slash ids retain their meaning. New grants use the new id grammar. |

Existing `persephone.capabilities.invoke`, `persephone.services.list/connect`, `app.capabilities.invoke`, and `handlers` remain wrappers, preserving their signatures and result projections. Invocation honors `capabilities.preferredProviders` when no provider is explicitly selected; an unpinned `invoke` may choose any eligible major version, while an explicit version continues to pin it. `deadlineMs`, filters, result shapes and error codes remain supported. The deleted renderer bus no longer supplies separate list or invoke gates. Existing board intent FIFO, request-bound settlement, `discardPage`, caller-window page reuse and fresh-page rules remain intact. Board page and service `persephone.capabilities.list()` returns the unified, grant-filtered provider list without `appScripting`. Bundled manifests and prose guide migrations are tracked in US-1797, and external manifests in BT-087.


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
| Board page | Trusted, enabled consumer and exact `uses` grant; no `appScripting` for capability discovery or invocation. |
| Board service | Same trust and exact `uses` grant; no `appScripting` for the new API. Its own service requires `service` permission. |
| Persephone renderer | Platform access, no `uses` or `appScripting`; registry authorization replaces the old host allowlist for the new API. |
| Agent via MCP `call` | No board `uses` or `appScripting`; only declared, agent-visible `call` and `open` methods. Channels are discovery-only. |

Every board provider must remain trusted and enabled; service providers also need a valid service and granted `service` permission. Recheck both consumer grant and provider trust during startup and in flight; revocation cancels requests and closes channels. Grants authorize messaging, not the provider's filesystem, microphone or other privileges. Providers apply their own caller approval policy, including for `persephone` and agents; denial is `permission-denied`. `agent: false` is enforced by main as well as hidden in help, including on explicit-provider paths. It does not restrict board or platform callers. Legacy APIs retain their current gates; a board's separate `persephone.call` or MCP endpoint still needs `appScripting`.

For board pages the new `open` method deliberately requires `uses` but not `appScripting`: it opens a provider page with a payload, the grant is disclosed in the trust dialog, and the provider validates that payload.

