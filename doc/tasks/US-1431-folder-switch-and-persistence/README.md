# US-1431 — The folder editor switch and folder-board persistence

**Status:** Active · **Epic:** [EPIC-103](../../epics/EPIC-103.md)

## Goal

Make the existing page editor switch work for a board that claims a folder, including switching
back to Folder View, and make that folder claim survive a restart safely. Restore must validate the
board against the current trusted folder registry before constructing it; an invalid claim must
fall back to a usable folder page without inventing a board or inferring the folder from the board
installation root.

The three EPIC-102 folder editors and every file-associated board keep their existing behavior.
The folder-keyed published catalog and Board Info `+` install flow remain US-1432.

## Background

### Work already delivered by the preceding tasks

US-1429 added the direct-folder manifest axis and the trusted merged data layer. The current
`CustomEditorMatch` carries the trusted board root and normalized direct-folder claim at
[`custom-editor-registry.ts:46-76`](../../../src/renderer/editors/board/custom-editor-registry.ts:46),
`refresh()` projects only trusted roots into the current registry at
[`custom-editor-registry.ts:112-145`](../../../src/renderer/editors/board/custom-editor-registry.ts:112),
and the two merged folder exports are already present at
[`custom-editor-registry.ts:247-268`](../../../src/renderer/editors/board/custom-editor-registry.ts:247).
The merged candidate list deliberately returns built-ins first and matching boards in trusted-list
order; it does not priority-sort the toolbar list.

US-1430 made the folder board openable. `FileTreeProvider` already resolves the row target through
the merged folder resolver at
[`FileTreeProvider.ts:58-72`](../../../src/renderer/content/tree-providers/FileTreeProvider.ts:58),
`folder-editor://` carries `{ editorId, anchorFolder }` at
[`folder-editor-link.ts:7-60`](../../../src/renderer/content/folder-editor-link.ts:7), and the
parser/lifecycle path validates a virtual board against the current trusted registry before
construction at
[`PagesLifecycleModel.ts:122-160`](../../../src/renderer/api/pages/PagesLifecycleModel.ts:122).
The public lifecycle seam that this task must use for a folder-board switch is
[`PagesLifecycleModel.ts:221-231`](../../../src/renderer/api/pages/PagesLifecycleModel.ts:221).

`BoardEditorModel` now stores the claimed folder separately from the installed board root and
exposes it through `folderPath` at
[`BoardEditorModel.ts:442-455`](../../../src/renderer/editors/board/BoardEditorModel.ts:442). Its
virtual editor id is active for either a file or a folder claim at
[`BoardEditorModel.ts:144-154`](../../../src/renderer/editors/board/BoardEditorModel.ts:144), while
the bridge sends the separate field and `persephone.getFolderPath()` reads it at
[`BoardWebview.ts:263-276`](../../../src/renderer/editors/board/BoardWebview.ts:263) and
[`board-shim.ts:1037-1045`](../../../src/board-shim.ts:1037).

### A. Verified folder-switch defect

The current switch implementation has four independent built-in assumptions:

1. [`editor-switch.ts:13-15`](../../../src/renderer/editors/base/editor-switch.ts:13) defines
   `isFolderEditor(editorId)` solely as
   `editorRegistry.getById(editorId)?.match?.acceptFolder`. A virtual
   `board-editor:<boardRoot>` id has no built-in definition, so this returns false for a folder
   board. The folder branch at
   [`editor-switch.ts:70-117`](../../../src/renderer/editors/base/editor-switch.ts:70) therefore
   never runs; control reaches the board branch, which reads `oldEditor.filePath` and returns at
   [`editor-switch.ts:187-193`](../../../src/renderer/editors/base/editor-switch.ts:187). The
   observable result is a folder board that the toolbar cannot leave.
