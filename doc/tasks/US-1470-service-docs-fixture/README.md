# US-1470 — Demo board service fixture and authoring documentation

Linked epic: [EPIC-106 — Bridge contract and the module service process](../../epics/EPIC-106.md)  
Status: Planned

`doc/active-work.md` and `doc/epics/EPIC-106.md` are intentionally unchanged. The user task
explicitly forbids editing either file; both already contain the US-1470 link.

## Goal

Make the EPIC-106 service contract replayable against a running Persephone build by extending the
Demo board with a supervised Node service, visible controls, and deliberate failure modes. Update
the canonical board-authoring and user/agent guides so authors can choose a service versus
`executeNode()` correctly and understand the real trust, storage, process, and logging contracts.

## Background

### Verified existing implementation

The following facts were checked against the current checkout and the reviewed US-1468 plan:

- `src/renderer/editors/board/board-manifest.ts` defines optional `permissions`,
  `minBridgeVersion`, and board-relative `service` fields. `normalizePermissions()` preserves
  ordered, unique strings; `normalizeBoardServicePath()` rejects unsafe paths. A board with only a
  `service` is not an editor association because `getBoardEditorAssociation()` returns `null` when
  `fileMasks`, `contentMasks`, and `folderEditorMasks` are empty.
- `src/main/module-service-supervisor.ts` owns the service lifecycle. `start()` is lazy,
  `request()` starts on demand, the child runs with `cwd: boardRoot`, and `startOneAttempt()`
  requires `ready` followed by `probe-ack`. The current constants in
  `src/ipc/module-service-channels.ts` are a 5,000 ms handshake deadline, a 2,000 ms shutdown
  deadline, a 32-request cap, and a three-failure budget inside 60 seconds. `statusOf()` exposes
  state, reason, pid, start time, and restart count.
- `ModuleServiceSupervisor.buildServiceEnvironment()` passes only the allowlisted Windows/runtime
  variables and injects `PERSEPHONE_SERVICE=1` and `PERSEPHONE_BOARD_ROOT`; it does not pass an
  unrestricted copy of `process.env`. `BoundedServiceLog` captures both child streams into
  `<boardRoot>/ui.log`, bounded to 256 KiB and prefixed with the service root and stream.
- `src/main/board-storage.ts` is the only store owner. `createBoardStorageOperationContract(boardRoot)`
  supplies `get`, `set`, `delete`, and `keys`; the durable files are under
  `<userData>/data/board-storage/<sha256-of-canonical-board-root>/`. The service must use the
  US-1468 host adapter and must never open or write `store.json` itself.
- `src/main/board-root-key.ts` canonicalizes the absolute board root and derives the lowercase
  SHA-256 board key. `src/shared/board-bridge-version.ts` exposes `BOARD_BRIDGE_VERSION = "1.6.0"`.
- `src/renderer/editors/board/board-api.d.ts` already documents `persephone.storage`; the reviewed
  US-1468 plan adds `persephone.service.request(message)` through the existing board RPC. The
  board frame must not receive the renderer-owned service `MessagePort`.
- The existing Demo board (`assets/demo-board/index.html`, `app.js`, `style.css`) has tabs for
  Overview, Theming, Capabilities, Secondary Views, Build Guide, and Debugging. Its
  `scripts/node-server.mjs` is a resident stdin/stdout `executeNode()` example, not a service:
  it announces its own JSON line, parses request lines, and is killed by the page's handle.

### Binding authoring contract

The guides and fixture must state this contract consistently:

- `manifest.service` is a board-relative ESM entry. The platform starts it through the static
  service host; the entry's imports resolve `node_modules` from the board root, and its current
  working directory is the board root.
- The service runs in the bundled utility-process Node runtime. Standard Node built-ins are
  available, including filesystem, networking, streams, crypto, workers, and timers. The service
  does not receive `electron`, `app`, `BrowserWindow`, `webContents`, or `ipcMain` objects.
- The environment is sanitized to the supervisor's allowlist, plus `PERSEPHONE_SERVICE=1` and
  `PERSEPHONE_BOARD_ROOT`. Authors must not assume arbitrary shell/user environment variables are
  present.
