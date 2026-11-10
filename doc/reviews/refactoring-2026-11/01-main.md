> Part of the [refactoring roadmap](../../refactoring-roadmap.md). Reviewed at commit `c798129d` (2026-11-10); line numbers drift, so search by symbol when they no longer match.

# 01-main (Electron main process) — refactoring review

## Summary

`src/main` has two kinds of code. The older parts are mostly small, single-purpose modules: `git-service`, `sidecar-process`, `global-mute-service`, `ipc-sender-guard`, `version-service`, the tor/mneme wrappers. The platform code added in EPIC-105..140 is not like that. It sits in a few very large procedural modules or "god" singletons that hold a lot of module-level mutable state. Board concepts have no owning module, so each feature re-derives them: board identity, manifests, trust grants, frame registration and file access. The modules also reach each other through dynamic imports and setter injection, which hides several import cycles.

The three biggest problems:

1. **`ModuleServiceSupervisor` (1.5k lines) and `board-bridge.ts` (1.3k lines) are god modules.**
   - The supervisor runs process lifecycle. It also acts as a trust directory, a board-settings proxy, a capability client, an MCP endpoint issuer and three near-identical channel brokers.
   - The bridge is a 30-method RPC table. It mixes file IO, watches, dialogs, job retention, capability routing and load-failure reporting.
2. **Board identity and the board model are re-implemented everywhere.**
   - About 12 path-normalization or comparison functions, with subtly different semantics.
   - 5 board-root hash schemes.
   - 5 independent manifest readers.
   - 2 `bundledBoardId` copies.
   - A second parser of `trustedBoards.json` that bypasses `boardTrustService`.
3. **The capability "front door" is duplicated for each caller kind, and the router hard-codes the audio provider.**
   - Request validation, the duplicate-id map, the abort wiring and error-code mapping are written 4 times.
   - The error-code list is a literal in 4 places.
   - `mainOwnedAudio` branches and dynamic imports stand in for a provider-backend abstraction.

Service lifecycle and IPC registration follow at least four conventions. Two modules break the documented "every `ipcMain` registration goes through the guard" rule.

## Findings

### MAIN-1: ModuleServiceSupervisor is a god class; its extracted helpers are nominal
- **Priority:** P1
- **Effort:** L
- **Where:**
  - `src/main/module-service-supervisor.ts:72-77`, `:81-109`, `:111-157`, `:159-288`, `:435-704`, `:706-752`, `:754-823`, `:832-969`, `:1105-1317`, `:1200-1252`
  - `src/main/module-service-record.ts:37-60`
  - `src/main/module-service-handshake.ts:110-177`
- **Problem:** One class with 9 private maps owns at least eight separate jobs.
  - **Trust-snapshot application and provider index** (`:159-288`, `:858-871`). There are 13 `trustedSnapshot.boards.find(... normalizeRoot(...) === ...)` linear scans. The provider-eligibility test (`service && canStartService && boardPermissionAllows(...,"service") && serviceInterfaces.some(...)`) appears 6 times (`:173`, `:884-886`, `:895-896`, `:934-936`, `:942-943`).
  - **Process lifecycle, restart and kill** (`:310-348`, `:1105-1456`).
  - **Board-settings proxy to a renderer window** (`:93-157`, `:435-704`, `:1471-1479`). About 330 lines. They include renderer selection, subscription reinstall after navigation, and the same inline `{record, process, generation, subscriptionId, webContents?, lifecycleListeners}` type written out four times (`:102-109`, `:570-577`, `:603-610`, `:636-641`).
  - **Capability-client requests from services** (`:706-752`) and **capability results** (`:1206-1218`).
  - **Capability channel relay** (`:754-823`).
  - **Three near-identical direct channel openers:**
    - `openChannel` (`:832-856`)
    - `connectServiceChannel` (`:873-920`)
    - `connectHostServiceChannel` (`:922-969`)

    Each does the per-board/per-service cap check, creates a `MessageChannelMain`, sets `record.channels.set`, posts `channel-open`, posts to `eBoardServiceChannel`, and runs the same catch-and-close cleanup.
  - **MCP endpoint issuance**, written inline as a 30-line closure inside the process message callback (`:1222-1252`).
  - **Spawn environment, entry validation and host config** (`:1294-1360`).
  - **App feature knowledge in a generic supervisor:** `HOST_SERVICE_CHANNEL_POLICIES` lists speech, wake and translate interfaces with renderer boardId prefixes (`:72-77`).

  The earlier extraction into `module-service-record/handshake/leases` is mostly cosmetic:
  - `ServiceRecord` is a 22-field mutable bag written by three modules.
  - `routeProcessMessage` receives 7 callbacks that all close back over the supervisor (`handshake.ts:110-118`). Meanwhile the supervisor still routes `capability-*` messages itself before delegating (`:1200-1218`), so message routing lives in two places.
  - `LeaseCallbacks` (`:85-88`) and `countFailure` (`:1493-1495`) are pass-through indirections.
- **Refactor:** Keep `ModuleServiceSupervisor` as a thin facade, with the same public API used by bridge and handlers. Move the work into collaborators under `src/main/module-service/`:
  1. **`ServiceTrustDirectory`.** Owns `trustedSnapshot`, an index keyed by normalized root, `providerIndex`, and `providerKeys`. API: `isTrusted(root)`, `grant(root)`, `requireProvider(selector, interfaceId, version)` (the single eligibility rule) and `listProviders(interfaceId)`. This replaces every `boards.find` scan.
  2. **Adapters modeled on `ModuleServiceStorageAdapter`** (which already does this well). Each takes a small context interface and owns its pending maps:
     - `ServiceBoardSettingsAdapter` (`:93-157`, `:435-704`)
     - `ServiceMcpEndpointAdapter` (`:1222-1252`)
     - `ServiceCapabilityClientAdapter` (`:706-752`, `:1206-1218`)
  3. **`ServiceChannelBroker`.** One private `deliver(record, owner, info, consumerTarget)` used by `openChannel`, `connectServiceChannel`, `connectHostServiceChannel` and the relay path of `openCapabilityChannel`. Cap checks and cleanup are written once.
  4. **`ModuleServiceProcess`**, one per spawned generation. It owns `fork`, stdout logging, the handshake and a single `kind -> handler` dispatch table (absorbing `routeProcessMessage` and `:1200-1218`). The `isCurrent(record, process, generation)` checks become "is this process object still the record's current one", which removes most generation plumbing from call sites.
  5. **Move `HOST_SERVICE_CHANNEL_POLICIES`** to `src/ipc/module-service-channels.ts` so the renderer's `voice-typing:` and `text-translation:` prefixes come from the same table (see MAIN-12).
