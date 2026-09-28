# US-1543: The service host owns the service lifecycle protocol

Epic: [EPIC-115](../../epics/EPIC-115.md) — Phase 2, contracts with one definition.

## Goal

Move lifecycle messaging into `assets/module-service-host.mjs` and expose `persephone.service.onRequest(handler)` and `persephone.service.onShutdown(fn)` to service entries. Preserve installed raw-protocol services during a transition window while the host supplies shared policy, limits, and structured service errors.

## Background

EPIC-115 marks this story code-verified, large, cross-repository, and requiring a board bridge version bump. Today, `assets/module-service-host.mjs` handles storage responses, provider requests over renderer leases, and renderer attach/drop. Each service entry handles `init → ready`, `probe → probe-ack`, main-process `request → response`, and `shutdown`. The Demo service adds a queue-until-ready shim because `init` can arrive during module import. Service authoring guidance exists in `assets/guides/boards.md`, `assets/guides/agents/boards.md`, and `assets/board-template/CLAUDE.md`, but describes no host-owned lifecycle API.

The epic's standing rules require a board bridge bump when the visible contract changes, invoking every changed message path twice during live verification, and migrating the torrent viewer and `_test/range-provider-test` in `persephone-boards` or keeping their old protocol operational through a transition window. US-1535 requires the host to retain its renderer lease `Map` keyed by `leaseNonce`, be the only sender of `lease-lost`, and preserve `reason` in `drop-renderer`. US-1544 makes the renderer the only provider-operation deadline owner; it sends `cancel`, and the host classifies only the `requestClass` column from the shared provider policy.

### Verified findings recorded during investigation

