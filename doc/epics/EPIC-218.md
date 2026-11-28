# EPIC-218: Cross-tree transfer (remote trees phase 2)

## Status

**Status:** Completed 2026-11-28
**Created:** 2026-11-27

## Overview

Phase 2 of the [remote trees roadmap](../reviews/remote-trees-roadmap.md). [EPIC-217](EPIC-217.md) let a board supply
an Explorer tree. US-2252 establishes transfers between local and board trees, including board-to-board. Archive, Mneme and link trees
need separately verified adapters before they can join the transfer surface. The SSH, FTP and Kudu boards (phases 3-5)
can use the engine by implementing the provider operations below.

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
| US-2251 | **Chunked provider writes.** Optional transactional chunked write for content providers, carried on the existing provider channel. `ProxyProvider` exposes it to core; providers without it retain bounded `writeBinary` fallback. The local provider writes to a temporary file and renames on commit. Bridge version 1.66.0 includes the API. | Codex (plan + implement), Claude check | Done |
| US-2252 | [**Transfer engine.**](../tasks/US-2252-tree-transfer-engine/README.md) File and board trees only; archive, Mneme and link trees require a later verified adapter. Strict traversal, target mkdir, content-pipe copying, conflict decisions, progress, cancellation and per-item outcomes. Move copies all selections before deleting complete subtrees. Local-to-local keeps `copyPathsInto`; same-tree moves keep `rename`. | Codex (plan + implement), Claude check | Done |
| US-2253 | [**Drop across trees.**](../tasks/US-2253-drop-across-trees/README.md) `getTraitDropAction` gains a `transfer` action when the dragged items come from a different tree the engine can read (board hrefs included); OS files dropped on a board tree use the engine with the local disk as source. `tree-drop-actions.ts` routes it: confirm, conflict dialog (overwrite / skip / keep both, apply to all), progress with a **Cancel** button (extends the progress model), summary of per-item failures. Default action: copy between different trees, move inside one tree; a modifier key switches, matching the OS convention | Codex (plan + implement), Claude check | Done |
| US-2254 | [**Copy/paste across trees.**](../tasks/US-2254-paste-across-trees/README.md) The OS clipboard carries only local paths, so copy/cut of board items needs an in-app tree clipboard (items + source tree descriptor + cut flag) beside it. Paste into any tree routes to the engine when the source is not the local disk or the target is a board tree; local → local keeps the OS path. Cut empties the in-app clipboard after a full move | Codex (plan + implement), Claude check | Done |
| US-2255 | [**Download to….**](../tasks/US-2255-download-to/README.md) Context-menu action on board-tree items: pick a local folder, transfer with the engine. Covers dragging remote items out to the OS, which stays out of scope | Codex (plan + implement), Claude check | Done |
| US-2256 | **Test board and UI tests.** The in-memory test board gains chunked writes and a second connection used as a second tree. UI tests: local ↔ board copy and move, board ↔ board, conflict choices, cancel mid-transfer (no half file left), a file above the chunk size, move keeping sources that failed | Codex (write + run tests), Claude runs the new tests at epic close | Done |
| US-2257 | **Guides.** `assets/guides/boards/content-providers.md` (chunked writes), the agent board guides, `bridge-versions.md` if bumped, the Explorer user guide (cross-tree drag, paste, Download to…), a `whats-new.md` line. `npm run guides:check` passes | Codex (via `/userdoc` at close) | Done |
| US-2258 | **Per-connection read-only trees.** Found by US-2256: `ProxyTreeProvider.writable` is per provider *type*, so a read-only connection (roadmap decision 3) still shows Cut/Paste/Rename/Delete/New and only fails at the service. The board's `treeList` result for a folder gains optional `readOnly: true`; the listing of the tree's root sets the tree read-only (`writable` false, no write menus, no paste/drop target). The service still enforces it | Codex (implement from Claude's design), Claude check | Done |

**Order:** US-2251 → US-2252 (the engine uses chunked writes when available and retains bounded `writeBinary` fallback) →
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