- **Risk / notes:**
  - Generation and stop/start races are subtle. Extract the adapters first: they are mechanical, and their behavior is covered by the existing guard checks. Then the directory, then the broker, then the process object.
  - Depends on MAIN-3 (single root key) and MAIN-5 (trust snapshot events).
  - `capabilityRegistry.replace` (`:161`) should move out as part of MAIN-5.

### MAIN-2: `board-bridge.ts` is a procedural grab-bag, and board-frame state is spread over four modules
- **Priority:** P1
- **Effort:** L
- **Where:**
  - `src/main/board-bridge.ts:56-60`, `:92`, `:96-108`, `:157-245`, `:247-312`, `:314-373`, `:437-456`, `:533-672`, `:675-1015`, `:1018-1028`, `:1166-1321`
  - `src/main/cdp-service.ts:181-221`
  - `src/main/board-protocol-service.ts:36-62`
  - `src/main/board-pipe-service.ts:38-75`
  - `src/ipc/main/board-handlers.ts:60-110`
- **Problem:**
  - **Eight module-level maps** with no owner: `folderCursors`, `boardPorts`, `boardWatches`, `pendingWatchReservations`, `ownerSinks`, `busyOwners`, `wiredHosts`, and `boardCallTimeoutMs`.
  - **The single RPC table (`:675-1015`) mixes many concerns:**
    - file IO (`readFile/writeFile/trashFile` `:825-889`)
    - paged recursive folder listing with cursors (`:157-245`)
    - watches and their re-authorization on grant change (`:533-672`)
    - grant "remember" prompts that open `dialog.showMessageBox` (`:775-823`)
    - TypeScript project registration (`:890-920`)
    - capabilities (`:942-973`), services (`:934-991`), storage, and the clipboard (`:1005-1014`)
  - **Port lifecycle** sits beside this, with load-failure reporting and crash reaping (`:1166-1321`).
  - **The same authorization sequence is hand-written** around 18 `resolveAuthorizedPath` call sites: get grant, `if (!grant) throw`, `resolveAuthorizedPath`, map the error code. It uses three different error conventions:
    - bare `boardPermissionError("fileSystem")` (`:752`, `:827`)
    - `Object.assign(boardPermissionError(...), { code: "permission-denied" })` (`:185`, `:732`)
    - `rpcFailure("permission-denied", ...)` (`:781`)
  - **Permission gating is split.** `runRpc` gates by method-name string tests (`:1019-1024`, including `method.startsWith("capability")`) while handlers re-check grants themselves.
  - **Two error contracts in one RPC table.** `capability*` handlers return a `capabilityResult` envelope while all other handlers throw.
  - **Wrong-direction imports.** It imports `showOpen*Dialog` from `ipc/main/dialog-handlers` (`:56-60`) and `capabilityResult` from `ipc/main/core-handlers` (`:92`), so the service layer depends on the IPC registration layer.
  - **No single owner for "a mounted board frame".** Four registries track overlapping identity, and none can answer "which frame is this":
    - `board-protocol-service`: `hostToRoot`/`hostToDesign`/`hostRefCount`
    - `board-bridge`: `boardPorts` keyed by `boardId`, with `host`, `ownerId` and `token`
    - `cdp-service`: `boardRegistrations` keyed by `pageId/tab`, with `boardHost`, `frameNonce` and `title`
    - `board-pipe-service`: owners keyed by `webContents`
  - **The mount use case is orchestrated in the IPC layer.** `registerBoard` then `ensureHostWired` (`board-handlers.ts:60-71`), and a theme change calls two modules (`:89-92`).
- **Refactor:** Create `src/main/board-host/`:
  1. **`BoardFrameRegistry`** (class). One record per mounted frame: `boardId`, `host`, `root`, `ownerId`/`pageId`, `hostWebContents`, `frameNonce`, `hostedPath`, `token`. Its `register()` and `unregister()` emit events; `cdp-service`, `board-pipe-service` and `board-protocol-service` look frames up there instead of keeping copies.
  2. **`BoardBridgeConnection`** (class, one per port). It owns its port, watches, capability requests, TS projects and watchdog. `dispose()` replaces the cleanup now spread over `disposeBoardPort`, `cleanupBoardWatches` and `reapHost`.
  3. **Split the RPC handlers by domain** into `board-rpc/files.ts`, `watch.ts`, `services.ts`, `capabilities.ts` and `app.ts` (openRawLink, openBoard, clipboard, TS projects). Make the table declarative, `{ method: { permission?: "service" | "execute" | "fileSystem", handler } }`, and enforce permissions once in the dispatcher with one error convention (`BoardRpcError` with a code).
  4. **`BoardFileAuthorizer.authorize(boardRoot, path, intent)`** looks up the grant itself and returns `{ path } | throws BoardRpcError("permission-denied" | "not-found")`. It removes the get-grant boilerplate from bridge, `board-handlers`, `board-pipe-service` and `board-protocol-service` (see MAIN-5).
  5. **`BoardJobRetention`** (class) for `ownerSinks`/`busyOwners`/`reapBoardOwner` (`:314-373`).
  6. **Move `capabilityResult`** into a main module (for example `main/capability-client.ts`, MAIN-4) and the dialog helpers into `main/native-dialogs.ts`. Both layers import from `main/`.
  7. **`BoardHostService.mount(...)` and `.setTheme(...)`** own the mount and theme use cases. `board-handlers` only forwards.
