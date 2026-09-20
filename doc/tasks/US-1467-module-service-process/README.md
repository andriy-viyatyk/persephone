# US-1467: Module service process — `utilityProcess` host, handshake, restart budget, untrust shutdown

## Goal

Add a main-process supervisor for trusted board services declared by US-1466. It will lazily host each
service in Electron `utilityProcess`, expose a main-side request/port handoff contract for US-1468,
bound failures and outstanding work, and guarantee teardown on exact loss of trust and application quit.

This document is a design and implementation plan only. No implementation is part of US-1467 until this
document is reviewed.

## Background

### Binding epic decisions and boundaries

This task implements EPIC-106 D1, D3, D4, D5, and D7 as written. In particular:

- `permissions` remains disclosure/lifecycle hygiene, not a grant record or security boundary (D1).
- The service receives a renderer-facing `MessagePort`; there is no direct service-to-board-frame port
  (D3). A frame request remains an ordinary bridge call routed through main.
- The supervisor, not the service, owns restart, readiness, shutdown, and the restart budget (D4).
- Status is structured and observable, including state, reason, and restart count (D5).
- Only the service's own outstanding requests settle here; capability-bus work is Phase D (D7).

The task does not add permission grants, change trust-file format, implement storage, implement
`boards.list()` or renderer `persephone.service.request`, add a frame port, implement Phase C providers,
or implement capability-request settlement.

### Verified current architecture

The following claims were checked against the source during investigation:

| Verified fact | Source and consequence |
|---|---|
| `utilityProcess` and `fork(` are unused in `src/` | `rg -n "utilityProcess|fork\\(" src` returned no matches. Electron 43 typings do expose `utilityProcess.fork`, `UtilityProcess.postMessage`, `UtilityProcess.kill`, `pid`, `message`, `spawn`, and `exit`. The API is greenfield. |
| Existing supervision analogue | `src/main/sidecar-process.ts` is 350 lines. `SidecarProcess.start()` joins an existing `pendingStart`; `restart()` calls `stopAndWait()` before spawning; readiness has a timeout; `close` checks `this.proc === proc` before changing shared state; clean stops detach the child so they do not look like unexpected exits. US-1467 follows this lifecycle shape. |
| Existing board handshake shape | `src/main/board-bridge.ts:152-154` defines `BOARD_HANDSHAKE_TIMEOUT_MS = 5000`; `createBoardPort()` at `:467-502` starts the main port, transfers the peer with `postMessage`, and starts a watchdog that reports a missing `connected` message. The service handshake will use the same deadline/watchdog shape, with a service `ready` frame and a port-listener probe. |
| Existing board Node execution is not a service host | `src/main/board-bridge.ts:321-337` handles `RunnerChannel.start`; `node: true` rewrites the command to `process.execPath`, adds `ELECTRON_RUN_AS_NODE=1`, and calls `startJobTo`. `src/main/command-runner.ts` therefore uses `child_process.spawn`, with tree-kill behavior at its existing `:95-116` path. This is only a cwd/env/kill reference, not the implementation mechanism. |
| Existing command environment/kill behavior | `src/main/command-runner.ts:95-115` uses Windows `taskkill /PID /T /F` to reap a spawned tree; `:206-221` passes `{ ...process.env, ...opts.env }`, so the existing board runner is not a sanitized-environment precedent. `src/main/windows-env.ts:27-80` backfills standard Windows variables into main before child creation. US-1467 must build a fresh allowlist and use a tree-kill fallback for utility descendants on Windows. |
| Existing unbounded pre-connection queue | `src/board-shim.ts:227-239` holds all outbound messages in `sendQueue` until the board port connects, while request maps are separate. EPIC-106 explicitly rejects copying this shape for services; the supervisor/request adapter must reject above a fixed cap. |
| Trust is renderer-owned | `src/renderer/api/board-trust.ts:47-131` stores a reactive `TGlobalState`, lazily loads the line-delimited trust file through renderer `fs`, exposes `listPaths()` and `subscribePaths()`, and implements ancestor-aware `isTrusted()` at `:70-75`. It is not exposed through the app object model. |
| Exact untrust differs from trust checks | `boardTrust.untrust()` at `src/renderer/api/board-trust.ts:118-128` removes only an exact normalized path. `isTrusted()` at `:70-75` accepts an ancestor. Therefore an untrust request for a board covered only by an ancestor is a no-op and the supervisor must leave that service running. |
| Main shutdown composition | `src/main/main-setup.ts:136-145` handles `app.on("will-quit")`, currently calling `torService.shutdown()`, `killAllCommands()`, `disposeAllBoardPorts()`, and other shutdowns. The supervisor must be included here and must use an async prevent/release quit gate so a utility process cannot outlive the app. |
| Board-port shutdown precedent | `src/main/board-bridge.ts:538-545` exports `disposeAllBoardPorts()`, which is already wired to `will-quit`. It closes ports and reaps retained jobs, but does not currently supervise module services. |
| Service-only boards are absent from editor enumeration | `src/renderer/editors/board/custom-editor-registry.ts:95-145` subscribes to trust and enumerates `boardTrust.listPaths()`, but drops roots when `getBoardEditorAssociation()` returns `null` at `board-manifest.ts:443-465`. The service registry must be separate and must not relax editor association filtering. |
| Current board listing has a manifest-free synchronous path | `src/renderer/api/boards.ts:202-243` omits absent optionals and maps `currentBoardListings()` at `:221-223` with `manifest: undefined`; only `enumerateBoardListings()` at `:236-242` reads manifests. Therefore service status must come from the live supervisor/status registry and be merged additively by US-1468, not be recomputed only from the synchronous manifest path. |
| Trust dialog is currently path-only | `src/renderer/ui/dialogs/TrustBoardDialogView.ts:23-49` renders the path and generic RCE warning from `{ boardPath }`; it reads no manifest. US-1466 owns adding disclosure; US-1467 only needs the post-trust snapshot. |
| Existing trust file path and write behavior | `src/renderer/api/fs.ts:30-36, 520-542` resolves data files to `<userData>/data/<name>` and writes them directly. `board-trust.ts` uses `trustedBoards.txt`; US-1467 will not edit or reformat that file. |
| Existing IPC composition | `src/ipc/api-types.ts:26-128, 165-286` defines the typed endpoint enum and `Api`; `src/ipc/main/endpoint-registry.ts:15-29` provides the shared reply/error wrapper; `src/ipc/main/board-handlers.ts:25-79` registers board endpoints with dynamic imports; `src/ipc/main/controller.ts:7-12` is the composition root. The main-side service endpoint/port handoff must use this pattern. |
| Existing main-to-all-renderers status broadcast | `src/main/open-windows.ts:19-31` exposes `openWindows.send()`, and `src/main/clipboard-service.ts:161-170` increments/ broadcasts structured status through an `EventEndpoint`. US-1467 should publish supervisor status transitions through the same main-owned fan-out; US-1468 can hydrate after renderer reload from `getStatus()`/`boards.list()`. |
| Electron fork options | Installed Electron typings at `node_modules/electron/electron.d.ts:15686-15694, 21584-21628` confirm `utilityProcess.fork(modulePath, args, options)`, `cwd`, `env`, `stdio`, and `serviceName`; `UtilityProcess` supports `message`, `postMessage(message, transfer)`, `kill()`, `pid`, and `exit`. Fork is only legal after app `ready`, so supervisor initialization is main startup wiring, while actual starts remain lazy. |
| Current manifest has no service field yet | `src/renderer/editors/board/board-manifest.ts:39-178` currently ends at `guides`; no `service`, `permissions`, or `minBridgeVersion` exists in this checkout. Those fields, their normalizer, and the “may this board start a service” predicate belong to US-1466. US-1467 must consume that public contract and must not edit this file. |