2. [`editor-switch.ts:17-20`](../../../src/renderer/editors/base/editor-switch.ts:17) reads only
   `folderAnchor`. EPIC-102's three models expose that verified accessor—for example Git Tree at
   [`GitTreeEditorModel.ts:201-215`](../../../src/renderer/editors/git-tree/GitTreeEditorModel.ts:201)—but
   a folder board exposes `folderPath`, not `folderAnchor`. The implementation should make
   `folderAnchor` the single model-level folder identity and have the board alias its
   `folderPath` through it. This keeps switch, option construction, and surviving-editor reuse on
   one accessor instead of growing a `folderAnchor`/`folderPath` branch at every consumer.
3. [`editor-switch.ts:81-85`](../../../src/renderer/editors/base/editor-switch.ts:81) validates
   candidates against built-in-only `editorRegistry.getFolderEditors(anchorFolder)`. It must use
   `getFolderEditorsForFolder(anchorFolder)` so trusted board claimants are offered, while the
   built-in segment remains in its established order.
4. [`editor-switch.ts:99-105`](../../../src/renderer/editors/base/editor-switch.ts:99) loads a
   registry module and calls `newEditorModelForFolder`. That factory is appropriate for the three
   built-ins, but a virtual board id cannot be loaded from `EditorRegistry`: `getModule()` throws
   for ids absent from the definitions map at
   [`editorRegistry.ts:339-352`](../../../src/renderer/editors/base/editorRegistry.ts:339). The
   virtual-board branch must instead call US-1430's
   `pagesModel.lifecycle.createEditorFromFolder(newEditorId, anchorFolder)`, which performs the
   current trusted-claim validation before constructing the plain board model. A source search
   confirms that the `newEditorModelForFolder` call at `editor-switch.ts:99-100` is currently its
   only caller.

The page toolbar currently subscribes to the custom registry's reactive `entries` projection at
[`PageToolbarView.ts:229-250`](../../../src/renderer/editors/base/PageToolbarView.ts:229), so the
folder implementation must consume that same projection rather than introduce a second trust
cache or a one-time snapshot.

### Toolbar ordering and the `+` boundary

The file-side option builder starts with `model.findCompatibleEditors()`, appends matching trusted
boards in their existing order, and forces `BOARD_INFO_EDITOR_ID` to the end at
[`editor-switch-options.ts:41-63`](../../../src/renderer/editors/base/editor-switch-options.ts:41).
Folder options must use the same shape: the exact built-in result from
`editorRegistry.getFolderEditors(folderPath)` first, then every matching board in trusted-list
order. Priority selects the default resolver only; it must never reorder the visible candidates.
`getFolderEditorsForFolder()` already embodies that rule at
[`custom-editor-registry.ts:261-267`](../../../src/renderer/editors/board/custom-editor-registry.ts:261).

Folder options must not derive a file name from a folder title or category-link blob and must not
append Board Info. The folder-keyed catalog lookup, catalog subscription changes, folder-aware
Board Info identity capture, and Download → Register → switch flow are US-1432, as scoped by
[EPIC-103:117-119](../../epics/EPIC-103.md:117) and D8 at
[EPIC-103:91-106](../../epics/EPIC-103.md:91).

### B. Verified persistence and restore behavior

`BoardEditorModel.getRestoreData()` already pins the persisted descriptor id to stable
`"board-view"` at
[`BoardEditorModel.ts:540-570`](../../../src/renderer/editors/board/BoardEditorModel.ts:540). The
virtual id must not be added to `NO_HOST_EDITOR_IDS`: that set intentionally contains
`"board-view"` at
[`PagesPersistenceModel.ts:25-32`](../../../src/renderer/api/pages/PagesPersistenceModel.ts:25),
and the generic restore branch assigns the saved state before calling `restore()` at
[`PagesPersistenceModel.ts:146-164`](../../../src/renderer/api/pages/PagesPersistenceModel.ts:146).
The durable folder claim is already a distinct state field, but persistence currently relies on the
base state spread and restore does not verify that the current trusted registry still contains the
board claim.

