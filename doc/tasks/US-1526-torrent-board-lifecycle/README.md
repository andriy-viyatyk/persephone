# US-1526: Torrent board lifecycle

## Status

Status: Planned  
Priority: High  
Epic: [EPIC-114: The torrent board — a module contributes below the UI](../../epics/EPIC-114.md)

This document is an investigation and implementation plan only. It contains no implementation,
test harness, or commit.

## Goal

Define and implement the torrent service's lifecycle around the four remaining EPIC-114 acceptance
items: cold-start restoration without a board page, an explicit state-based service stop, bounded
metadata resolution with a recoverable transient failure, and clean board removal/untrust behavior.
Measure the D6 memory risk while streaming at least 200 MB before deciding whether the pilot's
in-memory store needs a follow-up eviction design.

The service must outlive a board page. A paused or seeking torrent:// page may have no active
reader and the board page may be closed, so page ownership and a time-only idle timer are not valid
lifecycle signals. The planned stop signal is explicit user removal of the last torrent, followed
by a stop request after the service reports no torrents and no active resolution jobs.

Acceptance item 5 is already verified by US-1525 and is not replanned: closing a playing video
page returned transfer to zero bytes over 15 seconds with 19 peers still connected and
activeReaders: 0 ([EPIC-114:349-368](../../epics/EPIC-114.md:349)).

## Background

### Binding decisions and shipped seams

EPIC-114 decisions D1–D11 are binding. D1 still forbids payload movement without a reader; D5
requires the persisted link to carry its magnet; D6 accepts memory-chunk-store for the pilot but
requires a measured RSS result; D8 bounds metadata control work but deliberately does not put a
deadline on content reads; and D11 has already accepted two Persephone platform changes for the
board route and source handoff ([EPIC-114.md:118-263](../../epics/EPIC-114.md:118)). The stable
persisted provider type remains torrent/viewer; it must not be renamed.

US-1524 shipped the torrent/viewer provider in
[service.mjs](../../../persephone-boards/boards/torrent-viewer/scripts/service.mjs), with
stat, readRange, readBinary, deselect: true, a 30-second metadata bound, an in-memory chunk
store, and remove/shutdown destruction paths ([US-1524:1-60](../US-1524-torrent-content-provider/README.md:1)).
US-1525 shipped the two-pane board page and the self-contained torrent:// links; its service
dispatcher currently accepts resolve, status, snapshot, cancel, and remove, but not stop
([service.mjs:779-799](../../../persephone-boards/boards/torrent-viewer/scripts/service.mjs:779)).

The board frame API currently exposes only persephone.service.request(message) for service
traffic ([board-api.d.ts:267-278](../../src/renderer/editors/board/board-api.d.ts:267)). The
renderer-side app API and IPC already have an explicit stop path:
app.boards.stopService() calls stopModuleService, whose handler calls the existing
moduleServiceSupervisor.stop(boardRoot, "explicit")
([boards.ts:412-428](../../src/renderer/api/boards.ts:412),
[board-handlers.ts:102-113](../../src/ipc/main/board-handlers.ts:102)). That API is not exposed
to a board iframe. The board bridge routes service.request to the supervisor's ordinary request
method with the fixed service-request deadline
([board-bridge.ts:261-266](../../src/main/board-bridge.ts:261)); it has no board-facing stop RPC.

The supervisor already stops a service on untrust, app quit, and a removed service declaration.
The "explicit" reason is currently used internally when a board stops declaring a service and
its record is dropped ([module-service-supervisor.ts:240-260](../../src/main/module-service-supervisor.ts:240)).
There is no board-facing caller for the existing explicit stop operation.

### Cold-start restore: verified path and ordering

The persisted media page is a no-host video-view editor. PagesPersistenceModel.restorePage
normalizes the descriptor, creates the editor, copies the persisted state, calls applyRestoreData,
then awaits editor.restore(); any exception is currently logged with console.warn and that
editor is dropped ([PagesPersistenceModel.ts:182-320](../../src/renderer/api/pages/PagesPersistenceModel.ts:182)).
The page restore is not a persisted live HostDescriptor.pipe reattachment for this case. The
video editor persists sourceLink, resets transient playback state, and reconstructs its pipe from
sourceLink.href in ensurePipeForSource
([VideoEditor.ts:136-142](../../src/renderer/editors/video/VideoEditor.ts:136),
[VideoEditor.ts:226-246](../../src/renderer/editors/video/VideoEditor.ts:226)).

