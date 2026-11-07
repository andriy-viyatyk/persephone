# US-1794: Main-process capability registry and routing

## Goal

Implement the main-owned capability index and router in [EPIC-140](../../epics/EPIC-140.md), preserving existing clients until US-1795 and enabling US-1796. The [capability contract](../../../assets/guides/agents/capabilities.md) is normative; its Manifest, Migration, Resolution and discovery, Routing, lifecycle and wire, Authorization, and Errors sections are part of this plan.

## Background

The verified [US-1792 inventory](../US-1792-capabilities-inventory/README.md) and [bus architecture](../../architecture/capability-bus.md) describe two currently separate mechanisms. `src/renderer/api/capabilities.ts` seeds platform declarations from `editorRegistry.getAll()`, keeps `candidates`, and resolves locally; `src/renderer/api/capability-bus.ts` owns intent settlement, limits and cancellation. `src/renderer/api/board-capability-transport.ts` opens/reuses board pages. `src/renderer/editors/board/custom-editor-registry.ts` rebuilds board declarations from compatible trusted and enabled bundled sources, including Board Info issues. `src/ipc/capability-bus-channels.ts` defines the current intent wire and error vocabulary.

`src/main/board-trust-service.ts` builds the trusted/bundled snapshot and intersects stored `uses` grants with current declarations. `src/main/module-service-supervisor.ts` holds that snapshot, starts utility services lazily, authorizes exact-version channel grants, closes channels on snapshot changes, and applies `HOST_SERVICE_CHANNEL_POLICIES` to legacy app channels. `src/main/board-bridge.ts` gates legacy service discovery against granted `uses`. `src/main/board-root-key.ts` computes a stable root key. `assets/module-service-host.mjs` supplies `persephone.service.onRequest` and `onChannel`, independently of the proposed handler. `src/shared/board-manifest-utils.ts` currently recognizes reserved service IDs or legacy slash IDs and normalizes service declarations and grants.

Main reads raw manifest JSON with `JSON.parse` in `board-trust-service.ts`; renderer `board-manifest.ts` separately parses and normalizes it. Repeated method names retain the last definition. `src/renderer/api/settings.ts` persists `appSettings.json` in the renderer; `src/renderer/api/app.ts` forwards `main.scripting.enabled` on load and change. Main does not load that settings file (`src/main/open-windows.ts`, `src/renderer/api/window.ts`). Forward `capabilities.preferredProviders` the same way; main retains the last value received and does not accept preferences from board frames.

## Implementation Plan

Each numbered phase, including 1a and 1b, is a separate deliverable. Run `npm run typecheck`, `npm run lint`, and `npm run build-prod` at the end of **each** phase. No unit tests or test harnesses. Manual checks use Persephone MCP `call` with `script.execute` or the settings-gated `main.script.execute`; use disposable trusted boards and restore preferences/trust after checking. Main scripting is enabled in development by default or in Settings → MCP Server. `main.script.execute` has a 10-second limit: run longer operations asynchronously and inspect their state in a later call. Add a narrow `capabilityRouter` object to the existing main script scope in `src/main/mcp/ai-vision/main-script.ts` for these checks and future privileged diagnostics; it is not exposed to board scripts. Its methods are the same internal router methods described below, not a separate test-only route. Use actual renderer window `webContents` / page context for open calls. Capture settled promises in `globalThis` for later inspection where necessary. For phases 2 and 3, create one disposable board at `<data directory>/scratch/US-1794/` with `board-manifest.json`, `service.mjs` and an `index.html` page: declare a service with `permissions.service: true`, a call method, a channel method and an open method; implement `handle`, `onRequest`, `onChannel` and a page intent responder. Trust it for the checks, then untrust and delete the scratch folder after phase 3. This is a manual fixture, not a test harness.

