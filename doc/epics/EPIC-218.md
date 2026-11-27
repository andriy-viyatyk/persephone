# EPIC-218: Cross-tree transfer (remote trees phase 2)

## Status

**Status:** Active
**Created:** 2026-11-27

## Overview

Phase 2 of the [remote trees roadmap](../reviews/remote-trees-roadmap.md). [EPIC-217](EPIC-217.md) let a board supply
an Explorer tree. This epic copies and moves files and folders **between any two trees**: local ↔ board tree
(upload/download) and board ↔ board (one SSH host to another, SSH to FTP). It is platform work done once; the SSH, FTP
and Kudu boards (phases 3–5) get transfers by implementing the provider operations below.

| Area | Today | File |
|---|---|---|
| Local copy/move | `copyPathsInto(sources, targetDir, { move, onProgress })`: recursive local copy, per-item errors, sources removed only after a full copy | `src/renderer/api/copy-files.ts` |
| Drop classification | `getTraitDropAction` returns `move` only for the **same** source (`getSourceId === provider.sourceUrl`) and refuses board hrefs; anything else falls to `importLinks` / `importFiles`, which only local and link providers implement | `src/renderer/components/tree-provider/drop-dispatch.ts` |
| Drop UI | Move confirm, overwrite confirm, progress overlay, failure text; `moveItemsInto`, `importFilesInto`, `dropOsFilesInto` | `src/renderer/components/tree-provider/tree-drop-actions.ts` |
| Clipboard | Cut/copy/paste through the **OS** clipboard, which carries local paths only | `src/renderer/components/tree-provider/os-clipboard.ts` |
| Progress | `ui.createProgress(label)`; no cancel | `src/renderer/api/ui.ts`, `src/renderer/uikit/Progress/progressModel.ts` |
| Board writes | One `writeBinary` buffer, capped at `MAX_BUFFERED_PIPE_BYTES` (256 MB); reads already stream through `readRange` with an `AbortSignal` | `src/renderer/content/providers/ProxyProvider.ts`, `src/shared/board-pipe-constants.ts` |
| Provider operations | `ProviderOperation` + deadlines on the existing module-service provider channel | `src/shared/provider-operation-policy.ts` |
| Tree construction | `createTreeProvider`, provider identity | `src/renderer/content/tree-providers/tree-provider-factory.ts`, `tree-provider-identity.ts` |

## Goals

- **Exit:** drag-and-drop and copy/paste work in both directions between a local Explorer and the test board's tree,
  and between two board trees, with progress, cancel and conflict handling; a file larger than one chunk transfers
  intact; a move deletes only sources that copied fully.
- One transfer engine owns cross-tree copy and move; drop, paste and OS-file drop all call it.
- Board content providers can accept writes in chunks, so upload size is not bounded by one buffer.

## Linked Tasks

