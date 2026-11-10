# EPIC-143: Refactoring Phase 1.5, 1.6 and 3.1 — persistence, the renderer RPC and main's board ownership

## Status

**Status:** Completed 2026-11-10
**Completed:** 2026-11-10
**Created:** 2026-11-10

## Overview

The third epic of the [refactoring roadmap](../refactoring-roadmap.md). It finishes Phase 1 with the two primitives
EPIC-142 left out, and then makes main the single owner of board identity and trust (Phase 3.1):

- **1.5:** one `JsonFileStore<T>` for JSON state in main, replacing five ways of writing it (MAIN-11);
- **1.6:** one typed main→renderer RPC, separate from MCP. The board-bridge methods leave the MCP command channel and
  the MCP request log (PLAT-5, BND-9 step 3, MAIN-12);
- **3.1:** main reads board manifests in one place, looks up trust by exact root (D6), pushes trust snapshots to
  subscribers instead of calling them, and owns file-access grants in one `BoardFileAccessService` (MAIN-3 remainder,
  MAIN-5).

EPIC-142 already did MAIN-3's identity part: `BoardRoot`, `board-root-hashes.ts`, `bundled-boards.ts`, and
`BoardTrustService.allows` delegating to `BoardGrant`. The guide mounts already read trust from `boardTrustService`.
This epic does not redo any of that.

Phase 3.2 onwards (the renderer `BoardRegistry` on a `MainSnapshotMirror`, `BoardLifecycle`, the capability
pipeline) builds on the subscriber model from US-1830 and is the next epic.

## Goals

- No main service writes its JSON file by hand. Every store the plan migrates goes through `JsonFileStore`, file formats
  are byte-compatible on read, and writes are atomic.
- No `board_*` method travels over `MCP_EXECUTE` / `MCP_RESULT`. Main calls the renderer through one typed RPC whose
  method map lives in `src/ipc/`, and MCP `call` is one client of it. Board traffic no longer shows up in the MCP
  request log.
- Main has one board manifest reader. No other main module calls `JSON.parse` on a `board-manifest.json`.
- Trust and grant lookups compare by exact `BoardRoot` key. No `isKeyInside` ancestor lookup remains in trust or the
  supervisor, and `overview.md` no longer documents trust inheritance.
- `BoardTrustService` calls no consumer directly. The supervisor, the download service and the others subscribe.
  `getPermissionGrants()` has no side effects.
- File-access grants have one owner. No dynamic `import()` remains between trust, file access and the pipe service.

## Decisions this epic acts on (roadmap Â§6, accepted 2026-11-10)

- **D6:** boards never nest. Trust, grants and the supervisor's trusted-root check use exact-key lookup (US-1829).
- **D12:** user-meaningful configuration goes in `appSettings.json`, geometry and MRU lists in `uiPreferences`.
  US-1825 records the electron-store rule in the same spirit: what stays there and why.

## Linked Tasks

Task documents are written per task when it is picked up. The finding IDs point at the area reports in
[`doc/reviews/refactoring-2026-11/`](../reviews/refactoring-2026-11/).

| Task | Title | Scope (roadmap) | Status |
|------|-------|-----------------|--------|
| US-1825 | [`JsonFileStore`](../tasks/US-1825-json-file-store/README.md) | 1.5: MAIN-11 | Done |
| US-1826 | [The typed main→renderer RPC](../tasks/US-1826-renderer-rpc/README.md) | 1.6, part 1: PLAT-5 steps 1, 2 and 5 (board half), BND-9 step 3, MAIN-12 | Done |
| US-1827 | [Board-bridge methods off the MCP channel](../tasks/US-1827-settings-rpc/README.md) | 1.6, part 2: PLAT-5 step 5 (board-service-settings and the other request/reply pairs); the board-method handlers and `boardThemes` moved into US-1826 | Done |
| US-1828 | [Plain tool functions instead of `McpResponse`](../tasks/US-1828-tool-functions/README.md) | 1.6, part 3: PLAT-5 step 4 | Done |
| US-1829 | [One manifest reader and exact-root trust in main](../tasks/US-1829-main-manifest-reader/README.md) | 3.1, part 1: MAIN-3 remainder; D6 | Done |
| US-1830 | [Trust snapshot subscribers](../tasks/US-1830-trust-subscribers/README.md) | 3.1, part 2: MAIN-5 (trust split, fan-out) | Done |
| US-1831 | [`BoardFileAccessService`](../tasks/US-1831-board-file-access-service/README.md) | 3.1, part 3: MAIN-5 (file-access grants) | Done |

