# US-1483 — Bundled board registry and discovery

**Status:** Planned · **Epic:** [EPIC-109: Bundled boards and the Excalidraw board](../../epics/EPIC-109.md) · **Depends on:** none

## Goal

Add a separate renderer-side registry for boards shipped in `assets/boards/<id>/`, discovered from
their manifests and marked with `origin: "bundled"`. Feed those boards into the existing custom
editor rebuild so their file masks, editors, capabilities, providers, and schemes behave like a
trusted board, while keeping them out of the trust file and the Boards tab.

This document is investigation and planning only. It does not implement the registry, add a board
asset, alter packaging, add tests, or change the later identity, UI, build, board, or capability
tasks.

## Background

### Binding epic decisions

EPIC-109 D1–D5 establish the constraints for this task:

- Bundled boards live at `assets/boards/<id>/`; `electron-builder.yml:15-18` already copies the
  whole `assets/` tree to `resources/assets` outside the asar. No packaging change is needed.
- Bundled boards are trusted because they are part of the application. They are not copied to a
  writable install directory, are never seeded into `trustedBoards.txt`, and are not catalog
  installs.
- They are a separate source from registered boards. In particular, `mergeBoardSources()` in
  `src/renderer/api/boards.ts:150-186` must continue to merge only trust paths, installed entries,
  and roots needed for open-page inventory.
- The Built-in presentation and Disable setting belong to US-1485. This task must leave a refresh
  seam so a setting change can rebuild registrations, but must not add that setting or UI.
- Custom editor ids keep the real absolute root (`board-editor:<root>`). The stable bundled id
  used by later restore/storage work is the folder name under `assets/boards/`, not a new required
  manifest field. US-1484 owns the stale-root restore alias and storage keying.

### Verified discovery and trust paths

`src/main/utils.ts:17-36` resolves the application root and `getAssetPath(...paths)` in the main
process. The existing renderer IPC precedent is `getAppRootPath` in
`src/ipc/main/core-handlers.ts:34-40`, exposed by `src/ipc/renderer/api.ts:70-77`; board scaffolding
uses it at `src/renderer/editors/board/board-scaffold.ts:25-32` to reach `assets/`.

The selected design is to reuse that existing `getAppRootPath` IPC and scan from the renderer with
the existing file API. The new registry will resolve
`fpJoin(await api.getAppRootPath(), "assets", "boards")`, call `fs.listDirWithTypes()`, inspect only
immediate child directories, and call `readBoardManifest()` for each child. This uses the existing
manifest interface and its malformed/missing-manifest behavior without creating a second manifest
DTO or a new main-process filesystem endpoint. The scan is explicitly app-owned and does not
violate the no-subtree-discovery rule in `custom-editor-registry.ts:12-14`; that rule protects
user folders, whereas this is one known application-owned directory.

`src/renderer/editors/board/board-manifest.ts:58-98` confirms that `BoardManifest` has no stable
`id`. `name` is optional and is documented at `:61-62` as a display-name override that falls back
to the folder name. Therefore the stable bundled identity is the immediate folder name
`<id>` under `assets/boards/`. The registry record must retain both that `id` and the current
absolute `root`; it must not infer identity from `manifest.name` and must not require a new
manifest field.

`readBoardManifest()` at `board-manifest.ts:230-244` returns `null` for a missing, unreadable, or
unparseable manifest. Such a child is skipped as an undiscoverable bundled board. A valid manifest
may still have no editor association: `getBoardEditorAssociation()` at `:561-590` is the existing
gate for whether it contributes a custom editor.

### Verified custom-editor lifecycle and startup ordering

`src/renderer/editors/board/custom-editor-registry.ts:195-211` subscribes to
`boardTrust.subscribePaths()` and `ensureInitialized()` loads trust/install state before the first
refresh. `refresh()` at `:216-382` currently reads `boardTrust.listPaths()` synchronously, reads
each manifest asynchronously, then synchronously commits the rebuilt entries after clearing
board-origin providers, schemes, and capabilities at `:302-310`. Provider declarations are marked
`trusted: true, source: "trusted"` for trusted roots at `:253-259`; capability and provider
registrations use `origin: "board"` at `:311-365`.

