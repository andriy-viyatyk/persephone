# US-1468 — Service surface: status, renderer port, and `persephone.service.request`

Linked epic: [EPIC-106 — Bridge contract and the module service process](../../epics/EPIC-106.md)  
Status: Planned

`doc/active-work.md` and `doc/epics/EPIC-106.md` are intentionally unchanged. The user task
explicitly forbids editing either file; the existing dashboard already links US-1468.

## Goal

Expose the live US-1467 service lifecycle through `boards.list()` and Board Info, give the host
renderer a bounded, re-acquirable `MessagePort` lease, and add the board-frame
`persephone.service.request(message)` bridge call. Wire service storage calls through the
main-owned US-1469 store so the frame and service share one per-board state without either
process writing `store.json`.

## Background

### Binding decisions and boundaries

This task implements the service-facing portion of EPIC-106 D3, D4, D5, and D6:

- D3: only the host renderer receives a service `MessagePort`. A board frame uses an ordinary
  request/reply method over its existing board bridge port; no port is transferred to a frame.
- D4: `src/main/module-service-supervisor.ts` remains the only owner of service start, stop,
  restart budget, trust gating, request settlement, and renderer-lease replacement. This task
  does not create another supervisor, restart policy, trust reader, or unbounded queue.
- D5: `boards.list()` and Board Info expose structured state, reason, restart count, pid, and
  start time. A missing status is not reconstructed from a manifest.
- D6: frame and service storage operations converge on the landed
  `src/main/board-storage.ts`. The utility process never opens, parses, or writes `store.json`
  itself.
- D7: only service-owned requests settle here. No capability-bus in-flight settling is added.

### Verified implementation state

The following was checked against the checkout on 2026-09-20; these are implementation facts,
not assumptions from the epic or task plans.

| Finding | Consequence for US-1468 |
|---|---|
| `ModuleServiceSupervisor` exports `syncTrustedBoardSnapshot`, `getStatus`, `start`, `stop`, `request`, `transferRendererPort`, and `disposeAll` through `ModuleServiceSupervisorApi` in `src/main/module-service-supervisor.ts`. | Consume this instance and its records. Do not read manifests in main or duplicate lifecycle logic. |
| `getStatus(boardRoot)` returns `BoardServiceStatus` with `state`, optional `reason`, optional `pid`, optional `startedAt`, and `restartCount`; `statusOf()` omits absent optionals. | Map this value into `BoardListing.service`, excluding the internal `boardRoot` because the listing already has `root`. |
| `syncTrustedBoardSnapshot()` creates records only for normalized declarations in the complete renderer-owned snapshot. New records begin `stopped` with `not-started` or `permission-denied`. | The status cache is keyed by normalized root and is independent of manifest reads in `boards.ts`. |
| `request()` rejects before the first snapshot with `trust-not-ready`; after a snapshot, a trusted root without a record rejects `service-not-declared`; a terminal failure rejects `service-failed`; over-cap calls reject `service-busy`; accepted calls have a deadline. | Preserve these exact error codes across the board bridge and renderer client. |
| The supervisor cap is `MAX_OUTSTANDING_REQUESTS_PER_SERVICE = 32` in `src/ipc/module-service-channels.ts`; its `request()` counts start slots plus live request entries before posting to the utility process. | The renderer-side port client must independently apply the same cap before `MessagePort.postMessage()`. It must not copy `src/board-shim.ts`'s unbounded `sendQueue` at lines 227-239. |
| `transferRendererPort()` starts lazily, replaces one existing lease, sends the utility endpoint to the service and the renderer endpoint through `EventEndpoint.eModuleServicePort`, and waits for the supervisor's lease promise. | Add a host-renderer `onPort` listener and acquire before requests; never call this from `BoardWebview` or transfer the port to a board frame. |
| `src/ipc/api-types.ts` already declares `eModuleServicePort` as a ports-aware event and `eModuleServiceStatusChanged` as a typed status event. `src/preload.ts` and `src/renderer/types/window.d.ts` already provide `onPort`. | No new preload transport is needed. Extend the existing typed renderer API and ports-aware listener. |
| `src/renderer/api/board-trust-sync.ts` already reads `boardTrust.listPaths()`, normalizes `service` and `permissions`, applies `canStartBoardService()`, and sends the complete generation-numbered snapshot. | Do not touch `src/renderer/api/board-trust.ts`, `trustedBoards.txt`, `board-manifest.ts`, or the trust sync's trust reader. |
| `src/renderer/api/boards.ts:206-223` omits optional values rather than assigning `undefined`; `currentBoardListings()` calls `toBoardListing(source, undefined)` and therefore never reads a manifest. | Add status as a separate registry argument. Both `enumerateBoardListings()` and `currentBoardListings()` consume the status cache; neither derives it from `manifest`. |
| `src/renderer/api/types/boards.d.ts:69-88` and `assets/editor-types/boards.d.ts` are matching hand-maintained declarations. `assets/editor-types/_imports.txt` already contains `boards.d.ts`. | Update both flat copies and verify the existing `_imports.txt` entry without adding an import from outside the flat folder. |
| `BoardInfoEditorView.ts:401-423` already renders declarations and contains the exact comment seam at line 421 for the live status row. `BoardInfoEditorModel.ts` owns `BoardPropsInfo` and lifecycle subscriptions. | Put the live status in model state, subscribe to the process-lifetime status cache, and render the row at the named seam. |
| US-1469 is landed in `ab9f12d4`. `src/main/board-root-key.ts` canonicalizes an absolute root and returns its full lowercase SHA-256 digest; `src/main/board-storage.ts` owns `<userData>/data/board-storage/<board-key>/store.json`, the `board.json` sidecar, validation/limits, cache, and per-board write queue. Its concrete service seam is `createBoardStorageOperationContract(boardRoot)`, exposing `get(key): Promise<JsonValue | undefined>`, `set(key, value): Promise<void>`, `delete(key): Promise<boolean>`, and `keys(): Promise<string[]>`; the frame RPC entries already call the concrete `getBoardStorageValue`/`setBoardStorageValue`/`deleteBoardStorageValue`/`getBoardStorageKeys` functions. | Import and use `createBoardStorageOperationContract(record.boardRoot)` from the service adapter. Do not add another root-key helper, store, cache, queue, sidecar, or frame storage RPC. |