### Task scopes

**US-1825: `JsonFileStore` (1.5).**
- `src/main/json-file-store.ts`: `new JsonFileStore<T>(fileName, { validate, defaultValue })` with `load()`,
  `save(value)` (temp file plus rename, async) and `update(fn)`, serialized through `SerialQueue`
  (`shared/serial-queue.ts`). The temp-file name and the error policy for a corrupt file are decided once, in the plan.
- Migrate in this order: `trustedBoards.json` and the site-extension trust file (the two identical copies in
  `board-trust-service.ts` and `site-extension-trust-service.ts`), then permission decisions
  (`permission-policy-service.ts`, today an atomic *sync* write), UI preferences, open windows and recent downloads.
- For each store the plan records: the file name, the current read path (sync or async, validated or not), whether a
  caller depends on a synchronous write (shutdown paths), and the `validate` function. A store with a synchronous
  shutdown dependency keeps a `saveSync` path through the same class rather than a private copy.
- The file contents must stay readable by the previous version: same file names, same JSON shape. Formatting
  (indentation) stays as it is today per file.
- Record the electron-store rule in `doc/architecture/` (which keys stay there and why). Do not migrate those keys in
  this task.

**US-1826: The typed main→renderer RPC (1.6, part 1).**
- `src/ipc/renderer-rpc.ts`: the `RendererRpcMethods` map (method name → params and result), the channel names and the
  reply envelope `{ ok: true, result } | { ok: false, error: WireError }` (`shared/wire-error.ts`).
- `src/main/renderer-rpc.ts` replaces `src/main/mcp/renderer-bridge.ts`. It uses `PendingRequests`
  (`shared/pending-requests.ts`) and owns the readiness gate (`handlerReady`) and `hasRecentRendererRequest`, which
  `browser-service.ts` then imports from here.
- The renderer side is one server with a typed `register(method, handler)`. `api/mcp-handler.ts` keeps translating
  MCP requests into the JSON-RPC shape the MCP server returns to the agent, so MCP `call` is byte-identical to the
  agent. The plan names the module that owns that translation.
- In this task the existing `board_*` methods move onto the RPC with the same handlers; US-1827 then moves the
  handlers. If the plan finds that one step is cleaner, it may merge US-1826 and US-1827 and says so.

**US-1827: Board-bridge methods off the MCP channel (1.6, part 2).**
- The board handlers register in their own module (`api/boards/bridge-rpc-handlers.ts` or a name the plan justifies)
  with typed params: `boardCall`, `boardThemes` (its own method, not regex parsing of the `call` path in
  `board-call-command.ts`, and no `app.themes as unknown as Record<...>` cast), `openRawLink`, `openBoard` and the
  TS-project methods.
- `api/board-service-settings.ts` stops using raw `ipcRenderer` reply channels: its get/subscribe/unsubscribe requests
  become RPC methods. `src/ipc/board-service-settings-channels.ts` loses what moved.
- The plan lists every other main→renderer request/reply pair it finds (board-pipe, audio devices, `global-mute.ts`)
  and moves the ones that are main→renderer requests. A pair that is renderer→main stays, and the plan says so.
- The MCP request log only records MCP `call`. Check it live: open a board, use it, and the log shows no board
  traffic.
