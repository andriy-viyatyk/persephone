# EPIC-147: Refactoring Phase 4.3 — the typed port RPC and the main board bridge split

## Status

**Status:** Completed 2026-11-11
**Created:** 2026-11-11
**Completed:** 2026-11-11

## Overview

The seventh epic of the [refactoring roadmap](../refactoring-roadmap.md), and the second part of Phase 4 (board bridge
and runtime decomposition). EPIC-146 did the renderer side of the board bridge; this epic does the main side: the
board↔main `MessagePort` contract and `src/main/board-bridge.ts`, which serves it.

- **4.3, BND-3: the port RPC.** Every board→main call is `{ kind: "rpc", id, method, args: unknown[] }`. The shim casts
  each result (29 `rpc("…")` call sites in `board-shim.ts`), and main's table is `Record<BoardRpcMethod, (entry,
  args: unknown[]) => unknown>`, so each handler reads `args[0]`/`args[1]` by position. Permission gating is split:
  `runRpc` tests method-name strings (`method === "servicesList" || …`, `method.startsWith("capability")`), and handlers
  re-check grants themselves. The port also runs a second correlator for `call`/`call-result` with its own id counter.
  The typed `BoardCapabilityRpc` interface in `port-protocol.ts` was started and never used.
- **4.3, MAIN-2: `board-bridge.ts` (1,233 lines).** One procedural module with eight module-level maps and no owner
  (`folderCursors`, `boardPorts`, `boardWatches`, `pendingWatchReservations`, `ownerSinks`, `busyOwners`, `wiredHosts`,
  `boardCallTimeoutMs`). It mixes:
  - file IO and paged folder listing;
  - watches and their re-check on grant change;
  - "remember this path" prompts;
  - TypeScript projects;
  - capabilities, services, storage and the clipboard;
  - the port lifecycle with crash reaping.

  It imports the dialog helpers from `ipc/main/dialog-handlers`, so a service depends on the IPC layer. Four modules
  track overlapping identity for one mounted frame, and none can answer "which frame is this":
  - `board-protocol-service`: `hostToRoot` and the ref counts;
  - `board-bridge`: `boardPorts`;
  - `cdp-service`: `boardRegistrations`;
  - `board-pipe-service`: owners by `webContents`.

  The mount and theme use cases are orchestrated in `ipc/main/board-handlers.ts`.

The shim split (4.4), the module-service host (4.5) and `ContentHostSlot` (4.6) are later epics. This epic changes the
shim only where the port contract requires it.

Already done in earlier epics, so not in scope:
- `capabilityResult` lives in `main/capability-client.ts` (EPIC-145);
- `BoardFileAccessService` (`main/board-file-access.ts`) exists (EPIC-143, 3.1);
- `BoardRoot`/`BoardGrant` are the shared root and grant rules (EPIC-142).

## Goals

- **One typed port contract.** `BoardPortMethods` in `src/ipc/board-bridge/port-protocol.ts` declares params and
  result per method. The shim's `rpc` is generic over it and casts nothing; main's handlers take typed params. The
  handlers still validate at runtime, because the board is untrusted.
- **One correlator on the port.** `call` becomes a method of the same request/reply pair. Fire-and-forget messages
  (`notify`, the runner messages) are typed events.
- **Permissions in the table.** Each handler entry declares `permission?` and `liveFrameOnly?`, and the dispatcher
  enforces them once. No handler re-checks a grant the table already declares. A failed check throws one error type,
  `BoardRpcError`, with a code. The three error conventions go.
- **One owner per piece of state.** No module-level mutable state in the new modules. These classes own it:
  - a main `BoardFrameRegistry` holds one record per mounted frame, and `cdp-service`, `board-pipe-service` and
    `board-protocol-service` look frames up there;
  - a `BoardBridgeConnection` per port owns its watches, capability requests, TS projects and watchdog, and has one
    `dispose()`;
  - `BoardJobRetention` owns the owner sinks, busy owners and reaping.
- **The RPC handlers split by domain** into modules under `src/main/board-host/rpc/`. `BoardFileAccessService`
  already owns file authorization; the domain handlers retain their distinct error mappings.
- **Import direction fixed.** The dialog helpers move to `main/native-dialogs.ts`, imported by both
  `board-bridge` and `ipc/main/dialog-handlers`. A `BoardHostService` owns mount and theme, and `board-handlers.ts` only
  forwards.
- **`board-bridge.ts` shrinks** to a composition root, or is deleted. The last task's plan states the real number.

## Decisions this epic acts on

- **Roadmap §8:** the private wire between the shim and main ships together and may change without a bridge bump.
  `window.persephone` does not change in this epic, so `BOARD_BRIDGE_VERSION` does not move. Every plan that touches
  `src/board-shim.ts` confirms this by diffing the public surface recursively with `Object.keys`.
- **D7:** no new top-level layer. Main-side board hosting goes in `src/main/board-host/` (roadmap MAIN-2), and the wire
  types stay in `src/ipc/board-bridge/`.
- **Laziness stays.** `board-handlers.ts` uses `await import()` to keep board infrastructure out of startup, not to
  dodge a cycle. That stays allowed, but the IPC layer uses one lazy entry (`BoardHostService`) for host lifecycle endpoints; other endpoints retain
  direct lazy imports of their owning services. Each plan says whether any `await import()` it touches breaks a cycle; if one does, the plan fixes the
  direction instead.

## Linked Tasks

Task documents are written per task when it is picked up. The finding IDs point at the area reports in
[`doc/reviews/refactoring-2026-11/`](../reviews/refactoring-2026-11/): MAIN-2 is in `01-main.md` and BND-3 is in
`02-boundary.md`. Line numbers in the reports have drifted, so search by symbol.

| Task | Title | Scope (roadmap) | Status |
|------|-------|-----------------|--------|
| [US-1852](../tasks/US-1852-board-host-service/README.md) | `native-dialogs.ts`, `BoardJobRetention` and `BoardHostService` | 4.3, part 1: MAIN-2 steps 5–7 | Done |
| [US-1853](../tasks/US-1853-main-board-frame-registry/README.md) | Main `BoardFrameRegistry`: one record per mounted frame | 4.3, part 2: MAIN-2 step 1 | Done |
| [US-1854](../tasks/US-1854-board-bridge-connection/README.md) | `BoardBridgeConnection`: one object per port with one `dispose()` | 4.3, part 3: MAIN-2 step 2 | Done |
| [US-1855](../tasks/US-1855-board-port-methods/README.md) | `BoardPortMethods`: the typed port contract, one correlator, declarative permissions | 4.3, part 4: BND-3 | Done |
| [US-1856](../tasks/US-1856-board-rpc-domains/README.md) | RPC handlers by domain | 4.3, part 5: MAIN-2 steps 3–4 | Done |

### Task scopes

**US-1852: `native-dialogs.ts`, `BoardJobRetention` and `BoardHostService`.**
- **Dialog helpers.** `showOpenFileDialog`, `showSaveFileDialog` and `showOpenFolderDialog` move from
  `ipc/main/dialog-handlers.ts` to `src/main/native-dialogs.ts`. `dialog-handlers.ts` and `board-bridge.ts` both
  import from there, and no `src/main/` module imports from `src/ipc/main/` for them. The plan greps for any other
  `main → ipc/main` imports and lists them; fixing those is out of scope unless they are board modules.
- **`BoardJobRetention`.** `src/main/board-host/BoardJobRetention.ts` takes over `ownerSinks`, `busyOwners`,
  `indexOwnerSink`, `reapBoardOwner` and `setBoardBusy`, as one instance created by the bridge. It must keep the
  per-sink vs whole-owner reaping.
- **`BoardHostService`.** `src/main/board-host/BoardHostService.ts` gets `mount(sender, boardRoot, theme, tokens,
  i18n, hostText)`, which runs `registerBoard`, then `ensureHostWired`, and returns the host; `setTheme(theme)` updates
  the protocol themes and pushes them to the ports. The host lifecycle endpoints in `ipc/main/board-handlers.ts` forward to it with one lazy import: register and
  unregister board, update theme, request/update/dispose port, set busy, set call timeout, reap owner, and
  register/unregister frame. Other endpoints keep their direct lazy imports of their owning services.
- **Folder cursors.** `folderCursors` and the call timeout get an owner here, or wait for US-1854; the plan says which.

**US-1853: Main `BoardFrameRegistry`: one record per mounted frame.**
- **The registry.** `src/main/board-host/BoardFrameRegistry.ts` keeps one record per mounted frame: `boardId`, `host`,
  `root`, `ownerId`/`pageId`, `hostWebContents`, `frameNonce`, `hostedPath` and `token`. `register` and `unregister`
  emit events.
- **Inventory first.** Before any code moves, the plan writes a table of today's four registries: the key, the fields,
  who writes them, who reads them, and when each record is removed. Each field either moves to the registry or stays
  with a stated reason. `board-protocol-service`'s host ref counts serve the `board://` protocol per host, not per
  frame, so they may stay; the plan decides.