### How main learns which boards are trusted

Main cannot import `src/renderer/api/board-trust.ts`: the trust model is renderer state and each window
has its own instance. The chosen answer is a renderer-to-main synchronization seam, not a trust-file
format change and not a filesystem watcher:

1. Add a renderer lifecycle adapter (owned by the application bootstrap, not by a board view) that awaits
   `boardTrust.load()`, takes `boardTrust.listPaths()`, and sends a complete snapshot to main.
2. Subscribe that adapter to `boardTrust.subscribePaths()`. On each change, it reloads the manifest
   service declarations for the current roots through the US-1466 normalizer/predicate and sends a new
   generation-numbered snapshot. A generation guard prevents an older async manifest scan from landing
   after a newer trust mutation.
3. Main stores the latest complete snapshot in the supervisor. It enumerates the exact roots in the
   snapshot (the same direct `listPaths()` enumeration used by the custom-editor registry), and uses the
   same normalized ancestor predicate when deciding whether a requested service root is still trusted.
4. On a snapshot diff, main stops only services whose root is no longer covered. Removing a child path
   that was trusted through a retained ancestor produces no diff in effective trust and therefore does
   not stop that service. Removing the covering ancestor stops every affected service.

The snapshot includes the normalized US-1466 service declaration and permission-gate result so main does
not duplicate renderer-only manifest code. Main still validates that a requested root is covered by the
latest trust snapshot and that its normalized declaration is present before starting. A request arriving
before the first snapshot is rejected as `trust-not-ready`, never treated as permission to start.

Before → after ownership shape:

```ts
// Before: trust exists only inside each renderer's BoardTrust instance.
boardTrust.listPaths(); // no main-process consumer

// After: the app bootstrap mirrors a complete renderer snapshot to main.
await boardTrust.load();
api.syncTrustedBoardSnapshot({ generation, boards: enumerateTrustedBoardServices() });
boardTrust.subscribePaths(() => void refreshAndSyncTrustedBoardSnapshot());
```