- `doc/epics/EPIC-115.md:33-44,423-454` requires the bridge bump, doubled live invocation, cross-repo migration/compatibility, and preservation of US-1535 and US-1544 behavior.
- `assets/module-service-host.mjs` reads `[serviceEntry, deadlineText, capText]` from argv, hand-mirrors 256 MiB `MAX_BUFFERED_PIPE_BYTES`, 1 MiB `MAX_BOARD_PIPE_CHUNK_BYTES`, and `CONTENT_READ_OPERATIONS = {readBinary, readRange}`. Its `rendererLeases` map is keyed by nonce; `closeRendererLease()` posts `lease-lost` then settles requests and closes that lease. It accepts `drop-renderer.reason`.
- Electron's installed `node_modules/electron/electron.d.ts:10842` declares `Electron.ParentPort extends NodeJS.EventEmitter`, with `on`, `addListener`, `once`, `off`, and `removeListener` for `"message"`; it inherits `removeAllListeners`. The same declaration documents that parent-port messages queue until a handler is registered, which is why today's raw services receive an `init` posted before their listener attaches. EventEmitter-derived instances can shadow inherited methods when extensible. A temporary Electron utility-process smoke attempt did not reach its probe result in this environment, so runtime extensibility and interception remain an explicit live gate before implementation is accepted; the `.d.ts` is not treated as proof of runtime mutability.
- The host currently injects `persephone.storage` and `persephone.providers.register`; this global is the established service-entry access pattern to extend with `persephone.service`.
- `src/main/module-service-supervisor.ts:startOneAttempt()` forks the host with entry/deadline/cap argv values and sends `{kind:"init", nonce}`. It accepts `ready`, sends `probe`, accepts `probe-ack`, forwards main-process requests, and on stop sends `{kind:"shutdown", nonce, reason}` then waits up to `SERVICE_SHUTDOWN_TIMEOUT_MS` (2 s). `request()` owns the main-process request deadline. Its renderer leases remain keyed by `webContents.id` on the main side; the separate host-side nonce map remains required.
- `src/ipc/module-service-channels.ts:PROVIDER_OPERATION_POLICY` is the source policy. Its request classes are `content-read` for `readBinary` and `readRange`, `control` for `writeBinary`, `stat`, `watchSubscribe`, and `watchUnsubscribe`; only control operations have a 10 s renderer deadline. The host no longer needs provider-operation timers. It still needs the 10 s values today for storage timers and renderer attach timers, plus the request cap for control operations.
- `src/renderer/api/module-service.ts:errorCode()` currently uses `message.split(":", 1)[0]` plus `lifecycleCodes`; `handleMessage()` feeds response error values through that parser. Raw service implementations send string response errors, while the torrent service already has a local `{code,message}` serializer.
- `src/ipc/main/endpoint-registry.ts:bindEndpoint()` catches a handler error and replies with `new Error(errMessage(e))`, discarding custom `.code`. Thus `requestModuleServicePort` errors currently arrive message-only at `src/renderer/api/module-service.ts:315`. Main service calls made by a board travel `src/board-shim.ts:1550` → `src/main/board-bridge.ts` `serviceRequest` / `rpc-result` → `src/board-shim.ts:923-927`; that error envelope also carries only a string today.
- `src/ipc/board-bridge-channels.ts` declares `rpc-result.error?: string`. `src/main/board-bridge.ts` has access to the original caught Error and can include optional `code`; `src/board-shim.ts` can attach that code to the rejected Error while retaining the error text.
- `src/renderer/editors/board/board-manifest.ts:106` supports `minBridgeVersion`; the range-provider fixture manifest already declares it. Its `../persephone-boards/CLAUDE.md` release automation scans `boards/` only, so `_test/range-provider-test` is outside publishing conventions and needs only a bridge minimum and README protocol update.
- The host's `process.on("exit")` cleanup in `assets/module-service-host.mjs` iterates `rendererLeases` and calls `closeRendererLease(lease, "service-exited")`; retain this along with the US-1535 lease-loss sender.
- `src/shared/board-bridge-version.ts` is the version source and currently says `1.21.0`. `assets/guides/boards.md` and `assets/guides/agents/boards.md` also state `1.21.0`; `assets/board-template/CLAUDE.md` has the same version banner and service instructions at its “Declared module services” section. The current upcoming release notes are in `assets/guides/whats-new.md` under `Version 5.0.4 (Upcoming)`.
- `assets/demo-board/scripts/service.mjs`, sibling `boards/torrent-viewer/scripts/service.mjs`, and sibling `_test/range-provider-test/scripts/service.mjs` all register `parentPort.on("message", ...)` and implement lifecycle messages themselves. Demo queues messages until its asynchronous startup finishes. The template has `scripts/hello.js` but no service scaffold.
- The sibling repo's `CLAUDE.md` and `README.md` require each published board change under `boards/` to bump `board-manifest.json.version` and add a terse matching heading/line in that board's `WHATS-NEW.md`; never hand-edit catalog or versions manifests. `develop` is the working branch; pushing to `develop` does not publish, while merging to `main` triggers GitHub Actions that publish releases. The range-provider fixture is under `_test/`, outside the publishing scan.
- No `assets/agent/` directory exists. Agent-facing board guidance is under `assets/guides/agents/`.

## Implementation Plan

### Implementation progress

- [x] Define typed init configuration, module-service port result, and service error payloads.
- [x] Send shared provider policy and limits in `init`; preserve structured errors through main IPC and board RPC.
- [x] Add host-managed lifecycle callbacks, request dispatch, shutdown handling, and raw-protocol fan-out.
- [x] Migrate the in-tree Demo service and require bridge `1.22.0`.
- [x] Update the in-app guide, agent guide, template guidance, and upcoming release notes.
- [x] Run TypeScript and lint checks (both pass).
- [ ] Complete the production build: attempted twice; renderer config bundling fails with `spawn EPERM` in `optimizeSafeRealPathSync` under the current environment.
- [ ] Perform twice-per-path live verification in the running app; not performed in this repository run.
- [ ] Migrate, commit, and push sibling `../persephone-boards` services; explicitly excluded from this run and deferred to the separate run.

