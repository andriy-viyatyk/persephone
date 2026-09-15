# US-1432 — The folder-keyed catalog and the “+” install flow through Board Info

**Status:** Active · **Epic:** [EPIC-103](../../epics/EPIC-103.md)

## Goal

Make the published-board catalog and the existing Board Info “+” flow folder-aware. A folder
page must offer “+” only for a compatible published board that matches its absolute folder and
must carry that folder unchanged through Download → Register → the newly installed trusted board.

## Background

This is the final task in EPIC-103 and consumes the data, construction, switch, and persistence
seams delivered by [US-1429](../US-1429-folder-claims-in-manifest/README.md),
[US-1430](../US-1430-folder-board-construction/README.md), and
[US-1431](../US-1431-folder-switch-and-persistence/README.md). The authoritative constraints are
EPIC-103 D8 and Concerns 1, 2, 3, and 5
([EPIC-103.md:91-138](../../epics/EPIC-103.md:91)). The epic’s final verification list is
§8 of the investigation notes
([EPIC-103-investigation-notes.md:370-394](../../epics/EPIC-103-investigation-notes.md:370)).

### Delivered catalog and trust data

US-1429 already carries `folderEditorMasks` and `folderEditorPriority` through the catalog
contract. The main process treats the remote catalog as untrusted and filters mask entries to
strings and priority to finite numbers in `validateBoard`
([`published-boards-service.ts:88-124`](../../../src/main/published-boards-service.ts:88)). The
renderer then normalizes the copied folder masks with the existing `normalizeFolderMasks` and
normalizes the priority in `normalizeCatalog`
([`published-boards.ts:41-60`](../../../src/renderer/api/published-boards.ts:41)). That function
is used for both the initial result and the update broadcast
([`published-boards.ts:67-89`](../../../src/renderer/api/published-boards.ts:67),
[`published-boards.ts:98-105`](../../../src/renderer/api/published-boards.ts:98)). The folder
lookup must reuse this normalized in-memory projection; it must not normalize the same fields a
second time in each selector.

The installed manifest uses the same folder-glob machinery for direct claims:
`matchesFolderEditorMasks` tests the folder itself, whereas `matchesBoardMasks` keeps
`folderMasks` as a file-parent narrowing field
([`board-manifest.ts:267-335`](../../../src/renderer/editors/board/board-manifest.ts:267)). The
trusted registry projects the normalized fields into trusted entries
([`custom-editor-registry.ts:112-145`](../../../src/renderer/editors/board/custom-editor-registry.ts:112)),
and already exposes `getBoardsForFolder`, `resolveEditorIdForFolder`, and
`getFolderEditorsForFolder`
([`custom-editor-registry.ts:168-174`](../../../src/renderer/editors/board/custom-editor-registry.ts:168),
[`custom-editor-registry.ts:247-267`](../../../src/renderer/editors/board/custom-editor-registry.ts:247)).
Those helpers are the installed/trusted source of truth; the remote catalog is only an install
candidate source.

### The existing folder switch and the US-1431 trap

The folder branch in `getEditorSwitchOptions` now uses `model.folderAnchor`, the merged trusted
folder candidates, and trusted board labels, then returns before the file-name/catalog logic
([`editor-switch-options.ts:21-37`](../../../src/renderer/editors/base/editor-switch-options.ts:21)).
It intentionally has no catalog lookup and no `BOARD_INFO_EDITOR_ID`. The file branch that
follows must remain behaviorally unchanged, including its final “+” normalization
([`editor-switch-options.ts:39-104`](../../../src/renderer/editors/base/editor-switch-options.ts:39)).

US-1431 changed `switchMainEditor` so the folder branch is gated by the outgoing editor’s
`folderAnchor` and rejects targets absent from `getFolderEditorsForFolder`
([`editor-switch.ts:68-119`](../../../src/renderer/editors/base/editor-switch.ts:68)). The
existing `BOARD_INFO_EDITOR_ID` handler is after that branch
([`editor-switch.ts:121-140`](../../../src/renderer/editors/base/editor-switch.ts:121)). Therefore
a folder “+” click currently throws before Board Info can capture the folder: `board-info` is
deliberately not a folder candidate.