- **Lookups.** `cdp-service`, `board-pipe-service` and `board-protocol-service` look frames up in the registry and stop
  keeping copies.
- **Behaviour to keep:** frame-nonce matching for board dialogs, the CDP frame attach, and pipe-owner cleanup when
  `webContents` is destroyed.

**US-1854: `BoardBridgeConnection`: one object per port with one `dispose()`.**
- **The connection.** `src/main/board-host/BoardBridgeConnection.ts` is one object per board port. It replaces
  `BoardPortEntry` and owns:
  - the port and its message handler;
  - the watches and pending watch reservations;
  - the capability client requests;
  - the TS projects;
  - the folder cursors, unless US-1852 took them;
  - the call watchdog.
- **One teardown.** Its `dispose(reason)` replaces the cleanup now spread over `disposeBoardPort`,
  `cleanupBoardWatches`, `reapHost` and `disposeAllBoardPorts`. **Before any code moves,** the plan writes the table of
  what each of today's paths clears. Each difference is kept with a reason or removed as a bug.
- **Grant changes.** `recheckBoardWatches` walks the registry's connections instead of the `boardWatches` map.
- **Port delivery.** On the renderer side, a per-board `onBoardPort(boardId, cb)` in `ipc/renderer/api.ts` replaces the
  global subscription that `BoardFrameSession` filters by board id. EPIC-146 deferred this item to 4.3.