### Status and listing shape

The public listing adds an optional, local status value. The root remains on `BoardListing`; the
status object carries only the supervisor fields:

```ts
// Before: src/renderer/api/types/boards.d.ts
readonly openPageIds: string[];

// After
readonly openPageIds: string[];
readonly service?: {
    readonly state: "stopped" | "starting" | "running" | "stopping" | "failed";
    readonly reason?: string;
    readonly restartCount: number;
    readonly pid?: number;
    readonly startedAt?: number;
};
```

The renderer status model will maintain `Map<normalizedRoot, BoardServiceStatus>`. It is hydrated
from a main endpoint that snapshots the supervisor records and is then updated by
`eModuleServiceStatusChanged`. `boards.list()` may refresh the snapshot before its asynchronous
manifest enumeration; the synchronous AiVision path only reads the already-hydrated map. Thus the
sync path obtains status from the live supervisor registry mirrored into renderer memory, never
from a manifest and never from `manifest: undefined`.

The `service` key is omitted when the cache has no supervisor record. This covers boards with no
service declaration and untrusted/install-only boards that have not entered the trusted service
registry. For a declared, permission-eligible trusted board, US-1467's record creation event
provides `stopped/not-started` before the first request. `toBoardListing()` must preserve the
existing omission rule for every optional field.

### Explicit request behavior

The implementation must make these cases observable and deterministic:

| Situation | Required behavior |
|---|---|
| Status lookup for a board with no service record | Main `getStatus` returns `undefined`; `BoardListing.service` is absent. A trusted frame calling `service.request()` receives `service-not-declared`; it is not queued and does not start anything. |
| `service.request()` while state is `failed` | The supervisor's request-mode start rejects `service-failed` with no implicit reset or restart. The board shim rejects with an `Error` whose message is `service-failed`; only an explicit supervisor start resets the budget. |
| Request before the first trust snapshot | `requireRecord()` rejects `trust-not-ready`. Neither the frame RPC nor renderer port client queues it or starts a process. The status cache remains empty until the snapshot/status hydration arrives. |
| Renderer reload with a live service and an outstanding direct renderer request | Main keeps the utility process and PID. The old renderer lease is lost; its direct pending requests reject `renderer-reloaded` and timers/maps are drained. The new renderer registers its ports listener before requesting a lease, calls `port.start()`, answers the hello handshake, and can acquire a new lease without changing service state, PID, or restart count. A board-frame request is a separate main-routed request and is not converted into a frame port. |
| Two windows ask for a lease on the same service | The supervisor's one-lease rule makes the second lease authoritative. The first renderer receives a deterministic `renderer-reloaded` lease-loss rejection for pending calls; the service remains running and no second utility process or restart-budget event occurs. The second renderer completes hello/hello-ack and owns the cap/deadlines for its requests. |
| `stopping`/`stopped` caused by untrust or quit | Direct renderer requests reject `untrusted` or `quit` respectively. A failed running generation rejects `service-exited`; terminal `failed` maps to `service-failed`. Status events are applied before/alongside rejection so later calls fail immediately rather than waiting for a timeout. |