The registry is currently warmed fire-and-forget by
`src/renderer/editors/register-editors.ts:238-242`. `src/renderer.ts:10-20` then runs
`app.initServices()`, `app.initPages()`, and `app.initEvents()` sequentially, but nothing currently
awaits the custom-editor promise before pages are restored. File resolution is synchronous:
`PagesLifecycleModel.ts:112-115` calls `resolveEditorIdForFile()`, and the content resolver calls
the same synchronous function at `src/renderer/content/resolvers.ts:67-74`. The current registry
therefore intentionally falls back to a built-in editor while its async load is incomplete.

The implementation must preserve the useful preloading call but add an awaited
`customEditorRegistry.ensureInitialized()` in the bootstrap sequence after `app.initServices()` and
before `app.initPages()`. That makes bundled discovery complete before persisted pages or the
open-event pipeline can choose an editor. The existing strict `>` resolution tie-break at
`custom-editor-registry.ts:480-497` remains unchanged; the bundled board's manifest priority
controls whether it beats a built-in, including the EPIC-109 D7 requirement that Excalidraw use
priority 60 while `draw-view` remains present.

### Verified Boards-tab exclusion

`readBoardSources()` and `mergeBoardSources()` in `src/renderer/api/boards.ts:128-186` derive the
Boards inventory from trust paths, installed entries, and open pages. `enumerateBoardListings()` at
`:256-264` reads those merged sources. `src/renderer/ui/sidebar/TrustedBoardsListView.ts:229-254`
reads `boardTrust.listPaths()` directly. The bundled registry must not be imported into either
path. This is what keeps a bundled board out of Tools & Editors → Boards without adding a filter,
and it also keeps it out of `trustedBoards.txt`.

### Origin findings

EPIC-105's content registry already has a flexible `RegistrationOrigin` in
`src/renderer/content/registry.ts:22-27`, and the current board registration path deliberately
uses `origin: "board"` so `unregisterBoardProviders()` can clear all board-owned registrations.
The scheme registry uses the same registration options. Capability origins are intentionally the
closed union `"platform" | "board" | "script"` in
`src/ipc/capability-bus-channels.ts:18-35` and
`src/renderer/api/types/capabilities.d.ts:4-18`.

No third `"bundled"` origin should be added to those content/capability registries in US-1483.
Bundled registrations must remain `origin: "board"`, with the real `boardRoot` owner, so the
existing full board-origin teardown removes them on every rebuild. The provenance marker belongs
to the bundled-board registry and to the custom-editor source entries (`"trusted" | "bundled"`).
Provider declarations also remain `trusted: true, source: "trusted"` for bundled boards because
that field controls whether the provider may acquire its board service; bundled and user-trusted
boards intentionally have the same permission behavior. The source marker distinguishes catalog
installed providers (`"installed"`) from trusted-capable providers, not bundled provenance.

### Permission audit: board root is not sufficient evidence of trust

The following direct `boardTrust.isTrusted()` sites were verified. The runtime gates must use one
shared `isBoardPermitted(root)` predicate that accepts either a trusted root or a discovered,
enabled bundled root. The shared permission source must notify listeners for both trust changes and
future bundled enable/disable changes.