### 1a. **Shared schema, migration and platform definitions.** Files: new `src/shared/capability-contract.ts`, `src/shared/capability-limits.ts`, and `src/shared/platform-capabilities.ts`; `src/shared/board-manifest-utils.ts`, `src/renderer/editors/board/board-manifest.ts`, `src/renderer/editors/board/custom-editor-registry.ts`, `src/main/board-trust-service.ts`, `src/renderer/editors/register-editors.ts`, and `src/renderer/editors/base/editorRegistry.ts`.
- [x] Add shared protocol limits and platform metadata.
- [x] Share declaration parsing, validate new methods, and preserve legacy declarations and grants.
- [x] Map legacy service open types and merge their named methods with explicit declarations.
- [x] Perform the manual MCP checks below (Claude, 2026-11-07: core paths verified — see Notes).
- [x] Run the phase verification commands below.
- Move pure declaration normalization/validation into shared code used by both manifest readers. Validate each new declaration independently, report malformed entries through the existing Board Info capability issue path, and retain valid siblings. Apply the Manifest field bounds, defaults, id/reserved-prefix rules, argument order, service/permission requirements and exactly one payload descriptor for open. Distinguish omitted `methods` (legacy) from invalid or empty methods; preserve legacy validation, `@major`, filters, metadata, headless and existing behavior. Preserve `accepts: []` for new declarations. JSON parsing retains the last repeated method definition.
- Normalize `serviceInterfaces` using the contract's complete v1 open-type mapping (including `agent.session`), optional `openTypes` and exact slash ids. Preserve unknown types for unchanged legacy `services.connect`. Merge by board/id/version, with explicit methods winning collisions and legacy channel opens still routable separately. Extend `normalizeServiceUses` for new dot IDs while preserving existing grants and slash IDs; intersect grants on change without silently granting additions.
- Put all protocol tuning values in one commented block in `src/shared/capability-limits.ts`: 32 declarations/methods, 16 args, default 10,000 ms and maximum 600,000 ms, 8 MiB, depth 8, 32 per handler and 32 service requests, 16 channels per consumer board, 128 per service, 256 unacknowledged messages per direction, 1 MiB per channel message, and relevant string limits. Reuse existing values rather than creating competing constants; pass values in startup configuration if the host asset cannot import shared TypeScript.
- Extract built-in `text.open` and `content.view` metadata from the editor registration table into `src/shared/platform-capabilities.ts`, consumed by renderer registration and later by main; preserve editor IDs, representations and priority 50. Keep renderer handler functions local. This phase must leave all existing app behavior unchanged.
- **MCP checks:**
  1. Run `script.execute` with `app.capabilities.list()` and `app.capabilities.handlers("content.view")`; expect the existing platform entries and ordering.
  2. Trust a disposable board with one valid legacy capability and one invalid new declaration; inspect Board Info and `app.capabilities.list()`: the issue is shown, and the valid legacy entry remains available.
  3. Invoke an existing legacy board open via `script.execute` and `app.capabilities.invoke`; expect its prior page and result behavior.
  4. Open an existing board service using its legacy `services.connect` path; expect its channel behavior and grant checks to remain unchanged.
- Run `npm run typecheck`, `npm run lint`, and `npm run build-prod`.

