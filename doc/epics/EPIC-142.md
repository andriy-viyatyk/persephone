# EPIC-142: Refactoring Phase 1 — shared primitives and the board core

## Status

**Status:** Completed 2026-11-10
**Created:** 2026-11-10
**Completed:** 2026-11-10

## Overview

The second epic of the [refactoring roadmap](../refactoring-roadmap.md). It takes roadmap Phase 1.1 to 1.4 and
Phase 2.1. These are the enablers that the board-ownership work (Phase 3) and the bridge split (Phase 4) build on:

- one implementation of each cross-process primitive: request correlation, the wire error, the service channel, the
  serial queue, coded errors, path containment and web-contents lifetime;
- one shared board core in `src/shared/board/`: the manifest model, a `BoardGrant` value object and a `BoardRoot`
  identity;
- the board domain modules moved out of `editors/board/` into `api/boards/` (D7).

**Deadline.** D3 puts `BoardGrant` (US-1822) **before** US-1609, which is scheduled for 2027-01-03. US-1609 removes
the legacy permission fallback, and with the grant in place it becomes one deletion rather than 36 call-site edits.

Phase 1.5 (`JsonFileStore`) and 1.6 (typed main→renderer RPC) are not in this epic. They are independent of the board
core, and the next epic can take them with Phase 3.1.

## Goals