1. **Define the init payload and service protocol in `src/ipc/module-service-channels.ts`.** Expand `ServiceParentMessage`'s `init` variant to include the host runtime configuration: `serviceRequestDeadlineMs`, `maxOutstandingRequestsPerService`, `maxBufferedPipeBytes`, `maxBoardPipeChunkBytes`, and `providerRequestClasses` for every `ProviderOperation`. Build `providerRequestClasses` from `PROVIDER_OPERATION_POLICY[operation].requestClass`; do not send provider deadlines because the renderer owns those. Add shared `ServiceErrorPayload = { code: string; message: string }` and `ModuleServicePortResult = { ok: true } | { ok: false; error: ServiceErrorPayload }` types. Type main service `response.error` as `ServiceErrorPayload | string` at the raw legacy boundary; type host-to-renderer lease `response.error` as `ServiceErrorPayload`. Keep `SERVICE_HANDSHAKE_TIMEOUT_MS`, `SERVICE_SHUTDOWN_TIMEOUT_MS`, `SERVICE_RENDERER_LEASE_TIMEOUT_MS`, and `SERVICE_QUIT_GATE_TIMEOUT_MS` in main: these govern supervisor/renderer waits and are not host runtime policy.

2. **Send policy in `init` from `src/main/module-service-supervisor.ts:startOneAttempt()`.** Import `MAX_BUFFERED_PIPE_BYTES` and `MAX_BOARD_PIPE_CHUNK_BYTES` from `src/shared/board-pipe-constants.ts`, map `PROVIDER_OPERATION_POLICY` into the request-class record, and include the existing deadline and cap constants. Remove deadline and cap from `utilityProcess.fork()` argv. Keep only `absoluteEntry` in argv: the host must know which board ESM file to import before it can receive `init`. Preserve nonce validation, handshake timeout, `request()` deadline, and the 2-second shutdown wait. Leave the main request deadline in main; `init.serviceRequestDeadlineMs` configures only host storage/renderer-attach/control-cap uses.

   Before → after:

   ```ts
   // Before
   utilityProcess.fork(host, [absoluteEntry, String(deadlineMs), String(requestCap)]);
   process.postMessage({ kind: "init", nonce: generation });

   // After
   utilityProcess.fork(host, [absoluteEntry]);
   process.postMessage({ kind: "init", nonce: generation, config: serviceHostConfig });
   ```

3. **Make `assets/module-service-host.mjs` the default protocol owner.** Consolidate host message handling into one real `process.parentPort` message listener. It handles host-internal kinds (`storage-response`, `attach-renderer`, `drop-renderer`) and reads/validates/applies `init.config` before forwarding that init event. Read and validate config in BOTH host and raw modes; if config is missing or invalid, log and exit 1 without forwarding, allowing main's handshake failure path to report startup failure. Make `storageRequest()` wait for init configuration if an entry calls it during top-level import. Use received byte limits and request-class table instead of local mirrors. Derive `validProviderRequest()`'s accepted operation names from `Object.keys(init.config.providerRequestClasses)`; update the old “Mirrors `PROVIDER_OPERATION_POLICY`” comment to point at that init field so no operation-name policy list remains in the host. Preserve the nonce-keyed `rendererLeases` map, `closeRendererLease()` as sole `lease-lost` sender, `drop-renderer.reason`, per-lease pending cancellation, and `cancel` path. Encode host-to-renderer errors such as lease settlement and `service-busy` as `{code,message}`, while keeping `lease-lost.reason` as the existing typed code. Keep host provider-operation handling timer-free; renderer remains the only provider deadline owner. Retain the existing `process.on("exit")` cleanup that closes all renderer leases still in the host map.

   Add `persephone.service.onRequest(handler)` and `persephone.service.onShutdown(fn)` next to existing injected `storage` and `providers`. The request handler receives the opaque `message` and its return value becomes the response result; request ids remain transport details. Permit one request handler and throw a clear registration error if it is registered twice. Permit multiple shutdown callbacks; each receives `{ reason }` from the supervisor's `ServiceStopReason`, runs sequentially in registration order, and the host exits 0 only if all finish successfully. Catch each failure, continue through the remaining callbacks, then exit 1 if any failed. Callbacks must finish within main's `SERVICE_SHUTDOWN_TIMEOUT_MS` (2 s); main kills a process still alive after that deadline. For a new-API service request, await the handler and post one `{kind:"response", requestId, result}`; on rejection, post `{kind:"response", requestId, error:{code,message}}`, taking `code` from `error.code` when it is a non-empty string and otherwise using `service-error`, with a readable message fallback. If a request arrives with no handler registered, return `{code:"service-handler-not-registered", message:...}` immediately. Service entries should register handlers during top-level evaluation before import settles.

   Host-managed `init` produces one `ready` only after `await import(pathToFileURL(serviceEntry).href)` settles. A matching `probe` produces one `probe-ack`; matching `shutdown` runs shutdown callbacks. If entry import throws, log the error and exit nonzero without sending `ready`; main's existing handshake failure path reports startup failure and restart policy remains unchanged.