### Findings that need correction or additive completion

The epic and US-1467 intent are consistent on D3/D4/D5/D6, but the committed surface is not yet
the complete US-1468 contract:

1. The supervisor has only singular `getStatus()` and the renderer has only the status event type;
   there is no status snapshot endpoint or renderer status cache. Without that additive hydration,
   a renderer reload loses the current `running`/`failed` record and the synchronous
   `currentBoardListings()` cannot report it. US-1468 adds that bridge around the existing registry;
   it does not create a second registry.
2. `failLease()` in the supervisor rejects the main-side lease promise and closes the old
   `MessagePortMain`, but `RendererServiceMessage` has no typed lease-loss frame. A browser
   `MessagePort` close is not a reliable request-rejection notification. US-1468 therefore needs
   an additive `lease-lost` control frame (or an equivalent service-originated frame) before close
   so the two-window/reload behavior promised by US-1467 is deterministic.
3. The current service parent protocol has ordinary request/response frames but no service-to-main
   storage operation frame or service host wrapper. US-1469 now supplies the real main store and
   frame RPC, including `createBoardStorageOperationContract`; US-1468 must add only the narrow
   service storage adapter and static utility host wiring, and must not let the utility process
   access `store.json` directly.

## Implementation Plan

### 1. Add the status snapshot and renderer status model

- Extend `ModuleServiceSupervisor` with a read-only `getStatuses()` projection over its existing
  `records` map, returning `statusOf(record)` for every registered service. Add it to
  `ModuleServiceSupervisorApi`; do not expose records, processes, leases, or trust state.
- Add `Endpoint.getModuleServiceStatuses` to `src/ipc/api-types.ts`, with a result of
  `Promise<BoardServiceStatus[]>`, and register it in `src/ipc/main/board-handlers.ts` by calling
  the existing supervisor. Add the typed `api.getModuleServiceStatuses()` method in
  `src/ipc/renderer/api.ts`.
- Add `src/renderer/api/module-service-status.ts` as the process-lifetime renderer cache. It must:
  - normalize roots with the existing `fpNormalizeForCompare` utility;
  - subscribe to `rendererEvents[EventEndpoint.eModuleServiceStatusChanged]` and replace the
    matching status atomically;
  - hydrate once from `api.getModuleServiceStatuses()` after renderer bootstrap, tolerate an
    unavailable main endpoint with `errMessage`, and expose synchronous `getStatus(root)` plus a
    bounded `refresh()` for `boards.list()`/Board Info;
  - reject no requests itself; it is a status cache, not a second supervisor.
- Initialize this cache from `src/renderer/api/app.ts` with the other process-lifetime services,
  before the existing asynchronous `initBoardTrustSync()` can emit the first status records.

Before → after for the synchronous listing path:

```ts
// Before: src/renderer/api/boards.ts
return mergeBoardSources(currentBoardSources())
    .map((source) => toBoardListing(source, undefined));

// After: status was hydrated from the main supervisor registry and is read synchronously.
return mergeBoardSources(currentBoardSources())
    .map((source) => toBoardListing(source, undefined, moduleServiceStatus.getStatus(source.root)));
```

### 2. Add status to both `boards.list()` paths and the flat type copy

- In `src/renderer/api/types/boards.d.ts`, add the optional `service` shape shown above with
  comments documenting omission, state/reason/restart semantics, and epoch-millisecond
  `startedAt`. Keep the declaration self-contained so the flat copy has no non-sibling import.
- Make the same change in `assets/editor-types/boards.d.ts`. Verify the single existing
  `boards.d.ts` line in `assets/editor-types/_imports.txt`; do not add a duplicate or import
  `src/ipc/module-service-channels.ts` into the flat folder.
