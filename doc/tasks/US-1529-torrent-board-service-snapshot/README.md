# US-1529: The torrent list comes from the service snapshot, not page-local state

## Status

Status: Planned  
Priority: High  
Epic: [EPIC-114: The torrent board — a module contributes below the UI](../../epics/EPIC-114.md)

This document is an investigation and implementation plan only. No implementation is included and no
commit is requested.

## Goal

Make the torrent board render its torrent and file lists from the shared service's op: "snapshot"
result. Every board page must show every torrent currently owned by the service, including torrents
resolved by another page or restored before any board page existed, while selection, transient status
text, and resolution-job ownership remain local to the page.

The change preserves EPIC-114 D1 and D5: listing metadata must not move payload bytes, and every
torrent:// file link remains self-contained with its canonical magnet.

## Background

### Binding decisions and scope

EPIC-114 D1–D11 and its UI design are binding. D1 requires metadata-only resolution with
deselect: true at client.add, no file selection/read stream/disk write during listing, and payload
movement only for a provider reader or the explicit Download-this-file action. D5 requires the
encoded file path and magnet in each torrent:// link so cold provider restore works without a board
page.

This task does not make the board single-instance and must not route a second claimed link into an
existing page. That is [US-1530](../US-1530-single-instance-boards/README.md). It does not add a
dependency, second WebTorrent client, disk store, eviction policy, test harness, or bundle change.

The unchecked US-1529 entry already exists under EPIC-114 in
[doc/active-work.md](../../active-work.md). It must remain there; no dashboard edit is needed for
this document-only investigation.

### Defect confirmed from the current code

In C:/projects/persephone-boards/boards/torrent-viewer/app.js:

- sessions is created at line 55 and is populated only by addSession after this page's own
  waitForResolution completes.
- renderTorrentList at lines 246–305 sorts sessions.values(), so it cannot render a torrent another
  page resolved.
- renderFileList at lines 308–374 also reads only sessions.get(selectedInfoHash).
- updateSessionStats at lines 588–609 uses a snapshot only to update existing sessions; it never
  inserts, replaces, or removes one.
- The initial poll at line 667 therefore cannot hydrate an empty/local map. A second board page
  lists only its own source; a reload loses the page-local list while the service retains it; and
  a cold-start provider restore can leave service torrents with no board page that knows them.

Legitimate page-local state must remain local: selectedInfoHash, selection.fileIndex,
previousDownloaded, stalledSamples, transient pageStatus text, and source/request ownership for
resolution jobs started by this page.

### Exact snapshot response today

C:/projects/persephone-boards/boards/torrent-viewer/scripts/service.mjs:823-843 dispatches op:
"snapshot" to getServiceSnapshot() without consuming completed jobs. Its current response is:

| Field | Exact current value | Consequence |
|---|---|---|
| client | null, or { destroyed: client.destroyed === true, torrentCount: torrentsByInfoHash.size } | Presence diagnostic, not the list. |
| torrents | One torrentStatus(torrent) per distinct value in torrentsByInfoHash | Shared inventory, but incomplete for rendering. |
| torrents[].infoHash | torrent.infoHash ?? null | Stable identity already present. |
| torrents[].name | torrent.name ?? null | Display name already present, nullable while resolving. |
| torrents[].ready | torrent.ready === true | Metadata readiness. |
| torrents[].fileCount | torrent.files.length, or 0 | Count only; no file descriptors. |
| torrents[].peers | finite torrent.numPeers, otherwise 0 | Peer statistic. |
| torrents[].downloadSpeed | finite torrent.downloadSpeed, otherwise 0 | Rate statistic. |
| torrents[].downloaded | finite torrent.downloaded, otherwise 0 | Counter used by the page's stalled heuristic. |
| torrents[].activeReaders | activeReaderCounts.get(torrent) ?? 0 | Service-wide reader count. |
| torrents[].allFilesDeselected | selectionState.get(torrent)?.allDeselected === true | Selection diagnostic. |
| activeResolutionJobs | Resolving jobs only: requestId, infoHash, lastPollAt | Service-wide jobs; infoHash can be null for an in-memory .torrent buffer. |
| completedMetadata | Non-resolving jobs: requestId, state, torrent: job.result, error: job.error | Temporary completed metadata/failure records. |

