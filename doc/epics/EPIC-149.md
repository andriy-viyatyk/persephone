# EPIC-149: Refactoring Phase 4.5 — the module-service host and supervisor split

## Status

**Status:** Completed 2026-11-12
**Created:** 2026-11-11

## Overview

This is the ninth epic of the [refactoring roadmap](../refactoring-roadmap.md) and the fourth part of Phase 4 (board
bridge and runtime decomposition). EPIC-146 to EPIC-148 handled the board frame side. This epic handles board
**services**: the Node process a board can run, and the main-process code that supervises it.

- **4.5, BND-6: `assets/module-service-host.mjs` (1,284 lines).** The process entry is untyped `.mjs`. The contract
  says it "cannot import TypeScript" (`src/ipc/module-service-channels.ts:196`), so it keeps hand copies of the shared
  code:
  - **`PendingRequests` and the wire-error default code.** These are mirrored, and `scripts/check-capability-contract.mjs`
    checks the copy for drift.
  - **`createServiceChannel`, `electronPort` and the service-channel constants and codes.** Also mirrored, with a
    second drift check in the same script.
  - **`createCapabilityProxy`.** This copy has already drifted from `src/shared/capability-client.ts`: the shared
    version skips both `then` and `provider`, and the host skips only `then`.
  - **The capability error-code list.** It is checked by the same script.
  - **`codedError`.** Re-declared locally.

  The host has three request clients: `storageRequest`, `mcpEndpointRequest` and `boardSettingsRequest`. Each has
  its own `PendingRequests` and its own id format, all funnelled through one `mainRequest`. The file also
  mixes six jobs:
  - the lifecycle handshake;
  - a raw-protocol compatibility layer that monkey-patches `parentPort.on/once/off`;
  - the main-request clients;
  - renderer leases with the provider protocol and status throttling;
  - capability handlers and the capability client;
  - the service channel.

  Its node-script sibling, `assets/node-script-host.mjs` (55 lines), shares literals with `src/main/command-runner.ts`.
- **4.5, MAIN-1: `src/main/module-service-supervisor.ts` (1,421 lines),** plus `module-service-{handshake,leases,record,
  restart-budget,storage}.ts` (470 lines). One class with about ten private maps owns eight jobs:
  - the trust snapshot and the provider index, with 22 `trustedSnapshot`/`boards.find` references;
  - process spawn, restart and kill;
  - the board-settings proxy to a renderer window, about 300 lines;
  - capability-client requests from services;
  - the capability channel relay;
  - three near-identical direct channel openers (`openChannel`, `connectServiceChannel`,
    `connectHostServiceChannel`), each with its own cap check, `MessageChannelMain`, `channel-open` post and cleanup;
  - MCP endpoint issuance;
  - `HOST_SERVICE_CHANNEL_POLICIES`, app-feature knowledge (speech, wake, translate) inside a generic supervisor.

  The earlier extraction into `record`, `handshake` and `leases` is mostly nominal:
  - `ServiceRecord` is a mutable bag written by three modules.
  - `routeProcessMessage` takes a callbacks object that closes back over the supervisor.
  - The supervisor still routes the `capability-*` messages itself, so message routing lives in two places.
- **What is already done** (not in scope):
  - BND-4: the shared `createServiceChannel`, with `service-channel-node.ts` for Electron ports.
  - BND-9: `PendingRequests` and the wire error.
  - Phase 3:
    - the main trust snapshot with subscribers (3.1);
    - the one capability pipeline through main's router, with `CapabilityClient` and `CapabilityBackend` in main (3.4).

  `ModuleServiceStorageAdapter` (`module-service-storage.ts`) is already the adapter shape MAIN-1 asks the others to
  copy.

`ContentHostSlot` (4.6) is the next epic.

## Goals

- **The host is TypeScript.** Its source moves to `src/module-service-host/`. It is built by the existing pipeline in
  `scripts/build-prod.mjs` and `scripts/dev.mjs`, like `board-shim` and `site-extension-runtime`, but the output is
  **ESM** for Node (`module-service-host.mjs`). `assets/module-service-host.mjs` is deleted.
