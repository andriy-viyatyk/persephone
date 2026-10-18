# US-1704: Cross-board service interfaces

Epic: [EPIC-131](../../epics/EPIC-131.md) — Phase 0, P0-B. Builds on the channel contract in [US-1703](../US-1703-service-channels/README.md).

## Goal

Let a trusted consumer board declare the service interfaces it uses, discover trusted provider boards that declare matching interfaces, and open the US-1703 channel to a provider's service. Make each trust grant explicit about cross-board service access and preserve the provider's ability to identify and refuse callers.

## Background

### Verified existing patterns

- `src/shared/board-manifest-utils.ts` owns shared normalization for permission flags and service paths. `boardPermissionAllows()` is evaluated against a normalized grant; its `service` flag controls service operations. `normalizeStringList()` is forgiving, removes duplicates, and supports a maximum and validator, but does not validate structured declarations.
- `src/renderer/editors/board/board-manifest.ts` owns the `BoardManifest` and `NormalizedBoardManifest` types, declaration normalizers, `parseBoardManifest()`, and `boardTrustDisclosure()`. The parser normalizes permissions and the existing `service`, `contentProviders`, and `capabilities` fields. New `serviceInterfaces` and `uses` declarations must enter this normalized/disclosed model rather than be read ad hoc by consumers.
- `src/main/board-trust-service.ts` stores trusted-board permission grants in main, snapshots current manifest permissions separately, compares stored and current normalized permissions, and automatically applies permission reductions. `src/renderer/api/board-trust.ts` mirrors these grant and manifest permission snapshots and computes `manifestChanged`/`diffBoardPermissions()` for UI preflight. This is permission-specific today; interface-use changes need equivalent trust-change detection and must be bound into the grant snapshot rather than trusted solely because the consumer edited its manifest.
- `src/renderer/api/board-capability-transport.ts` is a renderer-side cross-board request precedent, but capabilities are a separate one-shot transport. It is not a service channel registry and must not be reused as the channel data plane.
- `src/main/board-bridge.ts` has a per-board-frame registry (`boardPorts`) with `boardId`, board root, host `WebContents`, owner id, and disposal on frame teardown. Its RPC dispatch explicitly checks `service` permission for `serviceRequest`, `serviceStatus`, and `serviceStop`, then calls `moduleServiceSupervisor`. Cross-board `connect()` must add policy checks in this trusted main-process path, not rely on the board shim or renderer list filtering.
- `src/main/board-trust-service.ts` is already the main-owned authority for trusted boards. `createSnapshots()` reads each trusted manifest (plus enabled bundled boards), automatically persists permission reductions, and passes `TrustedBoardSnapshotEntry[]` to `ModuleServiceSupervisor.applyBoardServiceTrustSnapshot()`. The supervisor's service registry is built from those entries and drops/stops services whose manifest no longer declares `service`; untrust stops services with the `untrusted` reason. Extend this provider snapshot/registry with normalized service-interface declarations and board display metadata rather than treating the renderer custom-editor registry as authority.
- `src/renderer/editors/board/request-board-trust.ts` runs a trust preflight on board open. Existing permission widening opens `showBoardPermissionChangeDialog()`; additions/level changes prompt, removals are automatically reduced. `boardTrust.trust(root, expectedPermissions)` sends the rendered permission expectation back to main, which rereads the manifest and rejects if it changed while the dialog was open. Extend this transaction with the exact normalized `uses` grant and expected manifest snapshot. `TrustBoardDialog` / `TrustBoardDialogView` currently disclose normalized permissions, service declaration, and capability ids; append the requested service-use ids to both first-trust and permission-change disclosure.
- `src/renderer/editors/board-info/BoardInfoEditorModel.ts` reads the normalized manifest, trust grant snapshot, and service status into `BoardPropsInfo`; `BoardInfoEditorView.ts` renders current/pending permissions, service declaration, content providers, and capabilities. Add provider interface declarations and consumer uses in these existing detail sections, including live provider risk labels and pending use changes.
- The current permission-list code marks `execute`, `service`, `appScripting`, full filesystem, and full network grants as **Full access** (`src/renderer/editors/board/board-permission-copy.ts`). Since every eligible provider must have `service: true` and a `uses` grant covers future trusted providers, mark every non-empty `uses` grant Full access unconditionally. A current provider list is informational and does not determine this warning.
- `src/renderer/api/board-capability-transport.ts` queues capability requests by handler-board root/page and uses the capability registration list; `src/renderer/editors/board/custom-editor-registry.ts` is a renderer registry refreshed from `boardTrust`, enabled bundled boards, and the installed-board registry. The latter also contains untrusted installed boards, and the former's one-owner `OwnershipRegistry` behavior is intentionally unsuitable for service interfaces. They are precedents only. Provider enumeration should come from an extension of main's trusted service snapshot/service supervisor registry, where trust and service permission already meet; renderer registries must not authorize access.
- `src/renderer/api/board-namespace.ts` calls `stableBoardIdentity()` (`author/name`) when available, with current fallback behavior `bundled:<folder-id>` for bundled boards and absolute root path for ordinary boards lacking either field. `resolveBoardNamespace()` is renderer code and imports renderer manifest/filesystem and bundled-registry modules, so main must not import it. For this API only, main derives `author/name` or `bundled:<id>` as before, then uses `local:<sha256(normalized-root)>` for an ordinary board lacking stable identity. Keep `resolveBoardNamespace()` and its existing fallback behavior unchanged for its current callers. Treat all caller ids as descriptive metadata, never as authentication; the main-side board root and grant remain authoritative.
- Provider availability should be resolved from the main-owned trusted snapshot on every `services.list()` call and rechecked by `connect()`. For open UI lists, invalidate/reload on the existing trust-change broadcast; trust/untrust, install registration, and uninstall are in-memory events in the renderer registries, while `boardInstallRegistry` contains untrusted installs too. Installing an untrusted board must not expose it. A trusted board removal/untrust must immediately invalidate lists and close its channels. If an installation later becomes trusted, the trust event adds it. Avoid using the installed-board catalog as a provider authority.