- **Ownership.** `wiredHosts` and the load-failure reporting get an owner (the connection set or `BoardHostService`).

**US-1855: `BoardPortMethods`: the typed port contract, one correlator, declarative permissions.**
- **The contract.** In `src/ipc/board-bridge/port-protocol.ts`, `BoardPortMethods` maps each method to
  `{ params: [...]; result: … }`, generalizing the dead `BoardCapabilityRpc`, which goes. The plan lists every current
  `BoardRpcMethod`, its positional args and its result type as the shim reads it today. `BoardRpcMethod` is derived as
  `keyof BoardPortMethods`.
- **The wire.** The port envelopes reuse the shape and helpers of the frame envelopes from EPIC-146 (`req`/`res`/`evt`,
  `PendingRequests`, `toWireError`/`fromWireError`), or the plan explains why the port keeps its own `kind` envelope.
  Either way it adds no new correlator, and `call`/`call-result` become the method `call` on the single correlator.
  Fire-and-forget messages (`BoardFireMethod`, the runner channel) become typed events.
- **The shim.** `rpc<M extends keyof BoardPortMethods>(method, ...params): Promise<Result<M>>`. All 29 casts go.
- **Main.** The handler table becomes `{ [M in keyof BoardPortMethods]: { permission?: …; liveFrameOnly?: true;
  handle(connection, ...params) } }`. The dispatcher enforces `permission` through `BoardGrant`/`boardTrustService` and
  `liveFrameOnly` through the connection. The method-name string tests in `runRpc` go, and handlers drop the grant
  preludes the table now declares.
