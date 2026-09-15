# EPIC-103 investigation notes — Boards as folder editors

> Written as the US-1428 investigation on 2026-09-15 and promoted unchanged (except this header
> and the `board-api.d.ts` correction below) to the epic's investigation record, because the
> evidence showed the work is epic-sized. The epic is [EPIC-103](EPIC-103.md); its task split is
> the one proposed in Concern 1 here. Section 8's verification list is the epic's parity checklist.
>
> **One correction to §4:** do **not** add `getFilePath()` / `getFolderPath()` declarations to
> `src/renderer/editors/board/board-api.d.ts`. That file is unwired — nothing references it and it
> is not loaded into Monaco's extraLibs — and by a standing user decision it is deliberately not
> kept in sync with the bridge surface, because boards are agent-authored and the prose guides are
> the canonical reference. The board-facing API documentation goes in `assets/board-template/CLAUDE.md`
> and `assets/guides/agents/boards.md` only.

**Status:** Investigation complete · **Epic:** [EPIC-103](EPIC-103.md) · Follows [EPIC-102](EPIC-102.md)

## Goal

This requested feature does not work after EPIC-102 for four structural reasons. `EditorRegistry.resolveForFolder`
and `getFolderEditors` iterate the built-in `definitions` map only. A board is a virtual
`board-editor:<root>` id held in `customEditorRegistry`, so it cannot win or share a folder;
the file path works only because `resolveEditorIdForFile` explicitly merges both registries.
`fileMasks`, `folderMasks`, and `contentMasks` do not claim a directory: each participates in
matching a file, and `folderMasks` only narrows a file mask to the file's parent folder.

A board also currently has a file-shaped construction contract. `BoardEditorModel.initFromBoardRoot`
receives a file path and the board bridge exposes it as `persephone.getFilePath()`; there is no
folder equivalent. Finally, both the switch and the catalog install entry are file-name keyed:
`getEditorSwitchOptions` derives a `fileName` from a host/model path or title, and
`publishedBoards.catalogBoardsForFile` filters by that name. A folder page either has no such name
(Git Tree keeps `repoRoot`, not `filePath`) or has a base64 `tree-category://` blob, so neither
path can match a folder association.

Investigate and, after approval, implement the complete contract for trusted boards to claim a
folder, receive its absolute path, appear in the folder editor switch, and make the `+` catalog
entry available for an uninstalled matching board. `.vscode` is the motivating example;
`.github`, `node_modules`, and a build-output directory are representative folder shapes only,
not board designs for this task.

## Background

EPIC-102 implemented folder acceptance for `category-view`, `git-tree`, and `mneme-root` through
`EditorMatcher.acceptFolder`, `EditorRegistry.resolveForFolder`, and
`EditorRegistry.getFolderEditors`. The current folder models expose a derived `folderAnchor`, and
the folder switch in `src/renderer/editors/base/editor-switch.ts` uses
`newEditorModelForFolder` before the old file-path fallback. Those methods currently inspect only
the built-in registry. The epic explicitly accepted boards as a later consumer and identified a
generic `folder-editor://` scheme as the likely link boundary: a board cannot own a scheme, so one
parser in `src/renderer/content/parsers.ts` must set `data.target` from the encoded editor id.

The existing file association is the precedent, but its semantics must not be overloaded:

- `src/renderer/editors/board/board-manifest.ts` normalizes `fileMasks`, `folderMasks`,
  `contentMasks`, and `editorPriority` into a `BoardEditorAssociation`.
- `src/renderer/editors/board/custom-editor-registry.ts` enumerates only trusted roots,
  rebuilds associations, and holds them in a reactive data structure separate from
  `src/renderer/editors/base/editorRegistry.ts`.
- `resolveEditorIdForFile` in `custom-editor-registry.ts` asks the built-in registry for its
  winner, scans trusted board matches, and lets a board win only on a strict priority increase.
  `customEditorRegistry.refresh` is already subscribed to `boardTrust`, so untrust removes a
  board association live after the refresh completes.