- The static host injects `persephone.storage`; service storage calls are main-routed and share the
  board frame's per-board store. Service stdout and stderr are captured in `<boardRoot>/ui.log`,
  which is the first place to look when an ESM import throws.
- A service is platform-owned, lazily started, supervised, restart-budgeted, and usable with no
  board page open. `executeNode()` is a child process started by the board page and tied to the
  board-frame lifetime unless the board deliberately uses its busy-process retention API. Authors
  should use `executeNode()` for page-owned jobs and a service for background/platform-owned work.
- `permissions` discloses requested capabilities and drives lifecycle hygiene; it is not a security
  boundary. Trust already lets a board run arbitrary renderer code and arbitrary Node code, so the
  guides must never describe `"service"` as a privilege grant or sandbox.

## Implementation Plan

### 1. Extend the Demo board's manifest and add the service entry

- Edit `assets/demo-board/board-manifest.json` to retain the existing description, author,
  repository, and secondary views while adding `minBridgeVersion: "1.6.0"`,
  `permissions: ["service"]`, and `service: "scripts/service.mjs"`.

Before:

```json
{
  "schemaVersion": 1,
  "description": "Self-documenting demo board showcasing the persephone bridge, theming, and capabilities.",
  "secondaryViews": [
    { "id": "shared-state", "title": "Shared State" },
    { "id": "detail", "html": "detail.html", "title": "Notes" }
  ]
}
```

After:

```json
{
  "schemaVersion": 1,
  "description": "Self-documenting demo board showcasing the persephone bridge, theming, and capabilities.",
  "minBridgeVersion": "1.6.0",
  "permissions": ["service"],
  "service": "scripts/service.mjs",
  "secondaryViews": [
    { "id": "shared-state", "title": "Shared State" },
    { "id": "detail", "html": "detail.html", "title": "Notes" }
  ]
}
```

- Add `assets/demo-board/scripts/service.mjs` as a small, readable ESM service. Follow the
  service-host protocol planned in US-1468: handle `init` by posting `ready` with the supplied
  nonce, answer `probe` with `probe-ack`, answer `request` with the same `requestId`, and exit
  cleanly on `shutdown`. Keep protocol traffic on the parent channel; write diagnostics to
  stderr, not stdout.
- Implement deterministic request operations for the fixture:
  - `echo` returns a structured result containing the input, `process.pid`, `process.cwd()`,
    `PERSEPHONE_SERVICE`, and `PERSEPHONE_BOARD_ROOT` so the authoring contract is observable.
  - `storage-get`, `storage-set`, `storage-delete`, and `storage-keys` exercise the injected
    `persephone.storage` object without importing `node:fs` for the store.
  - `delay` waits for a caller-supplied bounded duration, allowing the frame to hold an
    in-flight request while MCP untrusts the board.
  - `crash` writes a diagnostic to stderr and exits with a non-zero code on demand. The UI must
    treat the immediate request rejection as expected and let `boards.list()` show the restart.
  - `arm-handshake-hang` writes a one-shot mode to `persephone.storage`, acknowledges the request,
    and exits so the supervisor starts a fresh handshake. On the next import, the entry reads and
    deletes that mode before posting `ready`, then deliberately never posts `ready`; the supervisor
    kills it at the deadline and its following retry starts normally. The flag is therefore consumed
    and cleared by the service itself, so a failed observation cannot leave the Demo board broken.
- Keep the service JavaScript within project style: ESM, descriptive names, no unnecessary
  dependencies, bounded inputs, explicit error responses, and no hand-rolled persistence path.

### 2. Add MCP-drivable service affordances to the Demo board

- Extend `assets/demo-board/index.html` with a Service section (a dedicated tab is preferred so
  it is easy to find in an accessibility snapshot). Give each control a stable `data-test` name
  and show a status/readout region. The affordances must include:
  - normal request (`echo`) through `persephone.service.request`,
  - frame `persephone.storage` set/read and service-side read/write round trips,
  - start a delayed request for untrust settlement,
  - crash on demand through the `crash` request operation,
  - arm the next handshake hang through the `arm-handshake-hang` request operation; the mode must be
    one-shot and self-clearing,
  - refresh status through `persephone.call("boards.list")` and display the matching board's
    `service` object, including state, reason, pid, startedAt, and restartCount.