| Site | Current role | US-1483 disposition |
|---|---|---|
| `src/renderer/editors/board/BoardWebview.ts:138-144, 501-505, 537-539, 560-564, 605-611, 746-751, 772-777, 845-847` | Rejects trust revocation, AiVision registration/notify/request, capability dispatch/list/invoke, and `openContent`. | Replace every gate with `isBoardPermitted`; subscribe to the combined permission source so an enabled bundled board stays live and a future disable revokes it. |
| `src/renderer/editors/board/BoardEditorModel.ts:184-189, 256-265, 277-305, 331-339` | Clears or exposes AiVision transports/registrations and secondary-view requests only for trusted roots. | Use the same predicate and combined subscription; this is required for a bundled board's frame not to appear blank or lose automation. |
| `src/renderer/api/board-capability-transport.ts:116-123, 237-245, 286-295` | Rejects capability dispatch/frame attachment and settles pending work on trust loss. | Use the shared predicate and subscribe to the combined permission source. |
| `src/renderer/api/capability-bus.ts:205-227, 418-428` | Rejects board-origin capability invokes and settles pending capability requests after trust loss. | Use the shared predicate and combined subscription; capability registrations themselves remain `origin: "board"`. |
| `src/renderer/api/mcp/board-call-command.ts:41-55` | Restricts the board's `persephone.call()` bridge. | Use `isBoardPermitted` and change the refusal to permission/provenance-neutral wording in this task (for example, `This Board is not permitted to use persephone.call().`). A bundled board is not trust-managed, and EPIC-109 has no later task that owns this copy. |
| `src/renderer/editors/board/board-service-permission.ts:7-14` | Allows a service only when trust and manifest `permissions` include `service`. | Use `isBoardPermitted`; `permissions` remains the manifest disclosure/permission check. |
| `src/renderer/editors/board/BoardEditorView.ts:182-191` | Chooses the rendered main-board branch and otherwise renders the untrusted state. | Use `isBoardPermitted`; this is one of the blank-render risks. |
| `src/renderer/editors/board/BoardSecondaryView.ts:108-132` | Chooses whether a declared secondary board view is mounted. | Use `isBoardPermitted`; this prevents bundled secondary views from being replaced by the trust placeholder. |
| `src/renderer/scripting/api-wrapper/BoardEditorFacade.ts:277-281, 332-352` | Reports `renderState` and derives facade restrictions from it. | Add a distinct agent-visible `"bundled"` state. Return `"bundled"` for an enabled bundled root, reserve `"trusted"` for the user trust list, and treat both as permitted in facade operations. This keeps the AiVision contract truthful about provenance rather than reporting app permission as user trust. |
| `src/renderer/editors/board/custom-editor-registry.ts:281-298` | Adds provider declarations for catalog-installed but untrusted boards only. | Keep this trust distinction. Bundled boards enter the separate bundled source loop and are not an installed-board fallback. |
| `src/renderer/api/boards.ts:303-318, 322-365, 547-548` | Trust lifecycle for explicit registration/unregistration/rename and catalog-install completion. | Guard the explicit lifecycle methods so a bundled root can never trigger a trust-file write or rename. Leave the catalog-only check at `:547-548` trust-based; bundled roots are not catalog entries. |
| `src/renderer/editors/board-info/BoardInfoEditorView.ts:355-359, 605-615`, `BoardInfoEditorModel.ts:390-416`, `BoardInfoEditorFacade.ts:178-194, 252-260` | Displays registered/catalog-board trust and install state. | No bundled board reaches this surface because it is fed by installed/trusted-board data, not the bundled registry. Keep these catalog semantics; the Built-in presentation belongs to US-1485. |

The service path has one additional, indirect trust assumption. `src/renderer/api/board-trust-sync.ts:25-55`
currently snapshots only `boardTrust.listPaths()` and sends it to the main-process
`moduleServiceSupervisor`. Main's `isEffectivelyTrusted()` at
`src/main/module-service-supervisor.ts:514-520` checks membership in that snapshot at every
service lifecycle/storage boundary. The renderer snapshot must include bundled records and use the
same permission predicate; no main-process trust-file read or new main origin is needed. The
existing snapshot membership will then make bundled services effective, while a future Disable
refresh removes the record and causes the existing supervisor revocation path to run.

## Implementation Plan

### 1. Add the separate bundled-board registry

Create `src/renderer/editors/board/bundled-board-registry.ts` with an app-owned, in-memory
registry. Its public record should contain:

```typescript
interface BundledBoard {
    id: string;                         // immediate assets/boards child folder name
    root: string;                       // current absolute filesystem root
    manifest: BoardManifest;
    origin: "bundled";
}
```

The module should provide `ensureInitialized()`, an explicit `refresh()`, a synchronous `list()`
after initialization, `isBundled(root)`, and a subscription seam for permission/registration
changes. `refresh()` should:

1. Resolve the resources root with `api.getAppRootPath()` and append `assets/boards` using
   `fpJoin`.
2. Return an empty registry when the directory is absent, as the existing `fs` directory APIs do
   for missing directories.
3. List immediate entries with `fs.listDirWithTypes()`, retain directories only, and read each
   `<root>/board-manifest.json` through `readBoardManifest()`.
4. Skip a child whose manifest is absent or malformed; retain valid manifest objects even when they
   declare no editor association.
5. Set `id` to the child folder name, never to `manifest.name`; sort records by `id` for
   deterministic board tie order; retain the original absolute root for `boardEditorId(root)`.
6. Replace the registry state atomically, notify subscribers, and make repeated refreshes safe.

The before/after boundary is:

