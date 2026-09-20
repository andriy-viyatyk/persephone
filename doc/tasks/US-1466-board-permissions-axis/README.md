# US-1466: `permissions` and `minBridgeVersion` manifest axes

## Goal

Add the three optional manifest declarations owned by EPIC-106—`permissions`,
`minBridgeVersion`, and `service`—with forward-compatible normalization, board-relative path
validation matching the guide-path semantics (including repairing interior backslashes), and the
bridge-version compatibility gate. Disclose the declarations before trust, show the relevant
values in Board Info, and export the single trusted-`service`/`"service"` permission predicate
for US-1467, without changing the trust-file format or starting processes.

## Background

### Binding scope

EPIC-106 D1 makes `permissions` a disclosure and lifecycle axis, not a grant or security
boundary. The platform may start a declared service only when the board is trusted and its
normalized permissions contain `"service"`; no grant record, update re-prompt, per-board consent,
or trust-file migration belongs here. D2 keeps `minBridgeVersion` separate from `minAppVersion`;
this task adds only the new `minBridgeVersion` comparison to local editor registration, while the
pre-existing `minAppVersion` machinery remains catalog-only. The shipped bridge must move from
`1.5.0` to `1.6.0`. US-1466 exclusively owns that bump in
`src/shared/board-bridge-version.ts` and `src/board-shim.ts`; US-1469 must not edit either. US-1467 owns the service
supervisor/process; US-1468 owns the service STATUS row and service request surface.

`doc/active-work.md` already links this task under EPIC-106. It must remain unchanged, as must
`doc/epics/EPIC-106.md`.

### Manifest and normalization patterns verified in source

`src/renderer/editors/board/board-manifest.ts:39-178` defines one flat `BoardManifest` interface.
Existing capability-bearing fields are optional and trust-gated by their consumers. The existing
normalizers are forgiving ingress functions: `normalizeFileMasks` (`:232-249`) accepts only
arrays of strings, trims/lowercases/deduplicates, and drops unusable entries; `normalizeFolderMasks`
(`:274-291`) trims, lowercases, unifies separators, and deduplicates; `normalizeSecondaryViews`
(`:503-519`) validates object shape, trims values, rejects invalid IDs, and keeps the first
duplicate. `readBoardManifest` (`:199-211`) parses unknown manifest fields without rejecting a
higher schema version.

The implementation should add:

```ts
// Current BoardManifest shape near minAppVersion / guides:
minAppVersion?: string;
// ... existing optional axes ...
guides?: string;

// Planned additive shape:
minAppVersion?: string;
permissions?: string[];
minBridgeVersion?: string;
service?: string;
// ... existing optional axes ...
guides?: string;
```

`normalizePermissions(raw: unknown): string[]` should use the secondary-view/file-mask style:
drop non-array, non-string, blank entries; trim; preserve declaration order; deduplicate first
occurrences; and preserve unknown non-empty strings. The known values currently are
`"service"`, `"contentProviders"`, and `"capabilities"`; the normalizer must not whitelist them
or reject future values.