- Extend `assets/demo-board/app.js` with named handlers in the existing `tests` table. Every
  async handler must catch and render expected lifecycle errors rather than leaving the output
  blank. The delayed-request handler must retain its Promise until the result/rejection is shown;
  it must not cancel the request before MCP calls `boards.unregisterBoard`.
- Update `assets/demo-board/style.css` only for the new service panel/readout/status states,
  using the existing `--p-*` tokens and `.p-*` controls. Do not add hardcoded colors or a second
  component styling system.
- Update the Demo board's existing Build Guide and Debugging prose in `index.html` so it names the
  new `service.mjs`, explains why it is different from `scripts/node-server.mjs`, points authors
  to `ui.log`, and tells an MCP agent to use `pages[pageId].editor.snapshot()` and the Service
  controls before consulting `boards.list()`.

Representative UI change:

```html
<!-- Before: Capabilities exposes only execute/executeNode controls. -->
<button class="p-btn primary" data-test="nodeServer">resident server (stdin)</button>

<!-- After: add a discoverable service control group. -->
<button class="p-btn primary" data-test="serviceRequest">service request</button>
<button class="p-btn primary" data-test="serviceStorageRoundTrip">service/storage round-trip</button>
<button class="p-btn danger" data-test="serviceCrash">crash service</button>
<button class="p-btn danger" data-test="serviceHangHandshake">hang next handshake</button>
```

### 3. Update the board-authoring and user-facing guides

Update only the established sections in these files; preserve their existing front matter, layout
schemas, examples, and audience tone.

- `assets/board-template/CLAUDE.md`: extend the manifest section near lines 33–142 with
  `permissions`, `minBridgeVersion`, and `service`, including the declaration example and the
  statement that permissions are disclosure/lifecycle hygiene rather than security. Insert the
  service contract and the explicit “service versus `executeNode()`” decision immediately after
  `## Guaranteed Node runtime: persephone.executeNode()` (around lines 214–248). Add storage and
  `persephone.service.request` to the bridge reference, including lazy start, structured-clone
  messages, lifecycle errors, shared storage, sanitized environment, built-ins, cwd, ESM,
  `node_modules`, and `ui.log`. Update the Demo-board reference and test steps to include the new
  service controls.
- `assets/guides/agents/boards.md`: update the manifest subsection around lines 616–670 and the
  `executeNode()` section around lines 213–238. Add a concise service section before long-running
  process retention, point to the canonical service-versus-`executeNode()` choice guidance in the
  board template, add the complete authoring contract and storage/request examples, and add MCP
  steps for reading `boards.list().service` and the Demo board.
  Extend the Demo board summary near lines 762–769.
- `assets/guides/boards.md`: update the bridge section around lines 190–290 with the canonical
  choice-guide link, `persephone.service.request`, and `persephone.storage`; add manifest
  declaration fields near the
  board concepts/manifest material; add the service authoring contract and honest trust disclosure;
  extend the Demo board summary near lines 981–994. Keep the existing `persephone.var.*` secrets
  section distinct from the new JSON storage API.
- `assets/guides/agents/board-review.md`: add `service` and `permissions` to the manifest-first
  review step; add `service`/`scripts/service.mjs` to the process-surface table currently listing
  `execute(` and `executeNode(`; instruct reviewers to inspect handshake, request routing,
  storage calls, crash/hang behavior, imports, network use, and `ui.log`. State that declaring
  `service` is not a security boundary because trust already grants arbitrary code execution.
  Point authors to the canonical service-versus-`executeNode()` choice guidance rather than
  duplicating it.
- `assets/guides/whats-new.md`: add an upcoming-release New Features bullet using the compact
  `executeNode()` note around line 585 as the style template. Cover declared services, lazy
  main-owned supervision, no-page requests, storage sharing, visible lifecycle status, and the
  fact that `permissions` is disclosure/lifecycle hygiene, not a grant or sandbox. Link to the
  service sections in `boards.md` and the canonical choice guidance; do not restate that choice
  rule here.