This is synchronization of the existing user decision, not a new grant record. It does not edit
`src/renderer/api/board-trust.ts`, `trustedBoards.txt`, or the ancestor semantics.

## Implementation Plan

### 1. Define the supervisor protocol and lifecycle record

Add a main-safe protocol/types module, planned as `src/ipc/module-service-channels.ts`, containing the
structured frames shared by main, the utility service entry, and US-1468's adapters. Keep imports direct;
do not use renderer barrel exports.

The supervisor record is keyed by `fpNormalizeForCompare(root)` but retains the original root for disk
access and status output. It holds:

- normalized service entry and permission-gate result from the synchronized US-1466 snapshot;
- lifecycle state: `stopped`, `starting`, `running`, `stopping`, or terminal `failed`;
- `reason`, `pid`, `startedAt`, and `restartCount` (the number of counted failures in the active
  sixty-second window, retained at three in terminal `failed`);
- the current `UtilityProcess`, a monotonically increasing generation/nonce, the current start promise,
  handshake timer, the main-side request map, and renderer-port lease metadata. The lease has its own
  state: `none`, `attaching`, `attached`, or `lost`;
- the failure timestamps used for the rolling budget and an explicit-stop flag distinguishing untrust,
  quit, and user stop from an unexpected exit.

Define the main-side interface that US-1468 consumes, without implementing its renderer surface here:

```ts
interface ModuleServiceSupervisor {
    syncTrustedBoardSnapshot(snapshot: TrustedBoardSnapshot): void;
    getStatus(boardRoot: string): BoardServiceStatus | undefined;
    start(boardRoot: string, mode: "explicit" | "request"): Promise<StartResult>;
    stop(boardRoot: string, reason: "untrusted" | "explicit" | "quit"): Promise<void>;
    request(boardRoot: string, requestId: string, message: unknown, deadlineMs: number): Promise<unknown>;
    transferRendererPort(boardRoot: string, target: WebContents): Promise<void>;
    disposeAll(): Promise<void>;
}
```

`request()` is the main-side channel for the ordinary board-frame bridge call. It lazily starts the
service, applies the per-service outstanding-request cap, sends a structured request over the utility
process parent channel, and settles the request map on response, deadline, process failure, untrust, or
quit. `transferRendererPort()` is the D3 renderer port handoff consumed by US-1468; it never creates or
transfers a port to a board frame. It creates or replaces a renderer lease, and its promise settles on
the lease handshake rather than on service start.

### 2. Synchronize trust and service declarations from renderer to main

Add the typed endpoint and renderer adapter plumbing in the existing locations:

- `src/ipc/api-types.ts`: add a private application endpoint and its `TrustedBoardSnapshot` payload
  type. The payload is a complete generation-numbered list, not add/remove deltas, so a renderer reload
  can reconstruct main state and a missed event cannot leave an orphan service trusted in main.
- `src/ipc/renderer/api.ts`: add the typed `syncTrustedBoardSnapshot()` call using `executeOnce`.
- `src/ipc/main/board-handlers.ts`: register the endpoint with a dynamic import of the supervisor.
- `src/renderer/api/board-trust-sync.ts`: await `boardTrust.load()`, enumerate `boardTrust.listPaths()`;
  read each manifest with the US-1466 normalizer and permission predicate; publish initial and subscribed
  snapshots with a generation guard. Service-only roots are retained because this module does not call
  `getBoardEditorAssociation()`.
- `src/renderer/api/app.ts`: initialize the process-lifetime sync adapter from `initEvents()` and keep
  its subscription alive for the renderer lifetime. This is a private bootstrap adapter, not an
  `app.<member>` service: it therefore has no entry in `IApp`, the service descriptor table, or
  `AppWrapper`. Do not put it in a board view that disappears when a page closes.

The adapter will consume the exact exported US-1466 service declaration/predicate rather than touching
`board-manifest.ts`. Since US-1466 is not present in this checkout, its integration contract is fixed
here: it must provide a normalized board-relative ESM entry and a boolean/diagnostic predicate stating
whether the declaration includes the `service` permission. No alternative raw-field interpretation is
allowed in US-1467.

### 3. Implement lazy `utilityProcess` start and the handshake

Add `src/main/module-service-supervisor.ts`. Model the start path after
`src/main/sidecar-process.ts`, but use Electron's `utilityProcess.fork` and message-port transfer:

1. `start(root, "request")` returns immediately if running and joins the record's existing start promise
   if starting. It never starts because a board is installed or because the trust snapshot arrived.
2. `start(root, "explicit")` verifies effective trust and the US-1466 permission predicate, clears the
   failure timestamps/terminal failure, and starts one fresh generation. Concurrent explicit/request
   starts join the same promise; they cannot fork twice.