4. **Use host-side fan-out for raw compatibility.** Before importing the entry, shadow `process.parentPort.on`, `addListener`, `once`, `off`, `removeListener`, and `removeAllListeners` on that instance for only the `"message"` event; delegate other events to the original methods. Store entry message listeners in a host-owned list and NEVER register them on the real port. The host's single real listener handles internal kinds/config first, then forwards every message event as the original event object (including `.data`, as current services expect) to active entry listeners. Keep interception permanent. Preserve listener removal and `once` semantics in the host-owned list. If host mode has been sealed, reject and warn on a late raw listener registration instead of adding it to lifecycle fan-out, preventing the late listener from answering beside the host.

   Queue only lifecycle/request events (`init`, `probe`, `request`, `shutdown`) received while there are no entry listeners and import has not settled. On first raw listener registration, flush that queue to it once and clear the queue; later listeners receive future events only. If import settles with no raw listener, host mode consumes the queued events itself. Apply and validate `init.config` before forwarding `init`, in BOTH modes; if invalid, log and exit 1 without forwarding. Seal mode when import settles: any raw message listener registered by then selects raw mode, where host never answers lifecycle or request messages, while it still handles host-internal messages and config. Mixed `onRequest` plus raw listener selects raw mode and logs a console warning that `onRequest` is ignored. Otherwise host mode owns lifecycle/request messages and sends `ready` only after import settles. Electron documents that port messages queue until a handler registers, which explains why today's raw services receive early `init`; explicit fan-out queuing also closes a latent race if that native behavior is not available in the runtime.

5. **Preserve error codes across main IPC and the board frame.** In `src/main/module-service-supervisor.ts`'s steady-state `response` handler, object errors become `ServiceError(error.code, error.message)` and legacy string errors become `ServiceError("service-error", string)`; retain success response behavior and request deadline handling. In `src/ipc/main/board-handlers.ts`, make `Endpoint.requestModuleServicePort` catch acquisition failures and return `{ok:false,error:{code,message}}`, or `{ok:true}` on success, rather than throwing into `src/ipc/main/endpoint-registry.ts:bindEndpoint()` (which reduces errors to message-only `Error`s). Map unexpected non-ServiceError failures to `{code:"service-error",message:errMessage(error)}`. Type the result in `src/ipc/module-service-channels.ts` and `src/ipc/api-types.ts`, and propagate it through `src/ipc/renderer/api.ts` so `src/renderer/api/module-service.ts` reads `error.code` directly and rejects/loses the lease with that code.

   For board-frame service requests, update `src/main/board-bridge.ts`'s RPC rejection path to retain the message with `errMessage(e)` and include optional `code` when the caught error has a string `.code`. Add optional `code` to `rpc-result` in `src/ipc/board-bridge-channels.ts`. In `src/board-shim.ts`'s `rpc-result` handler, reject an Error carrying both `data.error` and optional `.code`. This preserves ServiceError codes through `persephone.service.request()` without changing successful RPC results.