- **Risk / notes:**
  - Large but mechanical once `BoardFrameRegistry` exists; do that first.
  - Behavior to preserve: per-sink vs whole-owner reaping (`:1312-1320`) and frame-nonce matching for dialogs.

### MAIN-3: Board identity, manifests and bundled-board discovery have no owner
- **Priority:** P1
- **Effort:** M
- **Where:**
  - Root normalization and comparison:
    - `src/main/board-root-key.ts:10-20`
    - `module-service-supervisor.ts:59-66`
    - `mcp/private-session-endpoints.ts:36-39` (a local `normalizeBoardRoot` that shadows the exported one, with different semantics)
    - `board-trust-service.ts:49-55`
    - `board-log.ts:18-21`
    - `board-file-access.ts:26-36`
    - `board-bridge.ts:103-106`, `:301-312`, `:443-448` (lower-cases on every platform)
    - `site-extension-trust-service.ts:21-24`
    - `mcp/ai-vision/board-guide-mounts.ts:34-36`
    - `ipc/main/core-handlers.ts:241-243`
  - Root hashes:
    - `board-root-key.ts:23-29` (`boardRootKey`)
    - `board-protocol-service.ts:64-71` (`boardRootToHost`)
    - `board-window-identity.ts:57-59` (`boardIdentityHash`)
    - `module-service-supervisor.ts:971-973` and `board-trust-service.ts:469-471` (two `local:` + sha256 caller ids)
  - Manifest readers: `board-bridge.ts:125-135`, `board-trust-service.ts:171-181`, `board-protocol-service.ts:387-394`, `board-storage.ts:214`, `board-guide-mounts.ts:62-71`
  - Bundled boards: `board-log.ts:22-33`, `board-storage.ts:146-160`, `board-trust-service.ts:533-549`, `board-guide-mounts.ts:51-60`
- **Problem:**
  - `board-root-key.ts` declares itself "the canonical board-root string used for board identity". Only `board-storage` and `board-trust-service` use it. Every other module writes its own variant, and they differ:
    - trailing-slash stripping
    - `\` to `/` conversion
    - lower-casing only on win32, or always
  - Five hash schemes derive different ids from the same root.
  - `board-guide-mounts.ts` parses `trustedBoards.json` itself (`:38-49`), claiming main owns it "so this process reads it directly". But the owner is `boardTrustService`, in the same process. It also ignores `setDisabledBundledBoards`, so a disabled bundled board still mounts its guides.
  - Each manifest reader parses JSON its own way. `currentManifestIsObject` re-reads the manifest on every `board://` request (`board-protocol-service.ts:319-320`).
  - `boardTrustService.allows()` (`board-trust-service.ts:332-341`) re-implements `boardPermissionAllows` from `shared/board-manifest-utils.ts:138-142`. `canStartService: kind === "legacy" ? service : flags.service` is re-derived in `board-trust-service.ts:481` and `ipc/main/board-handlers.ts:142`.
- **Refactor:**
  - **Rename `board-root-key.ts` to `board-identity.ts`** and give it a `BoardRoot` value object: `BoardRoot.from(path)` with `.path`, `.key` (comparison), `.storageKey`, `.host`, `.windowKey`, `.localCallerId`, `.bundledId` and `.equals()`. Each existing hash becomes a named derived property that is byte-identical to today's output. Every module above switches to it.
  - **Add `board-manifest-reader.ts`**: `readBoardManifest(root)` returns the parsed manifest, or null, with an mtime-keyed cache. Use it in trust, bridge (`boardName`), protocol (confinement), storage and guide mounts.
  - **Add `bundled-boards.ts`**: `listBundledBoards()` and `bundledBoardId(root)`, the only place that knows `getAssetPath("boards")`.
  - **`board-guide-mounts`** gets roots from `boardTrustService` (trusted plus enabled bundled), not from the file.
  - **Delete `BoardTrustService.allows`** and call `boardPermissionAllows(grant, flag)`.
- **Risk / notes:**
  - Persisted keys must not change: storage key, `boardWindowState.<hash>` window-state keys, and the `board://` host (per-origin `localStorage`). Keep each algorithm and only relocate it.
  - "Boards never nest" is a design invariant. The ancestor-coverage logic (`pathCovers` in `board-trust-service.ts:53-55`, `:334-335`, `:353-366` and `module-service-supervisor.ts:64-66`, `:1097-1103`) could collapse to exact-key lookup, but `doc/architecture/overview.md:411` still documents trust inheritance down the tree. Decide this and update the doc before simplifying.

### MAIN-4: The capability front door is copied per caller kind; the router hard-codes the audio provider
- **Priority:** P1
- **Effort:** M
- **Where:**
  - Front-door copies:
    - `src/ipc/main/core-handlers.ts:75-140`
    - `src/ipc/main/board-handlers.ts:162-178`
    - `src/main/board-bridge.ts:942-973`
    - `src/main/module-service-supervisor.ts:706-752`
  - Error-code lists: `src/main/capability-router.ts:46`, `src/main/module-service-supervisor.ts:742`, `src/renderer/audio/audio-window.ts:481`
  - Audio special-casing:
    - `src/main/capability-router.ts:235-275`, `:426-469`
    - `src/main/capability-registry.ts:20-40`, `:51`, `:70`
    - `src/main/audio-service.ts:285-292`, `:360-363`
    - `src/main/module-service-supervisor.ts:811-812`