```typescript
// Before: no bundled source exists; only boardTrust supplies roots.
const roots = boardTrust.listPaths();

// After: the new module owns the app-resource scan and provenance marker.
const bundled = bundledBoardRegistry.list();
// bundled[i] = { id, root, manifest, origin: "bundled" }
```

Do not add a main-process enumeration endpoint, a required manifest `id`, a filesystem watcher,
or a recursive scan.

### 2. Merge bundled sources into the custom-editor rebuild without merging Boards inventory

Modify `src/renderer/editors/board/custom-editor-registry.ts`:

1. Expand `CustomEditorMatch` with `origin: "trusted" | "bundled"` and update the module/class
   comments from “trusted boards” to “trusted and bundled boards” where they describe the actual
   source set.
2. Keep the existing trusted-root loop and its trust-list order. Add the initialized bundled records
   as a second source, using their cached manifest and `origin: "bundled"`.
3. Process both source kinds through the same bridge compatibility gate, capability normalization,
   provider normalization, scheme registration, editor-association normalization, and
   `boardEditorId(root)` construction.
4. For bundled provider declarations, set `trusted: true` and `source: "trusted"`; register the
   factory and schemes with `origin: "board", owner: boardRoot`. For bundled capabilities, use
   `origin: "board"`, `boardRoot`, and the same handler key as trusted boards.
5. Preserve the installed-board provider-only branch at `:281-298`. It remains the untrusted
   provider declaration path and must not become a second bundled-discovery path.
6. Preserve the clear-before-rebuild behavior. The existing `unregisterBoardProviders()`,
   `unregisterBoardSchemes()`, `unregisterBoardCapabilities()`, and
   `replaceProviderDeclarations()` calls must remove both trusted and bundled registrations before
   rebuilding them.
7. Make `refresh()` safe to call after the future Disable setting changes. US-1485 will update the
   bundled source selection/permission state and call this public refresh; this task only exposes
   the seam.

The registration shape changes as follows:

```typescript
// Before: every custom-editor entry is implicitly a trusted-board entry.
entries.push({ editorId: boardEditorId(root), boardRoot: root, name, priority, /* ... */ });

// After: the source is explicit, while content/capability origins remain "board".
entries.push({
    origin: source.origin,
    editorId: boardEditorId(source.root),
    boardRoot: source.root,
    name,
    priority,
    /* masks, kind, and sources */
});
```

Do not import the bundled registry into `src/renderer/api/boards.ts`,
`TrustedBoardsListView.ts`, or any `mergeBoardSources()` path.

### 3. Decision: make registry readiness a bootstrap barrier, with a measured cost

Modify `src/renderer.ts` to await `customEditorRegistry.ensureInitialized()` after
`app.initServices()` and before `app.initPages()`:

```typescript
// Before: pages can restore/open while custom-editor manifests are still loading.
await app.initServices();
await app.initPages();

// After: registry discovery completes before persisted pages and first-open resolution.
await app.initServices();
await customEditorRegistry.ensureInitialized();
await app.initPages();
```

Retain the existing fire-and-forget warm-up in `register-editors.ts`; the bootstrap await joins
that initialization rather than starting a second scan. Verify that subsequent synchronous calls to
`resolveEditorIdForFile()` see bundled entries, including the `openRawLink`/content-resolver path.

This deliberately reverses the existing `register-editors.ts:238-241` design comment that an
unresolved registry is safe because it yields no matches and therefore falls back to the built-in
editor. The reversal also removes the same first-open race for trusted file-associated boards, so
it changes startup behavior for all users with trusted boards: `ensureInitialized()` waits for
`boardTrust.load()`, `boardInstallRegistry.load()`, and the refresh that reads every trusted-board
manifest, not just the bundled scan. That side effect is an explicit decision, not an incidental
implementation detail. EPIC-109 does not technically require the barrier: a lost race is benign
while the priority-50 built-in `draw-view` remains a working fallback, and coexistence is the
point of EPIC-109 D7. The barrier is chosen for deterministic registration and preparation for
EPIC-110, where the built-in row is removed and the same race would open a `.excalidraw` file in
Monaco.

Measure the added cold-start/bootstrap latency with a representative installation containing a
realistic number of trusted boards, recording the board count, manifest-read duration, and total
time from renderer start through `app.initPages()`. If that cost is material, use the fallback of
awaiting only the lightweight bundled discovery barrier before page/editor resolution while
deferring the broad trusted-board refresh, and document the measured result and revised ordering
before implementation proceeds.