6. **Remove prefix parsing from `src/renderer/api/module-service.ts`.** Delete `lifecycleCodes` and `errorCode()`'s `message.split(":", 1)` logic. Every internal source becomes structured: the request-port result union, host-to-renderer `response.error`, and typed Error objects whose `.code` survives local paths. Update `errorForCode()` to attach an explicit `.code` and separate `.message` to locally created Errors, then read `.code` directly without an allow-list. At the raw legacy service boundary, translate string errors to `ServiceError("service-error", string)` in main before they reach the board or renderer. A legacy string passed to the renderer's normalizer maps to code `service-error` and retains the entire string as `message`; never use the whole message as a code. Keep renderer ownership of provider deadlines and `cancel` messages.

   A migrated entry registers its APIs at top level:

   ```js
   persephone.service.onRequest(async (message) => handleRequest(message));
   persephone.service.onShutdown(async ({ reason }) => closeServiceResources(reason));
   ```

   Before → after:

   ```ts
   // Before
   const code = message.split(":", 1)[0];
   return lifecycleCodes.has(code) ? code : "service-error";

   // After
   if (typeof error === "string") return { code: "service-error", message: error };
   if (isRecord(error) && typeof error.code === "string" && typeof error.message === "string") {
       return { code: error.code, message: error.message };
   }
   return { code: "service-error", message: errMessage(error, "Service request failed") };
   ```

7. **Bump bridge and update shipped guidance.** Change `src/shared/board-bridge-version.ts` from `1.21.0` to `1.22.0`. Update version banners and add the new service lifecycle API to `assets/guides/boards.md`, `assets/guides/agents/boards.md`, and `assets/board-template/CLAUDE.md`. Update the `Version 5.0.4 (Upcoming)` notes in `assets/guides/whats-new.md`. Document the handler's input/output contract, early missing-handler behavior, import failure, shutdown callback order/failure behavior, 2-second shutdown limit, structured `{code,message}` errors including board-visible `error.code`, raw transition, and examples. The in-app guide is the canonical service authoring guide; update the agent guide because it is another service authoring surface. Do not create an `assets/agent/` file; no such directory exists.

8. **Migrate the in-tree Demo board.** In `assets/demo-board/scripts/service.mjs`, replace the queue shim and manual `init`/`probe`/`shutdown` branches with `persephone.service.onRequest(handleRequest)` and `persephone.service.onShutdown(...)`; preserve provider registration and demo operations. For `arm-handshake-hang`, return `{armed:true, oneShot:true}` from the handler and schedule `process.exit(0)` after 50 ms so the host can flush the response first. The handshake-hang still works in host mode: its follow-on process waits forever in top-level await, so import never settles and the host never sends `ready`. Delete the queue-until-ready logic because host `ready` follows entry import. Set `assets/demo-board/board-manifest.json.minBridgeVersion` to `1.22.0`.

9. **Migrate sibling services and record the published-board release on `develop` only.** In sibling `../persephone-boards`, migrate `boards/torrent-viewer/scripts/service.mjs` and `_test/range-provider-test/scripts/service.mjs` to `onRequest` / `onShutdown`, retaining each operation implementation and structured error semantics. Bump Torrent Viewer's `board-manifest.json.version` from `1.7.0` to `1.7.1`, set `minBridgeVersion` to `1.22.0`, and add a matching `## 1.7.1` line to `WHATS-NEW.md`. Commit and push the sibling change to `develop` only; pushing `develop` does not publish, while merging to `main` triggers automatic publication. Do not merge to `main` as part of this task. The `_test/range-provider-test` fixture is outside the `boards/` publish scan, so do not invent a version or `WHATS-NEW.md`; set `minBridgeVersion` to `1.22.0` (supported by `src/renderer/editors/board/board-manifest.ts:106`) and update its README protocol notes only. Do not edit machine-generated `boards-manifest.json` or `versions-manifest.json`.