- **Errors.** Every rejection uses `BoardRpcError` with a code. The `Object.assign(…, { code })` and bare
  `boardPermissionError` forms go. The capability handlers keep their `CapabilityClientResult` envelope, which is the
  board-facing contract of `capabilities.*`. The plan states the error code and message the board sees for each gate,
  before and after; any text that changes is listed for the user guide.
- **Security.** The plan quotes every gate today (`runRpc` and each handler prelude), shows where each one lands in the
  table, and confirms that no method loses a check. An authorization change is called out and justified.

**US-1856: RPC handlers by domain.**
- **Domain modules.** The handler table splits into `src/main/board-host/rpc/`: `files.ts` (read, write, trash, file
  access, folder listing, the "remember" prompts), `watch.ts`, `services.ts`, `capabilities.ts`, `storage.ts` and
  `app.ts` (`openRawLink`, `openBoard`, dialogs, clipboard, TS projects). A table module composes them, and the type
  checks that every `BoardPortMethods` key has exactly one entry.
- **File authorization.** `BoardFileAccessService.authorize` and `authorizeHostedRead` already look up the grant,
  resolve and authorize the path. The remaining call-site code maps errors differently by contract, so no additional
  adapter is added; domain handlers retain those mappings and trust prechecks verbatim.
- **The runner messages** (`RunnerChannel.start`/`stdin`/`kill`) and the clipboard handlers move with their domains.
- **The result.** `board-bridge.ts` ends as a composition root (or is deleted), and the plan states its line count and
  what it still owns.

### Order

1. **US-1852 first.** It is small, mostly moves, and gives the later tasks `src/main/board-host/` and a
   `BoardHostService` to compose into.
2. **US-1853, then US-1854.** The connection reads its frame record from the registry.
3. **US-1855, then US-1856.** The domain modules are written against the typed table, and splitting untyped handlers
   first would be rework. US-1855 touches both the shim and main, so it runs alone.

## Rules for every task in this epic