- `window.persephone` does not change, so no bridge bump. If the plan finds a board-visible change, it bumps
  `BOARD_BRIDGE_VERSION` with a history line.

**US-1828: Plain tool functions (1.6, part 3).**
- Replace `api/mcp/tool-commands.ts` with plain typed functions in `api/tools/` (`searchTools`, `refreshToolsets`,
  `createToolset`, and the rest the file holds). The ai-vision `tools` namespace calls them directly; `unwrapResponse`
  and `projectTool`'s re-projection of an `McpResponse` go.
- The agent-visible result of `tools.search()` / `tools.execute()` must not change. The plan shows one before/after
  sample per function.

**US-1829: One manifest reader and exact-root trust in main (3.1, part 1).**
- `src/main/board-manifest-reader.ts`: `readBoardManifest(root: BoardRoot)` returns the manifest normalized with
  `shared/board/board-manifest-schema.ts`, or `null`, with an mtime-keyed cache. It replaces the readers in
  `board-trust-service.ts`, `board-bridge.ts` (board name), `board-protocol-service.ts` (the per-request confinement
  check), `board-storage.ts` (name), `mcp/ai-vision/board-guide-mounts.ts` and `published-boards-service.ts` if it
  reads manifests.
- `bundled-boards.ts` gains `listBundledBoards()`, replacing the `readdir(getAssetPath("boards"))` in
  `board-trust-service.ts` and the bundled root built at `board-trust-service.ts:254`. It becomes the only main module
  that knows `getAssetPath("boards")`.
- D6: replace the `isKeyInside` ancestor lookups in `board-trust-service.ts` (grant lookup, `effectiveRoot`, the
  removal filter) and `module-service-supervisor.ts` (trusted-root check) with exact `BoardRoot.key` comparison. The
  plan shows, per site, why exact lookup gives the same answer for every root that can exist (boards never nest).
  Update `doc/architecture/overview.md` where it documents trust inheritance.
- Check whether the guide mounts honour disabled bundled boards (MAIN-3 says they did not). Fix it if they still do
  not.

**US-1830: Trust snapshot subscribers (3.1, part 2).**
- Split `board-trust-service.ts`: the trust store (on `JsonFileStore` from US-1825), a pure
  `BoardTrustSnapshotBuilder` (grants, manifests and the disabled set → `{ serviceSnapshot, claims, reductions }`),
  and `BoardTrustService` with the mutations, `refresh()`, `current()` and `onSnapshot(listener)`.
- The supervisor, `capabilityRegistry`, `downloadService` and the bridge watches subscribe in `main-setup.ts`. The four
  copies of the `applyBoardServiceTrustSnapshot` + `setBrowserUrlMaskClaims` pair go, and so does the supervisor's
  forwarding to the capability registry and its dynamic import of the trust service.
- `getPermissionGrants()` becomes a pure read. The callers that call it only for its side effect
  (`board-bridge.ts`, `ipc/main/board-handlers.ts`) call `refresh()` where they need fresh manifests, or nothing.
  `board-handlers.ts` stops re-mapping `root`/`boardRoot` and recomputing `canStartService`.
- The `setTrust` ordering must hold: write the file, apply the snapshot, broadcast, then await the service stops. The
  plan shows the order before and after.

**US-1831: `BoardFileAccessService` (3.1, part 3).**
- A class in `src/main/board-file-access.ts` (or a renamed file) that owns persisted folder/file grants, session grants
  (picked, delivered, source reads) and the coverage rule, with `remember(root, kind, path)` and `authorize(...)`.
- The persisted grants move out of `board-trust-service.ts` or are read through it, as the plan decides. One owner, one
  coverage rule: `board-bridge.isAlreadyRemembered` goes, and `rememberFolder` / `rememberFile` call the service.