### Design contract from US-1703 and EPIC-131

The public page channel object remains exactly the US-1703 object: `send`, `onMessage`, `onClose`, `close`, `writable`, and `whenWritable()`, with US-1703's wire protocol, bounded queues, limits, and close reasons. Cross-board service calls reuse the provider's existing `persephone.service.onChannel(handler)` registration. The provider-side `info` remains extensible and adds `info.interface = { id, version }` and `info.caller = { id, name }`. Caller `id` is `author/name` when available, `bundled:<id>` for bundled boards, and `local:<sha256(normalized-root)>` for ordinary boards without stable identity; the display name comes from the caller's manifest/folder. The hash fallback is specific to this API so a local filesystem path is never disclosed; `resolveBoardNamespace()` keeps its existing behavior. Provider refusal uses a normal channel close reason, recommended code `connection-refused`.

Provider manifests declare `serviceInterfaces: [{ id, version, title? }]`. Consumer manifests declare `uses: [{ id, version }]`. Consumer API:

```js
const providers = await persephone.services.list("agent.session");
// [{ provider, title, version, boardName }]
const channel = await persephone.services.connect("agent.session", {
    provider: providers[0].provider,
    version: 1,
});
```

Provider service callback:

```js
persephone.service.onChannel((channel, openMessage, info) => {
    // info.interface: { id: "agent.session", version: 1 }
    // info.caller: { id: "author/team-chat", name: "Team Chat" }
    // channel.close({ code: "connection-refused", message: "..." });
});
```

### Trust model recommendations