| Task | Title | Owner | Status |
|------|-------|-------|--------|
| US-2251 | **Chunked provider writes.** Optional chunked write for content providers: begin → write chunk → commit / abort. Service API on `persephone.providers.register` (e.g. `writeBegin`, `writeChunk`, `writeCommit`, `writeAbort`; the plan settles names); new operations join `ProviderOperation` with deadlines in the policy table, on the existing provider channel (guardrail 1). Boards write to a temp name and rename on commit, so an aborted upload leaves no half file. `ProxyProvider` exposes it to core; providers without it keep `writeBinary` up to the cap, and larger files fail with a clear message. The local file provider gets the same contract (stream to temp, rename). Test board implements it. `BOARD_BRIDGE_VERSION` bump if the service API counts as bridge surface (guardrail 6) | Codex (plan + implement), Claude check | Planned |
| US-2252 | **Transfer engine.** New collaborator `TreeTransfer` in `src/renderer/content/tree-providers/` (one job: copy or move items from tree A into a folder of tree B). Walks sources with `list`/`stat`, creates folders with the target's `mkdir`, copies each file by reading through the source item's content pipe (`resolveLink`) and writing through the target's (chunked when available). Move = copy all, then delete sources that copied fully. Conflict decisions come from a caller callback (overwrite / skip / keep both, apply to all); progress in files and bytes; an `AbortSignal` cancels the in-flight read and aborts the chunked write. Returns a per-item result. Local ↔ local keeps `copyPathsInto`; same-tree moves keep `rename` | Codex (plan + implement), Claude check | Planned |
| US-2253 | **Drop across trees.** `getTraitDropAction` gains a `transfer` action when the dragged items come from a different tree the engine can read (board hrefs included); OS files dropped on a board tree use the engine with the local disk as source. `tree-drop-actions.ts` routes it: confirm, conflict dialog (overwrite / skip / keep both, apply to all), progress with a **Cancel** button (extends the progress model), summary of per-item failures. Default action: copy between different trees, move inside one tree; a modifier key switches, matching the OS convention | Codex (plan + implement), Claude check | Planned |
| US-2254 | **Copy/paste across trees.** The OS clipboard carries only local paths, so copy/cut of board items needs an in-app tree clipboard (items + source tree descriptor + cut flag) beside it. Paste into any tree routes to the engine when the source is not the local disk or the target is a board tree; local → local keeps the OS path. Cut empties the in-app clipboard after a full move | Codex (plan + implement), Claude check | Planned |
| US-2255 | **Download to….** Context-menu action on board-tree items: pick a local folder, transfer with the engine. Covers dragging remote items out to the OS, which stays out of scope | Codex (plan + implement), Claude check | Planned |
| US-2256 | **Test board and UI tests.** The in-memory test board gains chunked writes and a second connection used as a second tree. UI tests: local ↔ board copy and move, board ↔ board, conflict choices, cancel mid-transfer (no half file left), a file above the chunk size, move keeping sources that failed | Codex (write + run tests), Claude runs the new tests at epic close | Planned |
| US-2257 | **Guides.** `assets/guides/boards/content-providers.md` (chunked writes), the agent board guides, `bridge-versions.md` if bumped, the Explorer user guide (cross-tree drag, paste, Download to…), a `whats-new.md` line. `npm run guides:check` passes | Codex (via `/userdoc` at close) | Planned |

**Order:** US-2251 and US-2252 can run in parallel (the engine falls back to `writeBinary` until chunked writes land) →
US-2253 → US-2254 → US-2255. US-2256 grows with each task. US-2257 at epic close.

## Epic-level decisions

Settled by Claude's recommendation; the user may override before the plans are written.

1. **One engine.** All cross-tree transfers go through `TreeTransfer`; drop, paste, OS-file drop and Download to… are
   callers. No per-provider transfer code at call sites (guardrail 4).
2. **Fast paths stay.** Local ↔ local uses `copyPathsInto`; a move inside one tree uses the provider's `rename`. The
   engine is for different trees only. A server-side `copy` inside one board tree may come later as an optional
   provider operation.
3. **Copy by default across trees, move inside a tree.** Same as Windows Explorer and GNOME Files between volumes.
4. **No rollback.** A failed or cancelled transfer leaves what already copied; the summary lists failures. A chunked
   write that did not commit leaves no file (temp + rename).
5. **Edge rules.** Symbolic links: copy a file link's content, skip folder links (no cycles). Timestamps and permissions
   are not preserved. Moving a folder into its own subtree stays refused.
6. **No new protocol.** Chunked writes are provider operations on the existing module-service channel.
7. **Writes stay opt-in.** A board tree without write operations is never a drop or paste target; the Explorer already
   hides actions the provider does not implement.

## Out of scope

- Dragging remote items out to the OS (needs the download before the drag starts); US-2255 covers the need.
- The SSH, FTP and Kudu boards (roadmap phases 3–5).
- Preserving timestamps, permissions, ownership; resuming an interrupted transfer.
- Server-side copy inside one board tree.

## Concerns

- **Progress has no cancel today.** US-2253 extends `progressModel` with a cancel button and an `AbortSignal`; check
  every existing `createProgress` caller still behaves (cancel hidden unless asked for).
- **Memory.** A file must never be read whole into memory on the way through; the engine pipes `readRange` chunks into
  chunked writes. Providers without `readRange` read whole files and are bounded by the 256 MB cap.
- **Deadlines.** One chunk write gets a deadline; the whole transfer does not (it is cancellable instead).
- **Name rules differ.** A name legal on Linux (`a:b`, trailing dot, case-only twins) can be illegal on Windows. The
  engine reports such items as per-item failures rather than renaming silently.
- **Trust.** A drop into a board tree hands local file bytes to that board's service; that is what trusting a writable
  board already means, but the confirm text should name the target tree.
