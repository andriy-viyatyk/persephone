# US-1471: contentProviders and stream-host manifest axes; reserved names and the one-owner rule

Related epic: [EPIC-107](../../epics/EPIC-107.md)

## Goal

Make trusted board manifests declare namespaced content providers and the third editor kind, plumb
stream-host through every manifest/catalog/editor/script type mirror without enabling stream-host
behavior, and register board provider types/schemes with deterministic ownership and readable
Board Info diagnostics.

This task owns every manifest and registry change in EPIC-107. It does not implement ProxyProvider,
ranged reads, board://__pipe serving, stream-host cache/host behavior, or tests.

## Background

### Binding decisions and verified boundaries

EPIC-107 D1 requires a board-declared provider type to contain /; the author chooses the stable
namespace and Persephone registers the string verbatim. Un-namespaced provider types are reserved
for the platform. D2 requires one owner per provider type and scheme: platform/hard-reserved
schemes cannot be claimed by boards, the first trusted board keeps a name, later boards are
refused, and the refusal must be readable in Board Info. Untrust and uninstall release a board's
names. D3 requires contentProviders in the disclosed permissions vocabulary, but the
contentProviders array—not that permission string—is the functional registration trigger. This
deliberately differs from EPIC-106's service lifecycle hygiene check. D5 keeps unknown editorKind
values degrading to simple for older Persephone versions.

EPIC-105 D1 established that registerScheme is a façade over the existing link event pipeline;
this task must use that registry rather than add a second dispatch path. EPIC-105 D2 deliberately
left unknown provider descriptors throwing; US-1472 owns the missing-provider placeholder, so this
task must not change createProviderFromDescriptor's missing-provider behavior.

EPIC-106 D1 established that permissions is disclosure/lifecycle hygiene rather than a security
boundary and that no grant record is added here. The current source already implements the
disclosure pattern: normalizePermissions in src/renderer/editors/board/board-manifest.ts:230-238
preserves unknown non-empty strings, the three trust call sites pass its result to
showTrustBoardDialog, and TrustBoardDialogView / its AiVision adapter render the complete list.
Therefore adding the known disclosure value contentProviders must not add a whitelist or
functional check.

### Manifest source and current normalizers

src/renderer/editors/board/board-manifest.ts has one flat BoardManifest interface and a
forward-compatible readBoardManifest that returns parsed objects without rejecting unknown fields
or higher schema versions. Existing optional capability axes are consumed only by trusted callers.
getBoardEditorAssociation is pure and trust-agnostic; it normalizes the association and returns
null only when no file/content/folder editor axis is usable.

The current editor-kind contract is:

~~~
// src/renderer/editors/board/board-manifest.ts:152
editorKind?: "simple" | "content-host";

// :473 and :515
editorKind: "simple" | "content-host";
const editorKind = manifest.editorKind === "content-host" ? "content-host" : "simple";
~~~

The planned additive contract is:

~~~
editorKind?: "simple" | "content-host" | "stream-host";
contentProviders?: BoardContentProviderDeclaration[];
~~~

The normalizer must retain current forgiving ingress behavior while retaining enough information
to report an invalid non-empty provider type. A declaration whose type does not contain / is not
silently dropped: registration refuses it with a reason such as:

    Provider type "mem" must contain "/"; un-namespaced provider types are reserved for the platform.

Blank/non-string declaration objects and blank scheme entries are unusable input and are omitted;
valid schemes are trimmed, lowercased, colon-stripped, and de-duplicated in declaration order.

### Existing registry contracts

src/renderer/content/registry.ts currently stores ProviderRegistration { factory, origin } in
providerFactories. RegistrationOrigin is already extensible (platform | script | string), and
registerProvider(type, factory, options) keeps platform registrations first-wins while allowing
script-over-script replacement. Missing types still throw from createProviderFromDescriptor.

src/renderer/content/scheme-registry.ts stores SchemeRegistration { hooks, origin } in schemeHooks;
registerScheme normalizes a scheme and has the same script replacement versus other-origin duplicate
behavior. Built-in schemes in src/renderer/content/builtin-schemes.ts:415-427 use
{ origin: "platform" }. file is handled by the file/path fallback rather than a scheme
registration, and blob is not a current registry entry; both still need the hard reservation
required by D2.