- The consumer's trusted `uses` declaration is the grant to connect to the named interface/version. Do not additionally require the consumer's `service` or `execute` permission: `service` gates the consumer's own module service operations (`serviceRequest`, `serviceStatus`, `serviceStop`), while `execute` governs its own command runner. A consumer may be a page-only board with no service. The `uses` grant is more specific than a general command-running permission; the provider must separately be trusted and have `service` permission. Providers treat every open message as untrusted input and enforce their own approval policy.
- Show `Use services from other boards: <interface ids>` in Trust and Board Info. A `uses` change is a grant change and must trigger the same re-trust flow as a changed permission manifest; a newly added interface is not silently enabled by a previously trusted grant.
- Every non-empty `uses` grant is **Full access**, regardless of whether a matching provider is currently trusted: any provider eligible to connect must hold the `service` permission, which the existing permission list classifies as Full access, and `uses` is a standing grant that includes future providers. Do not query the current provider list to decide whether to show the badge. Explain that the consumer gets messaging access only and does not inherit provider permissions; providers must treat messages as untrusted and enforce their own approval policy. Board Info may separately list currently trusted providers as informational data.
- Untrusting a provider must close channels targeting that provider with US-1703 close code `untrusted`; untrusting or closing the consumer closes its owned channels. Recheck both parties' grants and declarations at connect time. Provider listing is informational and cannot itself authorize a later connection.
- Recommend `agent.session` as a reserved platform interface id, while allowing third-party interfaces under a validated `author/name` namespace. This keeps EPIC-131's required id usable and avoids collisions with author-owned ids. Interface IDs are many-to-many: do not use the single-owner registration rule used by content provider types.
- Recommend a single positive integer version with exact match for v1. It keeps normalization and selection deterministic; do not introduce ranges or version lists until a real compatibility case requires them. A consumer may select among many providers declaring the same exact version.

## Implementation Plan