- `src/renderer/api/pages/PagesLifecycleModel.ts:117-165` has a special branch for
  `board-editor:<root>` because that id has no built-in definition. It constructs a
  `BoardEditorModel` (or `BoardContentEditorModel`) and calls `initFromBoardRoot(boardRoot,
  filePath)`.
- `src/renderer/editors/board/BoardWebview.ts:262-275` transfers `filePath` in
  `BoardPortInitMsg`; `src/board-shim.ts:1013-1037` implements the asynchronous
  `getFilePath()` handshake and non-local materialization.
- `src/renderer/api/pages/PagesPersistenceModel.ts:31-32,146-164` restores no-host editors by
  `editorId` and state assignment. `board-view` is already in `NO_HOST_EDITOR_IDS`, while
  `BoardEditorModel.getRestoreData()` deliberately persists the stable `board-view` id instead
  of the virtual id.
- `src/renderer/editors/board-info/BoardInfoEditorModel.ts:227-239,428-443` captures a file
  identity from its host/path and calls `catalogBoardsForFile`; its `switchFrom` has no folder
  identity to capture, which is the first failure in a folder `+` flow.

The leading link option is the generic scheme deferred by EPIC-102:

```text
folder-editor://base64({ editorId, anchorFolder })
```

It keeps editor ownership out of the parser. The parser validates and decodes the payload, sets
`data.target = editorId`, and leaves the encoded URL available to the folder construction path.
Known built-ins may continue using their existing `git-tree://`, `mneme-folder://`, and
`tree-category://` links; a virtual board target uses the generic scheme.

## Implementation Plan

### 1. Add a separate manifest axis for folder claims

Add `folderEditorMasks?: string[]` and `folderEditorPriority?: number` to
`BoardManifest` in `src/renderer/editors/board/board-manifest.ts`. Mirror them in
`IBoardManifest` (`src/renderer/api/types/board-editor.d.ts`) and in the catalog's
`PublishedBoardInfo` (`src/ipc/api-param-types.ts`). Do not reuse `folderMasks`: existing
manifests use it to narrow `fileMasks`, and changing its meaning would turn a currently inert
`folderMasks`-only manifest or a file-scoped board into a folder editor.

Use the existing folder-glob normalization and suffix matching rules, but document the different
input: `folderEditorMasks` matches the folder being opened, not a file's parent as a secondary
file gate. A bare `.vscode` therefore matches a folder with that basename at any depth; `**/build`
can scope a path shape. Non-string, empty, and malformed entries are dropped exactly like the
existing mask families.

Extend `BoardEditorAssociation` and `CustomEditorMatch` with normalized folder-editor masks and a
folder priority. `getBoardEditorAssociation` must register an association when at least one of
`fileMasks`, `contentMasks`, or `folderEditorMasks` is usable. Keep the existing rule that
`folderMasks` alone does not register a file association. A board with both axes gets both
behaviors; a folder-only board is valid. `editorKind: "content-host"` remains meaningful for the
file axis. Folder construction must use the no-content-host `BoardEditorModel` because a folder
has no text host to adopt; the board can still declare a content-host file editor for its other
association.

The priority rules should be explicit and deterministic:

- Built-in `category-view` is the priority-0 floor for every folder.
- Built-in `git-tree` and `mneme-root` are priority 20 when their existing gates match.
- `folderEditorPriority` defaults to 0. A board is eligible for the switch at any non-negative
  priority, but it becomes the Explorer's resolved editor only when its priority is strictly
  greater than the winning built-in priority: `> 0` for an ordinary folder and `> 20` for a
  recognized `.git` or `.mneme` folder. Equal priorities keep the built-in winner, matching the
  file resolver's built-in-tie rule.
- Among boards, the highest priority wins; equal-priority boards retain trusted-list order.
  `getFolderEditors` returns all applicable candidates in ascending priority with built-ins before
  equal-priority boards, so the floor remains the first switch option.

Before → after normalization shape:

```ts
// Before: folderMasks only narrows a file association.
interface BoardEditorAssociation {
    fileMasks: string[];
    folderMasks: string[];
    contentMasks: string[];
    editorPriority: number;
}

// After: a distinct folder-editor association can exist without fileMasks.
interface BoardEditorAssociation {
    fileMasks: string[];
    folderMasks: string[];             // still only narrows fileMasks
    contentMasks: string[];
    editorPriority: number;             // file resolution only
    folderEditorMasks: string[];        // folder resolution
    folderEditorPriority: number;      // folder resolution
}
```

Update `src/renderer/editors/board/custom-editor-registry.ts`'s refresh projection and add a
synchronous `getBoardsForFolder(folderPath)` that filters only trusted entries with matching
`folderEditorMasks`. Update `src/main/published-boards-service.ts` to validate/copy the new
catalog fields, and update `src/renderer/api/published-boards.ts` to reuse a folder-mask predicate
for catalog entries. The catalog publisher is outside this repository, but its copied schema must
be treated as untrusted input and normalized at the client.

### 2. Merge the two registries at the folder decision points

Keep `editorRegistry.definitions` and `customEditorRegistry.entries` as separate data structures.
Do not make the base registry import the custom registry: `custom-editor-registry.ts` already
imports `editorRegistry`, so that would create the same dependency cycle the existing file merge
avoids. Mirror `resolveEditorIdForFile` in
`src/renderer/editors/board/custom-editor-registry.ts` with merged folder functions, for example
`resolveEditorIdForFolder(folderPath)` and `getFolderEditorsForFolder(folderPath)`.

Each merged function should call the built-in `editorRegistry.resolveForFolder`/
`getFolderEditors` first, then scan `customEditorRegistry.getBoardsForFolder`. The default resolver
must compare the best board's `folderEditorPriority` with the actual winning built-in match's
`acceptFolder` priority and apply strict `>` semantics. The switch list must merge, deduplicate,
and sort built-in and board candidates without registering virtual ids in the built-in map.

Before → after call-site shape:

```ts
// Before: EPIC-102 only sees category-view/git-tree/mneme-root.
const target = editorRegistry.resolveForFolder(folderPath);
const options = editorRegistry.getFolderEditors(folderPath);

// After: the custom-registry layer merges trusted virtual board ids.
const target = resolveEditorIdForFolder(folderPath);
const options = getFolderEditorsForFolder(folderPath);
```

Use the merged helpers in `FileTreeProvider`'s directory target/navigation path, the three
existing folder models' `folderAnchor`/`findCompatibleEditors` calls, and folder switch code.
Their anchor verification must continue to prove that the physical path is accepted by the
editor, but it must not require a built-in editor to be the *winner*: a board allowed to outrank
Git should not make an already-open Git page lose its ability to switch to Folder View or the
board. For the current board model, the folder anchor remains available for leaving the page even
after trust is revoked; the board is not offered as a candidate to unrelated pages once refresh
drops its registry entry.

### 3. Route and construct a board from a folder link

Add a base64-of-JSON encoder/decoder and payload type to
`src/renderer/content/folder-editor-link.ts`. Preserve its existing mappings for the three
EPIC-102 editors and return the generic link for a virtual `board-editor:<root>` target. The
generic decoder must require non-empty string `editorId` and `anchorFolder`; it must not accept an
arbitrary malformed payload as a file path.

Add one `folder-editor://` parser to `src/renderer/content/parsers.ts`. It validates the payload,
sets `data.url = data.href`, sets `data.target = parsed.editorId`, and sets a transient
`data.folderPath = parsed.anchorFolder` before forwarding through the existing virtual-link
resolver/open handler. Add `folderPath` to the pipeline-only portion of
`src/renderer/api/types/io.link-data.d.ts` and strip it in `cleanForStorage`; the encoded link
itself remains the stable source identity. The parser is the only scheme registration needed for
boards. The layer-2 virtual placeholder must not become board content.

The current `openFile`/`buildEditorById` contract treats its argument as a file path, so extend it
with one explicit folder argument in `src/renderer/api/pages/PagesLifecycleModel.ts` and use that
same path from link opens and switches:

```ts
// Before: every target is built with a file-shaped argument.
private buildEditorById(editorId: string, filePath?: string): Promise<EditorOrHost>;

// After: a folder target carries an independent anchor and never populates filePath.
private buildEditorById(
    editorId: string,
    filePath?: string,
    folderPath?: string,
): Promise<EditorOrHost>;
```

Add `folderPath?: string` to the `openFile` options and `createEditorFromFile`'s internal target
path. The virtual-link `open-handler` passes the transient field through. When `folderPath` is
present, the board branch parses the virtual root from `editorId`, validates that the trusted
custom entry currently claims `folderPath`, constructs the plain `BoardEditorModel`, and calls a
dedicated initializer such as `initFromBoardRoot(boardRoot, undefined, folderPath)`. It must not
pass the `folder-editor://` blob to `initFromBoardRoot` as `filePath`, must not create/adopt a
text host, and must not select `BoardContentEditorModel` for folder mode. Dispose the layer-2
placeholder pipe without assigning it to the folder board. The existing file branch remains
unchanged for `initFromBoardRoot(boardRoot, filePath)` and content-host boards.

Expose a small `createEditorFromFolder(editorId, folderPath)` lifecycle helper that calls the same
`buildEditorById(editorId, undefined, folderPath)` and restores the model. The folder branch of
`src/renderer/editors/base/editor-switch.ts` calls this helper for virtual boards, while continuing
to use `newEditorModelForFolder` for built-in modules. This settles construction ownership without
making `EditorRegistry` pretend that a virtual board has a built-in module.

Use the same folder factory contract for built-ins and boards. Built-ins can continue using
`EditorModule.newEditorModelForFolder(anchorFolder)`. A virtual board has no `EditorModule` in
the built-in registry, so the centralized lifecycle helper must construct it from
`parseBoardEditorId` and the board root. The folder link open path and the folder switch path must
share this construction code, including trust/claim validation and restore.