The correct fix is to handle `BOARD_INFO_EDITOR_ID` before the folder branch, by moving the
existing handler upward without changing its construction/restore behavior. This mirrors the
handler’s existing comment: a later board branch previously claimed the same “+” target and made
the click appear to do nothing for a simple board
([`editor-switch.ts:121-140`](../../../src/renderer/editors/base/editor-switch.ts:121)). An
explicit exemption inside the folder branch would leave the branch responsible for a target it
does not construct, and would repeat the same ordering hazard. The folder branch should continue
to reject `board-info` when reached for any other reason.

Before → after switch ordering:

```ts
// Before: the folder target validator claims every request from a folder page first.
const anchorFolder = oldEditor.folderAnchor;
if (anchorFolder !== undefined && isFolderEditor(oldEditor)) {
    if (!getFolderEditorsForFolder(anchorFolder).includes(newEditorId)) throw new Error(...);
    // folder construction...
}
if (newEditorId === BOARD_INFO_EDITOR_ID) {
    // Board Info construction...
}

// After: the install target is dispatched before folder candidate validation.
if (newEditorId === BOARD_INFO_EDITOR_ID) {
    const boardInfo = await editorRegistry.createEditor(newEditorId);
    boardInfo.switchFrom(oldEditor);
    await boardInfo.restore();
    await page.setMainEditor(boardInfo);
    return;
}
const anchorFolder = oldEditor.folderAnchor;
if (anchorFolder !== undefined && isFolderEditor(oldEditor)) {
    if (!getFolderEditorsForFolder(anchorFolder).includes(newEditorId)) throw new Error(...);
    // folder construction...
}
```

### Board Info’s current file flow and D8’s single accessor

`BoardInfoEditorModel.switchFrom` currently adopts a content host when available. Its host-less
branch captures only `oldEditor.filePath` into `state.filePath`, which preserves the file “+”
flow, file peers, and title
([`BoardInfoEditorModel.ts:197-223`](../../../src/renderer/editors/board-info/BoardInfoEditorModel.ts:197)).
Its file name, compatible-editor list, and catalog matches are all file-keyed
([`BoardInfoEditorModel.ts:227-239`](../../../src/renderer/editors/board-info/BoardInfoEditorModel.ts:227),
[`BoardInfoEditorModel.ts:433-443`](../../../src/renderer/editors/board-info/BoardInfoEditorModel.ts:433)).
The current install-mode availability gate is `shouldAutoSwitch`, not a method named
`canOpenBoard`: HEAD has no `canOpenBoard` symbol; the corresponding current code is
`shouldAutoSwitch`/`autoSwitchToNatural` at
[`BoardInfoEditorModel.ts:578-593`](../../../src/renderer/editors/board-info/BoardInfoEditorModel.ts:578),
triggered by the view at
[`BoardInfoEditorView.ts:139-146`](../../../src/renderer/editors/board-info/BoardInfoEditorView.ts:139).

D8 requires one accessor returning `{ path, kind: "file" | "folder" }` for every identity read.
Add a private `currentSource()` (or equivalently named single accessor) to `BoardInfoEditorModel`.
It must prefer the held host’s real file path for file mode, then the persisted host-less
`filePath`, then the persisted `folderPath` for folder mode, with the existing title fallback
remaining file-shaped for an otherwise standalone Board Info page. The exact precedence must be
documented and used consistently; no caller may grow an independent `folderPath` branch.

Note: D8’s `canOpenBoard` label does not name a HEAD symbol; its corresponding current symbols are
`shouldAutoSwitch` and `autoSwitchToNatural`.

The planned identity shape is:

```ts
// Before: callers each read a file-shaped value independently.
private currentFileName(): string {
    const hs = this._host?.state.get();
    return hs?.filePath ?? this.state.get().filePath ?? hs?.title ?? this.title;
}

// After: one source accessor owns the file/folder distinction.
type BoardInfoSource = { path: string; kind: "file" | "folder" };

private currentSource(): BoardInfoSource {
    const hs = this._host?.state.get();
    if (hs?.filePath) return { path: hs.filePath, kind: "file" };
    const state = this.state.get();
    if (state.folderPath) return { path: state.folderPath, kind: "folder" };
    if (state.filePath) return { path: state.filePath, kind: "file" };
    return { path: hs?.title ?? this.title, kind: "file" };
}
```

`currentFileName()` must remain the file-compatible projection of that accessor, so all existing
file behavior stays intact. `findCompatibleEditors()` must select merged folder peers for a folder
source and retain its existing built-in/file behavior for a file source. `recomputeMatches()` must
dispatch to the new folder catalog selector or the existing file selector. The current
availability/auto-switch pair, `openBoard`, registration, and restore/recomputation path must
also consult `currentSource()` rather than reading `filePath` directly. A title may label a tab,
but it must never substitute for the absolute folder anchor.