- In `src/renderer/api/boards.ts`, pass a `BoardServiceStatus | undefined` separately into
  `toBoardListing()`. Copy `state`, optional `reason`, `restartCount`, optional `pid`, and
  optional `startedAt`; never copy `boardRoot`, never assign absent fields to `undefined`, and
  emit `service` only when a live supervisor status exists.
- In `enumerateBoardListings()`, refresh statuses from the main snapshot before mapping the
  manifest metadata. The manifest remains responsible only for `name` and `description` in this
  listing path; it is not consulted for service health.
- In `currentBoardListings()`, use the status cache without awaiting or reading any manifest.
  This is the explicit AiVision/synchronous solution to `manifest: undefined` at the current
  `boards.ts:221-231` path.
- Verify that a service-only board remains discoverable through the existing trust/install/page
  source merge; do not alter `custom-editor-registry.ts` to make status work.

### 3. Wire the renderer lease and direct request client

- Define `SERVICE_REQUEST_DEADLINE_MS = 10_000` in
  `src/ipc/module-service-channels.ts` beside the outstanding-request cap and handshake
  constants. Use this shared value for the supervisor's default, the renderer lease client, the
  `serviceRequest` board bridge handler, and service-storage requests; callers may still provide
  a valid positive per-request deadline.
- Add `Endpoint.requestModuleServicePort` to `src/ipc/api-types.ts` with a `boardRoot` argument
  and `Promise<void>` result. Register it in `src/ipc/main/board-handlers.ts` so the handler calls
  `moduleServiceSupervisor.transferRendererPort(boardRoot, event.sender)`. The endpoint must
  transfer only to `event.sender`; it must never receive a board frame or a `BoardWebview` target.
- Add `api.requestModuleServicePort(boardRoot)` and
  `api.onModuleServicePort(callback)` in `src/ipc/renderer/api.ts`. The latter must use the
  existing `window.electron.ipcRenderer.onPort(EventEndpoint.eModuleServicePort, ...)`, validate
  `boardRoot`, `generation`, `leaseNonce`, and `ports[0]`, and unsubscribe cleanly on renderer
  teardown. Register the listener before issuing the endpoint request.
- Add the renderer-only client in `src/renderer/api/module-service.ts`. One client/lease per
  renderer root must hold the port, generation, lease nonce, `pending` map, acquisition promise,
  and monotonically increasing request ids. Its acquisition path must:
  1. request the supervisor handoff;
  2. call `port.start()` immediately after receipt;
  3. accept only the matching service `hello`, answer with `hello-ack`, and resolve acquisition
     after the handshake/deadline;
  4. replace an old local lease without carrying its request map forward;
  5. close and reject on `messageerror`, lease-loss, renderer reload, untrust, quit, service exit,
     and service failure.
- For `request(boardRoot, message, deadlineMs?)`, reserve a slot before any post. Count requests
  waiting for acquisition as well as requests already posted; reject at 32 with `service-busy`.
  Never append to a pre-connection array. Start an individual timer before acquisition/posting,
  remove the map entry on timeout, and reject `service-timeout`; default to the shared
  `SERVICE_REQUEST_DEADLINE_MS` when the caller supplies no valid positive deadline.
- Map lifecycle/error messages exactly: `untrusted` → `untrusted`, `quit` → `quit`, terminal
  `failed`/`service-failed` → `service-failed`, an unexpected dead generation → `service-exited`,
  and lease replacement/reload → `renderer-reloaded`. Preserve service response errors as
  `service-error` only when they are not a lifecycle code. Map `stopping` to `service-exited`
  unless the status reason is `untrusted` or `quit`.
- Add the typed `lease-lost` control frame to `RendererServiceMessage` in
  `src/ipc/module-service-channels.ts`, including a reason of at least `superseded`, `stopping`,
  `untrusted`, `quit`, or `service-exited`. Update `failLease()` in
  `src/main/module-service-supervisor.ts` to send it best-effort before closing the old endpoint;
  keep the existing lease promise rejection, generation/nonce guards, and one-lease rule. The
  renderer maps the reason to the documented rejection (`superseded` to `renderer-reloaded`,
  `untrusted` to `untrusted`, `quit` to `quit`, and service termination to `service-exited`).
  This is the deterministic lease-loss signal required for EPIC-106 exit criterion 3: after a
  renderer reload, a surviving service remains reachable through the replacement lease. In the
  two-window case the newer lease sends `superseded` to the older window; it does not start a
  second service.

