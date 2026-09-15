# US-1430 — Constructing a folder board: generic link, lifecycle path, and `getFolderPath()`

**Status:** Active · **Epic:** [EPIC-103](../../epics/EPIC-103.md)

## Goal

Make a trusted board folder claimant openable from Explorer through one generic
`folder-editor://` link, construct it with its claimed folder rather than a file-shaped
argument, and expose that claimed folder to the board as `persephone.getFolderPath()`.
Preserve the existing three built-in folder schemes and every existing file-associated board
path; the folder switch, persistence/restore, and catalog install flow remain later tasks.

## Background

EPIC-103 decisions D4, D5, and D6 define this task. US-1429 already added the distinct
`folderEditorMasks`/`folderEditorPriority` axis, trusted folder matching, and the merged folder
resolvers; this task gives those inert exports their first opening consumer. The source confirms
that `CustomEditorMatch` carries normalized direct-folder claims
([`custom-editor-registry.ts:55-75`](../../../src/renderer/editors/board/custom-editor-registry.ts:55)),
trusted refresh projects them into the current registry
([`custom-editor-registry.ts:115-145`](../../../src/renderer/editors/board/custom-editor-registry.ts:115)),
and the merged resolver/candidate list are exported at
[`custom-editor-registry.ts:247-268`](../../../src/renderer/editors/board/custom-editor-registry.ts:247).

### Existing folder resolution and link boundary

EPIC-102 made `category-view` the priority-0 folder floor and gives Git Tree and Mneme priority
20 through `acceptFolder` ([`editorRegistry.ts:147-171`](../../../src/renderer/editors/base/editorRegistry.ts:147),
[`editor-matchers.ts:150-160`](../../../src/renderer/editors/base/editor-matchers.ts:150)). The
custom merge deliberately lives beside the built-in registry, not inside it. That is why
`FileTreeProvider` must move from the built-in-only call at
[`FileTreeProvider.ts:61-71`](../../../src/renderer/content/tree-providers/FileTreeProvider.ts:61)
to `resolveEditorIdForFolder`; otherwise a matching board can never become the row target.

`FileTreeProvider.getNavigationUrl` already centralizes folder-link creation
([`FileTreeProvider.ts:130-133`](../../../src/renderer/content/tree-providers/FileTreeProvider.ts:130)).
The current helper preserves the three existing mappings—Git Tree, Mneme, and category view—but
falls back to a category link for every other id
([`folder-editor-link.ts:1-15`](../../../src/renderer/content/folder-editor-link.ts:1)). The
generic mapping must therefore be added only for a virtual `board-editor:<boardRoot>` id. The
existing schemes remain unchanged: Git Tree encodes `{ repoRoot }`
([`git-tree-link.ts:14-28`](../../../src/renderer/content/git-tree-link.ts:14)), Mneme encodes
`{ rootFolder }` ([`mneme-folder-link.ts:18-34`](../../../src/renderer/content/mneme-folder-link.ts:18)),
and category links encode `{ type, url, category }`
([`tree-provider-link.ts:17-43`](../../../src/renderer/content/tree-providers/tree-provider-link.ts:17)).

### Content pipeline behavior to preserve

Layer 1 parsers set `data.url` and route through `openLink`; the existing built-in folder parsers
set the target and forward the same object
([`parsers.ts:114-147`](../../../src/renderer/content/parsers.ts:114)). Layer 2's file resolver
creates a placeholder file pipe for virtual schemes and forwards it to Layer 3
([`resolvers.ts:129-163`](../../../src/renderer/content/resolvers.ts:129)). This is sufficient
for routing, but a folder board must not treat that placeholder URL as a file: the new parser
will add a transient `folderPath`, and the open handler will pass that field to the lifecycle
path while the folder branch disposes/ignores the placeholder pipe.

`cleanForStorage` currently removes pipeline-only fields by destructuring them before retaining
the link identity ([`link-data.ts:51-75`](../../../src/shared/link-data.ts:51)). The new
`folderPath` field must be included in that removal list, so the encoded source link—not a
machine-specific transient field—is the persisted identity.