- **Problem:**
  - **Four copies of the invoke front door.** Each one validates the request shape (`requestId` length 256 and so on), keeps a per-owner duplicate-requestId map, binds the key, creates an `AbortController`, builds the invocation context, invokes, and maps thrown codes to `CapabilityErrorCode`. The four copies are platform IPC, the host-channel IPC branch, the board page and the board service. They differ in small ways: which method kinds they allow, whether they watch `webContents` lifetime, and the error wrapping.
  - **`CapabilityErrorCode` exists only as a type** (`shared/capability-contract.ts:6`). Its 13 values are retyped as array literals in four places.
  - **Main-owned audio is special-cased inline.** `invoke` and `invokeChannel` branch on `mainOwnedAudio` and use dynamic `import("./audio-service")` and `import("./module-service-supervisor")` (the supervisor statically imports the router, so this hides a cycle).
  - **The registry hard-codes audio.** It defines the audio method table inline and filters board declarations whose id is `"audio"` in two spots.
  - **The consumer-port destination is string-encoded** in `requestId` (`"board-frame:" + boardId`, `board-bridge.ts:962`) and parsed back with `startsWith("board-frame:") ? slice(12)` in three places.
  - **Lifetime listeners are hand-wired.** The trio of `destroyed`, `render-process-gone` and `did-navigate` listeners is added and removed by hand. Main and `ipc/main` have 26 `"render-process-gone"` and 21 `"did-navigate"` listener sites; most are this trio, in `capability-router` (8), `module-service-supervisor` (4), `audio-service` (3) and `core-handlers` (2).
- **Refactor:**
  1. **`src/main/capability-client.ts`: a `CapabilityClient` class**, instantiated per caller owner (window `webContents`, board frame, or service record):
     - `list`, `providers`, `get`, `invoke(request, delivery)` and `cancel(requestId)`
     - owns the active-request map, validation, lifetime abort and `capabilityResult` mapping

     The four call sites become 3-5 lines each.
  2. **Export `CAPABILITY_ERROR_CODES = [...] as const`** from `shared/capability-contract.ts` and derive the type from it. One `toCapabilityError(error)` maps codes.
  3. **Introduce `interface CapabilityBackend { call(...); openChannel(...) }`.** The registry marks each registration with `backend: "board-service" | "audio"`. `BoardServiceBackend` wraps the supervisor and `AudioBackend` wraps `audio-service`; both register with the router at startup. This removes the `mainOwnedAudio` branches and the dynamic imports. The audio method table moves into `audio-service`, or into `shared/platform-capabilities.ts` next to the other platform declarations.
  4. **Add a typed `ChannelDelivery`**: `{ kind: "board-frame"; boardId } | { kind: "renderer"; requestId } | { kind: "service"; process; requestId }`. One `deliverConsumerPort(delivery, channelId, port)` replaces the three string-parsing copies.
  5. **Add `onWebContentsGone(wc, listener): () => void`** in a small `main/webcontents-lifetime.ts` and use it everywhere.
- **Risk / notes:**
  - Security-relevant code: keep the reauthorization callbacks exactly as they are.
  - Do step 3 before MAIN-1's capability adapter.

### MAIN-5: Trust-snapshot fan-out and file-access grant ownership are tangled across modules and cycles
- **Priority:** P2
- **Effort:** M
- **Where:**
  - `src/main/board-trust-service.ts:225-226`, `:256-273`, `:291-330`, `:310`, `:326`, `:371`, `:375-376`, `:389-390`, `:419-531`
  - `src/main/module-service-supervisor.ts:161`, `:1044-1047`
  - `src/main/board-file-access.ts:21-24`, `:112-125`
  - `src/main/board-bridge.ts:437-456`, `:672`, `:977`, `:987`
  - `src/ipc/main/board-handlers.ts:136-156`
- **Problem:**
  - **Hard-coded fan-out.** `BoardTrustService` pushes each new snapshot with direct calls to `moduleServiceSupervisor.applyBoardServiceTrustSnapshot` and `downloadService.setBrowserUrlMaskClaims`. The same pair is copied in 4 places. The capability registry hears about trust only because the supervisor forwards it (`supervisor:161`).
  - **A query with side effects.** `getPermissionGrants()` re-reads every manifest from disk and re-applies the snapshot to the supervisor and the download service (`:264-272`). The bridge and handlers call it just for that side effect (`await boardTrustService.getPermissionGrants();` at `board-bridge.ts:977`, `:987` and `board-handlers.ts:154`). Its result is then re-mapped: `root`/`boardRoot` field names are renamed and `canStartService` is recomputed (`board-handlers.ts:137-149`).
  - **One 110-line method does three jobs.** `createSnapshots` derives snapshots, applies permission reductions, persists them, logs to the board log, broadcasts, and builds URL-mask claims.
  - **File-access grants are owned in three places:**
    - persisted folder/file grants in the trust service (`:291-330`)
    - a cache of those grants plus session grants (picked, delivered, source reads) in `board-file-access` (`:21-24`, `:112-125`)
    - a third coverage implementation in `board-bridge.isAlreadyRemembered` (`:437-449`)

    The two modules call each other through dynamic imports in both directions (`trust:310`, `:326`, `:371` and `file-access:116`). The supervisor also reaches the trust service dynamically (`:1045`) while the trust service imports the supervisor statically.
- **Refactor:**
  - **Split `BoardTrustService`:**
    - `TrustStore`: `parseTrustRecords` and the atomic write (MAIN-11)
    - `BoardTrustSnapshotBuilder`: a pure function from grants, manifests and the disabled set to `{ serviceSnapshot, claims, reductions }`
    - `BoardTrustService`: mutations, `refresh()`, `current()` and `onSnapshot(listener)`
  - **Make consumers subscribe.** The supervisor, `capabilityRegistry`, `downloadService`, bridge watches and file access subscribe in `main-setup`. `getPermissionGrants()` becomes a pure read; callers that need fresh manifests call `refresh()` explicitly.
  - **Create `BoardFileAccessService`** (a class) that owns persisted and session grants and the coverage rule (`allowedByScope`), with `remember(root, kind, path)` and `authorize(...)` (MAIN-2 step 4). The bridge's `rememberFolder`/`rememberFile` call it.