The existing registration APIs return void and duplicate reporting only calls ui.notify. The
implementation needs a non-breaking result/diagnostic seam so trusted-board refresh can retain the
refusal reason and owning board for Board Info, while existing script callers may continue to
ignore the returned value. Registration metadata needs an optional board owner root so an
unregister operation cannot remove another board's winning registration.

### Trusted-board enumeration and lifecycle

src/renderer/editors/board/custom-editor-registry.ts:104-166 is the trusted-board refresh path.
It reads boardTrust.listPaths() in trust-list order, reads each manifest, applies the existing
bridge compatibility gate, obtains getBoardEditorAssociation(), and rebuilds synchronous entries.
It currently continues when no editor association exists, so content provider registration must
happen before that early exit and must work for a service-only/tool board.

boardTrust.subscribePaths() triggers this refresh on trust/untrust. Existing lifecycle callers
already call boardTrust.untrust() for boards.unregisterBoard, local Board Info unregister, and
uninstallCatalogBoard after deleting the installed folder. No trust-file format change is needed.
Refresh must release old board-owned registrations before rebuilding, and must do so owner-safely
when a board is untrusted, uninstalled, renamed, or its manifest changes.

### Board Info diagnostics and disclosure surfaces

BoardInfoEditorModel.loadProperties() at
src/renderer/editors/board-info/BoardInfoEditorModel.ts:338-390 reads the local manifest,
normalizes the association and permissions, and constructs BoardPropsInfo. The view already
renders normalized permissions, bridge/service metadata, and editor kind at
BoardInfoEditorView.ts:350-420; BoardInfoEditorFacade copies the properties snapshot at
:127-162. The new provider declarations and registration refusals belong in this same local
properties snapshot. The Board Info view must render each refusal as readable warning text and name
the winning board root when a competing board owns the provider type or scheme.

The trust dialog is already threaded through BoardEditorView.trustBoard() at
src/renderer/editors/board/BoardEditorView.ts:268-276, boards.registerBoard() at
src/renderer/api/boards.ts:297-315, and BoardInfoEditorModel.register(); all three pass
normalizePermissions(manifest?.permissions) to the dialog. Since the dialog and
src/renderer/scripting/ai-vision/dialogs/trust-board.ts expose the whole normalized list, no
second permission helper or trust-dialog gate is needed for contentProviders.

### Corrected editorKind mirror inventory

The EPIC-107 inventory was verified against rg -n editorKind src assets/editor-types and the
source. It omitted the runtime Board Info model and the switch-option gates. The complete relevant
inventory is:

| Source | Verified role | US-1471 treatment |
|---|---|---|
| src/renderer/editors/board/board-manifest.ts:152,473,515 | Manifest declaration, normalized association, coercion | Add stream-host; keep unknown → simple. |
| src/ipc/api-param-types.ts:90,107 | Published catalog payload type | Add stream-host. |
| src/main/published-boards-service.ts:103-126 | Published catalog runtime validation | Accept stream-host; unknown remains absent. |
| src/renderer/editors/board/custom-editor-registry.ts:74,158 | Trusted match type and refresh copy | Add stream-host; do not lift its non-local open gate at :266. |
| src/renderer/api/pages/PagesLifecycleModel.ts:148 | Content-host-only construction branch | Preserve branch; stream-host construction is US-1475. |
| src/renderer/editors/base/editor-switch.ts:163-172 | Board-boundary host-transfer kind union | Widen the carried union only; do not add stream-host host-transfer behavior. |
| src/renderer/editors/base/editor-switch-options.ts:84-93 | Non-local switch/catalog gates | Preserve; lifting them is US-1475. |
| src/renderer/api/boards.ts:447 | Published catalog result copy | Widen inferred catalog value through the existing copy. |
| src/renderer/scripting/api-wrapper/BoardEditorFacade.ts:566 | Manifest snapshot filter | Accept/copy stream-host. |
| src/renderer/editors/board-info/BoardInfoEditorModel.ts:77,382 | Local Board Info state and manifest copy | Widen the union. |
| src/renderer/scripting/api-wrapper/BoardInfoEditorFacade.ts:154,210,245 | Properties/catalog facade pass-through and inline catalog type | Widen inline type; preserve pass-through behavior. |
| src/renderer/api/types/board-editor.d.ts:36 | IBoardManifest.editorKind | Widen; add contentProviders. |
| src/renderer/api/types/board-info-editor.d.ts:23,53 | Catalog and local Board Info snapshots | Widen; add local provider/diagnostic fields. |
| src/renderer/api/types/boards.d.ts:21 | Published result type | Widen. |
| assets/editor-types/board-editor.d.ts, board-info-editor.d.ts, boards.d.ts | Byte-identical IntelliSense copies | Copy every changed source type file; keep _imports.txt entries. |