3. Resolve the normalized board-relative entry against the absolute board root. Reject absolute or
   escaping paths, require the US-1466 ESM entry contract, and verify the file exists before forking.
   Set `cwd` to the board root. Node ESM package imports resolve from the entry's location and its
   ancestor `node_modules`, with the board root as the intended package boundary; do not use `NODE_PATH`
   as an ESM resolution mechanism.
4. Call `utilityProcess.fork(absoluteEntry, [], { cwd: boardRoot, env, stdio: "pipe", serviceName })`
   only after `app.ready` (the supervisor is initialized from main startup wiring, but starts only on
   request/explicit start). Record the process object and generation before awaiting anything. Pipe both
   stdout and stderr to a serialized bounded writer for `<boardRoot>/ui.log`; prefix each line with the
   board service identity and stream (`[service:<boardRoot> stdout]` or `[service:<boardRoot> stderr]`)
   and retain at most 256 KiB per board. Cap
   individual retained lines/chunks at 8 KiB and trim the oldest content when the file cap is exceeded.
   An import failure must therefore leave its module-resolution/stack message readable without allowing
   a chatty service to fill the board's disk allocation.
5. After the process has spawned, create the parent control channel only. Do not transfer a renderer port
   as part of service start. A later `transferRendererPort()` creates a `MessageChannelMain`, sends one
   endpoint to the utility service in an attach frame, and transfers the other to the requesting renderer
   only through US-1468's `WebContents.postMessage` handoff. The service receives no frame endpoint.
6. Require the service to install its utility parent-channel listener and post `{ kind: "ready", nonce }`.
   On `ready`, send a parent-channel probe and require `{ kind: "probe-ack", nonce }`. Publish `running`
   only after both frames arrive. This proves the service is listening to the main control channel and
   keeps liveness independent of whether any renderer has requested a port lease.
7. Use `SERVICE_HANDSHAKE_TIMEOUT_MS = 5000`, matching the existing board watchdog shape. On timeout,
   kill the exact current process, clear the slot, fail the start once, and do not leave a transferred
   port or request entry alive.
8. Ignore `message`/`exit` events whose process or nonce is no longer current. A process that exits 0
   before `ready` is still a failed start; exit code 0 is not success. A process that exits after ready
   is an unexpected failure and enters the budgeted restart path.

Service protocol shape:

```ts
// Main → utility parent channel (control and main-side bridge requests)
{ kind: "init", nonce }
{ kind: "probe", nonce }
{ kind: "request", requestId, message }
{ kind: "attach-renderer", generation, leaseNonce, rendererPort } // rendererPort is transferred
{ kind: "drop-renderer", generation, leaseNonce }
{ kind: "shutdown", nonce, reason }

// Utility → main parent channel
{ kind: "ready", nonce }
{ kind: "probe-ack", nonce }
{ kind: "renderer-attached", generation, leaseNonce }
{ kind: "response", requestId, result } | { kind: "response", requestId, error }

// Direct service ↔ renderer port
{ kind: "hello", generation, leaseNonce } ↔ { kind: "hello-ack", generation, leaseNonce }
{ kind: "request", requestId, message } ↔ { kind: "response", requestId, result | error }
```

The board service entry is responsible for listening to its utility parent channel and replying to the
parent probe only after that listener exists. `ready` is therefore not inferred from process spawn and is
not inferred from a process that merely remains alive. A healthy service is `running` even when no
renderer has requested a port.

The renderer port is a separate lease. `transferRendererPort()` marks the lease `attaching`, sends the
service endpoint and the renderer endpoint through US-1468, and requires the `hello`/`hello-ack` exchange
by its own deadline. A lease that never attaches rejects that call with `renderer-port-attach-failed`,
marks the lease `lost`, and does not kill the utility process, change service state, or consume restart
budget. A later call may acquire a fresh lease.

The lease is re-acquirable after renderer reload. A new transfer for the same root supersedes the old
lease, closes its main-side endpoint, tells the service to drop the old endpoint, and uses a new
`leaseNonce` together with the service generation so late messages from the dead lease are ignored.
Outstanding requests on the old lease reject as `renderer-reloaded`, rather than hanging; the service
itself remains `running` while the new lease attaches.

### 4. Define exact environment and path behavior

Construct a fresh environment object; never pass `process.env` wholesale. Pass only these inherited keys
when present (preserving the Windows `Path` spelling):

