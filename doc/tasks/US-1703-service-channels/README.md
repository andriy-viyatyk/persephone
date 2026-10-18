# US-1703: Service channels for a board's own service

Epic: [EPIC-131](../../epics/EPIC-131.md) — Phase 0, P0-A.

## Goal

Give each board frame a long-lived, ordered, two-way streaming channel to its own module service. The page API is `persephone.service.openChannel(openMessage)` returning `{ send, onMessage, onClose, close, writable, whenWritable }`; the service API is `persephone.service.onChannel((channel, openMessage, info) => ...)` and receives every opened channel.

## Background

### Epic design constraints

EPIC-131 P0-A specifies a MessagePort pair, structured-clone payloads, ordered delivery, no request-style operation deadline, close from either endpoint, closure on page navigation/unload and service exit, bounded backpressure, and coexistence of channels from multiple windows. A service restart must close old channels as `service-exited`. The service's shutdown handlers must remain within the existing two-second main-process shutdown deadline. P0-B will reuse the same service-side channel object and add a caller identity to `info`; P0-A must preserve an additive shape for that extension.

### Verified source findings

- `src/main/module-service-supervisor.ts`: each normalized board-root `ServiceRecord` owns `requests`, `leases` keyed by renderer `WebContents.id`, and a process `generation`. `request()` enforces a 32-outstanding-per-service cap, starts with mode `"request"`, then sends `{ kind: "request", requestId, message }` with a 10-second deadline. `transferRendererPort(boardRoot, target)` also starts lazily in mode `"request"`, then delegates to `transferRendererLease`. Unexpected utility-process exit rejects requests with `service-exited`, settles storage, fails all leases, then attempts restart. `stopRecord()` rejects requests and fails leases before sending shutdown; it waits at most `SERVICE_SHUTDOWN_TIMEOUT_MS` (2,000 ms) then kills the utility process. The synchronous quit path also fails leases. Existing codes include `service-busy`, `service-failed`, `service-timeout`, `service-exited`, `untrusted`, `permission-denied`, `quit`, `service-not-declared`, and `trust-not-ready`.
- `src/main/module-service-leases.ts` is the existing service MessagePort route. It creates `MessageChannelMain`, transfers `port2` in `process.postMessage({kind:"attach-renderer", ...}, [port2])`, and transfers `port1` to the target `WebContents` as `eModuleServicePort`. The lease is keyed by host `WebContents`, and listeners fail it on `destroyed`, `render-process-gone`, or `did-navigate`; transfer has a 5-second attach timeout. `assets/module-service-host.mjs` consumes `event.ports[0]`, attaches the renderer port, and handles `hello`/`hello-ack`, request/reply, provider subscription events, `drop-renderer`, and lease-loss reasons. `src/renderer/api/module-service.ts` is the host-renderer lease client; it subscribes through the preload's ports-aware API and maps stop/loss lifecycle state to service error codes. This lease is for provider traffic and is keyed to the host renderer, not to individual board pages.
- `assets/module-service-host.mjs` currently exposes only `persephone.service.onRequest(handler)` and `onShutdown(handler)`. Main-to-host requests are dispatched asynchronously and each gets one response. Shutdown handlers run sequentially, then the host exits; main enforces the overall 2-second deadline. Its `parentPort` listener forwards unknown lifecycle messages to the service entry, so channel protocol messages must use distinct kinds and be consumed by the host before forwarding.
- `src/main/board-bridge.ts` registers each board frame independently under a unique `boardId`, retains the main-side board-port endpoint, routes board RPCs using `BoardPortEntry` (`root`, `host`, `hostWebContents`, `ownerId`), and disposes the entry on iframe unmount/reload, host crash, or app quit. `src/renderer/editors/board/BoardWebview.ts` listens for `eBoardPort` in the host renderer, then transfers it into that exact iframe with `contentWindow.postMessage(..., "board://<host>", [port])`; the shim accepts the handshake only from its parent and configured host origin. This is the verified path to a board frame.
- `src/board-shim.ts` defines `persephone.service.request()` as a `serviceRequest` board RPC, with comments confirming lazy service startup. Its generic `rpc()` posts over the per-frame board MessagePort and resolves an id-matched result. `status()` does not start the service; `stop()` does not start it when stopped. `src/ipc/board-bridge-channels.ts` lists `BoardRpcMethod`, and `src/main/board-bridge.ts` checks the board's `service` permission for request/status/stop before dispatch.
- `src/renderer/content/providers/ProxyProvider.ts` is the consumer precedent: it sends structured provider request objects through `moduleService.request`, uses operation policies for deadlines/control caps, and owns/disposes watch/status subscriptions. The service host sends provider events only to an attached renderer lease. This request/reply/provider path is not a page-level streaming channel.
- The page-side `src/renderer/api/module-service.ts` subscribes globally for module-service ports, indexes them by normalized board root, and understands only the provider lease protocol. `BoardWebview`'s separate global board-port subscription filters by `boardId` before forwarding a port to its iframe. `src/board-shim.ts`'s existing `rpc()` does not support transfer lists, so `openChannel` needs a transfer-capable channel-delivery path rather than returning a port through a normal RPC result.
- Board pages are not Node-enabled: `src/main/open-window.ts` sets `nodeIntegrationInSubFrames: false`, and the `src/renderer/editors/board/BoardWebview.ts` class comment identifies that setting as part of iframe isolation. Therefore, `v8.serialize()` cannot be used in `src/board-shim.ts` to measure page→service payloads. Apply the byte cap in the utility process for service→page only; bound page→service traffic by unacknowledged message count.
- `src/ipc/module-service-channels.ts` defines `SERVICE_SHUTDOWN_TIMEOUT_MS = 2000`, `MAX_OUTSTANDING_REQUESTS_PER_SERVICE = 32`, and `SERVICE_REQUEST_DEADLINE_MS = 10_000`. Existing lifecycle mappings are `explicit stop → service-exited`, trust loss → `untrusted`, app quit → `quit`, and superseded renderer lease → `renderer-reloaded`. Reuse these codes and error objects for open failures and close reasons. Use `service-busy` for channel-count limits and a new `channel-backpressure` code for a full channel send window.
- Bridge-version inventory: `src/shared/board-bridge-version.ts` is the source of truth, currently `1.41.0`; the shim, main trust service, board editor registry, and Board Info model import that constant. Hardcoded current-version text also exists in `assets/guides/boards.md`, `assets/guides/agents/boards.md`, `src/renderer/editors/board/board-api.d.ts`, `doc/architecture/overview.md`, and `doc/architecture/key-files.md`. No bridge-version test/spec path or assertion fixture was found. Phase 0 (US-1710, US-1703, US-1709, US-1704) ships in one release with one bump to `1.42.0`; US-1710 owns that bump and the `1.42.0` history/guide/What's New entries. This task appends its API details to those shared entries and does not edit the version constant or repeat the current-version update. No test harness will be added.
- `assets/guides/whats-new.md` is planned to have a `## Version 5.0.13 (Upcoming)` section maintained by US-1710; append this feature to its existing entries rather than replacing a placeholder. Developer docs already describe request/reply and leases in `doc/architecture/overview.md` and `doc/architecture/scripting.md`; update those contracts and add the channel ownership path to `doc/architecture/key-files.md` if implementation introduces a distinct manager file.

