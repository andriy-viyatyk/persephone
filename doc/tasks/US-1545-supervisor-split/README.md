# US-1545: Split the module-service supervisor; one state-transition helper

Epic: [EPIC-115](../../epics/EPIC-115.md#us-1545-split-the-module-service-supervisor-one-state-transition-helper)

## Goal

Split the current module-service supervisor into focused lifecycle, lease, handshake/message-routing, and restart-budget units while retaining its importer-facing API and runtime behavior. Centralize status transitions and reason-to-error-code conversion, and fix the confirmed explicit-stop-during-start reason loss.

## Background

The epic's initial evidence used an earlier checkout; this audit uses the current tree. `src/main/module-service-supervisor.ts` is 949 lines and owns trust-gated records, process start/stop, IPC routing, renderer leases, storage, logs, restart policy, and status publication. US-1535 has already changed `ServiceRecord.leases` to `Map<number, RendererLease>` and added per-window lifecycle listeners. US-1536 removed `BoundedServiceLog`; output is now split into lines and sent to `board-log.append`. US-1538's `awaitTrustReady()` and main-owned trust snapshot are present. US-1543's `ServiceHostConfig`, structured `{code,message}` response decoding, and `{ok:true}|{ok:false,error}` port result are present.

### Audit of the US-1545 evidence

| Epic item | Current finding |
|---|---|
| Mixed responsibilities; 922-line supervisor | **Still holds, updated size:** 949 lines. Process startup and steady-state message handling are nested in `startOneAttempt()` (`src/main/module-service-supervisor.ts:526-697`); trust/record APIs, storage policy, lease handling, restarts, and status are also in this class. |
| Steady-state response branch can be dropped after handshake | **The defect is already fixed:** `response` is handled at `:619-637` before `if (settled) return` at `:639`. Preserve this ordering in extracted `routeProcessMessage(record, msg)`; gate only attempt-scoped handshake messages. |
| Many direct `record.state` assignments / emits | **Still holds:** state and reason are assigned at many lifecycle sites (`:156-169, 435-445, 490-492, 499-521, 659-664, 741-763, 784-786, 823-827, 939-941`). Move these writes behind one `transition(record, state, reason)` helper; status publication must remain coupled to transitions where it is currently emitted. |
| Duplicated reason-to-code expressions/maps | **Still holds:** `stopRecord()` maps stop reasons to request codes and lease reasons (`src/main/module-service-supervisor.ts:787-801`); `failLease()` maps lease reasons to transfer-attempt errors (`:875-884`); renderer `leaseLossCode()` maps reasons for pending renderer requests (`src/renderer/api/module-service.ts:89-95`); and `statusFailureCode()` maps service status for pending work (`:97-105`). These are distinct outcomes: a lease-lost `renderer-port-attach-failed` rejects pending renderer requests with `service-exited`, while the attach attempt itself rejects with `renderer-port-attach-failed`. Centralize both mappings, plus stop-to-lease-reason mapping, in typed tables in `src/ipc/module-service-channels.ts`; preserve each current outcome. |
| Explicit stop during a start is converted to quit | **Defect still exists:** `stopRecord(record, "explicit")` synchronously sets `stopRequested`, sets `stopping`/`explicit`, then invokes `cancelAttempt` without emitting (`src/main/module-service-supervisor.ts:778-801`). That rejection enters `runStartAttempts()`'s catch while `stopRecord()` is awaiting process exit; the catch emits `stopped`/`quit` and rejects the start waiter as `quit` (`:496-502`). Renderer `statusFailureCode()` consequently rejects pending lease work with `quit` (`src/renderer/api/module-service.ts:97-105`). `stopRecord()` later emits `stopped`/`explicit` (`src/main/module-service-supervisor.ts:823-827`), so consumers can observe both the false interim quit and the final explicit stop. Fix at the root: once `stopRequested` is true, `stopRecord()` owns the transitions; start-attempt abort branches only throw `ServiceError(abortCode(record))` and do not transition or emit. Also make `abortCode(record)` return `quit` when disposing, the table code for the recorded stop reason when stop was requested, and `untrusted` when trust is lost without a stop request. |
| `handleUnexpectedExit` stop/trust branch is unreachable/redundant and tests an overwritten reason | **Stale branch still present:** it first sets `record.reason` to `service-exited:${code}` (`:749-753`), then tests the replaced value (`:754-758`). It is unreachable: `stopRecord()` increments `record.generation` synchronously before its first await (`:783`); `applyBoardServiceTrustSnapshot()` calls `stopRecord()` synchronously for records losing trust (`:196-215`); `disposeAll()` calls it for every record (`:378-385`); and `forceKillAllSync()` clears `record.process` before killing (`:394-411`). Therefore an exit callback that passes `isCurrent()` has `stopRequested === false`, `disposing === false`, and a trusted board. Delete this branch. If trust is lost through a future reachable route, `runStartAttempts()`'s `assertStartable()` already transitions to stopped/untrusted. Keep the terminal restart-budget branch and preserve `service-exited:${code}` as `reason` when transitioning to failed (`:749-763`). |
| Restart limit is repeated literal `3`; `statusOf()` mutates count without clamp | **Still holds:** retry checks at `:512` and `:760`, clamp at `:913`, and `statusOf()` prunes timestamps then assigns an unclamped `failureTimestamps.length` at `:923-928`. Replace with `RestartBudget`; querying status projects `min(RESTART_BUDGET, timestamps within FAILURE_WINDOW_MS)` without mutation. When `terminalFailure` is set, keep the count frozen as today because `statusOf()` skips pruning. Preserve `runStartAttempts()`'s `firstFailureAlreadyCounted` semantics. |
| `request(..., requestId, ..., deadlineMs)` dead parameters | **Partly stale:** `requestId` is live and distinct at each caller for response correlation (`src/ipc/main/board-handlers.ts:142-146`, `src/main/board-bridge.ts:262-267`; response lookup `src/main/module-service-supervisor.ts:619-635`). `deadlineMs` is always `SERVICE_REQUEST_DEADLINE_MS` at both callers and can be removed mechanically, with the supervisor using the shared constant. |
| `ModuleServiceSupervisorApi` and `RendererLeaseState` unused | **Still holds:** no import/reference exists outside their declarations (`src/main/module-service-supervisor.ts:946-949`, `src/ipc/module-service-channels.ts:16`). Remove both. |
| Renderer `watchKey()` identity function | **Still holds:** defined as `return subscriptionId` (`src/renderer/api/module-service.ts:67-69`) and used only to key lookup/set at `:203,416-422`. Use `subscriptionId` directly. |
| `leaseLossCode` has identical fallback branches | **Still holds:** final `renderer-port-attach-failed` case and default both return `service-exited` (`src/renderer/api/module-service.ts:89-95`). Replaced by the shared table. |
| Stacked JSDoc and stale lease comment | **Still holds:** `forceKillAllSync()` has consecutive JSDoc blocks (`src/main/module-service-supervisor.ts:387-393`). The `requestService` documentation says the lease “could never attach” (`src/renderer/api/boards.ts:420-430`); that refers to an obsolete failure mode, because script/agent requests route through main (`src/renderer/api/boards.ts:429-430`) and do not require a lease. Replace with a current route description. |
| Move `BoundedServiceLog` out | **Gone:** no class/constants remain in the supervisor; it calls `boardLog.append()` (`src/main/module-service-supervisor.ts:547-558`; `src/main/board-log.ts`). |
| US-1535 lease map and lifecycle listeners belong with lease code | **Still holds and is landed:** per-owner map and attach logic at `src/main/module-service-supervisor.ts:321-350`; `listenForLeaseLifecycle()` and listener removal at `:887-907`. Extract these together into `src/main/module-service-leases.ts`. |
| US-1538 trust readiness/snapshot ownership | **Already landed:** snapshot is applied at `src/main/module-service-supervisor.ts:133-217`; `awaitTrustReady()` gates calls at `:418-421`. Keep this behavior with no renderer snapshot changes. |
| US-1543 host protocol, error response, port result changes | **Already landed:** shared contract at `src/ipc/module-service-channels.ts:26-34,64-90`; supervisor sends config in `:678-695` and decodes structured errors at `:619-635`; IPC handler returns the port result union at `src/ipc/main/board-handlers.ts:121-140`. Preserve these contracts. |
| Board bridge version | `src/shared/board-bridge-version.ts:1-2` currently defines `1.22.0`. This refactor does not alter board-visible shapes or the service wire protocol. The explicit-stop correction and the newly emitted stopping status are the only intended observable changes; neither changes the service status shape or protocol. Lease-lost `renderer-port-attach-failed` continues to yield `service-exited` to board requests. **No `BOARD_BRIDGE_VERSION` bump is expected.** |

### Standing-rule audit

- **`BOARD_BRIDGE_VERSION`:** no bump. No result shape, `persephone.*` member, or service protocol changes; the corrected stop reason and newly emitted stopping status use existing fields and protocol values.
- **Invoke changed message paths twice live:** the request path must be invoked twice after the service is already ready; both replies must resolve. This is in the live verification checklist below.
- **Cross-repo US-1543:** the protocol change is already landed and is outside this structure-only story. This story leaves the service protocol unchanged, so no `persephone-boards` change is scoped here.
- **Transition publication:** accepting the new `stopping`/reason event is the one additional observable status change. `stopping` is an existing `BoardServiceState`; the renderer already handles it in `statusFailureCode()`, and main rejects requests synchronously at that point, so failing renderer lease work then is consistent. `transition()` will publish the stop's `stopping` state before shutdown and the final `stopped` state after it.

### Before → after examples

Explicit stop while the handshake is pending currently records `explicit`, then `runStartAttempts()` publishes a premature `stopped`/`quit` and rejects the start waiter as `quit` while `stopRecord()` is still awaiting exit. The stop path should publish `stopping`/`explicit`, let the attempt unwind without a transition, then publish `stopped`/`explicit`:

```ts
// Before: runStartAttempts() after cancelAttempt rejects
const stopReason = record.reason === "untrusted" ? "untrusted" : "quit";
record.state = "stopped";
record.reason = stopReason;
this.emit(record);
throw new ServiceError(stopReason);

// After: stopRecord owns transitions; attempt code only reports why it aborted
throw new ServiceError(abortCode(record));
```

`abortCode(record)` is used at the stop/disposal/trust abort checks in `runStartAttempts()` and `startOneAttempt()` (`src/main/module-service-supervisor.ts:486-488, 497-502, 528-530, 560-565`). Its precedence is: disposing → `STOP_REASON_CODE.quit`; stop requested → `STOP_REASON_CODE[record.reason]`; otherwise untrusted → `untrusted`. Keep the stop reason typed as `ServiceStopReason` at this boundary. The no-stop/untrusted case must not fall through to `quit`.

State changes and event publication are currently repeated at each branch:

```ts
// Before
record.state = "running";
record.reason = undefined;
this.emit(record);

// After
transition(record, "running", undefined);
```

`transition()` publishes every transition, including `stopping`. `countFailure()` currently emits and is immediately followed by the failed/stopped transition in both startup and crash-restart paths (`src/main/module-service-supervisor.ts:909-916, 510-521, 749-763`). Move failure recording into `RestartBudget` without publishing; the next transition carries the updated `restartCount`, removing the duplicate event.

The renderer currently collapses one lease reason in a local conditional map:

```ts
// Before
function leaseLossCode(reason: RendererLeaseLostReason): string {
    if (reason === "superseded") return "renderer-reloaded";
    if (reason === "untrusted") return "untrusted";
    if (reason === "quit") return "quit";
    if (reason === "renderer-port-attach-failed") return "service-exited";
    return "service-exited";
}

// After: renderer pending work uses the lease-lost outcome table
const code = LEASE_LOST_CODE[reason];
```

The tables answer separate questions and preserve current observable codes: `STOP_REASON_CODE: Record<ServiceStopReason, ...>` maps `untrusted → untrusted`, `quit → quit`, `explicit → service-exited`; `LEASE_LOST_CODE: Record<RendererLeaseLostReason, ...>` maps `superseded → renderer-reloaded`, `stopping → service-exited`, `untrusted → untrusted`, `quit → quit`, `service-exited → service-exited`, and `renderer-port-attach-failed → service-exited`. `STOP_REASON_LEASE_REASON` maps `explicit → stopping`, `untrusted → untrusted`, and `quit → quit`. For an attach attempt itself, main's outcome is `reason === "renderer-port-attach-failed" ? "renderer-port-attach-failed" : LEASE_LOST_CODE[reason]`; use that specific code for the transfer rejection, while lease-lost pending requests use `LEASE_LOST_CODE`. These outcomes must not be collapsed into one table lookup. The plain `.mjs` host cannot import TypeScript tables and remains unchanged.

The host at `assets/module-service-host.mjs:113-138` sends typed `lease-lost` reason and structured pending-request errors; `attachRenderer()` maintains host-side leases keyed by nonce (`:125-138` and elsewhere). Renderer port acquisition consumes the structured result union (`src/renderer/api/module-service.ts:308-312`). Do not reintroduce string parsing or move service lifecycle ownership into the host; US-1543 established that the host owns the protocol contract and main owns process lifecycle.

### Current design boundaries

- Keep `moduleServiceSupervisor` and the current exported method surface in `src/main/module-service-supervisor.ts`; its callers include `src/ipc/main/board-handlers.ts`, `src/main/board-bridge.ts`, `src/main/board-trust-service.ts`, `src/main/main-setup.ts`, and status queries. Keep the `request` request-id parameter; remove only the redundant deadline parameter if the internal API can be mechanically updated.
- Put shared `ServiceError`, `ServiceRecord`, `RendererLease`, and `PendingRequest` types, `isCurrent()`, and `killUtilityProcessSync()` in new `src/main/module-service-record.ts`. This is the shared dependency for the supervisor, message router, and lease helper; extracted modules import it and never import the supervisor.
- Put per-window lease state and operations, including `listenForLeaseLifecycle`, in `src/main/module-service-leases.ts`; this code depends on Electron `WebContents`/ports and the shared channel contract. The supervisor passes a small callbacks object for `transition`, trust checks, process access/posting, and status/error handling; lease code does not import the supervisor singleton.
- Put attempt-local handshake state and routing in `src/main/module-service-handshake.ts`: a small `Handshake` owns nonce, ready/probe flags and timeout/settlement; `routeProcessMessage(record, msg, callbacks)` routes storage requests, renderer attach acknowledgements, steady-state responses, and handshake messages. Pass callbacks such as `transition`, `isTrusted`, and lease-ack handling; do not import the supervisor or create a cycle. Keep responses routable after handshake settlement.
- Add named `RESTART_BUDGET = 3` and `FAILURE_WINDOW_MS = 60_000` in `src/main/module-service-restart-budget.ts`; project capped counts without mutation and preserve terminal-count freezing and `firstFailureAlreadyCounted` semantics.
- Put the rolling failure timestamps, 60-second window, three-restart cap, and `restartCount` projection in `src/main/module-service-restart-budget.ts` as `RestartBudget`. Expose count/query and failure-recording/reset operations; status reads must not mutate state.
- Keep a single status-writing `transition(record, state, reason)` in the supervisor. It should set state/reason and publish once, so process lifecycle branches cannot drift. `stopRecord()` calls it for `stopping` before shutdown and `stopped` after shutdown. Status-only changes such as declaration or restart-budget updates should refresh through the same publishing helper without inventing a state change. Remove `countFailure()`'s immediate emit; the subsequent transition publishes the new count once.



### Files that need no changes

- `src/shared/board-bridge-version.ts` — no board-visible API/protocol change; keep version `1.22.0`.
- `src/main/board-trust-service.ts` — already awaits and applies the main-owned trust snapshot; supervisor extraction must preserve its calls.
- `src/main/module-service-storage.ts` — storage adapter already uses shared channel types and is a separate cohesive collaborator.
- `assets/module-service-host.mjs` — host lifecycle protocol is already established; it cannot import the TypeScript tables and remains unchanged.

## Implementation Plan

- [x] `src/ipc/module-service-channels.ts` - remove unused `RendererLeaseState`; add typed `STOP_REASON_CODE`, `LEASE_LOST_CODE`, and `STOP_REASON_LEASE_REASON` tables. Preserve distinct attach-attempt and pending-request outcomes.
- [x] `src/main/module-service-record.ts` (new) - own shared service errors, records, leases, pending requests, process identity checks, and synchronous process cleanup.
- [x] `src/main/module-service-restart-budget.ts` (new) - implement the rolling, capped restart budget with side-effect-free count projection, terminal freezing, and explicit-start reset.
- [x] `src/main/module-service-leases.ts` (new) - extract per-window lease ownership, lifecycle listeners, transfer, timeout, and drop-renderer behavior behind supervisor-supplied process callbacks.
- [x] `src/main/module-service-handshake.ts` (new) - extract nonce-scoped handshake and process-message routing; preserve structured errors and response routing after settlement.
- [x] `src/main/module-service-supervisor.ts` - compose the helpers; centralize state transitions; fix stop-during-start abort handling; preserve trust, host config, response ordering, request IDs, and cleanup behavior; remove dead branches and types.
- [x] `src/renderer/api/module-service.ts` - use shared reason-code tables and remove `watchKey()`.
- [x] `src/renderer/api/boards.ts` - replace the obsolete lease-failure documentation.
- [x] `src/ipc/main/board-handlers.ts` and `src/main/board-bridge.ts` - remove the redundant deadline argument while preserving request IDs.
- [x] `assets/module-service-host.mjs` - verify its existing init, response, lease-lost, and drop-renderer contract remains compatible; no source change.
- [x] No `BOARD_BRIDGE_VERSION` bump; keep version `1.22.0`.
## Concerns / Open Questions

- **Reason versus error code:** Keep lifecycle reason (`explicit`) distinct from rejection code. `abortCode(record)` maps explicit stop to `service-exited` for the start waiter while status retains `reason: "explicit"`; app quit maps to `quit`. The only intended code correction is the start waiter/status interim case currently mislabeled `quit`.
- **Attach failure codes:** Preserve both current outcomes. Pending work on a renderer lease lost for `renderer-port-attach-failed` continues to reject with `service-exited` (`src/renderer/api/module-service.ts:89-95`); the attach attempt itself continues to fail with `renderer-port-attach-failed` (`src/main/module-service-supervisor.ts:875-884`, returned via `src/ipc/main/board-handlers.ts:121-140`). Changing the former would be board-visible and require a bridge bump, so this refactor must not do so. The `.mjs` host cannot import the TS tables and remains unchanged.
- **Transition helper and emits:** `transition()` publishes `stopping`/reason on stop, an accepted observable change, followed by the existing final stopped event. `countFailure()` must stop publishing; it is immediately followed by a transition whose status carries the updated count, removing a duplicate emit. Status-only refreshes should delegate to the same publisher without fabricating state changes.
- **API surface:** `requestId` is needed for response correlation. `deadlineMs` is redundant at current call sites, but retain the supervisor's public method shape if removing it would break an importer or test seam; current repository call sites are mechanical to update.
- **Dead branch deletion:** The exit callback is guarded by exact process/generation identity (`src/main/module-service-supervisor.ts:669-675`), while `stopRecord()` invalidates generation before awaiting shutdown (`:778-785`). Preserve that invariant and avoid an exit branch that relies on `record.reason` after replacing it with an exit reason.
- **Live behavior remains required:** The epic requires repeated live request-path verification. This task document records that as acceptance work; this planning task does not execute the app or change code.

## Acceptance Criteria

- [x] `moduleServiceSupervisor` remains import-compatible for all current importers; no board-visible API or service protocol shape changes.
- [x] All lifecycle state/reason mutations that publish status flow through exactly one `transition(record, state, reason)` helper; status queries do not mutate restart state.
- [x] Process routing is extracted and a second request after readiness receives its response; attempt handshake messages remain generation/nonce scoped.
- [x] Lease logic is extracted with per-window ownership, lifecycle listener cleanup, supersede-on-same-window reload, and `lease-lost` reason-to-code coverage intact.
- [x] Shared typed reason-to-code tables serve main and renderer, return code values directly, and cover every `RendererLeaseLostReason` including `stopping` and `renderer-port-attach-failed`.
- [x] Typed stop, lease-loss, and stop-to-lease-reason tables preserve every current observable code, including `renderer-port-attach-failed` → `service-exited` for pending renderer work and `renderer-port-attach-failed` for the attach attempt itself.
- [x] Explicit stop during startup leaves the start waiter with `service-exited`; status is `starting` → `stopping`/`explicit` → `stopped`/`explicit`, never `stopped`/`quit`. Quit teardown remains `quit`.
- [x] `RestartBudget` preserves the 60-second rolling window, three-restart limit, terminal count freeze, and `firstFailureAlreadyCounted` behavior; reported count is clamped and status reads are side-effect free.
- [x] `countFailure()` no longer publishes; each failure path publishes the new count once through its following transition.
- [x] `BoundedServiceLog` remains absent; US-1538 trust readiness and US-1543 host config/structured errors/port result union remain intact.
- [x] No `BOARD_BRIDGE_VERSION` bump; `src/shared/board-bridge-version.ts` stays at `1.22.0` because no board-visible shape or protocol changes.
- [x] Live verification completes: service start → ready → request (invoke the request path twice) → explicit stop during start → crash restart until budget stops it → untrust teardown → quit teardown; confirm there is no orphaned `utilityProcess`.

### Live verification

Run 2026-09-28 against a cold-started dev build, each step twice, on two boards: the unmigrated
raw-`parentPort` fixture `US1534Demo` and a scratch copy of the migrated demo-board service
(`US1543Demo`, trusted for the run and untrusted afterwards). Service pids were checked with
`process.kill(pid, 0)` and the `NodeService` utility-process list.

- [x] Start: `starting` -> `running` with a pid.
- [x] Request twice on the ready service: both replies arrive; a service-side error arrives twice
      with its code.
- [x] Explicit stop during start, two variants (stop issued 5 ms after start; stop while the
      restart is held in `starting` by the fixture's one-shot handshake hang): the status sequence is
      `starting` -> `stopping/explicit` -> `stopped/explicit`, never `quit`; the start caller and a
      queued request both reject `service-exited`; the hung child is gone.
- [x] Crash restarts: `rc1` -> `rc2` -> `failed/service-exited:1/rc3`; a request after that is
      refused; two status reads a second apart both report 3; an explicit start resets it to 0.
- [x] Untrust during an in-flight 3 s request: the request rejects `untrusted`, status goes
      `stopping/untrusted` -> `stopped/untrusted`, pid gone; re-trust gives `stopped/not-started`.
- [x] Renderer lease (stream-host page reading `mem://` ranges through `ProxyProvider`): two range
      reads return 206; explicit stop under the lease, then two reads re-acquire and succeed; a crash
      under the lease, then two reads succeed on the restarted service.
- [x] Quit teardown through the real `will-quit` gate, once with a `running` service and once with
      a service held in `starting`: every electron process, including the service child, is gone.

### Not verified

- Supersede (same-window reload) and `render-process-gone` lease loss were not exercised live; the
  lease code moved without logic changes.
- The `forceKillAllSync` backstop (disposal exceeding the 5 s quit gate) was not forced.

## Files Changed Summary

| Path | Planned change |
|---|---|
| `doc/tasks/US-1545-supervisor-split/README.md` | Reviewed implementation plan and progress checklist. |
| `src/ipc/module-service-channels.ts` | Shared reason-to-code table; remove unused lease-state type. |
| `src/ipc/module-service-channels.ts` | Shared reason-code tables; remove unused lease-state type. |
| `src/main/module-service-supervisor.ts` | Compose extracted modules; central transition helper; fix explicit stop; remove stale/dead code. |
| `src/main/module-service-record.ts` | New shared record/error/process types and lifecycle utilities for extracted modules. |
| `src/main/module-service-leases.ts` | New cohesive lease lifecycle module. |
| `src/main/module-service-handshake.ts` | New process message routing and handshake module. |
| `src/main/module-service-restart-budget.ts` | New capped rolling restart-budget module. |
| `src/renderer/api/module-service.ts` | Shared code mapping and remove identity key helper. |
| `src/renderer/api/boards.ts` | Correct stale service-request documentation. |
| `src/ipc/main/board-handlers.ts` | Remove redundant deadline argument if applied. |
| `src/main/board-bridge.ts` | Remove redundant deadline argument if applied. |