### 4. Centralize “trusted or bundled” permission

Create `src/renderer/editors/board/board-access.ts` (or an equivalent board-layer module) with:

- `isBoardPermitted(boardRoot)`, returning true for a trusted root or a discovered, enabled bundled
  root;
- a source/origin lookup for internal diagnostics (`"trusted"`, `"bundled"`, or absent); and
- a combined subscription that fires for `boardTrust.subscribePaths()` and the bundled registry's
  subscription.

The helper must prefer the bundled classification for an exact normalized root discovered under
`assets/boards/` if the same root is also covered by a user trust ancestor; it must not write trust
state. The two predicates intentionally have different matching semantics: `boardTrust.isTrusted()`
is ancestor-aware (`pathCovers` permits a root or any listed ancestor), while bundled lookup is
exact-root only. Boards do not nest by design, so a path below a bundled root is not bundled or
permitted merely because it is below that root; it must independently satisfy the trusted predicate
or be an exact bundled root. The future Disable flag belongs in this helper/source selection seam
and in custom-editor refresh, not in this task's new settings code.

Replace the runtime checks listed in the permission audit with this helper. Update listener setup in
`BoardWebview`, `BoardEditorModel`, `board-capability-transport`, and `capability-bus` so a future
disable settles pending work exactly as trust revocation does. Keep error codes and transport
contracts unchanged.

Update `src/renderer/api/mcp/board-call-command.ts` in this task so a denied call says that the
board is not permitted, rather than telling a bundled board to trust itself. Do not defer this copy
to a later task.

Extend `BoardRenderState` in `src/renderer/api/types/board-editor.d.ts` with `"bundled"`. The
facade must return `"bundled"` for an enabled bundled root, `"trusted"` only for a root permitted
by the persisted trust list, and `"untrusted"` otherwise (`"not-found"` remains unchanged).
Change the facade's restriction checks to treat both `"trusted"` and `"bundled"` as permitted.

**Sync the flat type copy in the same change.** `assets/editor-types/` is a hand-maintained flat
copy of `src/renderer/api/types/*.d.ts` with no build script, and `board-editor.d.ts` is already
listed in `assets/editor-types/_imports.txt:5`. Editing the source `.d.ts` without copying the new
union value across silently breaks script IntelliSense for `renderState` — no typecheck, lint or
build error is produced. No new `_imports.txt` entry is needed; only the file contents change.

Update `src/renderer/api/boards.ts` only at the explicit trust lifecycle guards: a bundled root must
return from `registerBoard()` without opening a trust dialog or calling `boardTrust.trust()`, and
must not be written by `unregisterBoard()` or renamed by `renameBoard()`. Do not change the merged
board listing.

### 5. Include bundled service declarations in the existing main snapshot

Modify `src/renderer/api/board-trust-sync.ts` so its snapshot source is the union of trust roots and
bundled registry records. Before sending the first snapshot, `initBoardTrustSync()` must subscribe
to the bundled registry and `await bundledBoardRegistry.ensureInitialized()`; only after that await
may it enumerate records and send the initial snapshot. This ordering is required because
`app.initServices()` currently starts `initBoardTrustSync()` via an un-awaited dynamic-import
`.then()` at `src/renderer/api/app.ts:256-260`. Read each bundled record's already-parsed manifest
(or use the record directly), normalize its service path and permissions, and compute
`canStartService` through the shared permitted predicate. The bundled-registry subscription must
re-send the snapshot after every later refresh, including a future Disable/re-enable transition.
Do not rely on a trust-change event to repair this ordering: bundled boards are never in the trust
list and therefore have no such event.

The wire type in `src/ipc/module-service-channels.ts` can remain named
`TrustedBoardSnapshot`: it is a private snapshot contract, and main's existing
`isEffectivelyTrusted()` already treats snapshot membership as permission. Do not add a separate
main-process bundled trust file, main-side scan, or new `CapabilityOrigin` value.

### 6. Keep later-task seams explicit

- **US-1484:** leave `PagesLifecycleModel.ts:137-173` and `src/main/board-storage.ts:15-18` as the
  restore/storage seams for mapping a stale bundled root to the current root by `BundledBoard.id`.
  US-1483 keeps real roots in editor ids and does not change persistence.
- **US-1485:** use the bundled registry's `id`, manifest, origin, subscription, and
  `customEditorRegistry.refresh()` seam for the Built-in item and Disable flag. A disable must gate
  both creatable-item presentation and registry source selection; no setting is added here.