src/renderer/api/types/page-panels.d.ts and its asset copy contain a generic editorKind: string
for panel records, not the board manifest axis. BoardInfoEditorView.ts:386 interpolates the
already-typed value and needs no union declaration. src/renderer/editors/board/board-api.d.ts
has no editorKind or manifest declaration; its provider registration API is US-1473's surface
and must not be widened here. Comments mentioning content-host in board-shim.ts and
BoardContentEditorModel.ts are behavior documentation, not value mirrors.

### ProxyProvider seam decision

US-1471 will not invent or duplicate ProxyProvider. It will add a small renderer content seam in
src/renderer/content/board-provider-factory.ts:

~~~
// US-1471 registers this factory closure for each trusted board declaration.
registerProvider(type, (config) => createBoardProvider(boardRoot, type, config), {
    origin: "board",
    owner: boardRoot,
});

// Until US-1473 installs the real implementation, this delegate throws a typed
// BoardProviderUnavailableError("proxy-provider-not-installed").
~~~

The seam owns the mutable createBoardProvider(boardRoot, type, config) delegate and the typed
not-yet-available error. US-1473 adds ProxyProvider and installs one delegate in this seam; it does
not redesign the provider registry or re-register every manifest declaration. This makes US-1473 a
small implementation addition while preserving the persisted author-chosen type and the board-root
closure needed to find the owning service. The placeholder error is not the EPIC-107 D8
missing-provider behavior; US-1472 owns that later distinction.

## Implementation Plan

### 1. Extend the manifest model and normalizers

- In src/renderer/editors/board/board-manifest.ts, add a named declaration interface for
  { type: string, schemes?: string[] } and optional contentProviders on BoardManifest.
- Add normalizeContentProviders(raw: unknown) (or an equivalently named exported normalizer) that
  performs shape/trim/case/deduplication normalization but retains a non-empty invalid type for
  the registration validator to refuse and diagnose. Keep permissions forward-compatible and
  document the known disclosure vocabulary (service, contentProviders, capabilities) without
  filtering unknown values.
- Widen editorKind on BoardManifest and BoardEditorAssociation. Change only the coercion at
  getBoardEditorAssociation so stream-host survives and every other unknown value still becomes
  simple:

~~~
// Before
const editorKind = manifest.editorKind === "content-host" ? "content-host" : "simple";

// After
const editorKind = manifest.editorKind === "content-host" || manifest.editorKind === "stream-host"
    ? manifest.editorKind
    : "simple";
~~~

- Keep all manifest axes trust-neutral in the parser. The custom-editor registry remains the trust
  gate, and contentProviders registration must not call canStartBoardService() or inspect the
  contentProviders permission.

### 2. Make both registries owner-aware and report structured refusal results

- In src/renderer/content/registry.ts, retain origin: board as the board origin and extend
  registration metadata with an optional owner board root. Make registerProvider return a small
  accepted/refused result while remaining source-compatible with callers that ignore its return.
  Preserve the existing precedence exactly: the first registration wins regardless of whether the
  incumbent is platform, script, or board, except that script-over-script still replaces. In
  particular, a board colliding with a script registration is refused and the script incumbent
  remains active; a script colliding with a board is likewise refused.