### 1b. **Main index, discovery and preferences.** Files: `src/main/board-trust-service.ts`, `src/ipc/module-service-channels.ts`, new `src/main/capability-registry.ts` and `src/main/capability-router.ts`, `src/ipc/capability-bus-channels.ts`, `src/shared/version-utils.ts`, `src/shared/platform-capabilities.ts`, `src/renderer/editors/board/custom-editor-registry.ts`, `src/renderer/api/settings.ts`, `src/renderer/api/types/settings.d.ts`, `src/renderer/api/app.ts`, `src/ipc/api-types.ts`, `src/ipc/renderer/api.ts`, `src/ipc/main/core-handlers.ts`, and `src/main/mcp/ai-vision/main-script.ts`.
- [x] Build the main index and discovery, binding, preferences and renderer snapshot IPC.
- [x] Refresh the index after board updates and apply compatibility and service eligibility.
- [x] Perform the manual MCP checks below (Claude, 2026-11-07: core paths verified — see Notes).
- [x] Run the phase verification commands below.
- Extend the main snapshot with normalized declarations, manifest name, service and granted permission data. Build one authoritative main index in snapshot order from platform metadata and trusted/enabled boards; `provider = boardRootKey(root)`, `name` is separately discoverable, and `handlerKey` distinguishes registrations. Replace the board portion atomically on each snapshot before asynchronous cleanup. Revalidate live work on trust, disable, update and grant changes; guard asynchronous rebuild generations against restoring removed entries. Ensure board update refreshes snapshots even without a trust change. Reserve `system.*`; do not register `system.audio`.
- Compatibility is already implemented in shared `src/shared/version-utils.ts` as `getBoardCompatibility`; main and renderer must call that same function, not copies. Today `customEditorRegistry.refresh()` filters using `minBridgeVersion`, object-permission requirements and `BOARD_BRIDGE_VERSION`; it does **not** pass `minAppVersion`. `publishedBoards.isCompatible()` in `src/renderer/api/published-boards.ts` separately passes `minAppVersion` and the app version for catalog filtering. Keep registry eligibility aligned with the existing renderer bridge check and do not silently add a minimum-app-version gate to existing registrations. `bundledBoardRegistry.enabledEntries()` and `isDisabled()` in `src/renderer/editors/board/bundled-board-registry.ts` filter `disabled-bundled-boards`; main's `BoardTrustService.setDisabledBundledBoards()` and `createSnapshots()` must consume the same enabled set. If factoring the requirement construction is necessary, place the pure helper in `src/shared/version-utils.ts` and use it on both sides.
- Define `list(caller)`, `providers(caller,id)`, `resolve(caller,id,options)`, and `invoke(bound,method,args,context)` as main-internal API in `capability-router.ts`; implement discovery and resolve/bind in this phase, with dispatch added in later phases. Caller identity and window/page/service ownership are created by trusted main entry points. Board discovery applies exact grants without starting services. Resolution defaults to major 1, filters exact MIME/representation, handles unique visible name or key selection, then eligible persisted preference, priority, platform and registration order; explicit unavailable/ambiguous provider returns no match. Binding stores provider and handler identity and reauthorizes at invocation, never falling back. Multiple registrations for a provider use priority/order. Add read-only renderer index IPC with sender validation and revisioned index snapshot/change notifications; no renderer may register arbitrary providers.
- Add the setting key, default `{}`, JSON-object validation and documentation to `settings.ts` and its public type. Forward the value once after settings load and on each change through the existing app startup IPC pattern. Main retains the last value received and ignores unavailable preferences during resolution without deleting them. There is no preference revision protocol or wait for an initial forward.
- **MCP checks:**
  1. Use `main.script.execute` with `capabilityRouter.list({ kind: "platform" })` and `capabilityRouter.providers({ kind: "platform" }, "content.view")`; expect platform entries with provider `persephone`.
  2. Trust a disposable board and query its providers; expect its `boardRootKey` and manifest name. Disable or untrust it and query again; expect immediate removal.
  3. Set `capabilities.preferredProviders` through `script.execute` and `app.settings.set`, then resolve a capability with competing eligible providers; expect the preferred provider, while an explicit eligible provider takes precedence.
  4. Restart the app and query the preference and provider key; expect the persisted setting to be forwarded and the root key to be unchanged.
- Run `npm run typecheck`, `npm run lint`, and `npm run build-prod`.

### 2. **Service `handle` and call routing.** Files: `src/main/capability-router.ts`, `src/main/module-service-supervisor.ts`, `src/ipc/module-service-channels.ts`, `assets/module-service-host.mjs`, `src/shared/board-bridge-version.ts`, `src/shared/capability-contract.ts`, `src/shared/capability-limits.ts`, `src/main/mcp/ai-vision/main-script.ts`.
- [x] Define typed call, result, and cancellation wire messages.
- [x] Implement service handler registration and call dispatch with deadlines, limits, cancellation signals, and registry reauthorization.
- [x] Connect caller-owned lifetimes and inherited chains across page and service routes.
- [x] Update the bridge version and provider guidance.
- [x] Perform the manual MCP checks below (Claude, 2026-11-07: core paths verified — see Notes).
- [x] Run the phase verification commands below.
- Add typed `capability-call`, `capability-result`, `capability-cancel` messages exactly as in the contract; route through the supervisor's existing process/generation and startup lifecycle without changing `onRequest`. Track request IDs, owner, provider generation, deadline and chain; reserve both per-handler and service request slots before startup, and release exactly once on all settlements. Validate JSON and byte sizes in both directions, map recognized error codes and sanitize unknown errors to `rejected`. Reauthorize after lazy startup and before dispatch, and on each snapshot/grant change. Reject stale bound provider, dead caller or provider with the contract's precise codes; ignore late results.
- In the host add `persephone.capabilities.handle(id, method, handler)`: only declared call methods, one handler per id/method, synchronous registration during startup, unsubscribe; invoke with positional array and main-assigned `{ signal, caller }`. Use an AbortController per live request; cancellation aborts and removes it. Missing registration after startup returns `no-handler`; handlers do not wait for late registration. Keep host declaration data authenticated from startup, never trust a message to authorize itself.
- Start the deadline before startup/queueing; send cancel on timeout, caller abort/closure and revocation. Propagate inherited chain through page/service routes; detect repeated handler and depth 8. Limit arguments/results, reject cycles and cleanup on crash, reload, close or shutdown. Associate a caller's lifetime with a main-owned abort signal. Preserve side effects already performed.
- Bump `src/shared/board-bridge-version.ts` from `1.49.0` to `1.50.0` when shipping `handle`. Record in `assets/guides/agents/capabilities.md` that providers using `handle` set `minBridgeVersion` to `1.50.0`; US-1796 publishes the guide.
- **MCP checks:**
  1. Trust the scratch board and use `main.script.execute` to resolve its call method as platform; expect the board provider without starting its service during discovery.
  2. Invoke that bound call through `capabilityRouter`; expect the handler's JSON result and authenticated `ctx.caller`.
  3. Invoke a declared call without a registered handler; expect `no-handler`.
  4. Invoke a slow handler with a short deadline; expect `timeout` and the handler's `ctx.signal` to abort.
  5. Use `script.execute` and `app.boards.requestService` against the board's existing `onRequest`; expect the legacy response.
