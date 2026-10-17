# EPIC-129: Shared path-watch service and board file watching

## Status

**Status:** Completed
**Created:** 2026-10-17
**Completed:** 2026-10-17

## Overview

Persephone watches the file system in five separate places, each with its own `fs.watch` handle,
its own debounce, and no sharing:

| Consumer | Watches | Today |
|---|---|---|
| `FileWatcher` (`src/renderer/core/utils/file-watcher.ts`) | settings, menu folders, browser search history | `fs.watch(file)`, 300 ms debounce, event type ignored |
| `DirectoryWatcher` (same file) | Git Tree repo folder | `fs.watch(dir, {recursive})`, 500 ms debounce, keeps only the last filename |
| `FileProvider.watch` (`src/renderer/content/providers/FileProvider.ts`) | every file open in a text/image editor (`pipe.watch()`) | `fs.watch(file)`, 300 ms debounce |
| `FileTreeProvider.watch` (`src/renderer/content/tree-providers/FileTreeProvider.ts`) | Explorer root | `fs.watch(root, {recursive})`, 500 ms debounce, all arguments dropped |
| `library-service.ts` | script library folder | `fs.watch(dir, {recursive})` |

All of them run in the renderer, one set per window, and all reduce the OS's precise
`(eventType, filename)` report to "something changed, re-read". Boards cannot watch at all: a
board that shows files an agent edits (for example a task dashboard over `dev/tasks/*.md`) has
no way to refresh live.

This epic builds one **path-watch service** in the main process. Consumers subscribe to a file or
folder and get batched, classified change events. The service shares OS watchers: a subscription
inside a folder already watched recursively reuses that watcher instead of opening another one.
Existing consumers move onto it, and boards get a `persephone.watch()` bridge API, authorized by
the same rules as `readFile`/`listFolder`.

## Goals

- One owner of `fs.watch` in the app. Every other consumer subscribes through the service.
- One OS watcher per watched root, shared by reference count across consumers, windows and
  boards. A narrower subscription inside an existing recursive watch reuses it.
- Subscribers receive *what* changed: a batch of `{ path, type }` with `type` one of
  `created | changed | deleted`, deduplicated per path, plus an explicit "rescan" signal when
  precision was lost (OS buffer overflow, burst too large, watcher error).
- Existing consumers keep their current behavior after migration (this epic does not make the
  Explorer incremental. That is a possible follow-up which the precise events enable).
- A board can watch its own folder, a folder or file the user granted it, or (with
  `fileSystem: "full"`) any path, and react live. Example: the EverGreen *Dev Dashboard* board
  refreshes when an agent edits a task file.

## Background: what `fs.watch` reports (Windows)

`fs.watch` uses `ReadDirectoryChangesW`. The callback is `(eventType, filename)`:

- `eventType` is only `"rename"` or `"change"`. **Create, delete and both halves of a rename all
  arrive as `"rename"`.** The service classifies a `rename` by `stat`-ing the path when the
  batch flushes: exists → `created`, missing → `deleted`. A rename `a → b` therefore becomes
  `deleted a` + `created b`.
- `filename` is relative to the watched folder (`sub\file.txt` in recursive mode). It is
  effectively always present on Windows but typed nullable. A `null` filename is treated as
  "rescan".
- One logical save produces several events (content, size, timestamp; temp-file-then-rename
  for atomic savers). Hence batching and per-path dedup.
- A folder's own timestamp change produces `change <folder>` when a child changes.
- Large bursts (`git checkout`, `npm install`) can overflow the OS buffer and drop events
  silently. Consumers must tolerate "rescan".
- A single-file `fs.watch` on Windows is a parent-directory watch filtered by name. It survives
  delete-and-recreate.
- An open directory watch can make renaming the watched folder or its ancestors fail with
  `EPERM`. Fewer, shared handles reduce this.

## Decisions

These are proposals. The user may change them.

- **W1 — The service lives in the main process.** The board bridge already runs there, and a
  main-owned service is the only place that can share one OS watcher across windows *and*
  boards. Renderer consumers use a thin client over IPC that keeps the same subscribe/dispose
  shape. Only filtered, batched events cross IPC, never the raw stream. Subscriptions are owned
  by their `webContents` and released when it is destroyed or reloaded (follow the
  `watchedSenders` pattern in `src/main/search-service.ts`). The renderer client also reference-counts
  locally, so N renderer consumers of one path cost one IPC subscription.
  *Rejected:* a per-window renderer service plus a separate main one for boards. That keeps two
  watchers per path and two implementations of the Windows quirks.

