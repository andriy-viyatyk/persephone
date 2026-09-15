# EPIC-103: Boards as folder editors

## Status

**Status:** Active
**Created:** 2026-09-15
**Completed:**

## Overview

[EPIC-102](EPIC-102.md) made a folder something an editor can register for, and shipped three
built-in claimants: Folder View, Git Tree and Mneme. It deliberately stopped there. This epic opens
the same door to **boards**: a trusted board declares that it handles a kind of folder, receives
that folder's absolute path, appears in the folder page's editor switch beside Folder View, and —
when a *published* board matches a folder the user has no board for — is offered through the same
**"+"** install entry that already exists for files.

`.vscode` is the motivating example. `.github`, `node_modules` and a build-output directory are the
shape of the rest. None of them is designed here: the deliverable is the contract, not a board.

**Full investigation: [EPIC-103-investigation-notes.md](EPIC-103-investigation-notes.md).** It was
written as a single task (US-1428) and promoted to an epic because the evidence showed the work
spans manifest parsing, catalog transport, two registry merge points, a new link scheme, the board
IPC handshake, the switch, the install flow, persistence, and three authoring guides. Its §8 is the
verification list this epic is checked against; its Concerns are the open risks.

## Why none of it works today

Four structural facts, each verified against the source:

- **Folder resolution never sees boards.** `resolveForFolder` / `getFolderEditors` iterate the
  built-in `definitions` map. A board is a *virtual* `board-editor:<root>` id living in
  `customEditorRegistry` — for files, `resolveEditorIdForFile` explicitly merges the two registries;
  for folders there is no such merge.
- **A manifest cannot claim a folder.** `fileMasks`, `folderMasks` and `contentMasks` all match a
  *file*; `folderMasks` only narrows a file mask to the file's parent.
- **A board is constructed file-shaped.** `initFromBoardRoot(boardRoot, filePath)` →
  `persephone.getFilePath()`. There is no folder equivalent anywhere in the bridge.
- **The switch and "+" are file-name keyed.** `getEditorSwitchOptions` derives a file name from the
  host/model path or title, and `catalogBoardsForFile` filters the catalog by it. On a folder page
  that name is absent (Git Tree keeps `repoRoot`) or a base64 `tree-category://` blob.

## Goals

- A trusted board can claim a folder through its manifest, and win or share that folder by an
  explicit, deterministic priority against the three built-ins.
- A folder board receives the claimed folder as an absolute path, distinct from its own install
  root, through a new `persephone.getFolderPath()`.
- A folder page's toolbar lists the board alongside Folder View and switches both ways.
- An uninstalled published board matching the folder is offered through the existing "+" entry,
  and the folder identity survives Download → Register → switch.
- Every existing file-associated board behaves exactly as before; `folderMasks` keeps its
  narrowing-only meaning.

## Decisions

**D1 — A distinct manifest axis, never an overloaded `folderMasks`.**
`folderEditorMasks` + `folderEditorPriority`. Reusing `folderMasks` would silently turn every
existing `folderMasks`-carrying manifest into a folder editor. Verbose, and unambiguous.

**D2 — The merge lives beside the custom registry, not inside `EditorRegistry`.**
`custom-editor-registry.ts` already imports `editorRegistry`; making the base registry import the
custom one would create the cycle the existing file merge exists to avoid. Folder resolution gains
merged siblings of `resolveEditorIdForFile`, and `EditorRegistry.resolveForFolder` stays a pure
built-in primitive.

**D3 — Priority is strict, and built-ins win ties.** Folder View is the 0 floor; Git Tree and Mneme
are 20. A board needs `> 0` to take an ordinary folder and `> 20` to displace Git or Mneme, matching
the file resolver's built-in-tie rule. A board below the winning priority is still a *switch*
candidate — losing the default is not the same as being unavailable.

**D4 — The generic `folder-editor://` scheme, finally built.**
EPIC-102 left folder editors one scheme-plus-parser each, which a board cannot own. One parser
decodes `{ editorId, anchorFolder }` and sets `data.target`. The three built-in schemes keep working
unchanged.

**D5 — `getFolderPath()` is a new API, not a widened `getFilePath()`.**
Returning a directory from a method named `getFilePath` would break existing simple boards and make
the name false. Two paths, two methods, both documented.