- **No mirrors are left.** The host imports these from `src/shared/` and `src/ipc/`:
  - `PendingRequests` and the wire error;
  - `createServiceChannel` with the Electron port adapter;
  - `createCapabilityProxy` and the capability error codes;
  - `codedError`, `errMessage` and the service-channel constants;
  - the `ServiceMainMessage`/`ServiceParentMessage`/`ServiceHostConfig` types.

  The mirror and drift checks in `scripts/check-capability-contract.mjs` are deleted, because the drift they guard
  against can no longer happen. The script keeps every check that still compares two real sources.
- **The host is split by job** into these modules:
  - `lifecycle`: init, probe, ready and shutdown;
  - `raw-protocol-compat`: isolated, with its removal condition written in its header;
  - `main-requests`: one typed client implementation (one instance per request family, each with its own `PendingRequests` and cap), replacing the three copies;
  - `renderer-lease` and `provider-dispatch`;
  - `capabilities`;
  - `service-api`: the `globalThis.persephone` object built from the modules.

  The entry file is a thin composition root.
- **The supervisor is a thin facade.** `ModuleServiceSupervisor` keeps its public API, which is used by the bridge,
  the handlers and the capability backend. Its work moves to collaborators in `src/main/module-service/`, in the
  roadmap's order:
  1. **Adapters** in the `ModuleServiceStorageAdapter` style, each with a small context interface and its own pending
     maps: `ServiceBoardSettingsAdapter`, `ServiceMcpEndpointAdapter` and `ServiceCapabilityClientAdapter`.
  2. **`ServiceTrustDirectory`.** It owns the snapshot, an index keyed by normalized root, the provider index and the
     provider keys. It has one provider-eligibility rule, and no `boards.find` scans are left in the supervisor.
  3. **`ServiceChannelBroker`.** One private `deliver(...)` serves the three openers and the capability-channel relay,
     so the cap checks and cleanup are written once.
  4. **`ModuleServiceProcess`,** one per spawned generation. It owns `fork`, the output logging, the handshake and a
     single `kind -> handler` dispatch table. The table absorbs `routeProcessMessage` and the supervisor's own
     `capability-*` routing. "Is this message current" becomes "is this process object still the record's current
     one".
- **`HOST_SERVICE_CHANNEL_POLICIES` moves** to `src/ipc/module-service-channels.ts`, next to the host-service
  `ServiceChannelTarget` it serves.
- **The existing `module-service-*.ts` helpers move into `src/main/module-service/`** (move-only, imports updated).
  Each is then absorbed into its collaborator or kept with one job.

## Decisions this epic acts on

- **The board-service API does not change.** Board services see `globalThis.persephone.{settings, storage, providers,
  getCapability, capabilities}`, its errors and the raw-protocol behaviour. All of it stays as it is, so
  `BOARD_BRIDGE_VERSION` does not move. Each host task diffs that surface before and after: recursive keys plus
  `typeof` for each leaf, run by hand or with a throwaway script that is not committed.
- **Request error codes and messages do not change.** An earlier draft of this epic said storage timeouts carry no
  `code`. That was stale: all three clients already reject through `mainRequest` with `codedError`
  (`service-timeout`, `service-exited`, `service-busy`). Storage keeps its code-as-message texts; MCP endpoint and
  board settings keep "Service request timed out." / "The service has exited.". The unified client in US-1862 keeps
  each client's messages.
- **Accepted edge difference: `errMessage`.** The host's local `errorMessage` helper is replaced by the shared
  `errMessage`. A thrown non-`Error` value (`throw 42`) now yields its string instead of the fallback, and a
  whitespace-only message yields the fallback. Only those degenerate cases change.
- **The raw protocol stays.** It is isolated in its own module, and nothing else changes. Removing it is a separate
  decision for the user and is not part of this epic.
- **Roadmap §8:** the private wires (`ServiceMainMessage`/`ServiceParentMessage`, the renderer lease port and the
  service channel) ship together with the host and may change without a bridge bump. This epic should not need to
  change them. Any task that does says why.
- **Packaging decides where the built host lives.** `utilityProcess.fork(getAssetPath("module-service-host.mjs"), …)`
  loads it today from `resources/assets/` (an extra resource, outside the asar). Build output under `.vite/` is packed
  into the asar. The first task's plan must:
  - choose the output location: build into `.vite/build/` and resolve it beside `main.js`, with `asarUnpack` if ESM
    from the asar does not load, or build into a folder that `electron-builder.yml` copies as an extra resource;
  - state why it works in **both** the dev layout and the packaged layout;
  - state that the service entry module, which is user code, is still loaded with a real dynamic `import()` that the
    bundler does not touch.

  Node built-ins stay external. A packaged smoke check is part of the user's live checks.