The restore path has two board-specific branches before the generic no-host branch: non-main board
descriptors are dropped at
[`PagesPersistenceModel.ts:87-96`](../../../src/renderer/api/pages/PagesPersistenceModel.ts:87),
and a `board-view` descriptor with a host is rebuilt as `BoardContentEditorModel` at
[`PagesPersistenceModel.ts:97-121`](../../../src/renderer/api/pages/PagesPersistenceModel.ts:97).
Folder mode must remain the plain `BoardEditorModel` even if a malformed descriptor carries a host;
EPIC-103 D6 says folder mode never adopts a content host
([`EPIC-103.md:81-84`](../../epics/EPIC-103.md:81)).

The new restore validation must treat all of these as invalid folder claims:

- the board root is no longer in the current trusted registry;
- the board was uninstalled or its manifest is unreadable, so no current association exists; or
- the current trusted manifest no longer directly claims the persisted `folderPath`.

The validation must use the current `customEditorRegistry` projection and its direct-folder matcher,
not read a manifest from the virtual id and not infer the folder from `boardRoot`. This is the
restore counterpart of the link validation already present in
[`PagesLifecycleModel.ts:128-140`](../../../src/renderer/api/pages/PagesLifecycleModel.ts:128).

For an invalid persisted folder board, the planned graceful result is a Folder View fallback over
the persisted `folderPath`, retaining the page id and the Explorer panel when one exists. If the
descriptor has no Explorer panel (possible for a folder link opened in a new tab), restore the
fallback by attaching an Explorer rooted at that folder before building Folder View. This keeps the
page navigable and ensures the category editor has a provider host. The general pre-existing guard
at [`PagesPersistenceModel.ts:212-213`](../../../src/renderer/api/pages/PagesPersistenceModel.ts:212)
still remains unchanged for unrelated editorless/no-sidebar pages; this task only ensures that a
stale folder-board descriptor does not reach that condition.

### C. Explorer icon carry-over

The row currently resolves a virtual board target and then asks the built-in registry for
`folderIcon`; that lookup is undefined for the virtual id at
[`FileTreeProvider.ts:62-72`](../../../src/renderer/content/tree-providers/FileTreeProvider.ts:62).
The fallback therefore renders the ordinary folder glyph. The trusted match already carries the
board root at [`custom-editor-registry.ts:48-52`](../../../src/renderer/editors/board/custom-editor-registry.ts:48),
and the existing board icon cache probes `icon.svg`, `icon.png`, and `icon.ico` under that root at
[`board-icon-cache.ts:5-12`](../../../src/renderer/editors/board/board-icon-cache.ts:5). The existing
native `createBoardGlyphElement(boardRoot)` path also handles asynchronous resolution and the
fallback Board glyph at [`board-glyph-element.ts:4-19`](../../../src/renderer/editors/board/board-glyph-element.ts:4).

This task will wire that already-available board icon to claimed Explorer rows. It will add a
board-icon-root presentation field to the tree item, set it only for the matching virtual board,
and make the native tree icon renderer call `createBoardGlyphElement`. The renderer already
refreshes cached tree icons when board icon resolution changes through
[`TreeProviderViewImpl.ts:98-114`](../../../src/renderer/components/tree-provider/TreeProviderViewImpl.ts:98).
Built-in Git/Mneme icon tokens and ordinary folder icons remain unchanged.

## Implementation Plan

### 1. Establish one folder identity accessor

1. In `src/renderer/editors/base/EditorModel.ts`, add this overridable model-level accessor:

   ```ts
   /** The folder this editor is anchored at, or undefined for a non-folder editor. */
   get folderAnchor(): string | undefined {
       return undefined;
   }
   ```

   This accessor form is required because Category, Git Tree, and Mneme already define
   `folderAnchor` as computed accessors. Do not declare a `folderAnchor?: string` property and do
   not flatten those three existing getters into properties; accessor-overrides-accessor is the
   legal TypeScript shape and preserves each editor's state-derived anchor. The base implementation
   formalizes the EPIC-102 anchor concept without making ordinary editors folder editors.
2. In `src/renderer/editors/board/BoardEditorModel.ts`, implement `folderAnchor` by returning the
   existing `folderPath` getter. Do not rename or remove `folderPath`; it remains the persisted
   claimed-folder state and the bridge-facing value. File-associated boards return undefined from
   the new accessor, so their current file switch path remains selected.