- **Risk / notes:**
  - The ordering guarantees in `setTrust` must be preserved: write the file, then apply the snapshot, then broadcast, then await stops.
  - Pairs with MAIN-3; do MAIN-3 first.

### MAIN-6: Service lifecycle and IPC registration follow four conventions; the documented guard rule is broken
- **Priority:** P2
- **Effort:** M
- **Where:**
  - `src/main/main-setup.ts:23`, `:32-35`, `:42-141`, `:143-169`, `:223-265`
  - `src/main/audio-service.ts:125`, `:134`, `:158`, `:165`, `:176`
  - `src/main/board-dialog-service.ts:69-73`
  - `src/main/module-service-supervisor.ts:111-157`
  - `src/main/capability-router.ts:81-91`
  - `src/main/board-bridge.ts:672`
  - `src/main/mcp-http-server.ts:77`
  - `src/ipc/main/board-handlers.ts:57-58`
  - `doc/architecture/overview.md:66-72`
- **Problem:**
  - **Service shapes:**
    - class plus singleton (supervisor, trust, audio, download, tor)
    - object-literal facade over module functions (`publishedBoardsService`, `boardDownloadService`, `pathWatchService`)
    - bare module functions over module state (bridge, cdp, browser, clipboard, mneme, recording, video-stream, permission-policy, both MCP servers)
  - **Start-up styles:**
    - `init()`, `initialize()`, `initXxxHandlers()`, `initPermissionPolicy()` and `register*Protocol(partition)`
    - IPC and app listeners registered by constructors at import time (supervisor `:111-157`, router `:81-91`)
    - top-level module side effects (`board-dialog-service.ts:69-73` registers raw `ipcMain.handle` at import; `board-bridge.ts:672` subscribes to trust at import; `mcp-http-server.ts:77`)
  - **Shutdown is a hand-maintained list of 12 calls** in `will-quit` (`main-setup.ts:226-265`). Meanwhile `audio-service` hooks `before-quit` itself (`:176`). Nothing ties "has state" to "is disposed".
  - **IPC is registered in three ways:**
    - `bindEndpoint` in `src/ipc/main/*`
    - `guardedIpc*` inside services (browser, cdp, tor, audio, router, supervisor, network-logger, search, worker-host, command-runner, global-mute)
    - raw `ipcMain` in `audio-service` (4×) and `board-dialog-service` (2×), which contradicts overview.md:68-72 ("direct unguarded registrations are not allowed")
  - **Sender policy is ad hoc.** 17 handlers re-check `event.senderFrame !== event.sender.mainFrame`, which the guard already enforces. The real policies ("normal, non-board app window" in `audio-service.ts:82`, `:92`, `:98`, `:102`, `:107`; "the hidden audio window") are inline lambdas.
  - **Cycles are broken with setter injection:** `setPermissionPromptHandler`, `setWebContentsResolver`, `setNetworkResponseBodyResolver`, `setAudioWindowTargetResolver`, `setPrivateMcpStatusChanged`, and `initCdpHandlers(getWebContents, onAiVisionSignal)`.
  - **Dynamic imports with no benefit.** `board-handlers` dynamically imports its services on every call "so Board infrastructure stays lazy" (`:57-58`). `main-setup` already imports `board-bridge`, the supervisor, the trust service and the pipe service statically (`:23`, `:32-35`), so the laziness is fictional and only adds indirection. There are 20 dynamic imports of `git-service` in `git-handlers` alone.
  - **Feature knowledge in the composition root.** `main-setup.ts:162-164` hard-codes the DTLN and onnxruntime vendor files that need CORS inside the `app-asset` handler.
- **Refactor:**
  - **Adopt one convention, documented in `coding-style.md`:**
    - a service is a class with `start()` and `dispose()`
    - only `src/ipc/main/*-handlers.ts` registers IPC (`bindEndpoint`, or `guardedIpc*` for raw channels)
    - no import-time side effects
  - **`main-setup` builds services in dependency order**, passes collaborators through constructors (replacing the setter injection), and disposes them in reverse order on quit. The module-service quit gate stays a special async step.
  - **Add named sender policies to `ipc-sender-guard.ts`:** `requireAppWindow`, `requireNormalWindow` and `requireWindowOf(webContents)`. Delete the 17 redundant checks.
  - **Replace the dynamic imports** in `board-handlers` and `git-handlers` with static imports.
  - **Move the `app-asset` handler and its CORS allowlist** into `main/app-asset-protocol.ts`, with the allowlist as a named constant.
- **Risk / notes:**
  - Incremental, one service at a time.
  - Moving the audio-window channels onto `guardedIpc*` needs the audio-window sender check expressed as a policy, because the guard alone accepts any app-partition `BrowserWindow`.

### MAIN-7: `browser-service.ts` and `cdp-service.ts` are procedural god modules
- **Priority:** P2
- **Effort:** L
- **Where:**
  - `src/main/browser-service.ts:147-171`, `:239-445`, `:510-878`, `:914-1072`, `:1074-1305`
  - `src/main/cdp-service.ts:44-106`, `:181-221`, `:593-620`, `:982-1050`, `:1053-1286`
  - Cycle: `src/main/open-windows.ts` → `open-window.ts` → `browser-service.ts` → `open-windows.ts`