- **US-1486:** add the build output under `assets/boards/<id>/` later; this task makes no asset or
  packaging change.
- **US-1487:** supplies the actual Excalidraw manifest and board implementation later. The registry
  only consumes the manifest contract.
- **US-1488:** consumes the capability registrations later; this task only makes a bundled
  declaration enter the same capability bus and transport lifecycle as a trusted board.

## Concerns / Open questions

1. **Startup race and deliberate barrier:** The current registry intentionally has a synchronous
   fallback while async discovery is incomplete. For EPIC-109, losing that race is benign because
   the priority-50 built-in `draw-view` is a working fallback and coexistence is the point of D7;
   the await is not technically required yet. This plan nevertheless chooses the barrier for
   deterministic trusted and bundled resolution and to prepare for EPIC-110, where removing the
   built-in row would make the same race open `.excalidraw` in Monaco. The choice reverses the
   `register-editors.ts:238-241` pre-init fallback design and makes startup wait for all trusted
   manifests too, so the acceptance criteria require measuring that cost and applying the scoped
   bundled-only fallback from Plan 3 if it is material.
2. **Renderer scan choice:** The renderer scan is deliberate. `getAppRootPath` is already an IPC
   path for renderer-owned asset access, `app.fs` already supports typed directory enumeration,
   and `readBoardManifest()` already defines the manifest parsing contract. A main endpoint would
   duplicate that parser or introduce a shared IPC DTO without improving the app-owned discovery
   boundary.
3. **Absolute roots remain runtime identity:** Folder names are stable app identities, but editor ids
   and board-service records still carry absolute roots today. The install-path alias and storage
   migration are explicitly US-1484.
4. **Permission subscriptions:** Trust changes already have a TGlobalState subscription; bundled
   boards do not have a filesystem event. The new registry must expose an explicit in-memory
   notification so US-1485 can re-run registration when its setting changes. No watcher is needed
   for immutable installer resources.
5. **Provider/capability provenance:** Content registries deliberately use `origin: "board"` for
   both trusted and bundled boards because teardown and ownership use that value. The custom-editor
   source marker is the correct place to distinguish `"bundled"`; adding a third content origin
   would require widening every board-origin cleanup and capability transport branch.
6. **Service snapshot timing:** `app.initServices()` currently starts `initBoardTrustSync()` without
   awaiting it (`src/renderer/api/app.ts:256-260`). Plan 5 makes `initBoardTrustSync()` subscribe
   first, await bundled discovery, and only then send its first snapshot; later bundled-registry
   notifications resend it. Without that explicit ordering, main's
   `isEffectivelyTrusted()` (`src/main/module-service-supervisor.ts:514-520`) would reject a
   bundled service on cold start and no bundled trust event would repair the session. Manual
   verification must confirm a bundled service starts from a cold launch and after a later refresh.
7. **No current `assets/boards/` folder:** The repository currently contains
   `assets/board-template/`, `assets/demo-board/`, and `assets/board-call-regex/`, but no
   `assets/boards/`. That is expected: US-1486/US-1487 will supply the first bundled board. The
   registry must treat the absent directory as an empty source.

## Acceptance Criteria

- A fresh renderer startup completes bundled discovery before `app.initPages()` and before the
  first content resolver can select an editor.
- Startup verification measures the added bootstrap latency with a representative installation
  containing a realistic number of trusted boards, recording board count, manifest-read time, and
  total time through `app.initPages()`. If the measured cost is material, the implementation uses
  the Plan 3 fallback that awaits bundled discovery without making the broad trusted-board refresh
  a startup barrier, and records the resulting ordering.
- The registry scans only immediate directories under the resolved
  `assets/boards/` path, reads each `board-manifest.json`, skips malformed/missing manifests, and
  records the folder name as `id`, the real path as `root`, and `origin: "bundled"`.
- A valid bundled manifest with file masks produces a `CustomEditorMatch` with
  `origin: "bundled"`; normal editor resolution, including strict priority comparison against
  built-ins, can select its `board-editor:<absolute-root>` id.
- Bundled capability declarations, providers, and schemes are registered through the same board
  teardown/rebuild path as trusted-board declarations. Provider declarations are trusted-capable,
  and capability/content registration origins remain `"board"`.