The startup order is explicit: renderer.ts imports the editor registry, awaits
customEditorRegistry.ensureInitialized(), and only then calls app.initPages()
([renderer.ts:7-17](../../src/renderer.ts:7)). The torrent scheme's source-path resolver creates
the descriptor with provider type torrent/viewer and the full link in config.url
([custom-editor-registry.ts:192-210](../../src/renderer/editors/board/custom-editor-registry.ts:192),
[scheme-registry.ts:227-255](../../src/renderer/content/scheme-registry.ts:227)). Therefore the
board page does not need to be open for a restored media page to rebuild its pipe.

The first media request is also ordered correctly. The video page creates a pipe video session;
the local stream server's first HTTP request calls boardPipeService.read, which resolves the
pipe's total size through pipe.stat() before requesting the first range
([video-stream-server.ts:671-736](../../src/main/video-stream-server.ts:671)). The board pipe
handler deliberately rechecks provider capabilities after stat; that second check is after the
provider round trip because the capability announcement is the cold-start synchronization point
([board-pipe-handler.ts:71-103](../../src/renderer/editors/board/board-pipe-handler.ts:71)).

For a registered ProxyProvider, the first provider request calls moduleService.acquire; the
supervisor starts the utility process and transfers the renderer port. The module-service host
imports the board service entry before setting serviceEntryLoaded and announcing provider
capabilities ([module-service.ts:272-379](../../src/renderer/api/module-service.ts:272),
[module-service-host.mjs:104-168](../../assets/module-service-host.mjs:104),
[module-service-host.mjs:508-515](../../assets/module-service-host.mjs:508)). The torrent service
registers torrent/viewer during that import before the host announces it
([service.mjs:557-567](../../../persephone-boards/boards/torrent-viewer/scripts/service.mjs:557)).
The source does not show a registration-before-request race on this path.

Metadata is still a user-visible wait. statTorrentFile() calls torrentFileForLink, which may
wait for the service's waitForMetadata() 30-second timer before returning the file size
([service.mjs:445-511](../../../persephone-boards/boards/torrent-viewer/scripts/service.mjs:445)).
The video surface has no torrent-specific metadata progress UI: after the media element begins to
load it shows the ordinary loading state, and a failed HTTP stream changes the player to its
ordinary error state ([VideoView.ts:179-206](../../src/renderer/editors/video/VideoView.ts:179),
[VPlayer.ts:68-87](../../src/renderer/editors/video/VPlayer.ts:68)). The plan therefore keeps
the control bound but makes a failed resolution recoverable rather than leaving the user with only
an opaque failure.

### Resolution watchdog and the tab-switch defect

The resolver has two competing timers. D8's metadata bound is
METADATA_TIMEOUT_MS = 30,000 ms, while the service's abandoned-job watchdog is
NO_POLL_TIMEOUT_MS = 15,000 ms ([service.mjs:6-11](../../../persephone-boards/boards/torrent-viewer/scripts/service.mjs:6)).
touchJob() rearms that watchdog whenever status is polled, but cancels a still-resolving job after
15 seconds without a poll with the internal reason torrent-resolution-no-status-poll
([service.mjs:601-608](../../../persephone-boards/boards/torrent-viewer/scripts/service.mjs:601)).
The board polls status every 750 ms while its frame is alive
([app.js:305-325](../../../persephone-boards/boards/torrent-viewer/app.js:305)).

This means a board-frame teardown or inactive-page failure can cancel a real resolution before D8's
own bound. Switching tabs during resolution can therefore look like a random torrent failure, and
the board may expose the internal watchdog token as the status text. The watchdog is useful for
reaping abandoned jobs, so the plan changes it to a 45-second grace period, derived as
METADATA_TIMEOUT_MS + 15,000 ms. A continuously polled job still ends at D8's 30 seconds; a job
whose board disappeared gets one extra grace period and cannot pre-empt metadata resolution.

The board must translate every known resolution failure reason into a sentence before displaying it:
the watchdog case should say that the resolution was abandoned because the torrent page stopped
polling and offer retry; metadata timeout should say that metadata was not found within 30 seconds;
cancelled and service failures should use similarly actionable text. Internal reason tokens may
remain in service diagnostics, but they must not be the user-facing message.

### Current service lifetime and the state signal

The service remembers every resolved torrent in torrentsByInfoHash; getServiceSnapshot() returns
both client.torrentCount and the torrents array, including activeReaders
([service.mjs:680-723](../../../persephone-boards/boards/torrent-viewer/scripts/service.mjs:680)).
That makes zero torrents observable. A resolving job is separately visible in
activeResolutionJobs, so the stop decision must require both torrents.length === 0 and no active
resolution jobs.

