# US-1530: Single-instance boards — one page for every link a board claims

**Status: In progress — Persephone half**
**Epic:** [EPIC-114: The torrent board — a module contributes below the UI](../../epics/EPIC-114.md)

## Progress

- [x] Add the opt-in manifest capability and structural, per-window board-root lookup.
- [x] Route singleton opens, including the existing-page explicit-`pageId` branch, without deterministic page ids.
- [x] Add FIFO source delivery from the renderer model through the main board frame and from the shim to board subscribers.
- [x] Bump the bridge contract to 1.17.0 and update Persephone architecture references.
- [x] Run `npm run typecheck`, `npm run lint`, and `npm run build-prod`.
- [ ] Board-repository consumer and release work (separate `C:/projects/persephone-boards` run).

This document records the reviewed implementation plan and the progress of its Persephone half. No
commit is requested.

## Goal

Add a general, manifest-declared singleInstance board capability. When enabled, all claimed links
and plain opens for a board in one Persephone window must converge on one board page. A later source
must be delivered to the already-open board frame without reloading it, so a stateful board can append
the source to its existing session. Boards that do not opt in must retain today's one-page-per-open
behaviour.

The first consumer is the torrent viewer at
C:/projects/persephone-boards/boards/torrent-viewer/. Its shared service snapshot work is already
landed in [US-1529](../US-1529-torrent-board-service-snapshot/README.md), so this task owns only
singleton routing, source delivery, and the consumer's subscription.

## Background

### User decision and binding epic decisions

The user decision on 2026-09-27 is:

> “the board should be singleton. If multiple links is open that all of them are shown in one torrent
> page and only one board is provider for all links.”

EPIC-114 D5, D11, and D12 are binding:

- D5 (doc/epics/EPIC-114.md:152-170) requires a self-contained
  torrent://<infohash>/<url-encoded path>?magnet=<url-encoded magnet> link and says the full href
  remains the provider's persisted source. A singleton route must preserve that source identity and
  must not require a board page to exist for cold-start provider restore.
- D11 (doc/epics/EPIC-114.md:223-294) established the existing source handoff:
  BoardPortInitMsg.sourceUrl (src/ipc/board-bridge-channels.ts:253-291), populated by
  BoardWebview.transferPort (src/renderer/editors/board/BoardWebview.ts:364-398), is exposed as
  persephone.getSourceUrl() (src/board-shim.ts:1701-1706). The new-source path extends this
  handoff; it does not replace or materialize it.
- D12 (doc/epics/EPIC-114.md:296-364) keeps browserUrlMasks independent from fileMasks.
  The torrent viewer currently declares both in
  C:/projects/persephone-boards/boards/torrent-viewer/board-manifest.json:15-16; singleton
  routing must cover both claims without merging their matching rules.
- D14 (doc/epics/EPIC-114.md:403-418) settles the scope: a single-instance board has one page
  per window, while its state is shared per app. A link stays in the window that claimed it; board
  pages in different windows render the same app-wide service snapshot. This is the recorded user
  decision and is the reason the page query is window-local while torrent source persistence is
  board-owned.

US-1529 is landed. C:/projects/persephone-boards/boards/torrent-viewer/app.js:637-736 reconciles
the shared service snapshot, while :866-875 still consumes the initial persisted source through
P.getSourceUrl(). Singleton delivery must feed the same resolveSource path used for that initial
source, not recreate page-local inventory or service state.

### What was established (verified 2026-09-27, do not re-derive)

The platform has two reuse mechanisms today and **neither fits**:

| Mechanism | Scope | Why it does not fit |
|---|---|---|
| registerWellKnownPage / requireWellKnownPage (src/renderer/api/pages/well-known-pages.ts) | App-wide get-or-create by fixed id | The ids are **hardcoded in core** (mcp-ui-log, About, Settings). A board cannot register one. |
| matchesNavigationTarget / reuseNavigationTarget (US-617; EditorModel.ts:311-325, PageNavigator.ts:77-100) | **Within a single page** | Promotes an existing editor instance back to main on the same page. Two links still open two pages. |