- **W2 — Watcher sharing.** A subscription is `(path, recursive)`. The service resolves it in
  this order:
  1. An existing **recursive** watcher on the path or an ancestor serves it.
  2. A **folder** subscription without `recursive` gets a non-recursive watcher on that folder.
  3. A **file** subscription gets a non-recursive watcher on its **parent folder**, shared by
     every watched file in that folder and filtered by name. This survives atomic saves and
     deletion and recreation of the file.

  Watchers are reference-counted by the subscriptions they serve and closed at zero. In v1 the
  service does **not** consolidate: opening a recursive watcher later does not migrate existing
  narrower watchers onto it, and it never widens a subscription to a common ancestor it was not
  asked for. The extra handles are cheap. Implicit widening could put a recursive watch on
  `C:\`.

- **W3 — Event model.**

  ```ts
  interface PathWatchBatch {
      changes: { path: string; type: "created" | "changed" | "deleted" }[]; // absolute paths
      rescan?: true;   // precision lost — re-read everything under the subscription
      ended?: "removed" | "error" | "revoked"; // subscription is dead; no further batches
  }
  ```

  - Batches are per subscriber, debounced (default 300 ms, minimum 50 ms) and deduplicated per
    path. Rules: created + changed → created; created + deleted → dropped; deleted + created →
    changed; otherwise the last type wins.
  - A batch with more than 1,000 distinct paths collapses to `{ changes: [], rescan: true }`.
  - The `change` the OS reports on a parent folder when a child changes is suppressed when that
    child's own event is already in the batch.
  - Existing consumers that only need "something changed" ignore the payload.

- **W4 — Failure semantics.**
  - If the watched root itself is deleted, or the watcher errors, every subscription it served
    gets `ended`. Callers that need to survive this re-subscribe. For example, an editor whose
    file was deleted keeps its current "file deleted" handling.
  - For a file subscription, deleting the file is an ordinary `deleted` change, not `ended`,
    because the parent watcher lives on.
  - Archive, asar and non-local paths are rejected up front. The existing wrappers keep their
    no-op fallback for them.

- **W5 — Migration keeps public shapes.** `FileWatcher`, `DirectoryWatcher`,
  `FileProvider.watch`, `FileTreeProvider.watch` and library-service keep their signatures and
  debounce behavior and are reimplemented over the service client. After migration, the
  service's main-process module is the only code calling `fs.watch`. Update the documented `nodefs` exception
  in `coding-style.md` and the comment in `library-service.ts` to match.

- **W6 — Board API.**

  ```ts
  persephone.watch(path: string, callback: (batch: PathWatchBatch) => void,
                   options?: { recursive?: boolean; debounceMs?: number }): Promise<() => void>;
  ```

  - **Authorization** goes through the existing `resolveAuthorizedPath()` in
    `src/main/board-file-access.ts`, so there is no second path algorithm. A folder uses intent
    `"list"` and a file uses intent `"read"`. A board can therefore watch:
    - its root
    - a folder or file it picked this session
    - a remembered folder or file grant (US-1690)
    - a delivered source file
    - any accessible path with `fileSystem: "full"`

    `fileSystem: false` can watch only its hosted document (the same exception `readFile` has).
  - Event paths are filtered to the authorized scope before they are posted. A recursive watch
    on a granted folder never reports paths outside it. The service reports textual paths and
    does not follow links. An exact-file grant never authorizes its siblings, so a file watch
    reports that file only.
  - **Revocation:** a trust or permission change (`eBoardTrustChanged`, a grant revoke in Board
    Info) re-checks live watches and ends the ones that are no longer authorized with
    `ended: "revoked"`.
  - **Lifecycle:** watches belong to the board port and are released when the port is disposed
    (reload, navigation, page close), alongside the existing cleanup in
    `src/main/board-bridge.ts`.
  - **Limit:** 64 live watches per board, with a stable `too-many-watches` error code.
  - **Wire format:** the shim keeps the callback. Main posts a new `MainToBoard` envelope,
    `{ kind: "watch"; watchId; batch }`. The returned disposer sends an `unwatch` RPC.
  - **No new permission:** watching reveals only what `listFolder` and `readFile` would
    already reveal.
  - **Bridge version:** bump `BOARD_BRIDGE_VERSION` one minor at implementation time (1.39.0 if
    nothing else lands first; 1.37.0 and 1.38.0 are unreleased in 5.0.11). Update every doc that
    states the current version (`doc/architecture/overview.md`,
    `doc/architecture/key-files.md`, `assets/board-template/board-manifest.json`). Document the
    API in the prose guides (`assets/guides/agents/boards.md`,
    `assets/board-template/CLAUDE.md`, `assets/guides/boards.md`), not in `board-api.d.ts`.

- **W8 — Read-only diagnostics at `main.watchers`.** Agents cannot *watch* (W7), but they can
  *inspect* the service while debugging Persephone. It is a new node in the MCP `call` tree's
  main-process diagnostics, beside `main.mcp`, `main.tor`, `main.boards` and the rest. It follows
  the existing `IAiVisible` node pattern in `src/main/mcp/ai-vision/main-services.ts`.
  - Every subscription carries an **owner** and a short **label**, which makes the snapshot
    readable:
    - owner `{ kind: "window", windowIndex }` or `{ kind: "board", boardRoot, boardName }`
    - label from the consumer: `"Explorer"`, `"text editor"`, `"settings"`, `"library"`, `"git tree"`, …
    The renderer client sends them with the subscribe call, and the board bridge fills them in.
  - Members, all bounded:
    - `summary`: watcher count, subscription count, and totals for events, batches and rescans
    - `watchers`: one entry per OS watcher, with `root`, `recursive`, `subscriptionCount`,
      `createdAt`, `eventCount`, `lastEventAt`, and `lastError`
    - `subscriptions`: one entry per subscription, with `id`, `path`, `recursive`, `owner`,
      `label`, `servedBy` (the watcher root, which shows W2 sharing at work), `debounceMs`,
      `batchesSent`, `lastBatchAt`, and `pendingChanges`
    - `recent(limit = 50)`: the latest raw OS events and the batches flushed from them, taken
      from an in-memory ring buffer (500 entries). It shows `rename` → `created`/`deleted`
      classification and dedup decisions without adding logging.
  - **Read-only.** No method closes or changes a watcher. If an agent needs to act, it uses
    `main.script.execute`, which is settings-gated.
  - The ring buffer is diagnostics-only and costs one array push per raw event. It is always on,
    so a problem can be inspected after it happens without being reproduced.

- **W7 — Not in scope:**
  - a script API (`app.fs.watch`)
  - an MCP/agent *subscription* surface (agents inspect via W8, they do not subscribe)
  - making the Explorer tree update incrementally
  - watcher consolidation (W2)

  Each is a follow-up the service enables. Record them in the backlog at epic close.

## Linked Tasks

Order: service → board API → migration. The board API is the user-visible goal and needs only
the service. Migration touches editors and the Explorer, so it is the riskiest part and goes
last, once the service has a real consumer.

| Task | Title | Status |
|------|-------|--------|
| US-1693 | Path-watch service in main + renderer client + `main.watchers` diagnostics (W1–W4, W8) | Done |
| US-1694 | Board `persephone.watch()` bridge API (W6) | Done |
| US-1695 | Migrate existing watchers onto the service (W5) | Done |
| US-1696 | Dev Dashboard board: live refresh on task-file changes | Done |

US-1696 changes a user board outside this repo
(`C:\projects\EverGreen\.persephone\boards\Dev Dashboard`, `fileSystem: "full"`, custom editor
for `dev/DASHBOARD.md`). It is the acceptance demo for US-1694: watch the sibling
`features|stories|tasks|spikes` folders recursively and re-parse on each batch, or reload
everything on `rescan`. Raise its `minBridgeVersion` to the new bridge version.

## Notes

### 2026-10-17
- Epic created from the user's idea of a shared, reference-counted watcher service and their
  request for board file watching.
- Verified: all five existing watchers are renderer-side `fs.watch` wrappers, and none shares a
  handle. Bridge 1.36.0 is the last released version; 1.37.0 and 1.38.0 are in the unreleased
  5.0.11.

### 2026-10-17 (implementation)
- US-1693 to US-1696 implemented and checked live through MCP; Persephone changes staged, not committed.
  `/review`, `/document`, `/userdoc` are deferred to epic close.
- Live testing found three Windows `fs.watch` defects in the new service, now fixed (details in completed.md): drive paths rejected by the scheme guard, 8.3 short-name roots
  misreporting filenames (targets are now canonicalized with `fs.realpath.native`, so reported
  paths are long-form), and an endless `rename` stream with `EPERM` stat after the watched root is
  deleted (a root rename now ends the watcher with `removed`).
- US-1696 changed the Dev Dashboard board outside this repo
  (`C:\projects\EverGreen\.persephone\boards\Dev Dashboard`: `app.js`, `CLAUDE.md`,
  `minBridgeVersion` 1.39.0). That folder is not under git.
- Not checked live: revocation (`ended: "revoked"`) after a trust or grant change. The code path
  was read: the listener runs after the permission snapshot updates and before
  `eBoardTrustChanged`.