removeTorrent() destroys the selected torrent and removes it from the service maps, but the
request dispatcher does not stop the client or utility process when the last torrent disappears
([service.mjs:726-777](../../../persephone-boards/boards/torrent-viewer/scripts/service.mjs:726)).
The board page's removeTorrent() currently sends only the remove request, and its page teardown
only cancels jobs and timers; it intentionally does not stop the service
([app.js:435-455](../../../persephone-boards/boards/torrent-viewer/app.js:435),
[app.js:509-536](../../../persephone-boards/boards/torrent-viewer/app.js:509)). Consequently
the current service can outlive the board page, which is required for D5 cold restore, but it
also keeps the in-memory chunks until untrust, service declaration removal, quit, or an explicit
remove that is not followed by a process stop.

The design decision is to accept the stated leaning: do not add a time-only idle timer. Add the
smallest honest board-facing seam, persephone.service.stop(), routed directly to the already
existing main supervisor stop operation. The board will call it only after an explicit user remove
has succeeded and a fresh snapshot confirms zero torrents and zero active resolution jobs. This is
a third platform seam after D11's two accepted changes; it is justified because the required owner
of the state decision is the board, while the process-kill authority already belongs to main. It is
smaller and more truthful than disguising a supervisor stop as a service operation or tying process
lifetime to a page teardown.

The service remains alive after a board page closes whenever a torrent remains. A paused or
between-seeks page therefore retains its provider and metadata state. D1 remains intact because
only provider reads create active readers; neither the snapshot check nor the stop RPC moves
payload bytes. An explicit remove remains user-directed, but removal must be refused while
activeReaders > 0. The service returns a distinct refusal result, and the board shows
“This torrent is being read by an open page. Close that page before removing it.” The user can
retry after closing the content page; the service must not destroy a torrent under a playing page.

### D8: metadata measurement and decision

The current resolver fails an attempt after exactly 30,000 ms, destroys the failed torrent, and
rejects the job ([service.mjs:445-500](../../../persephone-boards/boards/torrent-viewer/scripts/service.mjs:445)).
The epic's 2026-09-26 note records a real transient swarm/tracker outage in which every resolution
failed for roughly half an hour, followed by successful Sintel resolutions of approximately
1,351 ms with one tracker and 2,182 ms with two trackers after recovery
([EPIC-114.md:405-436](../../epics/EPIC-114.md:405)). A first eight-trial fresh-client Sintel
sample resolved 8/8, with p50 4,750 ms, minimum 2,683 ms, maximum 5,200 ms, and zero trials that
would have failed at 30 seconds. The sample has roughly six times of headroom on a healthy swarm,
but it is not yet a distribution.

Keep the acceptance measurement at at least 20 fresh resolution trials, recording each attempt's
elapsed time, tracker count, peer count at completion, and whether it reached metadata. Destroy or
remove the resulting torrent between trials so the result measures metadata acquisition, not a warm
existing torrent. Report p50, p95, maximum, and failures.

Decision: retain the 30-second per-attempt bound and add an explicit user retry after a failed
metadata job; do not lengthen the bound and do not retry automatically. The live measurements
already show normal success far below 30 seconds, while the recorded half-hour outage shows that
waiting longer in one attempt is not a reliable recovery strategy: an absent swarm makes 30 seconds
and 120 seconds fail identically. A manual retry gives a transient outage a recovery path without
making a dead magnet consume 60 seconds or more and preserves D8's control-operation bound.
The dead-magnet trial must poll status continuously and assert both the elapsed bound and the
failure reason: it must reach torrent-metadata-timeout, not torrent-resolution-no-status-poll.
readRange and readBinary remain deadline-free content operations, as settled by D8 and US-1518;
no read deadline is proposed.

### Uninstall, untrust, and an absent provider

For the board page itself, BoardEditorView selects a not-found branch when there is no selected
board and an untrusted branch when the root is no longer permitted
([BoardEditorView.ts:189-252](../../src/renderer/editors/board/BoardEditorView.ts:189)). Those
branches render the existing “Board not found” and “This board is not trusted” placeholders
([BoardNotFoundView.ts:13-47](../../src/renderer/editors/board/BoardNotFoundView.ts:13),
[UntrustedBoardView.ts:15-59](../../src/renderer/editors/board/UntrustedBoardView.ts:15)). The
custom registry simultaneously unregisters providers and schemes for boards that disappear from
the trusted set ([custom-editor-registry.ts:414-423](../../src/renderer/editors/board/custom-editor-registry.ts:414)).