metadataFor at service.mjs:126-140 returns exactly:

    {
        infoHash: torrent.infoHash,
        magnet: torrent.magnetURI,
        name: torrent.name,
        files: files.map((file, index) => ({
            path: file.path.split("\\").join("/"),
            length: file.length,
            index,
        })),
    }

Thus the persistent torrents entries have name/infoHash, peers/rate, downloaded/readers,
readiness, and deselection state, but do not have magnet or files. The complete metadata exists only
in a request-specific status completion or temporary completedMetadata. The snapshot has no
presentation state string: metadata only, streaming, and stalled are page UI labels, with stalled
derived from consecutive samples.

The snapshot must therefore be extended with canonical magnet and normalized files for ready
torrents. No raw WebTorrent object, torrent source, Uint8Array, chunk, or reader data may be added.

### Service-backed model

Build a service-derived map from the latest snapshot, separate from a page-state map. Reconciliation
must:

1. Replace service torrent rows from snapshot.torrents, keyed by lower-cased infoHash, and remove
   rows absent from the latest snapshot.
2. Add one resolving placeholder per activeResolutionJobs entry not represented by a ready torrent.
   Use infoHash when present and requestId when it is null. Merge a known-hash not-ready torrent
   with its job instead of showing two rows.
3. Preserve only page-local selection, file-index, sampled download history, own job source/request
   data, and transient status. Do not let a snapshot overwrite page selection or status text.
4. Keep selectedInfoHash when its row remains; if it disappears, clear it or select the first
   ready sorted row. A resolving row has no invented files.
5. Keep existing name/file sorting and derive the state dot from snapshot activeReaders plus the
   page's stalledSamples heuristic. Do not make stalled a service field.

### Foreign torrents and actions

A foreign ready row has infoHash, magnet, and files from the extended snapshot:

- renderFileList can show its files without assuming this page resolved it.
- buildFileLink at app.js:215-218 can construct the D5 link from snapshot infoHash and magnet. If
  either is malformed, report the existing actionable error; do not use a page-local source or
  materialize a source.
- Open, Copy link, and the explicit guarded Download-this-file action work against the foreign row.
- Remove continues to send infoHash. Only this page's activeResolutions may be cancelled by this
  page; a foreign job must remain untouched.
- The service remains authoritative for in-use. service.mjs:245-251 checks active readers and its
  30-second recent-read window, while snapshot exposes activeReaders. Keep sending Remove and map
  torrent-removal-active-readers to the existing user sentence; do not duplicate or weaken the
  recent-read rule.

### Resolution jobs and terminal outcomes

resolutionJobs is service-wide. activeResolutions is only this page's map for polling, retry, and
teardown cancellation. A job started by another page must appear from activeResolutionJobs before
completion, as one resolving placeholder. Do not expose job.source: for a magnet it is redundant,
and for an in-memory .torrent it can be the payload-bearing Uint8Array.

Resolution status is currently destructive: readResolutionStatus deletes a terminal job at
service.mjs:710-711, while getServiceSnapshot(true) expires every terminal job at :756-759. That
is safe only while each page reads only its own request. This task must retain completed, failed,
and cancelled jobs for the existing COMPLETED_RESULT_TTL_MS, report them in completedMetadata on
non-consuming snapshots, and let TTL expiry be the only normal cleanup. readResolutionStatus(requestId)
must return the terminal result without deleting it. No explicit acknowledgement is needed because
the existing bounded TTL prevents indefinite retention.

The board must reconcile terminal completedMetadata records as well as active jobs. A failed or
cancelled foreign job gets one requestId-keyed terminal row with its mapped actionable sentence,
but it must not be confused with this page's own retry state. Only the page that owns an
activeResolutions entry may add the existing error toast/retry action. Snapshot reconciliation for
a foreign terminal job updates its row only: it must not call setStatus or P.notify, so two pages do
not raise duplicate toasts for one failure. Successful terminal records de-duplicate against the
ready torrents entry by infoHash.