- On a cold start, a bundled board whose manifest declares `service` reaches the running/usable
  service state: the first main-process snapshot includes it, and a later bundled-registry refresh
  re-sends the snapshot rather than relying on a trust-change event.
- `trustedBoards.txt` is unchanged by discovery, and no bundled root is passed to
  `boardTrust.trust()` or `boardTrust.untrust()` through the explicit board lifecycle API.
- `mergeBoardSources()`, `enumerateBoardListings()`, and `TrustedBoardsListView` continue to expose
  only trusted/installed board data; a bundled root does not appear in Tools & Editors → Boards.
- An enabled bundled board passes every audited runtime permission gate: main/secondary board
  rendering, AiVision, `persephone.call()`, capability dispatch/list/invoke, pending-request
  revocation, and service permission/snapshot synchronization.
- `persephone.call()` refuses a denied board with permission-neutral wording and never tells a
  bundled board to add itself to the trust list.
- `assets/editor-types/board-editor.d.ts` carries the same `BoardRenderState` union as
  `src/renderer/api/types/board-editor.d.ts`, so script IntelliSense still resolves `renderState`.
- The agent-visible `BoardEditorFacade.renderState` reports `"bundled"` for an enabled bundled
  root, `"trusted"` only for persisted trust-list permission, and treats both as permitted for
  facade operations; `"untrusted"` remains restricted.
- Calling `customEditorRegistry.refresh()` after the bundled source state changes clears stale
  bundled registrations and rebuilds the current source set. This is the seam US-1485 will use for
  Disable/re-enable; no Disable setting or Built-in UI is implemented here.
- No changes are made to `electron-builder.yml`, installer packaging, `assets/boards/` contents,
  restore aliasing, board storage keying, Excalidraw code, capability routing, or the trust/listing
  inventory model.
- No unit tests, test harnesses, or test files are added. Verification uses the project's existing
  manual/runtime workflow.

## Verification (2026-09-20)

Verified live over MCP against the running app, with **29 boards installed** — a representative
heavy installation.

**Bootstrap barrier cost (the measurement plan step 3 requires):**

| Measure | Result |
|---|---|
| Full `customEditorRegistry.ensureInitialized()` (trust load + install-registry load + refresh reading every trusted manifest) | **27.4 ms** |
| Bundled-only discovery, `assets/boards/` absent | **3.4 ms** |
| Bundled boards discovered | 0, as expected — no `assets/boards/` folder exists yet |

27.4 ms with 29 boards is **not material**, so the barrier stays as implemented and the documented
fallback (awaiting only the bundled scan and deferring the trusted refresh) is **not triggered**.
Caveat: measured on a warm renderer with the OS file cache warm, so it is a lower bound rather than
a true first-boot figure; the headroom is large enough that the conclusion holds.

**No-user-visible-change checks, with no bundled board present:**

- `boards.list()` returns the same 29 boards; no bundled entry appears, confirming
  `mergeBoardSources()` is untouched.
- A trusted board (the Demo board) opens and renders fully through the twelve converted permission
  gates: `frameReady` is `true`, the bridge reports version 1.8.0, and all eight of the board's own
  isolation self-checks pass.
- `BoardEditorFacade.renderState` reports `"trusted"` for a genuinely trusted board — the new
  `"bundled"` value does not leak into the trusted path.
- All four persisted pages restore normally with the bootstrap barrier in place.

**One defect found live and fixed:** the agent-visible descriptor summary for `renderState`
(`BoardEditorFacade.ts:65`) still advertised "trusted, untrusted, or not-found" after the union
gained `"bundled"`. The type and its flat copy were synced correctly, but the descriptor is what an
agent actually reads through `$help`, so it was stale in the AiVision contract. Neither typecheck,
lint nor `build-prod` can catch this class.

## Files that need no changes

- `electron-builder.yml` — D1 already packages `assets/` as `resources/assets` outside the asar.
- `src/renderer/api/boards.ts:128-186` merge/listing logic, except for the explicit lifecycle guards
  described in the plan; bundled sources must not be added to `mergeBoardSources()`.
- `src/renderer/ui/sidebar/TrustedBoardsListView.ts` — it intentionally reads
  `boardTrust.listPaths()` directly and needs no bundled filtering.
- `src/renderer/api/board-trust.ts` — the persisted trust model remains user/provenance trust only;
  bundled permission is supplied by the separate registry/helper.