Before → after for the transport boundary:

```ts
// Forbidden: a board frame becomes a service-port target.
frame.contentWindow?.postMessage(servicePort, boardOrigin, [servicePort]);

// Required: main hands one lease to the host renderer; BoardWebview is not involved.
await api.requestModuleServicePort(boardRoot);
// module-service.ts starts the received port, answers hello, caps, and deadlines requests.
```

- Expose the service surface on `app.boards` as `requestService(boardRoot, message)`,
  `startService(boardRoot)`, and `stopService(boardRoot)`. The request delegates to the existing
  renderer lease client with `SERVICE_REQUEST_DEADLINE_MS`; explicit start/stop delegate through
  typed IPC to the existing supervisor, so start retains its restart-budget reset and terminal
  failure recovery semantics. Declare all three operations in both board type surfaces and retain
  the supervisor's readable rejection reasons for AiVision/MCP callers.

### 4. Add `persephone.service.request(message)` on the board bridge

- Extend `BoardRpcMethod` in `src/ipc/board-bridge-channels.ts` with one explicit
  `serviceRequest` member. Keep it in the existing `{ kind: "rpc", id, method, args }` channel;
  do not add a frame-to-service `MessagePort` or a second queue.
- Update `src/main/board-bridge.ts`'s exhaustive `boardRpcHandlers` table. The handler must use
  `entry.root` as the only service identity, generate a main-owned unique request id, accept the
  first argument as the opaque structured-clone message, and call
  `moduleServiceSupervisor.request(entry.root, requestId, message, SERVICE_REQUEST_DEADLINE_MS)`.
  It must not accept a board root, service entry, pid, port, or storage path from the board.
- Preserve the existing `runRpc()`/`errMessage()` response path so the shim receives a rejected
  promise with the supervisor's readable lifecycle code. If the board port is disposed while the
  service is still working, do not create a second supervisor or restart policy; the existing
  supervisor deadline remains the upper bound for the main request.
- In `src/board-shim.ts`, add a `service` object next to the existing RPC methods:

```ts
// Before
getJobs(): Promise<BoardJobInfo[]>;

// After
service: {
    request(message: unknown): Promise<unknown>;
};
```

  `request()` must call `rpc("serviceRequest", [message])`, keep structured-clone values opaque,
  and reject with the existing `rpc-result.error`. Do not use the shim's `sendQueue` as a new
  service queue and do not expose the renderer service port to the frame.
- In `src/renderer/editors/board/board-api.d.ts`, add `PersephoneServiceApi` and
  `readonly service: PersephoneServiceApi` with JSDoc for lazy start, no-service,
  `trust-not-ready`, `service-failed`, `service-busy`, `service-timeout`, `untrusted`, and
  `service-exited` outcomes. Do not change the bridge version here; US-1466 owns `1.6.0`.

### 5. Wire the service-side storage adapter to US-1469

US-1469 is now landed. `src/main/board-root-key.ts` provides `normalizeBoardRoot()` and
`boardRootKey()`, while `src/main/board-storage.ts` owns the cache, per-board queue, JSON-value
validation, 1 MiB/depth/key limits, durable writes, and the `board.json` sidecar under
`<userData>/data/board-storage/<board-key>/`. Its exact service seam is
`createBoardStorageOperationContract(boardRoot)`, whose methods are `get(key)`,
`set(key, value)`, `delete(key)`, and `keys()`; the existing frame RPC uses the corresponding
concrete `getBoardStorageValue`, `setBoardStorageValue`, `deleteBoardStorageValue`, and
`getBoardStorageKeys` exports. US-1468 adds only the service side without changing that contract.

- Add a narrow service-to-main storage request/response pair to
  `src/ipc/module-service-channels.ts`:
  `storage-request { requestId, operation, args }` from the utility process and
  `storage-response { requestId, result | error }` from main. The operation union is exactly
  `get | set | delete | keys`; the adapter validates positional arguments before invoking the
  store and never accepts a root or board key from the utility message.