10. **Live verification only; no unit tests or test harnesses.** Invoke each changed path twice per EPIC-115 standing rule. The live plan below covers startup, requests, shutdown, error delivery, and compatibility.

### Live verification plan

- **Demo board service:** start it and confirm running/ready status twice; send a successful request twice and a rejected request twice; stop/shutdown twice; force a crash and confirm supervisor restart twice. Confirm a service request issued after startup reaches the registered handler, the host receives its structured error, and shared storage/provider registration still work.
- **Structured error routes:** force a `requestModuleServicePort` failure (for example, an undeclared or untrusted service) and confirm the renderer receives `{code,message}` twice; force lease `service-busy` and lease loss and confirm typed `response.error` twice; reject `persephone.service.request()` in the board and confirm `error.code` survives `rpc-result` twice. Also test an unmigrated raw service string error and confirm it becomes code `service-error` with the full original text in `message`.
- **ParentPort fan-out:** in the running utility-process host, confirm `process.parentPort` is extensible and the instance overrides for all six message-listener methods intercept registration/removal while non-`message` events still use the originals. Confirm a raw listener receives the original `{data}` event once, early-init queue flush happens once, and host mode rejects a late raw registration.
- **Provider leases / US-1535 and US-1544:** from two renderer windows acquire the same Demo provider lease, close/reload one window and confirm only that lease emits `lease-lost`; verify `drop-renderer.reason` survives each stop cause. Exercise one ranged read and one control operation twice; confirm the renderer sends one timeout/cancel for an explicitly bounded operation and host active-read counts still settle.
- **Torrent Viewer:** open the migrated board, run a service request twice, resolve and cancel a torrent operation, then stop/restart twice. Confirm provider-backed content reads and structured request errors work.
- **Range Provider Test:** read `rangetest:` through `readRange` twice, read the no-range scheme through the buffered fallback twice, and request counters twice to verify the service API and provider policy arrived through `init`; set its existing `minBridgeVersion` to `1.22.0` and update README protocol notes.
- **Raw protocol compatibility:** make a scratch copy of the pre-migration Range Provider Test service (or any pre-migration torrent service) with its raw `parentPort` handler and old string error response. Open/trust the scratch board, then verify start/ready/probe, request/response, shutdown, and one raw string error twice each. Confirm the host sends no competing lifecycle replies.
- No unit tests, automated harnesses, or repository test commands are part of this story; use the live running app for these checks.

## Concerns

- Compatibility detection covers `on`, `addListener`, `once`, `off`, `removeListener`, and `removeAllListeners` on `process.parentPort` while preserving other events. Runtime instance patchability is plausible from the EventEmitter-derived shape but was not confirmed by the attempted smoke here; implementation acceptance requires the live utility-process check above.
- A service must not combine the new API with a raw message listener; raw mode wins to prevent duplicate replies. State this explicitly in both authoring guides.
- Entry import failure must not produce host `ready`; the existing supervisor's handshake timeout/exit path supplies failure and restart behavior.
- The torrent viewer release is a cross-repo change. The implementation plan commits and pushes the sibling change to `develop` only; pushing there does not publish. Merging to `main` does publish and is excluded from this task.

## Needs user decision / Decisions made

No blocking user decision is needed before implementation. These design choices are recorded for review:

