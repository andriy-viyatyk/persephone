# EPIC-116: Pipe status and instant open — show what a slow source is doing, open the page first

## Status

**Status:** Completed
**Created:** 2026-09-29
**Completed:** 2026-09-29

**Completion summary.** Content pipes now have a live, discoverable status.
- **Status model:** providers and transformers may report a stage status, and the pipe exposes
  `stages`, `summary` and a throttled `onStatusChange`. `HttpProvider` reports combined bytes
  and rate, and cancellation is never an error. Scripts and MCP read it at `page.pipe`.
- **Badge:** a page-level badge in `PageToolbarView` and `BoardToolbar` shows the summary, with
  a popover listing every stage.
- **Board providers:** service providers may implement `status(config, emit)`, subscribed only
  while observed and never starting a service. The board bridge is now **1.26.0**.
- **Instant open:** text-family, image and content-host board pages open at once behind a
  loading shell (stage list, Cancel, Retry on an unexpected failure). Scripts and MCP still wait
  for content through `page.ready`. Every other editor keeps restore-before-add.
- **Review:** Codex planned and implemented each task, and ran `/review`, `/document` and
  `/userdoc` at epic close. Claude reviewed each plan and fixed six defects found in the smoke
  checks; the task notes record them.

**Torrent board:** Torrent Viewer 1.7.3 (`minBridgeVersion` 1.26.0) reports peers, speed and the
requested file's progress, observe-only. It is on persephone-boards `develop` and not merged to
`main` or published.

**Not verified live:**
- Retry, which needs a `restore()` rejection;
- deferred image and content-host board opens;
- dedupe while a page is loading, hints applied after the load, and a session saved mid-load;
- the toolbar badge during an active read;
- torrent status against a real swarm.

## Overview

Opening content from a slow source — a file inside a torrent, a large HTTP download — gives no
feedback: nothing says whether bytes are arriving, how fast, or from how many peers. For text,
image and board pages it is worse: no tab appears until the whole source has been read.

This epic gives content pipes a live, discoverable status and shows it on the page. Each provider
and transformer may report a status for its stage, and the pipe combines them into one summary.
It also splits **opening the page** from **loading its content**, so the tab appears at once and
shows progress while the read runs.

## Goals

- Providers and transformers can report a status: state, short text, detail, byte progress, rate.
  The pipe exposes every stage's status plus one summary. The page, scripts and the agent can all
  read it.
- One page-level status badge, shared by every editor, shows the summary while a source is busy.
  A popover lists every stage.
- Board service providers, such as the torrent board's, can report status per resource (peers,
  speed, pieces). The torrent board adopts it.
- Opening a page no longer waits for its content. The tab appears at once with a loading shell,
  which offers Cancel and shows the pipe status. A failed read leaves a tab with an error and
  Retry, instead of a click that seemingly did nothing.

## Background (verified 2026-09-29)

- **Link resolution does not read content.** Layer 1 and Layer 2 are cheap. A board scheme's
  resolve hook (`createBoardSchemeHooks`, `src/renderer/editors/board/custom-editor-registry.ts:184`)
  only builds the pipe descriptor and picks the editor by file name. `resolvers.ts:31` does one
  `app.fs.stat` for local paths.
- **The wait is in page creation.** `PagesLifecycleModel.openFile`
  (`src/renderer/api/pages/PagesLifecycleModel.ts:552`) calls `createEditorFromFile`, which runs
  `await editor.restore()` (about line 289) **before** `addPage`. Text, image and board `restore()`
  read the pipe. For example, `TextFileIOModel.ts:279` calls `pipe.readText()`, which is a full
  `readBinary()`. So the tab appears only after the whole source has been read.
- **Pipes have no status.** `IProvider` (`src/renderer/api/types/io.provider.d.ts`) and
  `ITransformer` offer reads, streams, `stat` and `watch`, with no progress or events.
  `ContentPipe` (`src/renderer/content/ContentPipe.ts`) exposes `provider` and `transformers`, which
  carry `type`, `displayName` and `sourceUrl`, but nothing live.
- **Board service providers** register with `persephone.providers.register(type, implementation)`
  inside the module service. The implementation supplies `readBinary(config)` and, optionally,
  `readRange`, `writeBinary`, `stat` and `watch(config, onChange)`, where `watch` returns a disposer
  (`assets/guides/agents/boards.md`, "Service-backed content providers"). The renderer side is
  `ProxyProvider` (`src/renderer/content/providers/ProxyProvider.ts`) over the service port
  (`src/ipc/module-service-channels.ts`, `src/renderer/api/module-service.ts`).
- **Reads already take an `AbortSignal`** (US-1518). Cancel in the loading shell can use it.

## Design decisions