The full service-versus-`executeNode()` distinction is authoritative in the board template, next
to its existing `executeNode()` section. The other four documents link to that guidance and only
describe the service details needed for their audience; they must not independently reword the
decision rule. The authoritative wording is:

```text
executeNode(): board-page child process; page-started; frame-lifetime by default.
service: platform-started utility process; lazy; supervised; usable with no page open.
```

### 4. Add the live verification script to this task document

The implementation must leave the following ordered MCP observations executable against a clean
build. Use the Demo board created by `boards.createDemoBoard(name, dir)` for the normal path, find
its `pageId` through `pages`, drive controls through `pages[pageId].editor`, and query the local
inventory through `boards.list()`. For criteria 7–9, create separate throwaway board folders with
their manifests written before registration; trust, observe, untrust, and delete them afterwards.
Never edit `assets/demo-board/board-manifest.json` during verification: the shipped Demo board must
remain in its single working configuration even if a run is interrupted. These are live boards
created through MCP, not unit-test fixtures or test harnesses.
Use the public host controls by name: `app.boards.requestService` for no-page and post-reload
requests, `app.boards.startService` to reset the restart budget before criterion 5, and
`app.boards.stopService` for explicit teardown where a clean service state is needed. The board
frame's `persephone.service.request` remains the fixture's in-page request path.

1. **Declaration, lazy start, and status.** Open the Demo board, click/evaluate its normal Service
   request, then call `boards.list()`. Expect the matching entry to contain `service.state ===
   "running"`, a numeric `pid`, and an epoch-millisecond `startedAt`; the process must not have
   started merely because the board was installed or trusted.
2. **No-page renderer request.** First establish the service and record its pid and `startedAt`.
   Close the Demo board page, then call `app.boards.requestService(boardRoot, { op: "echo", value:
   "no-page" })`. Expect the structured response, the same pid and the same `startedAt`; query
   `boards.list()` as the status observation. This is the trust-gated MCP-visible host-renderer
   path, not the board-frame bridge.
3. **Renderer reload ownership and cache hydration.** With the service running, record its pid and
   `startedAt`, then call `script.execute("setTimeout(() => location.reload(), 50); return 'reloading'")`
   against the host renderer. After it returns, query `boards.list()` again and expect the service
   status cache to re-hydrate with the same pid, `startedAt`, and `restartCount`, then call
   `app.boards.requestService(boardRoot, { op: "echo", value: "after-reload" })`. Expect the
   replacement renderer to reach the unchanged service. `pages[pageId].editor.reload()` alone is
   only an iframe reload and must not be reported as this observation.
4. **Untrust and in-flight settlement.** Use the Service UI's bounded `delay` request, leave its
   Promise pending, then call `boards.unregisterBoard(boardRoot)`. Within 2 seconds expect the UI
   request to reject with `untrusted`; call `boards.list()` and expect `service.state === "stopped"`
   and `service.reason === "untrusted"`, with no pid.
5. **Crash budget.** Re-trust/reopen the Demo board, call `app.boards.startService(boardRoot)` to
   reset the restart budget, then click `crash service` three times, waiting for each restart
   transition in `boards.list()`. Expect automatic restart after the first two
   failures and, within 60 seconds, `service.state === "failed"`, `restartCount === 3`, and the
   last crash reason readable. A fourth request must reject as `service-failed` rather than silently
   restarting.
6. **Handshake deadline and recovery.** Invoke the Demo control that sends the
   `arm-handshake-hang` request, allow the service to exit and re-enter startup, and call
   `boards.list()` during/after the attempt. Expect the next import to consume and delete the
   one-shot flag, never post `ready`, and be killed at 5 seconds with a failed-start reason
   containing `handshake-timeout`; there must be no occupying pid/slot for that attempt. Wait for
   the supervisor's following normal retry, call `boards.list()`, and issue a normal `echo` request
   to confirm the fixture recovered without a manual reset.