- **Raw protocol detection uses permanent host-side fan-out.** One real parent-port listener handles host traffic and fans out original events, while a host-owned listener list decides raw mode; queued early lifecycle messages are delivered once. This avoids attaching entry listeners to the real port and removes the double-delivery race.
- **Board RPC adds optional `rpc-result.code`.** Keep the existing error string for readable messages and add a separate optional code, which carries `ServiceError.code` across the frame port with an additive wire change.
- **`requestModuleServicePort` returns a result union.** `{ok:true}|{ok:false,error:{code,message}}` avoids `bindEndpoint()`'s message-only error conversion and gives renderer lease acquisition a typed outcome without changing generic endpoint error behavior.

## Live verification results (2026-09-28, cold-started app)

Verified live through the running app (renderer IPC and a board frame), each path at least twice:

- **Migrated Demo service (host mode), scratch board from `createDemoBoard`:** start twice; `echo` twice; unknown op twice → main path `ServiceError` with the service's message; storage set/get; `crash` twice → `service-exited`, supervisor restarted (restartCount 1, 2) and the next request reached the new pid; explicit stop/start twice. `Electron.ParentPort` instance interception works at runtime.
- **Board frame:** `persephone.service.request()` rejected twice with `error.code === "service-request-failed"` and the service's message; a `crash` rejected with `code: "service-exited"`; `bridgeVersion` reads `1.22.0`.
- **Range Provider Test (migrated):** four `rangetest:`/`norangetest:` links cold-opened; counters show `readRange` 2 / `readBinary` 0 for `test/range` and `readBinary` 2 for `test/norange`; `counters` requested twice over the service request path.
- **Torrent Viewer (migrated, 1.7.1):** `snapshot` twice, unknown op twice (structured error); opened a local `.torrent` (Sintel), metadata resolved; a `torrent://` link to an MP4 streamed and played (currentTime advancing, readyState 4); stop/start twice.
- **Unmigrated raw-protocol service** (scratch board `US1534Demo`, pre-US-1543 demo service with its own `parentPort` listener): start; `echo` twice; unknown op twice → legacy string error; storage get twice (host-internal `storage-response` still reaches it); `crash` twice with restart; stop/start twice. No competing host lifecycle replies observed (handshake completed normally every time).

### Not verified

- `requestModuleServicePort` failure union reaching `loseLease()` with a real code (needs a failing renderer-port attach); code-reviewed only.
- Two-window lease isolation and `drop-renderer.reason` per stop cause after this change (US-1535 behaviour; host code path unchanged apart from the structured error body).
- Demo `arm-handshake-hang` one-shot path in host mode.
- Shutdown-callback timing against the 2 s kill deadline was not measured (stops completed in <400 ms).

## Acceptance Criteria

- `BOARD_BRIDGE_VERSION` is `1.22.0`, and the current release notes plus both board guides and the template document the API.
- The host receives byte ceilings, provider request classes, storage/attach deadline, and request cap in `init`; only the absolute service entry remains in fork argv. The host derives valid provider operations from `init.config.providerRequestClasses`; it contains no second operation-name policy list. The main supervisor, renderer provider-operation deadline, and cancellation semantics remain unchanged.
- Host mode sends exactly one `ready` after top-level import settles, answers matching `probe`, dispatches `request` to the registered handler, runs shutdown callbacks, and sends no `ready` when import fails.
- Missing request handler and thrown/rejected service handler errors return structured `{code,message}` errors. `requestModuleServicePort` uses a typed result union; host lease responses use structured errors; board service request errors preserve `error.code` through `rpc-result`. Legacy raw string errors become `{code:"service-error",message:string}`. Renderer code handling uses no prefix parsing or allow-list.
- Raw services using the current `parentPort.on("message")` lifecycle protocol continue to own all four lifecycle/request messages through the transition window, with no double answers.
- The host preserves the lease nonce map, is the only `lease-lost` sender, preserves `drop-renderer.reason`, closes remaining leases on process exit, and does not add a provider-operation timer or remove renderer `cancel`.
- Shutdown callbacks run sequentially, all are attempted, and exit status reflects their results; the callbacks complete inside the 2-second main shutdown deadline.
- Demo board and the two sibling services use the new API. Torrent Viewer is `1.7.1` with a matching changelog line and bridge minimum; the range fixture gets only the bridge minimum and README update and remains outside publication.
- The sibling repo migration is committed and pushed to `develop` only; `main` is not merged or published.
- Live verification is completed twice per changed message path: Demo start/ready/request/shutdown/crash-restart, Torrent Viewer requests/operations, range and no-range provider reads, and an unmigrated raw service copied to a scratch board. No test harness is added.

