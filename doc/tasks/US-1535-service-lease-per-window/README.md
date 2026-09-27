# US-1535: One service renderer lease per window, not per service

Epic: [EPIC-115](../../epics/EPIC-115.md) — Phase 1 defect.

## Goal

Allow multiple Persephone windows to use one board module service concurrently. Reacquiring in one WebContents, or that WebContents navigating, crashing, or being destroyed, must release only its lease and its pending provider work.

## Background

EPIC-115 describes the current eviction chain: `ServiceRecord.lease` stores one lease; `transferRendererPort()` supersedes it on every acquire; `assets/module-service-host.mjs` likewise stores one `rendererLease` and closes it on attach. Closing the host lease rejects its reads and disposes its provider watches. Thus a second window displaces the first window, whose next request can displace the second in turn.

Current source confirms that `src/renderer/api/module-service.ts` maintains a client keyed by normalized board root inside each renderer process. That client owns its pending requests, watches, and one acquired port. `src/renderer/content/providers/ProxyProvider.ts` sends provider operations through that client. Keep this renderer-local ownership model; fix the main-process cross-window lease registry and the utility-process host's per-port state.

The live run also confirmed a separate lease-loss wedge. `transferRendererPort()` transfers `port1` to the renderer with `target.postMessage(..., [port1])`; Electron documents that this transfers ownership to the renderer. `failLease()` then tries to post `lease-lost` and close the old main-side `MessagePortMain`, but main no longer owns that endpoint. The host's `closeRendererLease()` settles pending reads with `service-exited` and closes its peer, but never sends a lease-lost message. The renderer's `handleMessage()` branch for `lease-lost` is therefore unreachable on these close paths, and its `MessagePort` has no close listener. Its client remains `attached` with a dead port; `acquire()` short-circuits on `state === "attached" && client.port`, so subsequent no-deadline content reads post into the dead port and hang. This explains why the observed failure wedges window 0 instead of the epic's predicted ping-pong.

Electron's MessagePorts tutorial documents a renderer-side `close` event emitted when the other end closes. Add this as a fallback in `receivePort()` with an identity guard (`client.port === port`) so a delayed close event from a replaced port cannot lose a newer lease. The host remains the authoritative source for the loss reason and must send `lease-lost` before closing its endpoint.

The host-to-service interface is not the renderer lease protocol. Board service modules register provider implementations through `persephone.providers.register(...)` and receive `persephone.storage`; `attach-renderer`, `drop-renderer`, `renderer-attached`, `hello`, and `lease-lost` are host/supervisor/renderer transport messages. No service-side renderer-attached/detached callback exists in the torrent viewer or `_test/range-provider-test`. Therefore this plan does not change a board-visible service protocol or result shape, and **does not bump `BOARD_BRIDGE_VERSION`**.

The supervisor currently has no service idle-stop behavior driven by renderer count: explicit stop, trust loss, quit, and process failure drive service lifecycle. Preserve that behavior; if any future zero-lease check is introduced as part of this change, it must inspect the complete lease map.

### Current → planned ownership

`src/main/module-service-supervisor.ts` currently declares `lease?: RendererLease` on `ServiceRecord`. Replace it with `leases: Map<number, RendererLease>` keyed by `WebContents.id`; each lease retains `generation`, `leaseNonce`, port, attach timer, and settle callbacks. An acquire replaces only the entry with the same WebContents id. Attach acknowledgements and timeout callbacks resolve or fail the entry matching both its owner and lease nonce.

`assets/module-service-host.mjs` currently has `let rendererLease` and global provider `subscriptions`. Replace the single current lease with a map keyed by lease nonce. Each lease owns its pending requests, active-read count, and watch subscriptions. Keep the registered provider implementations at service scope.

## Live repro (observed)

Run by the user on 2026-09-28 in the dev app, with windows 0 and 1 and the trusted Range Provider Test board. This run shows a wedge in window 0 rather than the ping-pong predicted by EPIC-115:

1. Baseline in window 0, using MCP `script.execute`: `await app.pages.openUrl('rangetest://fixture/base.txt?size=64&delay=1500')`. It opened as Monaco with 64 bytes.
2. Start a non-awaited open in window 0: `app.pages.openUrl('rangetest://fixture/w0b.txt?size=64&delay=10000')`; record its promise outcome on `window.__r0`.
3. Immediately in window 1, await `app.pages.openUrl('rangetest://fixture/w1b.txt?size=64&delay=1000')`. It completed in about 3.5 seconds with 64 bytes.
4. Window 0's `openUrl` never resolved or rejected after more than 30 seconds, and created no page. Window 0 was then wedged for this board: `await app.pages.openUrl('rangetest://fixture/w0d.txt?size=64')` with no delay also hung (an 8-second race timed out), and a delayed read hung too. Window 1 continued working: `w1c.txt` opened in 27 ms.
5. The MCP `call` tool serializes calls. An earlier attempt with both calls awaited in parallel did not overlap; firing window 0's promise without awaiting it, then awaiting window 1's call, is the overlapping repro.

### Re-verification after the fix

Repeat the observed sequence through MCP in windows 0 and 1: verify the delayed `base.txt` baseline; fire-and-forget window 0's 10-second `w0b.txt` open while recording the outcome on `window.__r0`; immediately await window 1's 1-second `w1b.txt` open. After the fix, both calls must settle and create 64-byte pages. Then open `w0d.txt` without delay in window 0 and `w1c.txt` in window 1; both must settle. Run a second overlapping round in both windows, then reload the window 0 renderer and confirm a fresh read succeeds in each window.

## Implementation plan

- [x] **Make supervisor ownership per WebContents** in `src/main/module-service-supervisor.ts` (`ServiceRecord`, `transferRendererPort()`, `renderer-attached` handling, `failLease()`, `handleUnexpectedExit()`, `stopRecord()`, `forceKillAllSync()`).
  - Replace the optional singleton with a `Map<number, RendererLease>` keyed by `target.id` (`webContents.id`). Initialize the map with each new `ServiceRecord`.
  - Before creating a lease, find and fail only the old map entry for `target.id`, send `drop-renderer` with that entry's generation and nonce, and leave every other entry untouched.
  - Insert the attaching lease before transferring the port. Attach timeout and port-transfer error callbacks must verify that the map still contains that exact entry before failing/removing it, so an old timeout cannot erase a newer acquire.
  - Match host `renderer-attached` acknowledgements by generation and nonce against the attaching lease; resolve only that lease's promise.
  - Refactor `failLease(record, lease, reason)` to remove only the matching map entry, send a reasoned `drop-renderer` to the host, reject only that lease's attach promise, and be safe when called more than once. It must not post on or close `lease.rendererPort` after successful transfer to the renderer: `WebContents.postMessage(..., [port1])` transfers ownership. Close `port1` locally only in a path where transfer to the renderer did not succeed; the host owns the peer after its transfer.
  - On service exit, explicit/trust stop, and quit, fail every lease in the record. Send a reasoned drop for each reachable host lease before shutdown where possible; because `stopRecord()` clears `record.process` before teardown, pass its captured utility-process reference to lease release or send drops before clearing it. If the utility process is already gone (including forced quit), let its peer close notify the renderer. Do not stop a healthy service merely because one or all renderers release a port; current stop behavior is not lease-count driven.
- [x] **Release the owning lease on WebContents lifecycle events** in `src/main/module-service-supervisor.ts`, called from `transferRendererPort()` with its `target`.
  - Register cleanup for `destroyed`, `render-process-gone`, and main-frame `did-navigate`, scoped to the acquired lease and `target.id`; a callback must not release a newer lease for the same WebContents.
  - Remove lifecycle listeners when their lease is released/replaced so repeated board requests do not accumulate listeners. A crash/navigation of one WebContents must leave other windows' map entries and ports intact.
  - The IPC entry point is `src/ipc/main/board-handlers.ts` `requestModuleServicePort`, which passes `event.sender` to `transferRendererPort()`. Keep the sender-to-owner association here/main-side rather than trusting a renderer-supplied WebContents id.