- [x] **Normalize declarations and interface ids.** In `src/shared/board-manifest-utils.ts`, add shared types and normalizers for `serviceInterfaces` and `uses`, using the current forgiving manifest-normalization style. Define one `PLATFORM_SERVICE_INTERFACE_IDS` constant initially containing only `agent.session`; reject every other unqualified id with a manifest issue. Require third-party ids to use exactly `author/name` with two non-empty, whitespace-free segments. Recommend a maximum of 32 declarations of each kind, interface ids at most 160 characters, and optional titles at most 120 characters. Require positive safe-integer versions. Normalize duplicate `(id, version)` pairs first-wins. Keep interface declarations many-to-many: do not register them through `OwnershipRegistry` or reject a second provider. In `src/renderer/editors/board/board-manifest.ts`, add the raw and normalized declaration interfaces, parse both fields, and include provider interfaces and consumer uses in `boardTrustDisclosure()`. Use the existing manifest `issues` mechanism for malformed service declarations so invalid entries are visible in Board Info and cannot become grants/providers.
- [x] **Persist and preflight consumer `uses` grants with trust.** In `src/main/board-trust-service.ts`, extend the trusted grant record and authoritative snapshot with normalized granted uses/current manifest uses. On first trust, store the exact `uses` set presented in the dialog. On an existing trusted board, additions or version changes require the existing permission-change dialog; removals reduce the stored grant automatically, matching the verified `permissionReduction()` behavior. Compare set contents deterministically. Extend `setTrust()`'s expected-manifest check so main rereads and compares both permissions and uses before accepting a dialog decision. Expose effective granted uses to main connection authorization; never enforce from the consumer's current raw manifest alone. In `src/renderer/api/board-trust.ts`, extend `BoardPermissionSnapshot`, diff helpers, and `trust()` IPC arguments to carry these values. In `src/ipc/api-types.ts` and `src/ipc/renderer/api.ts`, extend the typed `setBoardTrust` signature and permission-grant snapshot payload. Preserve backward compatibility for existing `trustedBoards.json` records by treating a missing stored uses list as empty.
- [x] **Show interface use in Trust and Board Info.** Extend `src/renderer/editors/board/request-board-trust.ts`, `src/renderer/ui/dialogs/TrustBoardDialog.ts`, and `src/renderer/ui/dialogs/TrustBoardDialogView.ts` so first trust and changed-manifest review show `Use services from other boards: <ids>` separately from existing permission flags. Every non-empty `uses` declaration gets a **Full access** badge unconditionally; do not join against currently trusted providers to decide whether to show it. Add a localized detail explaining this is a standing messaging grant for currently or later trusted providers, that each provider independently has its own Full-access `service` grant, and that the consumer does not inherit those permissions. In `src/renderer/editors/board-info/BoardInfoEditorModel.ts` and `src/renderer/editors/board-info/BoardInfoEditorView.ts`, show provider declarations (`id`, exact version, optional translated title), the consumer's requested/granted uses, pending additions/removals, and a separate current-provider list for information; provider presence must not gate the Full-access badge. Add a metadata title key to `src/renderer/editors/board/board-display-text.ts` following `capabilityTitle(id)` for translated interface titles.
- [x] **Build provider discovery from the main trusted-service registry.** Extend `TrustedBoardSnapshotEntry` / `BoardServiceTrustSnapshot` in `src/ipc/module-service-channels.ts` with normalized `serviceInterfaces`, the board display name, and the main-derived caller id (`author/name`, `bundled:<id>`, or the privacy-preserving local hash fallback). Populate those fields in `BoardTrustService.createSnapshots()` in `src/main/board-trust-service.ts`, which already reads trusted manifests plus enabled bundled sources and has the effective trusted permissions. Extend `ModuleServiceSupervisor.applyBoardServiceTrustSnapshot()` in `src/main/module-service-supervisor.ts` to maintain an interface-to-many-providers index alongside service records. Include only trusted entries that declare a service and whose effective grant allows `service`. Have `services.list()` return `{ provider, title, version, boardName }`; `title` falls back to `boardName`. Define `provider` as an opaque provider key, not a filesystem path; keep the canonical root only inside main for authorization and preserve the key across snapshot refreshes while the provider remains installed/trusted. Do not impose one-owner registration. The provider result list is informational and can show current providers in Board Info; it does not affect the unconditional Full-access badge for `uses`.
- [x] **Expose page-only methods over the existing board bridge.** In `src/ipc/board-bridge-channels.ts`, add typed `servicesList` and `servicesConnect` RPC shapes (including the interface id and `{ provider, version }` selector), plus any port-delivery envelope that the US-1703 transfer path requires. In `src/main/board-bridge.ts`, route them through `BoardPortEntry.root`, `boardId`, and `hostWebContents`; check that the consumer is trusted and has the exact effective `uses` grant before both calls, returning `permission-denied` when it does not. Do not include these RPCs in the existing caller-`service` permission gate for `serviceRequest`, `serviceStatus`, and `serviceStop`; a page-only consumer needs no service of its own. `connect()` independently rechecks provider trust, the provider's `service` permission, declaration, version, and provider key. It lazily starts the provider service with US-1703 request mode; its provider page need not be open. Preserve US-1703 open-failure codes and code/message mapping, including `service-not-declared`, `permission-denied`, `untrusted`, `service-failed`, `service-busy`, `trust-not-ready`, and `service-exited` as applicable. Use its channel-delivery path to transfer the page endpoint to the consumer frame and send the other endpoint directly to the provider utility process; do not JSON-serialize or relay channel traffic through the normal RPC result. Only board pages call these APIs in P0-B; service-to-service connections are a future extension.
- [x] **Add cross-board open metadata and lifecycle closure to the US-1703 channel path.** Extend the existing channel open request in `src/main/module-service-supervisor.ts` and `src/main/module-service-record.ts` to target a provider root while retaining US-1703's channel object, wire protocol, queue limits, flow control, and close reasons. The provider service receives `info.interface = { id, version }` and `info.caller = { id, name }`; derive ids in main as `author/name`, `bundled:<id>`, or `local:<sha256(normalized-root)>` and use caller manifest/folder display name. Keep `resolveBoardNamespace()` unchanged for its existing uses. Caller identity is metadata, not authentication: main remains authoritative for actual caller root and granted uses. In `assets/module-service-host.mjs`, route this metadata to the existing single `persephone.service.onChannel(handler)` registration rather than adding a second cross-board handler. Provider refusal closes the same channel with code `connection-refused` and a readable message. `ModuleServiceSupervisor.applyBoardServiceTrustSnapshot()` must close provider channels on trust loss with `untrusted`, close them when the provider loses its `service` grant with `permission-denied`, and stop any now-unauthorized live provider service. It must also close consumer channels on consumer trust loss with `untrusted`, or when the granted `(id, version)` is removed with `permission-denied`. `disposeBoardPort()` closes consumer-owned channels with US-1703's page/frame lifecycle reason.
- [x] **Keep discovery fresh while pages remain open.** Rebuild the main provider index from each authoritative trust snapshot and refresh manifest declarations when listing or connecting. Ensure `BoardTrustService.getPermissionGrants()`/snapshot refresh updates the supervisor's provider index for interface declaration changes even when permission flags did not change; current `getPermissionGrants()` rereads manifests but only reapplies the service snapshot for permission reductions. Do not treat installed-board catalog entries or the renderer custom-editor registry as authorization. `services.list()` must return a fresh list on each call. Invalidate any list UI/cache when the existing `eBoardTrustChanged` broadcast updates the trust snapshot. An installed-but-untrusted board never appears; when it is trusted it enters through the trust snapshot, and untrust/removal removes it and closes its channels. Main must re-read a selected provider's manifest and grant at connect time so a stale list cannot authorize a removed or changed provider. The renderer capability and custom-editor registries are not the provider registry: the first is for page capability request routing, the second includes untrusted installed boards and contains one-owner content-provider registration semantics.
- [x] **Keep the P0-B caller surface page-only.** Only a consumer board page can call `persephone.services.list/connect`; a board module service cannot connect to another service in this phase. A future task may add service-to-service channels if needed; the EPIC-131 team chat orchestrates from its page. If the selected provider is the consumer's own board and the declaration/grant match, permit the connection, but document `persephone.service.openChannel()` as the preferred same-board API.
- [x] **Type and document the single 1.42.0 bridge release.** Extend the board-facing declarations in `src/renderer/editors/board/board-api.d.ts` with `persephone.services.list/connect`, provider result and selector types, manifest declarations, and the US-1703 service `info.interface`/`info.caller` fields plus `connection-refused`. Append API, trust disclosure, exact-version behavior, provider choice, and lifecycle guidance to `assets/guides/boards.md`, `assets/guides/agents/boards.md`, and `assets/board-template/CLAUDE.md`. Add trust-dialog message keys in `src/shared/i18n/en/board.ts` / `src/shared/i18n/en/dialogs.ts` as appropriate and follow `doc/standards/localization.md` (flat `<area>.<entryName>` keys and placeholder notes). Append service interfaces to the existing 1.42.0 guide/version entries, architecture descriptions in `doc/architecture/overview.md`, `doc/architecture/scripting.md`, and `doc/architecture/key-files.md`, and the existing Version 5.0.13 upcoming notes in `assets/guides/whats-new.md`. US-1710 owns the sole version bump and the shared 1.42.0 history entry; do not edit `BOARD_BRIDGE_VERSION` or repeat that bump. Do not add or run tests or a harness for this task.