- **Problem:**
  - **`browser-service`:**
    - `registerWebview` is a single ~370-line function wiring 25 listeners (`:510-878`). In one closure it mixes event relay, the navigation-scheme policy, the unload-guard native dialog, HTML fullscreen, mouse-press tracking, keyboard shortcuts, voice-typing forwarding, popup policy and rate limiting.
    - Host-window fullscreen state is kept in four module `WeakMap`s (`:239-290`) and exported to `core-handlers`.
    - cheerio DOM collection (`:914-1072`) sits in the same file.
    - `initBrowserHandlers` also wires the permission prompt, the CDP resolvers and the network logger through setters (`:1101-1305`).
  - **`cdp-service`** has about 20 module-level maps (`:44-106`) and 1,287 lines. It covers:
    - debugger attach and domain enabling
    - page events, console and dialogs
    - navigation waits, response waits and the network collector
    - drag intercept and the AI-vision binding
    - a board frame registry and board-session routing (`:181-221`, `:593-620`, `:982-1050`)

    `cdpSend` dispatches app-window, board and browser targets in one handler (`:1249-1286`).
  - **The window layer imports the browser layer, which imports the window layer back.**
- **Refactor:**
  - **`BrowserGuest` class** (one per registration): owns its listeners, `pressed`/`lastUserActivation`/`htmlFullscreen`/`bypassUnloadGuard` state and `dispose()`. Navigation policy and shortcut handling become small methods or strategy functions.
  - **`BrowserGuestRegistry`** (key to guest), passed to CDP and the network logger as a lookup.
  - **`HostFullscreenController`**, one per `BrowserWindow`, owned by `OpenWindow`. This breaks the cycle.
  - **Move `collectDom`/`collectLoadedResources`** to `browser-dom-snapshot.ts`.
  - **CDP:** add a `CdpTarget` class (one per `webContents`: attach, enabled domains, event dispatcher). Feature modules (`cdp-page-events`, `cdp-waits`, `cdp-network-collector`, `cdp-drag-intercept`) take a `CdpTarget`. The board frame registry moves to MAIN-2's `BoardFrameRegistry`, and `cdpSend` resolves a target through one `resolveTarget(key, sender)` function.
- **Risk / notes:**
  - Automation behavior is subtle (re-registration keeps CDP state, `:514-522`); move the code without changing semantics.
  - Depends on MAIN-2 for board frames.

### MAIN-8: `OpenWindow` hosts the Voice Typing controller and board navigation policy
- **Priority:** P2
- **Effort:** S
- **Where:**
  - `src/main/open-window.ts:62-67`, `:214-239`, `:241-253`, `:317-344`, `:412-549`
  - `src/main/browser-service.ts:733-734`
  - `src/ipc/main/board-handlers.ts:184-191`
- **Problem:**
  - About 150 lines of `OpenWindow` are a voice-typing state machine:
    - shortcut normalization
    - right-Ctrl tap detection
    - session and control-session state
    - text insertion through `executeJavaScript` with deadlines and a clipboard fallback
  - `browser-service` reaches into it through `openWindows.findByWindow(parent)?.handleGuestVoiceTypingInput(...)`.
  - The constructor also carries board-origin attribution for popups and frame navigation (`getBoardRootForHost`). That gives the window class a static dependency chain into the whole board/trust/supervisor graph (`open-window` → `board-protocol-service` → `board-trust-service` → `module-service-supervisor`).
- **Refactor:**
  - **`main/voice-typing-controller.ts`: a `VoiceTypingController` class**, one per window and composed by `OpenWindow`. API: `handleInput(event, input, target, source)`, `setShortcuts`, `setState`, `insertText(sessionId, text, defer)`. The insertion helper (`frame.executeJavaScript` probe plus insert) becomes a private function.
  - **Inject board-origin lookup** as a narrow `(host) => root | undefined`, from MAIN-2's registry, through the constructor.
- **Risk / notes:** Low; the code is self-contained.

### MAIN-9: `permission-policy-service` has five copy-pasted one-shot media grants plus two other concerns
- **Priority:** P2
- **Effort:** S
- **Where:**
  - `src/main/permission-policy-service.ts:47-217`, `:260-306`, `:330-377`, `:424-498`
- **Problem:**
  - **Five copies of the same grant logic.** Recording, voice typing, transcript loopback, audio-window microphone and audio-window loopback grants each have:
    - their own `Map`
    - their own arm/clear/has/consume functions
    - a `destroyed` listener
    - the same `Date.now() + 5000` / `setTimeout(..., 5100)` magic numbers
  - **The map value type `{ expiresAt; frame; target; onDestroyed }` is spelled out 7 times.** `handleRequest` then needs five booleans and three different clear calls (`:435-451`).
  - **Two more concerns in the same module:**
    - persistent per-profile site decisions, stored with synchronous writes (`:260-306`)
    - board-origin subframe policy (`:330-377`)
- **Refactor:**
  - **`OneShotFrameGrant` class**: constructor options `{ ttlMs, bindFrame, platform? }`; methods `arm(target)`, `has(target, frame?)`, `consume(frame)`, `clear(target?)`. One instance per grant kind lives in `media-grants.ts`, and the TTL is a single named constant (grouped tuning constants).
  - **`SitePermissionStore`** (load, get, set, reset, list, remove) on `JsonFileStore` (MAIN-11).
  - **`permission-policy-service`** keeps only `handleCheck`/`handleRequest` and composes the two.
- **Risk / notes:** Low; preserve the "consume on display-media handler only" rule (`:441-447`, `:488-497`).

### MAIN-10: Two MCP HTTP servers and three routed-fetch protocols duplicate their plumbing
- **Priority:** P2
- **Effort:** M
- **Where:**
  - MCP servers: `src/main/mcp-http-server.ts:36-41`, `:81-105`, `:121-214`; `src/main/mcp/private-session-endpoints.ts:15-29`, `:59-75`, `:75-181`
  - Routed fetch: `src/main/tor-src-protocol.ts:39-100`, `src/main/browser-network-service.ts:196-244`, `src/main/session-src-protocol.ts:125-180`, `:346`