- Add `src/main/module-service-storage.ts` as the main adapter. It receives the registered
  service root from the supervisor callback, verifies current effective trust/lifecycle, creates
  `createBoardStorageOperationContract(record.boardRoot)`, dispatches the four validated
  operations, and serializes/rejects errors using `errMessage`. It must use the same store/cache/
  mutation queue as the frame RPC handlers; it must not import `node:fs` for `store.json`,
  calculate a second board key, or write any file.
- **Resolved service-host decision — use a plain static asset, not a bundler entry.** Add
  `assets/module-service-host.mjs`, a few dozen lines of pure Node/Electron-utility-process
  bootstrap code. It installs `globalThis.persephone.storage` backed by
  `process.parentPort` `storage-request`/`storage-response` frames, dynamically imports the real
  board entry passed as its argument, and lets that entry own the existing parent-channel
  handshake. Change `src/main/module-service-supervisor.ts` to fork this host asset with the
  absolute board entry as an argument, while preserving `cwd: record.boardRoot`, absolute-entry
  containment, and board-relative `node_modules` ESM resolution. Do not add a TypeScript host,
  Vite/Rollup entry, or edit `scripts/dev.mjs`/`scripts/build-prod.mjs`.
- Asset packaging is verified: in development `getAssetPath()` in `src/main/utils.ts` resolves
  to `<repo>/assets`, so `.mjs` is available at `<repo>/assets/module-service-host.mjs`; in a
  packaged build `electron-builder.yml` copies the entire `assets` directory to
  `resources/assets` through `extraResources`, and `getAssetPath()` resolves to that same
  location. The supervisor must resolve it with `getAssetPath("module-service-host.mjs")`, not
  from a bundled `__dirname` path.
- The host exposes no broad Electron API. A service may import the standard Node built-ins
  available in its utility-process Node runtime (including filesystem, networking, streams,
  crypto, workers, and timers); there is no module allowlist in this trusted-code phase. It must
  not import `electron` or expect main-only `app`, `BrowserWindow`, `webContents`, or `ipcMain`
  objects. Its platform surface is the injected `persephone.storage` object and the utility
  parent channel.
- If the service entry throws during the host's dynamic import, the host writes the readable
  module-resolution/stack error to stderr and exits before `ready`. US-1467's bounded stdout/
  stderr capture records it in `<boardRoot>/ui.log`; the supervisor reports a bounded
  `process-exit-before-ready`/handshake failure and applies the existing restart budget rather
  than leaving a process slot occupied. Do not expose the shim to board frames or add unrelated
  service APIs.
- Bound service-originated storage calls with the same 32-request service cap and a per-request
  deadline. On untrust, quit, process exit, or lease/service failure, settle storage calls with
  the corresponding lifecycle error. A malformed operation or invalid JSON value rejects and
  leaves the main store unchanged.
- Confirm the D6 observation manually: frame `storage.set("key", value)` then service
  `persephone.storage.get("key")` returns the same value, and the only file written is the
  US-1469 main-owned store path. The inverse direction must also work. Do not implement a
  broadcast or a second renderer storage cache.

Before → after for storage ownership:

```ts
// Forbidden: utility process writes the store directly.
await fs.promises.writeFile(storePath, JSON.stringify(next));

// Required: both callers converge on the US-1469 main owner.
await boardStorage.set(serviceBoardRoot, key, value);
```

### 6. Fill the Board Info status row

- Add `serviceStatus?: BoardServiceStatus` (or the renderer-safe equivalent) to
  `BoardPropsInfo` in `src/renderer/editors/board-info/BoardInfoEditorModel.ts`.
- During `loadProperties()`, refresh/read the status cache after reading the manifest and store
  the status without treating an absent status as a service declaration. Subscribe the model to
  `eModuleServiceStatusChanged` for its root and update only its own state; dispose the
  subscription with the model. A service state event must refresh the row without re-reading the
  manifest or opening an editor.
- In `src/renderer/editors/board-info/BoardInfoEditorView.ts` at the existing US-1468 seam after
  the declaration rows, render `Service status` only when `info.service` is declared. Show the
  state, reason when present, pid when present, start time when present, and restart count. If
  the declaration exists but status hydration is not yet available, show `Status unavailable`
  rather than inventing `stopped` or reading the manifest as health data. Use the existing
  `Text`/panel color props; do not add hardcoded colours.

### 7. Verify manually and with project checks (no tests)

- Do not add unit tests, test harnesses, fixtures, or test-only files in this task. Use the
  existing US-1470 service fixture or an equivalent temporary trusted board for live checks.