### Download, registration, and trust timing

`downloadBoard` writes the archive to `<install-parent>/<catalog-id>`, validates the extracted
manifest, and records only the installed root/id/version in `boardInstallRegistry`
([`board-install.ts:37-82`](../../../src/renderer/api/board-install.ts:37)). The install registry
is intentionally independent from trust: a downloaded board is inert until registration
([`board-install-registry.ts:1-13`](../../../src/renderer/api/board-install-registry.ts:1)).
Consequently the folder anchor must remain in Board Info state; it must not be inferred from the
new install root.

`register` currently trusts the root, emits the installed event, awaits
`customEditorRegistry.refresh()`, and only then switches a host-held page into the new virtual
board; a host-less page instead enters properties mode
([`BoardInfoEditorModel.ts:531-554`](../../../src/renderer/editors/board-info/BoardInfoEditorModel.ts:531)).
For a folder source, the new branch must preserve the captured `folderPath`, await the refresh,
validate that the refreshed trusted registry contains the new root and that
`getBoardsForFolder(folderPath)` contains the same board, and only then call
`page.switchMainEditor(boardEditorId(root))`. The lifecycle has the same current-entry and
folder-claim validation before construction
([`PagesLifecycleModel.ts:122-139`](../../../src/renderer/api/pages/PagesLifecycleModel.ts:122));
the Board Info check makes the install boundary explicit and prevents a stale registry id from
being treated as trustworthy during the refresh window.

If the trust dialog, namespace confirmation, or the post-refresh claim validation is cancelled or
fails, registration must return without clearing `folderPath` or replacing the current Board Info
editor. The page can then select Folder View. A catalog entry is eligible only if the folder
selector’s `minAppVersion` check passes; the existing file selector and file “+” flow are not
changed.

### Persistence and Board Info metadata

`BoardEditorModel` already persists folder-board `boardRoot` and `folderPath` independently while
pinning the descriptor id to stable `board-view`
([`BoardEditorModel.ts:545-579`](../../../src/renderer/editors/board/BoardEditorModel.ts:545)).
That is not the same as the install page: a folder Board Info editor is host-less, but
`board-info` is currently absent from `NO_HOST_EDITOR_IDS`
([`PagesPersistenceModel.ts:31-39`](../../../src/renderer/api/pages/PagesPersistenceModel.ts:31)).
The generic restore path drops a descriptor with neither `host` nor a no-host id
([`PagesPersistenceModel.ts:149-196`](../../../src/renderer/api/pages/PagesPersistenceModel.ts:149)).
Do not add `board-info` to that broad no-host set: doing so would also restore the existing
host-less file Board Info descriptor, changing the file “+” flow. Instead, add a narrow restore
branch keyed by `d.editorId === "board-info"` and a persisted string `state.folderPath`; create
Board Info, apply its durable state, and call `restore()` through that folder-only path. Leave the
existing host and no-host branches unchanged when `folderPath` is absent, so the current
host-less file behavior remains unchanged. This does not alter `board-view` restore validation.

The runtime Board Info properties shape currently exposes only file association fields in
`BoardPropsInfo`/`loadProperties`
([`BoardInfoEditorModel.ts:39-64`](../../../src/renderer/editors/board-info/BoardInfoEditorModel.ts:39),
[`BoardInfoEditorModel.ts:272-317`](../../../src/renderer/editors/board-info/BoardInfoEditorModel.ts:272)),
and the view renders only file masks in install tiles and properties
([`BoardInfoEditorView.ts:215-237`](../../../src/renderer/editors/board-info/BoardInfoEditorView.ts:215),
[`BoardInfoEditorView.ts:342-367`](../../../src/renderer/editors/board-info/BoardInfoEditorView.ts:342)).
The declarations already contain the direct-folder fields, but the runtime
`BoardInfoEditorFacade.copyMatch` currently omits them
([`BoardInfoEditorFacade.ts:187-234`](../../../src/renderer/scripting/api-wrapper/BoardInfoEditorFacade.ts:187)).
The implementation must copy and display `folderEditorMasks` separately from legacy
`folderMasks`, both for catalog tiles and installed properties, without relabeling the legacy
file-parent narrowing field.

## Implementation Plan

### 1. Add the folder-keyed catalog selector

In `src/renderer/api/published-boards.ts`:

- Import and reuse `matchesFolderEditorMasks` from
  `src/renderer/editors/board/board-manifest.ts`.
- Add `catalogBoardsForFolder(folderPath: string): PublishedBoardInfo[]` beside
  `catalogBoardsForFile`. Filter `minAppVersion` with the existing `isCompatible` check and
  match the already-normalized `board.folderEditorMasks` against the absolute folder. Treat an
  absent field as an empty mask list. Do not call `normalizeFolderMasks` in this selector.
- Add `subscribeCatalogBoardsForFolder(folderPath, listener)` with the same state-selector
  subscription shape as `subscribeCatalogBoardsForFile`.
- Keep `normalizeCatalog` as the one normalization point for both initial and broadcast catalogs;
  do not change the existing file predicate, which must continue to use `fileMasks` plus the
  narrowing-only `folderMasks`.

Before → after selector shape:

```ts
// Before: only a file-name key exists.
catalogBoardsForFile(fileName: string): PublishedBoardInfo[];
subscribeCatalogBoardsForFile(fileName: string, listener: () => void): () => void;

// After: the direct-folder axis has a parallel key, with no second normalization.
catalogBoardsForFolder(folderPath: string): PublishedBoardInfo[];
subscribeCatalogBoardsForFolder(folderPath: string, listener: () => void): () => void;
```

### 2. Put the catalog “+” entry into the folder switch projection

In `src/renderer/editors/base/editor-switch-options.ts`, extend only the existing
`model.folderAnchor !== undefined` branch:

1. Get `catalogBoardsForFolder(folderPath)` and retain only entries that are not represented by
   a trusted matching board. Follow the file branch’s established dedup rule: compare the
   installed entry’s root with the current trusted folder matches using
   `fpNormalizeForCompare`; an installed-but-untrusted or installed-but-not-claiming board is
   still an install candidate for this folder.
2. Append `BOARD_INFO_EDITOR_ID` only when at least one compatible catalog folder match remains.
   Keep the existing folder candidate order: built-ins from `getFolderEditorsForFolder` first,
   then trusted boards in registry order. The “+” entry is last, after any de-duplication.
3. Preserve the current revoked-board recovery option from US-1431. It is allowed only for the
   currently mounted virtual board and never authorizes a new board target.
4. Leave the entire file branch behavior unchanged, including its catalog file predicate,
   locality gate, installed/trusted deduplication, and final plus-last normalization.

Before → after folder branch:

```ts
// Before: folder pages stop before catalog lookup.
if (folderPath !== undefined) {
    const merged = [...getFolderEditorsForFolder(folderPath)];
    // trusted board labels and revoked-current recovery...
    return merged.map((id) => ({ id, label: editorRegistry.getById(id)?.name ?? id }));
}

// After: the same folder candidates are followed by a conditional, final Board Info entry.
if (folderPath !== undefined) {
    const boardMatches = customEditorRegistry.getBoardsForFolder(folderPath);
    const merged = [...getFolderEditorsForFolder(folderPath)];
    // preserve trusted-list order and current-board recovery
    const trustedRoots = new Set(
        boardMatches.map((board) => fpNormalizeForCompare(board.boardRoot)),
    );
    const catalogMatches = publishedBoards.catalogBoardsForFolder(folderPath).filter((board) => {
        const installedEntry = boardInstallRegistry.listInstalled()
            .find((entry) => entry.id === board.id);
        return !installedEntry
            || !trustedRoots.has(fpNormalizeForCompare(installedEntry.root));
    });
    const boardNameById = new Map(boardMatches.map((board) => [board.editorId, board.name]));
    if (catalogMatches.length > 0) merged.push(BOARD_INFO_EDITOR_ID);
    const plusIndex = merged.indexOf(BOARD_INFO_EDITOR_ID);
    if (plusIndex !== -1 && plusIndex !== merged.length - 1) {
        merged.splice(plusIndex, 1);
        merged.push(BOARD_INFO_EDITOR_ID);
    }
    return merged.map((id) => ({
        id,
        label: boardNameById.get(id) ?? editorRegistry.getById(id)?.name ?? id,
    }));
}
```

The actual implementation should use the existing local data structures and explicit code style
rather than introduce a generic abstraction solely for this branch. The folder “+” title may say
“folder” rather than “file”; its id and final ordering remain the existing Board Info contract.