- **Problem:**
  - **The public and private MCP servers each implement the same plumbing:**
    - an `http.createServer` loopback host allowlist (`isAllowedHost` vs `allowedHost`)
    - a JSON body parser (`parseJsonBody` vs `parseBody`)
    - a `{ tips, server, transport, lastActivity }` session map
    - Streamable HTTP session start with `createMcpServer`, `onclose` cleanup, oldest-session eviction, status broadcast and the start-promise guard

    Only authentication, the caps and the idle policy differ.
  - **`tor-src` and `profile-src` handlers are near-identical:** parse host plus `?u=`, resolve partition, check for an http(s) target, `session.fetch`, forward only the content type, and `no-store`. `safeProtocol` is copied 3 times.
- **Refactor:**
  - **`main/mcp/mcp-session-host.ts`: a `McpSessionHost` class**, with options `{ authorize(req) → owner, maxSessions, maxPerOwner, idleMs?, onChange }`. Both servers become 60-line wrappers.
  - **`main/routed-fetch-protocol.ts`**: `createRoutedFetchHandler({ scheme, resolvePartition(host), extraHeaders })` serves `tor-src` and `profile-src`. `session-src` reuses `parseRoutedUrl` and `isHttpUrl`.
- **Risk / notes:** The DNS-rebinding and Origin checks are security-relevant; carry them over unchanged.

### MAIN-11: Five ways to persist JSON state
- **Priority:** P2
- **Effort:** M
- **Where:**
  - electron-store: `src/main/e-store.ts`, `open-window.ts:98`, `:402`, `published-boards-service.ts:214-270`, `version-service.ts:67-93`, `dialog-folder-memory.ts:30`, `:50`
  - Non-atomic synchronous writes: `ui-preferences.ts:48-61`, `open-windows.ts:258-270`, `download-service.ts:340-354`
  - Atomic synchronous write: `permission-policy-service.ts:260-271`
  - Atomic async write plus serialize queue, copied verbatim: `board-trust-service.ts:394-417` and `site-extension-trust-service.ts:133-154`
  - Own store: `board-storage.ts`
- **Problem:**
  - No main-process abstraction for "a versioned JSON file in the data folder". Each service picks its own durability, its own validation and its own error policy.
  - Both trust services contain the same temp-file, rename and `serialize()` code.
  - `openWindows.json` and `uiPreferences.json` are written non-atomically and loaded with no shape validation (`open-windows.ts:272-283` returns `JSON.parse` output as `OpenWindowData[]`).
- **Refactor:**
  - **Add `main/json-file-store.ts`**: `new JsonFileStore<T>(fileName, { validate, defaultValue })` with `load()`, `save(value)` (atomic temp file plus rename, async) and `update(fn)` (serialized).
  - **Migrate in order:** the two trust stores (identical code), then permission decisions, UI preferences, open windows and recent downloads.
  - **Record a rule for electron-store** (for example, "geometry and timestamps only") or migrate those keys too.
- **Risk / notes:** File formats stay the same; only the writers change.

### MAIN-12: Contracts defined in the wrong layer, as duplicated string literals
- **Priority:** P2
- **Effort:** S
- **Where:**
  - Audio-window channels: `src/main/audio-service.ts:18-22` vs `src/renderer/audio/audio-window.ts:13-17` (with `src/ipc/audio-channels.ts:1-8` holding the other eight channels)
  - Host-service boardId prefixes: `src/main/module-service-supervisor.ts:72-77` vs `src/renderer/ui/speech/SpeechTranscriptionProvider.ts:16`, `src/renderer/ui/transcript/TranscriptController.ts:73`, `src/renderer/ui/translation/TextTranslationProvider.ts:70`
  - Board-to-renderer requests over MCP: `src/main/mcp/renderer-bridge.ts:7-8`, `:37-60`; `src/main/board-bridge.ts:718`, `:744`, `:906`, `:916`, `:1042`, `:1308`; `src/renderer/api/mcp/command-registry.ts:15-20`; `src/main/browser-service.ts:32`, `:603`
- **Problem:**
  - **Five audio-window control channel names are declared twice**, once in main and once in the renderer, instead of in the `src/ipc` channel file.
  - **The service channel-id prefixes that route speech and translation channels exist in main and are retyped in three renderer files.**
  - **Board operations go to the renderer over the MCP command channel.** `openRawLink`, `openBoard`, `call`, and TS project registration travel as untyped method strings (`"board_openRawLink"`, …) through `mcp/renderer-bridge.ts`, a module whose own comment says it "Reuses the same MCP_EXECUTE/MCP_RESULT channels as the old pipe server". The renderer receives them in its *MCP* command registry. `browser-service` imports `hasRecentRendererRequest` from that MCP module to decide unload prompts.
  - **The general main-to-renderer request transport is filed under `mcp/`,** and its method names are not typed against the renderer's union.
- **Refactor:**
  - **Move the five audio-window channels** into `src/ipc/audio-channels.ts`.
  - **Export `HOST_SERVICE_INTERFACES`** (id, version, open types, `boardIdPrefix`) from `src/ipc/module-service-channels.ts` and use it on both sides.
  - **Rename and move `mcp/renderer-bridge.ts`** to `main/renderer-rpc.ts`, with a `RendererRequestMap` type in `src/ipc/` (method name to params and result) that the renderer command registry also implements. MCP tools and the board bridge then become two clients of the same typed RPC.
- **Risk / notes:** The renderer side is another reviewer's area; coordinate the type move.

### MAIN-13: Dead code and stale leftovers
- **Priority:** P3
- **Effort:** S
- **Where:**
  - `src/main/main.ts` (0 bytes; last touched in the EPIC-070 commit `1d39f09b`)
  - `src/main/mneme-service.ts:61`
  - `src/main/native-dialog-tracker.ts:46`
  - `src/main/cdp-service.ts:14-15`, `:1262`
  - `src/main/tor-src-protocol.ts:6`
  - `src/main/module-service-supervisor.ts:1493-1495`
  - `src/main/board-trust-service.ts:232-234`