When metadata completes, rememberTorrent already makes the service torrent available. The next
snapshot replaces the active placeholder with one complete row. A page-owned status poll may still
handle its own success/error text, but completion must trigger or await a fresh snapshot before
treating the list as reconciled. Teardown must not cancel foreign jobs.

### Lifecycle and the no-start empty list

persephone.service.request always starts a declared service lazily:
src/renderer/editors/board/board-api.d.ts:267-280 and
src/main/module-service-supervisor.ts:321-356. Therefore an unconditional initial snapshot starts a
stopped utility process merely to discover an empty list.

The existing main supervisor already has non-starting getStatus at
src/main/module-service-supervisor.ts:265-268, but the board frame cannot read it. Add a
read-only persephone.service.status() RPC returning the existing state
(stopped, starting, running, stopping, or failed, with the optional reason), routed to
moduleServiceSupervisor.getStatus(entry.root). It must never call start, and it does not change
supervisor policy.

The board lifecycle is:

| State | List | Requests |
|---|---|---|
| Missing/stopped | Neutral empty state such as “No active torrents”; no error and no stale clickable rows. | No snapshot. An explicit add/resolve may start the service. |
| Starting | Neutral “Torrent service starting…” state; do not call this broken. | Poll status only; wait for running before snapshot. |
| Running | Exact reconciled service inventory plus active-job placeholders. | Serialized snapshot polling. |
| Stopping | Neutral transition/empty state; stop polling. | No new service request. |
| Failed | Legible unavailable state and explicit retry/add recovery; no automatic restart. | No snapshot probe; explicit resolve may follow existing error handling. |

After US-1526's successful last-torrent removal confirms no torrents and no active jobs and calls
P.service.stop(), clear the service-derived model, stop timers, set serviceStopped, and show the
neutral empty state. A later explicit add may clear the guard and start the service. Pagehide and
beforeunload remain neither a stop signal nor a reason to remove retained torrents.

## Implementation Plan

### 1. Extend the metadata-only service snapshot

In C:/projects/persephone-boards/boards/torrent-viewer/scripts/service.mjs:

- Factor the normalized { infoHash, magnet, name, files } projection from metadataFor into a pure
  metadataProjection helper. metadataFor still performs the existing deselection step.
- Extend torrentStatus for ready torrents with magnet and the normalized path/length/index files.
  Keep all existing live fields. For not-ready entries, do not fabricate metadata; the board uses the
  active job as the resolving row.
- Preserve snapshot's non-consuming semantics and the COMPLETED_RESULT_TTL_MS terminal retention.
  Make readResolutionStatus terminal reads non-destructive. Remove the implicit consume-all path
  from status without a request id: it currently calls getServiceSnapshot(true) at
  service.mjs:829-831, which in turn expires every terminal job at :756-759. Since no current board
  caller needs that destructive convenience and shared pages must not consume one another's
  outcomes, route that branch to getServiceSnapshot() and remove the boolean
  consumeCompletedMetadata behavior.
- Preserve client.add(..., { deselect: true }), torrent/viewer, stat/readRange/readBinary,
  removal, shutdown, metadata timers, and the vendored bundle.

Before:

    function torrentStatus(torrent) {
        const selection = selectionState.get(torrent);
        return {
            infoHash: torrent.infoHash ?? null,
            name: torrent.name ?? null,
            ready: torrent.ready === true,
            fileCount: Array.isArray(torrent.files) ? torrent.files.length : 0,
            peers: Number.isFinite(torrent.numPeers) ? torrent.numPeers : 0,
            downloadSpeed: Number.isFinite(torrent.downloadSpeed) ? torrent.downloadSpeed : 0,
            downloaded: Number.isFinite(torrent.downloaded) ? torrent.downloaded : 0,
            activeReaders: activeReaderCounts.get(torrent) ?? 0,
            allFilesDeselected: selection?.allDeselected === true,
        };
    }

