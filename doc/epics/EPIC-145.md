# EPIC-145: Refactoring Phase 3.4 — one capability pipeline

## Status

**Status:** Completed 2026-11-11
**Created:** 2026-11-11
**Completed:** 2026-11-11

## Overview

The fifth epic of the [refactoring roadmap](../refactoring-roadmap.md), and the last part of Phase 3 (board platform
ownership). Today a capability `open` can reach its handler by two live routes, each with its own limits and
cancellation, and main has four copies of the invoke front door. This epic leaves one route
([roadmap §4.4](../refactoring-roadmap.md#44-one-capability-pipeline)):

```
renderer / board / service caller
  → main CapabilityClient (one per caller owner)
  → CapabilityRouter
  → CapabilityBackend ("board-service" | "audio")
```

- **PLAT-4:** `app.capabilities.invoke()` goes through main's router. The renderer `CapabilityBus` loses its limit
  enforcement, and `capabilities.ts` splits into a client, the built-in open handlers and an open-dispatch server.
- **MAIN-4:** one `CapabilityClient` replaces the four front doors, and a `CapabilityBackend` interface removes the
  `mainOwnedAudio` branches and their dynamic imports.
- **Deferred from US-1827:** the typed main→renderer RPC gets cancellation and a no-timeout mode. Capability open moves
  onto it, so the third request envelope (`BoundOpenSettlement`) goes.

Already done in earlier epics, so not in scope: `CAPABILITY_ERROR_CODES` (MAIN-4 step 2, now in
`shared/capability-constants.ts`), `onWebContentsGone` (step 5, `main/webcontents-lifetime.ts`) and the typed
`ChannelDelivery` with `deliverConsumerPort` (step 4, `main/channel-delivery.ts`).

## Goals

- Every capability invocation, from any caller, passes through main's `CapabilityRouter`. There is one deadline, one
  payload-size check, one outstanding cap per handler and one cycle check, all in main.
- The renderer has no capability limit code: no `estimatePayloadSize`, no deadline timer, no outstanding counter and no
  cycle check. The `setTransport`/`registerCapabilityTransport` injection is gone.
- Main has one class that validates an invoke request, tracks duplicate request ids per owner, aborts on owner death and
  maps errors: `CapabilityClient`. The four call sites are a few lines each.
- The router does not know about audio. No `mainOwnedAudio`, no `await import("./audio-service")` or
  `await import("./module-service-supervisor")`. The registry does not define the audio method table.
- Main sends capability open to the renderer through the typed RPC, with cancellation. `eCapabilityOpen`,
  `eCapabilityOpenCancel`, `eCapabilityOpenResult` and `BoundOpenSettlement` are gone.
- `capabilities.ts` and `board-capability-transport.ts` hold no module-level state. Each job has its own module or
  class.

## Decisions this epic acts on (roadmap §6, accepted 2026-11-10)

- **D2:** retire the renderer's "legacy" capability bus path and route every invoke through main's router.
- **D7:** the capability modules stay in `api/` (a `capabilities/` folder there), not a new top-level layer.

## Linked Tasks

Task documents are written per task when it is picked up. The finding IDs point at the area reports in
[`doc/reviews/refactoring-2026-11/`](../reviews/refactoring-2026-11/) (PLAT-4 in `03-api-platform.md`, MAIN-4 in
`01-main.md`).

| Task | Title | Scope (roadmap) | Status |
|------|-------|-----------------|--------|
| US-1839 | [RPC cancellation, and capability open on the typed RPC](../tasks/US-1839-rpc-cancellation-capability-open/README.md) | 3.4, part 1: the US-1827 deferral, PLAT-5 envelope 3 | Done |
| US-1840 | [Main `CapabilityClient`: one invoke front door](../tasks/US-1840-capability-client/README.md) | 3.4, part 2: MAIN-4 step 1 | Done |
| US-1841 | [`CapabilityBackend`: the router stops special-casing audio](../tasks/US-1841-capability-backend/README.md) | 3.4, part 3: MAIN-4 step 3 | Done |
| US-1842 | [`app.capabilities.invoke()` through main; the bus loses its limits](../tasks/US-1842-capability-invoke-through-main/README.md) | 3.4, part 4: PLAT-4 steps 1–2 | Done |
| US-1843 | [Split `capabilities.ts`; `BoardCapabilityDispatcher` owns its state](../tasks/US-1843-capabilities-split/README.md) | 3.4, part 5: PLAT-4 steps 3–4 | Done |

### Task scopes

**US-1839: RPC cancellation, and capability open on the typed RPC.**
- `requestRenderer` (`main/renderer-rpc.ts`) learns two things:
  - **cancellation:** when the caller's `AbortSignal` fires, main sends a cancel message with the request id, and the
    renderer handler receives an `AbortSignal` for it;
  - **a no-timeout mode,** for requests whose deadline the caller owns. Capability open is one: the router already
    runs the deadline.
  Both go in the shared RPC module (`ipc/renderer-rpc.ts`, `main/renderer-rpc.ts`, `renderer/api/renderer-rpc.ts`) and
  use `PendingRequests`. No new correlator.
- Add a `capabilityOpen` method to `RendererRpcMethods`. The router's bound-open dispatch (`capability-router.ts`, the
  `eCapabilityOpen` send and the `eCapabilityOpenResult` listener) calls it with the invocation's signal.
- On the renderer side, `registerBoundOpenDispatch` becomes the RPC handler, and the RPC owns its cancellation map.
  `api-types.ts` loses the three events and `BoundOpenSettlement`. `app-service-registry.ts` stops calling
  `registerBoundOpenDispatch` if the RPC bootstrap registers the handler.
- Validate the platform payload once, from a `PLATFORM_PAYLOAD_VALIDATORS` map keyed by bare id. Today
  `certificate.view` and `theme.edit` are checked at two sites in `capabilities.ts`.
- The plan says how `cancelRendererRequests` (which cancels only `mcpCall`) relates to the new cancellation, and how
  timeouts still settle after a renderer reload.
- Board-pipe read stays on its current path; it moves when the pipe is next reworked.

**US-1840: Main `CapabilityClient`: one invoke front door.**
- `main/capability-client.ts`: a `CapabilityClient` class created per caller owner (window `webContents`, board frame,
  or service record). It has `list`, `providers`, `get`, `invoke(request, delivery)` and `cancel(requestId)`, and it
  owns:
  - request validation (the `requestId` length 256 rule and the shape checks);
  - the per-owner active-request map, which rejects a duplicate request id;
  - the lifetime abort through `onWebContentsGone` or the service's exit;
  - the `capabilityResult` mapping into `CapabilityErrorCode`, through one `toCapabilityError(error)`.
- The four front doors become thin calls:
  - `ipc/main/core-handlers.ts` (platform IPC, `capabilityInvoke`/`capabilityCancel` and the list/get endpoints);
  - `ipc/main/board-handlers.ts` (the host-channel `capability` branch);
  - `main/board-bridge.ts` (the board page);
  - `main/module-service-supervisor.ts` (the board service).
- Their real differences stay explicit options on the client, not copies: which method kinds a caller may use, whether
  it watches `webContents` lifetime, and how errors wrap. The plan lists each difference and where it lands.
- `capabilityResult` moves out of `ipc/main/` into main (MAIN-4 and the note under MAIN-6 step 6).
- **Security:** the reauthorization callbacks keep their exact behaviour. The plan quotes each one before and after.

**US-1841: `CapabilityBackend`: the router stops special-casing audio.**
- `interface CapabilityBackend { call(...); openChannel(...) }` in main. The registry marks each registration with
  `backend: "board-service" | "audio"`.
- `BoardServiceBackend` wraps the supervisor, and `AudioBackend` wraps `audio-service`. Each registers with the router
  at startup, from the main composition root. The router imports neither module, which removes the dynamic imports
  that hide the supervisor → router cycle.
- The audio method table moves out of `capability-registry.ts` into `audio-service` or into
  `shared/platform-capabilities.ts`, next to the other platform declarations; the plan picks one and says why. The
  registry stops filtering board declarations by the id `"audio"` inline, and the plan names the one rule that
  replaces those checks.
- The `mainOwnedAudio` checks in `invoke` and `invokeChannel` (including the `muteApp` argument check) become the
  backend's own validation or a declaration rule. Board-service behaviour does not change.

**US-1842: `app.capabilities.invoke()` through main; the bus loses its limits.**
- `Capabilities.invoke()` resolves with `capabilityGet` (the legacy id/filter mapping) and calls
  `api.capabilityInvoke({ key, method: "open", ... })`. Only the result projection (`projectCapabilityOutcome`) stays,
  for the legacy return shape. The plan decides whether `capabilityLegacyResolve` survives, and deletes it if
  `capabilityGet` covers it.
- Main accepts the renderer as a caller with page context. These must survive: `alwaysOpensNewPage`, `discardPage`,
  and caller-page cancellation. Today the bus cancels a request when its page is disposed (`capability-bus.ts`, the
  `page.disposed` subscription); the plan names the new owner, which is either the client's signal or main's owner
  tracking.
- Delete the bus's limit enforcement: `estimatePayloadSize`, the deadline, the outstanding counter and the cycle
  check. `CapabilityError` moves to `api/capability-error.ts`. The `setTransport`/`registerCapabilityTransport`
  injection goes, since it existed only to break the import cycle with `board-capability-transport`. If any of
  `CapabilityBus` is still needed, the plan says what and why; otherwise it is deleted.
- Port the duplicate error normalizers (`capability-bus.ts` vs `board-capability-transport.ts`) to one.
- The internal callers (about 18 files, for example `BrowserView`, `MermaidEditor`, `ThemeSection`,
  `builtin-schemes.ts`, `capability-feedback.ts` and the scripting wrappers) keep their call shape. The plan checks
  each one's options against the new path.
- Board-side `persephone.capabilities.invoke()` keeps its `{ pageId, result }` shape. No `window.persephone` change,
  so no bridge bump; the plan confirms it.

**US-1843: Split `capabilities.ts`; `BoardCapabilityTransport` owns its state.**
- Pure move first, then logic. `api/capabilities/`:
  - `CapabilitiesClient.ts`: `app.capabilities` (`get`, `providers`, `invoke`, `list`, `handlers`), with the index
    mirror as instance state (it already runs on `MainSnapshotMirror` in `api/capability-index.ts`);
  - `builtin-open-handlers.ts`: the editor-backed handler table, built lazily on first dispatch. `register-editors.ts`
    stops seeding it at module load;
  - `open-dispatch-server.ts`: the RPC open handler from US-1839, with the validators map.
- The channel-port pickup's magic `capability:${requestId}` board id goes, if US-1839 or the `ChannelDelivery` work has
  not already removed it. The plan checks the current code.
- `BoardCapabilityTransport` becomes one class that owns its frames, reservations and initial intents.
  `registerBoardCapabilityFrame`, `markReady` and `fail` become its methods. The module-level maps and the forwarding
  functions go.
- The import zones hold: nothing in `api/capabilities/` imports `ui/`, and no dynamic `import()` breaks a cycle.

### Order

1. **US-1839 first.** US-1842 sends renderer opens through main, and main reaches the renderer through the RPC open.
2. **US-1840, then US-1841.** Both are main-only. The client is the stable entry that the backends plug in behind.
3. **US-1842 after US-1839 and US-1840.** The renderer becomes a caller of the new front door.
4. **US-1843 last.** It splits the modules the earlier tasks have already slimmed.

## Rules for every task in this epic

- **The roadmap guardrails apply** ([§7](../refactoring-roadmap.md#7-guardrails-against-the-drift-coming-back), also
  in `doc/agents-common.md`). Every plan names the module that owns each rule it touches and the existing helper it
  reuses: the typed RPC, `PendingRequests`, the wire error, `CAPABILITY_ERROR_CODES`, `onWebContentsGone`,
  `ChannelDelivery`, `MainSnapshotMirror` and `BoardRegistry`.
- **No new protocol code.** US-1839 extends the typed RPC; it does not add a correlator, an ack window or an error
  envelope next to it.
- **Each copy is replaced, not wrapped.** A task is done when the old copies are gone. A thin alias that stays says
  why in the plan.
- **Main stays the authority.** No renderer change decides trust or widens a permission check. The limits that leave
  the renderer already exist in main; the plan shows each main check that covers a deleted renderer one.
- **Security-relevant code keeps its behaviour:** the reauthorization callbacks, the `untrusted` and
  `permission-denied` paths, and the cycle check. A plan that changes an authorization check says so and why it is
  safe.
- **God files only shrink.** `capability-router.ts`, `board-bridge.ts`, `module-service-supervisor.ts` and
  `core-handlers.ts` end smaller than they start.
- **No dynamic `import()` to dodge a cycle.** US-1841 removes the router's.
- **Contracts that must not change** ([roadmap §8](../refactoring-roadmap.md#8-execution-notes)):
  `window.persephone.capabilities.*` (including `{ pageId, result }` from `invoke`), the script API
  (`app.capabilities.*`), the capability ids and method declarations, the agent-facing `capabilities` node in MCP `call`,
  and the error codes callers see. The private wire between main and the renderer may change, since both ship
  together.
- **Verification:** `npm run typecheck`, `npm run lint`, `npm run build-prod`, `npm run i18n:check` and
  `npm run check:contracts` after every task, plus the live flows each task names. No unit tests.
- **Completion:** the deferred review model. `/review`, `/document` and `/userdoc` run once at epic close.

## Live checks the user runs at close

- Excalidraw (bundled board): `capabilities.invoke` opens a page and the result comes back (US-1842).
- Open a certificate from the browser and edit a theme from Settings: both platform opens work, and a bad payload is
  rejected with the same message (US-1839, US-1842).
- Mermaid and markdown code blocks open their targets; a script's `app.capabilities.invoke()` works (US-1842).
- Close the caller page while an open is pending: the request is cancelled (US-1839, US-1842).
- A board that uses `audio` (`capture`, `play`, `muteApp`) and a board service call still work (US-1840, US-1841).
- A provider-backed board service call from another board, then restart the provider (US-1840, US-1841).
- Agent `capabilities` calls over MCP list and invoke as before (US-1840).
- Reload a window during a pending open: it settles with an error rather than hanging (US-1839).

## Notes

### 2026-11-11
- Created after EPIC-144 closed. Checked against the code on 2026-11-11:
  - both pipelines are live: `capabilities.ts` (333 lines) feeds `capability-bus.ts` (420 lines, its own
    `estimatePayloadSize`, deadline and per-handler counter), while main's router dispatches bound opens over
    `eCapabilityOpen`/`eCapabilityOpenCancel`/`eCapabilityOpenResult`;
  - the request-shape check (`requestId.length > 256`) is copied in `core-handlers.ts`, `board-handlers.ts` and
    `board-bridge.ts`, and the supervisor has its own front door;
  - `capability-router.ts` has 8 `mainOwnedAudio` references and 4 dynamic imports of `audio-service` and
    `module-service-supervisor`; `capability-registry.ts` defines `audioMethods` inline;
  - `requestRenderer` takes a signal but rejects only locally; the renderer handler is never told to cancel;
  - 18 renderer files call `capabilities.invoke(`.
- Out of scope, recorded for later: moving tools trust to main (PLAT-7 step 4); Board Info's internal split
  (BRD-10); SHL-6; board-pipe read on the RPC; MAIN-1's capability adapter in the supervisor split (Phase 4.5), which
  builds on US-1841's backend.
- All five tasks implemented the same day (Sonnet plans reviewed by Claude, Codex Luna implementation), staged, not committed.
- Review corrections applied before implementation:
  - US-1842: platform opens from the window (platform caller, platform-origin handler) skip main's 8 MiB payload cap and
    the per-handler outstanding cap, as they did before; board handlers, agents and services keep both. Sonnet showed the
    `content.view` merge-key change leaves keys unique (each declaration gets its own `handlerKey`).
- Scope and behaviour changes found during planning, to check live:
  - US-1839: a pending capability open does not count as a recent renderer request (browser unload prompt).
  - US-1840: cancel and owner death abort with `cancelled`; the service front door gains the 256-character id cap and
    the shape check.
  - US-1841: the audio declarations moved to `shared/platform-capabilities.ts`; backends register in `main-setup.ts`;
    the router has no dynamic imports.
  - US-1842: `capabilityLegacyResolve` and `capability-bus.ts` are gone. Unpinned invokes now honour
    `capabilities.preferredProviders` (as the board guide documents) and take any major version; renderer limit messages
    are main's short ones (codes unchanged); a board's declared `methods.open.timeoutMs` now applies to internal opens. A
    platform open now crosses IPC twice; open a page source of 20 MB or more to confirm it works.
  - US-1843: the capability modules live in `api/capabilities/`, with an ESLint zone forbidding `ui/` and
    `editors/board/` imports there; the board transport is `BoardCapabilityDispatcher`; the built-in open table is built
    lazily.
- Codex weekly budget: 2% left after US-1843 (resets 2026-11-11 at 14:00).
- Closed 2026-11-11. The epic review (Codex Luna) fixed one detail in the service caller's parent request (passed once,
  not twice); the developer docs and guides were updated. No catalog messages changed.