- Run `npm run typecheck`, `npm run lint`, and `npm run build-prod`.

### 3. **Channel and open routing.** Files: `src/main/capability-router.ts`, `src/main/module-service-supervisor.ts`, `src/main/board-bridge.ts`, `src/ipc/module-service-channels.ts`, `src/ipc/capability-bus-channels.ts`, `src/renderer/api/board-capability-transport.ts`, `src/renderer/api/capabilities.ts`, `src/renderer/api/capability-bus.ts`, `src/renderer/api/app.ts`, `src/ipc/api-types.ts`, `src/ipc/renderer/api.ts`, and `src/ipc/main/core-handlers.ts`.
- [x] Route bound channel methods through the service supervisor's MessagePort path with authenticated interface/caller data, ordering, backpressure, limits and lifecycle cleanup.
- [x] Dispatch bound open methods to the caller's target renderer and preserve board page reservation, settlement, reuse and cancellation behavior.
- [x] Reauthorize callers and providers for new routes while preserving legacy service connections, bus gates and error projections.
- [x] Perform the manual MCP checks below (Claude, 2026-11-07: core paths verified — see Notes).
- Adapt the supervisor's existing channel-open/MessagePort path to a bound registration. Build `{ ...argument, type: method }`, prohibit caller-supplied `type`, attach authenticated `info.interface` and `info.caller`, preserve ordered sequencing, acknowledgements and backpressure. Enforce establishment deadline including startup and close late ports; close both ends and writable waiters on caller/provider exit or revocation. Apply per-consumer/per-service/message/window limits and translate new errors. Legacy `services.connect` retains original open object, selector, allowlist, gates, codes and unknown open types; do not route legacy host calls through the new unrestricted platform path.
- Route `open` to the caller's target renderer with an authenticated, provider-bound dispatch IPC. The renderer invokes the selected platform handler or existing `boardCapabilityTransport` directly, never re-resolves. Preserve page reservation FIFO, request-bound settlement, `discardPage`, fresh-page rules and caller-window reuse. Carry deadline, chain and cancellation end-to-end; verify payload against bound filters and existing certificate/theme validators. Agent-targeted calls use its target window; reject closed/unavailable renderer and cancel on shutdown. Prevent a renderer from forging board or agent caller identity or settlement for another renderer's request.
- For new API enforce exact `uses` and current trust for board page/service, service permission for service providers, no `appScripting` gate; platform is unrestricted and agents may only invoke visible non-channel methods. Recheck at startup and in flight. Keep legacy bridge and bus gates/projections intact. Keep `HOST_SERVICE_CHANNEL_POLICIES` for old host connections; new registry routing replaces it only for new calls.
- **MCP checks:**
  1. Use `main.script.execute` to resolve and open the scratch board's channel; expect its `onChannel` to receive the router-supplied type and authenticated caller.
  2. Send and receive channel messages; expect ordered delivery, then close it and expect both ends to observe closure.
  3. Invoke the scratch board's open method with an actual target window; expect its page and returned intent result, and reuse on a second invocation where permitted.
  4. Untrust the board while a request or channel is active; expect `untrusted` and resource closure.
  5. Use `script.execute` to invoke an existing `app.capabilities.invoke` and legacy service connection; expect their prior result and error shapes.
- Run `npm run typecheck`, `npm run lint`, and `npm run build-prod`.