After:

    function torrentStatus(torrent) {
        const selection = selectionState.get(torrent);
        const metadata = torrent.ready === true ? metadataProjection(torrent) : undefined;
        return {
            ...(metadata ?? {
                infoHash: torrent.infoHash ?? null,
                name: torrent.name ?? null,
                files: [],
                magnet: null,
            }),
            ready: torrent.ready === true,
            fileCount: Array.isArray(torrent.files) ? torrent.files.length : 0,
            peers: Number.isFinite(torrent.numPeers) ? torrent.numPeers : 0,
            downloadSpeed: Number.isFinite(torrent.downloadSpeed) ? torrent.downloadSpeed : 0,
            downloaded: Number.isFinite(torrent.downloaded) ? torrent.downloaded : 0,
            activeReaders: activeReaderCounts.get(torrent) ?? 0,
            allFilesDeselected: selection?.allDeselected === true,
        };
    }

The exact property order is not important; the D1 restrictions are.

### 2. Add a non-starting board status read

- src/ipc/board-bridge-channels.ts: add serviceStatus to BoardRpcMethod and its existing
  BoardServiceStatus result contract.
- src/main/board-bridge.ts: route serviceStatus to moduleServiceSupervisor.getStatus(entry.root);
  never route it through request/start.
- src/board-shim.ts: expose service.status() beside request() and stop().
- src/renderer/editors/board/board-api.d.ts: document that status is read-only, never starts the
  service, and returns the existing lifecycle state shape.
- Do not change src/main/module-service-supervisor.ts; getStatus/statusOf already exist.

Before:

    interface PersephoneServiceApi {
        request(message: unknown): Promise<unknown>;
        stop(): Promise<void>;
    }

After:

    interface PersephoneServiceApi {
        request(message: unknown): Promise<unknown>;
        status(): Promise<BoardServiceStatus | undefined>;
        stop(): Promise<void>;
    }

### 3. Reconcile app.js from service truth

In C:/projects/persephone-boards/boards/torrent-viewer/app.js:

- Replace sessions as the rendered inventory with a service-derived map and separate page-state map.
- Make pollSnapshot pass each successful response through one reconciliation function that replaces
  service rows, removes absent rows, and merges active-resolution placeholders.
- Keep one snapshot in flight, existing cadence, teardown guards, name sorting, file sorting, state dot,
  and existing transient status handling.
- Change renderTorrentList/renderFileList to consume only the reconciled service model.
- Remove the assumption that addSession creates the rendered row. A page-owned resolve may set
  selection and own-job retry/source state, then reconcile from a fresh snapshot.
- Reconcile completedMetadata failures/cancellations as terminal requestId-keyed rows until their
  service TTL expires. Show the mapped failure sentence in the row, but do not create a local retry
  action or toast for a foreign terminal job; only the originating page's activeResolutions entry
  owns the existing Retry/P.notify path. De-duplicate successful completedMetadata by infoHash.
- Keep activeResolutions for own status/cancellation only. Never cancel a foreign active job at
  teardown.
- Validate snapshot magnet/infoHash in buildFileLink call sites. Keep D5 encoding, removal by hash,
  service refusal handling, the 256 MiB download guard, and save-dialog ordering.

Before:

    const torrents = [...sessions.values()].sort((left, right) => {
        const byName = String(left.metadata.name).localeCompare(String(right.metadata.name));
        return byName || left.infoHash.localeCompare(right.infoHash);
    });

After:

    const torrents = [...serviceTorrents.values()].sort(compareTorrentRows);

The after collection must be rebuilt from the most recent snapshot; pageStateByInfoHash is only an
enrichment map and is never allowed to create a torrent row by itself.

### 4. Make boot and stop lifecycle status-aware

- Replace unconditional startup pollSnapshot with a bootstrap that renders the neutral initial state,
  calls service.status(), polls status while starting, and begins snapshot polling only when running.