- **The roadmap guardrails apply** ([§7](../refactoring-roadmap.md#7-guardrails-against-the-drift-coming-back), also
  in `doc/agents-common.md`). Every plan names the module that owns each rule it touches and the existing helper it
  reuses:
  - `PendingRequests` and the wire error (`shared/wire-error.ts`);
  - `BoardRoot` and `BoardGrant`;
  - `boardTrustService` and `BoardFileAccessService`;
  - `capabilityResult`/`CapabilityClient`;
  - the service channel (`shared/service-channel.ts`) and the frame envelopes in `ipc/board-bridge/frame-protocol.ts`.
- **No new protocol code.** The port either reuses the frame envelope shape or keeps one envelope with one correlator.
  A second correlator is a review blocker.
- **Each copy is replaced, not wrapped.** A task is done when the old copies are gone. A forwarding export that stays
  says why in the plan.
- **Teardown changes are explicit.** Any task that moves cleanup code lists what is cleared before and after, for each
  path (port dispose, host destroyed, window closed, app quit, grant change).
- **Security-relevant code keeps its behaviour:**
  - the port token check;
  - the live-frame check for capabilities;
  - the service and file-system grants;
  - hosted-document scoping for watches and reads;
  - the openRawLink scheme allow-list;
  - the dialog frame-nonce match;
  - board storage key validation.

  A plan that changes an authorization check says so and why it is safe.
- **God files only shrink.** `board-bridge.ts`, `board-shim.ts`, `cdp-service.ts` and `board-handlers.ts` end smaller
  than they start.
- **No module-level mutable state in the new modules.** Singletons are explicit instances created by one owner.
- **Contracts that must not change** ([roadmap §8](../refactoring-roadmap.md#8-execution-notes)):
  - `window.persephone.*` (diff `Object.keys` recursively before and after any shim change);
  - board-visible error codes (any change to message text is listed);
  - board storage keys, the `board://` host and `trustedBoards.json`;
  - AiVision and CDP behaviour for board frames;
  - MCP `call` behaviour.

  The private port wire may change, since the shim and main ship together.
- **Verification:** run `npm run typecheck`, `npm run lint`, `npm run build-prod`, `npm run i18n:check` and
  `npm run check:contracts` after every task, plus the live flows each task names. No unit tests.
- **Completion:** the deferred review model. `/review`, `/document` and `/userdoc` run once at epic close.

## Live checks the user runs at close

- Open, reload and close a board; close its window; quit the app with a board open, and check for leftover jobs and
  watches (US-1852, US-1854).
- Change a board's grants while it is open, and untrust it while it is open. Watches re-check or stop, and later calls
  get `permission-denied` (US-1854, US-1855).
- File IO from a board: read, write, trash, file access, a recursive folder listing with a cursor, and a "remember this
  path" prompt (US-1856).
- File and folder watches, including a provider restart replaying its watch (US-1854).
- Board dialogs (open file, save file, open folder) parent to the right window (US-1852, US-1853).
- Services: `services.list`, `connect`, a request and a channel round trip; capabilities: the Excalidraw
  `capabilities.invoke` and a cancel (US-1855).
- `persephone.call(...)` with a timeout, board storage get/set/delete/keys, `openRawLink`, `openBoard`, the clipboard
  and a node runner job with stdin and kill (US-1855, US-1856).
- AiVision over MCP on a board, and a board pipe (stream-host board) (US-1853).
- Theme change while a board is open (US-1852).

## Notes

### 2026-11-11
- Created after EPIC-146 closed. Checked against the code on 2026-11-11:
  - `src/main/board-bridge.ts` is 1,233 lines and holds the eight module-level maps named above.
  - It still imports the dialog helpers from `ipc/main/dialog-handlers`.
  - `runRpc` still gates by method-name string tests.
  - `BoardCapabilityRpc` in `port-protocol.ts` is still unused.
  - The shim has 29 `rpc("…")` call sites plus a separate `call` correlator.
  - `src/main/board-host/` does not exist.
  - `ipc/main/board-handlers.ts` lazy-imports `board-protocol-service`, `board-bridge`, `board-log` and
    `board-storage` per endpoint.
  - `board-shim.ts` is 2,260 lines.
- Out of scope, recorded for later:
  - the shim module split (4.4), which will build on the typed `rpc` from US-1855;
  - the module-service host and supervisor split (4.5);
  - `ContentHostSlot` (4.6).
- US-1854 implementation behavior changes:
  - A stale folder cursor from a disposed or different connection returns `invalid-argument` with
    `The folder cursor is invalid.`; a lookup from another connection does not consume its cursor.
  - Late messages and async responses from a replaced port are dropped instead of being handled or
    delivered through its replacement.
- US-1855 implementation:
  - The service-interface, service, and dialog grant gates now return `permission-denied`; their
    `BoardGrant.deny(...)` messages are unchanged. Dialog path recording retains its post-picker check.
  - The initial implementation measured 1,041 lines in `src/main/board-bridge.ts` and 2,259 in
    `src/board-shim.ts`. Review corrections produce current counts of 1,043 and 2,270 respectively;
    EPIC-147 measures god-file shrink after US-1856.
- Plan corrections from review: `BoardHostService` covers only the host lifecycle endpoints (US-1852); the main
  `BoardFrameRegistry` covers only the CDP frame registrations, and host mounts, pipe owners and ports keep their owners
  (US-1853); the first US-1855 implementation was sent back (synthesized table, message-text matching); no
  `BoardFileAuthorizer` was added, because `BoardFileAccessService` already looks up the grant and resolves the path
  (US-1856).
- Closed 2026-11-11. The epic review (Codex Luna) fixed a runner-event race: a replaced connection no longer resumes a
  job operation after the async execute check. The developer docs and board guides were updated; no catalog messages
  changed. Final sizes: `board-bridge.ts` 1,233 -> 140 lines, `cdp-service.ts` 1,287 -> 1,237, `board-handlers.ts`
  219 -> 212; `board-shim.ts` 2,260 -> 2,270 (reflowed typed port calls; the shim split is 4.4).