3. Keep the existing verified `folderAnchor` derivations in Category, Git Tree, and Mneme. Their
   matchers continue to be the authority for whether their derived anchor is still valid:
   `category-view` is priority 0 and Git/Mneme are priority 20 at
   [`editor-matchers.ts:150-160`](../../../src/renderer/editors/base/editor-matchers.ts:150).

Before → after model identity:

```ts
// Before: consumers have to know that boards use a different property.
const anchor = (editor as EditorModel & { folderAnchor?: string }).folderAnchor;
const boardFolder = (editor as BoardEditorModel).folderPath;

// After: every folder-capable model exposes one identity.
const anchor = editor.folderAnchor;
// BoardEditorModel.folderAnchor returns its persisted folderPath.
```

### 2. Repair the folder switch in `src/renderer/editors/base/editor-switch.ts`

1. Replace the id-only folder test with a model-aware test that recognizes a folder board through
   its canonical `folderAnchor`. Obtain the old anchor once and use it for both candidate
   validation and construction.
2. Validate `newEditorId` against
   `getFolderEditorsForFolder(anchorFolder)`, not `editorRegistry.getFolderEditors`. This accepts
   built-ins and all currently trusted folder boards, including a lower-priority board that is a
   switch candidate but not the resolver winner.
3. Preserve the existing surviving Pattern B reuse check at
   [`editor-switch.ts:87-97`](../../../src/renderer/editors/base/editor-switch.ts:87). Compare the
   canonical anchor with `fpNormalizeForCompare`, so switching back to a demoted Git Tree or
   Mneme instance does not create duplicate panels. The same comparison must work for a board
   because its `folderAnchor` aliases `folderPath`.
4. For a virtual `board-editor:<root>` target, call
   `pagesModel.lifecycle.createEditorFromFolder(newEditorId, anchorFolder)`. Do not call
   `editorRegistry.getModule()` for the virtual id, do not infer the folder from the board root,
   and do not use the content-host board construction branch. The lifecycle seam already validates
   current trust and claims and always creates plain `BoardEditorModel` folder mode.
5. Keep the current built-in factory path for `category-view`, `git-tree`, and `mneme-root`,
   including the provider-preserving `buildFolderCategoryLink(page, anchorFolder)` step for
   Folder View. The existing category link helper explicitly uses the page's matching panel
   provider and only falls back to a self-rooted file provider at
   [`CategoryEditorModel.ts:74-87`](../../../src/renderer/editors/category/CategoryEditorModel.ts:74).
6. Ensure an invalid target, failed module/factory load, or failed current-trust check leaves the
   old editor installed and lets the existing toolbar guard report the failure. A board that has
   just lost trust must still be able to choose Folder View, even though its own id is no longer a
   trusted candidate.

Before → after switch routing:

```ts
// Before: virtual folder-board ids fail both tests, then hit the file-shaped board branch.
if (isFolderEditor(oldEditor.editorId) && isFolderEditor(newEditorId)) {
    if (!editorRegistry.getFolderEditors(anchorFolder).includes(newEditorId)) return;
    const module = await editorRegistry.getModule(newEditorId);
    const next = await module.newEditorModelForFolder?.(anchorFolder);
}

// After: the model anchor identifies folder mode and the merged catalog identifies targets.
const anchorFolder = oldEditor.folderAnchor;
if (anchorFolder && isFolderEditor(oldEditor)
    && getFolderEditorsForFolder(anchorFolder).includes(newEditorId)) {
    if (parseBoardEditorId(newEditorId) !== null) {
        const next = await pagesModel.lifecycle.createEditorFromFolder(
            newEditorId,
            anchorFolder,
        );
        await page.setMainEditor(next as EditorModel);
        return;
    }
    // Built-ins keep module.newEditorModelForFolder(anchorFolder).
}
```

### 3. Build folder toolbar options in `src/renderer/editors/base/editor-switch-options.ts`