- [x] **Make host state lease-local** in `assets/module-service-host.mjs` (`rendererLease`, `announceCapabilities()`, subscription helpers, `finishProviderRequest()`, `handleRendererRequest()`, `attachRenderer()`, `dropRenderer()`, and process-exit cleanup).
  - Replace the singleton with `Map<leaseNonce, lease>`; each entry carries generation, port, attach state/timer, `pending`, `activeContentReads`, and its own subscription map.
  - `attachRenderer()` must add a new lease without closing the others. Validate `hello-ack` against the exact lease object and identifiers; allow request and cancellation handling while that lease remains attached in the map.
  - Route each provider response through the lease whose `pending` map contains its request id. Request ids are presently generated per renderer client and can collide across windows (for example both can issue `renderer-1`), so never use a service-global pending map for renderer requests.
  - Move watch subscription ownership from the global `subscriptions` map into the creating lease (including `watchUnsubscribe`). A watch event and its disposer belong only to that lease; identical subscription ids in two renderer processes must not collide.
  - When closing one lease, reject only its pending requests, abort only their controllers, clear only its read count, dispose only its watches, close its port, and remove it from the lease map. Process exit may close all leases.
  - Capability fan-out has two distinct points: when the service entry finishes loading, announce capabilities to every currently attached lease; when one lease completes `hello-ack`, announce only to that lease. Do not re-broadcast to all existing leases on every attach.
  - Before any host-side close, post `{ kind: "lease-lost", reason }` on that lease's peer port, then settle its pending responses, dispose its watches, and close it. Thread an explicit reason through `closeRendererLease(lease, reason)`: the attach timer uses `renderer-port-attach-failed`, `drop-renderer` uses its supplied reason, and `messageerror`/service-entry failure/process exit use `service-exited`. Process-exit notification is best effort; send synchronously before close where possible.
  - `provider-event` remains scoped to the lease that created its watch; `content-read-count` remains a per-lease count. No service-level host event currently broadcasts through the renderer port to every renderer.
  - Scope `drop-renderer` by `generation` and `leaseNonce` against the lease map and pass the reason through to the host close. A stale drop must be a no-op and must never close a different lease.
- [x] **Carry loss reason to the host** in `src/ipc/module-service-channels.ts`: add `reason: RendererLeaseLostReason` to the `ServiceParentMessage` `drop-renderer` variant. Main-owned transitions such as supersede, untrusted, quit, and stopping can then tell the host which `lease-lost` reason to send. This is an internal host/supervisor contract.
- [x] **Make the renderer recover when a lease is lost** in `src/renderer/api/module-service.ts` (`receivePort()`, `handleMessage()`, `loseLease()`, and `acquire()`). Keep the existing `lease-lost` handling and its mapping (`superseded` → `renderer-reloaded`); the host signal will now reach it. In `receivePort()`, listen for Electron 43's renderer-side MessagePort `close` event as a fallback and call `loseLease(client, "service-exited")` only if `client.port === port`. That identity guard prevents a late close event from a replaced port from discarding a new lease. `loseLease()` already clears the port/state and rejects outstanding no-deadline content reads; the next `request()` can then re-enter `acquire()` rather than posting into a dead port.
- [x] **Preserve all-window service status fan-out** in `src/main/module-service-supervisor.ts` `emit()` and `src/main/open-windows.ts` `send()`. `eModuleServiceStatusChanged` is already broadcast to every open window; it is process/service status, not a lease-owned provider event. Renderer clients continue filtering by normalized board root.
- [x] **Keep the board bridge version unchanged** in `src/shared/board-bridge-version.ts` (`BOARD_BRIDGE_VERSION` is `1.18.0`). Re-check after adding `drop-renderer.reason` and renderer lease recovery: `lease-lost`, port close, and drop reason remain runtime transport details. Board frames and service modules still see the same provider registration, operation arguments/results, and storage API, so no board-visible protocol or result shape changes.
- [ ] **No sibling board edits are required.** Read-only inspection of `C:\projects\persephone-boards\boards\torrent-viewer\scripts\service.mjs` and `_test/range-provider-test/scripts/service.mjs` found provider registration and provider operation implementations, but no renderer attach/detach callback or lease protocol consumption. Their `readRange`, `stat`, and `readBinary` implementations need no migration.