- Each primitive in [roadmap §4.3](../refactoring-roadmap.md#43-protocol-primitives) that Phase 1.1 to 1.3 names
  exists once, and every copy the findings list is gone or, for the `.mjs` module-service host that cannot import
  TypeScript, marked as a mirror and checked by `npm run check:contracts`.
- No `"capability:"`, `"board-frame:"`, `"voice-typing:"` or `"text-translation:"` prefix is parsed out of a `boardId`
  string. Port destinations are a typed union.
- `src/shared/board/` owns the manifest model, `BoardGrant` and `BoardRoot`. No `kind === "legacy"` branch remains
  outside `BoardGrant`, and every derived board key is byte-identical to today's.
- The board domain lives in `api/boards/`, and nothing in `api/` imports a board module from `editors/board/`.

## Decisions this epic acts on (roadmap §6, accepted 2026-11-10)

- **D3:** `BoardGrant` before US-1609 (US-1822). The legacy branch lives inside the grant until US-1609 deletes it.
- **D6:** boards never nest. `BoardRoot` compares by exact key. Removing the ancestor-coverage *lookup* in trust and
  the supervisor is Phase 3.1. This epic does not add new ancestor checks.
- **D7:** the board domain goes in `api/boards/` plus `shared/board/`. No new top-level layer, and `api/boards/` is
  still not exposed on `app`.

## Linked Tasks

Task documents are written per task when it is picked up. The finding IDs point at the area reports in
[`doc/reviews/refactoring-2026-11/`](../reviews/refactoring-2026-11/), which hold the evidence and the target shape.

| Task | Title | Scope (roadmap) | Status |
|------|-------|-----------------|--------|
| US-1817 | [Request correlation and the wire error](../tasks/US-1817-pending-requests/README.md) | 1.1: BND-9 steps 1–2 | Done |
| US-1818 | [Small primitives: serial queue, coded error, path containment, web-contents lifetime](../tasks/US-1818-small-primitives/README.md) | 1.3: PLAT-11 steps 2–4, MAIN-4 step 5 | Done |
| US-1819 | [One service channel](../tasks/US-1819-service-channel/README.md) | 1.2, part 1: BND-4, PLAT-11 step 1, SHL-3 (channel) | Done |
| US-1820 | [Typed port routing](../tasks/US-1820-typed-port-routing/README.md) | 1.2, part 2: SHL-3 (routers), PLAT-5 step 3, MAIN-4 step 4 | Done |
| US-1821 | [The board manifest model in `shared/board/`](../tasks/US-1821-shared-board-manifest/README.md) | 1.4, part 1: PLAT-1 step 1, BRD-7 | Done |
| US-1822 | [`BoardGrant`](../tasks/US-1822-board-grant/README.md) | 1.4, part 2: BND-5, BRD-6; D3 | Done |
| US-1823 | [`BoardRoot` identity](../tasks/US-1823-board-root/README.md) | 1.4, part 3: MAIN-3 (identity only) | Done |
| US-1824 | [Move the board domain into `api/boards/`](../tasks/US-1824-api-boards-move/README.md) | 2.1: BRD-8, PLAT-3 slice 1, EDC-13 step 4 (slices 5–7 deferred) | Done |

### Task scopes

**US-1817: Request correlation and the wire error.**
- `shared/pending-requests.ts`: `PendingRequests<T>` with `create(timeoutMs?, signal?) → { id, promise }`,
  `settle`, `fail` and `failAll`.
- One wire error `{ code: string; message: string }` with `toWireError` / `fromWireError`, next to `errMessage` in
  `shared/utils.ts` or in its own `shared/` module.
- Replace the hand-built correlators BND-9 lists, where the change is local: the endpoint `${cmd}_${id}` replies,
  board-settings get/reply, board-pipe read/reply, audio devices, capability open/openResult, and the shim's `rpc`,
  `call` and `hostRequest`. The module-service host's three request clients become one mirrored client in the `.mjs`.
- The MCP command channel keeps its transport. Moving the board methods off it is Phase 1.6, so this task only swaps
  its correlator.
- Error envelopes that a board or an agent can observe keep their current shape. The plan lists each envelope and
  says whether it is internal (may change) or observable (must not).

**US-1818: Small primitives.**
- `shared/serial-queue.ts` (`SerialQueue.run`), replacing every inline promise chain PLAT-11 lists.
- `shared/coded-error.ts` (`codedError`, `toCodedError`, `isCoded`). `CapabilityError` extends it. Replace the five
  "error with code" copies.
- `fpIsInside(parent, child)` in `core/utils/file-path.ts` and one Node equivalent for main, replacing the seven
  containment checks. The case and separator rules must match what each call site does today; where two sites
  disagree, the plan says which rule wins and why.
- `onWebContentsGone(webContents, callback) → dispose` in main, replacing the hand-wired
  `destroyed` / `render-process-gone` / `did-navigate` trio (MAIN-4 step 5). A site that listens to only some of the
  three keeps that subset through an option, not a copy.

**US-1819: One service channel.**
- `shared/service-channel.ts`, per BND-4: the wire type, the `ServiceChannel` interface,
  `createServiceChannel(port, options)` and `domPort` / `electronPort` adapters. It has no dependencies, so the IIFE
  shim can bundle it.
- Replace the six copies: shim, renderer capability channel, main capability channel, speech, translation, and the
  host `.mjs` (kept as a marked mirror, added to `check:contracts`).
- One size rule, one ack policy and one error code per failure, documented in
  `assets/guides/agents/capabilities.md`. This is a deliberate behaviour change that a board can observe, so it
  needs a `BOARD_BRIDGE_VERSION` bump and a history line.
- Live check: voice typing, translation, a board `services.connect` round trip, the audio channel.

**US-1820: Typed port routing.**
- A `ServiceChannelTarget` discriminated union replaces the `boardId` prefixes that US-1807 collected in
  `ipc/module-service-channels.ts`. `parseBoardIdPrefix` goes.
- One renderer port router replaces the five `pendingPorts` / `portWaiters` copies (SHL-3). The speech-port inbox from
  US-1812 becomes one client of it.
- Main gets one `deliverConsumerPort(delivery, channelId, port)` with a typed `ChannelDelivery` (MAIN-4 step 4),
  replacing the three string-parsing copies.
- The prefixes are a private wire protocol between main, the renderer and the host, so no bridge bump is needed.

**US-1821: The board manifest model in `shared/board/`.**
- Move the pure parts of `editors/board/board-manifest.ts` into `shared/board/`: the schema types and
  `parseBoardManifest`, the settings declarations, the masks, the trust disclosure and the identity rule. Fold
  `shared/board-manifest-utils.ts` into the same folder.
- `readBoardManifest` returns the normalized manifest or `null`. A private raw reader stays only for scaffold and
  install staging (BRD-7 step 1). Callers that re-normalize the raw shape switch to the normalized fields.
- The disk IO part stays in the renderer for now (`board-manifest-io`); US-1824 moves it to `api/boards/`.
- Do the split as a pure move first, then the logic changes. Direct imports only: no re-export barrel survives the
  task.
- Main's own manifest readers are Phase 3.1. The plan lists them and leaves them.

**US-1822: `BoardGrant` (D3).**
- A `BoardGrant` value object in `shared/board/` over `NormalizedBoardPermissions`: `allows(flag)`,
  `fileSystemMode()`, `networkPolicy(...)`, `canRunService()`, `iframeFeatures()`, `deny(flag)`, `diff(proposed)`.
- Every `kind === "legacy"` branch outside it is replaced (the findings count 36), including the policy blocks in
  `board-fetch.ts` and `BoardWebview.ts`, the iframe feature mapping and the hand-typed denial strings.
- `boardTrust.getGrant(root)` returns it in the renderer; main's trust service uses the same object.
- The wire snapshot type does not change. US-1609 must afterwards be able to delete the legacy branch inside
  `BoardGrant` and nothing else: the plan shows that this holds.
- The defensive per-call re-checks stay until the session teardown on permission loss exists (BRD-1, Phase 4).

**US-1823: `BoardRoot` identity.**
- `shared/board/board-root.ts`: `BoardRoot.from(path)` with `.path`, `.key`, `.storageKey`, `.host`, `.windowKey`,
  `.localCallerId`, `.bundledId` and `.equals()`. Comparison is by exact key (D6).
- Each derived key is **byte-identical** to the algorithm it replaces: the board storage key, the
  `boardWindowState.<hash>` keys, the `board://` host and the `local:` caller ids. The task document records, for
  each key, the old function, the new property, and a check that both return the same string for a sample of roots
  (Windows path, trailing slash, mixed case, a bundled board).
- Replace the root normalizers and hash schemes MAIN-3 lists, in main and in the renderer.
- Main's manifest reader, bundled-board list and exact-root trust lookup are Phase 3.1, not this task.

**US-1824: Move the board domain into `api/boards/` (2.1).**
- Pure moves: manifest IO, the bundled-board registry, board access, trust consent (`request-board-trust`), busy
  boards, board display text and the contribution registry (`custom-editor-registry`, keeping its name for now) go to
  `api/boards/`. `board-pipe-handler.ts` goes to `content/pipe-resource-server.ts` with neutral names (EDC-13 step 4).
- Move first, with only the import paths changing, then fix whatever cycles the move exposes in a second step.
- Afterwards no `api/` module imports from `editors/board/`, except where the task document names the editor model
  and gives the reason. `editors/board/` keeps the editor models, views, frame session and bridge handlers.
- `api/boards/` stays off `app`. Watch `execute_script` module identity: singletons stay singletons because each
  module has one path.

### Order

1. **US-1817 and US-1818 first.** The service channel and the board core use their primitives.
2. **US-1819, then US-1820.** The router builds on the shared channel.
3. **US-1821, then US-1822 and US-1823.** The grant and the root live next to the manifest model. US-1822 is the
   deadline item, so it goes before US-1823 if time is short.
4. **US-1824 last.** It moves the modules the earlier tasks have just settled.

## Rules for every task in this epic

- **The roadmap guardrails apply** ([§7](../refactoring-roadmap.md#7-guardrails-against-the-drift-coming-back), also
  in `doc/agents-common.md`). Every plan names the module that owns each rule it touches and the existing helper it
  reuses. A plan that adds a new correlator, ack window, error envelope, manifest reader, root normalizer or
  `kind === "legacy"` branch is sent back.
- **Each copy is replaced, not wrapped.** A task is done when the old copies are gone, not when the new primitive
  exists next to them. A copy that cannot move yet (the `.mjs` host) is marked as a mirror and checked by
  `check:contracts`.
- **Pure moves first.** When a task both moves files and changes logic, the move is done and verified on its own
  first.
- **Contracts that must not change** ([roadmap §8](../refactoring-roadmap.md#8-execution-notes)): persisted data
  formats and keys, `window.persephone.*`, the script API, AiVision paths and messages, the `data-name` contract, MCP
  `call` behaviour. The planned exception is the service-channel behaviour in US-1819, which gets a bridge version
  bump. Private wire protocols between the shim, the host, main and the renderer may change; they ship together.
- **Verification:** `npm run typecheck`, `npm run lint`, `npm run build-prod`, `npm run i18n:check` and
  `npm run check:contracts` after every task, plus the live flows each task names. No unit tests.
- **Completion:** the deferred review model. `/review`, `/document` and `/userdoc` run once at epic close.

## Notes

### 2026-11-10
- Created from the refactoring roadmap after EPIC-141 closed. Phase 1.4 is split into three tasks (manifest model,
  grant, root) so the D3 deadline item is small and lands early.
- EPIC-141 already did part of the groundwork: the capability error codes and platform ids in
  `shared/capability-constants.ts`, the `boardId` prefixes collected in `ipc/module-service-channels.ts`,
  `shared/board/page-state-validation.ts`, the shared network guard, and `boardTrust.allows` using
  `boardPermissionAllows` (bug #1).
- Phase 1.5 and 1.6 are left for the next epic, with Phase 3.1.
- US-1824 does PLAT-3 slice 1 only. Slice 7 (the board bridge `api/mcp/board-*` modules) waits for the typed RPC
  (Phase 1.6); slices 5 and 6 (`McpConnectionManager`, `window-screen`) go with roadmap 2.4.