In `src/renderer/editors/base/PageToolbarView.ts`, make the catalog subscription key represent
both kind and path. When `model.folderAnchor` exists, subscribe with
`publishedBoards.subscribeCatalogBoardsForFolder`; otherwise keep
`getEditorSwitchFileName` and `subscribeCatalogBoardsForFile` exactly as today. Keep the existing
`customEditorRegistry.state` and `boardInstallRegistry` subscriptions: they are what update the
toolbar after trust refresh and install-registry changes
([`PageToolbarView.ts:229-304`](../../../src/renderer/editors/base/PageToolbarView.ts:229)).

Before → after subscription selection:

```ts
// Before: every toolbar subscribes to the file-keyed catalog.
const fileName = getEditorSwitchFileName(this.model);
this.ensureCatalogSubscription(fileName);

// After: folder identity selects the folder-keyed subscription.
const folderPath = this.model.folderAnchor;
this.ensureCatalogSubscription(
    folderPath !== undefined
        ? { kind: "folder", path: folderPath }
        : { kind: "file", path: getEditorSwitchFileName(this.model) },
);
```

### 3. Capture and use the folder through one Board Info accessor

In `src/renderer/editors/board-info/BoardInfoEditorModel.ts`:

- Add optional `folderPath` to `BoardInfoEditorState` with the meaning “claimed folder”, never
  install root. Add `folderAnchor` returning that state field so the folder toolbar branch also
  applies while Board Info is active.
- In `switchFrom`, read `oldEditor.folderAnchor` before the host/file logic. If defined and
  `oldEditor.contentHost` is absent, store it in `state.folderPath`, set the display title from
  its basename, and return. The `!oldEditor.contentHost` guard enforces D6 at this handoff site;
  it prevents inherited `folderAnchor` state on `BoardContentEditorModel` from skipping host
  adoption. The current content-host adoption and host-less `filePath` capture remain unchanged
  for file sources ([`BoardContentEditorModel.ts:26`](../../../src/renderer/editors/board/BoardContentEditorModel.ts:26)).
- Add the single `{ path, kind }` source accessor described in Background. Route
  `currentFileName`, `findCompatibleEditors`, `recomputeMatches`, `openBoard`, registration,
  auto-switch availability, and restore/recomputation through it. A folder source must use
  `getFolderEditorsForFolder` and `catalogBoardsForFolder`; it must never pass the folder to
  `editorRegistry.resolveId` or `catalogBoardsForFile`.
- For a folder source, `findCompatibleEditors` returns the merged folder peers; the switch-option
  helper owns the conditional catalog “+” entry. For a file source, preserve the current
  built-in result and `BOARD_INFO_EDITOR_ID` behavior.
- Change the current `shouldAutoSwitch` equivalent to recognize a folder source when no eligible
  catalog matches remain, and have `autoSwitchToNatural` return to the first Folder View/built-in
  folder candidate. The file host path and natural file resolver remain unchanged.
- Persist `folderPath` in `getRestoreData` and restore it in `applyRestoreData`. The install page’s
  folder identity must survive a restart even though it has no content host.

Before → after `switchFrom` identity capture:

```ts
// Before: a host-less source can only retain a file.
if (!trait) {
    const fp = oldEditor.filePath;
    if (fp) this.state.update((s) => { s.filePath = fp; });
    return;
}

// After: folder identity is captured first; the existing file branch is retained.
const folderPath = oldEditor.folderAnchor;
if (folderPath !== undefined && !oldEditor.contentHost) {
    this.state.update((s) => {
        s.folderPath = folderPath;
        s.title = fpBasename(folderPath);
    });
    return;
}
if (!trait) {
    const fp = oldEditor.filePath;
    if (fp) this.state.update((s) => { s.filePath = fp; });
    return;
}
```

The folder “+” handler in `src/renderer/editors/base/editor-switch.ts` must be moved before the
folder branch, preserving the existing `createEditor` → `switchFrom` → `restore` → `setMainEditor`
sequence. The folder branch remains the authority for folder targets and continues to reject
unlisted or stale board ids. This is the explicit resolution of the US-1431 trap.

In `src/renderer/editors/board-info/open-board-info.ts`, pass the existing `old.folderAnchor` into
the new Board Info state when the explicit Properties action opens from a folder board. This
retains folder context for the properties page without changing the file host transfer path. The
“+” path itself must continue to enter through `switchMainEditor`, so D8’s `switchFrom` capture is
not bypassed.

### 4. Preserve folder identity through Download → Register → switch

In `BoardInfoEditorModel.register`:

1. Capture `const source = this.currentSource()` before awaiting trust UI or registry work.
2. Keep the current trust dialog, namespace confirmation, and `boardTrust.trust(root)` sequence.
3. Await `customEditorRegistry.refresh()` before treating `boardEditorId(root)` as a valid target.
4. For `source.kind === "folder"`, require a current trusted entry for the root and a matching
   entry in `customEditorRegistry.getBoardsForFolder(source.path)`, using normalized root comparison
   where appropriate. If either check fails, notify/return with the Board Info editor and
   `folderPath` intact; do not construct or switch a board.
5. Signal `installed` after registration succeeds so the existing interactive install API can
   resolve, then switch the folder page to `boardEditorId(root)`. The lifecycle and switch checks
   validate again, so no stale virtual id can construct a board.
6. Keep the existing host-held file branch and standalone properties branch behavior unchanged.

The identity at each hop must be explicit:

| Hop | Authoritative identity | Where held |
|---|---|---|
| Folder editor → Board Info | Claimed absolute folder | `oldEditor.folderAnchor` → Board Info `state.folderPath` |
| Download | Claimed folder unchanged; install root newly created | Board Info state + `boardInstallRegistry` root/id record |
| Register/trust | Install root becomes trusted, but is not the claimed folder | `boardTrust`, then refreshed `customEditorRegistry.entries` |
| Switch | Folder claim is revalidated against the refreshed registry | `currentSource().path` → `switchMainEditor` → `createEditorFromFolder` |
| New folder board | Board root and claimed folder remain independent | `BoardEditorModel.state.boardRoot` + `state.folderPath`; bridge `getFolderPath()` |

### 5. Restore folder Board Info without changing the file “+” flow

In `src/renderer/api/pages/PagesPersistenceModel.ts`, do not add the non-virtual `board-info` id
to `NO_HOST_EDITOR_IDS`. Add a narrow branch before the generic `d.host` branch that recognizes
only `d.editorId === "board-info"` with a persisted string `state.folderPath`; create Board Info,
apply its durable state, and call `restore()` so folder-keyed matches are recomputed. If
`folderPath` is absent, retain the existing host, Explorer, no-host, and drop behavior. This
folder-only gate is required because broadening `NO_HOST_EDITOR_IDS` would restore the existing
host-less file Board Info page and strand it: `shouldAutoSwitch()` and
`autoSwitchToNatural()` currently require `_host.filePath`
([`BoardInfoEditorModel.ts:578-593`](../../../src/renderer/editors/board-info/BoardInfoEditorModel.ts:578)).
The persistence discriminator only decides whether this folder descriptor is constructible; once
the model exists, its identity reads still go through D8’s single `currentSource()` accessor.
No change is made to the existing stable `board-view` restore/revalidation logic or to its
Folder View fallback
([`PagesPersistenceModel.ts:88-122`](../../../src/renderer/api/pages/PagesPersistenceModel.ts:88),
[`PagesPersistenceModel.ts:207-237`](../../../src/renderer/api/pages/PagesPersistenceModel.ts:207)).

In `src/renderer/editors/board-info/BoardInfoEditorModel.ts` and
`src/renderer/editors/board-info/BoardInfoEditorView.ts`:

- Add `folderEditorMasks` and `folderEditorPriority` to the runtime installed-properties shape
  from the normalized `getBoardEditorAssociation` result.
- Render direct folder claims under a separate “Folder”/“Folder editor” label in catalog tiles and
  properties. Keep legacy `folderMasks` nested with file masks and labeled as file scope.
- Use folder-specific empty-state wording when the current source is a folder, while leaving the
  existing file wording unchanged.

In `src/renderer/scripting/api-wrapper/BoardInfoEditorFacade.ts`, copy the direct-folder fields in
both the catalog match and installed-properties projections. The declarations in
`src/renderer/api/types/board-info-editor.d.ts`, `boards.d.ts`, and `board-editor.d.ts` already
contain these fields from US-1429; they need no schema redesign.

### 6. Verify the final task and hand off the epic checklist

Source inspection and the existing object-model/live-window approach are the only verification
methods. No unit tests or harnesses are proposed. At minimum, inspect these cases:

- folder catalog normalization is applied once at both catalog ingress points;
- folder masks match the absolute folder itself, `minAppVersion` is enforced, and installed/trusted
  deduplication uses normalized roots;
- file catalog lookup, file “+”, `folderMasks` narrowing, and content-host file boards are
  unchanged;