1. Add a folder identity branch before the file-name, content-mask, catalog, and `+` logic. When
   `model.folderAnchor` is defined, use `getFolderEditorsForFolder(folderPath)` as the candidate
   list and `customEditorRegistry.getBoardsForFolder(folderPath)` for board labels.
2. Preserve the exact ordering: built-in `getFolderEditors` output first, then matching boards in
   trusted-list order. Do not sort by `folderEditorPriority`; priority is only for
   `resolveEditorIdForFolder`.
3. If the current model is a folder board whose trust was revoked during the asynchronous refresh,
   append its current virtual id only as a selected recovery option when it is absent from the
   trusted candidate list. This keeps the control mounted and the Folder View segment usable. Do
   not append any untrusted board as a switch target for a different editor; the switch validator
   still checks the merged current registry.
4. Return no `BOARD_INFO_EDITOR_ID` from this branch and do not call
   `publishedBoards.catalogBoardsForFile` for folder identity. The existing file branch, including
   its final `BOARD_INFO_EDITOR_ID`-last normalization at lines 56-63, remains byte-for-byte in
   behavior for file pages.
5. Keep the existing `customEditorRegistry.state` subscription in `PageToolbarView`; it is the
   required refresh-window behavior. When trust refresh retracts a board, the options recompute
   from the new projection while the current board identity remains available long enough to leave
   the page.

Before → after option source:

```ts
// Before: every page starts with its model's file-oriented list.
const merged = [...model.findCompatibleEditors()];
for (const board of boardMatches) merged.push(board.editorId);
if (catalogMatches.length > 0) merged.push(BOARD_INFO_EDITOR_ID);

// After: a folder page uses the merged folder resolver and has no catalog install entry.
if (model.folderAnchor) {
    const merged = [...getFolderEditorsForFolder(model.folderAnchor)];
    for (const board of customEditorRegistry.getBoardsForFolder(model.folderAnchor)) {
        if (!merged.includes(board.editorId)) merged.push(board.editorId);
    }
    // Recovery-only append for the currently mounted board after trust revocation.
    if (isFolderBoardModel(model) && !merged.includes(model.editorId)) merged.push(model.editorId);
    return toSwitchOptions(merged, boardNames);
}
```

The implementation should keep one label map for trusted board matches and use the existing
registry name for built-ins. The recovery-only current id may be labelled from the mounted board's
manifest/name; it is never used to authorize construction of another board.

### 4. Persist and restore folder boards safely

1. In `src/renderer/editors/board/BoardEditorModel.ts`, keep `getRestoreData()`'s stable
   `data.editorId = "board-view"` assignment. Make the durable state shape explicit in the
   persistence code/comments: `boardRoot` and `folderPath` are independent persisted fields;
   `folderPath` must be copied as-is when present and must never be recomputed from `boardRoot`.
   Continue stripping only transient board fields (`statusText`, `contentPath`, and the existing
   shared-state filtering). Do not put a virtual id into persistence.
2. In `src/renderer/api/pages/PagesPersistenceModel.ts`, add a folder-board validation step before
   either the `board-view` host branch or the generic `NO_HOST_EDITOR_IDS` branch constructs a
   board. First `await customEditorRegistry.ensureInitialized()` at
   [`custom-editor-registry.ts:105-109`](../../../src/renderer/editors/board/custom-editor-registry.ts:105);
   its contract is to load the trusted list and refresh before state is read. Then require:

   ```ts
   const state = d.state as Partial<BoardEditorState>;
   const folderPath = state.folderPath;
   const boardRoot = state.boardRoot;
   const current = boardRoot && folderPath
       ? customEditorRegistry.entries.find((entry) =>
           sameBoardRoot(entry.boardRoot, boardRoot)
           && customEditorRegistry.getBoardsForFolder(folderPath)
               .some((folderEntry) => folderEntry.boardRoot === entry.boardRoot))
       : undefined;
   ```

   `sameBoardRoot` must use the repository's path comparison helper, while the claim test must use
   the current direct-folder projection. A missing root, missing folder, lost trust, removed
   manifest, or changed claim is invalid. The registry's `refreshGen` guard at
   [`custom-editor-registry.ts:116-141`](../../../src/renderer/editors/board/custom-editor-registry.ts:116)
   prevents a refresh that lands during restore from clobbering a newer projection, so this one
   `ensureInitialized()` await is sufficient; the persistence path must not add its own retry loop.
   A descriptor with `folderPath` must never be sent to the content-host `BoardContentEditorModel`
   branch, even if malformed persisted data includes a `host` field.
