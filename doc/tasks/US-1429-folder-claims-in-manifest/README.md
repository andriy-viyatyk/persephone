# US-1429 — Folder claims in the manifest, catalog transport, and trusted resolution

**Status:** Active · **Epic:** [EPIC-103](../../epics/EPIC-103.md)

## Goal

Add the data-layer contract for boards that claim folders: distinct
`folderEditorMasks`/`folderEditorPriority` manifest fields, defensive catalog transport, and
trusted custom-registry resolution that returns virtual board ids. This task is deliberately
inert: it does not make a folder board open, appear in a switch widget, or become installable;
those behaviors belong to US-1430, US-1431, and US-1432.

## Background

The completed EPIC-103 investigation established the task split and the compatibility decisions;
this document records the source-verified slice for US-1429 rather than repeating that
investigation. The epic's [D1](../../epics/EPIC-103.md#d1--a-distinct-manifest-axis-never-an-overloaded-foldermasks),
[D2](../../epics/EPIC-103.md#d2--the-merge-lives-beside-the-custom-registry-not-inside-editorregistry),
and [D3](../../epics/EPIC-103.md#d3--priority-is-strict-and-built-ins-win-ties) decisions are
binding.

### Existing manifest semantics

`readBoardManifest` parses JSON and returns the typed object without normalization
([`board-manifest.ts:184-197`](../../../src/renderer/editors/board/board-manifest.ts:184)).
Normalization and association gating happen in `getBoardEditorAssociation`:

- `normalizeFileMasks` lowercases, trims, deduplicates, and applies the existing file-mask
  coercions ([`board-manifest.ts:200-237`](../../../src/renderer/editors/board/board-manifest.ts:200)).
- `normalizeFolderMasks` is a separator-normalizing, suffix-glob normalizer with no bare-name
  coercion ([`board-manifest.ts:255-277`](../../../src/renderer/editors/board/board-manifest.ts:255)).
- `matchesBoardMasks` requires a file-mask match and then optionally narrows it with
  `folderMasks`; a bare `folderMasks` value never creates a file association
  ([`board-manifest.ts:310-333`](../../../src/renderer/editors/board/board-manifest.ts:310)).
- `getBoardEditorAssociation` currently returns `null` when both normalized `fileMasks` and
  `contentMasks` are empty ([`board-manifest.ts:410-443`](../../../src/renderer/editors/board/board-manifest.ts:410)).

The `folderMasks` documentation at
[`board-manifest.ts:75-91`](../../../src/renderer/editors/board/board-manifest.ts:75) and
the implementation at [`board-manifest.ts:310-333`](../../../src/renderer/editors/board/board-manifest.ts:310)
are load-bearing. `folderEditorMasks` is a separate axis matching the folder itself; it must
never be folded into or interpreted through the file association's narrowing-only `folderMasks`.

The direct-folder claim can reuse the existing glob machinery without reusing the legacy field:
`folderMaskToRegExp` compiles to `(?:^|/)${body}$` with the `i` flag
([`board-manifest.ts:285-299`](../../../src/renderer/editors/board/board-manifest.ts:285)).
Together with `normalizeFolderMasks`, that makes a bare `.vscode` a suffix claim on any folder
whose final path segment is `.vscode`, while preserving segment boundaries and case-insensitive
matching.

The existing association shape and comments include two file-only invariants that must be
retracted in the same edit as the gate: `BoardEditorAssociation.fileMasks` is documented as
"Guaranteed non-empty" at [`board-manifest.ts:391-401`](../../../src/renderer/editors/board/board-manifest.ts:391),
and `getBoardEditorAssociation` is documented as extracting only the file-editor association at
[`board-manifest.ts:410-416`](../../../src/renderer/editors/board/board-manifest.ts:410). The
implementation must replace those comments with wording that allows empty file/content arrays
for a folder-only association, while preserving the guarantee that `fileMasks` is non-empty
whenever the file axis itself is used. The inline gate comment at
[`board-manifest.ts:421-425`](../../../src/renderer/editors/board/board-manifest.ts:421) must say
that `folderMasks` alone still creates nothing, whereas `folderEditorMasks` alone deliberately
creates a folder association.

The existing association shape is:

```ts
// Before
interface BoardEditorAssociation {
    fileMasks: string[];
    folderMasks: string[];       // narrows fileMasks only
    contentMasks: string[];
    editorPriority: number;      // file resolution
}
```

US-1429 changes it to the following distinct shape:

```ts
// After
interface BoardEditorAssociation {
    fileMasks: string[];
    folderMasks: string[];       // unchanged: narrows fileMasks only
    contentMasks: string[];
    editorPriority: number;      // file resolution only
    folderEditorMasks: string[]; // direct folder resolution
    folderEditorPriority: number;
}
```

The association gate must accept a folder-only board, while still rejecting a board whose only
usable association field is `folderMasks`:

```ts
// Before
if (fileMasks.length === 0 && contentMasks.length === 0) return null;

// After
if (
    fileMasks.length === 0
    && contentMasks.length === 0
    && folderEditorMasks.length === 0
) return null;
```

`folderEditorPriority` must use the identical guard already used for `editorPriority` at
[`board-manifest.ts:427-431`](../../../src/renderer/editors/board/board-manifest.ts:427):

```ts
const folderEditorPriority =
    typeof rawFolderEditorPriority === "number"
    && Number.isFinite(rawFolderEditorPriority)
    && rawFolderEditorPriority > 0
        ? rawFolderEditorPriority
        : 0;
```

Thus non-numbers, non-finite values, negative values, and exactly `0` all take the `0` branch;
there is no rounding or `Math.max` coercion. A board is a folder switch candidate at any
normalized priority, but only a strict priority increase can replace the built-in winner.

### Existing trusted registry and folder primitives

`custom-editor-registry.ts` imports `editorRegistry` directly
([`custom-editor-registry.ts:16-26`](../../../src/renderer/editors/board/custom-editor-registry.ts:16)),
so the merge belongs there. `refresh()` enumerates `boardTrust.listPaths()`, reads each trusted
manifest, projects `getBoardEditorAssociation()` into `entries`, and uses a generation counter to
discard stale overlapping refreshes
([`custom-editor-registry.ts:98-137`](../../../src/renderer/editors/board/custom-editor-registry.ts:98)).
The file side then reads those entries synchronously and chooses a board only when its priority is
strictly greater than the built-in priority
([`custom-editor-registry.ts:186-228`](../../../src/renderer/editors/board/custom-editor-registry.ts:186)).

`EditorRegistry.resolveForFolder` starts at `category-view` priority `0` and evaluates built-in
`acceptFolder` matchers; `getFolderEditors` returns accepted built-ins in ascending priority
([`editorRegistry.ts:147-172`](../../../src/renderer/editors/base/editorRegistry.ts:147)).
`editor-matchers.ts` confirms `git-tree` and `mneme-root` each use priority `20`
([`editor-matchers.ts:150-160`](../../../src/renderer/editors/base/editor-matchers.ts:150)).
`EditorRegistry` must remain a built-in-only primitive. Importing the custom registry there would
reverse the dependency that the file-side merge intentionally avoids.

The virtual id is `board-editor:<boardRoot>` and is created from the current trusted entry
([`custom-editor-registry.ts:28-43`](../../../src/renderer/editors/board/custom-editor-registry.ts:28)).
Therefore the folder resolver must return ids only from the current `customEditorRegistry.entries`
projection. It must not read a manifest directly from an id or invent a second trust mechanism.
During `boardTrust`-driven refresh, folder getters will have the same short refresh-window behavior
as file resolution: the old reactive projection remains until the async rebuild completes, then
the generation-guarded update removes untrusted entries.

`CustomEditorMatch` has the same file-only wording that must be corrected: its interface comment
currently describes one trusted *file-associated* board and its `fileMasks` field as the board's
file masks ([`custom-editor-registry.ts:45-63`](../../../src/renderer/editors/board/custom-editor-registry.ts:45)).
The revised comments must describe a trusted board association that may be file-only,
folder-only, or both; `fileMasks` may be empty for folder-only entries, and the existing file
getters still simply ignore those empty arrays.

### Existing catalog transport

The catalog contract in `src/ipc/api-param-types.ts` says that association fields are copied by
the external publish automation so the app can advertise boards without downloading them
([`api-param-types.ts:88-113`](../../../src/ipc/api-param-types.ts:88)). The in-repository main
service treats that remote document as untrusted: `validateBoard` filters `folderMasks` to
strings before returning a `PublishedBoardInfo`
([`published-boards-service.ts:88-131`](../../../src/main/published-boards-service.ts:88)).
The renderer's `publishedBoards` model normalizes those copied masks at matching time and applies
the app-version gate ([`published-boards.ts:27-37`](../../../src/renderer/api/published-boards.ts:27),
[`published-boards.ts:124-133`](../../../src/renderer/api/published-boards.ts:124)).

`app.boards.searchPublished` maps catalog association fields into the public result at
[`boards.ts:377-413`](../../../src/renderer/api/boards.ts:377). The corresponding public and
Board Info declarations currently contain only the file axis:
[`boards.d.ts:5-34`](../../../src/renderer/api/types/boards.d.ts:5),
[`board-info-editor.d.ts:10-48`](../../../src/renderer/api/types/board-info-editor.d.ts:10),
and the installed manifest declaration is at
[`board-editor.d.ts:16-32`](../../../src/renderer/api/types/board-editor.d.ts:16).

The external catalog schema is not changed in this repository. The new fields are carried through
the existing IPC type, main-process validation, renderer-side mask normalization, public mapping,
and declarations. No folder catalog lookup or subscription is added here; that is US-1432.

## Implementation Plan

1. **Add the distinct manifest axis in `src/renderer/editors/board/board-manifest.ts`.**

   - Add optional `folderEditorMasks?: string[]` and `folderEditorPriority?: number` beside
     the existing custom-editor fields. Document that masks match the absolute folder being
     resolved, not a file's parent, and explicitly contrast them with `folderMasks`.
   - Add the folder-claim normalization beside `normalizeFolderMasks`: accept arrays only,
     drop non-strings and empty values, normalize separators/case/leading/trailing path syntax,
     and deduplicate using the existing folder-glob rules. Keep the axis named and stored as
     `folderEditorMasks`; sharing a low-level glob normalizer is acceptable, reusing
     `folderMasks` as the claim field or as a file gate is not.
   - Add a direct-folder predicate for the new masks. It must test the folder path itself and
     must not call `matchesBoardMasks`, because that predicate requires `fileMasks` and applies
     the legacy `folderMasks` narrowing behavior.
   - Normalize `folderEditorPriority` to a finite non-negative number with default `0`.
   - Extend `BoardEditorAssociation` and update `getBoardEditorAssociation` so a usable
     `folderEditorMasks` value is sufficient to create an association. In the same edit, replace
     the `fileMasks` "Guaranteed non-empty" field comment, the file-only association docstring,
     and the gate comment that currently explains only `folderMasks` rejection. State that file
     masks can be empty only for a folder-only association, that `folderMasks` alone still
     creates nothing, and that `folderEditorMasks` alone intentionally creates a folder
     association. Preserve all existing file/content normalization, `editorPriority`,
     `editorKind`, and `editorSources` behavior.

2. **Project folder claims into the trusted custom registry in
   `src/renderer/editors/board/custom-editor-registry.ts`.**

   - Add `folderEditorMasks` and `folderEditorPriority` to `CustomEditorMatch` and copy them
     from the normalized association during `refresh()`. A folder-only association must now be
     retained in `entries`, while its empty file/content arrays still make it invisible to the
     existing file/content getters.
   - Add `getBoardsForFolder(folderPath: string): CustomEditorMatch[]`. Filter only the current
     trusted entries whose distinct `folderEditorMasks` match the supplied folder path, retaining
     trusted-list order. Do not use `folderMasks` as a fallback.
   - Add merged siblings of `resolveEditorIdForFile`, named
     `resolveEditorIdForFolder(folderPath)` and `getFolderEditorsForFolder(folderPath)`.
     Both call the built-in `editorRegistry.resolveForFolder`/`getFolderEditors` first and then
     read `getBoardsForFolder`; neither changes `EditorRegistry`.
   - For the winning resolver, first resolve the built-in id and derive its priority with the exact
     folder analogue of the file-side expression:

     ```ts
     const builtinId = editorRegistry.resolveForFolder(folderPath);
     const builtinPriority =
         editorRegistry.getById(builtinId)?.match?.acceptFolder?.(folderPath) ?? 0;
     ```

     This is self-consistent because `resolveForFolder` seeds `bestPriority = 0` and
     `bestId = "category-view"` ([`editorRegistry.ts:149-150`](../../../src/renderer/editors/base/editorRegistry.ts:149)),
     while `category-view`'s `acceptFolder` returns `0`
     ([`editor-matchers.ts:150-152`](../../../src/renderer/editors/base/editor-matchers.ts:150)).
     Then select the highest-priority matching board only when its `folderEditorPriority` is
     strictly greater. This makes priority `1` beat the category-view floor, priority `20` tie
     and lose to Git/Mneme, and priority `21` displace them. Among boards, retain trusted-list
     order for equal priorities, as the file resolver does.
   - For the merged candidate list, return the built-in segment exactly as
     `editorRegistry.getFolderEditors(folderPath)` returns it, then append matching boards in
     `getBoardsForFolder(folderPath)`'s trusted-list order. Do not sort this list by priority and
     do not add a built-in/board priority tiebreak: priority decides the default resolver only,
     never toolbar order. This preserves the existing folder registry ordering with Folder View
     first and mirrors the file-side append behavior in
     [`editor-switch-options.ts:51-54`](../../../src/renderer/editors/base/editor-switch-options.ts:51).
     Include every matching board, including boards below the default winner.
   - Keep the current refresh subscription, generation guard, and reactive state intact. This
     deliberately inherits the file side's asynchronous trust-refresh window. A stale or
     hand-written virtual id is not independently trusted by this task; only an id currently
     projected from the trusted registry can be returned.

   Before → after call-site shape for the future folder consumers:

   ```ts
   // Before: built-in folders only
   const target = editorRegistry.resolveForFolder(folderPath);
   const options = editorRegistry.getFolderEditors(folderPath);

   // After US-1429: trusted virtual boards are available from the merge layer
   const target = resolveEditorIdForFolder(folderPath);
   const options = getFolderEditorsForFolder(folderPath);
   ```

   These helpers are data-layer exports only in this task. US-1430/1431 will consume them from
   lifecycle, Explorer, folder models, and switch code.

3. **Carry the new fields through catalog transport and validation.**

   - In `src/ipc/api-param-types.ts`, extend the `PublishedBoardInfo` association-field comment
     and interface with `folderEditorMasks?: string[]` and `folderEditorPriority?: number`.
   - In `src/main/published-boards-service.ts`, extend `validateBoard` beside `folderMasks`:
     retain only string entries for `folderEditorMasks`, and retain `folderEditorPriority` only
     when it is a finite number. This is transport validation of remote input, not a trust gate;
     the installed manifest is normalized again by `getBoardEditorAssociation`.
   - In `src/renderer/api/published-boards.ts`, leave the file predicate's
     `fileMasks + folderMasks` behavior unchanged. Extend the catalog data-ingress/projection
     normalization so copied `folderEditorMasks` is carried as a separate normalized field using
     `normalizeFolderMasks` (and the copied priority uses the same finite-positive-to-zero rule
     as the installed manifest). Apply that normalization to both the initial catalog result and
     the update broadcast, without adding a direct-folder predicate,
     `catalogBoardsForFolder`, or a subscription. US-1432 owns the predicate and lookup shape
     once its folder-keyed catalog flow is implemented. The new axis must never be silently
     treated as the file predicate's narrowing `folderMasks`.
   - In `src/renderer/api/boards.ts`, copy both fields in the `PublishedBoardResult` mapping at
     the existing catalog-field boundary. Do not add installation, trust, auto-switch, or UI
     behavior.

4. **Update the renderer-facing declarations.**

   Add the two fields, with comments distinguishing direct folder claims from file-parent
   narrowing, to:

   - `src/renderer/api/types/boards.d.ts` (`PublishedBoardResult`),
   - `src/renderer/api/types/board-editor.d.ts` (`IBoardManifest`), and
   - `src/renderer/api/types/board-info-editor.d.ts` (`IBoardInfoCatalogMatch` and
     `IBoardInfoProperties`).

   These declarations describe the transport and future Board Info surface; they do not make
   Board Info consume the fields in US-1429.

5. **Verify the inert data layer by source inspection and focused object-model checks.**

   Check malformed/non-array/non-string/duplicate masks, separator normalization, folder-only
   association creation, `folderMasks`-only rejection, invalid priorities, catalog field copying,
   and public type parity. Check resolver behavior for ordinary folders, Git/Mneme folders,
   priorities `0`, `1`, `20`, and `21`, equal-priority ordering, and inclusion of losing boards in
   the candidate list. Check that untrusting a board changes the same trust-driven registry
   projection used by file resolution after `refresh()` completes, while the existing refresh
   window remains unchanged.

   This repository has no unit-test harness and no unit tests or test harnesses are proposed for
   this task. Do not wire the helpers into UI, Explorer navigation, lifecycle construction,
   folder links, persistence, Board Info matching, or installation as part of this verification.

## Concerns

- **Manifest compatibility:** `folderMasks` at
  [`board-manifest.ts:75-91`](../../../src/renderer/editors/board/board-manifest.ts:75) and
  [`board-manifest.ts:310-333`](../../../src/renderer/editors/board/board-manifest.ts:310)
  remains narrowing-only. A legacy file board carrying `folderMasks` must not become a folder
  board, and a folder-only board must not need fake `fileMasks` or `contentMasks`.
- **Priority ties:** built-ins win exact ties. The resolver compares against the actual matching
  built-in priority rather than hardcoding the current ids, while the candidate list still keeps
  every lower-priority board available for a later switch UI.
- **Virtual ids and trust:** `board-editor:<root>` embeds a machine-specific path. US-1429 only
  returns ids from the current trusted registry projection; validation at link/lifecycle
  construction belongs to US-1430. No direct manifest read or parallel trust cache is introduced.
- **Refresh timing:** `boardTrust.subscribePaths` invokes the existing asynchronous full rebuild,
  and `refreshGen` rejects out-of-order results. Folder resolution reads that same state and has
  the same brief stale-entry window as the file side; changing it would be a separate behavior,
  not a data-layer fix.
- **External catalog schema:** the publisher is outside this repository. Main-process validation
  must remain defensive, and renderer-side folder masks must be normalized before future matching.
  The catalog is not trusted merely because it carries an association.
- **Scope boundary:** this task must not make a folder board open, appear on a switch, or become
  installable. Those are US-1430, US-1431, and US-1432 respectively.

There are no unresolved open questions for this task after the EPIC-103 investigation and the
source checks above.

## Acceptance Criteria

- [x] `BoardManifest`, `BoardEditorAssociation`, `CustomEditorMatch`, and all listed public/catalog
      types carry `folderEditorMasks` and `folderEditorPriority` as a distinct axis.
- [x] Manifest normalization drops malformed folder-claim masks, normalizes valid folder globs,
      deduplicates them, and applies the identical `typeof number && Number.isFinite(...) &&
      value > 0 ? value : 0` priority expression used by `editorPriority`.
- [x] A folder-only board creates a trusted custom association; a `folderMasks`-only manifest
      still creates no association, and existing `fileMasks`/`folderMasks`/`contentMasks` behavior
      remains unchanged.
- [x] The same edit retracts the stale "fileMasks guaranteed non-empty", file-only association,
      and folder-mask gate comments in `board-manifest.ts`, plus the corresponding file-only
      `CustomEditorMatch` comments; they explain the folder-only exception without weakening the
      existing file-axis guarantees.
- [x] The catalog service safely transports the new fields, the renderer normalizes untrusted
      folder-claim masks and priority using the same rules as installed manifests, and
      `app.boards.searchPublished` plus the Board Info/catalog declarations preserve the fields
      through the existing round trip.
- [x] `resolveEditorIdForFolder` and `getFolderEditorsForFolder` are exported beside the custom
      registry, return only ids represented by current built-in definitions or current trusted
      entries, apply strict priority with built-ins winning ties, and include lower-priority
      matching boards in the candidate list. The candidate list preserves
      `editorRegistry.getFolderEditors(folderPath)` order and appends boards in trusted-list
      order; it is not priority-sorted.
- [x] A board at priority `1` can beat the category-view priority-0 floor; priority `20` does not
      beat Git Tree or Mneme at `20`; priority `21` can; equal-priority boards retain deterministic
      trusted-list order.
- [x] Trust refresh continues to use the existing `boardTrust` subscription and generation guard;
      revoking trust removes a board from the folder projection after refresh without inventing a
      second refresh or trust mechanism.
- [x] This task remains inert: no folder board opens, appears in an editor switch, is navigable
      through a folder link, persists a folder page, or becomes installable. Those outcomes remain
      explicitly deferred to US-1430/1431/1432.
- [x] No unit tests or test harnesses are added.

## Files verified and intentionally unchanged

- `src/renderer/editors/base/editorRegistry.ts` — built-in `resolveForFolder` and
  `getFolderEditors` remain pure built-in primitives; the merge stays beside the custom registry.
- `src/renderer/content/tree-providers/FileTreeProvider.ts` — its directory target still calls
  the built-in resolver until a later task wires the merged resolver into Explorer.
- `src/renderer/editors/base/editor-switch-options.ts`, `src/renderer/editors/base/editor-switch.ts`,
  `src/renderer/editors/base/PageToolbarView.ts`, and the Category/Git Tree/Mneme folder models —
  no switch consumer is added in an inert data-layer task.
- `src/renderer/content/folder-editor-link.ts`, `src/renderer/content/parsers.ts`,
  `src/renderer/content/open-handler.ts`, and `src/renderer/api/pages/PagesLifecycleModel.ts` —
  generic folder links and board construction belong to US-1430.
- `src/renderer/editors/board/BoardEditorModel.ts`, `BoardWebview.ts`,
  `src/ipc/board-bridge-channels.ts`, and `src/board-shim.ts` — no folder-board handshake is
  added here.
- `src/renderer/editors/board-info/BoardInfoEditorModel.ts` and `BoardInfoEditorView.ts` — no
  folder-keyed catalog matching or `+` installation flow is added here.
- `src/renderer/api/pages/PagesPersistenceModel.ts`, `PageModel.ts`, and board persistence state —
  no folder page is constructed or restored here.
- `src/renderer/api/types/io.link-data.d.ts`, app-side facades, authoring guides, and all unit-test
  or test-harness files — outside this task's data-layer scope.

## Files Changed

| File | Planned change |
|---|---|
| `src/renderer/editors/board/board-manifest.ts` | Add and normalize the distinct folder-editor manifest axis and association gate. |
| `src/renderer/editors/board/custom-editor-registry.ts` | Store trusted folder claims and expose merged folder resolution/candidate helpers. |
| `src/ipc/api-param-types.ts` | Carry folder-editor masks and priority in `PublishedBoardInfo`. |
| `src/main/published-boards-service.ts` | Defensively validate/copy the new remote catalog fields. |
| `src/renderer/api/published-boards.ts` | Normalize and carry the direct folder catalog fields without adding a consuming lookup. |
| `src/renderer/api/boards.ts` | Preserve the new fields in `searchPublished` results. |
| `src/renderer/api/types/boards.d.ts` | Declare folder claims on public published-board results. |
| `src/renderer/api/types/board-editor.d.ts` | Declare folder claims on `IBoardManifest`. |
| `src/renderer/api/types/board-info-editor.d.ts` | Declare folder claims on catalog and properties metadata. |
| `doc/active-work.md` | Link US-1429 under EPIC-103 → Active. |
| `doc/epics/EPIC-103.md` | Link the US-1429 row to this task document. |
| `doc/tasks/US-1429-folder-claims-in-manifest/README.md` | Record the source-verified implementation plan and inert acceptance boundary. |