### Before → after API shape

The current manifest model has no cross-board service declarations:

```json
{ "service": "scripts/service.mjs" }
```

The target declarations are:

```json
// Provider
{ "service": "scripts/service.mjs", "serviceInterfaces": [{ "id": "agent.session", "version": 1, "title": "Claude Agent" }] }
// Consumer
{ "uses": [{ "id": "agent.session", "version": 1 }] }
```

Current board shim in `src/board-shim.ts` exposes only same-board request/status/stop:

```js
persephone.service.request(message);
persephone.service.status();
persephone.service.stop();
```

After this task, the consumer declares its interface use and connects to a selected provider; the returned value is the US-1703 channel object without API changes:

```js
const providers = await persephone.services.list("agent.session");
const channel = await persephone.services.connect("agent.session", {
    provider: providers[0].provider,
    version: 1,
});
channel.onMessage((message) => render(message));
channel.send({ op: "user-message", text: "..." });
```

The provider's existing handler receives only additive metadata:

```js
persephone.service.onChannel((channel, openMessage, info) => {
    // info.interface = { id: "agent.session", version: 1 }
    // info.caller = { id: "author/team-chat", name: "Team Chat" }
});
```

## Concerns

| Question | Recommendation | Verified reason |
|---|---|---|
| Is `uses` the grant or does consumer also need its own `service`/`execute`? | `uses` is the grant for messaging with the exact named interface/version. Do not require consumer `service` or `execute`; check only the consumer's trusted `uses` grant and the provider's independent trust/`service` grant. | `board-bridge.ts` applies the caller-`service` gate only to `serviceRequest`, `serviceStatus`, and `serviceStop`. A page-only consumer has no service of its own; `execute` controls its own command runner. |
| When should `uses` be marked Full access? | Every non-empty `uses` declaration is Full access unconditionally. Do not join against providers currently trusted or installed. | Every eligible provider must have `service`, which current permission copy classifies as Full access; the standing grant covers providers trusted later, so an empty current provider set must not suppress the warning. |
| Does a `uses` grant cover providers trusted in the future? | Yes: it is an interface-scoped standing grant. A newly trusted provider can be listed and selected without re-trusting the consumer; the provider still must be independently trusted and service-permitted, and `connect()` rechecks both boards. Say this plainly in the Trust dialog. | The requested manifest shape names `{ id, version }`, not provider roots, and the API explicitly supports many providers for an interface. Pinning providers would add a second manifest grant model. |
| How does a `uses` manifest change affect trust? | Added or changed `(id, version)` requires permission-change review; removed uses auto-reduce the grant. Bind the exact expected uses set to the dialog's trust IPC mutation and main's manifest reread. | Current `requestBoardTrust()` prompts on permission additions/level changes, automatically accepts reductions, and passes expected permissions to main, which rejects stale dialogs. |
| What happens when a provider or consumer is untrusted/closed? | Provider trust/service loss closes its cross-board channels with `untrusted`; consumer frame disposal or trust loss closes channels owned by that consumer using the matching US-1703 lifecycle reason. | Main trust service applies authoritative snapshots; `ModuleServiceSupervisor` stops untrusted providers; `disposeBoardPort()` is the exact board-frame teardown hook. |
| Which interface ID namespaces are allowed? | Reserve unqualified platform IDs such as `agent.session`; require third-party IDs as `author/name`. Permit many owners for every ID. | EPIC-131 explicitly requires `agent.session`; existing content provider registration requires slash namespaces and uses first-owner registration, which is unsuitable here. |
| How are reserved platform IDs defined? | Keep one `PLATFORM_SERVICE_INTERFACE_IDS` constant, initially `{"agent.session"}`; reject any other unqualified id with a manifest issue. | This provides an explicit reservation point without inventing additional platform interfaces in P0-B. |
| How is version compatibility decided? | Positive integer, exact match. | The Phase 0 interface contract needs deterministic negotiation; no current cross-board service version range precedent exists, and a list/range would add selection rules without a known need. |
| Where are providers enumerated? | Main's trusted service snapshot/service supervisor provider index. | Main already owns authoritative trusted roots, effective permissions, service declarations, and service records. Renderer registries include untrusted installed boards or have one-owner registration semantics. |
| How do provider lists avoid going stale? | Each `list()` re-reads/refreshes trusted provider metadata; trust broadcasts invalidate open UI caches; every `connect()` rechecks current provider and grant. | `eBoardTrustChanged` updates renderer trust state; install registry alone includes boards that are not trusted and therefore cannot authorize discovery. Installing without trusting must not expose a provider. |
| What is the `provider` selector and caller identity? | Return an opaque provider key, not a root path. Derive `info.caller.id` in main as `author/name`, `bundled:<id>`, or `local:<sha256(normalized-root)>`; use the caller's display name. Keep `resolveBoardNamespace()` unchanged. Treat identity as descriptive, never authorization. | `resolveBoardNamespace()` is renderer-only and cannot be imported into main; its ordinary-board fallback is an absolute path and would disclose it to a third-party provider. Namespace collision confirmation is advisory, so root/grant checks remain the authority. |
| Can a board service connect to a different board's service in P0-B? | No. Limit this API to board pages; record service-to-service connections as a possible future extension. Allow a page to select its own board as provider if declared, but prefer `persephone.service.openChannel()` for same-board communication. | The requested API is a consumer page API, and Phase 2 team chat orchestrates from its page. This keeps service-to-service caller identity and lifecycle out of P0-B. |