### Before → after API shape

Current verified surface in `src/board-shim.ts`:

```js
service: {
    request(message) { return rpc("serviceRequest", [message]); },
    status() { return rpc("serviceStatus", []); },
    stop() { return rpc("serviceStop", []); },
}
```

Target API to document and implement:

```js
// Board frame
const channel = await persephone.service.openChannel({ op: "session", id });
channel.onMessage((message) => render(message));
channel.onClose((reason) => showDisconnected(reason.message));
if (!channel.writable) await channel.whenWritable();
channel.send({ op: "user-message", text });
channel.close();

// Service entry
persephone.service.onChannel(async (channel, openMessage, info) => {
    channel.onMessage((message) => handle(message));
    if (!channel.writable) await channel.whenWritable();
    channel.send({ type: "text-delta", text: "..." });
    channel.onClose((reason) => releaseSession(reason));
});
```

`send()` accepts structured-cloneable values and throws a coded error when closed or backpressured. `writable` is a read-only boolean, and `whenWritable()` resolves when the send window has room or rejects with the channel close reason. `onMessage()` and `onClose()` return unsubscribe functions; each side receives the payload itself and a close reason `{ code, message }`. `close()` is idempotent. One service-side `onChannel` registration receives every incoming channel. Same-board opens include `info.page: { boardId }` and omit `info.interface` and `info.caller`; US-1704 cross-board opens reuse this registration and populate those fields so services can distinguish same-board and cross-board callers without changing the callback signature.

## Implementation Plan