There are two current uninstall behaviors. Explicit app.boards.unregisterBoard() only untrusts
and unpins, so an open board page can transition to its untrusted placeholder. Catalog uninstall
first asks for consent, and its dialog explicitly says the open page(s) “stay open and go empty”
before detaching and disposing them ([board-updates.ts:118-138](../../src/renderer/api/board-updates.ts:118)).
The two paths therefore differ by design: untrust renders the existing placeholder, while catalog
uninstall empties pages after the user consents. EPIC-114 acceptance item 9's uninstall-placeholder
wording is being amended against the untrust path; this task does not change generic catalog
uninstall behavior.

An open torrent:// video page keeps its link and pipe object, but a subsequent provider read fails
after the board is untrusted/unregistered and the video player enters its ordinary error state. A
restored video page is less legible today: because the torrent scheme is gone, pipeFromLink()
rejects with “The link cannot be resolved to content”; PagesPersistenceModel catches that exception,
logs a warning, and drops the editor. This is not an uncaught stack trace, but it is not a useful
user-facing degradation. A missing-provider descriptor would otherwise have a legible
MissingProviderError message, but the no-host video restore never reaches that class:
createProviderFromDescriptor is only called after a registered scheme has produced a descriptor
([rebuild-pipe.ts:25-36](../../src/renderer/content/rebuild-pipe.ts:25),
[registry.ts:555-560](../../src/renderer/content/registry.ts:555)).

The plan is to keep the restored video page when its persisted torrent:// source cannot be rebuilt
because its scheme is no longer registered. The restore path must ask the scheme registry's
isSchemeRegistered() predicate, using the persisted link's scheme, rather than matching the generic
pipeFromLink() error text ([scheme-registry.ts:191-198](../../src/renderer/content/scheme-registry.ts:191)).
That is the structural condition that the board owning the link is gone. It should retain the page,
put it in the existing error player state, and notify that the Torrent Viewer board is missing or
untrusted and must be reinstalled/trusted. If the scheme is still registered but pipe reconstruction
fails for another reason, restore must rethrow and preserve today's generic drop-the-editor behavior.
The same rule avoids changing restore behavior for unrelated schemes. Text-host descriptors are a separate path:
TextHostEditorModel.restore() already catches host restore failures, notifies the user, and adopts
an empty host ([TextHostEditorModel.ts:207-228](../../src/renderer/editors/base/TextHostEditorModel.ts:207));
the acceptance verification should cover the media page specifically and confirm this existing
text-host behavior is not regressed.

### D6 RSS measurement

The acceptance measurement is the peak RSS of the torrent utility process while a real file is
streamed for at least 200 MB. The process is the Electron child whose command line contains
--utility-sub-type=node.mojom.NodeService; enumerate it with:

    Get-CimInstance Win32_Process -Filter "Name='electron.exe'" |
        Where-Object CommandLine -like '*--utility-sub-type=node.mojom.NodeService*'

Record the selected PID, command line, and baseline RSS before adding the torrent. Stream at least
200 MB through the existing video/content path while sampling WorkingSetSize and PrivatePageCount
at one-second intervals. Record the peak, the baseline delta, downloaded bytes, active readers,
peer count, and RSS five minutes after the reader closes. Do not count Persephone's renderer RSS
as service RSS.

Pre-commit the follow-up threshold before measuring: if peak service RSS exceeds 512 MiB during
the 200 MB stream, or remains above 512 MiB after the reader drains, open the D6 follow-up for a
small bounded in-memory eviction store. Below that threshold, record the measured number and keep
memory-chunk-store for the pilot. The follow-up remains memory-only; no disk store, dependency,
second WebTorrent client, or unbounded read deadline is introduced here.

## Implementation Plan

### 1. Make cold restore and missing-board content failure explicit

1. Preserve the current startup ordering and D5 link format. Do not move provider registration into
   the board page or make the provider depend on a board-frame registry. Verify with a cold-start
   run that the restored video descriptor reaches pipeFromLink, the first stat starts the service,
   provider capabilities arrive, metadata resolves, and the first readRange occurs only after a
   reader exists.
2. In src/renderer/editors/video/VideoEditor.ts, catch the specific persisted torrent-source
   rebuild failure during restore only when the persisted link's scheme is unregistered according
   to isSchemeRegistered(). Retain the page, set its existing error state, and issue a concise user
   notification. If the scheme remains registered, rethrow and keep unrelated restore behavior
   unchanged.