## Acceptance Criteria

- A trusted consumer declaring a matching `uses` entry can list and connect to trusted providers that declare the same interface/version and have `service` permission.
- A consumer without an authorized `uses` declaration receives `permission-denied`; provider trust/service permission are checked independently at connection time. The consumer does not need its own `service` or `execute` permission; `servicesList`/`servicesConnect` are not added to the caller-`service` gate used by `serviceRequest`, `serviceStatus`, and `serviceStop`.
- `connect()` lazily starts the provider service with US-1703 request mode, works when the provider's page is closed, and preserves US-1703 open-failure codes.
- Only board pages can list/connect in P0-B. A board page may select its own board when declared, though `persephone.service.openChannel()` is the preferred same-board path. Service-to-service connections are a possible future extension.
- The same US-1703 channel object, wire protocol, limits, and close reasons are used. Provider `onChannel` receives the open message plus `info.interface` and stable `info.caller` identity; provider refusal closes with a documented code.
- `info.caller.id` never contains an ordinary local board's absolute path: it uses `author/name`, `bundled:<id>`, or `local:<sha256(normalized-root)>`. Existing `resolveBoardNamespace()` behavior for its other callers remains unchanged.
- `agent.session` is the only initially reserved unqualified interface id, listed in `PLATFORM_SERVICE_INTERFACE_IDS`; other unqualified ids generate a manifest issue.
- Trust and Board Info disclose the consumer's requested interface uses. Changing `uses` follows trust re-review; untrust/lifecycle changes close affected channels.
- Every non-empty trusted `uses` grant is marked **Full access**, including when no matching provider is currently installed or trusted, because the grant covers future eligible providers.
- Provider discovery supports multiple providers and does not imply authorization. Every `list()` call reflects current trusted declarations; trust-change notifications invalidate cached lists without requiring a board reload, and every `connect()` rechecks current state.
- The Phase 0 bridge release remains 1.42.0, owned by US-1710; US-1704 adds no second version bump.
- User guides, localization strings, bridge typings, developer docs, and Version 5.0.13 What's New entries are appended in their shared 1.42.0 sections.