### Current board construction is file-shaped

`PagesLifecycleModel.buildEditorById` detects a virtual board id, looks up the current entry only
to choose `BoardContentEditorModel`, and then calls `initFromBoardRoot(boardRoot, filePath)`
([`PagesLifecycleModel.ts:101-165`](../../../src/renderer/api/pages/PagesLifecycleModel.ts:101)).
The file-open factory always requires a `filePath` today
([`PagesLifecycleModel.ts:169-205`](../../../src/renderer/api/pages/PagesLifecycleModel.ts:169));
`openFile` likewise returns immediately when it has no file path and passes only file-shaped
options to the factory ([`PagesLifecycleModel.ts:356-390`](../../../src/renderer/api/pages/PagesLifecycleModel.ts:356)).
Navigation has the same file-shaped option and calls `createEditorFromFile`
([`PageNavigator.ts:30-41`](../../../src/renderer/api/pages/PageNavigator.ts:30),
[`PageNavigator.ts:132-165`](../../../src/renderer/api/pages/PageNavigator.ts:132)).

The board state currently has an installed `boardRoot` and an optional file association
`filePath`, but no claimed folder ([`BoardEditorModel.ts:50-99`](../../../src/renderer/editors/board/BoardEditorModel.ts:50)).
Its dynamic id is virtual only when `currentFilePath()` is present
([`BoardEditorModel.ts:142-150`](../../../src/renderer/editors/board/BoardEditorModel.ts:142),
[`BoardEditorModel.ts:440-509`](../../../src/renderer/editors/board/BoardEditorModel.ts:440));
folder mode must extend that condition without changing `currentFilePath()` or the file getter.
The existing initializer is also file-shaped
([`BoardEditorModel.ts:564-579`](../../../src/renderer/editors/board/BoardEditorModel.ts:564)).

Per D6, the folder branch must always use the plain `BoardEditorModel`. The current content-host
selection is explicit at [`PagesLifecycleModel.ts:127-146`](../../../src/renderer/api/pages/PagesLifecycleModel.ts:127),
so a folder argument must branch before it and never adopt a text host. A board can still retain
`editorKind: "content-host"` for its file axis; the folder axis does not reinterpret that field.

### Board root versus claimed folder

`boardRoot` is the board's own install folder: it is where the board manifest and web app are
loaded. The board handshake currently sends only `currentFilePath()` as `filePath`
([`BoardWebview.ts:262-275`](../../../src/renderer/editors/board/BoardWebview.ts:262)); the wire
type documents that value as the file a custom-editor board edits
([`board-bridge-channels.ts:219-240`](../../../src/ipc/board-bridge-channels.ts:219)). A folder
claim is a different absolute directory being viewed by the board. It must be sent as a separate
field and must never be inferred from or substituted for `boardRoot`.

The shim currently settles the handshake through `filePathSettled`, and `getFilePath()` returns
the file value or a materialized local cache path
([`board-shim.ts:133-164`](../../../src/board-shim.ts:133),
[`board-shim.ts:1013-1037`](../../../src/board-shim.ts:1013)). `getFolderPath()` will use the
same handshake gate but a separate settled folder value, returning the exact claimed folder for
folder boards and `undefined` for plain/file-only boards. It must not widen `getFilePath()` to
return a directory.

The app-side automation facade is a separate diagnostic surface. It currently exposes
`boardRoot`, copies manifest fields in `copyManifest`, and lists/summarizes board members
([`BoardEditorFacade.ts:54-67`](../../../src/renderer/scripting/api-wrapper/BoardEditorFacade.ts:54),
[`BoardEditorFacade.ts:148-158`](../../../src/renderer/scripting/api-wrapper/BoardEditorFacade.ts:148),
[`BoardEditorFacade.ts:258-275`](../../../src/renderer/scripting/api-wrapper/BoardEditorFacade.ts:258)).
US-1430 should expose the optional claimed `folderPath` there and copy the already-transported
folder manifest fields, with the checked-in `assets/editor-types/` mirror kept in sync. The
iframe API documentation belongs in prose guides per D7; `src/renderer/editors/board/board-api.d.ts`
is explicitly out of scope.