`Path`/`PATH`, `SystemRoot`, `SystemDrive`, `WINDIR`, `TEMP`, `TMP`, `USERPROFILE`, `APPDATA`,
`LOCALAPPDATA`, `PROGRAMDATA`/`ProgramData`, `ALLUSERSPROFILE`, `ProgramFiles`, `ProgramW6432`,
`ProgramFiles(x86)`, `CommonProgramFiles`, `CommonProgramW6432`, `CommonProgramFiles(x86)`,
`HOMEDRIVE`, `HOMEPATH`, `USERNAME`, `ComSpec`, `PATHEXT`, `OS`, `PROCESSOR_ARCHITECTURE`,
`NUMBER_OF_PROCESSORS`, `LANG`, `LC_ALL`, and `TZ`.

Add exactly `PERSEPHONE_SERVICE=1` and `PERSEPHONE_BOARD_ROOT=<absolute board root>`. Strip everything else,
including `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS`, `NODE_PATH`, `ELECTRON_*`, `NPM_CONFIG_*`/`npm_config_*`,
proxy variables, cloud/provider credentials, token/key/secret variables, and any other inherited key not
in the allowlist. This keeps Electron/Node injection flags and ambient secrets out while retaining the
Windows runtime and temporary-directory values ordinary npm packages need. The trusted service can still
use its declared board folder and the app's explicit service APIs; this is sanitization, not a D1 security
boundary.

### 5. Implement restart budget, status, and stop races

Use one serialized transition path per record, with a generation token and the sidecar stale-child guard:

- Count spawn errors, exits before `ready`, handshake timeout, probe timeout, and unexpected exits after
  `ready` as one failure each. Prune timestamps older than 60 seconds before each count.
- A renderer lease attach timeout or lease loss is not a service failure: it rejects only the lease call,
  never restarts or kills a running generation, and does not consume the restart budget.
- For failure counts 1 and 2, if effective trust still holds, stop/reap the exact old process and retry
  through the same pending-start path. Never let an old `exit`/`close` settle or restart a replacement.
- At count 3 within 60 seconds, stop retrying and retain `failed`, the last reason, and count `3`.
  Automatic retries never reset the budget.
- An explicit `start` first verifies trust, then clears the budget and terminal failure and starts a new
  generation. It is the only reset operation.
- A process that stops reading does not create an unbounded queue: each accepted request has a deadline;
  its entry is removed and rejects with `service-timeout` when the deadline expires. New requests beyond
  `MAX_OUTSTANDING_REQUESTS_PER_SERVICE` (chosen as 32 and exported in the protocol) reject immediately
  with `service-busy`. US-1468 must apply the same cap before posting to the direct renderer port.
- An untrust transition increments the generation, marks the record `stopping`, rejects every request in
  that record with `untrusted`, closes both port endpoints, cancels the handshake/restart timers, sends
  `shutdown`, and kills after `SERVICE_SHUTDOWN_TIMEOUT_MS` if the child does not exit. It then records
  `stopped` with reason `untrusted` and cannot auto-restart.
- Untrust/re-trust does not reset a failure budget. While untrusted the public state is `stopped` with
  reason `untrusted`, but the supervisor retains the rolling failure timestamps and terminal-failure
  marker. If the same board is trusted again, it is not auto-started; a retained terminal `failed` state
  remains visible until an explicit `start`, which is the only budget reset. A non-terminal budget also
  continues from its retained timestamps.
- A start racing an untrust rechecks generation and effective trust after every await (manifest read,
  process spawn, handshake, and port handoff). If trust was lost, it kills the just-created process,
  rejects the start as `untrusted`, and does not publish `running`.
- Two starts racing each other share one promise and one process. A stale explicit restart cannot replace
  a newer generation or reset its budget after the newer transition has begun.

Failure matrix (each row is an intentional state transition, not a log-only diagnosis):

| Failure | Required result |
|---|---|
| Fork throws or entry is missing/invalid | Start fails with `spawn-error`/`invalid-entry`, increments the rolling failure count, and retries only while trusted and below three. |
| Process exits 0 or nonzero before `ready` | Treat as one failed start (`process-exit-before-ready` plus exit code), kill/clear the generation, and use the same bounded retry path. Exit code 0 is not readiness. |
| No `ready` by 5 seconds | Kill the exact generation, settle start as `handshake-timeout`, close any renderer-lease endpoints created for that generation, and count once. |
| `ready` arrives but the service never answers the parent-channel `probe` | The parent probe deadline kills the exact generation as `port-not-listening`, counts one failure, and does not publish `running`. |
| A running service receives a renderer lease but the renderer never listens/acks `hello` | The lease deadline rejects `transferRendererPort()` as `renderer-port-attach-failed`, marks only the lease `lost`, and leaves the service `running` without consuming budget. |
| Renderer reload supersedes an attached lease | Close/drop the old endpoint, reject its outstanding requests as `renderer-reloaded`, ignore late old-lease frames by generation/nonce, and allow a new lease to attach while the service stays `running`. |
| Service import or package resolution fails | Pipe the process error to `<boardRoot>/ui.log` with the bounded service prefix, then report the pre-ready failure and apply the normal restart budget. |
| Service stops reading after running | Accepted requests reject on their individual deadlines as `service-timeout`; their slots are removed. New requests above 32 reject immediately as `service-busy`; no process restart is inferred solely from a slow request. |
| Unexpected exit after `ready` | Reject all outstanding requests as `service-exited`, count once, and restart only while the rolling budget permits. |
| Start races exact untrust | Generation/trust recheck kills any just-created child, rejects start and all requests as `untrusted`, and suppresses automatic restart. |
| Two starts race | One record-level pending promise and one process; later calls join it, with no duplicate port or restart. |