7. **Permission hygiene.** Create a separate throwaway board folder whose manifest retains `service`
   but removes `"service"` from `permissions`; write it before registration, trust/open it, and
   issue a request. Expect no child process, `service.state === "stopped"`,
   `service.reason === "permission-denied"`, and a `permission-denied` request rejection. Untrust
   and delete this folder before continuing.
8. **Disclosure and Board Info.** Use a separate throwaway foreign copy whose manifest declares
   `permissions: ["service"]`, `minBridgeVersion: "1.6.0"`, and the service entry. Call
   `boards.registerBoard(root)` and inspect the trust dialog before accepting; it must list the
   declaration. Open Board Info and expect Permissions, Minimum bridge, Service, and live Service
   status rows. Query `boards.list()` to confirm the same status payload.
   Untrust and delete this folder before continuing.
9. **Bridge compatibility.** Create two separate throwaway folders with an editor `fileMasks`
   declaration before registration: one with `minBridgeVersion` above `1.6.0`, one with
   `minBridgeVersion: "1.6.0"` (or lower). Register/open each and inspect `boards.list()`, Board
   Info, and the editor switch. The high-version board must be listed incompatible with its reason
   and must not register an editor; the compatible board must behave as the current board does.
   Untrust and delete both folders; the shipped Demo manifest remains untouched.
10. **Shared storage and landing path.** From the open Demo frame call `persephone.storage.set`
    and then click the service-side `storage-get` affordance; expect the identical JSON value.
    Reverse the direction with service-side `storage-set` and frame-side `persephone.storage.get`.
    Read `main.runtime.paths.userData`, compute the canonical-root SHA-256 board key, and inspect
    `<userData>/data/board-storage/<board-key>/store.json` (plus its `board.json` metadata). Expect
    the value there and no service-written substitute store.
11. **Existing-board compatibility.** Call `boards.list()` before and after the fixture run and
    open a previously trusted non-service board. Expect existing roots, files, and page behavior to
    remain unchanged; no existing manifest is edited.
12. **Project checks.** From the repository root run `npm run typecheck`, `npm run lint`, and
    `npm run build-prod`. Record these separately from the MCP observations; a green build does not
    replace the twelve live checks.

### 5. Preserve scope boundaries

- Do not edit `src/**`; all platform/API changes belong to US-1466 through US-1469 and the
  concurrently implemented US-1468 plan. If live verification exposes a source defect, record the
  exact path, method, observation, and expected behavior in Concerns rather than fixing it here.
- Do not add unit tests, test harnesses, or test-only assets. Disposable MCP-created boards are
  verification data, not repository fixtures.
- Do not edit `doc/active-work.md` or `doc/epics/EPIC-106.md`.

## Concerns / Open Questions

1. **Resolved MCP-visible request surface.** US-1468 is directed to expose the trust-gated
   `app.boards.requestService(boardRoot, message)`, `startService(boardRoot)`, and
   `stopService(boardRoot)` operations. The verification must use those names if the landed source
   keeps them, or follow the actual public names and record any mismatch; it must not invent a
   private IPC call. `startService` is required to reset the restart budget before criterion 5's
   recovery observation.
2. **Resolved full renderer reload.** `script.execute("setTimeout(() => location.reload(), 50);
   return 'reloading'")` reloads the host renderer without touching main or the service. The status
   cache must be re-read through `boards.list()` afterwards, and identical pid/`startedAt` values
   are the ownership proof. `pages[pageId].editor.reload()` remains only an iframe reload.
3. **Disposable manifest variants are mandatory.** Manifest data is read/cached at trust time, so
   criteria 7–9 write each throwaway manifest before registration and clean up after observation.
   The canonical Demo board is never edited during verification.
4. **Handshake recovery is deliberately one-shot.** The service consumes and deletes the hang flag
   before withholding `ready`; the supervisor's following retry must therefore recover without a
   UI-side reset. If the arriving US-1468 host makes storage unavailable during `starting`, record
   that as a source defect rather than adding a second persistence or recovery channel.