- [x] **Define shared wire contracts and limits.** Added channel protocol and close types, 16/frame and 128/service limits, 256-message flow control, cumulative acknowledgements, and the 1 MiB service-to-page V8 serialization bound. Page-to-service traffic uses the count bound.
- [x] **Track and close channels with the service record.** Main owns channel IDs, board/frame and generation metadata, starts services lazily, enforces channel caps, transfers the port pair, and sends lifecycle close reasons on board disposal, stop, trust loss, quit, and process exit.
- [x] **Add service-side channel support.** The host consumes channel lifecycle protocol, invokes one `onChannel` callback, and provides ordered send/listen/close/backpressure APIs. It closes channels before sequential shutdown handlers.
- [x] **Add board-frame routing and lifecycle ownership.** The board RPC enforces the service permission; main delivers a ports-aware event, BoardWebview forwards only to the matching live frame, and disposal closes channels as `renderer-reloaded`.
- [x] **Deliver the page endpoint to the right frame and expose the API.** The shim correlates channel IDs, exposes the page API and count-based flow control, closes on `pagehide`, and the public typings include channel and additive `info` fields.
- [x] **Append the shared bridge-release documentation without another bump.** Appended API details to the existing 1.42.0 and 5.0.13 entries, updated board guides and architecture references, and left the version constant unchanged.
- [x] **Review the proposed minimal event surface against the implemented channel contract.** P0-A uses only per-page `openChannel()`; `broadcast()` and `onEvent()` were not added.

## Concerns

| Question | Recommendation and reason |
|---|---|
| Direct page↔service MessagePort or relay all traffic through main? | Use direct data-plane ports: utility process endpoint via `leaseCallbacks.postMessage`, page endpoint through main → host renderer → the exact `BoardWebview` iframe. Main owns setup, authorization, caps, and teardown metadata only. This reuses the existing transferred-port paths without putting streaming payloads on the main-process event loop. |
| How does a port reach a board page in its webview/frame? | Main delivers a transferred page endpoint to the host `WebContents`; `BoardWebview` filters by unique `boardId` and forwards it with `postMessage` to its iframe using the exact `board://<host>` origin, as its existing board-port handshake does. |
| Page unload, navigation, reload, window close? | Shim closes on `pagehide`; main's `disposeBoardPort(boardId)` is authoritative fallback for unmount/reload and host/window destruction. Both use `renderer-reloaded` plus a readable message; service receives the close and runs `onClose` once. |
| Service exit/restart/untrust? | Close all generation-owned channels before retry/restart; use `service-exited` for exit/restart and explicit stop, `untrusted` for revoked trust, and `quit` for app quit. Send a close envelope when the host is alive; on abrupt process death, the page wrapper maps peer closure to `service-exited`. Do not reconnect an old channel after restart. |
| Shutdown deadline? | Preserve the current 2,000 ms supervisor deadline. The host closes channels before awaiting service `onShutdown` callbacks; supervisor still kills the utility process at the existing deadline. |
| Ordering and backpressure? | Each port preserves FIFO. Add per-direction sequence/ack flow control with cumulative acknowledgements at most every 32 received messages or a queued microtask/next tick at burst end. Cap unacknowledged messages at 256 per direction. Enforce a 1 MiB serialized payload cap only for service→page messages in the utility process; page→service messages are bounded by count because board iframes cannot use Node's V8 serializer. `send()` throws `channel-backpressure` at the hard count bound; `writable` and `whenWritable()` make the bound usable by streaming producers. |
| Maximum open channels? | 16 per board frame and 128 per service across all windows/frames. Reject excess opens with existing `service-busy`; count only live channels and release counts on either-side close. |
| Payload contract? | Structured-cloneable payloads only, with no transfer-list argument in the public `send()` API. Both directions are count-bounded. Additionally reject service→page messages over 1 MiB by measuring with `v8.serialize()` in the Node utility process; page→service has no byte cap because board subframes are not Node-enabled. Reject clone failures synchronously with a coded `service-error` and document the asymmetric byte policy. |
| Lazy start? | Yes. `openChannel()` starts with mode `"request"`, exactly like `request()`, and uses the existing trust and `service` permission checks. `status()` and `stop()` remain non-starting. |
| Error codes? | Preserve lifecycle codes already used by service operations (`service-not-declared`, `permission-denied`, `untrusted`, `service-failed`, `service-exited`, `quit`, `trust-not-ready`); add `channel-backpressure` and `channel-message-too-large`; use `service-busy` for channel caps. Close callbacks get `{ code, message }`, so reasons are readable without parsing strings. |
| `broadcast()` / `onEvent()`? | Do not add in P0-A. A channel is already two-way and can stream pushed events; a global event subscription would duplicate transport and add routing/lifecycle behavior before a consumer needs it. |
| Future cross-board identity? | One service-side `onChannel` registration receives every channel. Same-board P0-A opens carry `info.page: { boardId }` and omit `info.interface` and `info.caller`; US-1704 cross-board opens reuse the same handler and populate those fields. Services distinguish same-board opens by their absence without a callback signature change. |