- Clear service rows and stop polling for stopped/stopping after US-1526's own stop; show a neutral
  empty/transition state rather than an error.
- Show failed as service-unavailable with explicit recovery and no automatic restart.
- An explicit resolve/add may call service.request(resolve), start a stopped service, and then hydrate
  every retained service torrent through snapshot.
- Keep P.service.stop only in US-1526's confirmed last-remove path; no pagehide stop or idle timer.

### 5. Verify cross-page, D1, D5, and lifecycle cases

- Resolve two different claimed sources through two board pages; both lists must show both torrents,
  and a foreign row's files and D5 links must work.
- Reload/reopen while the service remains alive; the complete list must come from a fresh snapshot.
  Open a board after provider-only cold-start restore and confirm retained torrents appear.
- Start metadata in one page and observe one resolving row in a second page before completion; the
  row must become one complete row without exposing source bytes or cancelling the other page's job.
- Remove a foreign row by infoHash; verify service-wide reader/recent-reader refusal still protects
  an open content page.
- Verify snapshot/listing causes no readRange/readBinary/createReadStream/file selection/disk write
  and no downloaded-counter increase.
- Exercise stopped, starting, running, stopping, failed, and just-stopped states. A stopped board
  must not launch the utility process merely to render empty.

### 6. Dashboard check

Confirm the existing unchecked US-1529 link remains under EPIC-114 in
C:/projects/persephone/doc/active-work.md. Do not duplicate it, move US-1530, or alter epic
decisions.

## Concerns

- File metadata makes snapshots larger as file count grows, but remains control metadata. Limit it
  to path, length, index, and canonical magnet; never add raw torrent data or buffers.
- Resolution outcomes are shared state, and the current one-shot status read is unsafe for that
  state: service.mjs:710-711 deletes the job on the first terminal read. Retain terminal jobs for
  COMPLETED_RESULT_TTL_MS and make terminal status reads non-destructive so a foreign failure cannot
  vanish between activeResolutionJobs and completedMetadata. The existing TTL is the bounded cleanup;
  no acknowledgement operation is needed.
- status without requestId is a latent destructive branch: service.mjs:829-831 calls
  getServiceSnapshot(true), whose :756-759 loop expires every non-resolving job. No current board
  call reaches it, but the plan routes it to the non-consuming getServiceSnapshot() path and removes
  the consumeCompletedMetadata branch; a future generic status poll must not erase another page's
  completion.
- rememberTorrent inserts a magnet torrent before metadata completes, while activeResolutionJobs
  reports that same job. Merge by infoHash/requestId so one resolving job is never two rows.
- An in-memory .torrent job can have null infoHash. Show a requestId-keyed generic resolving row and
  replace it with the ready service row; never serialize the source bytes.
- Stalled samples, previousDownloaded, selection, and status are page heuristics/enrichment. Drop
  them when the authoritative service row disappears; never let them imply page ownership.
- The extra status RPC is necessary because request(snapshot) starts services. It is read-only,
  routes to an existing supervisor query, and adds no lifecycle policy. If an equivalent published
  board-frame status method is found during implementation, reuse it while retaining the no-start
  guarantee.
- A stopped/failed service has no trustworthy live inventory. Do not leave stale clickable rows or
  restart automatically; explicit resolve/retry is recovery.
- US-1530 remains separate: no singleton declaration, page reuse, link delivery, grouped-page
  routing, or window policy belongs here.
- Source review confirms the map/response-shape defect; cross-page timing, cold-start retention,
  state transitions, and byte counters require the running-app verification above.

## Acceptance Criteria

1. Ready snapshot torrents contain infoHash, canonical magnet, name, normalized files, peers,
   downloadSpeed, downloaded, ready, and activeReaders; active and terminal jobs remain visible
   through their bounded TTL without source buffers or payload bytes.
2. The board list and file pane are rebuilt from the latest service snapshot. A torrent resolved by
   another page, or retained after a reload, appears with files and a working D5 link.
3. A foreign in-flight job appears before completion as one resolving row; null-hash jobs use request
   identity without exposing source bytes, and completion replaces it with one ready row.