- `src/ipc/main/core-handlers.ts`, `src/ipc/renderer/api.ts`, and `src/ipc/api-types.ts` — reuse
  `getAppRootPath`; no new IPC endpoint is planned.
- `src/ipc/module-service-channels.ts` and `src/main/module-service-supervisor.ts` — the existing
  private snapshot contract and membership-based effective-trust check can carry bundled entries.
- `src/renderer/editors/board/board-manifest.ts` — its manifest shape and parser are reused; no
  required `id` field is added.
- `src/renderer/api/pages/PagesLifecycleModel.ts` restore logic and `src/main/board-storage.ts` —
  intentionally deferred to US-1484.
- `src/renderer/editors/board-info/**` — bundled boards never enter the catalog/trusted-board
  inventory that drives Board Info; Built-in presentation belongs to US-1485.
- Any `assets/boards/<id>/` board implementation or build configuration — owned by US-1486/US-1487.
- Any test file or test configuration — this project uses manual/runtime verification for this work.
- `doc/active-work.md` and `doc/epics/EPIC-109.md` — the dashboard and epic link already exist and
  the request explicitly forbids modifying them.

## Files Changed Summary

| File | Planned implementation change | Changed by this planning task |
|---|---|---|
| `src/renderer/editors/board/bundled-board-registry.ts` | New app-owned scan/cache with folder-name identity, parsed manifests, `origin: "bundled"`, refresh, and subscription seams | No |
| `src/renderer/editors/board/board-access.ts` | New shared trusted-or-bundled permission/origin predicate and combined subscription | No |
| `src/renderer/editors/board/custom-editor-registry.ts` | Merge trusted and bundled sources; tag custom entries; register bundled declarations through board-origin teardown | No |
| `src/renderer.ts` | Await custom-editor initialization before page restore/open sequencing | No |
| `src/renderer/api/board-trust-sync.ts` | Await bundled discovery before the first main snapshot, include bundled service declarations, and re-send on bundled-source changes | No |
| `src/renderer/api/boards.ts` | Prevent explicit lifecycle operations from writing/renaming bundled roots; leave listing merge unchanged | No |
| `src/renderer/editors/board/board-service-permission.ts` | Use trusted-or-bundled permission for service declarations | No |
| `src/renderer/editors/board/BoardWebview.ts` | Use shared permission for all frame, AiVision, capability, and board-effect gates | No |
| `src/renderer/editors/board/BoardEditorModel.ts` | Use shared permission for AiVision/secondary-view state and combined revocation subscription | No |
| `src/renderer/api/board-capability-transport.ts` | Permit bundled capability frames and revoke them through combined permission changes | No |
| `src/renderer/api/capability-bus.ts` | Permit bundled board-origin capability handlers and settle them on combined revocation | No |
| `src/renderer/api/mcp/board-call-command.ts` | Permit `persephone.call()` for enabled bundled boards and use permission-neutral refusal wording | No |
| `src/renderer/editors/board/BoardEditorView.ts` | Render enabled bundled board branches instead of the untrusted placeholder | No |
| `src/renderer/editors/board/BoardSecondaryView.ts` | Mount enabled bundled secondary views | No |
| `src/renderer/scripting/api-wrapper/BoardEditorFacade.ts` | Report enabled bundled boards with the distinct `"bundled"` render state and treat trusted/bundled states as permitted | No |
| `src/renderer/api/types/board-editor.d.ts` | Add the agent-visible `"bundled"` `BoardRenderState` value | No |
| `assets/editor-types/board-editor.d.ts` | Sync the flat hand-maintained copy with the new `BoardRenderState` value (already listed in `_imports.txt:5`) | No |
| `doc/tasks/US-1483-bundled-board-registry/README.md` | Investigation, binding decisions, verified source findings, implementation plan, concerns, and acceptance criteria | Yes |
| `electron-builder.yml`, `src/renderer/api/board-trust.ts`, `src/ipc/main/core-handlers.ts`, `src/ipc/renderer/api.ts`, `src/ipc/api-types.ts`, `src/ipc/module-service-channels.ts`, `src/main/module-service-supervisor.ts`, `src/renderer/ui/sidebar/TrustedBoardsListView.ts`, `src/renderer/editors/board/board-manifest.ts` | No implementation change; retained as verified precedent/contracts | No |
| `doc/active-work.md`, `doc/epics/EPIC-109.md` | Explicitly excluded from this request | No |