There are no unresolved design questions for implementation. The 16/frame, 128/service, 256-message, and 1 MiB service→page limits are concrete recommendations for implementation review; adjust them only if a real workload demonstrates a need.

## Acceptance Criteria

- A board with the `service` permission can `await persephone.service.openChannel(openMessage)`; the service starts lazily if stopped and receives the open message and `info.page.boardId` through `onChannel`.
- The returned page and service channel objects each support `send`, `onMessage`, `onClose`, `writable`, `whenWritable()`, and idempotent `close`; messages are structured-cloned and delivered FIFO in both directions. Each direction is limited to 256 unacknowledged messages; service→page payloads are additionally capped at 1 MiB.
- Receivers use cumulative acknowledgements at most every 32 messages or a queued microtask/next tick after an inbound burst ends, whichever comes first.
- The service's single `onChannel` registration receives same-board and future cross-board opens. For same-board opens, `info.interface` and `info.caller` are absent; US-1704 fills them for cross-board opens.
- The page receives service-pushed messages without polling. Multiple pages, frames, and windows can hold separate simultaneous channels to the same service.
- Open failures preserve lifecycle `.code` and `.message`; limit and backpressure failures are bounded and explicit. A full send window raises `channel-backpressure`; `writable` becomes false and `whenWritable()` resolves when capacity returns or rejects on close; channel caps raise `service-busy`.
- Page close/navigation/reload closes its channels as `renderer-reloaded`; service stop/restart/exit closes as `service-exited`; trust revocation closes as `untrusted`; app quit closes as `quit`. Both endpoints' `onClose` callback runs at most once with a readable reason.
- Service shutdown still completes or is killed within the existing 2,000 ms deadline, with channels closed before service shutdown handlers run.
- Phase 0 release remains bridge `1.42.0` via US-1710's single bump; this task adds no version bump. The boards guide, agent boards guide, API typings, existing What's New upcoming section, and developer documentation describe the new API and limits. Boards that require the method declare `minBridgeVersion: "1.42.0"`.
- No unit test or test harness is added. The implementation task uses the project's manual verification workflow.

## Files that do not need changes

| Path | Reason |
|---|---|
| `doc/active-work.md` | User will maintain the dashboard. |
| `doc/epics/EPIC-131.md` | User will maintain the epic. |
| `src/renderer/api/module-service.ts` and `src/renderer/content/providers/ProxyProvider.ts` | Existing host-renderer provider lease remains separate; board-page channel data uses its own port path. |
| `src/shared/board-bridge-version.ts` | US-1710 owns the single Phase 0 bridge bump to `1.42.0`; this task must not bump it. |
| `qa/**`, `mneme/tests/**` | No test or harness requested; no bridge-version tests were found. |
| `assets/demo-board/**` | Not needed to expose the platform contract; guide examples document usage. |

## Files Changed Summary

| File | Planned change |
|---|---|
| `src/ipc/module-service-channels.ts` | Channel wire types, close reasons, limits, backpressure code. |
| `src/main/module-service-record.ts` | Per-service channel ownership records. |
| `src/main/module-service-supervisor.ts` | Lazy open, port transfer, count limits, cleanup on service lifecycle. |
| `assets/module-service-host.mjs` | Service `onChannel` API, message/ack protocol, close and shutdown behavior. |
| `src/main/board-bridge.ts` | Authorized open routing and board-frame teardown. |
| `src/ipc/board-bridge-channels.ts` | Board open RPC and typed channel delivery envelopes. |
| `src/ipc/api-types.ts` | Main-to-host channel port event. |
| `src/ipc/renderer/api.ts` | Ports-aware host-renderer subscription. |
| `src/renderer/editors/board/BoardWebview.ts` | Route transferred endpoint to matching iframe. |
| `src/board-shim.ts` | Page-facing `openChannel()` and lifecycle wrapper. |
| `src/renderer/editors/board/board-api.d.ts` | Public channel, `writable`/`whenWritable()`, and info types. |
| `assets/guides/boards.md` | Append API, permission, limits, lifecycle, producer pattern, and `minBridgeVersion` to the shared `1.42.0` guide entry. |
| `assets/guides/agents/boards.md` | Document the service-channel API and its writable/backpressure pattern for agent-authored boards. |
| `assets/guides/whats-new.md` | Append service channels to the existing Version 5.0.13 upcoming entries. |
| `doc/architecture/overview.md` | Document streaming channel beside request/reply and lease. |
| `doc/architecture/scripting.md` | Document page and service channel APIs. |
| `doc/architecture/key-files.md` | Index channel ownership file if one is introduced; document the channel API alongside the shared bridge-version entry. |
| `doc/tasks/US-1703-service-channels/README.md` | This implementation plan. |