- Board Info “+” is handled before the folder branch and captures Folder View, Git Tree, Mneme,
  and folder-board anchors;
- Download leaves the anchor unchanged, Register waits for the refreshed trusted registry, and
  the installed board is switched only when the current manifest still claims the folder;
- cancelled trust/registration, incompatible catalog entries, missing folders, stale trust, and
  failed claim validation leave a usable Folder View path;
- a folder Board Info descriptor restores through the new no-host path, while a folder board still
  restores through stable `board-view` with independent `boardRoot`/`folderPath`;
- the runtime Board Info facade and view expose direct folder claims separately from file scope.

#### EPIC-103 §8 items still unverified at this handoff

This is an investigation/document task and does not implement or exercise the flow. The following
remain for epic close:

| §8 item | Handoff status |
|---|---|
| Trusted folder board appears beside Folder View; priority 1/20/21 behavior | Source seams exist from US-1429/1431; live behavior remains unverified. |
| Existing file masks/folder narrowing remain unchanged | Source-preservation plan recorded; regression behavior remains unverified. |
| Generic folder link and `getFolderPath()` round trip | Delivered by US-1430; live bridge behavior remains unverified. |
| Folder editor switching without file-branch/panel regressions | Delivered by US-1431; live transitions remain unverified. |
| Trust revocation removes candidates while an open board can leave | Source path exists; asynchronous live behavior remains unverified. |
| Folder catalog “+”, Download → Register, and folder preservation | Not implemented in this task; entirely unverified. |
| Cancelled registration, incompatible catalog, missing folder, malformed link | Folder install cases remain unverified; malformed-link handling belongs to prior-task live checks. |
| Restart restore with stable `board-view`, independent paths, and fallback | Source path exists; restart behavior remains unverified. |
| Board-side/API/facade/catalog metadata parity | Existing declarations/transport were inspected; final runtime parity remains to be checked after implementation. |

## Concerns

- **Switch ordering is security and correctness relevant.** `BOARD_INFO_EDITOR_ID` must be handled
  before the folder branch. It is an install UI target, not a folder editor, and must not be added
  to the trusted folder candidate list merely to make the click work.
- **Remote catalog versus trusted registry.** Catalog masks can advertise an install candidate;
  only a refreshed trusted registry entry may construct a board. The installed manifest, not the
  catalog copy, is authoritative after extraction and registration.
- **Asynchronous refresh window.** Existing toolbar subscriptions may briefly display the previous
  registry projection while refresh is pending. The UI must remain reactive to
  `customEditorRegistry.state`, while the post-registration switch waits for and checks the fresh
  projection. An already-open revoked board must retain its folder anchor so Folder View remains
  selectable.
- **One source accessor.** Do not add five independent `folderPath` conditionals to D8’s named
  sites. `currentSource()` owns the kind/path decision; persistence copies the two durable fields
  independently, and titles remain presentation-only.
- **Host-less Board Info restore.** Restore only descriptors with persisted `folderPath` through a
  folder-specific Board Info branch. Do not add `board-info` to the broad no-host restore set:
  host-less file Board Info remains dropped on restart, preserving the existing file “+” behavior.
- **Scope.** Do not build `.vscode`, `.github`, `node_modules`, a build-output board, or any other
  concrete board. Do not add tests or a test harness. Do not change the three built-in folder
  schemes, the file “+” flow, or the catalog publisher outside this repository.

There are no unresolved design questions. D8 resolves the identity representation, the source
inspection resolves the current `canOpenBoard` naming discrepancy, and the current switch order
resolves the US-1431 trap.

## Acceptance Criteria

- [ ] `catalogBoardsForFolder` and its subscription match normalized direct folder claims, enforce
      `minAppVersion`, and reuse the existing ingress normalization for both initial and broadcast
      catalogs.
- [ ] Folder switch options preserve built-ins-then-trusted-board order and append
      `BOARD_INFO_EDITOR_ID` last only when an eligible published folder board is not already
      trusted for that folder; the file branch is unchanged.
- [ ] `BOARD_INFO_EDITOR_ID` is handled before the folder branch in `switchMainEditor`, so a folder
      “+” click reaches `BoardInfoEditorModel.switchFrom` instead of the folder-target rejection.
- [ ] Board Info captures a folder through `folderAnchor`, exposes it as `folderAnchor`, and all
      D8 identity reads use one `{ path, kind }` accessor; `filePath` retains its existing meaning.