## Implementation Plan

### 1. Emit and parse one generic folder-editor link

1. In `src/renderer/content/folder-editor-link.ts`, add a `FOLDER_EDITOR_PREFIX`, a payload type
   containing non-empty string `editorId` and `anchorFolder`, and `encodeFolderEditorLink` /
   `decodeFolderEditorLink` using the existing base64-of-JSON shape. The generic encoder/decoder
   must UTF-8 encode/decode the JSON bytes before/after `btoa`/`atob`; unlike the three legacy
   schemes, it must round-trip non-Latin-1 Windows paths such as `C:\\проекты\\x`. The decoder
   must reject a wrong prefix, invalid base64/UTF-8/JSON, non-object payloads, empty/non-string
   fields, and return `null`; it must not turn malformed data into a file path.
2. Update `folderEditorLinkFor(editorId, anchorFolder, sourceUrl)` so `git-tree`, `mneme-root`,
   and the category fallback produce exactly their current links. When `editorId` parses as a
   virtual `board-editor:<boardRoot>` via `parseBoardEditorId`, return
   `folder-editor://base64({ editorId, anchorFolder })`. Do not create board-owned schemes.
3. In `src/renderer/content/tree-providers/FileTreeProvider.ts`, import and call
   `resolveEditorIdForFolder(fullPath)` in `list()`, leaving the existing built-in-only Explorer
   row icon lookup unchanged. For a virtual board id, `getById(target)` is undefined, so the
   claimed row intentionally renders the default folder icon in US-1430; the board view's own
   icon is a different surface and does not compensate. If a board icon should also appear on the
   Explorer row, US-1431 must wire the already-available board icon/manifest metadata; do not
   imply that US-1430 handles it. This is the first consumer of US-1429's merged folder resolver.
   Its navigation URL then reaches the generic encoder through the existing `getNavigationUrl`
   call.
4. In `src/renderer/content/parsers.ts`, register exactly one `folder-editor://` Layer 1
   parser. Decode and validate the payload; on success set `data.url = data.href`,
   `data.target = parsed.editorId`, `data.folderPath = parsed.anchorFolder`, and forward to
   `openLink`. On invalid input, notify/mark the event handled so the file fallback cannot create
   a board or fake file. The existing `tree-category://`, `git-tree://`, and
   `mneme-folder://` handlers remain unchanged.

Before → after link construction:

```ts
// Before: every non-built-in target became a category-view link.
return encodeCategoryLink({ type: "file", url: sourceUrl, category: anchorFolder });

// After: only a virtual trusted-board target uses the generic scheme.
if (parseBoardEditorId(editorId) !== null) {
    return encodeFolderEditorLink(editorId, anchorFolder); // UTF-8-safe base64 JSON
}
return encodeCategoryLink({ type: "file", url: sourceUrl, category: anchorFolder });
```

### 2. Carry the folder identity through the existing pipeline

1. Add `folderPath?: string` to the pipeline-only portion of
   `src/renderer/api/types/io.link-data.d.ts`; it is decoded for one open attempt and is not a
   persisted link field. Update `assets/editor-types/io.link-data.d.ts` to match the generated
   Monaco IntelliSense copy.
2. Add `folderPath` to the destructured ephemeral fields in `src/shared/link-data.ts` so
   `cleanForStorage(data)` retains the generic encoded `href`/`url` identity but never persists
   the decoded absolute folder separately.
3. In `src/renderer/content/open-handler.ts`, pass `folderPath` through both
   `navigatePageTo` and `openFile` options. Keep the existing pipe reconstruction and
   `sourceLink = cleanForStorage(data)`; when the lifecycle sees `folderPath`, the placeholder
   virtual pipe is not assigned as board content and is disposed on success/error exactly once.
