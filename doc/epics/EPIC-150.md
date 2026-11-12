# EPIC-150: Refactoring Phase 4.6 — `ContentHostSlot`

## Status

**Status:** Completed 2026-11-12
**Created:** 2026-11-12

## Overview

This is the tenth epic of the [refactoring roadmap](../refactoring-roadmap.md) and the last part of Phase 4 (board
bridge and runtime decomposition). It covers roadmap item 4.6, findings **EDC-1** (`07-editors-core.md`) and **BRD-9**
(`05-board-editor.md`). Both findings propose the same fix, so it is done once and owned by `editors/base/`.

**The problem.** The content host is the shared `TextFileModel` that an editor switch transfers with no reload and no
data loss, through `CONTENT_HOST_TRAIT`. The code that holds that host lives in `TextHostEditorModel`, which is a base
class. Its header says it exists so that editors do not copy-paste host adoption. Single inheritance stops the two
board models from using it: `BoardContentEditorModel` must extend `BoardEditorModel`, and `BoardInfoEditorModel`
extends `EditorModel`. So the host-holding code exists three times. It was verified on 2026-11-12, and the finding line
numbers have drifted.

- **`TextHostEditorModel`** (`editors/base/TextHostEditorModel.ts`, 343 lines) has:
  - the trait registration and `extractContentHost`;
  - `switchFrom`, `restore` and `adoptHost`;
  - `getRestoreData`/`applyRestoreData` with `host`;
  - the `setPage` forward and `confirmRelease`/`saveState`/`dispose` delegation;
  - a host-subscription registry that is torn down as one set;
  - the bounded echo guard (`createEchoGuard`) behind `writeToHost`/`subscribeHostContent`;
  - `mirrorHostSettings`.

  It is the base of 10 editors: Monaco, Grid, Markdown, Mermaid, Html, Svg, Link, LogView, EnvVars and FileDiff.
- **`BoardContentEditorModel`** (`editors/board/BoardContentEditorModel.ts`, 247 lines) copies the trait, `switchFrom`,
  `adoptHost`, the `setPage` forward, the `_pendingHost` restore, persistence, the `modified`/`saveState`/
  `confirmRelease` delegation and the host-first dispose. It has one `_hostStateUnsub` instead of the registry.
- **`BoardInfoEditorModel`** (`editors/board-info/BoardInfoEditorModel.ts`, 860 lines) copies the same pieces a third
  time ("mirrors BoardContentEditorModel"), with a tolerant `switchFrom` that accepts a source with no host.
- **The copies have drifted:**

  | | `TextHostEditorModel` | `BoardContentEditorModel` | `BoardInfoEditorModel` |
  |---|---|---|---|
  | Host `editor` stamp | its `editorId` | `"board-view"` | none |
  | Title | on adopt: host title, file name, current title, `untitledName()` | on adopt **and on every host change**: host title, file name, current title | on adopt, only if the host has a title or file path |
  | Restore fallback with no stored host | `newTextFileModel("")` | `newTextFileModel(currentFilePath() ?? "")` | none: stays host-less |
  | Restore failure | rethrow for a persisted host; otherwise notify and adopt an empty host; silent on abort | notify and set `contentHostError` (drives the error view) | notify and stay host-less |
  | Host-state subscription | registry, plus `descriptorChanged` | one unsub: retitle, `descriptorChanged`, clear `contentHostError` when `providerError` clears | one unsub: `descriptorChanged` |
  | `switchFrom` without the trait | throws | throws | tolerant: captures the folder or file path instead |

- **Two more echo guards bypass the shared one:**
  - **Grid** extends `TextHostEditorModel` but writes with `this._host?.changeContent(content, true)` and filters
    echoes through a private one-slot `_changedContent` (`GridEditor.ts`, `onDataChanged` and its `adoptHost`
    subscription). The editor guide says every write goes through `writeToHost`/`subscribeHostContent`.
  - **The board content bridge** (`editors/board/frame/content-host-bridge.ts`; it was in `BoardWebview` when BRD-9
    was written) keeps its own `lastBoardContent`. It reaches the model with a cast and an optional call:
    `(this.model as BoardContentEditorModel).hostChangeContent?.(next)`, and the same for `hostSave`.

## Goals