4. Selection/file-index state, stalled history, transient status, and own-job cancellation/retry
   ownership remain page-local. Teardown does not cancel foreign jobs or stop the service.
5. Foreign rows support file listing, Open, Copy, guarded Download-this-file, and Remove. Remove
   still honors the service's active-reader/recent-reader refusal.
6. Terminal status reads and shared status snapshots do not delete another page's outcome. A
   foreign failed/cancelled job renders one mapped terminal row without a duplicate toast or being
   confused with this page's own retry state; successful terminal metadata de-duplicates by hash.
7. Extending the snapshot remains metadata-only: it must not move payload bytes, and files contain
   only path, length, and index — never a buffer, stream, reader handle, or raw torrent source.
   Listing performs no payload read, read stream, file selection, or disk write, and does not weaken
   deselect: true/provider contract. No dependency, second client, disk store, eviction policy, or
   bundle change is introduced.
8. Stopped is a neutral empty state with no process start; starting is a neutral status-polled state;
   running is snapshot-polled; stopping/failed do not leave stale clickable rows or auto-restart.
9. After US-1526's confirmed last-remove stop, the board clears rows, stops timers, remains usable,
   and allows a later explicit add to start/hydrate. Pagehide/beforeunload does not stop the service.
10. Two-page, reload, and D5 cold-start scenarios show the complete shared inventory. No US-1530
   routing behavior is introduced.
11. No unit tests or test harnesses are added; verification uses source review and running-app
    scenarios.

## Files needing no changes

- C:/projects/persephone-boards/boards/torrent-viewer/board-manifest.json — retain service,
  claims, and torrent/viewer provider type.
- C:/projects/persephone-boards/boards/torrent-viewer/board-base.css and index.html — existing
  themed layout is sufficient; no hardcoded colours or layout rewrite.
- C:/projects/persephone-boards/boards/torrent-viewer/lib/webtorrent.bundle.mjs,
  scripts/build-webtorrent.mjs, package.json, and package-lock.json — no bundle/dependency change.
- src/main/module-service-supervisor.ts — getStatus and main-owned stop already exist; do not alter
  supervisor lifecycle policy.
- src/renderer/api/boards.ts and src/renderer/api/module-service-status.ts — app board listings
  already have status; the new read is board-frame scoped.
- src/renderer/content/rebuild-pipe.ts, src/renderer/content/scheme-registry.ts,
  src/renderer/editors/board/custom-editor-registry.ts, src/renderer/editors/video/VideoEditor.ts,
  src/main/video-stream-server.ts, and src/renderer/editors/board/board-pipe-handler.ts —
  D5/provider registration/stat-before-range/reader ownership seams are already correct.
- doc/epics/EPIC-114.md and doc/tasks/US-1530-single-instance-boards/README.md — binding decisions
  and the separate routing boundary are already recorded.
- Unit-test files and harnesses — this project does not use them for the board.

## Files Changed

| Repository | File | Planned change |
|---|---|---|
| C:/projects/persephone-boards | boards/torrent-viewer/scripts/service.mjs | Add canonical magnet and normalized file descriptors to ready snapshot torrents through a pure metadata projection; preserve D1 controls and operations. |
| C:/projects/persephone-boards | boards/torrent-viewer/app.js | Reconcile rendered inventory from service snapshots/jobs; separate page-local selection/status/own-job state; handle foreign rows and lifecycle. |
| C:/projects/persephone | src/ipc/board-bridge-channels.ts | Add the read-only serviceStatus board RPC contract. |
| C:/projects/persephone | src/main/board-bridge.ts | Route serviceStatus to the existing non-starting supervisor query. |
| C:/projects/persephone | src/board-shim.ts | Expose persephone.service.status(). |
| C:/projects/persephone | src/renderer/editors/board/board-api.d.ts | Document the no-start status method and result shape. |
| C:/projects/persephone | doc/active-work.md | No edit expected; confirm the existing unchecked US-1529 link remains under EPIC-114. |