4. Extend `NavigatePageToOptions` and the `PageNavigator` build call so the folder field reaches
   `PagesLifecycleModel.createEditorFromFolder`/the folder-aware `createEditorFromFile` path.
   The existing file path, dedupe, preview, and host-transfer behavior remains unchanged when
   `folderPath` is absent.

Before → after lifecycle option shape:

```ts
// Before
openFile(filePath, pipe, { sourceLink, target });

// After
openFile(filePath, pipe, { sourceLink, target, folderPath });
// folderPath is transient; filePath is ignored by the folder-board branch.
```

### 3. Add a trusted folder construction path

1. In `src/renderer/api/pages/PagesLifecycleModel.ts`, extend `buildEditorById` with an explicit
   `folderPath?: string` argument and extend `openFile`/its options accordingly. Add a public
   `createEditorFromFolder(editorId, folderPath)` helper that calls the same builder with no
   file path and restores the returned model; this is the lifecycle seam US-1431 will use for
   folder switches.
2. At the virtual-board folder branch, validate every decoded `board-editor:<root>` id against
   the current trusted registry before constructing anything. Require an exact current entry
   whose `editorId` matches and whose `getBoardsForFolder(folderPath)` result contains it.
   Reject/notify a stale, hand-written, untrusted, or no-longer-claiming folder link; never fall
   through to a text editor and never read a manifest directly from the encoded root. Scope this
   validation to folder mode: the existing file-mode branch keeps its current behavior when an
   explicit virtual target is no longer in `customEditorRegistry.entries`, so a stale persisted
   file target is not turned into a no-op. If that file target is later refactored, its failure
   behavior must degrade to normal file resolution rather than silently refusing to open the file.
3. When `folderPath` is present, construct the plain `BoardEditorModel` through a named folder
   factory in `src/renderer/editors/board/index.ts` (for example,
   `createBoardEditorForFolder(boardRoot, folderPath)`). That factory calls
   `initFromBoardRoot(boardRoot, undefined, folderPath)` and never selects
   `BoardContentEditorModel`, regardless of `editorKind`. Dispose the placeholder pipe rather
   than assigning it to `model.pipe` or adopting it as a content host.
4. Keep the existing file branch semantically identical:
   `initFromBoardRoot(boardRoot, filePath)` remains the simple-board path, while a valid
   `editorKind: "content-host"` file association still constructs
   `BoardContentEditorModel` and adopts the file host.
5. In `src/renderer/editors/board/BoardEditorModel.ts`, add optional persisted-shape field
   `folderPath` with the meaning “claimed folder, not installed board root”; expose a
   `folderPath` getter; and change `editorId` to use `board-editor:<root>` while either a file
   path or folder path is active, otherwise retaining `board-view`. Extend
   `initFromBoardRoot(boardRoot, filePath?, folderPath?)` so the two paths are assigned
   independently and the folder mode never populates `state.filePath`.
6. Keep `currentFilePath()` and the `filePath` getter file-only. A folder board must report no
   file path to its bridge, and `editorKind: "content-host"` on its file axis must not create a
   text host in folder mode. Keep `getRestoreData()`'s stable `board-view` id unchanged; the
   actual folder persistence/restore behavior is US-1431, which will persist this new state
   field and revalidate it on restore.

Before → after construction signatures:

```ts
// Before: a virtual board always receives a file-shaped second argument.
private buildEditorById(editorId: string, filePath?: string): Promise<EditorOrHost>;
model.initFromBoardRoot(boardRoot, filePath);

// After: the folder anchor is independent and folder mode has no host.
private buildEditorById(
    editorId: string,
    filePath?: string,
    folderPath?: string,
): Promise<EditorOrHost>;
model.initFromBoardRoot(boardRoot, undefined, folderPath);
```

### 4. Add the separate board bridge path