3. For a valid folder board, continue through the stable `board-view` restore construction, apply
   the persisted state (including `folderPath`), and call the plain board's `restore()`. The
   resulting live `editorId` may again be `board-editor:<boardRoot>` because that id is derived
   only after validation; it is never the persisted descriptor id.
4. For an invalid folder-board descriptor, do not construct the board. Replace the main descriptor
   with Folder View over the persisted folder path, preserving the original page/editor instance
   id so `desc.mainEditorId` still selects a main editor. The fallback must be installed **after
   the existing descriptor attach loop at `PagesPersistenceModel.ts:181-183` and before the
   editorless-page check at `PagesPersistenceModel.ts:212`**. Build it in that interval so
   `buildFolderCategoryLink(page, folderPath)` can reuse a restored Explorer provider. If no
   Explorer exists, attach one rooted at `folderPath` first, then build Folder View; this is the
   new-tab/no-sidebar case and keeps the page usable instead of allowing the page to return `null`.
5. Leave the generic `if (page.editors.length === 0 && !desc.sidebar) return null` check itself
   unchanged for all other descriptors. “Unchanged” does not mean that the folder fallback may be
   installed after it: the fallback's required placement before `PagesPersistenceModel.ts:212`
   ensures a stale folder-board-only page is repaired before that check runs. The investigation
   confirms that the check is a pre-existing editorless-page issue, not a reason to add a virtual
   board id to `NO_HOST_EDITOR_IDS`; this task only gives stale folder-board descriptors a specific
   Folder View/Explorer fallback.

Before → after restore identity:

```ts
// Before: any stable board-view descriptor with boardRoot is constructed and restored.
if (NO_HOST_EDITOR_IDS.has(d.editorId)) {
    const editor = await editorRegistry.createEditor(d.editorId, d.id);
    editor.state.update((s) => Object.assign(s as object, d.state));
    await editor.restore();
    return editor;
}

// After: folder claims are revalidated before construction; invalid claims become Folder View.
if (d.editorId === "board-view" && hasPersistedFolderClaim(d)) {
    if (!isCurrentTrustedFolderClaim(d)) return null; // caller installs Folder View fallback
    // Continue with plain board-view construction; persisted editorId remains stable.
}
```

The final implementation should make the fallback explicit in the surrounding `restorePage`
control flow rather than allowing a `null` editor to make a normal folder page disappear.

### 5. Wire the claimed board icon into Explorer

1. In `src/renderer/content/tree-providers/FileTreeProvider.ts`, find the matching trusted board
   entry for the resolved virtual target from `getBoardsForFolder(fullPath)`. Keep the existing
   `folderIcon` lookup for built-ins, but set a board-specific icon-root field for a matching board.
   The board root is the trusted registry value, not the claimed folder path.
2. In `src/renderer/api/types/io.tree.d.ts` and its checked-in
   `assets/editor-types/io.tree.d.ts` mirror, add the optional tree-item presentation field with a
   comment that it is an icon-cache root, not a navigation target or board claim.
3. In `src/renderer/components/icons/icon-elements.ts`, when the semantic icon is `"board"`, call
   the existing `createBoardGlyphElement(boardIconRoot)` so custom `icon.svg`/`icon.png`/`icon.ico`
   resolution and the generic Board fallback share the established path. The existing icon-change
   subscription will refresh the row when the cache resolves.
4. Do not change `createFolderIconElement`, Git/Mneme tokens, `folder-editor-link.ts`, or folder
   navigation semantics. A board row still opens through the already-shipped generic link.

### 6. Preserve the explicit boundaries and regression behavior

- Do not add `catalogBoardsForFolder`, catalog subscriptions, Board Info folder matching, or
  Download/Register behavior; those are US-1432.