- **Problem:**
  - An empty `main.ts` sits next to the real entry `src/main.ts`, which is confusing.
  - `isMnemeRunning` and `registerNativeDialogAbortController` have no callers.
  - Comments still describe "Persephone's own React UI" (cdp-service) and "the app renderer draws itself (React)" (tor-src). The renderer is framework-free.
  - Several exports are used only inside their own files: `boardRootToHost`, `subscribeCdpEvents`, `getRememberedDir`, `revokePrivateMcpEndpoint`, `getMnemeUrl`, `cancelRecordingsForOwner`, `isValidOpenPath`, and the `routeCallPath`/`*BridgeTimeout` helpers in `mcp/tools/call-tools.ts`.
  - Trivial wrappers: `countFailure`, and `ready()`, which only calls `init()`.
- **Refactor:**
  - Delete `src/main/main.ts` and the two unused functions.
  - Fix the comments.
  - Make the internal-only exports module-private.
  - Inline the wrappers.
- **Risk / notes:** None.

### MAIN-14: `video-stream-server` and `clipboard-service` hide separable cores inside procedural modules
- **Priority:** P3
- **Effort:** M
- **Where:**
  - `src/main/video-stream-server.ts:59-62`, `:370-537`, `:539-640`, `:640-695`
  - `src/main/clipboard-service.ts:98-113`, `:189-313`, `:315-456`, `:457-600`, `:600-760`
- **Problem:**
  - **`video-stream-server`** mixes four things: a session registry and HTTP server, a pure MP4 "faststart" rewriter (atom parsing, `stco`/`co64` patching, about 170 lines), an HTTP proxy, and board-pipe range serving.
  - **`clipboard-service`** keeps 15 module-level `let`/`const` state variables. It mixes:
    - the sidecar wire-protocol validators
    - the history index and payload persistence, with orphan sweeping and trimming
    - change capture
    - the ping/pong listener-health state machine
- **Refactor:**
  - **Video:** extract `mp4-faststart.ts` (pure functions on a file descriptor) and `http-range-proxy.ts`.
  - **Clipboard:** extract a `ClipboardHistoryStore` class (index plus payload files, trim, reconcile), a `ClipboardWatcherHealth` class (ping/pong, deaf counter) and `clipboard-wire.ts` (validators). The service composes them.
- **Risk / notes:** Opportunistic; do it when these files are next touched.

## Cross-area notes

- **`src/ipc/main/core-handlers.ts` (899 lines) holds main-process logic, not just registration:**
  - `createBoardShortcut` (`:196-252`), which belongs in `main/board-window-identity.ts`
  - `moveToDisplay` (`:288-372`)
  - the platform capability invoke (`:110-140`), plus an exported mutable `activeCapabilityRequests` `WeakMap` (`:76`) that `board-handlers` mutates (`:165-166`)
  - `checkCapabilitySender` (`:78-82`), which duplicates the guard

  `src/ipc/main/registry-handler.ts` is a Windows-registry service (it shells out to `regedit`) that lives in the IPC layer.
- **`src/ipc/main/board-handlers.ts`:**
  - orchestrates board mount (`:60-71`) and theme fan-out (`:89-92`)
  - round-trips trust-snapshot field names (`:136-149`)
  - carries an inline capability-channel invoke (`:162-178`)
  - uses dynamic imports with a "lazy" rationale that main-setup contradicts

  See MAIN-2, MAIN-4 and MAIN-6.
- **Renderer duplicates of main contracts:**
  - audio-window channel names and the capability error-code list in `src/renderer/audio/audio-window.ts:13-17` and `:481`
  - `voice-typing:` and `text-translation:` prefixes in three renderer UI files
  - `board_*` commands registered in the renderer's MCP `command-registry.ts:15-20`

  See MAIN-4 and MAIN-12.
- **`board-bridge.ts:102` re-implements the renderer's `fpNormalizeForCompare` in main** ("Same normalization as the renderer's…"). A path-compare helper in `src/shared/` would give main, the renderer and the shim one implementation (MAIN-3).
- **`src/shared/board-manifest-utils.ts:138-142` (`boardPermissionAllows`) is the canonical permission test.** Main duplicates it in `board-trust-service.allows` and re-derives `canStartService` in two places.
- **The legacy (`kind: "legacy"`) vs flags permission branching** appears in 20 places across main and `ipc/main`, 7 of them in `board-trust-service`. When the transition ends, a `BoardGrant` value object (`allows(flag)`, `fileSystemMode`, `confinesAssets`) owned with `shared/board-manifest-utils.ts` would remove it in one step.

## Keep

- **`sidecar-process.ts`:** one documented lifecycle (start dedupe, readiness sentinel, stale-child guard) shared by tor, mneme and clipboard-watch. This is the model for consolidating the MCP servers (MAIN-10).
- **`ModuleServiceStorageAdapter`** (an adapter with a small injected context interface) and **`RestartBudget`:** the target shape for the supervisor split (MAIN-1).
- **`ipc-sender-guard.ts` plus `bindEndpoint`**, with `MainApi` derived from the renderer `Api` contract: typed, guarded and centralized error replies. Extend it rather than bypass it.
- **`GlobalMuteService`:** small class, lease-based API, one broadcast path.
- **`git-service.ts`:** a stateless command module with typed results and a single mutation wrapper.
- **`capability-channel.ts`:** a compact, bounded, acknowledged channel with a clear close contract.
- **`board-root-key.ts`'s intent:** a documented canonical identity. Adopt it everywhere (MAIN-3) instead of replacing it.
- **MCP surface as data** (`mcp/server-factory.ts`, `manifest.ts`, the ai-vision node classes): what the server offers is declarative and kept separate from transport.