- **One `ContentHostSlot`** in `src/renderer/editors/base/content-host-slot.ts`. Each editor owns one slot as a
  composed member. The slot holds:
  - the host and the pending (stashed) host descriptor;
  - the `CONTENT_HOST_TRAIT` implementation, registered on the owner's `traits`;
  - adopt and extract, and the transfer from an outgoing editor;
  - the host load sequence used by restore;
  - the host-subscription registry, the echo guard, content write and subscribe, and the settings mirror;
  - `setPage`, `modified`, `confirmRelease`, `saveState` and `dispose` delegation.
- **`TextHostEditorModel` becomes a thin adapter.** It owns one slot and keeps its protected and public API
  (`_host`, `adoptHost`, `onHostAttached`, `onHostExtracted`, `registerHostSubscription`, `writeToHost`,
  `subscribeHostContent`, `mirrorHostSettings`, `bootstrapFromHost`, `untitledName`) by delegating. Its 10 subclasses
  do not change. A one-line change, such as FileDiff's `_pendingHost` write in `applyRestoreData`, is allowed if the
  plan lists it.
- **The board models compose a slot.** `BoardContentEditorModel` and `BoardInfoEditorModel` delete their copies, and
  `BoardInfoEditorModel` (860 lines) shrinks.
- **No cast to reach the board model.** `BoardEditorModel` gets virtual `applyBoardContent(content)` and
  `saveBoardContent()` methods. They are no-ops on the base (`BoardStreamEditorModel` and plain boards), and
  `BoardContentEditorModel` overrides them. `ContentHostBridge` calls them without a cast and uses the slot's echo
  guard; `lastBoardContent` and the `BoardContentEditorModel` import are deleted.
- **Grid uses the shared echo guard.** `onDataChanged` calls `writeToHost(content, true)`, and the re-parse
  subscription uses `subscribeHostContent`. `_changedContent` is deleted.

## Decisions this epic acts on

- **Owner.** `editors/base/content-host-slot.ts` owns the host-holding rule. It reuses `CONTENT_HOST_TRAIT` and
  `IContentHostTrait` (`editor-traits.ts`), `createEchoGuard` (`core/utils/echo-guard.ts`), `TextFileModel.
  fromDescriptor`/`newTextFileModel` and `fpBasename`. It imports nothing from `editors/board*`: `base/` must not
  learn about boards (EDC-2, and the planned lint zone from roadmap 2.5).
- **Every difference in the table above is kept, as an option or a hook.** The table is user-visible behaviour: tab
  titles, the board's error view, restart restore, and what Board Info shows when opened from a file with no host. No
  task unifies a row unless the user agrees. The plan for each task lists the rows it touches and the option or hook
  that carries each one. Options EDC-1 suggests: `displayName`, the editor stamp (an editor id, `"board-view"` or
  none), `untitledName`, `onAttached`/`onExtracted` and a host-state change hook. The plan may name them differently.
- **Restore: one load sequence, each owner keeps its failure policy.** The slot owns the shared sequence: use the
  adopted host if there is one, otherwise build it from the stashed descriptor or the owner's fallback; restore it if
  it is not restored; adopt it. It then clears the stash. On failure it rethrows. Each owner keeps its own short
  `catch`, so the three policies stay readable where they apply, instead of an `onFailure` mode enum. The abort check
  in `TextHostEditorModel` stays exactly as it is.
- **The echo-guard change in Grid and the bridge is deliberate, and it fixes a lost update.** Both now use the bounded
  exact-content guard instead of a one-slot "last written" filter. A host content event fires only when the content
  actually changes, and any non-matching event clears every pending token, so the guard can never swallow a genuine
  change and never delivers anything that is not a change. The one-slot filter could: after the editor's own write
  of X, if the content later changed to something else and an outside write then set it back to X, that genuine
  change was dropped because X equalled the remembered last write. It is now delivered. Grid re-parses it, and the
  board receives it as `host.content`. Excalidraw applies every `host.content` event as an external scene, which is
  correct for this event (verified in US-1867).
- **`open-board-info.ts` keeps its trait check.** `transitionPageToBoardInfo` reads `CONTENT_HOST_TRAIT` only to decide
  whether to run `confirmRelease` first. That check is on the public trait contract, which stays. It changes only if
  the US-1868 plan shows that the slot API makes it simpler.