- Do not add `.vscode`, `.github`, `node_modules`, or any other concrete board.
- Do not alter file-associated board resolution, `folderMasks` narrowing, content-host file boards,
  or the three built-in folder schemes.
- Do not add unit tests or a test harness. Verification for this task is source inspection plus
  the existing manual/live-window checks used by the preceding EPIC-102 tasks.

## Concerns

1. **Trust-refresh race.** `customEditorRegistry.refresh()` is triggered asynchronously by
   `boardTrust.subscribePaths` at [`custom-editor-registry.ts:95-102`](../../../src/renderer/editors/board/custom-editor-registry.ts:95).
   The toolbar must remain subscribed to `customEditorRegistry.state`, and initial restore must
   call and await `customEditorRegistry.ensureInitialized()` at
   [`custom-editor-registry.ts:105-109`](../../../src/renderer/editors/board/custom-editor-registry.ts:105)
   rather than treating an empty pre-refresh list as proof that a board is invalid. The
   `refreshGen` guard at [`custom-editor-registry.ts:116-141`](../../../src/renderer/editors/board/custom-editor-registry.ts:116)
   keeps a refresh from overwriting a newer projection while restore is validating, so no second
   validation retry is needed.
2. **Revoked board recovery.** After refresh, a revoked board must not remain an authorized target,
   but its mounted page must still show Folder View and allow leaving. The recovery-only current id
   is a UI continuity measure; lifecycle validation remains authoritative for every board target.
3. **Folder fallback provider.** Category View is provider-backed: without a matching panel its
   `providerHost` is null and folder actions are unavailable at
   [`CategoryEditorModel.ts:132-161`](../../../src/renderer/editors/category/CategoryEditorModel.ts:132).
   Restore fallback must therefore attach/reuse Explorer before creating the category link.
4. **Stable versus virtual identity.** The persisted descriptor must stay `board-view`, while the
   live model derives its virtual id only after current trust and claim validation. No board root
   may be reconstructed from the claimed folder, and no virtual id may enter `NO_HOST_EDITOR_IDS`.
5. **Board icon availability.** Icon resolution is memory-cached and asynchronous. The row must
   initially show the Board fallback and then repaint when the existing cache resolves; it must not
   block folder enumeration on icon probing.
6. **Pre-existing editorless restore issue.** The generic no-editor/no-sidebar drop at
   `PagesPersistenceModel.ts:212` is documented and remains outside this task. The folder-board
   invalid-claim fallback must avoid creating that condition for its own restore path without
   changing the generic rule.
7. **Scope drift into US-1432.** The folder toolbar deliberately has no `+` install item. A
   published board that is not installed is not a switch candidate in this task.

There are no unresolved design questions after the source investigation; the fallback behavior,
single folder accessor, ordering, icon decision, trust behavior, and US-1432 boundary are specified
above.

## Acceptance Criteria

- [ ] Folder mode is recognized for Category/Git/Mneme and for a folder board through one canonical
      model accessor; a virtual folder-board id no longer falls through to the file-shaped board
      branch.
- [ ] A folder board's toolbar lists Folder View, all matching built-ins, and all matching trusted
      boards in built-ins-then-trusted-list order. Folder editor priority affects the default
      resolver only and never display order.
- [ ] Switching Folder View ↔ a trusted folder board uses the existing
      `PagesLifecycleModel.createEditorFromFolder` seam for the board, preserves the claimed folder,
      and does not create duplicate surviving folder panels.
- [ ] A board that loses trust during an asynchronous registry refresh remains able to switch to
      Folder View; revoked board ids are not accepted to construct another board.
- [ ] Folder toolbar options do not derive a file name, consult a folder catalog, or append Board
      Info `+`; file pages retain the current file options and `+` behavior.
- [ ] Persisted folder boards retain `board-view` as the descriptor id and persist `folderPath`
      beside `boardRoot`; restore never infers one from the other and never stores a virtual id in
      `NO_HOST_EDITOR_IDS`.