### Before → after snippets

Supervisor ownership (`src/main/module-service-supervisor.ts`):

```ts
// Before
interface ServiceRecord {
    lease?: RendererLease;
}

// After
interface ServiceRecord {
    leases: Map<number, RendererLease>; // WebContents.id → this window's lease
}
```

Host ownership and teardown notification (`assets/module-service-host.mjs`):

```js
// Before
let rendererLease;

function attachRenderer(message, port) {
    closeRendererLease(rendererLease);
    // ...
    rendererLease = lease;
}

// After
const rendererLeases = new Map(); // leaseNonce → independent lease state

function attachRenderer(message, port) {
    // ... add this lease without closing other entries
    rendererLeases.set(lease.leaseNonce, lease);
}

function closeRendererLease(lease, reason) {
    postRenderer(lease.port, { kind: "lease-lost", reason });
    // ... settle only this lease's requests/watches, then close its port
}
```

## Concerns / Open questions

- **Idle service shutdown:** no current idle policy is driven by “no renderer attached.” Recommendation: leave service start/stop semantics unchanged; ensure any lease-count checks introduced later use `leases.size`, never a singleton or a global window count.
- **Main-side transferred-port cleanup:** `target.postMessage(..., [port1])` transfers ownership. Recommendation: after successful transfer, main must not post on or close `port1`; send a reasoned `drop-renderer` to the host, which owns the peer and can notify the renderer before closing. On a pre-transfer failure, close locally owned ports during that failure path.
- **Renderer MessagePort close fallback:** checked against the Electron MessagePorts tutorial for the renderer-side `close` event and the installed Electron 43 `MessagePortMain` typings for the main-side peer close behavior. The generic TypeScript DOM `MessagePortEventMap` does not list Electron's extension, but `MessagePort.addEventListener` accepts string event names. Recommendation: listen with `addEventListener("close", ...)` and guard by port identity; the host's reasoned `lease-lost` remains the primary signal.
- **Lifecycle listener cleanup:** there is no current module-service handler for WebContents `destroyed`, `render-process-gone`, or navigation. Recommendation: attach per-acquire callbacks in the supervisor and remove them with the lease, as the existing board-pipe and board-bridge owners do for destroyed/crashed WebContents. Navigation should release the old document's lease; its next request can acquire a fresh one.
- **BOARD_BRIDGE_VERSION:** Recommendation: no bump. After adding the host-to-renderer loss reason and close fallback, only runtime lease transport changes; board frames and service code retain identical provider messages, results, and service APIs.
- **Cross-repository behavior:** Recommendation: no changes in `persephone-boards`. The torrent viewer and range fixture do not consume lease lifecycle messages or callbacks.

## Acceptance criteria

- Two windows can read different resources through one service concurrently without either read being evicted by the other's acquire.
- Reacquiring in one WebContents supersedes only its own prior lease; another WebContents' lease and pending read remain active.
- After a lease is lost for any reason, the next request from that window re-acquires a lease and succeeds; it never stays attached to a dead port or wedges.
- Destroying, crashing, or navigating one WebContents releases only its lease and associated pending reads and watch subscriptions.
- Responses route to the exact lease that issued them even when request ids and watch subscription ids collide across renderers.
- Closing one lease rejects/aborts only its pending requests and disposes only its subscriptions; `drop-renderer` is matched by generation and nonce and is scoped to one lease.
- Provider capabilities reach every attached lease; watch events remain owner-scoped; service status continues broadcasting to every window.
- Service start/stop semantics account for all leases if any lease-count decision is present; current idle-stop behavior remains absent.
- `BOARD_BRIDGE_VERSION` remains unchanged, with the internal-vs-board-visible contract distinction documented.
- Repeat the observed MCP sequence: window 0's fire-and-forget 10-second `w0b.txt` open overlaps window 1's awaited 1-second `w1b.txt` open; both settle and create 64-byte pages, then a fresh no-delay window 0 read settles.
- Invoke each changed path twice: perform a second overlapping round in both windows, then reload window 0's renderer and confirm a fresh read in each window succeeds.