- **No `BOARD_BRIDGE_VERSION` bump.** The `persephone.host.*` frame messages and the `window.persephone` surface do not
  change. Only the renderer-side handling behind them moves.
- **`PagesLifecycleModel` stays as it is.** It calls `adoptHost` and `bootstrapFromHost` on `TextHostEditorModel`
  editors, and `editors/board/index.ts` calls `contentModel.adoptHost(...)`. Those public methods keep their names and
  behaviour. Moving those call sites is roadmap 5.1 (CORE-1), not this epic.

## Linked Tasks

Task documents are written per task when it is picked up. Search the findings by symbol.

| Task | Title | Scope (roadmap) | Status |
|------|-------|-----------------|--------|
| US-1866 | `ContentHostSlot`, and `TextHostEditorModel` as its adapter | 4.6, part 1: EDC-1 steps 1–2 | Done |
| US-1867 | The content-host board composes the slot | 4.6, part 2: EDC-1 step 3, BRD-9 | Done |
| US-1868 | Board Info composes the slot, and Grid uses the shared echo guard | 4.6, part 3: EDC-1 steps 3–4 | Done |

### Task scopes

**US-1866: `ContentHostSlot`, and `TextHostEditorModel` as its adapter.**
- **Extract the slot** from `TextHostEditorModel` with no behaviour change. The slot is a plain class that the owner
  constructs with its options. It registers the trait on the owner's `traits` and gets the owner's `editorId`, `id`,
  `page`, `state` and `descriptorChanged` through a small owner interface, not the whole `EditorModel` type. The plan
  defines that interface.
- **The adapter.** `TextHostEditorModel` keeps every member listed in the goals. `_host` becomes a protected read
  accessor; the plan confirms by grep that no subclass assigns it. `_pendingHost` is reached through the slot; the
  plan lists each subclass that touches it.
- **Before any code moves,** the plan lists every member of `TextHostEditorModel` and where it ends up (slot or
  adapter), and every external caller of `adoptHost`, `bootstrapFromHost`, `contentHost` and `host`.
- **Out of this task:** the board models and Grid.

**US-1867: The content-host board composes the slot.**
- `BoardContentEditorModel` owns a slot with its options: the `"board-view"` stamp, the file-path fallback, the
  `contentHostError` restore policy, and the retitle and error-clear host-state hook. Its copied trait, `switchFrom`,
  `adoptHost`, restore, persistence, delegation and dispose code is deleted. Its public `adoptHost` stays, because
  `editors/board/index.ts` calls it.
- `BoardEditorModel` gets the two no-op virtuals. `BoardContentEditorModel` overrides them: `applyBoardContent` writes
  through the slot's guarded write with `byUser: true`, and `saveBoardContent` calls `saveFile()` on the host.
  `hostChangeContent` and `hostSave` are deleted.
- `ContentHostBridge` uses the virtuals and subscribes through the slot's guarded content subscription. The plan says
  how the bridge reaches it without a cast or a `BoardContentEditorModel` import (for example a third virtual on
  `BoardEditorModel` that returns an unsubscribe), and keeps today's `isAlive` check and `sendInitialContent` reset.
- **Keep:** no busy state, `keepAliveOnNavigation`/`survivesNavigation` false, the virtual `board-editor:<root>`
  `editorId` with `"board-view"` in persistence, the `findCompatibleEditors` list, and `modified` from the host.

**US-1868: Board Info composes the slot, and Grid uses the shared echo guard.**
- `BoardInfoEditorModel` owns a slot with no stamp, no fallback, the "notify and stay host-less" restore policy, and
  the tolerant transfer. The folder-anchor and host-less file-path branches of `switchFrom` stay in Board Info; only
  the "the source has the trait" branch goes through the slot. Its copied host code is deleted. Its
  `getRestoreData`/`applyRestoreData` keep their custom `state` fields and take `host` from the slot.
- `open-board-info.ts`: see the decision above.
- **Grid:** `onDataChanged` uses `writeToHost(content, true)`, its re-parse subscription uses `subscribeHostContent`,
  and `_changedContent` is deleted. The plan checks every other `this._host` write in `GridEditor.ts`.

### Order

US-1866 first, because both later tasks compose the slot it creates. Then US-1867, then US-1868. The two board tasks
touch different files, but they run one at a time so that US-1868 reuses whatever US-1867 learned about the options.