- [ ] Restore accepts a folder board only when its board root is currently trusted and its current
      manifest association still claims the persisted folder. Lost trust, uninstall/missing
      manifest, and removed claims never construct a board and degrade to a usable Folder View /
      Explorer page.
- [ ] Folder restore never constructs `BoardContentEditorModel`, even if malformed state carries a
      host descriptor. Existing file content-host boards remain unchanged.
- [ ] A folder claimed by a board paints that board's cached custom icon in Explorer, with the
      existing Board glyph as the asynchronous/missing-icon fallback; built-in and plain-folder
      icons remain unchanged.
- [ ] The three built-in folder editors behave exactly as before when no board claims the folder,
      including their existing links, anchor validation, and toolbar ordering.
- [ ] No concrete board, catalog install flow, unit test, or test harness is added.

## Files intentionally unchanged

- `src/renderer/editors/board/custom-editor-registry.ts` — US-1429's merged folder resolver and
  candidate order are consumed, not redesigned.
- `src/renderer/api/pages/PagesLifecycleModel.ts` — US-1430's folder construction and current-link
  validation seam already exist; the switch calls it rather than changing its contract.
- `src/renderer/content/folder-editor-link.ts`, `src/renderer/content/parsers.ts`,
  `src/renderer/content/open-handler.ts`, `src/shared/link-data.ts` — the generic folder link and
  transient pipeline field shipped in US-1430.
- `src/renderer/editors/board/BoardWebview.ts`, `src/board-shim.ts`,
  `src/ipc/board-bridge-channels.ts` — `getFolderPath()` transport is already shipped.
- `src/renderer/editors/board-info/BoardInfoEditorModel.ts`, `BoardInfoEditorView.ts`,
  `src/renderer/api/published-boards.ts`, and catalog/public board types — folder-keyed catalog and
  `+` installation are US-1432.
- `src/renderer/api/pages/PageModel.ts` — persistence delegates to `getRestoreData()` and the
  existing editor/page lifecycle; the generic editorless-page rule is not fixed here.
- `src/renderer/editors/register-editors.ts`, `editorRegistry.ts`, and the built-in folder matcher
  definitions — built-in registration, priorities, and order remain unchanged.
- All `.vscode`/concrete board files and all unit-test/test-harness files.

## Files Changed

| File | Planned change |
|---|---|
| `src/renderer/editors/base/EditorModel.ts` | Add the canonical `folderAnchor` accessor with an undefined base implementation; retain accessor overrides in existing folder editors. |
| `src/renderer/editors/board/BoardEditorModel.ts` | Alias folder-board `folderPath` through `folderAnchor`; make durable folder persistence explicit; retain stable `board-view` restore id. |
| `src/renderer/editors/base/editor-switch.ts` | Recognize folder boards, use merged folder candidates, route virtual boards through `createEditorFromFolder`, and preserve folder-editor reuse. |
| `src/renderer/editors/base/editor-switch-options.ts` | Build folder candidates in fixed built-ins-then-trusted-board order, keep revoked current boards recoverable, and omit catalog `+` for folders. |
| `src/renderer/api/pages/PagesPersistenceModel.ts` | Validate persisted folder claims against current trust/manifest projection before board construction and restore invalid claims as Folder View with Explorer continuity. |
| `src/renderer/content/tree-providers/FileTreeProvider.ts` | Carry the trusted board root as the claimed row's icon source while preserving target/link behavior. |
| `src/renderer/api/types/io.tree.d.ts` | Declare the optional tree-item board icon-root presentation field. |
| `assets/editor-types/io.tree.d.ts` | Keep the checked-in editor-types mirror aligned with the tree item shape. |
| `src/renderer/components/icons/icon-elements.ts` | Render board row icons through `createBoardGlyphElement` so custom board icons and fallback repaint work. |
| `doc/active-work.md` | Link US-1431 under EPIC-103 and keep it Active. |
| `doc/epics/EPIC-103.md` | Link US-1431 to this document and mark it Active. |
| `doc/tasks/US-1431-folder-switch-and-persistence/README.md` | Record this source-verified investigation and implementation plan. |