### 4. **Renderer index source and compatibility boundary.** Files: `src/ipc/capability-bus-channels.ts`, `src/renderer/api/capabilities.ts`, `src/renderer/editors/board/custom-editor-registry.ts`, `src/renderer/api/app.ts`, `src/ipc/api-types.ts`, `src/ipc/renderer/api.ts`, and `src/ipc/main/core-handlers.ts`.
- [x] Expose a read-only, sender-validated renderer snapshot IPC with a monotonically revisioned snapshot and revision change notifications.
- [x] Deliver the current snapshot when a renderer completes the window-ready handshake; keep the legacy synchronous `app.capabilities` index and behavior unchanged.
- [x] Perform the manual MCP checks below (Claude, 2026-11-07: core paths verified — see Notes).
- [x] Run the phase verification commands below.
- Keep the existing renderer-local legacy index and resolver for US-1794. Its synchronous `list`/`handlers`, unconstrained omitted version and legacy projection are observable; replacing it now would create timing and behavior regressions before wrappers exist. The main index is the sole authority for the new router, while this is an explicitly temporary compatibility cache. Expose the revisioned, read-only main index to renderer consumers for US-1795; do not change `app.capabilities` behavior or convert legacy calls in this phase. Ensure both readers use the same validation/normalization and trust lifecycle; compare candidates, not winner semantics, because legacy resolution differs. US-1795 owns the final wrapper/index migration and removal of duplication.
- **MCP checks:**
  1. In two windows use `script.execute` to read the main index via renderer IPC; expect matching platform and board candidates.
  2. Compare with `app.capabilities.list()` and `handlers()`; expect the legacy synchronous projections and ordering to remain unchanged.
  3. Disable or untrust a board and read the index again; expect its main registration removed and a new index revision.
  4. Close and reopen a window, then read the index; expect its current snapshot without requiring a new board registration.
- Run `npm run typecheck`, `npm run lint`, and `npm run build-prod`.

## Concerns

- Contract vs current code: omitted version means exactly v1 for new resolution, while `resolveCapability` currently accepts any version when unspecified. Preserve the legacy rule until US-1795's wrappers can preserve it explicitly; do not make existing `invoke` silently choose v1. Current normalization also drops an empty `accepts` array; new declarations must retain it while legacy normalization remains compatible. Legacy IDs and host allowlist differ from the new dot-ID and authorization rules; both need explicit paths.
- The board-facing service-host `handle` requires a `BOARD_BRIDGE_VERSION` bump from `1.49.0` to `1.50.0` in US-1794; the guide will record `minBridgeVersion: "1.50.0"` for providers using it, and US-1795 bumps the bridge again for its client API.
- Before the first preference forward from a renderer, main resolves by the default rule; this startup interval is accepted. Main keeps the last value received and does not wait for a renderer.
- For service-originated `open`, retain the inherited originating window; if absent, select the most recently focused normal (non-board-mode) window, or return `no-handler` if none exists. Agent opens always use the MCP-targeted window.

## Acceptance Criteria

- New declarations and legacy mappings, including grants and merged collisions, match the contract; invalid declarations appear in Board Info without suppressing valid siblings.
- The main index contains platform and trusted enabled board registrations, remains current through lifecycle changes, exposes filtered discovery, resolves and binds deterministically, and reads persisted preferences. `system.*` is reserved; no audio provider is implemented.
- All three routes honor authentication, provider/caller reauthorization, limits, cancellation, deadlines, lifecycle and error mapping in the contract, including channel sequencing and page intent semantics.
- Existing renderer and board legacy APIs retain their observable behavior; the temporary local compatibility index is documented and main-index IPC is available to later tasks. No US-1795/1796 client or agent surface is implemented.
- Each phase passes the three commands and the corresponding MCP manual checks. No unit tests or test harnesses are added.

## Files needing no changes

`src/main/board-root-key.ts` already supplies the identity; `src/renderer/scripting/ai-vision/namespaces/capabilities.ts` remains the existing agent discovery surface until US-1796; `src/renderer/editors/board/board-api.d.ts` and board page client shims are US-1795 scope; bundled board manifests and `doc/architecture/capability-bus.md` migration are US-1797 scope; publication of `assets/guides/agents/capabilities.md` is US-1796 scope.

## Existing-file edit sketches

These show the intended seams, not complete implementations:

```ts
// src/renderer/editors/board/board-manifest.ts — before
normalized.capabilities = normalizeCapabilities(source.capabilities, (name, reason) => {
// after: share validation between the two manifest readers
normalized.capabilities = normalizeCapabilityDeclarations(source.capabilities, (name, reason) => {
```

```ts
// src/main/board-trust-service.ts — before
await moduleServiceSupervisor.applyBoardServiceTrustSnapshot(serviceSnapshot);
// after: replace the index synchronously before asynchronous service cleanup
capabilityRegistry.applySnapshot(serviceSnapshot);
await moduleServiceSupervisor.applyBoardServiceTrustSnapshot(serviceSnapshot);
```

```js
// assets/module-service-host.mjs — before
persephone.service = {
    onRequest(handler) { /* existing registration */ },
    onChannel(handler) { /* existing registration */ },
    // onShutdown remains in place
};
// after: retain persephone.service; add independently registered call handlers
persephone.capabilities = { handle: registerCapabilityHandler };
```

```ts
// src/renderer/api/app.ts — before
api.setMainScriptsEnabled(!!services.settings.get("main.scripting.enabled"));
// after: synchronize persisted preferences at startup and on settings change
api.setMainScriptsEnabled(!!services.settings.get("main.scripting.enabled"));
api.setCapabilityPreferences(services.settings.get("capabilities.preferredProviders"));
```

## Files Changed

| Path | Change |
|---|---|
| `src/shared/capability-contract.ts`, `src/shared/capability-limits.ts`, `src/shared/platform-capabilities.ts` | New shared validation, normalized types, constants and migration mapping. |
| `src/shared/board-manifest-utils.ts`, `src/renderer/editors/board/board-manifest.ts`, `src/renderer/editors/board/custom-editor-registry.ts` | Share parsing, uses and diagnostics; preserve legacy registration. |
| `src/main/capability-registry.ts`, `src/main/capability-router.ts` | New authoritative registry, resolution, authorization and lifecycle router. |
| `src/main/board-trust-service.ts`, `src/main/module-service-supervisor.ts`, `src/main/board-bridge.ts` | Snapshot lifecycle, service dispatch, channel reuse and authorization. |
| `src/ipc/capability-bus-channels.ts`, `src/ipc/module-service-channels.ts`, `src/ipc/api-types.ts`, `src/ipc/renderer/api.ts`, `src/ipc/main/core-handlers.ts` | Typed index, preferences, router dispatch and service wire. |
| `assets/module-service-host.mjs`, `src/shared/board-bridge-version.ts` | Service handler API, cancellation and bridge version. |
| `src/renderer/api/capabilities.ts`, `src/renderer/api/capability-bus.ts`, `src/renderer/api/board-capability-transport.ts` | Preserve legacy bus and expose bound renderer dispatch. |
| `src/renderer/editors/register-editors.ts`, `src/renderer/editors/base/editorRegistry.ts` | Share platform metadata without moving renderer handlers. |
| `src/renderer/api/settings.ts`, `src/renderer/api/types/settings.d.ts`, `src/renderer/api/app.ts` | Persist and synchronize preferred providers; subscribe to index. |
| `src/shared/version-utils.ts` | Shared compatibility helper if needed; retain current eligibility semantics. |
| `assets/guides/agents/capabilities.md` | Record the provider bridge minimum; publication is US-1796. |
| `src/main/mcp/ai-vision/main-script.ts` | Add privileged access to the real internal router for manual checks. |

## Notes

### 2026-11-07 — manual verification (Claude, via Persephone MCP)
- Main index lists platform `text.open` / `content.view` (provider `persephone`) and every trusted board registration with `boardRootKey` providers and manifest names; legacy `serviceInterfaces` appear with their synthesized channel methods.
- `channel`: `text.translate` `describe` through `capabilityRouter.invoke` returned the provider's description.
- `open`: platform `text.open` opened a page in the targeted window and returned its `pageId`.
- `call` (scratch board `cap-test`, `claudetest.echo`): result with main-assigned caller; 1 s deadline → `timeout` after ~1003 ms; provider error code preserved (`permission-denied`); declared-but-unregistered and undeclared methods → `no-handler`; agent caller on an `agent: false` method → `permission-denied`.
- Legacy `app.capabilities.invoke("text.open")` and `app.capabilities.list()` unchanged.
- Not exercised by hand: preference switching between two providers, revocation in flight, service crash, channel backpressure, cycle detection.
- Platform and agent callers must supply a target window (`context.target`) for every kind, including `call`.