1. **Status belongs to a stage, not to a read.** A video page makes many concurrent range reads.
   The provider knows the real state (swarm peers, overall speed, pieces held) and reports it.
   Where a provider only knows bytes, a shared `RateMeter` helper works out the rate.

   Shape (final names to be settled in US-1560):

   ```ts
   interface IPipeStageStatus {
       state: "idle" | "connecting" | "active" | "done" | "error";
       text?: string;                                  // short: "12 peers · 1.4 MB/s"
       detail?: string;                                // tooltip / popover line
       progress?: { loaded: number; total?: number };  // bytes
       rate?: number;                                  // bytes per second
   }
   // optional on IProvider and ITransformer
   readonly status?: IPipeStageStatus;
   onStatusChange?(callback: () => void): () => void;
   ```

2. **The pipe combines its stages.** `pipe.stages` lists every stage as
   `{ role: "provider" | "transformer", type, displayName, status }`. `pipe.summary` picks one: an
   error first, otherwise the stage updated most recently. `pipe.onStatusChange` notifies at most
   about 4 times a second. Scripts and the agent read the same surface through the page's pipe.
3. **Board providers report per resource, following the `watch` pattern.** A service
   implementation may add an optional `status(config, emit)` that returns a disposer.
   `ProxyProvider` subscribes only while someone watches its status, so a status-less owner costs
   nothing. This is a board-facing API: `BOARD_BRIDGE_VERSION` must be bumped.
4. **The badge is page-level, in the shared toolbar area**, not built by each editor. Every editor
   gets it without changes. It must also exist while the page is still loading, before any editor
   toolbar has mounted.
   - While active it shows a spinner, `summary.text` and a thin progress bar.
   - Clicking it opens a popover listing every stage.
   - When done it shows a final line, such as "1.2 GB in 3 min", for a few seconds, then hides.
   - An error stays until it is dismissed or retried.

   A ring on the tab icon may come later; it is not part of this epic.
5. **Instant open uses a generic page-level loading shell**, not partial rendering in each editor.
   - `createEditorFromFile` builds the editor model, adds the page, then runs `restore()` in the
     background.
   - Until `restore()` settles, the page shows the loading shell: the stage list in a large layout,
     plus Cancel. Then it mounts the real editor view.
   - Cancel aborts the read and closes the page. A failure shows an error with Retry.
   - No editor has to cope with rendering before `restore()`.
6. **Scripts keep their current contract.** Script and MCP `pages.openFile(...)` still resolves
   only after the content is loaded, by awaiting a new `page.ready`. Only UI-initiated opens return
   early. Paths that reuse an existing page (dedupe, `onReopen`, single-instance boards) do not call
   `restore()` and are unchanged.

## Linked Tasks

| Task | Title | Status |
|------|-------|--------|
| [US-1560](../tasks/US-1560-pipe-status-model/README.md) | Pipe status model: stage status on providers and transformers, `ContentPipe` aggregation, `HttpProvider` progress, script and agent surface | Done |
| [US-1561](../tasks/US-1561-pipe-status-badge/README.md) | Page-level pipe status badge and stage popover | Done |
| [US-1562](../tasks/US-1562-board-provider-status/README.md) | Board provider status: service-side `status(config, emit)`, `ProxyProvider` subscription, bridge version bump; torrent board adopts it | Done |
| [US-1563](../tasks/US-1563-instant-open/README.md) | Instant open: add the page before `restore()`, loading shell with Cancel, error and Retry, `page.ready` for scripts | Done |

**Order.** US-1560, then US-1561. Each is useful on its own for slow HTTP opens. US-1562 depends on
US-1560. US-1563 depends only on US-1561 (the shell reuses the badge's stage view) and may be
brought forward if "the tab appears at once" matters most.

**Torrent board.** The US-1562 adoption lands in persephone-boards on `develop`. Like the EPIC-115
commits, it stays unpublished until the user says otherwise.

## Risks / abort criteria

- **US-1563 is the risky one.** Many callers may assume a page is restored as soon as it is
  added: tab title and icon, session save, navigation hints (`revealLine`, `fragment`), and
  `onPageCreated` callbacks. The task document must list every consumer of an added page and
  say which of them must wait for `page.ready`.

  If an editor proves unable to take a deferred restore, a per-editor opt-out (restore before add,
  as today) is acceptable. Do not add partial-render code to editors.
- **Status traffic must stay cheap.** Throttling happens where the status is produced (the
  provider or service) and again at the pipe. A provider with no status code must behave exactly
  as it does today.
- **No new persisted state.** Status is live-only and never part of `toDescriptor()`.

## Notes

### 2026-09-29
- Design agreed with the user in conversation, and all recommendations were accepted:
  - a generic loading shell rather than per-editor partial rendering;
  - the badge in the page toolbar area, with a tab ring deferred;
  - script `pages.openFile` keeps waiting for content, through `page.ready`.
- Task documents are to be investigated and written by Codex (per `persephone-codex-dev`), one at
  a time in the order above.