- Verify no-service status/request, permission-denied status, trust-not-ready request, lazy start,
  running pid/start time, service failure without implicit restart, the 32-request cap,
  per-request timeout, untrust settlement, and the three-failure terminal status.
- Verify a renderer request succeeds with no board page open, then reload the renderer and acquire
  a replacement lease without changing the service PID. Hold an old request while replacing the
  lease and verify `renderer-reloaded`; have two windows acquire the same root and verify the
  second lease wins without a second process.
- Verify the synchronous AiVision `boards.list()` path reports cached live status while its
  `manifest` argument remains undefined, the async path refreshes the same status, and a board
  with no service has no `service` key (not `null`).
- Verify Board Info updates the row on status transitions and displays failure reason/restart
  count. Verify no port is ever posted to `BoardWebview` or an iframe.
- Verify frame/service storage round-trips through the same main store and that neither utility
  nor board code writes `store.json`.
- Run `npm run typecheck`, `npm run lint`, and `npm run build-prod`; record live observations as
  required by EPIC-106 D8. These checks are necessary but are not substitutes for live lifecycle
  verification.

## Concerns / Open Questions

The implementation choices below resolve the current design risks before coding begins:

- **Status freshness:** the authoritative value is the main supervisor snapshot plus status
  events. The renderer map is only a cache; it may be empty before bootstrap, and an absent map
  entry means omit `service`, never synthesize a manifest-derived state.
- **Service-only boards:** status registration remains driven by the existing trust snapshot and
  supervisor registry. Do not relax editor association filtering or add another board enumerator.
- **Lease replacement notification:** the additive `lease-lost` frame is required because closing
  a browser `MessagePort` alone cannot reliably settle pending promises. The service remains
  running when a lease is lost; this is not a restart failure.
- **Storage landing order:** US-1469 is landed in this checkout, so implementation must consume
  its exact `src/main/board-storage.ts` exports at the adapter boundary. The adapter must not
  create a temporary store or write a placeholder `store.json`.
- **Storage protocol trust:** service storage requests use the supervisor's registered root and
  current effective trust, not caller-supplied identity. Untrust rejects them and the main owner
  remains the only disk writer.
- **Error conversion:** all caught values crossing main/renderer/utility boundaries use
  `errMessage`; renderer/UI catch-only paths use `guard` where appropriate. No hand-rolled
  `Error` narrowing is permitted.
- **Imports and paths:** use direct imports, `file-path` for renderer path work, and no
  `require("path")` outside the approved low-level utility. New UI colours, if actually needed,
  must come from `theme/color`; the status row should need none.

## Acceptance Criteria

- [ ] `BoardListing` has an optional service status containing exactly state, optional reason,
      restart count, optional pid, and optional start time; both source and flat declarations
      match, and `_imports.txt` has exactly one existing `boards.d.ts` entry.
- [ ] `boards.list()` obtains status from the main supervisor registry in both async and
      synchronous paths; the synchronous AiVision path never reads a manifest, and boards with
      no service omit `service` rather than returning `undefined`/`null`.
- [ ] Status hydration survives renderer reload and status events update the cache and Board Info;
      every supervisor state/reason and restart count is readable.
- [ ] A renderer can acquire a service lease only through `transferRendererPort`; it starts the
      received port, answers the generation/nonce handshake, applies the cap before posting,
      deadlines every request, and never transfers a port to a board frame.
- [ ] A renderer reload and a second-window lease replacement preserve the live utility process,
      send a reasoned `lease-lost` frame to the old lease, reject old-lease calls as
      `renderer-reloaded`, and let the replacement lease succeed. This explicitly satisfies
      EPIC-106 exit criterion 3; the two-window observation must show the newer lease wins and
      the old window receives `superseded` without a second process.
- [ ] `persephone.service.request(message)` exists in `src/board-shim.ts` and
      `src/renderer/editors/board/board-api.d.ts`, uses the existing board RPC channel, starts
      lazily through main, and exposes the documented no-service, trust-not-ready, failed,
      busy, timeout, untrusted, and exited errors.
- [ ] Service status transitions map to renderer/board request rejection codes without an
      unbounded queue, second supervisor, second restart policy, or capability-bus settlement.
- [ ] Service-side `persephone.storage` uses the four US-1469 operations through the landed
      `board-storage.ts` contract (`createBoardStorageOperationContract`), shares state with frame
      storage, and never writes `store.json` from the utility process.
