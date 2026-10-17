# EPIC-130: Editors follow file and folder moves

## Status

**Status:** Completed
**Created:** 2026-10-18
**Completed:** 2026-10-18

## Overview

When a file open in an editor is renamed or moved — from the Explorer panel, by a script, an MCP
call, an agent, or Windows Explorer — the page marks it **deleted** (red dot on the tab). The OS
watcher only reports that the old path disappeared; `TextFileIOModel.onFileChanged` stats the old
path, finds nothing, and sets `deleted = true`. The rebinding code already exists
(`TextFileIOModel.applyRenamedPath` clones the pipe onto the new path, keeping transformers, and
updates `filePath`, title, recent files and git detection), but only the editor's own *Rename
File* command calls it.

This epic makes a move a first-class event: the main-process `PathWatchService` (EPIC-129)
detects it once, for every window, and delivers a typed `moved` change. Every pipe owner rebinds
through one pipe-level helper.

## Goals

- An open file that is moved or renamed — directly or because a parent folder moved — stays open
  on its new path: unsaved edits kept, not marked deleted, tab title / `filePath` / recent files /
  persisted descriptor updated. Applies to every editor that owns a pipe, in every window.
- Moves performed by Persephone (Explorer rename, drag-move, cut/paste, `app.fs.rename`, scripts,
  MCP) are detected deterministically, wherever the destination is.
- Renames performed outside Persephone are detected when the OS watcher can see both paths, by
  NTFS file identity — never by guessing.
- A delete stays a delete. Nothing may follow a path to a file that is not provably the same file.

## Design decisions

**M1 — The move is detected in the main-process watch service, not in editors or providers.**
`PathWatchChange.type` gains `"moved"` with a `to` field: `{ path, type: "moved", to }`. One
detection point serves every window and every subscriber. Rejected alternatives: handling it in
the content host (`TextFileModel`) covers only Monaco / Grid / Notebook / content-host boards,
not the image editor or other pipe owners; making `FileProvider` mutate its own path breaks the
immutable-provider / descriptor model, and every owner holds its own `filePath` / title anyway.

**M2 — In-app moves are reported as intents: `notifyMoved(from, to)`.** Every renderer move path
reports a successful move to main over IPC: `app.fs.rename` (non-archive), `FileTreeProvider.rename`
(routed through `app.fs.rename` instead of its own `renameSync`), and `copy-files.ts` move
(both the fast rename path and the cross-volume copy-then-delete path). Main converts the intent
into a `moved` change for every subscription whose path equals `from` or lies under it (a folder
move maps `from/rest` → `to/rest`), and drops the matching OS `deleted` for that path. Cross-window
by construction, since all subscriptions live in main.

**M3 — Every move is validated at delivery.** A `moved` change is emitted only if, when the
subscription's batch flushes, the old path is missing and the new path exists. A failed rename,
a stale or wrong intent, or a race can therefore never retarget an editor; it degrades to today's
behavior. Intents expire after a short window (a few seconds) if never matched.

**M4 — External renames are detected by file identity (NTFS file ID), not heuristics.**
The service records `dev` + `ino` (bigint stat) for each subscribed *file* path at subscription
and after each change. When a subscribed file goes missing in a flush, the service looks for a
path created in the same OS watcher's raw events of that window whose identity matches; if found,
it is a `moved`. Delete-and-recreate gets a new ID (stays `deleted`); an atomic save keeps the
target path present (stays `changed`). Scope limit, accepted: only moves visible to the OS
watcher — same folder (the parent-folder watcher) or anywhere under an already-recursive ancestor
watcher (W2 reuse, e.g. an open Explorer root). Folder renames are covered by M2 only.

**M5 — Pipe-level rebinding, one helper.** `FileProvider.watch` turns a `moved` change for its
path into the event `"moved"` with `{ newPath }` (no `"rename"`/`"change"` for that batch).
`IContentPipe` gains `cloneForMovedSource(newPath)`: clones the provider onto the new path and
lets path-holding transformers update (`ArchiveTransformer` stores the archive path, which
today's `cloneWithProvider` would leave stale). A shared helper `watchSourceMove(pipe, onMoved)`
sits beside `watchSourceRecovery` in `src/renderer/content/source-recovery.ts`; every pipe owner
uses it.

**M6 — Consumers follow silently.** `TextFileIOModel` handles `"moved"` via the existing
`applyRenamedPath` path (generalised to take the cloned pipe): no re-read, `deleted` stays false,
dirty content and cache kept. This one change covers Monaco, Grid, Notebook, Markdown and
content-host boards (all share the `TextFileModel` host); `BoardContentEditorModel` must also
refresh the tab title when the host's path changes (today it copies the title only in
`adoptHost`). The image editor and every other pipe owner use the same helper. No toast — the tab
title change is the feedback (user decision, 2026-10-18). Re-entrancy: a move whose target equals
the current path is ignored (the editor's own *Rename File* already rebinds immediately).

**M7 — The board `persephone.watch()` contract is unchanged.** The board bridge translates a
`moved` change into `deleted path` + `created to` (each only if inside the board's authorized
scope). No new board-visible type, so no `BOARD_BRIDGE_VERSION` bump.

**M8 — Diagnostics.** `main.watchers` additionally lists recent confirmed moves (from, to,
source: `intent` | `identity`, time) in a small bounded ring, and pending intents.

## Out of scope

- Moves inside archives (`archiveService.renameFile`) — the archive file itself does not move.
- Following moves of a non-content-host board's own root folder (`boards.ts` rename already
  handles its own registry update).
- Following moves for editors with no pipe/watch (if the US-1698 inventory finds any that persist
  a path, they are listed there and handled only if cheap).
- Explorer-page root following its moved root folder — candidate follow-up.

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| US-1697 | Move intents and the `moved` change in the path-watch service (M1–M3, M7, M8) | Done |
| US-1698 | Pipes and editors follow a moved source (M5, M6) | Done |
| US-1699 | External renames by file identity (M4) | Done |

Order: US-1697 → US-1698 (fixes the reported Explorer-rename bug end to end) → US-1699.

## Notes

### 2026-10-18
- Epic created from the user's report: renaming an open file in the Explorer panel marks the page
  deleted. The user asked for an architectural fix covering content-host boards too, and
  approved this design including US-1699 and silent following (no toast).

### 2026-10-18 — completed
- All three tasks implemented and verified live through Persephone MCP: an in-app folder rename
  and file rename (open files follow, unsaved edits kept, not marked deleted), external renames by
  file identity (`recentMoves` shows `source: "identity"`), and the new-path watch reloading on an
  external edit.
- Found during investigation: Windows refuses to rename a folder while an `fs.watch` handle is open
  on a folder inside it. US-1697 suspends those watchers around in-app moves; external folder
  renames remain blocked (backlog).
- Fixed during verification: an `await` between `findWatcher()` and registering a subscription let
  a concurrent removal close the watcher (the rebound editor lost its watch); `FileProvider` matched
  the moved change by exact path string (main reports the canonical form); move tracking made a
  rename fail when the intent IPC failed (now best-effort).
- Out of scope, in the backlog: video sources, non-content-host boards, the Explorer page's own root.