Before → after process ownership:

```ts
// Before: a board frame starts a child tied to its port/job sink.
startJobTo(portSink(entry, boardId), { ...msg, opts });

// After: main owns one generation and all termination causes.
const attempt = service.start(root, "request"); // deduped, lazy, deadline-bound
await service.stop(root, "untrusted");          // settles service requests + kills child
await service.disposeAll();                      // app quit, waits for reap
```

### 6. Wire untrust and quit without orphaning utility processes

Use the supervisor from `src/main/main-setup.ts`:

- Initialize its endpoint registration alongside the existing board handlers; do not enumerate or start
  services during `app.ready`.
- In `will-quit`, add an idempotent async gate for the new supervisor, but preserve the existing
  `torService.shutdown()`, `killAllCommands()`, `disposeAllBoardPorts()`, and other shutdown calls in
  their current order and synchronous form; do not reorder or make that shipped sequence async. The
  first event calls `event.preventDefault()`, starts bounded service disposal alongside that sequence,
  and repeated events observe the same gate rather than starting another teardown.
- The whole new quit gate has an absolute upper bound of a few seconds, chosen as
  `SERVICE_QUIT_GATE_TIMEOUT_MS = 5000`, independent of the per-service graceful shutdown deadline.
  Its completion path is a `finally`: whether disposal succeeds, times out, or throws, synchronously
  call `kill()` over every still-live utility child (and use the Windows tree-kill fallback where needed),
  release the gate, and call `app.quit()`. The app always quitting outranks every service stopping
  gracefully; there is no path where a hung service can make the app unquittable.
- Keep `disposeAll()` safe when no service has ever started and when a service is already dead. Do not
  depend on renderer teardown or `disposeAllBoardPorts()` to stop module services.

The live verification must use a service fixture (US-1470 or an equivalent temporary trusted board):

1. Start the service and record the PID from the supervisor status.
2. Trigger app quit and wait for the app process to exit.
3. Poll the recorded PID until absent, then inspect Windows process state (`Get-Process -Id <pid>` and,
   if the PID was recycled, `Get-CimInstance Win32_Process` for the service entry/Persephone utility
   command line) to prove no utility child for that board remains. Repeat with a service that ignores the
   graceful shutdown frame to exercise the kill deadline.
4. Also reload the renderer while the service is running, verify the same PID/status survives, acquire a
   new renderer lease, and verify requests through the new lease succeed while old-lease requests reject
   as `renderer-reloaded`; only app quit may reap the service in that scenario.

### 7. Expose only the main-side contract to US-1468

US-1468 will add `boards.list()` status, the renderer `MessagePort` listener, and
`persephone.service.request`. US-1467 supplies:

- `getStatus(root)` backed by the supervisor record, with the service field omitted for boards with no
  declaration;
- `start(root, "request"|"explicit")`, `request(...)`, and `stop(...)` semantics and error codes;
- `transferRendererPort(root, target)` which ensures lazy start, creates or replaces one renderer lease,
  settles only after its `hello`/`hello-ack` handshake, and never references a board frame. A renderer
  reload may call it again for the same root: the old lease is dropped, its pending requests reject as
  `renderer-reloaded`, and late old-lease messages are ignored by generation/nonce guards;
- status-change subscription/broadcast input so US-1468 can refresh `boards.list()` and reject its direct
  port's pending promises on `untrusted`, `quit`, or service failure;
- the shared frame/request protocol and `MAX_OUTSTANDING_REQUESTS_PER_SERVICE = 32`.

US-1468 must not add a second supervisor, restart policy, trust reader, or unbounded pre-connection queue.
The renderer direct-port adapter must start its `MessagePort`, cap before post, attach per-request
deadlines, and map supervisor status transitions to the documented `untrusted`/`service-failed` errors.

### 8. Verification plan (live failure modes, no unit tests)

No unit tests or harnesses will be added. Before implementation is accepted, run the project checks and
perform live observations against the running app/fixture:

- **Lazy start:** install/trust/relaunch with no request; verify no utility process and no `running`
  status. First request and explicit start each start exactly one process.
- **Never ready:** fixture omits `ready`; verify it is killed at 5 seconds, counted once, and does not
  occupy a running slot. Repeat with immediate exit code 0.