requireWellKnownPage's get-or-create, plus addPage's dedupe-by-page-id
(src/renderer/api/pages/PagesLifecycleModel.ts:286-311 — "a second call with the same fixed id focuses the
existing singleton instead of duplicating it"), is the **right primitive**. The work is generalizing it
from a core-hardcoded id to a board-scoped one.

### Verified current open and restore paths

- A claimed browser download is converted to openRawLink with
  target: boardEditorId(data.boardRoot) by
  src/renderer/api/internal/RendererEventsService.ts:95-101.
- Registered torrent:/magnet: scheme hooks and the empty-name branch are in
  src/renderer/editors/board/custom-editor-registry.ts:205-235; they target the claiming board
  with boardEditorId(boardRoot). The same registry independently normalizes browser URL masks at
  :350-370 and file/content claims.
- The content resolver sends a pipe to openContent after selecting a file target in
  src/renderer/content/resolvers.ts:67-74. src/renderer/content/open-handler.ts:15-80 converts
  that pipe to filePath/sourceLink, then calls PagesLifecycleModel.navigatePageTo for an explicit
  page or PagesLifecycleModel.openFile for a new/existing tab.
- PagesLifecycleModel.openFile (src/renderer/api/pages/PagesLifecycleModel.ts:456-536) currently
  deduplicates only by main-editor filePath (:469-485), builds the editor, assigns the source
  link (:504-507), and calls addPage (:520). It has no board-root singleton lookup.
- PagesLifecycleModel.addPage (src/renderer/api/pages/PagesLifecycleModel.ts:286-311) still
  attaches an editor before its page-id dedupe check (:290-299), but singleton routing will not
  manufacture a deterministic page id, so this collision path is not used by the singleton design.
- BoardEditorModel.boardRoot is the structural board identity
  (src/renderer/editors/board/BoardEditorModel.ts:531-534). currentSourceUrl() (:554-568) filters
  the board's own persephone-board:// URL and returns the raw source identity. getRestoreData()
  (:772-809) persists a stable board-view editor id plus the board root; restore() (:834-860)
  rehydrates that state.
- PagesPersistenceModel persists page ids, pinned state, editor descriptors, grouping, and active
  page (src/renderer/api/pages/PagesPersistenceModel.ts:151-190). PagesNavigationModel.showPage
  moves the selected page to the end of ordered (src/renderer/api/pages/PagesNavigationModel.ts:10-22),
  which gives a most-recently-shown choice when more than one page for a board exists.
- PagesLifecycleModel.movePageIn (src/renderer/api/pages/PagesLifecycleModel.ts:710-735) restores
  the transferred page with its original id. The targetIndex -1 path calls addPage with that page,
  while the indexed path attaches and splices it directly. Keeping singleton page ids random and
  selecting by board root avoids both same-id failure modes when a board tab moves between windows.
- PagesQueryModel.findPage only accepts a page/editor id and findPageByFilePath only compares
  main-editor file paths (src/renderer/api/pages/PagesQueryModel.ts:11-31); there is no board-root
  query. PagesModel delegates these queries and owns attach/detach/dispose
  (src/renderer/api/pages/PagesModel.ts:67-126, :199-290).
- The manifest type and normalization seams are in
  src/renderer/editors/board/board-manifest.ts:66-120, :390-409, and :815-830. Existing
  standalone is the unrelated openable/pinnable axis and must not be reused for singleton routing.
- The current public bridge is 1.16.0 (src/shared/board-bridge-version.ts:2); the 1.16 addition
  is read-only service status. The torrent board declares minBridgeVersion: "1.16.0" at
  C:/projects/persephone-boards/boards/torrent-viewer/board-manifest.json:9.

## Implementation Plan

### 1. Add an opt-in manifest capability

In src/renderer/editors/board/board-manifest.ts:

- Add optional singleInstance?: boolean to BoardManifest beside the other behavioural manifest
  declarations. Keep BOARD_MANIFEST_SCHEMA_VERSION at 1; an optional false-by-default field is
  backward compatible.
- Add the normalizer/accessor isBoardSingleInstance(manifest) returning true only for the literal
  boolean true; malformed, absent, or non-boolean values are false. Keep this separate from
  isBoardStandalone and from every file/browser mask normalizer.
- Ensure the read/inspection path exposes the field without making existing manifests rewrite or
  implicitly opt in.

In C:/projects/persephone-boards/boards/torrent-viewer/board-manifest.json, add:

Before:

    "minBridgeVersion": "1.16.0",

After:

    "minBridgeVersion": "1.17.0",
    "singleInstance": true,

The torrent manifest keeps its existing fileMasks, browserUrlMasks, provider, and service
declarations unchanged.

### 2. Define the per-window identity and lookup

Use **one singleton per renderer window**, exactly as EPIC-114 D14 records. Page routing is
window-local, while the torrent service snapshot is shared per app. A link claimed in a window is
delivered to that window's board page; another window has its own board page and sees the same
service-owned torrent inventory. No cross-window focus or page registry is added.

In src/renderer/api/pages/PagesQueryModel.ts, add a structural board-root query that inspects
page.mainEditorInstance and its boardRoot, comparing roots with fpNormalizeForCompare from
src/renderer/core/utils/file-path.ts:252. Return all matching pages and a helper for the preferred
page:

- choose the last matching page in state.ordered (the most recently shown); and
- otherwise report that a new ordinary page must be created.

In src/renderer/api/pages/PagesModel.ts, add the corresponding query delegate so lifecycle code
does not reach through the submodel boundary.

Do not derive a page id from the board root. Page ids stay random so page transfer between windows
continues to preserve the original page id without colliding with a same-board page already present
in the destination window. The persisted board root remains the source of truth for editor
construction; structural board-root lookup is sufficient for restore because restore does not route a
new link and therefore cannot duplicate a page.

### 3. Route every relevant open through the singleton branch

In src/renderer/api/pages/PagesLifecycleModel.ts, add a board-singleton routing helper and call it
from the central openFile path before the existing file-path dedupe. It must:

1. Resolve the board root from the already-resolved board target (board-editor:<root>) and read its
   manifest. If there is no board root or isBoardSingleInstance is false, return control to the
   existing code unchanged.
2. If a matching page exists, show that page, enqueue the incoming raw source URL on its main
   BoardEditorModel, and dispose the incoming IContentPipe because the existing board, not the new
   page, now owns source resolution. Do not navigate/reload the page and do not overwrite its
   persisted initial source.
3. If no page exists, create the normal board editor and page with its ordinary random id, assign
   the source link/intent as today, and deliver the first source through the normal handshake and
   getSourceUrl() path.
4. In src/renderer/content/open-handler.ts:31, before the existing if (pageId) branch, inspect
   the target board and singleton manifest. If the window already has a matching board-root page,
   singleton routing wins over data.pageId: show that matching page, enqueue the source, dispose
   data.pipe exactly once, set data.handled, and return without calling navigatePageTo. This keeps
   an explicit "open in this page" request from replacing that page with a second board instance,
   which would contradict the manifest declaration. If no matching singleton page exists, preserve
   the explicit pageId navigation and let it create the first board instance in place. Non-board
   targets and non-singleton boards remain unchanged. The check belongs in open-handler.ts because
   that is the one place with the resolved target, optional pageId, and owned pipe together.
5. Cover plain board links through the same board target resolution. A plain
   persephone-board:// source is still filtered by BoardEditorModel.currentSourceUrl() and is not
   emitted as a new content source.
6. Apply the same structural board-root lookup to any board-page creation helper that can create a
   plain board page, including the addBundledBoardPage path at
   PagesLifecycleModel.ts:251-276, while retaining its existing content-host validation.

Because singleton lookup is structural and page ids remain random, this task does not alter
addPage's page-id dedupe or add collision disposal. A moved page that meets an existing same-board
page remains a second page in the destination window, which is the accepted leave-duplicates case;
future links choose the most recently shown match.

Before (current generic behaviour):

    const existingPage = filePath
        ? this.model.query.findPageByFilePath(filePath)
        : undefined;
    if (existingPage) {
        pipe?.dispose();
        this.model.navigation.showPage(existingPage.id);
        return existingPage;
    }
    const editor = await this.createEditorFromFile(filePath, pipe, options?.target);
    const page = this.addPage(wrap(editor));

After (planned singleton branch before generic behaviour):

    const singleton = await this.openSingleInstanceBoard(
        filePath, pipe, options,
    );
    if (singleton) return singleton;
    // Existing file-path dedupe and all non-singleton editor opens remain below.

The helper must pass a raw sourceUrl to the existing page, not bytes, a materialized cache path, or
a second service/provider. For torrent links this is the self-contained D5 href; for a claimed
.torrent file or browser URL it is the provider source URL already placed in sourceLink.url by
open-handler.ts.

### 4. Deliver a new source to an already-open board frame

Add a dedicated host-frame push; do not overload capability intents, RPC, or the initial handshake.
Capability intents are request/reply operations with handler registration and deadlines, whereas a
source-open is an ordered board lifecycle event.

In src/ipc/board-bridge-channels.ts:

- Define a renderer-to-board BoardSourceOpenedMsg, for example
  { __persephone: "source:opened", sourceUrl: string }.
- Add it to BoardHostFrameMsg, documenting that it carries source identity only and never payload
  bytes or a provider pipe.

In src/renderer/editors/board/BoardEditorModel.ts:

- Add a FIFO pending-source queue and an enqueueSourceUrl(sourceUrl) method for the lifecycle
  router. Keep it separate from state.sourceLink, initial intent, and persisted restore data.
- Clear the queue in dispose() and when the page is closed. Do not alter getRestoreData() or
  currentSourceUrl(); cold restore continues to use the existing handshake source.

In src/renderer/editors/board/BoardWebview.ts:

- Add a method that posts queued source events to the main iframe using the same board-origin target
  and frame-generation checks used by handleLoad/transferPort.
- Flush after the frame is live and after reload/handshake setup. Retain events until a live frame
  has accepted the post; a frame replacement must not lose queued links.
- Do not send the event to secondary board views; the main board frame owns source/session state.

In src/board-shim.ts and src/renderer/editors/board/board-api.d.ts:

- Expose persephone.source.onOpen(callback) returning an unsubscribe function, with a typed event
  containing the raw url/sourceUrl.
- Document in board-api.d.ts that source.onOpen delivers runtime source identities only; the host
  persists only the initial source through getSourceUrl(). Any single-instance board that needs
  later sources after restart must persist its accepted source hrefs/magnets itself, using the
  existing persephone.state.init(defaults, { restorableKeys }) contract.
- Install the host-message listener before board application code runs and buffer source events until
  the board subscribes. Deliver buffered events FIFO, then deliver subsequent events synchronously
  through the same callback set. This closes the load race between the renderer posting a source and
  app.js registering its listener.
- Keep the queue frame-local and clear it on frame teardown. A source callback failure must be logged
  like the existing settings/intent callback failures and must not prevent later callbacks.

The public API addition is a bridge contract change. Bump
src/shared/board-bridge-version.ts:2 from 1.16.0 to 1.17.0; update the version comments in
src/board-shim.ts:1367-1385 and the board API declaration. src/main/board-bridge.ts does not need
a new RPC or channel handler because this event travels over the existing renderer-to-main-frame
postMessage host-frame channel; verify that no service-start or provider-registration behaviour is
changed.

### 5. Update the torrent viewer consumer

In C:/projects/persephone-boards/boards/torrent-viewer/app.js:

- Use the existing restorable shared-state contract from src/board-shim.ts:1799-1818 and
  EPIC-044 D9 (doc/epics/EPIC-044.md:94-105, especially D9) by initializing
  P.state.init({ acceptedSources: [] }, { restorableKeys: ["acceptedSources"] }) before source
  loading. The persisted value is an array of canonical source href/magnet strings only; never
  persist torrent metadata, info files, file descriptors, bytes, or service snapshots.
- Keep loadOpenedSource() (:866-875) and its P.getSourceUrl() call for initial open and cold
  restore, but expand it into a loadOpenedSources flow that combines the initial source with the
  restored acceptedSources list. De-duplicate the initial source against the restored list before
  resolving.
- Record a source when it enters the board's accepted resolve path, including sources from
  source.onOpen, the Add magnet control, and Choose torrent. Keep the persisted list bounded by
  canonical-string de-duplication. During restore, derive an infoHash from D5 torrent links and
  magnet identifiers where possible; compare it with serviceTorrents and already scheduled jobs
  before calling resolveSource. For sources whose infoHash is not available from the source string,
  resolve serially and refresh the snapshot before deciding whether another source is the same
  torrent. Never issue two restore resolves for one infoHash.
- Register P.source.onOpen(({ url }) => { if (isTorrentSource(url)) void resolveSource(url); })
  during startup before the board can receive user-driven source events. Use the existing
  resolveSource (:478-520) so service resolution, polling, error handling, and rendering stay
  unified.
- Unsubscribe in the existing teardown at :878-884/:901-902, and make teardown leave the
  restorable acceptedSources state intact.
- In reconcileSnapshot (:637-736), compare the previously observed service infoHash set with the
  current reconciled rows. When an infoHash that was present disappears from the authoritative
  snapshot and has no active resolution row, remove the corresponding source href/magnet from
  acceptedSources. This is the rule for a torrent removed in a different window: D14 gives both
  pages the same service snapshot, and each page prunes its own persisted source list when that
  source's infoHash disappears. Keep the source-to-infoHash association in memory; derive hashes
  from D5/magnet strings where possible and update it after successful resolve.
- In removeTorrent (:795-832), remove the source entry for the successfully removed infoHash as
  soon as the removal is confirmed, then let the following reconcileSnapshot call apply the same
  authoritative pruning rule.
- Do not add another WebTorrent client, page-local torrent inventory, service snapshot request, or
  payload-bearing bridge message. The already-landed serviceTorrents/snapshot reconciliation remains
  the source for the list.

Before:

    renderAll();
    void bootstrapService();
    void loadOpenedSource();

After:

    const unsubscribeSource = P.source.onOpen(({ url }) => {
        if (isTorrentSource(url) && !tearingDown) void resolveSource(url);
    });
    renderAll();
    void bootstrapService();
    void loadOpenedSource();

The exact placement may follow the board's existing initialization style, but subscription must be
installed before the first possible singleton delivery and teardown must call the returned function.

### 6. Boards-repo release and task bookkeeping

Follow C:/projects/persephone-boards/CLAUDE.md's release rules for the consumer:

- In C:/projects/persephone-boards/boards/torrent-viewer/board-manifest.json, bump version
  1.3.0 to 1.4.0, in addition to minBridgeVersion 1.17.0 and singleInstance true. The top
  C:/projects/persephone-boards/boards/torrent-viewer/WHATS-NEW.md heading must become 1.4.0 and
  contain a terse line for singleton source routing and restart persistence.
- Update C:/projects/persephone-boards/boards/torrent-viewer/README.md to describe D14's
  per-window page/shared-per-app service behavior, source.onOpen, and board-owned persistence of
  later source hrefs/magnets; update its bridge requirement from 1.16.0 to 1.17.0.
- Add the board-local task document
  C:/projects/persephone-boards/doc/tasks/BT-026-torrent-viewer-single-instance/README.md and a
  Planned entry for BT-026 in C:/projects/persephone-boards/doc/active-work.md. BT-026 is the next
  sequential id after the existing BT-025 entry; do not mark BT-025 complete or move it until the
  board change actually starts.

### 7. Preserve non-singleton and lifecycle semantics

- singleInstance defaults to false. Editor boards that open one file per page continue through the
  current findPageByFilePath/openFile flow, with the same pipe ownership, file target, grouping,
  pinning, and navigation behaviour.
- Grouping is untouched: showing a singleton page focuses that page and preserves its existing pair;
  the new link is delivered to that page, never to its grouped partner and never into a new group.
- Pinning is untouched: a pinned singleton page is reused and remains pinned. Closing it disposes the
  frame/queued events normally; the next link creates a fresh ordinary page.
- If multiple pages for a board already exist when the manifest becomes single-instance, leave every
  page open and do not merge, close, or rewrite them. Route future links to the most recently shown
  matching page. If all matching pages are later closed, the next link creates a fresh ordinary page.
- The scope is per window. No new cross-window singleton routing or focus is added; the existing
  page-transfer mechanism remains unchanged, with ordinary random page ids.

## Concerns

### Source delivery and ownership

The event contains only the source identity. The new page path owns the normal pipe and handshake;
the existing-page path disposes the newly-created pipe immediately after queuing its source. This is
necessary for archive/non-local pipes and prevents a discarded IContentPipe from leaking. The torrent
board resolves the source through its existing app-wide service, so one board frame remains the
provider UI for all links in the window.

### Load/reload races

There are two queues: the renderer model queue waits for a live iframe, and the shim queue waits for
P.source.onOpen subscription. Both are FIFO and frame-local. Initial getSourceUrl() remains a
separate one-shot handshake value; it is not replayed as a source-open event, avoiding duplicate
resolution on first load.

### Restore and cross-window moves

Persisted descriptors retain the ordinary random page id and board root. Restore does not route a new
link, so it cannot create a duplicate; the next claimed link uses the board-root query over restored
pages. Page transfer keeps the original id. If the destination window already has a matching board
page, the moved page is still attached as a second page and remains available; no addPage id
collision or silent drop is introduced. Future links use the most recently shown matching page.

### Restart persistence and app-shared state

The platform's initial getSourceUrl handoff persists only the source that created the board page.
Every later source delivered through source.onOpen is the board's responsibility to persist if it
must survive restart. The torrent viewer uses EPIC-044 D9's restorable shared state for source
hrefs/magnets only. Its page-local list is rebuilt from those sources plus the shared app service
snapshot, and a source is pruned when authoritative reconciliation shows its infoHash has gone away.
This preserves D1 and makes the per-window persisted source list compatible with D14's per-app
service state.

### Manifest and bridge compatibility

Old manifests remain non-singleton. A board that declares singleInstance but requires bridge 1.17
must be rejected by the existing manifest bridge-compatibility gate until the host exposes the new
API. The external torrent manifest therefore raises minBridgeVersion together with the opt-in.
No BOARD_MANIFEST_SCHEMA_VERSION bump is required.

### No unresolved design questions

The decisions are settled for implementation: D14 per-window routing with per-app service state; a
queued new host-frame event with a 1.17 bridge bump; structural board-root lookup over ordinary page
ids; explicit pageId overridden only when an existing matching singleton page is present; and
leave-existing-duplicates/most-recently-shown routing. No unit-test work is planned; verification is
the acceptance scenarios below plus the project's normal type/build checks.

## Acceptance Criteria

- A trusted/bundled manifest with "singleInstance": true is recognized by the renderer; absent,
  false, malformed, and unknown values do not opt a board in.
- In one window, opening two different claimed torrent links (torrent:, magnet:, local *.torrent,
  and claimed browser *.torrent URLs) produces one Torrent Viewer page. The second link is delivered
  without a board reload, and the viewer resolves it through the existing resolveSource path.
- The torrent viewer's service-derived list shows both torrents after the two opens, including when
  the second link is delivered while the first page is still loading.
- A source delivered while the iframe is loading, or between host post and P.source.onOpen
  subscription, is queued and delivered exactly once in order after subscription. Reloading the page
  does not lose a source that was already queued for the live page; the initial persisted source is
  not duplicated by the event queue.
- A singleton page restores from a persisted descriptor without creating a duplicate on cold start.
- Opening two torrent links produces one page with two torrents; after restarting Persephone, the
  restored page lists both torrents again from its persisted acceptedSources and the shared service
  snapshot, without issuing duplicate resolves for one infoHash.
- If multiple matching pages already exist, none is closed or merged; new links choose the most
  recently shown matching page. Closing the final matching page makes the next link create a fresh
  ordinary page.
- Grouped and pinned singleton pages retain their grouping/pinned state while receiving a source.
- For a target single-instance board, an explicit pageId is overridden only when a matching board
  page already exists in that window; the pipe is disposed once and navigatePageTo is not called.
  With no matching page, the explicit pageId still creates the first board instance in place.
- Removing a torrent from this page or a different window prunes its source href/magnet from this
  page's restorable acceptedSources after reconcileSnapshot observes the infoHash disappear.
- Incoming pipes are disposed when a source is routed to an existing page; no duplicate board editor,
  provider, service process, or orphaned pipe is created.
- A board without singleInstance still opens separate pages exactly as today, including editor
  boards opened per file. Existing fileMasks, browserUrlMasks, scheme routing, explicit page-id
  navigation, D5 source persistence, and US-1529 snapshot behaviour remain intact.
- The public bridge is reported as 1.17.0; a board requiring 1.17 is gated by the existing minimum
  bridge check, and the torrent viewer manifest declares both the opt-in and the new minimum.

## Files Changed Summary

| File | Planned change |
|---|---|
| src/renderer/editors/board/board-manifest.ts | Add and normalize singleInstance. |
| src/renderer/api/pages/PagesQueryModel.ts | Query pages by board root and select the most recently shown match. |
| src/renderer/api/pages/PagesModel.ts | Delegate the board-page query. |
| src/renderer/api/pages/PagesLifecycleModel.ts | Route singleton opens using structural board-root lookup while preserving ordinary page ids and generic opens. |
| src/renderer/content/open-handler.ts | Override explicit pageId only when an existing matching singleton page is present, before navigatePageTo. |
| src/renderer/editors/board/BoardEditorModel.ts | Queue source identities and clear them with frame/page disposal. |
| src/renderer/editors/board/BoardWebview.ts | Flush source events to the live main board frame. |
| src/ipc/board-bridge-channels.ts | Define the host-frame source-open message and union member. |
| src/board-shim.ts | Add queued persephone.source.onOpen and bridge-version documentation. |
| src/renderer/editors/board/board-api.d.ts | Declare the new public source event API. |
| src/shared/board-bridge-version.ts | Bump bridge version to 1.17.0. |
| C:/projects/persephone-boards/boards/torrent-viewer/board-manifest.json | Opt in and require bridge 1.17.0. |
| C:/projects/persephone-boards/boards/torrent-viewer/app.js | Subscribe to source-open events, persist accepted sources through restorable state, restore/dedupe them, and prune removed torrents. |
| C:/projects/persephone-boards/boards/torrent-viewer/WHATS-NEW.md | Record the 1.4.0 singleton/restart-persistence change. |
| C:/projects/persephone-boards/boards/torrent-viewer/README.md | Document D14, source.onOpen, persistence, and bridge 1.17.0. |
| C:/projects/persephone-boards/doc/active-work.md | Add the planned BT-026 board task entry. |
| C:/projects/persephone-boards/doc/tasks/BT-026-torrent-viewer-single-instance/README.md | Track the board-repo half of US-1530. |
| doc/active-work.md | Keep the US-1530 dashboard entry and replace its placeholder dependency note. |

Files verified and intentionally unchanged: src/renderer/api/pages/well-known-pages.ts,
src/renderer/content/resolvers.ts,
src/renderer/api/internal/RendererEventsService.ts,
src/renderer/editors/board/custom-editor-registry.ts, src/renderer/editors/board/index.ts,
src/main/board-bridge.ts, and the US-1529 service/snapshot implementation. These files continue to
provide routing, source construction, board-target resolution, and service RPC plumbing; the
singleton decision is centralized in the page lifecycle and the new event uses the existing
host-frame postMessage channel.

## Corrections made during implementation and live verification (2026-09-27)

Recorded here because the boards-repo run could not write to this repository.

1. **Pruning is scoped to one service instance.** A service crash-restart (the supervisor restarts it
   and `restartCount` increments) or a clean stop empties the snapshot of every torrent at once. The
   board tracks the instance (`pid` / `startedAt` / `restartCount` from `persephone.service.status()`)
   and treats an instance change or a non-running state as a service reset: the persisted list is
   kept and re-resolved, never pruned. Explicit removal through `removeTorrent` still prunes at once.
2. **Only a torrent that was READY counts as present for pruning.** As first implemented, resolving
   rows counted too — they carry the magnet's infoHash — and a failed resolve drops it, so a failed
   resolve silently removed the source from `acceptedSources` while the page still showed it as
   failed-with-Retry. Found live: Boney M vanished from the saved list after a timeout. Fixed in
   `app.js` `reconcileSnapshot` by observing ready rows only.
3. **A source queued for an already-live frame was never flushed.** `enqueueSourceUrl` filled the queue,
   but `BoardWebview` flushed only on frame load and handshake — so the main case (a second link to an
   open page) waited for the next reload. Fixed with `BoardEditorModel.onPendingSourceUrl`, which the
   main `BoardWebview` subscribes to and flushes on.

Live results: two magnets opened 300 ms apart → one page, two rows. A magnet sent to the live page
appeared without a reload. A second window got its own page; both windows listed the same three
torrents (D14). A failed resolve stayed saved. After a main-process restart the page restored with all
three saved sources and re-resolved them. **Not verified live:** dragging a torrent tab into a window
that already has one — it needs a real drag (`src/main/drag-model.ts`); with random page ids the
collision it used to cause cannot occur.