- Reject a board provider type that does not contain / before it can enter the map. Reject all
  board duplicates without replacement, including board/board collisions, and return the existing
  owner in the result. Add owner-checked board unregistration (or an owner-wide equivalent) so a
  losing board cannot remove the winning board's provider.
- Keep createProviderFromDescriptor unchanged in this task. Register the factory closure from the
  ProxyProvider seam decision above; it may throw only the typed interim
  proxy-provider-not-installed error until US-1473 installs the delegate.
- In src/renderer/content/scheme-registry.ts, apply the same result/owner metadata and add board
  hard-reservation checks before the existing map lookup. Normalize scheme names with the registry's
  existing lowercase/colon-stripping rule. A board refusal must cover http, https, file, data,
  blob, mneme, and every name beginning persephone-, even when the platform registration has not
  happened yet. A board may also not replace a platform registration. Add owner-checked board
  unregistration; leave script replacement semantics intact.
- Use readable result reasons as the source for Board Info, with the existing toast report retained
  only as supplemental immediate feedback. Do not hand-stringify caught values; any new catches use
  errMessage, and whole toast-only catches use guard per the project coding standard.

Before → after registry shape:

~~~
// Before
interface ProviderRegistration {
    readonly factory: ProviderFactory;
    readonly origin: RegistrationOrigin;
}
export function registerProvider(...): void;

// After (shape, exact naming may follow the existing registry style)
interface ProviderRegistration {
    readonly factory: ProviderFactory;
    readonly origin: RegistrationOrigin;
    readonly owner?: string;
}
export function registerProvider(...): RegistrationResult;
~~~

### 3. Register trusted board declarations from the existing custom-editor refresh

- In src/renderer/editors/board/custom-editor-registry.ts, add board-registration diagnostic state
  keyed by board root. Each item must identify provider or scheme, the refused name, readable
  reason, and (for a collision) the existing owner board root.
- During CustomEditorRegistry.refresh(), use existing trusted roots in list order. Apply the
  current bridge compatibility check first. For a compatible manifest, accumulate intended provider
  and scheme registrations plus invalid-declaration diagnostics into local collections, then
  continue through the existing if (!assoc) continue path only for editor-entry construction so a
  board with no file masks still contributes providers. Do not mutate either registry in this
  asynchronous loop.
- For each valid provider, call registerProvider(type, createBoardProvider closure, { origin:
  board, owner: root }). For each normalized scheme, call registerScheme with generic board hooks:
  parse sets data.url to the incoming link and delegates; resolve creates a descriptor whose
  provider type is the declared type and whose config carries the incoming URL, creates the pipe
  through context.createPipe(), and delegates in the normal open phase. The hook must support
  source-path without entering page creation. It must not implement service-port traffic or range
  handling.
- Preserve trusted-list order so the first trusted board wins. Store every rejected declaration in
  diagnostic state instead of silently dropping it. Include the winning owner root in a collision
  diagnostic. A board that loses one scheme/type may still register its other valid declarations.
- Use the existing refresh generation guard so a stale asynchronous manifest read cannot unregister
  or overwrite a newer refresh. After if (gen !== this.refreshGen) return, perform one synchronous
  full-rebuild commit: clear every registration whose origin is board, register the accumulated
  declarations in trusted-list order, collect any actual registry refusal results, and update
  entries, incompatibilities, and registration issues together. This deliberately releases all
  board-origin registrations, not only roots still present in boardTrust.listPaths(), so untrust
  and folder rename release old names before the new trusted set is rebuilt. The registry maps and
  state update are synchronous in this commit block; no async work is allowed between clearing and
  re-registering.
- Expose a synchronous getRegistrationIssues(boardRoot) and reactive state update for Board Info.
  Do not modify boardTrust, trustedBoards.txt, or the service permission helper.

### 4. Make refusal reasons readable in Board Info

- Extend BoardPropsInfo and loadProperties() in
  src/renderer/editors/board-info/BoardInfoEditorModel.ts with normalized local contentProviders
  and custom-registry registration issues for this root. Keep catalog PublishedBoardInfo fields
  separate; the catalog protocol does not currently carry local contentProviders declarations.