- **`node-script-host.mjs` gets the same treatment, but only for its protocol.** A small shared
  `src/ipc/node-script-host-protocol.ts` (or the location the plan proves fits) owns the `--persephone-node-script`
  flag and the `stdin`/`end-stdin` message kinds. The host and `command-runner.ts` import them. Whether the 55-line
  host itself moves to TypeScript is the plan's call, decided with the same packaging argument.
- **D7:** no new top-level layer beyond the one the roadmap names. `src/module-service-host/` sits next to
  `src/board-shim/` and is a build entry like it. The main-side folder is `src/main/module-service/`.

## Linked Tasks

Task documents are written per task when it is picked up. The finding IDs point at the area reports in
[`doc/reviews/refactoring-2026-11/`](../reviews/refactoring-2026-11/): MAIN-1 is in `01-main.md` and BND-6 is in
`02-boundary.md`. Their line numbers have drifted, so search by symbol.

| Task | Title | Scope (roadmap) | Status |
|------|-------|-----------------|--------|
| US-1861 | The module-service host in TypeScript, with no mirrors | 4.5, part 1: BND-6 steps 1 and 3 | Done |
| US-1862 | The host split by job, and the node-script host protocol | 4.5, part 2: BND-6 steps 2 and 4 | Done |
| US-1863 | `src/main/module-service/` and the supervisor adapters | 4.5, part 3: MAIN-1 steps 2 and 5 | Done |
| US-1864 | `ServiceTrustDirectory` and `ServiceChannelBroker` | 4.5, part 4: MAIN-1 steps 1 and 3 | Done |
| US-1865 | `ModuleServiceProcess` and the thin supervisor facade | 4.5, part 5: MAIN-1 step 4 | Done |

### Task scopes

**US-1861: The module-service host in TypeScript, with no mirrors.**
- **Build first.** Add the host entry to `scripts/build-prod.mjs` and `scripts/dev.mjs` as ESM for Node, and point
  the supervisor's `fork` at the built file. The plan settles the packaging decision above, with evidence from
  `electron-builder.yml`, `getAssetPath` and the dev layout.
- **Convert with as little change as possible.** The file becomes `src/module-service-host/index.ts` (or the name the
  plan picks), typed against `ServiceMainMessage`/`ServiceParentMessage`/`ServiceHostConfig`. Every mirrored helper
  is replaced by its shared import. The `createCapabilityProxy` drift (`then` vs `then` + `provider`) is resolved with
  a stated reason.
- **Constants are imported, not passed.** Any `ServiceHostConfig` field that only carries a compile-time constant is
  dropped from the config, along with its sender in the supervisor. The plan lists each field and whether it is a
  constant or a runtime value.
- **The contract script.** Delete the host mirror checks in `scripts/check-capability-contract.mjs` and the comments
  in `src/shared/pending-requests.ts`, `src/shared/service-channel.ts` and `src/ipc/module-service-channels.ts` that
  refer to the mirror. The plan lists each remaining check and what it still compares.
- **Out of this task:** no split. Job boundaries stay as they are, so the conversion diff stays readable.

**US-1862: The host split by job, and the node-script host protocol.**
- **The modules** are listed in the goals. Each module owns its state in a class instance or a factory closure
  created by the composition root. There is no module-level mutable state, except what a module documents as
  process-wide: the `parentPort` interception in `raw-protocol-compat` is process-wide by nature.
- **One main-request client.** `main-requests` replaces `storageRequest`, `mcpEndpointRequest`,
  `boardSettingsRequest`, `mainRequest` and `settleMainResponse`. It is one implementation with one instance per family (own `PendingRequests`, cap and id prefix), and
  it keeps each client's codes and messages. The copy-pasted response branches go with them.
- **The node-script protocol** is the shared module described in the decisions.
- **The surface diff** is run before and after.