- **Parent channel not listened:** fixture sends `ready` but never answers the parent-channel `probe`;
  verify the probe deadline kills it, records `port-not-listening`, and consumes one restart failure.
- **Renderer lease not listened:** with a service already `running`, make the renderer adapter receive a
  lease but never call `port.start()`/answer `hello`; verify only `transferRendererPort()` rejects as
  `renderer-port-attach-failed`, the service remains running, and the restart budget is unchanged.
- **Service import diagnostics:** fixture throws during ESM import; verify the bounded, prefixed
  `<boardRoot>/ui.log` contains a readable import/module-resolution error.
- **Renderer reload lease:** reload while `running`, verify the old lease's requests reject as
  `renderer-reloaded`, late old-lease frames are ignored, and a fresh lease attaches and serves requests
  without changing the service PID or restart count.
- **Unread service:** fixture stops consuming requests; verify accepted calls reject at their deadlines,
  the request map drains, and calls beyond 32 reject immediately rather than accumulating.
- **Crash loop:** fixture exits after ready three times inside one minute; verify restart attempts stop at
  terminal `failed`, last reason and count remain readable, and explicit start resets the budget.
- **Trust races:** start a request, untrust during handshake, and race two starts; verify no late ready,
  restart, response, or `running` status escapes the generation guard. Test an exact trust removal and an
  inherited-trust child removal separately.
- **Untrust settlement:** hold a request open, exact-untrust the root, and verify it rejects as
  `untrusted`, the child stops within its bounded timeout, and a later request cannot restart it.
- **Untrust/re-trust budget:** drive a board to terminal `failed`, untrust and re-trust it, verify it does
  not auto-start and remains terminal until an explicit start resets the budget.
- **Renderer reload / app quit:** reload with a running service and verify lease re-acquisition and
  continuity; quit with both responsive and nonresponsive services and verify the five-second whole gate
  still releases and no orphan utility process remains as described above.
- Run `npm run typecheck`, `npm run lint`, and `npm run build-prod`; these are necessary but not sufficient
  because EPIC-106 D8 requires live verification.

## Concerns

### Resolved design concerns

- **Renderer-owned trust:** resolved with the generation-numbered snapshot adapter above; no trust file
  format or `board-trust.ts` edit is needed.
- **Service-only enumeration:** resolved by a dedicated trust snapshot/service registry, independent of
  `custom-editor-registry.ts` and `getBoardEditorAssociation()`.
- **D3 port boundary:** only the renderer port is transferred to the utility process; no frame port is
  created. Frame calls use `request()` through main.
- **Renderer lease versus service liveness:** resolved by publishing `running` after the parent-channel
  `ready`/`probe-ack` only. Renderer-port `hello`/`hello-ack` is an independently timed, re-acquirable
  lease handshake and cannot kill or restart a healthy service.
- **Stale process events:** resolved by process identity plus generation checks, matching the existing
  `SidecarProcess` stale-child guard.
- **Quit ordering:** resolved with an idempotent `will-quit` gate added alongside the existing shutdown
  sequence, a five-second whole-gate bound, `app.quit()` in `finally`, and a last-resort synchronous
  kill over every live service child before release.

### Remaining implementation risks to preserve in code review

- The US-1466 manifest API is not present in this checkout. Its exact exported normalized declaration and
  predicate must be available before implementation; US-1467 must consume them rather than duplicate
  raw-field parsing or edit `src/renderer/editors/board/board-manifest.ts`.
- A direct renderer↔service `MessagePort` is intentionally opaque to main. The main-side request method
  is capped in the supervisor; US-1468 must enforce the same cap/deadlines on its direct renderer-port
  adapter, or a stopped reader could still accumulate Chromium-side messages.
- Electron's `UtilityProcess.kill()` is the only typed termination primitive in the installed Electron
  API. The shutdown timeout must be tested on Windows, including a service that ignores the shutdown
  frame; do not claim orphan-free behavior from typecheck alone.
- The unquittable-app failure is more severe than a service that fails to stop gracefully. Any awaited
  shutdown step can hang or throw, so the implementation must retain the absolute whole-gate timeout,
  put `app.quit()` in `finally`, and synchronously kill every remaining child before releasing the gate.
- The service entry is trusted arbitrary Node code. Environment sanitization is deterministic hygiene,
  not a sandbox or a new permission boundary (D1).
- `UtilityProcess.kill()` does not itself document descendant-tree termination. The Windows quit/timeout
  path must capture the utility PID and, when the bounded wait expires or the process has spawned work,
  invoke the same `taskkill /PID <pid> /T /F` pattern already used by
  `src/main/command-runner.ts:95-115`, then verify the PID/command line is gone before releasing quit.

### Files that must not change

- `src/renderer/api/board-trust.ts` — use its existing `load()`, `listPaths()`, `subscribePaths()`, and
  `isTrusted()` semantics through the sync adapter.