5. **Storage path inspection requires a main path.** The board frame should only use
   `persephone.storage`; it must not expose `<userData>` or a filesystem escape to service code.
   Verification obtains `userData` from the existing `main.runtime.paths.userData` observation and
   computes the already-defined root key externally.

## Acceptance Criteria

- [ ] `assets/demo-board/board-manifest.json` declares `service: "scripts/service.mjs"`,
      `permissions: ["service"]`, and `minBridgeVersion: "1.6.0"` while preserving its existing
      metadata and secondary views.
- [ ] `assets/demo-board/scripts/service.mjs` is a readable ESM service that completes the
      init/ready/probe handshake, answers structured requests, handles shutdown, uses injected
      `persephone.storage`, supports delay/crash/handshake-hang modes, and writes diagnostics to
      stderr rather than corrupting protocol stdout.
- [ ] Demo UI controls can start/request the service, display `boards.list().service` state, run
      both storage directions, hold an in-flight delayed request, crash on demand, arm a one-shot
      handshake hang, verify self-clearing recovery, and render expected lifecycle errors through MCP.
- [ ] Demo Build Guide and Debugging prose distinguish `service.mjs` from `node-server.mjs`, name
      the service contract and `ui.log`, and give an agent a deterministic MCP route to each
      fixture affordance.
- [ ] `assets/board-template/CLAUDE.md` is the single authoritative source for the
      service-versus-`executeNode()` decision; `assets/guides/agents/boards.md` and
      `assets/guides/boards.md` point to it while documenting their audience-specific service
      details. Together they cover all four new authoring surfaces (`permissions`,
      `minBridgeVersion`, `service`, `persephone.storage`), `persephone.service.request`, and the
      exact ESM/cwd/node_modules/environment/built-ins/logging contract.
- [ ] `assets/guides/agents/board-review.md` treats a declared service as a process and supply-chain
      surface and states that `permissions` is disclosure/lifecycle hygiene, not a security boundary.
- [ ] `assets/guides/whats-new.md` contains an upcoming-release note linking to the service authoring
      guide and describing the honest trust/lifecycle model.
- [ ] The twelve ordered observations in this document are executable against a clean build using
      the trust-gated `app.boards.requestService`, `startService`, and `stopService` operations (or
      their source-confirmed public equivalents), including host-renderer reload and status-cache
      hydration.
- [ ] No `src/**`, `doc/active-work.md`, or `doc/epics/EPIC-106.md` file is changed; no unit tests,
      test harnesses, or test-only assets are added.

## Files Changed Summary

| File | Planned change |
|---|---|
| `assets/demo-board/board-manifest.json` | Declare the service, service permission, and bridge requirement. |
| `assets/demo-board/scripts/service.mjs` | New ESM service fixture with handshake, requests, storage, crash, and handshake-hang modes. |
| `assets/demo-board/index.html` | Add MCP-discoverable service controls/status panel and update embedded authoring/debugging prose. |
| `assets/demo-board/app.js` | Wire service requests, storage round-trips, failure controls, and status readout. |
| `assets/demo-board/style.css` | Style the service panel/readouts with existing board tokens. |
| `assets/board-template/CLAUDE.md` | Add manifest axes, storage/request API, service contract, and service-versus-`executeNode()` guidance. |
| `assets/guides/agents/boards.md` | Add condensed agent-facing service authoring and MCP verification guidance. |
| `assets/guides/boards.md` | Add user-facing service, storage, manifest, trust, and Demo-board guidance. |
| `assets/guides/agents/board-review.md` | Add declared-service review and process-surface checks. |
| `assets/guides/whats-new.md` | Add the upcoming-release service feature note. |
| `src/**` | **No change**; consume the arriving US-1468 surface only. |
| `doc/active-work.md` | **No change** by explicit user constraint; existing US-1470 entry already exists. |
| `doc/epics/EPIC-106.md` | **No change** by explicit user constraint. |
| `doc/tasks/US-1468-service-surface/README.md` | **No change**; reviewed plan is an implementation dependency. |
| Test files and harnesses | **No change**; live MCP observations are the verification mechanism. |