**US-1863: `src/main/module-service/` and the supervisor adapters.**
- **The folder.** Move `module-service-{handshake,leases,record,restart-budget,storage}.ts` into
  `src/main/module-service/` without behavioural edits, and update all importers.
- **The adapters:**
  - `ServiceBoardSettingsAdapter` takes over renderer selection, subscription reinstall after navigation, the aborts
    map and the subscriptions map. The subscription shape that is written out inline several times becomes one named
    type.
  - `ServiceMcpEndpointAdapter` takes over endpoint issuance.
  - `ServiceCapabilityClientAdapter` takes over `capabilityClientFor`, the capability requests map and the result
    handling.

  Each takes a small context interface, not the supervisor.
- **`HOST_SERVICE_CHANNEL_POLICIES`** moves to `src/ipc/module-service-channels.ts`. If the renderer derives its
  `voice-typing:` and `text-translation:` targets from a separate list, the plan makes it read the same table, or says
  why it cannot.
- **Before any code moves,** the plan writes the inventory: each private map and each method of the supervisor, the
  collaborator that will own it (this task or a later one), and every place it is cleared on stop, exit and
  `disposeAll`. That inventory is the checklist for US-1864 and US-1865.

**US-1864: `ServiceTrustDirectory` and `ServiceChannelBroker`.**
- **`ServiceTrustDirectory`** owns the snapshot, the root index, the provider index and the provider keys. It has
  `isTrusted(root)`, `requireProvider(selector, interfaceId, version)` (the single eligibility rule) and
  `listProviders(interfaceId)`. `applyBoardServiceTrustSnapshot` keeps its public signature on the facade.
- **`ServiceChannelBroker`** owns direct and capability channel delivery. `openChannel`, `connectServiceChannel`,
  `connectHostServiceChannel` and the relay path of `openCapabilityChannel` all call one `deliver(...)`. It also owns
  `closeChannel`, `closeChannelsForProvider`, `closeBoardChannels` and `closeRecordChannels`.
- **Before any code moves,** the plan lists the per-opener differences: caps, owner labels, consumer targets, the
  `eBoardServiceChannel` posts and error codes. Each difference is kept as a parameter with a reason, or removed as a
  bug.

**US-1865: `ModuleServiceProcess` and the thin supervisor facade.**
- **`ModuleServiceProcess`** is one object per spawned generation. It owns:
  - `fork`, the spawn environment, entry validation and host config;
  - stdout and stderr logging;
  - the handshake and its timer;
  - the dispatch table that replaces `routeProcessMessage` and the supervisor's `capability-*` branch;
  - unexpected-exit handling, which hands back to the supervisor's restart budget.
- **`isCurrent(record, process, generation)` call sites** become a check against the current process object. The plan
  lists each one and how it is replaced.
- **The facade.** `ModuleServiceSupervisor` keeps its exported singleton and public methods. The plan states its final
  line count and everything it still owns, and checks that `ServiceRecord` is no longer written by more than its owner.

### Order

1. **US-1861, then US-1862.** The host conversion comes first, so the split is reviewed against typed code.
2. **US-1863, then US-1864, then US-1865.** This is the roadmap's risk order: mechanical adapters first, then the
   directory and the broker, then the process object, where the generation and stop/start races live.
3. The host and supervisor tracks touch different files. They still run one task at a time, because US-1865's
   dispatch table must match the host's final message handling from US-1862.

## Rules for every task in this epic