In `BoardEditorModel.ts`, add a `folderPath?: string` state field and a `folderPath` getter (the
board's claimed folder, distinct from its installed `boardRoot`). Change the dynamic `editorId`
condition so a board with a folder path uses `board-editor:<root>` while mounted; retain the
stable `board-view` persistence id. Keep `currentFilePath()` and `getFilePath()` file-only.

### 4. Deliver the folder path through the board bridge

Add `folderPath?: string` to `BoardPortInitMsg` in `src/ipc/board-bridge-channels.ts` and pass it
from `BoardWebview.transferPort`. Extend `src/board-shim.ts`'s handshake state with a separate
settled `folderPath` value and expose:

```ts
persephone.getFolderPath(): Promise<string | undefined>;
```

It should wait for the same handshake, resolve to the exact absolute claimed folder for a folder
board, and resolve `undefined` for a plain board or a file-only board. It must not widen
`getFilePath()` to sometimes return a directory; that would break existing simple boards and make
the API's name false. The board may use the returned absolute path with its existing file/command
APIs, subject to the same trust model as the rest of the board bridge.

`src/renderer/editors/board/board-api.d.ts` is explicitly a legacy/incomplete board IntelliSense
snapshot and currently omits even the implemented `getFilePath()`. Add declarations for both
`getFilePath()` and `getFolderPath()` while keeping their semantics explicit. Update the maintained
authoring references in `assets/board-template/CLAUDE.md` and `assets/guides/agents/boards.md`, and
the user-facing `assets/guides/boards.md`, with the new manifest example and the distinction
between the installed board root and the claimed folder. Do not design a particular `.vscode`,
`.github`, `node_modules`, or build-output board in these guides.

For the app-side automation surface, add the optional claimed `folderPath` to
`src/renderer/api/types/board-editor.d.ts`, expose it in `src/renderer/scripting/api-wrapper/BoardEditorFacade.ts`,
and include it in the board summary/member help if the facade is kept symmetric with
`boardRoot`. `BoardEditorFacade.copyManifest` must also copy the new manifest fields so the
typed `getManifest()` result is not silently incomplete. This is diagnostic metadata for
`pages[i].editor`; it is not a replacement for the iframe's `window.persephone.getFolderPath()`
API.

### 5. Make the folder switch include boards in both directions

Update `src/renderer/editors/base/editor-switch-options.ts` with a folder-first branch. Derive a
folder identity from a concrete folder model's `folderAnchor`, a folder board's `folderPath`, or
the Board Info model's captured folder path. When present, use the merged folder candidates and do
not use the host/model `fileName`, title, `tree-category://` blob, content detection, or
`catalogBoardsForFile` for that page.

The result should merge:

1. `model.findCompatibleEditors()` (the current editor's folder peers, including a current
   untrusted board only as the exit/current option needed to keep its toolbar usable);
2. trusted merged folder-board candidates from `customEditorRegistry`; and
3. the catalog-only `BOARD_INFO_EDITOR_ID` when an uninstalled or untrusted published folder
   board matches.

Keep catalog `+` last and label it with folder wording, such as “Install an editor for this
folder…”. Update `getEditorSwitchFileName`'s role or add a parallel
`getEditorSwitchFolderPath` helper so `PageToolbarView` can subscribe to the correct identity.
`SwitchWidgetView` currently watches `state.filePath` and
`publishedBoards.subscribeCatalogBoardsForFile`; add the folder projection/subscription and keep
the existing file path branch unchanged.

`src/renderer/editors/base/editor-switch.ts` already has a folder-to-folder branch for EPIC-102
and a later board/file branch. Extend the folder branch to recognize a virtual board id from the
merged registry and to obtain the anchor from `BoardEditorModel.folderPath`. Keep this branch
separate from the existing file board branch: the latter intentionally transfers a content host
or extracts a file path, while folder boards have neither. A valid folder switch must construct
the target with the folder factory/board branch and never call `rebuildEditorOverFile`,
`switchFrom`, or the file board branch with a directory encoded as `filePath`.

The branch must handle all transitions: Folder View → board, built-in folder editor → board,
board → Folder View, and board → another matching board. If the board was untrusted after the page
was opened, it may remain the current restricted editor and must still be able to switch away;
new board candidates and default folder resolution must disappear after
`customEditorRegistry.refresh`.

### 6. Make the catalog `+` flow folder-keyed

Add `catalogBoardsForFolder(folderPath)` and
`subscribeCatalogBoardsForFolder(folderPath, listener)` to `src/renderer/api/published-boards.ts`.
They must match the catalog's normalized `folderEditorMasks`, check `minAppVersion`, and not
require a downloaded board. The existing file lookup remains file-only and continues honoring
`fileMasks` plus the legacy narrowing `folderMasks`.

Update `BoardInfoEditorModel` so its state can retain `folderPath` independently of `filePath`:

- `switchFrom` captures a folder identity from the outgoing folder editor/board instead of only
  calling `oldEditor.filePath`.
- `currentFileName` and `recomputeMatches` become a file-versus-folder dispatch; a folder page
  calls `catalogBoardsForFolder`.
- `findCompatibleEditors` returns merged folder peers plus `BOARD_INFO_EDITOR_ID` in folder mode.
- `register` preserves the folder context when it switches to the newly trusted
  `board-editor:<root>`; it must not fall into the standalone properties branch merely because
  there is no content host.
- `openBoard`, auto-switch, and the catalog subscription use the same folder context. A folder
  Board Info page must be able to switch back to Folder View if registration is cancelled or the
  installed board becomes unavailable.

Update `BoardInfoEditorView`'s catalog/property metadata to show folder-editor masks separately
from the existing “file masks in folder masks” display. Update the catalog transport validation in
`src/main/published-boards-service.ts` and its source type in `src/ipc/api-param-types.ts`; the
remote catalog is the source for the install tile, while the installed manifest remains the
source of truth after registration.

### 7. Persist and restore the folder-board page

Persist `boardRoot` and the claimed `folderPath` in `BoardEditorState`. `folderPath` is not the
board's own install root and must not be inferred from `boardRoot`; the two paths are independent.
`BoardEditorModel.getRestoreData()` should continue to pin `editorId: "board-view"`, so no dynamic
`board-editor:<root>` id is placed in the page descriptor. On restore, the existing
`NO_HOST_EDITOR_IDS` entry for `board-view` and `Object.assign` path are sufficient to reconstruct
the board state, after which `restore()` revalidates the board and trust.

Do not add a virtual board id to `NO_HOST_EDITOR_IDS`; it is machine/path dependent and already
has the stable-id solution. Do not add a new common `IEditorState` field or a migration unless the
actual persistence typing rejects the board-specific state field. A missing claimed folder should
produce an unavailable folder candidate and a usable board/not-found or restricted state, not a
file-path fallback. A board that is untrusted after restart must not re-enter folder resolution,
but it must retain enough folder identity to leave its current page.

Check panel/page lifecycle behavior against `PagesPersistenceModel`, `PageModel.setMainEditor`,
and the EPIC-102 duplicate-panel fix. Folder boards have no content host and no folder-specific
secondary panel requirement; they should not be stranded as a second main/side instance during a
round trip. Existing `board-view` restore, busy-board handling, and file-board restoration must
remain unchanged.

### 8. Verify by source inspection and live application behavior

This project has no unit-test harness and no unit tests are proposed. Verification is limited to
source inspection, the existing object-model checks, and a live window:

- a trusted board with `folderEditorMasks: [".vscode"]` appears beside Folder View on that folder;
- a board at priority 1 wins an ordinary folder (priority 0), while a board at priority 20 does
  not displace Git/Mneme (priority 20), and priority 21 does;
- file boards carrying existing `fileMasks` + `folderMasks` behave exactly as before, and
  `folderMasks` alone still does not claim a folder;
- the Explorer target opens a board through `folder-editor://`, and the board receives
  `getFolderPath()` while `getFilePath()` remains `undefined`;
- Folder View, Git Tree, and Mneme switch to and from a folder board without invoking the file
  path branch, losing the Explorer panel, or accumulating duplicate panels;
- an untrusted board is absent from folder resolution and switch options on other pages, and
  revoking trust live removes it after `customEditorRegistry.refresh`; a currently shown board
  remains able to leave its page;
- catalog `+` appears only when an eligible published folder board is not already trusted for the
  folder, and Download → Register preserves the folder path and switches into the installed board;
- cancelling registration, an incompatible catalog version, missing folder, and a malformed link
  leave the page usable;
- restart restores `board-view` with `boardRoot` + `folderPath`, and a missing/untrusted claim
  degrades without a dynamic-id restore error; and
- the board-side typings, author guides, app-side facade, and catalog metadata describe the same
  two-path contract.

## Concerns

1. **This is epic-sized, not an ordinary implementation task.** The evidence spans manifest
   parsing and catalog transport, two registry merge points, a new content-link parser and
   lifecycle construction path, board renderer/shim/IPC typing, switch topology, Board Info
   installation, trust invalidation, persistence, and three authoring guides. Splitting it would
   reduce risk and make live verification meaningful:

   - folder manifest schema, normalization, catalog transport, and trusted merged resolution;
   - board folder construction, `getFolderPath()` bridge, facade/types, and authoring docs;
   - generic folder links plus folder switch and persistence/restore;
   - folder catalog lookup, Board Info `+` flow, and install/register lifecycle.

   The current US-1428 document can remain the investigation parent if this is promoted to an
   epic. It should not be padded into one code task merely to keep the ID singular.

2. **A distinct field is required for backwards compatibility.** Reusing `folderMasks` would
   break its documented narrowing-only semantics. `folderEditorMasks` is intentionally verbose,
   but makes a manifest with both file and folder associations unambiguous. A folder-only board
   also means `getBoardEditorAssociation` can no longer use “has file/content masks” as its only
   registration gate.

3. **Board ids are virtual and machine-specific.** The generic link must carry both the target id
   and anchor, while restore must continue using `board-view`. Every caller must validate the
   decoded target against the current trusted registry; otherwise a stale or hand-written link
   could construct a board that is not a current folder candidate. The normal board trust UI may
   still render an already-open untrusted board, but trust must gate all candidate resolution and
   board execution as it does today.

4. **Folder mode cannot reuse content-host mode accidentally.** `editorKind` describes file
   content ownership. A folder board has no `IContentHost`, so selecting `BoardContentEditorModel`
   would recreate the same `switchFrom`/host assumptions that currently fail for no-host folder
   editors. The implementation should share iframe/trust code through `BoardEditorModel` and use
   `BoardContentEditorModel` only for file-associated opens.

5. **Board Info is the fragile boundary.** Its existing no-host fallback captures only
   `oldEditor.filePath`, so a folder `+` click currently loses the only folder identity before
   catalog matching. The folder path must be copied before replacing the old editor and retained
   through Download → Register → switch. The title is presentation only and must never substitute
   for the absolute anchor.

6. **Trust refresh is asynchronous and live.** `boardTrust` notification already drives
   `customEditorRegistry.refresh` for files, but folder UI must subscribe to the same reactive
   state and tolerate the short refresh window. Resolution must never read a manifest directly
   from an untrusted root merely because a stale page or catalog entry names it.

7. **The generic parser must not turn a directory into a fake file.** Existing virtual links use
   a placeholder pipe because their models decode their own known schemes. This design uses the
   explicit folder lifecycle argument: the parser puts the decoded anchor in transient
   `ILinkData.folderPath`, `open-handler` passes it through, and the board branch leaves
   `filePath` unset and disposes the placeholder pipe. This is a construction invariant, not a
   cosmetic detail: `getFilePath()` and file-board switching must remain correct.

8. **Catalog semantics differ from installed trust semantics.** A published board may be shown as
   an install candidate before download or trust, while only the trusted installed association
   may participate in folder resolution. Installed/trusted deduplication must use the existing
   normalized install root rules and must not hide a catalog tile merely because an unrelated
   board has the same display name.

## Acceptance Criteria

- A board can declare a folder association with `folderEditorMasks` without changing the meaning
  of existing `fileMasks` + `folderMasks` or `contentMasks` manifests; folder-only associations
  are normalized and registered.
- The merged folder resolver keeps built-in and custom registries separate, uses strict priority
  comparison, and makes a board exceed priority 0 for ordinary folders or priority 20 to displace
  Git/Mneme. Its switch list includes all trusted matching candidates in deterministic order.
- Explorer folder resolution can emit a generic `folder-editor://` link for a virtual board id,
  and exactly one parser routes it by setting `data.target` to the encoded id.
- A folder board is built with its installed `boardRoot` and claimed `folderPath`, has no file
  content host, and never sends the folder link blob through `getFilePath()` or the file switch
  branch.
- `persephone.getFolderPath()` is available to board code as an asynchronous handshake API;
  `getFilePath()` remains file-only. The bridge channels, app-side typings/facade, and authoring
  guides document both paths.
- A folder page's toolbar lists the board and Folder View peers, can switch in both directions,
  and offers `BOARD_INFO_EDITOR_ID` only when the folder-keyed catalog has an eligible board.
- Board Info retains the folder path through `+`, catalog installation, trust registration, and
  the switch into the newly installed board; the existing file `+` flow is unchanged.
- Revoking trust removes a board from live folder resolution, switch candidates, and catalog
  deduplication after refresh, while an already-open board remains restricted but can leave its
  page.
- A folder-board descriptor restores through the existing stable `board-view` no-host path with
  `boardRoot` and `folderPath`; no virtual id is added to `NO_HOST_EDITOR_IDS` and no migration is
  needed unless source typing proves otherwise.
- Verification uses source inspection/object-model checks and a live window only. No unit tests or
  test harnesses are proposed.

## Files Changed

| File | Planned change |
|---|---|
| `src/renderer/editors/board/board-manifest.ts` | Add and normalize the distinct folder-editor manifest axis and association priority. |
| `src/renderer/api/types/board-editor.d.ts` | Mirror manifest fields and optional claimed folder metadata for the app-side board facade. |
| `src/renderer/editors/board/custom-editor-registry.ts` | Store trusted folder claims, expose folder matches, and merge custom/built-in folder resolution. |
| `src/renderer/editors/base/editor-switch-options.ts` | Add folder identity/options and folder catalog subscription path. |
| `src/renderer/editors/base/editor-switch.ts` | Switch virtual folder boards through folder construction, separate from file-board switching. |
| `src/renderer/editors/base/PageToolbarView.ts` | Track folder identity and folder catalog updates in the existing switch widget. |
| `src/renderer/editors/category/CategoryEditorModel.ts` | Use merged folder candidates/anchor verification when a board outranks a built-in. |
| `src/renderer/editors/git-tree/GitTreeEditorModel.ts` | Use merged folder candidates/anchor verification. |
| `src/renderer/editors/mneme-root/MnemeRootEditorModel.ts` | Use merged folder candidates/anchor verification. |
| `src/renderer/content/folder-editor-link.ts` | Encode/decode generic `folder-editor://` links and map board targets. |
| `src/renderer/content/parsers.ts` | Register the single generic folder-editor parser. |
| `src/renderer/content/open-handler.ts` | Pass the transient decoded folder path through to the lifecycle open path. |
| `src/renderer/api/pages/PagesLifecycleModel.ts` | Build folder boards with an anchor separate from `filePath`; share the path with folder switches. |
| `src/renderer/editors/board/BoardEditorModel.ts` | Persist folder context, expose it to the view/bridge, and retain stable restore identity. |
| `src/renderer/editors/board/BoardWebview.ts` | Include the claimed folder in the board handshake. |
| `src/ipc/board-bridge-channels.ts` | Type the folder handshake payload. |
| `src/board-shim.ts` | Implement `persephone.getFolderPath()`. |
| `src/renderer/scripting/api-wrapper/BoardEditorFacade.ts` | Expose claimed folder metadata for app-side automation diagnostics. |
| `src/renderer/api/published-boards.ts` | Add folder-keyed catalog lookup/subscription. |
| `src/ipc/api-param-types.ts` | Carry folder-editor catalog fields. |
| `src/main/published-boards-service.ts` | Validate/copy folder-editor catalog fields from published data. |
| `src/renderer/editors/board-info/BoardInfoEditorModel.ts` | Retain folder identity and install/register a folder board. |
| `src/renderer/editors/board-info/BoardInfoEditorView.ts` | Display folder claims separately from file scope. |
| `assets/board-template/CLAUDE.md` | Document folder claims and `getFolderPath()` for board authors. |
| `assets/guides/agents/boards.md` | Update the maintained agent-facing board authoring reference. |
| `assets/guides/boards.md` | Update the user-facing board manifest/API reference. |
| `doc/active-work.md` | Add US-1428 under Planned → `*(no epic)*`. |

### Files verified and intentionally unchanged

- `src/renderer/api/pages/PagesPersistenceModel.ts` and its existing `NO_HOST_EDITOR_IDS` entry
  for `board-view` — stable board restore already uses state assignment; no virtual board id is
  added and no migration is indicated.
- `src/renderer/api/pages/PageModel.ts` — its switch delegate remains the shared entry point; no
  second page-switch API is needed.
- `src/renderer/editors/base/editorRegistry.ts` — its built-in `resolveForFolder` and
  `getFolderEditors` remain pure built-in primitives; the custom merge belongs beside the custom
  registry to avoid a dependency cycle.
- `src/renderer/editors/board/BoardContentEditorModel.ts` and
  `src/renderer/editors/board/index.ts` — folder mode always constructs the existing plain
  `BoardEditorModel`; the content-host subclass and board module's existing `createEditor` are
  reused without a folder-specific module registration.
- `src/renderer/api/board-trust.ts` — the existing
  trust subscription and persistence are reused; no trust flag is added to the manifest.
- `src/renderer/content/git-tree-link.ts`, `src/renderer/content/mneme-folder-link.ts`, and
  `src/renderer/content/tree-providers/tree-provider-link.ts` — existing built-in link payloads
  remain valid; the generic scheme is added for virtual board targets.
- `src/renderer/scripting/ai-vision/page-editor-switches.ts` and the existing page switch API —
  they consume the shared option/switch helpers and need no folder-specific enumeration.
- Any unit-test or test-harness files — this project uses none and none is proposed.
