# EPIC-164: Refactoring Phase 6.4 part 2 — editor framework: source watching, `VideoStreamSession`, shared image actions, `TextEditorPageView` and grid codecs

## Status

**Status:** Completed
**Created:** 2026-11-13

## Overview

This is the twenty-fourth epic of the [refactoring roadmap](../refactoring-roadmap.md) and the second part of roadmap
item **6.4, Editor framework**. Part 1 ([EPIC-163](EPIC-163.md)) landed the framework core in `editors/base/`
(typed ids, one matcher contract, `EditorCatalog`, switch strategies, a slimmer `EditorModel`, typed editor modules).
The remaining findings (EDC-7 steps 2 and 4, EDC-8 to EDC-14 in
`doc/reviews/refactoring-2026-11/07-editors-core.md`) are eight; they do not fit one epic.

**This epic takes the per-editor internals:** EDC-12 (source watching), EDC-13 (video stream sessions), EDC-8 (image
actions), EDC-7 steps 2 and 4 (shared text-editor page view) and EDC-14 (grid codecs). **Part 3** (below) takes the
sidebar-panel cluster EDC-9, EDC-10 and EDC-11, which belong together: the Explorer split (EDC-10) needs the panel
views without IO (EDC-9) and the tree-provider host trait (EDC-11) builds on the Explorer owning its provider (EDC-9
step 3).

The code was checked on 2026-11-13, after EPIC-163. Line numbers in the report have drifted; the current state:

- **Source watching** is wired by hand in `editors/content-host/TextFileIOModel.ts` (432 lines),
  `editors/image/ImageEditor.ts` (368) and `editors/video/VideoEditor.ts` (499), each with `pipe.watch`,
  `watchSourceRecovery` and `watchSourceMove` (`content/source-recovery.ts`) and their own unsubscribe fields.
- **`VideoEditor.ts`** still holds the stream-session state machine, temporary-recording handling and the module-level
  `sessionMuted`. EDC-13 step 4 is already done: the pipe-resource server lives in `content/pipe-resource-server.ts`.
- **Image actions:** SVG (`svg/index.ts` 151), Mermaid (`mermaid/index.ts` 249), HTML (`html/index.ts` 242) and Image
  (`image/ImageToolbarView.ts` 174) each build their own export toolbar; `editors/shared/image-export.ts` (153) mixes
  raster helpers, clipboard IPC and dialogs and is imported by `uikit/ImageViewport/ImageViewportView.ts`.
- **Text-editor page shell:** `TextChromeView` (462) is composed by hand in ten editors' `index.ts`; "Show resources"
  (`ShowResourcesButtonView`) is HTML-only logic in the generic chrome.
- **Grid:** `GridEditor.ts` (954) has inline JSON/JSONL/CSV parse and serialise, `detectCsvDelimiter`, the
  `_pendingLegacySettings` migration and the double grid publication (`setGrid` + `onModel`).

## Goals

- **One source-watch helper** (`content/source-watch.ts`): `watchPipeSource(pipe, { onChanged?, onRecovered?,
  onMoved? }, label)` returning one disposer, and `movedSource(...)` for the archive-entry-aware moved-file rebuild,
  used by the text host, Image and Video. `TextFileIOModel.ensurePipe` uses `pipeFromSourcePath`.
- **`VideoStreamSession`** (`editors/video/VideoStreamSession.ts`) owning request ids, the active session and pipe
  resource, recovery and IPC; temporary-recording helpers shared with main's naming rule; mute owned outside module
  scope.
- **Shared image actions:** `editors/shared/image-actions.ts` (`ImageActions`) and one `ImageActionsToolbarView`; pure
  raster code in `core/utils/image-raster.ts`, which removes the UIKit ↔ editors cycle; HTML keeps its non-headless
  export inside `HtmlEditor.exportPng`.
- **`TextEditorPageView<M>`** in `editors/base/` with `createParts(model)`, adopted by the text editors; "Show resources"
  becomes an HTML contribution using `toFileUrl`; one main-view file name rule written into `editor-guide.md`.
- **Grid codecs** (`editors/grid/formats/`), the legacy-settings promotion moved out of the model or removed, the toolbar
  reading `model.grid`, the hard-coded English error localised, `util.ts` merged into `utils/`.

## Decisions this epic acts on

- **Scope: five tasks, editor internals only.** The sidebar-panel cluster (EDC-9, 10, 11) is part 3: it changes
  persisted page flags (`boardsOpen`/`clipboardOpen` need a migration) and the panel ownership model, which is a
  different risk profile from the per-editor work here.
- **Order.** US-1934 source watch → US-1935 `VideoStreamSession` (uses the helper) → US-1936 image actions → US-1937
  `TextEditorPageView` (SVG/Mermaid/HTML toolbars are simpler once 1936 replaced them) → US-1938 grid codecs (Grid
  adopts the page view in 1937; 1938 then drops `onModel`).
- **Behaviour is kept.** Event filtering differences stay as callback logic (text ignores "available"/"moved"
  events as today; Image reloads only when no image is shown). Video's `sourceRequestId` race handling moves as is.
  Copy/save/"open in Drawing Editor" produce the same files, names, toasts and clipboard formats. CSV header and
  delimiter toggles keep the rows-before-columns order. The rendered DOM, CSS classes and `data-name` values of every
  touched view stay identical (`text-chrome-root`, `text-run-script`, toolbar buttons, …).