## Files that do not need changes

| Path | Reason |
|---|---|
| `doc/active-work.md` | The user explicitly asked not to edit the dashboard. |
| `doc/epics/EPIC-131.md` | The user explicitly asked not to edit the epic. |
| `doc/tasks/US-1703-service-channels/README.md` | US-1704 consumes its reviewed contract; do not redesign or rewrite it. |
| `src/renderer/api/board-namespace.ts` | Its path fallback remains unchanged for existing namespace consumers; only `info.caller.id` gets the privacy-preserving local hash fallback. |
| `src/shared/board-bridge-version.ts` | US-1710 owns the one Phase 0 bump to 1.42.0. |
| `src/main/mcp-http-server.ts` and `src/main/mcp/private-session-endpoints.ts` | US-1709 owns private MCP endpoints; P0-B only adds caller/interface metadata to the shared service channel. |
| `qa/**` | No unit tests or harnesses are requested for this task. |

This document does not modify any source files. The implementation file list below is the planned scope for the future implementation task only.

## Files Changed Summary

| File | Planned change |
|---|---|
| `src/shared/board-manifest-utils.ts` | Shared interface/use declaration types, validation/normalization, and the reserved platform interface id constant. |
| `src/renderer/editors/board/board-manifest.ts` | Manifest fields, normalized model, parser, trust disclosure and validation issues. |
| `src/main/board-trust-service.ts` | Persist effective consumer uses, prompt/reduction handling, expected manifest checks, provider snapshot data. |
| `src/renderer/api/board-trust.ts` | Grant snapshot and uses diff, trust mutation shape. |
| `src/ipc/api-types.ts` | Trust mutation and permission-grant IPC types. |
| `src/ipc/renderer/api.ts` | Typed IPC wrappers for updated trust/grant contracts and provider list invalidation/query if needed. |
| `src/renderer/editors/board/request-board-trust.ts` | Preflight/review current and granted uses and provider risk. |
| `src/renderer/ui/dialogs/TrustBoardDialog.ts` | Trust disclosure payload includes uses and risk. |
| `src/renderer/ui/dialogs/TrustBoardDialogView.ts` | Render uses, change diff, and Full access note. |
| `src/renderer/editors/board/BoardEditorModel.ts` | Revalidate manifest uses at open and trigger use-change trust prompt. |
| `src/renderer/editors/board-info/BoardInfoEditorModel.ts` | Board Info provider/consumer interface model and informational current-provider list. |
| `src/renderer/editors/board-info/BoardInfoEditorView.ts` | Show service interfaces, uses, and trust change state. |
| `src/renderer/editors/board/board-display-text.ts` | Metadata key for translated service-interface titles. |
| `src/ipc/module-service-channels.ts` | Trusted service snapshot carries provider declarations and caller display metadata. |
| `src/main/module-service-supervisor.ts` | Many-provider interface index, fresh listing and cross-board authorization/open route, teardown. |
| `src/main/module-service-record.ts` | Associate cross-board channels with provider and consumer ownership. |
| `assets/module-service-host.mjs` | Pass additive `info.interface` and `info.caller` to the existing `onChannel` handler. |
| `src/ipc/board-bridge-channels.ts` | Board RPC messages for services list/connect and transferred endpoint routing. |
| `src/main/board-bridge.ts` | Enforce consumer uses/provider trust/service and route connect through the channel supervisor. |
| `src/board-shim.ts` | Add page API `persephone.services.list/connect`, retaining US-1703 channel object. |
| `src/renderer/editors/board/BoardWebview.ts` | Route endpoint to exact consumer frame and invalidate service list views on trust changes if cached. |
| `src/renderer/editors/board/board-api.d.ts` | Type declarations for manifest, services API, provider results, and channel info extension. |
| `src/shared/i18n/en/board.ts` | English UI strings for interface declarations, uses, risk, and pending changes. |
| `src/shared/i18n/en/dialogs.ts` | Trust dialog strings where the message belongs to dialog copy. |
| `assets/guides/boards.md` | Append cross-board service API/trust/version contract to existing 1.42.0 entry. |
| `assets/guides/agents/boards.md` | Agent author guidance for declaring and consuming services. |
| `assets/board-template/CLAUDE.md` | Template guidance for service interface declarations and safe provider use. |
| `assets/guides/whats-new.md` | Append to existing Version 5.0.13 upcoming section. |
| `doc/architecture/overview.md` | Main-owned provider discovery and cross-board channel architecture. |
| `doc/architecture/scripting.md` | Board API and caller/provider service contracts. |
| `doc/architecture/key-files.md` | Update bridge/trust/service registry ownership index. |