- **The roadmap guardrails apply** ([§7](../refactoring-roadmap.md#7-guardrails-against-the-drift-coming-back), also
  in `doc/agents-common.md`). Every plan names the module that owns each rule it touches and the existing helper it
  reuses: `PendingRequests`, the wire error, `codedError`, `createServiceChannel` with `service-channel-node.ts`,
  `createCapabilityProxy`, the capability constants, `ModuleServiceStorageAdapter` (as the pattern), the main trust
  snapshot and `CapabilityClient`/`CapabilityBackend`.
- **No new protocol code.** No new correlator, envelope or message kind. A task that has to change the private wire
  says why.
- **Each copy is replaced, not wrapped.** A task is done when the old copy is gone.
- **God files only shrink.** `module-service-supervisor.ts` ends each supervisor task smaller than it started it. The
  host entry ends US-1862 as a composition root.
- **The host imports no Electron main-process or renderer code.** It runs in a utility process, so it may use
  `process.parentPort`, Node built-ins, `src/shared/` and type-only `src/ipc/`. The plan checks the built output for
  accidental bundling: its size, and no `electron` import other than what the utility process provides.
- **Behaviour to keep, and to check in every plan that touches it:**
  - the init nonce, probe and ready handshake, and its timeout;
  - capability handlers may only be registered before the entry module finishes startup;
  - the provider status throttle (250 ms) and the active content-read counting;
  - renderer lease attach and drop, and the cleanup on drop;
  - the restart budget and the stop/start and generation races;
  - shutdown handlers running before exit, with the existing timeout;
  - the raw-protocol detection and its queued lifecycle events;
  - the service channel's cap, ack window and backpressure codes.
- **Contracts that must not change** ([roadmap §8](../refactoring-roadmap.md#8-execution-notes)):
  - the board-service `globalThis.persephone` surface (the diff above);
  - board-visible and service-visible error codes and messages, except the one decided change;
  - board storage keys;
  - module-service status as shown in the UI and over MCP.
- **Verification:** run `npm run typecheck`, `npm run lint`, `npm run build-prod`, `npm run i18n:check` and
  `npm run check:contracts` after every task, plus the surface diff and the live flows each task names. No unit tests.
- **Completion:** the deferred review model. `/review`, `/document` and `/userdoc` run once at epic close. `/document`
  updates the key-files and folder-structure entries for both new folders and every doc that names
  `assets/module-service-host.mjs`.

## Live checks the user runs at close

- **Start, stop and restart a board service from the board UI.** The status shows correctly in the UI and over MCP.
  Crash it, for example with `process.exit(1)` from a test service, to see the restart budget.
- **A board whose service uses `persephone.storage`, `persephone.settings` (get and `onChange`, including after the
  renderer window reloads) and an MCP endpoint.**
- **A provider service:** a renderer lease, provider requests, status updates and a content read, then closing the
  board.
- **Capabilities from a service.** `capabilities.handle` serves a call, and `getCapability` with a method call and a
  channel method.
- **Service channels:**
  - board to its own service (`openChannel`);
  - board to another board's provider (`connectServiceChannel`);
  - a host-service channel: voice typing or translation through a provider service.
- **Quit the app with a service running.** Shutdown handlers run, and no service process is left behind.
- **A packaged build** (`npm run dist`, run from `release/`): a board service starts and answers. This proves the
  host's packaged path.

## Notes

- **Sizes at the start:**
  - `assets/module-service-host.mjs`: 1,284 lines.
  - `src/main/module-service-supervisor.ts`: 1,421 lines.
  - `module-service-{handshake,leases,record,restart-budget,storage}.ts`: 470 lines.
  - `assets/node-script-host.mjs`: 55 lines.
- **Sizes at the end of implementation:**
  - The host is `src/module-service-host/` (10 modules, about 1,800 lines with types); `index.ts` is a 191-line
    composition root. The emitted `module-service-host.mjs` is about 67 KB (the old `.mjs` source was 1,284 lines).
  - `assets/node-script-host.mjs` became `src/node-script-host/index.ts`, built like the service host; its protocol
    lives in `src/ipc/node-script-host-protocol.ts`.
  - `src/main/module-service-supervisor.ts`: 1,402 → 725 lines. `src/main/module-service/` holds `record`, `leases`,
    `restart-budget`, `storage`, the three adapters, `trust-directory`, `channel-broker` and `process`;
    `handshake.ts` was absorbed into `process.ts`.
- **Behaviour changes, all deliberate:**
  - `errMessage` replaces the host's local helper (see the decisions).
  - `forceKillAllSync` now settles board-settings requests and subscriptions, which it skipped before (US-1863).
  - All three direct channel openers now send the provider a `channel-close` when consumer delivery fails; only
    `openChannel` did before, so the provider kept a channel nobody received (US-1864).
  - The shutdown nonce is the stopping process's own generation, the same value as before; stop no longer bumps the
    generation, because clearing `record.current` is the invalidation (US-1865).
- **Packaging:** both built hosts are copied to `resources/assets/` as extra resources and excluded from the asar;
  `getNodeHostEntryPath` picks the dev or packaged path. The packaged build has not been run yet (user live check).