1. Add `folderPath?: string` to `BoardPortInitMsg` in
   `src/ipc/board-bridge-channels.ts`, documenting it as the absolute claimed directory and
   distinguishing it from the board's own root and from the file-only `filePath`.
2. In `src/renderer/editors/board/BoardWebview.ts`, include the model's `folderPath` in the
   handshake. Keep `materialize` derived only from a file path; folders are not content pipes.
3. In `src/board-shim.ts`, add a separate handshake-settled `folderPathValue` and populate it
   from the validated init message while retaining `whenHandshake()` as the readiness gate.
   Implement `persephone.getFolderPath(): Promise<string | undefined>` that awaits the same
   handshake and returns the exact value. Plain boards and file-only boards resolve `undefined`.
   Do not alter `getFilePath()`'s return type or materialization behavior.
4. Update the app-side diagnostics in `src/renderer/api/types/board-editor.d.ts`, its checked-in
   mirror `assets/editor-types/board-editor.d.ts`, and
   `src/renderer/scripting/api-wrapper/BoardEditorFacade.ts`: expose optional `folderPath`, add
   it to the board member help/summary, and make `copyManifest()` preserve
   `folderEditorMasks` and `folderEditorPriority` along with the existing manifest fields. This
   is metadata for `pages[i].editor`, not a replacement for the iframe bridge API.
5. Update `assets/board-template/CLAUDE.md`, `assets/guides/agents/boards.md`, and
   `assets/guides/boards.md` with a direct-folder manifest example, the new async
   `getFolderPath()` contract, and the distinction:
   `boardRoot` is where the board app is installed; `folderPath` is the absolute directory the
   board claims and operates on. Explain that `getFilePath()` remains `undefined` in folder mode,
   and that `editorKind: "content-host"` still applies only to a board's file association.
   Document the API in these prose references only; do not edit the unwired
   `src/renderer/editors/board/board-api.d.ts`.

Before → after bridge contract:

```ts
// Before: only a file association travels in the init message.
interface BoardPortInitMsg { filePath?: string; contentHost?: boolean; }
persephone.getFilePath(): Promise<string | undefined>;

// After: the two identities travel separately.
interface BoardPortInitMsg {
    filePath?: string;       // file axis only
    folderPath?: string;     // claimed folder axis only
    contentHost?: boolean;
}
persephone.getFilePath(): Promise<string | undefined>;
persephone.getFolderPath(): Promise<string | undefined>;
```

## Concerns

- **Trust and stale links:** `board-editor:<root>` is a machine-specific virtual id. The parser
  may validate payload shape, but only the lifecycle construction branch can prove that the id is
  still represented by the current trusted registry and still claims the decoded absolute folder.
  Every folder construction entry point must use that same current-entry check; no direct manifest
  read or id-only fallback is acceptable.
- **File compatibility:** `folderEditorMasks` remains separate from legacy `folderMasks`, which
  only narrows a file association ([`board-manifest.ts:75-97`](../../../src/renderer/editors/board/board-manifest.ts:75)).
  A file board with `fileMasks` + `folderMasks` continues through the unchanged file branch;
  a content-host file board remains content-host when opened for a file.
- **Two independent paths:** `boardRoot` controls loading/trust/icon/manifest access; the claimed
  `folderPath` is the directory being edited or displayed. Neither may be derived from the other,
  and a directory must never be passed through `getFilePath()`.
- **Expected US-1430 switch limitation:** `editor-switch.ts:isFolderEditor()` currently checks
  only built-in `editorRegistry` definitions ([`editor-switch.ts:13-15`](../../../src/renderer/editors/base/editor-switch.ts:13)),
  so a virtual board id is not recognized by the folder-to-folder branch
  ([`editor-switch.ts:74-117`](../../../src/renderer/editors/base/editor-switch.ts:74)). The later
  board branch then has no file path and returns at its `if (!filePath) return` guard
  ([`editor-switch.ts:141-192`](../../../src/renderer/editors/base/editor-switch.ts:141)).
  Consequently, after US-1430 a folder board is expected to be unable to switch away from its
  page through the toolbar; US-1431 owns that wiring and this intermediate behavior is not a
  US-1430 defect.