Before:

    // PagesPersistenceModel.restorePage
    } catch (err) {
        console.warn("[restore] editor in page:", err);
        return null;
    }

After:

    // VideoEditor.restore handles a persisted torrent source before this generic fallback.
    // The page remains attached with playerState === "error" and a user-facing recovery notice.

### 2. Add state-based board service stop

1. Add stop(): Promise<void> to the board frame's PersephoneServiceApi.
2. Add one serviceStop board RPC method across src/ipc/board-bridge-channels.ts,
   src/board-shim.ts, and src/main/board-bridge.ts. Its main handler must call the existing
   moduleServiceSupervisor.stop(entry.root, "explicit"); it must not be implemented as a new
   torrent-service op and must not start a service merely to stop it.
3. In persephone-boards/boards/torrent-viewer/app.js, after a successful explicit remove, make
   one snapshot request and stop only when torrents is empty and activeResolutionJobs is empty.
   Keep the service alive on pagehide/beforeunload; page close is not a stop signal.
4. In service.mjs, move the no-poll watchdog beyond the metadata bound:
   NO_POLL_TIMEOUT_MS = METADATA_TIMEOUT_MS + 15,000 ms. Keep status polling as the normal
   completion path, but never allow the watchdog to pre-empt D8's 30-second metadata timeout.
5. Keep the service snapshot as the observable source of truth. If implementation adds a compact
   remainingTorrentCount field to the remove reply, it must still guard against an active
   resolution job with the snapshot before stopping.
6. Refuse remove when activeReaderCounts for the selected torrent is greater than zero; return a
   stable refusal reason and render the user-facing close-the-page sentence in the board.
7. Add a user retry action for a failed metadata job. It must start a new bounded resolution attempt
   only after the first job has failed; it must not automatically retry a dead magnet. Map
   torrent-metadata-timeout, torrent-resolution-no-status-poll, cancellation, and service errors
   to actionable sentences before calling setStatus().

Before:

    interface PersephoneServiceApi {
        request(message: unknown): Promise<unknown>;
    }

After:

    interface PersephoneServiceApi {
        request(message: unknown): Promise<unknown>;
        stop(): Promise<void>; // main-owned explicit stop; never tied to board-page teardown
    }

### 3. Measure and settle D8

1. Use the live Sintel magnet as the reference source and run the 20-trial distribution described
   above, with a fresh resolver job and removal between successful trials.
2. Record p50/p95/max and outage failures in the EPIC-114 acceptance notes.
3. Keep the 30-second service timeout, add manual retry, and verify a continuously polled dead
   magnet fails at the metadata timeout with the torrent-metadata-timeout reason, not the
   no-poll watchdog reason. Verify a slow live read can remain pending beyond that bound and is
   cancelled only by reader/page teardown, not by a metadata timer.

### 4. Measure D6 RSS and verify lifecycle

1. Run the 200 MB streaming scenario with the utility-process PID sampling procedure above and
   record the precommitted 512 MiB decision.
2. Verify a torrent remains in the service after its board page closes and can serve a cold-restored
   page with no board page open.
3. Verify explicit removal of the last torrent stops the utility process, while removing one of
   several torrents leaves it alive.
4. Verify a paused/restored page with a retained torrent is not killed merely because activeReaders
   is zero.
5. Verify activeReaders: 0, downloaded unchanged, and no payload transfer during metadata-only
   restore/listing; this preserves D1.

## Concerns / Open Questions

- The requested live-magnet distribution and the 200 MB RSS number cannot be determined from
  source inspection. They require runtime measurements against the live Sintel swarm and the
  running Electron utility process. The plan deliberately records the method and the 512 MiB
  follow-up threshold before measurement.
- Catalog uninstall and explicit untrust intentionally differ: uninstall asks for consent and leaves
  open pages empty, while untrust renders the board placeholder. EPIC-114 acceptance item 9 is
  being amended to describe the untrust path; this task must not change generic uninstall behavior.
- removeTorrent() currently destroys a torrent without checking activeReaders. This task decides to
  refuse removal while activeReaders > 0, return a stable refusal reason, and show the board user
  that an open page is reading the torrent. Removal is retried after that page closes, preserving
  D1's viewer rule.
- The first Sintel sample is 8/8 successful resolutions, p50 4,750 ms, min/max 2,683/5,200 ms,
  and zero 30-second failures. Acceptance still needs at least 20 trials.