- Extend BoardInfoEditorView.renderProperties() to show provider declarations and a warning row
  for every refusal. The warning must include the type/scheme, the reason, and the winning board
  root when present. Use existing UIKit text/panel styles and theme color tokens; no hardcoded
  colors. Subscribe the view/model to custom-registry state so a trust/untrust/refresh updates the
  visible diagnostic without requiring a manual reopen.
- Extend BoardInfoEditorFacade.properties and its inline catalog type at
  src/renderer/scripting/api-wrapper/BoardInfoEditorFacade.ts:127-162,202-250, plus
  src/renderer/api/types/board-info-editor.d.ts, for provider declarations and structured issues.
  Preserve omission of absent optional values.

### 5. Plumb stream-host through all verified mirrors

- Widen the unions and pass-through filters in the files listed in the corrected inventory. In
  src/main/published-boards-service.ts, accept exactly stream-host in the catalog validator; other
  values remain undefined. In src/renderer/scripting/api-wrapper/BoardEditorFacade.ts, copy it
  from getManifest rather than dropping it.
- Widen CustomEditorMatch, local Board Info state, IPC/catalog types, and all three source d.ts
  files. Copy changed board-editor.d.ts, board-info-editor.d.ts, and boards.d.ts byte-for-byte to
  matching assets/editor-types files. Verify their existing entries in assets/editor-types/_imports.txt;
  do not add duplicates. This flat copy is hand-maintained and has no build step.
- Update src/renderer/editors/base/editor-switch.ts only enough for the value to remain typed while
  flowing through its existing host-capability decision. Do not make stream-host a content host, do
  not lift non-local filters in editor-switch-options.ts, and do not change the PagesLifecycleModel
  construction branch or custom-editor-registry.ts:266 open gate. Those are US-1475 behavior
  changes (no cache pipe, no materialization, __pipe, and non-local gates).
- Keep the coercion fallback exactly as the compatibility rule: a future/unknown value still
  normalizes to simple.

### 6. Keep disclosure and API scope exact

- Do not add a permission gate to provider registration. A board with contentProviders and no
  permissions entry still registers when trusted; a board with only permissions:
  [contentProviders] and no array registers nothing.
- Keep the script-facing surface unchanged. IoNamespace.ts:19-30 continues to wrap both registry
  calls with void-returning registerProvider/registerScheme functions, so the new internal result
  is ignored by scripts. Neither src/renderer/api/types/io.d.ts nor its byte-identical
  assets/editor-types/io.d.ts copy changes; adding a return value to those declarations would be a
  separate API decision and is not part of US-1471.
- Do not edit TrustBoardDialog.ts, TrustBoardDialogView.ts, or
  src/renderer/scripting/ai-vision/dialogs/trust-board.ts unless source verification reveals the
  existing normalized-list pass-through has changed. Their current behavior already discloses the
  new vocabulary value. Do not add a second permission helper; keep
  src/renderer/editors/board/board-service-permission.ts dedicated to service startup.
- Do not change src/renderer/editors/board/board-api.d.ts: board-page provider registration is
  US-1473, not this manifest/registry task.

### 7. Verification (no unit tests or harnesses)

- Use project typecheck/lint/build commands and live app observation only; do not add unit tests,
  test harnesses, fixtures, or a new test framework.
- Verify a trusted board with contentProviders: [{ type: demo/mem, schemes: [mem] }] registers
  even without a custom-editor association; mem:// is accepted at the registered-scheme
  validation boundary while an unregistered scheme remains rejected.
- Verify a type without / is refused with a readable Board Info reason; verify file, https, http,
  data, blob, mneme, and persephone-* are refused even before a platform scheme registration;
  verify a second trusted board loses a provider type/scheme with the first owner's root shown in
  Board Info.
- Verify untrust and catalog uninstall remove only that board's provider/scheme names, allowing a
  later trusted board to claim freed names. Existing platform and script registrations retain their
  current behavior.
- Verify stream-host survives local manifest parsing, trusted registry entries, catalog
  validation/results, Board Info, getManifest, and all copied script types. Verify an unknown
  editor kind still becomes simple.