- No dynamic `import()` remains between `board-trust-service.ts`, `board-file-access.ts` and `board-pipe-service.ts`.
  Fix the import direction (guardrail 5); trust removal reaches file access through the US-1830 subscription.
- Path containment uses `shared/path-containment.ts` / `isPathInside`. No new containment check.
- `trustedBoards.json` keeps its format, including the grant fields.

### Order

1. **US-1825 first.** US-1830's trust store uses it.
2. **US-1826, then US-1827 and US-1828.** They are independent of the board-ownership tasks and may run before or after
   them.
3. **US-1829, then US-1830, then US-1831.** The snapshot builder uses the single manifest reader, and file access
   subscribes to the snapshot.

## Rules for every task in this epic

- **The roadmap guardrails apply** ([Â§7](../refactoring-roadmap.md#7-guardrails-against-the-drift-coming-back), also
  in `doc/agents-common.md`). Every plan names the module that owns each rule it touches and the existing helper it
  reuses: `PendingRequests`, `WireError`, `SerialQueue`, `codedError`, `BoardRoot`, `BoardGrant`, the path containment
  helpers, `onWebContentsGone`.
- **Each copy is replaced, not wrapped.** A task is done when the old copies are gone.
- **Pure moves first.** When a task both moves files and changes logic (US-1826's rename of `renderer-bridge.ts`,
  US-1830's split), the move is done and verified on its own first.
- **Contracts that must not change** ([roadmap Â§8](../refactoring-roadmap.md#8-execution-notes)): `trustedBoards.json`,
  the site-extension trust file and the other migrated JSON files, `window.persephone.*`, the script API, MCP `call`
  behaviour and its JSON-RPC error codes as the agent sees them, AiVision paths and messages. The private wire between
  main and the renderer may change; both sides ship together.
- **Security-relevant code.** The trust, grant and file-access tasks keep every authorization check. A plan that drops a
  check or widens a lookup says so explicitly and why it is safe.
- **Verification:** `npm run typecheck`, `npm run lint`, `npm run build-prod`, `npm run i18n:check` and
  `npm run check:contracts` after every task, plus the live flows each task names. No unit tests.
- **Completion:** the deferred review model. `/review`, `/document` and `/userdoc` run once at epic close.

## Live checks the user runs at close

- Trust a board, change its grants, untrust it; restart and confirm the trust survives (US-1825, US-1830).
- A board that opens a link, opens another board, and uses a `services` call (US-1827).
- The MCP request log shows MCP `call` traffic only (US-1827).
- A board with `fileSystem: "board"` reads a picked file and a remembered folder after restart (US-1831).
- Window positions and open windows survive a restart (US-1825).

## Notes

### 2026-11-10
- Created after EPIC-142 closed. EPIC-142 left Phase 1.5 and 1.6 for this epic, with Phase 3.1.
- Checked against the code on 2026-11-10: `bundled-boards.ts` and `board-root-hashes.ts` exist; the guide mounts read
  trust from `boardTrustService`; `BoardTrustService.allows` delegates to `BoardGrant` (so MAIN-3's "delete `allows`"
  is reduced to the exact-root lookup). Still open: five main manifest readers, the `isKeyInside` ancestor lookups in
  trust and the supervisor, the snapshot fan-out (`board-trust-service.ts` four copies), the dynamic imports between
  trust, file access and the pipe service, and the six `board_*` methods on the MCP channel.
- MAIN-12's audio-window channels and host-service prefixes were done in EPIC-141 and US-1820; only its RPC part is
  here.
- Codex weekly budget was at 6% on 2026-11-10 (resets 2026-11-11 14:00), so implementation should start after the
  reset.
- US-1827 review: board-pipe read and capability open are real main→renderer requests but need RPC cancellation and a
  no-timeout mode. Capability open moves with roadmap 3.4 (one capability pipeline), board-pipe read when the pipe is next
  reworked, and RPC cancellation lands with whichever comes first.