## Verification (2026-09-28, dev app after the fix)

`npm run typecheck`, `npm run lint` and `npm run build-prod` pass. Live checks over the Persephone MCP,
two windows, Range Provider Test board, each path run at least twice:

- **Overlap, window 0 first:** window 0 fire-and-forget `openUrl('rangetest://fixture/fix0a.txt?size=64&delay=10000')`,
  then window 1 `openUrl('...fix1a.txt?size=64&delay=1000')`. Window 1 completed in ~3.5 s; window 0's
  open resolved at 10.2 s with its 64 bytes. Before the fix this exact sequence wedged window 0.
- **Overlap, reversed:** window 1 long read (10 s), window 0 short read. Both completed (10.0 s and
  ~4 s); a fresh no-delay read in window 1 then completed in 16 ms.
- **Reload supersedes only its own lease:** window 1 started a 12 s read; window 0 started its own
  12 s read and reloaded its renderer mid-read. After the reload window 0 read again (105 ms, new lease
  for the same WebContents) and window 1's read still completed at 12.0 s.
- **Recovery after service loss:** killed the service utility process; both windows then read twice
  each (18–82 ms). The service restarted once (`restartCount: 1`, new pid).

### Not verified

- Two windows streaming different files from one real torrent at the same time (needs a swarm); the
  range fixture exercises the same `ProxyProvider` → module-service path.
- Provider `watch` subscriptions with colliding subscription ids across two windows (no fixture with a
  watching page was driven live).
- The renderer-side MessagePort `close` fallback in isolation (the host's `lease-lost` message arrives
  first on every path exercised above).
- The host attach-timeout and `messageerror` close paths (not triggerable from MCP).

## Files Changed Summary

| File | Planned change |
|---|---|
| `src/main/module-service-supervisor.ts` | Per-WebContents lease map, reasoned drop messages, exact lease routing/cleanup, and WebContents lifecycle release; do not signal through transferred `port1`. |
| `assets/module-service-host.mjs` | Nonce-keyed lease map; lease-local pending reads and watches; explicit `lease-lost` before close; capability fan-out on load and per-lease announcement on attach. |
| `src/ipc/module-service-channels.ts` | Add `reason: RendererLeaseLostReason` to the internal `drop-renderer` message. |
| `src/renderer/api/module-service.ts` | Listen for host `lease-lost` and renderer-side MessagePort `close`; clear dead lease state so the next request re-acquires. |
| `doc/tasks/US-1535-service-lease-per-window/README.md` | This task document. |
| `src/renderer/content/providers/ProxyProvider.ts` | **No change expected:** service provider operation contract remains stable. |
| `src/ipc/main/board-handlers.ts`, `src/ipc/renderer/api.ts`, `src/preload.ts` | **No change expected:** current IPC passes the trusted `event.sender`; generic port transfer can carry multiple lease payloads. |
| `src/shared/board-bridge-version.ts` | **No change:** no board-visible service contract/result shape changes. |
| `src/main/open-windows.ts` | **No change:** status events already broadcast to every open window. |
| `C:\projects\persephone-boards\boards\torrent-viewer\scripts\service.mjs` | **No change:** no lease lifecycle protocol consumption. |
| `C:\projects\persephone-boards\_test\range-provider-test\scripts\service.mjs` | **No change:** no lease lifecycle protocol consumption; its delay/stall fixture remains usable. |