- [ ] Board Info shows the live service status row at the named seam, including reason, pid,
      start time, and restart count where present, using theme-safe existing UI primitives.
- [ ] `src/renderer/api/board-trust.ts`, `trustedBoards.txt`, the trust snapshot reader,
      `src/renderer/editors/board/board-manifest.ts`, `doc/active-work.md`, and
      `doc/epics/EPIC-106.md` are unchanged.
- [ ] No unit tests or test harnesses are added; `npm run typecheck`, `npm run lint`,
      `npm run build-prod`, and the live D8 observations pass.

## Files Changed Summary

| File | Planned change |
|---|---|
| `src/renderer/api/types/boards.d.ts` | Add the optional supervisor-backed `BoardListing.service` shape and the public `requestService`, `startService`, and `stopService` operations. |
| `assets/editor-types/boards.d.ts` | Keep the hand-maintained flat declaration synchronized, including the three public service operations. |
| `src/renderer/api/boards.ts` | Merge cached/snapshotted supervisor status into async and synchronous listings with omission semantics, and expose the trust-gated service operations. |
| `src/main/module-service-supervisor.ts` | Expose a status snapshot and send deterministic lease-loss notification while preserving lifecycle ownership. |
| `src/ipc/module-service-channels.ts` | Add lease-loss and service-storage protocol frames plus the shared `SERVICE_REQUEST_DEADLINE_MS`; retain the 32-request cap and existing lifecycle frames. |
| `src/ipc/api-types.ts` | Add typed status-snapshot, renderer-port handoff, and explicit service start/stop endpoints. |
| `src/ipc/main/board-handlers.ts` | Bind status snapshot, renderer lease, and explicit service controls to the existing supervisor. |
| `src/ipc/renderer/api.ts` | Add typed status/lease calls, explicit service controls, and the ports-aware service-port listener. |
| `src/renderer/api/module-service-status.ts` | New renderer-lifetime status cache hydrated from main and updated by events. |
| `src/renderer/api/module-service.ts` | New renderer-only lease/request client with handshake, cap, deadlines, and lifecycle rejection mapping. |
| `src/renderer/api/app.ts` | Initialize the status cache as a process-lifetime renderer service. |
| `src/ipc/board-bridge-channels.ts` | Add the explicit `serviceRequest` board RPC method. |
| `src/main/board-bridge.ts` | Route the frame RPC to `moduleServiceSupervisor.request()` using the registered board root. |
| `src/board-shim.ts` | Add `persephone.service.request(message)` through the existing RPC helper. |
| `src/renderer/editors/board/board-api.d.ts` | Declare the board-facing service request API and error contract. |
| `src/main/module-service-storage.ts` | New main-routed adapter from service storage frames to `createBoardStorageOperationContract(record.boardRoot)`. |
| `assets/module-service-host.mjs` | New plain, unbundled utility-process host asset; installs the service storage shim and dynamically imports the board entry passed by the supervisor. |
| `src/renderer/editors/board-info/BoardInfoEditorModel.ts` | Carry and subscribe to live service status for properties mode. |
| `src/renderer/editors/board-info/BoardInfoEditorView.ts` | Render the named live Service status row. |
| `assets/editor-types/_imports.txt` | **No content change expected**; verify the existing single `boards.d.ts` entry. |
| `src/main/board-storage.ts`, `src/main/board-root-key.ts` | **No change**; consume the landed US-1469 main-owned store, root normalization, and exact operation contract. |
| `src/main/utils.ts`, `electron-builder.yml`, `scripts/dev.mjs`, `scripts/build-prod.mjs` | **No change**; use the existing development asset path and packaged `extraResources` asset copy; add no bundler entry. |
| `src/renderer/api/board-trust.ts`, `src/renderer/editors/board/board-manifest.ts` | **No change**; consume the existing trust/manifest contracts. |
| `src/renderer/editors/board/board-service-permission.ts`, `src/renderer/api/board-trust-sync.ts` | **No change**; the existing predicate and complete trust snapshot remain authoritative. |
| `src/renderer/editors/board/BoardWebview.ts` | **No change**; a service port is renderer-only. |
| `doc/active-work.md`, `doc/epics/EPIC-106.md` | **No change** by explicit user constraint. |
| Test files/harnesses | **No change**; this project/task forbids adding them. |