- **Placeholder pipe lifetime:** the generic scheme needs the current Layer 2 `openContent`
  handshake, but its placeholder pipe is not board content. The folder branch must dispose it on
  both success and failure without assigning a descriptor to the folder board.
- **Deferred work:** US-1431 owns the toolbar switch and folder-board persistence/restore;
  US-1432 owns the folder-keyed catalog lookup and Board Info “+” install/register round trip.
  US-1430 adds the lifecycle factory and state/bridge shape those tasks need, but does not wire
  switch enumeration, catalog matching, Board Info context capture, or restore migration.
- **No concrete board design:** no `.vscode`, `.github`, `node_modules`, or build-output board is
  created or specified here. The manifest examples document the contract only.
- **Verification limits:** this repository has no unit-test or test-harness convention. Verification
  is source inspection, existing object-model checks, and live-window behavior only.

There are no unresolved design questions after the EPIC-103 investigation. The scope boundaries
above are deliberate task sequencing, not TBD implementation decisions.

## Acceptance Criteria

- [ ] `folder-editor://` encodes and decodes validated `{ editorId, anchorFolder }` payloads;
      malformed payloads are handled without file fallback.
- [ ] Explorer folder resolution consumes `resolveEditorIdForFolder`; the three built-in links
      remain byte-compatible in shape and behavior, while a virtual board uses the one generic
      scheme.
- [ ] The decoded folder path reaches both new-page and existing-page lifecycle opens without
      being persisted as a separate source-link field or treated as a file path.
- [ ] Every folder-board construction validates the id against the current trusted registry and
      verifies that the current entry claims the decoded folder. Stale, hand-written, untrusted,
      and no-longer-matching folder links do not construct a board; existing file-mode behavior
      for stale explicit targets is unchanged and is not turned into a silent no-op.
- [ ] Folder mode constructs only `BoardEditorModel`, passes `boardRoot` and `folderPath`
      independently, leaves `filePath`/content host unset, and uses the stable `board-view`
      persistence id. Existing valid file-associated simple and content-host boards behave as
      before.
- [ ] `BoardPortInitMsg` and `BoardWebview` carry a separate absolute `folderPath`, and
      `persephone.getFolderPath()` awaits the handshake and returns it; `getFilePath()` remains
      file-only and returns `undefined` for folder boards.
- [ ] App-side facade metadata, manifest copying, checked-in editor-type mirrors, and all three
      prose board guides describe the same two-path contract. `board-api.d.ts` is unchanged.
- [ ] No toolbar switch, persistence/restore implementation, catalog `+` lookup, Board Info
      install flow, concrete folder board, unit test, or test harness is added.

## Files verified and intentionally unchanged

- `src/renderer/editors/board/board-manifest.ts` and the data-layer portions of
  `src/renderer/editors/board/custom-editor-registry.ts` — US-1429 already provides the distinct
  axis, normalization, trusted entries, `getBoardsForFolder`, and merged folder resolvers; this
  task consumes them rather than redefining them.
- `src/renderer/content/git-tree-link.ts`, `src/renderer/content/mneme-folder-link.ts`, and
  `src/renderer/content/tree-providers/tree-provider-link.ts` — their existing payloads and
  encoders remain unchanged.
- `src/renderer/content/resolvers.ts` — its existing virtual-link placeholder path already
  forwards the parser-enriched object to `openContent`; the folder-specific ownership decision
  belongs in the open handler/lifecycle branch.
- `src/renderer/editors/base/editorRegistry.ts` and `src/renderer/editors/base/editor-switch.ts`
  — built-in folder primitives remain pure, and the toolbar folder switch is US-1431. No virtual
  board id is added to the built-in registry or `NO_HOST_EDITOR_IDS`; the resulting inability to
  switch away from a folder board is an expected US-1430 intermediate state.