## Rules for every task in this epic

- **The roadmap guardrails apply** ([§7](../refactoring-roadmap.md#7-guardrails-against-the-drift-coming-back), also
  in `doc/agents-common.md`). Each plan names the owner of each rule it touches and the helper it reuses.
- **Each copy is replaced, not wrapped.** A task is done when its copy is gone: no `_hostStateUnsub`, no private
  `_host`/`_pendingHost` fields in the board models, no `lastBoardContent`, no `_changedContent`.
- **God files only shrink.** `TextHostEditorModel.ts`, `BoardContentEditorModel.ts`, `BoardInfoEditorModel.ts`,
  `GridEditor.ts` and `content-host-bridge.ts` each end their task smaller than they started it.
- **`base/` does not import board code**, and the slot has no `if (board)` branch. Board behaviour comes in through
  options and hooks.
- **Behaviour to keep, and to check in every plan that touches it:**
  - host transfer on switch: same `TextFileModel` instance, no reload, the editor `id` kept for cache files;
  - the extract error when the host is already gone;
  - host-first dispose, and no subscription left after extract or dispose;
  - restore from a persisted descriptor, including the recovery-placeholder rethrow in `TextHostEditorModel`;
  - dirty state and the tab dot, `confirmRelease` on close, `saveState` for the auto-save cache;
  - `mirrorHostSettings` slots surviving switches and restarts;
  - every row of the drift table.
- **Verification:** run `npm run typecheck`, `npm run lint` and `npm run build-prod` after every task. No unit tests.
  The live flows below are the user's.
- **Completion:** the deferred review model. `/review`, `/document` and `/userdoc` run once at epic close. `/document`
  updates `doc/architecture/editors.md` (the content-host section), `doc/standards/editor-guide.md` (the text-bearing
  editor path) and key-files.

## Live checks the user runs at close

- **Switch round trip on one file:** Text (Monaco) → Grid → a content-host board (for example a `*.todo.json` board)
  → `+` (Board Info) → back to Text. Edit in each one. The content stays, nothing reloads, and the tab title and dirty
  dot are right throughout.
- **Restart restore:** with a dirty file open in each of Monaco, Grid, a content-host board and Board Info opened with
  `+`, restart the app. Each page comes back with its file and its unsaved content.
- **Grid:** edit a cell, undo, then write the page content from a script. The grid re-parses the script's write and
  does not loop on its own edits.
- **Content-host board:** edit inside the board, then press Ctrl+S, then edit the same file in Text and switch back.
  The board shows the outside change, and its own edits do not bounce back into it.
- **Failure paths:** restore a content-host board whose file was deleted (the board's error view shows), and open Board
  Info from a file with no host, such as a zip-based `.docx` (it shows the file name and `Archive | +`).
- **Board Info "Open board"** from a content-host board's Properties: the board returns with the file content intact.

## Notes

- **Sizes at the start:** `TextHostEditorModel.ts` 343 lines, `BoardContentEditorModel.ts` 247,
  `BoardInfoEditorModel.ts` 860, `GridEditor.ts` 973, `content-host-bridge.ts` 83, `open-board-info.ts` 76.
- **Sizes at the end of implementation:** `TextHostEditorModel.ts` 343 → 194 lines, with
  `content-host-slot.ts` new at about 250 lines; `BoardContentEditorModel.ts` 247 → 179; `BoardInfoEditorModel.ts`
  860 → 831; `GridEditor.ts` 973 → 960; `content-host-bridge.ts` 83 → 77. `open-board-info.ts` is unchanged.
- **Fixes made in review, beyond the plans** (each recorded in its task document's implementation notes):
  - `ContentHostSlot.restore` holds a newly loaded host before awaiting its restore, as the old code did, so a session
    save during the load keeps the host descriptor and a failed load stays owned (US-1866).
  - The slot keeps one host content subscription and consumes the echo guard once per change before fanning out.
    Per-handler consumption let a second board listener receive the board's own write (US-1867).
  - Board Info's restore loads a host only when it holds none, so a transferred host is not re-adopted and an opener's
    title is not overwritten (US-1868).
- **After this epic, Phase 4 is complete.** Phase 5 (pages, settings, startup and app conventions) is next; its first
  item is the `PagesLifecycleModel` split (5.1).