- [ ] Download preserves the captured folder; registration awaits registry refresh, validates the
      current trusted root and folder claim, and switches into the new folder board only after
      validation.
- [ ] Cancelled registration, incompatible/missing catalog context, and failed post-refresh claim
      validation leave Board Info with enough folder identity to return to Folder View.
- [ ] Folder Board Info descriptors with persisted `folderPath` restore through the folder-only
      path; host-less file Board Info behavior remains unchanged; folder boards continue to use
      stable `board-view` persistence with independent `boardRoot` and `folderPath`.
- [ ] Board Info catalog/properties metadata and facade output show `folderEditorMasks` separately
      from legacy `folderMasks`; existing declarations and transport remain compatible.
- [ ] No concrete board, publisher change, unit test, or test harness is added, and the §8 items
      listed above are verified before EPIC-103 closes.

## Files intentionally unchanged

- `src/renderer/editors/board/board-manifest.ts` — US-1429’s direct-folder normalization and
  `matchesFolderEditorMasks` predicate are reused; no second normalization or schema change.
- `src/main/published-boards-service.ts`, `src/ipc/api-param-types.ts`, and
  `src/renderer/api/boards.ts` — catalog transport and public mapping already carry the fields
  and defensively validate remote input.
- `src/renderer/editors/board/custom-editor-registry.ts` — trusted folder projection and merged
  resolver are consumed; trust refresh and generation behavior are not redesigned.
- `src/renderer/api/pages/PagesLifecycleModel.ts`, `src/renderer/editors/board/BoardEditorModel.ts`,
  and the folder link/bridge files delivered by US-1430/1431 — folder construction, current-trust
  validation, `getFolderPath()`, and stable `board-view` persistence are reused.
- `src/renderer/editors/category/CategoryEditorModel.ts`,
  `src/renderer/editors/git-tree/GitTreeEditorModel.ts`, and
  `src/renderer/editors/mneme-root/MnemeRootEditorModel.ts` — the three built-in folder editors
  keep their existing anchors and links.
- `src/renderer/api/pages/PageModel.ts` — the shared `setMainEditor`/switch delegate remains the
  page entry point.
- `src/renderer/editors/register-editors.ts` — built-in registration and Board Info’s existing
  `hasContentHost` declaration remain unchanged.
- `src/renderer/api/types/board-info-editor.d.ts`, `src/renderer/api/types/boards.d.ts`, and
  `src/renderer/api/types/board-editor.d.ts` — the direct-folder fields already shipped in the
  declarations; only runtime copying/display is completed here.
- `src/renderer/content/git-tree-link.ts`, `mneme-folder-link.ts`,
  `tree-providers/tree-provider-link.ts`, and `folder-editor-link.ts` — no built-in or generic
  folder link format changes.
- Any `.vscode`, `.github`, other concrete board, unit-test, or test-harness files.

## Files Changed

| File | Planned change |
|---|---|
| `src/renderer/api/published-boards.ts` | Add normalized folder catalog lookup and reactive subscription. |
| `src/renderer/editors/base/editor-switch-options.ts` | Add conditional folder “+” projection while preserving file behavior and ordering. |
| `src/renderer/editors/base/editor-switch.ts` | Move the existing Board Info handler before the folder branch. |
| `src/renderer/editors/base/PageToolbarView.ts` | Subscribe to the file- or folder-keyed catalog based on the model anchor. |
| `src/renderer/editors/board-info/BoardInfoEditorModel.ts` | Capture/persist folder identity through one accessor; match, register, validate, switch, restore, and expose folder properties. |
| `src/renderer/editors/board-info/BoardInfoEditorView.ts` | Render direct folder claims separately and use folder-aware empty-state copy. |
| `src/renderer/scripting/api-wrapper/BoardInfoEditorFacade.ts` | Copy direct folder catalog/properties fields at runtime. |
| `src/renderer/api/pages/PagesPersistenceModel.ts` | Restore only Board Info descriptors with persisted `folderPath` through a folder-specific branch; leave the broad no-host set and file behavior unchanged. |
| `src/renderer/editors/board-info/open-board-info.ts` | Pass a folder editor’s existing `folderAnchor` into explicit Board Info properties opens. |
| `doc/active-work.md` | Link US-1432 under active EPIC-103 work. |
| `doc/epics/EPIC-103.md` | Link US-1432 to this task document and mark it Active. |
| `doc/tasks/US-1432-folder-catalog-and-install/README.md` | Record the source-verified investigation and implementation plan. |