- `src/renderer/content/tree-providers/FileTreeProvider.ts:getNavigationUrlByHref` — it continues
  to return `encodeCategoryLink` for directories at
  [`FileTreeProvider.ts:135-142`](../../../src/renderer/content/tree-providers/FileTreeProvider.ts:135);
  its caller uses the archive provider path ([`ArchiveEditor.ts:123`](../../../src/renderer/editors/archive/ArchiveEditor.ts:123)),
  so no generic folder-board branch is needed here.
- `src/renderer/api/pages/PagesPersistenceModel.ts` and `src/renderer/api/pages/PageModel.ts`
  — stable `board-view` restore and the shared page delegate remain unchanged in US-1430;
  US-1431 owns persisting/revalidating the new folder state.
- `src/renderer/editors/board/BoardContentEditorModel.ts` — content-host construction remains
  file-only; folder mode never selects it.
- `src/renderer/editors/board/board-api.d.ts` — explicitly excluded by EPIC-103 D7.
- `src/renderer/editors/board-info/BoardInfoEditorModel.ts` and `BoardInfoEditorView.ts`,
  `src/renderer/api/published-boards.ts`, and catalog install transport — US-1432.
- Any unit-test or test-harness files — none are used or proposed in this repository.

## Files Changed

| File | Planned change |
|---|---|
| `src/renderer/content/folder-editor-link.ts` | Add validated UTF-8-safe generic `folder-editor://` encode/decode and virtual-board mapping; preserve built-in mappings. |
| `src/renderer/content/tree-providers/FileTreeProvider.ts` | Use the trusted merged folder resolver for directory targets. |
| `src/renderer/content/parsers.ts` | Parse the generic scheme, set `target` and transient `folderPath`, and reject malformed links. |
| `src/renderer/content/open-handler.ts` | Pass `folderPath` through new and existing-page opens. |
| `src/renderer/api/types/io.link-data.d.ts` | Add pipeline-only `folderPath`; mirror in `assets/editor-types/io.link-data.d.ts`. |
| `src/shared/link-data.ts` | Strip transient `folderPath` from persisted source links. |
| `src/renderer/api/pages/PageNavigator.ts` | Carry folder construction options through page navigation. |
| `src/renderer/api/pages/PagesLifecycleModel.ts` | Validate trusted folder board ids and build/restore folder boards without a file host. |
| `src/renderer/api/pages/open-url-validation.ts` | Retain the scripting/MCP `pages.openUrl` allowlist entry for the new `folder-editor` scheme. |
| `src/renderer/editors/board/BoardEditorModel.ts` | Store/expose claimed folder state, extend initialization, and retain file-only path semantics. |
| `src/renderer/editors/board/index.ts` | Add the plain folder-board factory used by lifecycle construction. |
| `src/renderer/editors/board/BoardWebview.ts` | Send the claimed folder in the handshake. |
| `src/ipc/board-bridge-channels.ts` | Type the separate folder handshake field. |
| `src/board-shim.ts` | Implement handshake-backed `persephone.getFolderPath()`. |
| `src/renderer/api/types/board-editor.d.ts` | Expose optional claimed-folder diagnostics; mirror in `assets/editor-types/board-editor.d.ts`. |
| `src/renderer/scripting/api-wrapper/BoardEditorFacade.ts` | Expose/summarize `folderPath` and copy folder manifest fields. |
| `assets/board-template/CLAUDE.md` | Document folder claims and the two-path bridge contract for authors. |
| `assets/guides/agents/boards.md` | Update the maintained agent-facing board authoring guide. |
| `assets/guides/boards.md` | Update the user-facing board guide. |
| `doc/active-work.md` | Link US-1430 under active EPIC-103 work. |
| `doc/epics/EPIC-103.md` | Link the US-1430 row to this document and mark it Active. |
| `doc/tasks/US-1430-folder-board-construction/README.md` | Record the source-verified investigation and implementation plan. |