- The `trustedBoards.txt` format or its storage location.
- `src/renderer/editors/board/board-manifest.ts` — US-1466 owns the service field, normalizer, and
  predicate.
- `src/main/board-bridge.ts`'s frame-port protocol, except for an additive call-site or handler hook if
  US-1468 needs to route `service.request`; do not create a frame↔service port.
- `src/renderer/editors/board/custom-editor-registry.ts` — service-only discovery is separate.
- Any `assets/editor-types/*.d.ts` file: US-1467 adds no renderer-facing public declaration. If US-1468
  later changes `src/renderer/api/types/*.d.ts`, it must copy the flat file to `assets/editor-types/` and
  list it in `_imports.txt`.
- No test file, test harness, or unit-test infrastructure.

## Acceptance Criteria

- [ ] The supervisor starts no service merely because a board is installed, trusted, or present in a
      launch-time snapshot; first request and explicit start are the only starts.
- [ ] A trusted board with a valid US-1466 declaration starts in `utilityProcess` with absolute ESM entry,
      board-root cwd, the exact allowlisted environment, and no renderer dependency for service liveness.
- [ ] Parent-channel `ready` plus `probe-ack` is required within 5 seconds; never-ready,
      immediate-exit-0, and parent-channel non-listening failures are killed, counted once, and leave no
      occupied slot.
- [ ] Renderer-port attachment is a separate `none`/`attaching`/`attached`/`lost` lease: a failed hello
      rejects only that transfer, does not kill or budget the running service, and a renderer reload can
      acquire a replacement lease while old-lease requests reject as `renderer-reloaded`.
- [ ] Start/restart calls dedupe; stale process events cannot change a newer generation.
- [ ] Three counted failures in 60 seconds produce terminal `failed` with last reason and count; explicit
      start resets the budget; automatic restart never resets it.
- [ ] Exact loss of effective trust stops the service, cancels restart, rejects all service requests as
      `untrusted`, and leaves a readable `stopped`/reason state. Removing an exact child path that remains
      trusted through an ancestor does not stop it.
- [ ] Outstanding requests are capped at 32 per service; excess rejects immediately, deadlines drain
      accepted requests, and no unbounded queue is created when a service stops reading.
- [ ] Service stdout/stderr uses `stdio: "pipe"` and bounded, prefixed `<boardRoot>/ui.log` output; an
      import/module-resolution throw leaves a readable diagnostic there.
- [ ] `disposeAll()` is wired alongside the unchanged existing app shutdown sequence with a five-second
      whole-gate bound, synchronous last-resort kill, and `app.quit()` in `finally`; live Windows
      verification proves no recorded utility PID or matching Persephone utility process remains after
      exit, including when graceful shutdown is ignored.
- [ ] Untrust/re-trust does not clear a terminal failure or auto-start the board; only explicit start
      resets its budget.
- [ ] The main-side contract for US-1468 is implemented without a frame port, a second supervisor, or
      capability-bus settling.
- [ ] No trust format, renderer board-trust module, manifest source, tests, or editor-type files are
      modified by this task.
- [ ] Live failure-mode observations and `npm run typecheck`, `npm run lint`, and `npm run build-prod`
      are recorded before the task is considered implemented.

## Files Changed

| File | Planned change |
|---|---|
| `src/main/module-service-supervisor.ts` | New main-owned service records, lazy utility-process lifecycle, parent handshake, renderer leases, restart budget, request settlement, trust diff, bounded logs, and quit disposal. |
| `src/ipc/module-service-channels.ts` | New shared service frames, parent/renderer-lease handshakes, status/error types, trust snapshot, and request-cap constant. |
| `src/ipc/api-types.ts` | Add typed trust-sync and main-side service handoff endpoint contracts; no renderer public service API yet. |
| `src/ipc/renderer/api.ts` | Add the internal trust-snapshot IPC call used by the bootstrap adapter. |
| `src/ipc/main/board-handlers.ts` | Register the internal trust-sync/service-supervisor endpoint(s). |
| `src/renderer/api/board-trust-sync.ts` | New process-lifetime adapter that mirrors `boardTrust.listPaths()` and US-1466 declarations to main. |
| `src/renderer/api/app.ts` | Initialize the private trust-sync adapter from `initEvents()`; no `IApp`, service-registry, or `AppWrapper` entry. |
| `src/main/main-setup.ts` | Initialize the supervisor wiring and add the bounded, finally-releasing `will-quit` service gate alongside the existing shutdown sequence. |
| `src/main/board-bridge.ts` | Only if needed for the additive frame `service.request` hook consumed by US-1468; no frame-service port. |
| `doc/tasks/US-1467-module-service-process/README.md` | This reviewed implementation plan. |

Files explicitly not changed are listed under **Concerns → Files that must not change**.