`src/shared/guides/mounted-source.ts:29-49` is the existing guide-folder validator exported into
`board-manifest.ts` as `normalizeBoardGuidesFolder`. It rejects non-strings, blank values, drive
letters, leading `/` or `\`, and empty/`.`/`..` path segments, while repairing interior
backslashes to `/` before checking segments. The service normalizer must have these exact
board-relative semantics. The preferred implementation is to extract an exported
`normalizeBoardRelativePath(raw)` there, make `normalizeBoardGuidesFolder` delegate to it, and
use it for `service`; this makes the guide change behavior-identical by construction. The service
normalizer must return a safe board-relative normalized path (or `null`/an absent value), reject
absolute paths, drive letters, leading separators, `.`/`..` segments, and blank values, and leave
the process/entry-script execution to US-1467.

### Compatibility path verified in source

`src/shared/version-utils.ts:8-28` owns the shared semver-like `parseVersion`/
`compareVersions` comparator. `src/renderer/api/published-boards.ts:61-130` caches the app version
and exposes `publishedBoards.isCompatible(minAppVersion?)`; catalog file/folder selection and
Board Info published-version/install paths use it. `src/renderer/api/app.ts:18,43-45,70-75`
hydrates the renderer app version from `api.getAppVersion()`.

The trusted local editor path is different: `src/renderer/editors/board/custom-editor-registry.ts`
loads each trusted root in `CustomEditorRegistry.refresh()` (`:112-143`), calls
`getBoardEditorAssociation(manifest)`, and pushes a `CustomEditorMatch` into `entries`; file,
folder, and content resolution read that synchronous entry list. No current code compares a local
manifest's `minAppVersion`, `minBridgeVersion`, or any compatibility result before the push, and
there is no local incompatible-reason collection. Thus EPIC-106's description of already-existing
local incompatible-listing machinery is not verified in this checkout: the existing machinery is
catalog-only. The implementation must add only a `minBridgeVersion` comparison at this local
registry hook, retaining a diagnostic result for Board Info or the existing board listing while
excluding bridge-incompatible boards from editor entries. The helper should retain a shape that
can accept a future app-version comparison without restructuring, but this task must not invoke
local `minAppVersion` enforcement or change existing installed-board behavior.

The exact hook is the per-root loop in `CustomEditorRegistry.refresh()`, immediately after
`readBoardManifest(root)` and before `getBoardEditorAssociation(manifest)`/`entries.push(...)`:

```ts
// Current:
const manifest = await readBoardManifest(root);
const assoc = getBoardEditorAssociation(manifest);
if (!assoc) continue;
```

```ts
// Planned:
const manifest = await readBoardManifest(root);
const bridgeCompatibility = getBoardCompatibility(
    { minBridgeVersion: manifest?.minBridgeVersion },
    { bridgeVersion: BOARD_BRIDGE_VERSION },
);
if (!bridgeCompatibility.compatible) {
    // retain the reason for the Board/Info listing, but do not create an editor entry
    continue;
}
const assoc = getBoardEditorAssociation(manifest);
if (!assoc) continue;
```

The compatibility helper should expose separate app/bridge inputs so a future `minAppVersion`
comparison can be added without restructuring, but the refresh hook passes and evaluates only
`minBridgeVersion` against `BOARD_BRIDGE_VERSION`. An absent minimum is compatible. Equality and
lower requirements remain compatible. `minBridgeVersion` is a requirement, not a feature probe;
malformed/non-string raw values remain absent at the normalizer boundary rather than rejecting the
manifest.

### Trust dialog verified in source

`src/renderer/ui/dialogs/TrustBoardDialog.ts:9-20` currently defines only
`TrustBoardDialogProps { boardPath: string }` and `showTrustBoardDialog(boardPath: string)`. It
does not read a manifest. `src/renderer/ui/dialogs/TrustBoardDialogView.ts:24-79` currently
renders, in order:

1. the full-privilege warning (“Trusting this board lets it run programs on your computer with
   your full user privileges — including reading and changing your files and using any signed-in
   command-line tools…”);
2. “Only trust boards you created or fully understand.”;
3. the warning telling the user to ask an AI agent to review scripts and pointing to the F1 guide;
4. the absolute board path;
5. Cancel and Trust Board buttons.

The dialog currently discloses no manifest data. The three trust call sites verified are:

- `src/renderer/editors/board/BoardEditorView.ts:263-267`, `BoardEditorView.trustBoard`;
- `src/renderer/api/boards.ts:273-291`, `boards.registerBoard`;
- `src/renderer/editors/board-info/BoardInfoEditorModel.ts:578-588`,
  `BoardInfoEditorModel.register`.

The plan is to read the manifest at each call site and pass a narrow disclosure snapshot to the
dialog (`permissions` after normalization and a boolean/path-presence service declaration). The
dialog view will render the declared permission strings—including unknown strings—and a clear
“Service: declared” disclosure before the trust buttons. The AI adapter
`src/renderer/scripting/ai-vision/dialogs/trust-board.ts:29-40` mirrors the current props/message;
it must receive the new optional disclosure fields so an agent can observe the same dialog state.
No call site may write trust before the existing user result and namespace-collision confirmation.

### Board Info verified in source

Properties mode is loaded by `BoardInfoEditorModel.loadProperties()` in
`src/renderer/editors/board-info/BoardInfoEditorModel.ts:309-355`. It reads the local manifest,
derives the association with `getBoardEditorAssociation`, and currently copies name, description,
author, repository, manifest version, file/folder editor fields, root, trust, catalog identity,
and installed version into `BoardPropsInfo`. `BoardInfoEditorView.renderProperties()` at
`src/renderer/editors/board-info/BoardInfoEditorView.ts:363-404` renders description/author/repository,
location, file-editor and folder-editor rows, and catalog id. There are no permissions,
minBridgeVersion, or service rows. The planned additions are:

```ts
// Current BoardPropsInfo excerpt:
manifestVersion?: string;
fileMasks?: string[];
// ...
editorKind?: "simple" | "content-host";