**D6 — Folder mode never uses `BoardContentEditorModel`.**
`editorKind: "content-host"` describes ownership of *file content*. A folder has no text host, so
folder construction always builds the plain `BoardEditorModel`; a board may still declare a
content-host file association on its other axis.

**D7 — Board API documentation goes in the prose guides, not `board-api.d.ts`.**
That file is unwired — nothing references it, it is not in Monaco's extraLibs — and by standing user
decision it is not kept in sync with the bridge surface, because boards are agent-authored. This
overrides the investigation notes' §4, which proposed adding declarations to it.

**D8 — Board Info captures the folder the way it already captures a file.**
*(User decision, 2026-09-15: "can we add path (folder or file) to that editor that opens by '+'
button click? maybe in this way page (editor) will not lose the path?")*

It does this for files already. `BoardInfoEditorModel.switchFrom:199-221` has a host-less branch —
added in US-876 for the Archive viewer opening a zip-based `.xlsx` — that captures
`oldEditor.filePath` into its own persisted `state.filePath`, so the install page can still match
catalog editors, keep the file's real built-in peer in the switch, and keep the tab name. A folder
board is the same case with a directory: `switchFrom` captures the outgoing editor's `folderAnchor`
(built-in folder editor) or `folderPath` (folder board) into a new persisted `state.folderPath`.

`filePath` keeps its meaning and its persistence, so nothing about the file flow changes. But every
read goes through ONE accessor returning `{ path, kind: "file" | "folder" }` rather than a parallel
`folderPath` branch at each site: `currentFileName()`, `findCompatibleEditors()`,
`recomputeMatches()`, the `canOpenBoard` check (`:585-589`) and the restore path all consult
`filePath` today, and five separate file-versus-folder branches is how this gets subtly wrong.

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| [US-1429](../tasks/US-1429-folder-claims-in-manifest/README.md) | Folder claims in the manifest: `folderEditorMasks`, catalog transport, and merged trusted folder resolution | Active |
| [US-1430](../tasks/US-1430-folder-board-construction/README.md) | Constructing a folder board: the generic `folder-editor://` link, the lifecycle path, and `getFolderPath()` | Active |
| [US-1431](../tasks/US-1431-folder-switch-and-persistence/README.md) | The folder editor switch and folder-board persistence | Active |
| [US-1432](../tasks/US-1432-folder-catalog-and-install/README.md) | The folder-keyed catalog and the "+" install flow through Board Info | Active |

The split follows the investigation notes' Concern 1. US-1429 is the data layer and lands inert.
US-1430 makes a folder board openable. US-1431 makes it reachable from the toolbar and restorable.
US-1432 adds the install path, which is the most fragile part and benefits from the rest existing.

## Concerns / Open Questions

1. **Board Info remains the most delicate part, but no longer an open question.** D8 settles how
   the identity survives the "+" click. What still needs care in US-1432 is the rest of the
   round trip: the captured folder must survive Download → Register → switch into the newly
   installed board, and a cancelled registration must leave the page able to return to Folder View.
2. **Trust refresh is asynchronous.** `customEditorRegistry.refresh` is already driven by
   `boardTrust`, but folder UI must subscribe to the same reactive state and behave during the
   refresh window. An already-open board that loses trust must stay able to leave its page.
3. **A stale or hand-written link must not construct a board.** Every caller has to validate the
   decoded `editorId` against the *current* trusted registry, because a virtual board id encodes a
   machine-specific path.
4. **Restore keeps the stable `board-view` id.** No virtual id may enter `NO_HOST_EDITOR_IDS`; the
   claimed folder is persisted beside `boardRoot` and must never be inferred from it.
5. **The catalog schema is outside this repository.** The published-boards service must treat the
   new fields as untrusted input and normalize them client-side.
6. **Scope discipline.** No `.vscode` (or any other) board is built here, in this repo or the boards
   repo. If one is wanted as a proof, it is separate work in `persephone-boards`.

## Notes

### 2026-09-15
- Opened at the user's request immediately after EPIC-102 closed, from their question about whether
  a board could now register for a folder, be shown on the editor switch, and be offered through
  "+" when a published board matches a folder kind. The answer was no on all three counts, for the
  four reasons above.
- Investigated as US-1428 and promoted to an epic on the evidence — 26 files across seven
  subsystems. The task id was retired rather than padded; the four tasks above replace it.
- D7 corrects the investigation's only finding that conflicted with a standing decision: board API
  surface is documented in prose, never in the unwired `board-api.d.ts`.