### Files investigated and expected to need no change

| Path | Reason |
|------|--------|
| `src/shared/board-pipe-constants.ts` | Existing canonical byte ceilings are imported into main init config |
| `assets/board-template/board-manifest.json` | Template has no declared service scaffold; API example belongs in its `CLAUDE.md` |
| `assets/board-template/scripts/hello.js` | Generic execute example, unrelated to module services |
| `../persephone-boards/boards/torrent-viewer/README.md` | Service lifecycle authoring guidance is in the app guide and board-specific `CLAUDE.md`; existing README need not duplicate protocol details |
| `../persephone-boards/boards/torrent-viewer/versions-manifest.json` | Machine-generated by publish automation; never hand-edit |
| `../persephone-boards/boards-manifest.json` | Machine-generated by publish automation; never hand-edit |
| `src/ipc/main/endpoint-registry.ts` | Generic endpoint error wiring stays unchanged; the service-port endpoint returns its own typed union |

## Files Changed Summary

| Path | Planned change |
|------|----------------|
| `doc/tasks/US-1543-service-lifecycle-protocol/README.md` | This implementation plan and verified findings |
| `doc/epics/EPIC-115.md` | Link US-1543 row to this task document |
| `src/ipc/module-service-channels.ts` | Typed init config and serialized service errors |
| `src/ipc/api-types.ts` | Type `requestModuleServicePort` result union |
| `src/ipc/main/board-handlers.ts` | Return typed port-acquisition outcomes instead of throwing |
| `src/ipc/renderer/api.ts` | Propagate typed port-acquisition outcomes |
| `src/main/module-service-supervisor.ts` | Send config in init; preserve structured errors |
| `src/main/board-bridge.ts` | Preserve `.code` in board RPC error replies |
| `assets/module-service-host.mjs` | Host lifecycle API, config-driven limits, transition mode |
| `src/renderer/api/module-service.ts` | Direct structured/legacy error decoding |
| `src/ipc/board-bridge-channels.ts` | Add optional `rpc-result.code` |
| `src/board-shim.ts` | Preserve `error.code` on board RPC rejection |
| `src/shared/board-bridge-version.ts` | Bump bridge `1.21.0 → 1.22.0` |
| `assets/guides/boards.md` | Document new service API and `1.22.0` |
| `assets/guides/agents/boards.md` | Document API for agent authors and `1.22.0` |
| `assets/guides/whats-new.md` | Add service lifecycle feature note to upcoming release |
| `assets/board-template/CLAUDE.md` | Update service authoring instructions and bridge banner |
| `assets/demo-board/scripts/service.mjs` | Migrate request and shutdown handling to host API |
| `assets/demo-board/board-manifest.json` | Require bridge `1.22.0` |
| `../persephone-boards/boards/torrent-viewer/scripts/service.mjs` | Migrate to host API |
| `../persephone-boards/boards/torrent-viewer/board-manifest.json` | Bump to `1.7.1`, require bridge `1.22.0` |
| `../persephone-boards/boards/torrent-viewer/WHATS-NEW.md` | Add matching `1.7.1` release note |
| `../persephone-boards/_test/range-provider-test/scripts/service.mjs` | Migrate to host API |
| `../persephone-boards/_test/range-provider-test/board-manifest.json` | Set existing `minBridgeVersion` to `1.22.0` |
| `../persephone-boards/_test/range-provider-test/README.md` | Update fixture protocol documentation |