- Verify no stream-host behavior from EPIC-107 D5 is included: no non-local gate lifting, no
  __pipe handler, no cache suppression, no ProxyProvider implementation, and no ranged stream.

## Concerns

- The registries currently report duplicate details through asynchronous UI notifications and store
  only origin. Adding owner-aware structured results must preserve script replacement semantics while
  ensuring a board refresh cannot delete a registration it does not own.
- Refresh is asynchronous and generation-guarded. Release/register work must be committed only for
  the winning refresh generation; otherwise a stale manifest read could make a just-trusted board
  lose its names or let an untrusted board reclaim a name. The full board-origin clear and rebuild
  are both inside the post-guard synchronous commit, so a superseded refresh cannot release or
  permanently block the winning registration.
- A full release/rebuild does not affect already-constructed provider instances held by open pipes.
  The registry maps are cleared and restored synchronously in one JavaScript turn, so
  createProviderFromDescriptor has no observable missing-type window for restore or source-path
  callers. If a later implementation introduces an asynchronous gap, it must be handed to
  US-1472's PendingProvider rather than solved in this task.
- The hard scheme reservation intentionally duplicates platform knowledge (file/blob are not both
  current registry entries). Keep the list in one registry-level constant so delayed platform
  bootstrap cannot create a shadowing window.
- contentProviders declarations can exist on boards without fileMasks; registration must occur
  before the current no-association early exit. Bridge-incompatible trusted boards remain excluded
  by the existing compatibility gate.
- Board Info may open while a refresh is pending. Its issue snapshot and subscription must make the
  refusal eventually visible without making manifest loading or trust mutation synchronous.
- The ProxyProvider seam must remain narrow. The interim typed error is only a construction-time
  bridge until US-1473 installs the real delegate; it must not be confused with US-1472's persisted
  missing-provider placeholder or EPIC-107 D7's service-port unavailable state.
- No changes are authorized in doc/active-work.md or doc/epics/EPIC-107.md; the dashboard entry
  already exists. No commit is authorized.

## Acceptance Criteria

- [ ] BoardManifest.contentProviders normalizes the declared shape and type/scheme names; provider
  types without / are refused with a readable diagnostic rather than silently accepted.
- [ ] contentProviders is disclosed wherever normalized manifest permissions are already disclosed,
  but it is not consulted as a registration gate.
- [ ] Trusted boards register provider types and schemes through the existing registries with
  origin: board; untrusted boards do not register them.
- [ ] Board providers cannot claim platform/hard-reserved schemes or un-namespaced provider types;
  first trusted board wins each provider type/scheme, and losing-board diagnostics name the owner in
  Board Info.
- [ ] Untrust and uninstall unregister only the affected board's names; freed names can be claimed
  by a later trusted board.
- [ ] The ProxyProvider factory seam throws a typed interim not-installed error until US-1473
  installs the delegate; no ProxyProvider implementation is added here.
- [ ] stream-host is accepted and preserved through every corrected mirror, including catalog, local
  Board Info, facade, and source/asset IntelliSense types; unknown kinds still normalize to simple.
- [ ] US-1475 behavior is absent: no gate lifting, stream URL/__pipe, cache suppression,
  materialization change, or ranged streaming.
- [ ] No unit tests or test harnesses are added; typecheck, lint, build, and live observations pass
  using existing project workflows.

## Files Changed Summary