// Planned:
manifestVersion?: string;
permissions?: string[];
minBridgeVersion?: string;
service?: string;
fileMasks?: string[];
// ...
editorKind?: "simple" | "content-host";
```

Board Info will render a permissions row (all normalized values), a bridge requirement row when
declared, and the declared service path when valid. It will leave an explicit named seam beside
the metadata rows for US-1468's service STATUS row; it will not read supervisor state, start a
process, or implement status.

The public copied snapshots must stay aligned: add the new optional values to
`src/renderer/api/types/board-editor.d.ts` (`IBoardManifest`) and
`src/renderer/api/types/board-info-editor.d.ts` (`IBoardInfoProperties`), copy both changed files
to their flat counterparts under `assets/editor-types/`, and keep their existing entries in
`assets/editor-types/_imports.txt`. `BoardEditorFacade.copyManifest()` at
`src/renderer/scripting/api-wrapper/BoardEditorFacade.ts:549-575` and
`BoardInfoEditorFacade.properties` at `src/renderer/scripting/api-wrapper/BoardInfoEditorFacade.ts:127-158`
must copy the new values. The three new manifest fields are not catalog fields in the current
`PublishedBoardInfo`/`boards.ts` contract; catalog install mode is inert until the local manifest
has been downloaded, so this task does not widen the published catalog protocol.

### Bridge-version inventory verified in source and docs

The runtime definition is `src/board-shim.ts:868-873`, where `window.persephone.version` is the
literal `"1.5.0"`. The source/type assertion is
`src/renderer/editors/board/board-api.d.ts:228-230`. Current author/agent assertions are
`assets/board-template/CLAUDE.md:8-9` and `assets/guides/agents/boards.md:14-15`.
Additional historical/current-document assertions are:

- `doc/platform-roadmap.md:329` and `:434`;
- `doc/epics/EPIC-100.md:138,167,175` (completed-epic history);
- `doc/epics/EPIC-106.md:139` (binding epic decision);
- `doc/reviews/platform-roadmap-critique.md:253,299` (historical review).

The implementation should establish one source-of-truth bridge constant, use it in the shim and
renderer compatibility gate, and update live author-facing assertions. It must not rewrite package
dependency versions containing the unrelated substring `1.5.0`, nor edit the binding EPIC-106 or
the historical EPIC-100/review records. Any roadmap assertion update must be kept separate from
the forbidden dashboard/epic edits and reviewed as documentation ownership permits.

### Existing-board baseline verified

The three tracked manifests are `assets/board-template/board-manifest.json`,
`assets/demo-board/board-manifest.json`, and `assets/board-call-regex/board-manifest.json`; none
declares any of the three new fields. Workspace-only `.persephone/boards/**` manifests likewise
contain no new declarations in the inspected tree. Because all three fields are optional,
`readBoardManifest` remains best-effort, the permission/service normalizers return empty/absent
values, and no existing manifest declares `minBridgeVersion`, the new registry gate is provably
inert for every existing board. These boards must retain their current trust, editor, and
rendering behavior without manifest edits.

## Implementation Plan

### 1. Add the manifest axes and normalizers

- Update `src/renderer/editors/board/board-manifest.ts` with optional `permissions`,
  `minBridgeVersion`, and `service` fields. Keep them additive and trust-gated by consumers.
- Add exported `normalizePermissions(raw: unknown)` with trimmed, de-duplicated, ordered string
  declarations and no known-value whitelist. Unknown values survive normalization and display.
- Treat `minBridgeVersion` as a non-empty semver string at the manifest compatibility boundary,
  using the existing `compareVersions` semantics; an absent/invalid raw value contributes no
  minimum rather than making an old app reject an otherwise readable manifest.
- Extract exported `normalizeBoardRelativePath(raw: unknown)` in
  `src/shared/guides/mounted-source.ts`; make `normalizeBoardGuidesFolder` delegate to it and
  have `normalizeBoardServicePath(raw: unknown)` use the same helper. Repair interior backslashes
  to `/`; reject blank/non-string input, absolute/leading-separator/UNC paths, drive-letter paths,
  and empty/`.`/`..` segments. Do not resolve it, check the file, spawn Node, or alter guide
  behavior beyond delegating to identical logic.
- Keep `readBoardManifest()` forward-compatible: optional unknown fields and higher schema versions
  remain readable; consumers call the appropriate normalizer.
- Add a focused `src/renderer/editors/board/board-service-permission.ts` exporting the one
  platform predicate
  `canStartBoardService(boardRoot: string, manifest: BoardManifest | null | undefined): boolean`.
  It must return true
  exactly when `boardTrust.isTrusted(boardRoot)` is true and normalized permissions contain the
  exact string `"service"`; it must not inspect or modify `trustedBoards.txt`.

Before → after contract:

```ts
// Before: no shared service-start decision exists.

// After: one consumer-facing decision, used by US-1467.
export function canStartBoardService(
    boardRoot: string,
    manifest: BoardManifest | null | undefined,
): boolean {
    return boardTrust.isTrusted(boardRoot)
        && normalizePermissions(manifest?.permissions).includes("service");
}
```

### 2. Reuse version comparison and add the bridge axis at local registry refresh

- Add a single `BOARD_BRIDGE_VERSION = "1.6.0"` source-of-truth constant in a dependency-free
  shared module usable by both the browser IIFE and renderer, and replace the literal in
  `src/board-shim.ts` with that constant.
- Extend `src/shared/version-utils.ts` with one pure version-compatibility predicate built on its
  existing `compareVersions`; keep its inputs/result shaped for a future app-version comparison,
  while leaving the existing catalog-only `publishedBoards.isCompatible` consumer behavior
  intact. `customEditorRegistry.refresh()` calls the helper only for `minBridgeVersion` against
  `BOARD_BRIDGE_VERSION`; it does not pass `manifest.minAppVersion`, obtain an app version, or
  enforce local `minAppVersion`.
- In `src/renderer/editors/board/custom-editor-registry.ts`, make the per-root refresh compare
  only `minBridgeVersion` before creating `CustomEditorMatch.entries`. Preserve a diagnostic
  incompatible record/reason for the Board/Info listing, but omit a bridge-incompatible board from
  all editor resolution getters. A missing or equal/lower requirement is compatible. Because the
  field is new and absent from every existing manifest, this gate is inert for existing boards.
- Do not add a parallel supervisor, a bridge handshake negotiation, or runtime feature probing.
  The bridge version is a manifest compatibility requirement; US-1467 consumes only the service
  hygiene predicate.
- Update `src/renderer/editors/board/board-api.d.ts`'s bridge-version JSDoc and the live
  author/agent assertions in `assets/board-template/CLAUDE.md` and
  `assets/guides/agents/boards.md` to `1.6.0`. Keep historical EPIC/review records unchanged;
  do not edit `doc/active-work.md` or `doc/epics/EPIC-106.md`.
- US-1466 exclusively owns the `1.5.0` → `1.6.0` bridge bump in
  `src/shared/board-bridge-version.ts` and `src/board-shim.ts`; US-1469 must drop its duplicate
  shim/version change.

Before → after runtime version:

```ts
// src/board-shim.ts
version: "1.5.0",

// planned
version: BOARD_BRIDGE_VERSION, // "1.6.0"
```

### 3. Thread disclosure through all trust paths

- Extend `TrustBoardDialogProps` in `src/renderer/ui/dialogs/TrustBoardDialog.ts` with the narrow
  optional disclosure data, and extend `showTrustBoardDialog` to accept it.
- At the three verified call sites (`BoardEditorView.trustBoard`, `boards.registerBoard`, and
  `BoardInfoEditorModel.register`), read the manifest, normalize permissions/service, and pass the
  snapshot before showing the dialog. Preserve the existing namespace collision check and trust
  mutation order.
- Update `TrustBoardDialogView` to show every declared permission and a service-declared row before
  the Cancel/Trust buttons, using existing UIKit text/panel color tokens only. Unknown permission
  strings must be visible. Keep the existing full-privilege warning and review guidance.
- Update `src/renderer/scripting/ai-vision/dialogs/trust-board.ts` so the live dialog adapter
  exposes the new disclosure properties and its current message/decision semantics remain intact.

Before → after props:

```ts
// Before
export interface TrustBoardDialogProps { boardPath: string; }

// Planned
export interface TrustBoardDialogProps {
    boardPath: string;
    permissions: readonly string[];
    serviceDeclared: boolean;
}
```

### 4. Add Board Info rows and public snapshot parity

- Extend `BoardPropsInfo` and `loadProperties()` to carry normalized `permissions`, validated
  `service`, and `minBridgeVersion` from the local manifest. Invalid service paths are absent,
  never resolved outside the board.
- Extend `BoardInfoEditorView.renderProperties()` with permissions and bridge requirement rows,
  plus the declared service path row if present. Leave a named `US-1468` service-status seam after
  the declaration metadata; do not add supervisor state or a STATUS value here.
- Extend `src/renderer/scripting/api-wrapper/BoardInfoEditorFacade.ts` to copy the new optional
  properties and `src/renderer/api/types/board-info-editor.d.ts` to declare them.
- Extend `IBoardManifest` in `src/renderer/api/types/board-editor.d.ts` and
  `BoardEditorFacade.copyManifest()` so `page.editor.getManifest()` does not silently omit the
  new manifest axes. Do not add `persephone.service` execution APIs; that belongs to US-1467/1468.
- Copy changed `board-editor.d.ts` and `board-info-editor.d.ts` into
  `assets/editor-types/`. Both are already present in `_imports.txt`; verify the entries remain
  present and do not add a duplicate.

### 5. Verification (no unit tests or test harnesses)

- Inspect all three tracked manifests and confirm no new fields were required or rewritten.
- Live-check a trusted board with no declarations: it still renders and remains in the existing
  editor/list surfaces.
- Live-check permission normalization with known, unknown, duplicate, blank, non-string, and
  reordered declarations; unknown values remain visible in Trust and Board Info.
- Live-check service hygiene truth table: untrusted + `service` permission is false; trusted
  without `service` permission is false; trusted + `service` permission is true; a `service` field
  alone is false. US-1467 will consume this predicate; this task starts nothing.
- Live-check service path normalization against the guide rule: interior `scripts\\service.mjs`
  repairs to `scripts/service.mjs`, while absolute/leading-separator, drive-letter, `.`, `..`,
  and empty paths are rejected; also confirm acceptance of a safe relative ESM path.
- Live-check bridge compatibility at `1.6.0`: absent/equal/lower `minBridgeVersion` remains
  editor-compatible; a higher requirement is retained in diagnostics with a reason and produces
  no custom-editor entry. Verify the local hook does not newly enforce `minAppVersion`; its
  pre-existing catalog-only behavior remains unchanged.
- Open Trust Board through all three call sites and confirm declarations appear before the Trust
  button; cancel leaves the trust file unchanged.
- Open Board Info properties for a board declaring all three fields and confirm permissions and
  minimum bridge are listed, the service declaration is visible, and the US-1468 status seam is
  present but inert.
- Confirm `src/renderer/api/types/*.d.ts` and `assets/editor-types/*.d.ts` remain identical for
  the changed files and `_imports.txt` still lists both.
- Run the project’s normal `npm run typecheck`, `npm run lint`, and `npm run build-prod` checks;
  do not add unit tests or harnesses. Complete the epic’s required live MCP observations after
  US-1467/1468 exist.

## Concerns

- **Existing minAppVersion scope mismatch — deliberately out of scope.**
  `publishedBoards.isCompatible()` is real but catalog-only; a locally registered non-catalog board's
  `minAppVersion` is honored on the install/catalog path and ignored on the registration path.
  This pre-existing gap deserves its own task, but this epic's zero-behavior-change constraint
  makes the local enforcement change inappropriate here. The registry hook therefore compares
  `minBridgeVersion` only.
- **Shared board-relative path normalization — resolved in plan.** Extract the guide logic as
  `normalizeBoardRelativePath()` and delegate from both guide and service normalizers. Interior
  backslashes repair to `/`; leading separators, drive letters, blank values, and `.`/`..`
  segments remain rejected, so guide behavior is preserved exactly while Windows-style service
  paths work.
- **Trust inheritance remains unchanged.** `boardTrust.isTrusted()` is ancestor-aware while
  `untrust()` removes only an exact path (`src/renderer/api/board-trust.ts:60-86,120-131`). Do not
  add per-board grants, re-prompts, manifest hashes, or any `trustedBoards.txt` format change.
- **Compatibility diagnostics have no current local collection.** The catalog has an existing
  compatible/incompatible rule, but `src/renderer/api/boards.ts:221-231` has a synchronous local
  listing path that intentionally does not read manifests. This plan resolves the ownership by
  retaining the reason in the custom-editor registry's diagnostic state and showing it in Board
  Info; it does not force manifest I/O into that synchronous path or add service status to
  `boards.list()`. That keeps the EPIC-106 “same incompatible state/listing” behavior within the
  manifest/Board Info surface owned by this task while US-1468 owns live service status.
- **Bridge assertions have mixed ownership.** US-1466 exclusively owns the runtime bridge bump in
  `src/shared/board-bridge-version.ts` and `src/board-shim.ts`; US-1469 must not duplicate it.
  The author-facing guides should move to `1.6.0`; EPIC-100 and the roadmap critique are
  historical records, while EPIC-106 is binding and explicitly forbidden to edit. The
  implementation should leave those historical statements intact and coordinate any
  roadmap-current wording separately.
- **Optional-field compatibility.** No existing board manifest may be edited to add defaults. The
  absence path must normalize to no permissions, no service, and no minimum requirements, which
  keeps existing trusted boards identical.
- **No service process design here.** The task must not add `utilityProcess`, entry loading,
  handshake, restart, shutdown, status state, or bridge request routing; those are US-1467/1468.

## Acceptance Criteria

- [ ] `BoardManifest` has optional `permissions`, `minBridgeVersion`, and `service` fields.
- [ ] `normalizePermissions` preserves unknown values, removes unusable/duplicate entries, and
      returns an empty list for absent or malformed input.
- [ ] The service normalizer has the same semantics as `normalizeBoardGuidesFolder`: it repairs
      interior backslashes to `/`, accepts safe board-relative paths, and rejects absolute,
      drive-letter, and traversal inputs without changing guide behavior.
- [ ] One exported service-start predicate is true exactly for trusted boards whose normalized
      permissions include `"service"`; it performs no trust persistence or process work.
- [ ] `minBridgeVersion` alone compares against the single shipped `1.6.0` bridge constant at the
      local editor-registry refresh hook; the helper remains future-extensible for
      `minAppVersion`, but local `minAppVersion` is not invoked or enforced. Bridge-incompatible
      boards have a readable reason and no editor association.
- [ ] The Trust Board dialog shows all declared permissions, including unknown values, and clearly
      discloses whether a service is declared before the user can trust the board.
- [ ] Board Info properties lists `permissions` and `minBridgeVersion`, shows the declared service
      path when present, and leaves the named US-1468 status seam without implementing status.
- [ ] `page.editor.getManifest()` and the Board Info scripting facade preserve the new optional
      values, with the matching flat `assets/editor-types/` copies kept in sync.
- [ ] Existing tracked/workspace boards with omitted fields behave identically and their manifests
      remain unchanged.
- [ ] No changes are made to `src/renderer/api/board-trust.ts`, `trustedBoards.txt`,
      `doc/active-work.md`, or `doc/epics/EPIC-106.md`; no unit tests or harnesses are added.
- [ ] Typecheck, lint, production build, and the live verification observations pass.

## Files Changed

| file | planned change |
|---|---|
| `src/renderer/editors/board/board-manifest.ts` | Add the three optional fields, permission normalizer, and service-path normalizer/export wiring. |
| `src/shared/guides/mounted-source.ts` | Extract/export `normalizeBoardRelativePath`; make guide normalization delegate to the shared behavior used by `service`. |
| `src/renderer/editors/board/board-service-permission.ts` | New single trusted-plus-`"service"` hygiene predicate for US-1467. |
| `src/shared/board-bridge-version.ts` | New dependency-free `1.6.0` bridge constant shared by shim and renderer; exclusively owned by US-1466 (US-1469 must not duplicate this change). |
| `src/shared/version-utils.ts` | Add the shared pure compatibility predicate and make catalog compatibility delegate to it. |
| `src/board-shim.ts` | Use the shared bridge constant instead of the `1.5.0` literal; this shim bump is exclusively owned by US-1466. |
| `src/renderer/editors/board/custom-editor-registry.ts` | Apply `minBridgeVersion` only during refresh; retain incompatible diagnostics and omit bridge-incompatible editor entries. |
| `src/renderer/ui/dialogs/TrustBoardDialog.ts` | Add disclosure props and pass them into the dialog model. |
| `src/renderer/ui/dialogs/TrustBoardDialogView.ts` | Render permissions and service declaration before trust buttons. |
| `src/renderer/scripting/ai-vision/dialogs/trust-board.ts` | Mirror disclosure state in the dialog adapter. |
| `src/renderer/editors/board/BoardEditorView.ts` | Pass manifest disclosure from the direct board trust flow. |
| `src/renderer/api/boards.ts` | Pass manifest disclosure from `registerBoard`; no trust storage changes. |
| `src/renderer/editors/board-info/BoardInfoEditorModel.ts` | Pass disclosure at registration and load new Board Info properties. |
| `src/renderer/editors/board-info/BoardInfoEditorView.ts` | Render declarations and the named US-1468 status seam. |
| `src/renderer/scripting/api-wrapper/BoardEditorFacade.ts` | Copy new manifest fields from `getManifest()`. |
| `src/renderer/scripting/api-wrapper/BoardInfoEditorFacade.ts` | Copy new properties into the scripting snapshot. |
| `src/renderer/api/types/board-editor.d.ts` | Declare new `IBoardManifest` fields. |
| `src/renderer/api/types/board-info-editor.d.ts` | Declare new `IBoardInfoProperties` fields. |
| `assets/editor-types/board-editor.d.ts` | Hand-maintained flat copy of the changed board type. |
| `assets/editor-types/board-info-editor.d.ts` | Hand-maintained flat copy of the changed Board Info type. |
| `src/renderer/editors/board/board-api.d.ts` | Update the bridge-version JSDoc assertion to `1.6.0`. |
| `assets/board-template/CLAUDE.md` | Update the live authoring assertion to `1.6.0` (new axis details remain US-1470). |
| `assets/guides/agents/boards.md` | Update the live agent-guide assertion to `1.6.0`. |

### Files verified as requiring NO changes

| file/area | reason |
|---|---|
| `src/renderer/api/board-trust.ts` and `trustedBoards.txt` | D1 forbids grant records, format changes, and trust invalidation. |
| `doc/active-work.md` | US-1466 is already linked under EPIC-106; dashboard is explicitly owned elsewhere. |
| `doc/epics/EPIC-106.md` | Binding epic document is explicitly owned by the reviewing agent. |
| `src/renderer/editors/board/BoardEditorModel.ts` | Existing manifest facade read path can remain; only its copied manifest result needs the facade/type additions. |
| `src/ipc/api-param-types.ts`, `src/main/published-boards-service.ts`, and catalog search/update files | The current published catalog has no local declarations for these axes; widening it would exceed this task and US-1470 owns authoring/catalog documentation. |
| `src/renderer/editors/board/board-api.d.ts` runtime API surface | Only its version comment changes; no `persephone.service` API is added. |
| Test directories and harnesses | The project/task explicitly forbids adding unit tests or test harnesses. |