- **Contracts that must not change:** persisted page descriptors (grid descriptor fields included — a legacy
  promotion that moves keeps reading the same fields), the script API (`page`, facades such as
  `ImageEditorFacade.copyToClipboard`, `HtmlEditorFacade`, `MermaidEditorFacade`), ai-vision output, MCP `call`, the
  `data-name` contract, i18n keys and existing messages. `window.persephone` is not touched, so no
  `BOARD_BRIDGE_VERSION` bump — a plan that changes the board-facing surface is sent back. A new English message (the
  grid error) is translated at epic close.
- **Owners.** `content/source-watch.ts` (watch + moved-source rules, reusing `content/source-recovery.ts` and
  `content/rebuild-pipe.ts`); `editors/video/VideoStreamSession.ts`; recording naming in one shared constant reused
  by main's `recording-service.ts` and the renderer helper (the plan picks the `shared/` home); mute in an `api/`
  owner or explicit preference (the plan picks and states why); `editors/shared/image-actions.ts` +
  `ImageActionsToolbarView` (folder chosen by the plan, `editors/shared/` or a UIKit primitive if it is pure);
  `core/utils/image-raster.ts`; `editors/base/TextEditorPageView.ts`; the HTML "Show resources" contribution in
  `editors/html/`; `editors/grid/formats/*-codec.ts`.
- **No new protocol code, no `await import()` to break a cycle** (guardrails 1, 5). Editor code keeps its literal
  `import()` per row in `register-editors.ts` (critical pattern 1).
- **God files only shrink** (guardrail 3): `VideoEditor.ts` (499), `ImageEditor.ts` (368), `TextFileIOModel.ts` (432),
  `TextChromeView.ts` (462), `GridEditor.ts` (954), `image-export.ts` (153, split), and the editor `index.ts` files end
  smaller.

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-1934 | `content/source-watch.ts`: one watch helper and `movedSource` | Done |
| US-1935 | `VideoStreamSession`, recording helpers and mute ownership | Done |
| US-1936 | Shared image actions and toolbar; `image-export.ts` split | Done |
| US-1937 | `TextEditorPageView<M>`, HTML "Show resources", view file naming | Done |
| US-1938 | Grid codecs, legacy-settings promotion, toolbar reads `model.grid` | Done |

### Task notes for the planners

- **All tasks.** Name the owner of every moved rule and the helper reused. Line counts before/after for the files
  under "God files only shrink". For every exported symbol that moves or is renamed, list its importers and update
  them (no re-export shims). Every `data-name` in a touched view listed and shown preserved. No unit tests or
  harnesses.
- **US-1934.** Per model: today's `watch`/recovery/move subscriptions, the events each reacts to, and the callback it
  becomes. Prove the moved-source rewrite (`` `${path}!${entry}` ``, `cloneForMovedSource`, `sourceLink` fields) is
  identical between text host and Image before merging. `ensurePipe` → `pipeFromSourcePath`: show the pipes are
  equivalent (provider + transformer chain, encoding) for a plain file and an archive entry.
- **US-1935.** `VideoStreamSession` API and every `VideoEditor` member that moves; the race guard moved unchanged;
  the facade/ai-vision callers of the moved members; where mute lives and how it keeps "session-wide, not persisted"
  (or a recorded decision to persist).
- **US-1936.** Per editor: today's copy/save/open-in-drawing methods, file-name rule, error wrapping and toolbar
  layout → the shared action. Every importer of `image-export.ts` → its new import. Proof the UIKit cycle is gone
  (`uikit/` imports nothing from `editors/`).
- **US-1937.** Per adopting editor (Monaco, Grid, Markdown, Mermaid, SVG, HTML, FileDiff, EnvVars, LogView, Link):
  today's construction/update strategy → `createParts`; the one update policy (model change) and why it is safe for
  each. Main-view file renames with importers. If an editor cannot adopt without behaviour change, it stays and the
  reason is recorded.
- **US-1938.** `GridCodec` shape; parse/serialise call sites → codec; the legacy promotion: who still writes the old
  fields and whether the cutoff allows deletion (if kept, its new owner); the `onModel` readers.

## Part 3 (not in this epic)

Recorded for a follow-up epic (EPIC-165 or later), roadmap item 6.4 part 3:

- EDC-9 panel views without IO (`ClipboardHistoryModel`, board-library operations, Explorer-owned `FileTreeProvider`,
  `CommitDiffPanelModel` loading, `MarkdownEditor.followLink`, the view-port pattern).
- EDC-10 `ExplorerEditor` split into panel editors with `attachExplorer` and the persisted-flag migration.
- EDC-11 `TreeProviderHost` + `TREE_PROVIDER_HOST_TRAIT` + `TreeRevealController`.

## Out of scope

- Any change to `window.persephone`, the script API, MCP `call`, persisted descriptors or the `data-name` contract.
- US-1873 (board docs) stays in Planned.

## Notes

### 2026-11-13
- Epic created after EPIC-163. Current state re-checked against the code (see Overview). Scope split into part 2
  (this epic) and part 3 (above). EDC-13 step 4 (`content/pipe-resource-server.ts`) was already done by an earlier
  epic.
- Codex weekly window had 40% left at the start, so planning runs on Luna (the policy pick).
- Implemented, reviewed and committed (87568404). The closing bookkeeping (status, dashboard, `epics/completed.md`,
  roadmap) was finished in EPIC-165's commit.