| File | Planned change | Type copy / no-change note |
|---|---|---|
| src/renderer/editors/board/board-manifest.ts | Add contentProviders, its normalizer/diagnostics contract, permission vocabulary documentation, and stream-host coercion/unions. | Runtime source of truth. |
| src/renderer/content/registry.ts | Add board origin owner metadata, reserved provider validation, result diagnostics, and owner-safe unregistration. | Existing registry retained. |
| src/renderer/content/scheme-registry.ts | Add hard-reserved scheme validation, board ownership/results, and owner-safe unregistration. | Existing registry retained. |
| src/renderer/content/board-provider-factory.ts | New typed interim ProxyProvider delegate seam. | US-1473 installs the real delegate later. |
| src/renderer/editors/board/custom-editor-registry.ts | Drive trusted provider/scheme registration, release on refresh/untrust/uninstall, store Board Info issues, widen match kind. | No stream-host behavior gates. |
| src/renderer/editors/board-info/BoardInfoEditorModel.ts / BoardInfoEditorView.ts | Carry and render provider declarations and refusal reasons; widen local kind. | Existing theme/UI patterns. |
| src/renderer/scripting/api-wrapper/BoardEditorFacade.ts / BoardInfoEditorFacade.ts | Preserve stream-host and expose local provider diagnostics. | Existing pass-through methods retained. |
| src/renderer/api/types/board-editor.d.ts / board-info-editor.d.ts / boards.d.ts | Widen kind and add local manifest/diagnostic snapshot types. | Copy unchanged-byte shape to assets/editor-types. |
| assets/editor-types/board-editor.d.ts / board-info-editor.d.ts / boards.d.ts | Hand-maintained copies of the three changed source declaration files. | Verify existing _imports.txt entries; no new entry needed. |
| src/ipc/api-param-types.ts / src/main/published-boards-service.ts / src/renderer/api/boards.ts | Widen published catalog kind validation/types/copy. | contentProviders remains local manifest data. |
| src/renderer/editors/base/editor-switch.ts | Widen the carried board-kind union only. | Gate/behavior remains US-1475. |
| src/renderer/editors/base/editor-switch-options.ts / src/renderer/api/pages/PagesLifecycleModel.ts | No change in US-1471. | Behavior-only mirrors deferred to US-1475. |
| src/renderer/ui/dialogs/TrustBoardDialog.ts / TrustBoardDialogView.ts / src/renderer/scripting/ai-vision/dialogs/trust-board.ts | No change expected. | Existing normalized permission disclosure already shows unknown values. |
| src/renderer/editors/board/board-service-permission.ts / src/renderer/editors/board/board-api.d.ts | No change. | Do not add a second service helper or US-1473 API. |
| src/renderer/scripting/api-wrapper/IoNamespace.ts / src/renderer/api/types/io.d.ts / assets/editor-types/io.d.ts | No change. | Registry results remain internal; the script API keeps void returns and the two type files stay byte-identical. |
| doc/active-work.md / doc/epics/EPIC-107.md | No change. | Owned by the user; dashboard entry already exists. |

## Live verification, 2026-09-20 (Claude)

Observed against the running app after implementation, using the already-trusted Demo board with
three declarations added to its manifest — one valid (`demo/mem` + scheme `mem`), one with an
un-namespaced type (`badtype` + scheme `badscheme`), one claiming the reserved scheme `https`.
A freshly bootstrapped window was used because `CustomEditorRegistry.refresh()` runs on
`ensureInitialized()` and on trust changes only — **a manifest edit alone is not picked up**, which
is existing behaviour and worth knowing when verifying any manifest axis.

Confirmed:

- **Valid declaration registers.** `pages.openUrl("mem://qa/test.txt")` was accepted by the
  `isSchemeRegistered()` validation boundary in the new window (EPIC-107 criterion 1).
- **Un-namespaced type is refused, and its schemes with it.** `pages.openUrl("badscheme://x/y")`
  was rejected as an unsupported scheme, so the whole declaration was dropped rather than
  half-registered (criterion 5).
- **Reserved scheme is refused with a readable reason** (criterion 6):
  `Rejected scheme registration: "https". Scheme "https" is reserved for the platform.`
  The platform `https` scheme kept working throughout.

**Defect found — refusal alerts are raised per refresh, not deduplicated.** A single window
bootstrap produced the *same* reserved-scheme error alert **twice** (284 ms apart). Because
`refresh()` re-runs on every trust/untrust mutation, a board with one invalid declaration will
accumulate an error alert per refresh for the life of the session. That is a user-visible alert
storm and it breaches EPIC-107 exit criterion 13 (alerts empty after a run). Board Info is the
intended durable surface for these refusals (EPIC-107 D2); the toast should be supplemental and
raised at most once per `(board, kind, name, reason)`, not once per refresh.