- The no-poll watchdog currently pre-empts D8 at 15 seconds when a board frame stops polling, such
  as after tab switching or frame teardown. This task moves it to 45 seconds and translates its
  internal reason into a user-facing sentence.
- The explicit stop seam is a third Persephone platform change after D11's two accepted changes.
  It is required because only main owns process teardown and only the board observes its own
  user-directed zero-torrent state. No additional provider protocol, renderer lease, dependency,
  WebTorrent client, or disk store is justified.
- No timer based solely on elapsed idle time is in scope. The stop condition is an explicit remove,
  authoritative zero-torrent snapshot, and no active resolution job.

## Acceptance Criteria

1. A restored torrent:// video page starts its service/provider path with no torrent board page open;
   the provider is registered before the first stat/readRange, metadata-only restore moves zero
   payload bytes, and the first content bytes occur only after a media reader exists.
2. The service outlives board-page close whenever it still owns a torrent; a paused or between-seek
   page is not broken by a time-only timer.
3. The board can explicitly stop its own service through the new main-owned stop seam, and removal
   of the last torrent stops the utility process only after snapshot confirms zero torrents and no
   active resolution jobs. Removing a non-last torrent does not stop it.
4. The previously verified page-close behavior remains unchanged and is cited as US-1525 evidence;
   no new page-close stop mechanism is added.
5. A live Sintel distribution is recorded with p50/p95/max and failures; a continuously polled dead
   magnet fails at approximately 30 seconds with torrent-metadata-timeout rather than
   torrent-resolution-no-status-poll; a failed live attempt has an explicit retry; all displayed
   resolution failures are sentences; no automatic retry or longer per-attempt bound is added;
   content reads have no deadline.
6. The service utility process's peak RSS is recorded while streaming at least 200 MB. The result
   is compared with the precommitted 512 MiB threshold and the D6 follow-up decision is recorded.
7. When the board is explicitly untrusted, the board page shows the existing untrusted placeholder;
   when its folder is absent, the board page shows the existing not-found placeholder. Catalog
   uninstall retains its consented empty-page behavior.
8. An open or restored torrent:// content page whose board is untrusted, uninstalled, or absent
   remains a page with a legible unavailable/error state and recovery notice when its scheme is
   unregistered; if its scheme remains registered but another rebuild error occurs, today's
   drop-the-editor behavior remains unchanged.
9. The provider type remains exactly torrent/viewer; no dependency, second WebTorrent client,
   disk store, unit test, or test harness is added.

## Files that should not change

- doc/epics/EPIC-114.md — D1–D11 and the acceptance wording are already binding.
- src/main/module-service-supervisor.ts — its public stop(boardRoot, reason) operation already
  exists; this task should route the new board RPC to it rather than alter supervisor policy.
- src/renderer/content/rebuild-pipe.ts, src/renderer/content/scheme-registry.ts, and
  src/renderer/editors/board/custom-editor-registry.ts — the cold-start scheme and provider
  registration ordering is already correct; do not weaken D5 or rename the persisted type.
- src/main/video-stream-server.ts and src/renderer/editors/board/board-pipe-handler.ts — the
  existing stat-before-range and capability synchronization path is the required D1/D8 seam.
- src/renderer/api/board-install.ts and src/renderer/api/board-updates.ts — catalog uninstall's
  consented empty-page behavior is generic and intentionally out of scope.
- C:/projects/persephone-boards/boards/torrent-viewer/board-manifest.json — its torrent/viewer
  provider type and service declaration remain stable.

## Files Changed

| Repository | File | Planned change |
|---|---|---|
| Persephone | src/renderer/editors/video/VideoEditor.ts | Preserve a restored torrent media page and show a legible unavailable/error state when its board provider is absent or untrusted. |
| Persephone | src/ipc/board-bridge-channels.ts | Add the board-facing serviceStop RPC method. |
| Persephone | src/board-shim.ts | Expose persephone.service.stop(). |
| Persephone | src/main/board-bridge.ts | Route serviceStop to the existing supervisor stop operation without starting a service. |
| Torrent boards | boards/torrent-viewer/app.js | Stop only after explicit last-torrent removal is confirmed empty; add explicit metadata retry; retain service across page teardown. |
| Torrent boards | boards/torrent-viewer/scripts/service.mjs | Move the no-poll watchdog beyond the 30-second metadata bound; refuse removal while active readers exist; retain the existing provider type. |
| Documentation | doc/active-work.md | Link US-1526 under EPIC-114. |
