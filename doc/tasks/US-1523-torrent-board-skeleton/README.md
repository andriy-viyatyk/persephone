# US-1523: The torrent board skeleton

## Status

Status: Planned
Priority: High
Epic: [EPIC-114: The torrent board — a module contributes below the UI](../../epics/EPIC-114.md)
Started: 2026-09-26

## Goal

Create the installable torrent-viewer board in
C:/projects/persephone-boards/boards/torrent-viewer/. This task supplies the board manifest, a
reproducible vendored WebTorrent 3.0.21 bundle, and a module service that resolves a magnet or
torrent identifier to metadata only. It also supplies a small proof page; the torrent content
provider and the production torrent page remain US-1524 and US-1525.

This document is an investigation and implementation plan only. No board files have been changed
and no commit is requested.

## Background

### Binding epic decisions

EPIC-114 D1–D10 are binding. In particular, metadata resolution must deselect every file; bytes
must not be downloaded by this task; WebTorrent must be pinned to 3.0.21 with memory-chunk-store;
the store must be passed as a class; the esbuild createRequire banner and four native-module
externals are required; the pilot uses TCP only; and the board must preserve the self-contained
magnet-link direction described by D5.

The feasibility spike in [EPIC-114](../../epics/EPIC-114.md) already verified the Sintel magnet
end to end, including metadata-only resolution and a bundled 1.74 MB build. This plan does not
re-litigate those decisions. The only implementation adjustment below is the transport needed to
fit D8's 30-second metadata operation through Persephone's 10-second service control RPC.

### Board-repository conventions verified

- persephone-boards/CLAUDE.md:41-67 makes board-manifest.json the release source of truth and says
  publishing zips board contents while excluding ui.log, versions-manifest.json, .git, and
  node_modules.
- persephone-boards/.gitignore:1-8,15-19 ignores node_modules/ and runtime logs but does not
  ignore lib/; the generated bundle must therefore be committed. The _test exception confirms
  fixture boards are source, while the catalog publisher scans only boards/.
- persephone-boards/scripts/publish-board.mjs:33-40,63-79 stages every non-excluded board file,
  and :197-210 records only the resulting ZIP size and sha256 in the machine-written catalog.
  There is no file-count or archive-size rejection in the publisher. The current pdf-viewer
  directory measures 10,019,600 bytes locally, so the spike's 1.74 MB bundle is not a
  catalog-size concern.
- A board-local build script is compatible with publishing: the repository layout explicitly
  includes board files and scripts/ (persephone-boards/CLAUDE.md:19-36), while the publisher
  recursively copies every non-excluded file (scripts/publish-board.mjs:63-79). The build must
  run before release; publishing does not execute it.
- Existing published manifests use editorPriority 100 for simple viewers:
  boards/sqlite-viewer/board-manifest.json:11-15 and boards/pe-viewer/board-manifest.json:10-13.
  Todo uses content-host and priority 200 (boards/todo/board-manifest.json:9-17), which is not a
  model for this board.
- Published boards with documentation declare guides: "guides"; the Todo guide index and agent
  guide use front matter and the index.md entry convention
  (boards/todo/board-manifest.json:9-10, boards/todo/guides/index.md:1-5,
  boards/todo/guides/agent.md:1-5). New-board repository rules also require WHATS-NEW.md and a
  catalog screenshot.png (persephone-boards/CLAUDE.md:90-112).

- The boards dashboard is repo-local: doc/active-work.md currently has no active entry and uses
  BT-XXX links (doc/active-work.md:19-38); doc/tasks/completed.md ends at BT-024 and requires
  newest-first entries (doc/tasks/completed.md:1-8). This board work therefore reserves BT-025
  for its board-repository task entry.

The closest service fixture is deliberately not copied as an editor design:
_test/range-provider-test/board-manifest.json:8-17 declares a service, providers, and a
stream-host editor because it owns a ranged pipe. Its service implements the exact parent-port
handshake at _test/range-provider-test/scripts/service.mjs:184-237: it checks process.parentPort,
answers init with ready, answers probe with probe-ack, handles request/response, and exits on
shutdown. Provider implementations are registered from the service with
globalThis.persephone.providers.register at :181-182.

### Manifest and editor decision

The board will declare:

    "permissions": ["service", "contentProviders"],
    "service": "scripts/service.mjs",
    "contentProviders": [{ "type": "torrent/viewer", "schemes": ["torrent"] }],
    "fileMasks": ["*.torrent"],
    "editorName": "Torrent Viewer",
    "editorKind": "simple",
    "editorPriority": 100

The provider type is namespaced and stable because assets/guides/boards.md:156-162 requires a
slash and says the type is persisted in page pipe state. The declaration is present now for the
US-1524 provider; US-1523 does not implement readBinary, readRange, or stat yet.

The board deliberately does not claim the `magnet` scheme in this task. The board scheme resolve
hook always builds a content pipe and chooses a target using `resolveEditorIdForFile` with
`schemeEffectivePath` (src/renderer/editors/board/custom-editor-registry.ts:207-209), while
`schemeEffectivePath` extracts the last slash-separated pathname segment
(src/renderer/editors/board/custom-editor-registry.ts:179-185). A magnet URI is opaque, so its
pathname is empty; claiming `magnet` now would route it to Monaco on a torrent pipe. Keep
`schemes: ["torrent"]` for the future provider contract, but leave magnet opening to the later
platform change described under Concerns.

editorKind simple is intentional. assets/guides/boards.md:887-888,956-968 defines simple boards
as path-oriented local-file editors; content-host is for text content and stream-host is for a
board consuming a pipe URL. This skeleton needs neither host contract: it asks its service to
parse a local .torrent path or a magnet and renders metadata. The fixture's stream-host choice
would be wrong because D4 explicitly removes the streaming server and protocol.handle path from
this task. Priority 100 follows the existing simple viewers and makes the declared .torrent
association the default editor rather than merely a switch option; the file association is
retained now because D10 makes .torrent the second entry point even though the finished list UI
arrives in US-1525.

The manifest should use schemaVersion 1, author "Persephone", the repository URL, version 1.0.0,
minAppVersion "5.0.4" (the current Persephone package version), and minBridgeVersion "1.8.0".
It must not point at `guides` or `screenshot` in US-1523 because those release artifacts are
deferred with the real UI and documentation. The implementation session must still read the live
app version through the board authoring MCP before scaffolding, as required by
persephone-boards/CLAUDE.md:159-178; the MCP was not exposed to this investigation session, but
Persephone is running and this is not a standing implementation blocker.

Before → after for the editor declaration:

    // fixture: stream-host because it owns a ranged provider page
    "fileMasks": ["*.rangefix"], "editorKind": "stream-host", "editorPriority": 100

    // torrent-viewer: local .torrent path plus a standalone magnet proof UI
    "fileMasks": ["*.torrent"], "editorKind": "simple", "editorPriority": 100

### Service lifecycle, startup, and protocol

The board guide says services start lazily, run with the board root as cwd, have standard Node
networking, and receive only the supervisor allowlist plus PERSEPHONE_SERVICE=1 and
PERSEPHONE_BOARD_ROOT (assets/guides/boards.md:553-558). The source confirms process
construction: utilityProcess.fork receives the host and service entry, uses cwd: record.boardRoot,
and calls buildServiceEnvironment (src/main/module-service-supervisor.ts:565-583). The allowlist
is explicit at :733-748; it does not carry WS_NO_BUFFER_UTIL or WS_NO_UTF_8_VALIDATE, so
scripts/service.mjs must set both variables before dynamically importing the bundle.

The service really can start without the board page open. A board-frame service request is routed
through the main supervisor (src/main/board-bridge.ts:261-266), and the supervisor request()
checks the cap, then calls start(boardRoot, "request") before posting the request
(src/main/module-service-supervisor.ts:321-350). Provider traffic uses the same lazy start
through transferRendererPort() (src/main/module-service-supervisor.ts:358-362), while the
renderer provider client acquires that port on its first provider request
(src/renderer/api/module-service.ts:272-296,305-379). This satisfies EPIC-114 D5's no-board-page
startup shape; the restored content page's provider request is sufficient.

The permissions field has two different effects. The service permission is a lifecycle/startup
gate: canStartBoardService requires the board to be trusted and the manifest permissions to
include service (src/renderer/editors/board/board-service-permission.ts:8-14), and the supervisor
enforces the resulting canStartService predicate
(src/main/module-service-supervisor.ts:471-484). The contentProviders permission is disclosure
only; the declaration itself drives registration (assets/guides/boards.md:156-162). Neither
permission is a network grant or a frame CSP exception; trust already permits arbitrary trusted
board renderer/Node code (assets/guides/boards.md:141-144,569-574).

The host's D8 split is real and must not be confused with the control RPC deadline:

- assets/module-service-host.mjs:225-237 defines CONTENT_READ_OPERATIONS as readBinary and
  readRange, and UNBOUNDED_OPERATIONS as those two plus stat.
- assets/module-service-host.mjs:380-428 exempts content reads from the control cap, gives
  unbounded operations an AbortController and no timer, and applies the deadline timer to other
  operations; :465-473 aborts an outstanding operation on cancellation.
- The cap is 32 (src/ipc/module-service-channels.ts:9-16), and supervisor requests reject when
  the service has reached it (src/main/module-service-supervisor.ts:321-345).
- The ordinary board service.request path passes the 10,000 ms SERVICE_REQUEST_DEADLINE_MS
  (src/main/board-bridge.ts:49,261-266; constant at
  src/ipc/module-service-channels.ts:12-13). Therefore a single board RPC cannot wait 30
  seconds for a magnet.

To preserve D8 without changing Persephone in US-1523, the service protocol will be asynchronous:
resolve validates the magnet/path, starts resolveTorrent(magnetOrTorrentId), and returns a short
{ state: "resolving", requestId, infoHash } acknowledgement; the page polls status, which
returns { state, error?, torrent? } and the metadata once complete. The service function itself
has the required 30-second timer and returns
{ infoHash, name, files: [{ path, length, index }] }; the UI does not lose that result to the
10-second outer RPC. This is the resolved design for the deadline mismatch.

Resolution jobs have an explicit lifetime and bound. The service admits at most four in-flight
resolution jobs; a fifth receives a bounded busy error instead of adding another torrent. Each
job owns its metadata timer and optional torrent, supports an explicit cancel request, and is
auto-cancelled if no status poll observes it for 15 seconds. A completed or failed result is
returned once and then deleted, with a 60-second expiry timer as a fallback for an abandoned
result. Cancellation, timeout, torrent error, and shutdown all clear the job timer and destroy
any torrent whose resolution has not completed. Shutdown also rejects every pending resolver and
clears every job timer before destroying the client, so a closed page cannot leave work running
indefinitely.

### Network and sandbox evidence

The board frame is deliberately offline: src/main/board-protocol-service.ts:73-94 sets
connect-src 'self', and :453-465 applies that CSP to HTML. The board template describes this as
blocking remote CDN/fetch network (assets/board-template/CLAUDE.md:1092-1112). That restriction
does not apply to the module service process. The board guide explicitly lists networking among
the available standard Node built-ins (assets/guides/boards.md:553-556), and the service source
contains no network-deny or OS sandbox option: it forks the utility process with only cwd/env/stdio
(src/main/module-service-supervisor.ts:574-583). src/main/main-setup.ts:62-70 likewise says the
board scheme is not CSP-bypassed; it governs the frame, not the service.

Conclusion: no source-level CSP, service sandbox, or allowlisted-environment rule blocks outbound
TCP/UDP from WebTorrent. UDP availability is still subject to the Windows/network environment,
and D7 intentionally leaves uTP/WebRTC native modules absent; the spike verified TCP fallback.
The implementation session must confirm the live utility-process case with the Sintel magnet.

### Reference code to port and code not to port

C:/projects/av-player/src/main/torrent-proxy.ts:23-65 shows lazy client construction and info-hash
lookup. Its metadata resolver at :68-147 validates a magnet, adds it, deselects every file,
destroys the torrent on errors/30-second timeout, and returns mapped metadata. Its removeTorrent
is at :150-182. The port must correct the two spike findings: set the WebTorrent 3 environment
before import and pass store: MemoryChunkStore as a class, not the factory at :96-105.
C:/projects/av-player/src/common/torrent-utils.ts:3-33,46-49 supplies the file mapping and
info-hash extraction shape.

Do not port handleVideoRequest or registerTorrentProtocol (torrent-proxy.ts:184-290) and do not
port streaming-server.ts; D4 says Persephone's provider owns bounded reads. US-1524 will implement
the provider separately. Do not add streaming selection, downloading, seeding, disk storage, or
the final two-pane UI in this task.

## Implementation Plan

All implementation paths below are relative to C:/projects/persephone-boards; the implementation
session will use that repository as its root.

### 1. Scaffold and manifest

- Use the board-repository workflow with the running app's boards.createBoard and MCP, then keep
  only the generated board folder under boards/torrent-viewer/. The scaffold must be trusted and
  provide the standard board-base.css / bridge wiring; do not hand-create the initial board folder
  (persephone-boards/CLAUDE.md:167-173).
- Create the board-repository task doc
  `doc/tasks/BT-025-torrent-viewer-skeleton/README.md`, link it to Persephone's
  `doc/epics/EPIC-114.md`, and add
  `- [ ] [BT-025: Torrent viewer board skeleton](tasks/BT-025-torrent-viewer-skeleton/README.md)`
  under a `## Planned` section in `doc/active-work.md` (preserving the existing Active section).
  BT-025 follows the completed BT-024 entry and the board dashboard's repo-local numbering rules.
- Edit boards/torrent-viewer/board-manifest.json to the manifest decided above. Keep the service
  and provider declarations stable; contentProviders is declaration-only in this task.
- Add fileMasks: ["*.torrent"], editorKind: "simple", editorPriority: 100, and editorName:
  "Torrent Viewer". The simple board reads persephone.getFilePath() when opened as a .torrent; a
  magnet is supplied through the proof-page input. Do not declare stream-host.
- Add the board version fields, but leave `guides` and `screenshot` out of the manifest. Keep
  README.md and the board-specific CLAUDE.md as developer documentation. Defer screenshot.png,
  WHATS-NEW.md, and the guides/ folder to US-1525 or US-1527 because this proof page is a
  throwaway skeleton; the board is not publishable until those later catalog-release artifacts
  exist.
  Do not capture a catalog screenshot in this task.
  Do not hand-edit the root boards-manifest.json; the publisher
  generates it from the board manifest (scripts/publish-board.mjs:119-137,203-210).

### 2. Pin and bundle WebTorrent

- Create boards/torrent-viewer/package.json with type module, private true, and exact build-time
  dependencies: webtorrent 3.0.21, memory-chunk-store 1.3.5, and the exact esbuild version
  selected for the successful build (pin 0.28.1, the installed Persephone toolchain version,
  unless the implementation-session spike records a different verified version).
- Run npm installation in the board folder to create and commit package-lock.json; do not ship
  node_modules/. The boards repository ignores it and the publisher excludes it
  (persephone-boards/.gitignore:1-2, scripts/publish-board.mjs:40,70-78).
- Add boards/torrent-viewer/scripts/webtorrent-entry.mjs that imports the pinned WebTorrent
  client and MemoryChunkStore and exports them for the service bundle.
- Add boards/torrent-viewer/scripts/build-webtorrent.mjs that invokes esbuild with the exact D3
  command semantics:

    esbuild scripts/webtorrent-entry.mjs --bundle --platform=node --format=esm --outfile=lib/webtorrent.bundle.mjs
      --external:bufferutil --external:utf-8-validate --external:node-datachannel --external:utp-native
      --banner:js='import{createRequire as __cr}from"node:module";const require=__cr(import.meta.url);'

  The script must create lib/ if needed, use the local pinned esbuild, and fail on a non-zero
  build. The banner is mandatory because without it parse-torrent reaches a dynamic require of fs
  and the bundle dies; the four externals are the optional native modules from D7.
- Commit lib/webtorrent.bundle.mjs and the required third-party license/version notices under
  lib/. Verify the output is reproducible from a clean install and remains around the spike's
  1.74 MB, with no node_modules in the board archive.

Before → after for the load-bearing store/import behavior:

    // av-player v2-era shape (C:/projects/av-player/src/main/torrent-proxy.ts:96-105)
    store: (chunkLength, storeOpts) => new MemoryChunkStore(chunkLength, storeOpts)

    // torrent-viewer / WebTorrent 3.0.21
    process.env.WS_NO_BUFFER_UTIL = "1";
    process.env.WS_NO_UTF_8_VALIDATE = "1";
    const { default: WebTorrent, MemoryChunkStore } =
        await import("../lib/webtorrent.bundle.mjs");
    client.add(magnetOrTorrentId, { store: MemoryChunkStore }, onMetadata);

### 3. Implement the service

Create boards/torrent-viewer/scripts/service.mjs using the fixture handshake, but with the
metadata service protocol:

1. Set WS_NO_BUFFER_UTIL and WS_NO_UTF_8_VALIDATE as the first executable statements. Dynamically
   import ../lib/webtorrent.bundle.mjs only afterwards; never statically import WebTorrent before
   those assignments.
2. Keep module state for one lazy WebTorrent client, active torrents, and resolution jobs. The
   client constructor must be WebTorrent 3.0.21 and use TCP-compatible defaults; client.add must
   receive { store: MemoryChunkStore } where MemoryChunkStore is the class.
3. Implement findTorrentByInfoHash(infoHash) case-insensitively. Implement
   resolveTorrent(magnetOrTorrentId) to accept a magnet or WebTorrent-supported torrent id/path,
   reuse an existing info-hash torrent, otherwise add one and await metadata. On metadata, call
   file.deselect() for every file before constructing exactly:

       { infoHash, name, files: torrent.files.map((file, index) =>
           ({ path: file.path.split("\\").join("/"), length: file.length, index })) }

   The raw WebTorrent path may contain Windows backslashes; the forward-slash value is the
   service-boundary canonical path and is the identifier US-1524 must URL-encode when building
   `torrent://<infohash>/<url-encoded path>` links. Preserve the raw-vs-normalized distinction
   in service comments/tests so a later provider implementation does not revert this boundary
   normalization.

   The promise must have one 30,000 ms metadata timer. On timeout or torrent error, destroy that
   torrent with destroyStore: true, clear listeners/timers, and reject a useful error. Metadata
   resolution must not select a file, create a stream, write a path, or call select().
4. Implement removeTorrent(magnetOrTorrentId) using the extracted info hash / lookup and
   torrent.destroy({ destroyStore: true }); make it idempotent when no matching torrent exists.
5. Implement status for the proof page: return a bounded JSON snapshot of client/torrent state,
   active resolution jobs, and completed metadata. Do not expose live WebTorrent objects through
   structured clone. A status read consumes a completed/failed result once; the 60-second fallback
   expiry removes results whose owner never reads them.
6. Implement the asynchronous request protocol forced by the 10-second outer RPC: resolve starts
   a resolution job and returns immediately with a request/job id; status returns pending,
   completed metadata, or a serialized error; cancel explicitly abandons a job. Enforce the
   four-job in-flight cap and the 15-second no-poll cancellation so a closed page clears its
   timer and destroys its half-added torrent. This keeps resolveTorrent's 30-second internal
   deadline while each service.request remains below the platform control deadline.
7. Implement init, probe, request, and shutdown over process.parentPort. shutdown must clear every
   job timer, reject every pending resolver, destroy any torrent whose resolution did not complete,
   destroy all remaining torrents/client stores, and exit cleanly. Respond to every request with
   either response/result or a serialized error; never let a rejected async handler become an
   unhandled rejection.

### 4. Add the proof page and board documentation

- Replace the scaffold page with boards/torrent-viewer/index.html: local board-base.css, a compact
  heading, magnet/torrent-id input, Resolve button, status/error area, and a file-list container.
  No remote scripts/styles, because the board CSP is local-only.
- Implement boards/torrent-viewer/app.js: call persephone.service.request({ op: "resolve",
  magnetOrTorrentId }), poll persephone.service.request({ op: "status", requestId }), render path,
  length, and index, and provide remove/status controls. If opened as a .torrent editor, read
  await persephone.getFilePath() and offer that path as the resolver input. Keep all output
  text-node/DOM-safe. Do not call persephone.host.streamUrl(), open a file in an editor, select a
  torrent file, or implement download controls here.
- Create boards/torrent-viewer/README.md explaining the metadata-only boundary, async
  resolve/status protocol, build command, pinned versions, and the later US-1524/US-1525 handoff.
- Rewrite the scaffolded boards/torrent-viewer/CLAUDE.md with board-specific key files, build/test
  steps, CSP/native-module gotchas, and service lifecycle. README.md and CLAUDE.md are the only
  board documentation delivered here. Defer WHATS-NEW.md and guides/ to US-1525 or US-1527; the
  skeleton is not publishable until the later UI/documentation task supplies them.

### 5. Verification and handoff

- Run the bundle build twice from a clean board install and compare the generated artifact hash;
  inspect that the four optional native modules are not installed or required at runtime.
- Through the running Persephone MCP, trust/open the board, call the proof page's Resolve with the
  public-domain Sintel magnet from EPIC-114, and confirm status returns the torrent name and file
  list within 30 seconds while every file remains zero/deselected. Test a dead magnet reaches the
  service's 30-second failure rather than hanging indefinitely; asynchronous polling remains
  responsive.
- Open a local .torrent path and verify the fileMasks association chooses the simple board.
- Verify app.boards.list() reports the service and provider declaration, service startup works when
  the board page is not open, and the service stops cleanly on board shutdown. Inspect
  boards/torrent-viewer/ui.log for load/service errors.
- Test publisher staging with the clean-copy logic: lib/ and documentation are present,
  node_modules/, ui.log, catalog history, and the intentionally deferred catalog-release artifacts
  are absent; the archive has no imposed size/file-count failure. Record that the skeleton is not
  publishable until US-1525 or US-1527 supplies screenshot.png, WHATS-NEW.md, and guides/.
- Do not update Persephone's doc/active-work.md or boards-manifest.json. The Persephone dashboard
  already contains the US-1523 entry at doc/active-work.md:47-53; the board-repository BT-025
  dashboard entry is a separate planned step above, and the catalog is machine-written when the
  board is published.

## Concerns / Open Questions

- Resolved design constraint — 10 s outer RPC vs 30 s D8 metadata deadline. The
  persephone.service.request path reaches moduleServiceSupervisor.request with the 10,000 ms
  default (src/main/board-bridge.ts:261-266; src/ipc/module-service-channels.ts:12-13). A direct
  request awaiting resolveTorrent for 30 seconds would be killed first. The plan resolves this
  with a quick resolve job-start request plus status polling; a future platform API could permit a
  longer bounded control timeout, but that is outside US-1523.
- **A board-claimed scheme cannot open the claiming board's own page.**
  `createBoardSchemeHooks` always creates a content pipe and sets the target with
  `resolveEditorIdForFile(data.url, schemeEffectivePath(data.url)) || "monaco"`
  (src/renderer/editors/board/custom-editor-registry.ts:207-209). Its
  `schemeEffectivePath` is `new URL(url).pathname.split("/").pop()`
  (src/renderer/editors/board/custom-editor-registry.ts:179-185), so opaque
  `magnet:?xt=...` has an empty pathname. Claiming `magnet` would therefore open Monaco on a
  torrent pipe, worse than today's no routing. This blocks EPIC-114 goal 1; a platform change
  owned by a later task is required, not a US-1523 service or editor workaround. The `torrent`
  declaration remains for the future provider contract and must not be described as solving
  magnet opening.
- Live utility-process network test is still required. Source inspection shows standard Node
  networking and no service-process network deny, while the board iframe CSP only blocks remote
  frame connections. The spike used plain Node, not Electron's utilityProcess; implementation
  acceptance must verify the Sintel magnet in the actual service process. If it fails, record the
  exact OS/security/network cause here rather than weakening D7.
- MCP authoring was not exposed in this investigation session. The board repository requires the
  running Persephone MCP for scaffolding and runtime verification
  (persephone-boards/CLAUDE.md:135-194); Persephone is running, so the implementation session
  should use that available path. This is not a standing blocker and no board was authored blind
  here.
- Memory growth is accepted by D6, not solved here. memory-chunk-store has no eviction; the epic
  requires RSS measurement after streaming at least 200 MB. US-1523 must not substitute a disk
  store or add an eviction policy.
- Provider implementation is intentionally absent. The manifest's torrent/viewer provider
  declaration is a stable forward contract for US-1524, but this task must not register provider
  methods or implement stat, readRange, readBinary, piece selection around reads, or the
  self-contained torrent://...?magnet=... provider link.
- .torrent browser-download routing remains US-1478 / D10. The file-mask association covers a
  path opened from disk; the download-service path is explicitly outside this task and must not be
  silently added.

## Acceptance Criteria

- [ ] board-manifest.json declares the service, stable namespaced torrent provider and `torrent`
      scheme, .torrent mask, simple editor kind, priority 100, version, and required permissions;
      it does not claim `magnet`, `guides`, or `screenshot` in this skeleton.
- [ ] package.json, package-lock.json, the build script, entry module, and committed
      lib/webtorrent.bundle.mjs reproduce the verified WebTorrent 3.0.21 /
      memory-chunk-store bundle with D3's banner and four externals; node_modules/ is not
      published.
- [ ] scripts/service.mjs performs the fixture init/probe/request/shutdown handshake, sets both
      WS environment variables before bundle import, constructs the client with
      store: MemoryChunkStore, and supports resolve, status, cancel, remove, and teardown with a
      four-job cap, bounded result lifetime, no-poll cancellation, and complete shutdown cleanup.
- [ ] resolveTorrent(magnetOrTorrentId) returns exactly
      { infoHash, name, files: [{ path, length, index }] } after metadata, with forward-slash
      canonical paths, all files deselected, and no content bytes selected or written.
- [ ] Metadata failure destroys the temporary torrent and reports a failure after the service's
      30-second timeout; the proof page remains responsive by polling status rather than waiting
      on one 30-second control RPC.
- [ ] The proof page accepts a magnet/torrent identifier, calls the service, and renders the file
      list and status/error state. It does not implement US-1524's provider or US-1525's
      production UI/open-file behavior.
- [ ] README.md and CLAUDE.md document the board-specific protocol and constraints. The task
      records that the board is not publishable until US-1525 or US-1527 adds WHATS-NEW.md,
      guides/, and screenshot.png; those release artifacts are not acceptance criteria here.
- [ ] The boards repository has BT-025's task doc and planned dashboard entry, linked to
      Persephone EPIC-114 using its existing BT numbering/entry conventions.
- [ ] Live verification uses the real Sintel magnet in Persephone's utility-process service,
      checks the no-board-page provider startup path, checks a local .torrent association, and
      reviews ui.log.
- [ ] No Persephone source files, Persephone doc/active-work.md, root boards-manifest.json, US-1524/1525
      implementation, streaming server, protocol handler, download routing, or commit is added by
      this task.

## Files Changed Summary

| Repository | File | Planned change |
|---|---|---|
| persephone-boards | boards/torrent-viewer/board-manifest.json | Service/provider declarations, .torrent association, catalog metadata. |
| persephone-boards | boards/torrent-viewer/package.json | Exact build-time WebTorrent, memory store, and esbuild dependencies. |
| persephone-boards | boards/torrent-viewer/package-lock.json | Reproducible npm dependency tree. |
| persephone-boards | boards/torrent-viewer/scripts/webtorrent-entry.mjs | Bundle entry exporting WebTorrent and the memory store class. |
| persephone-boards | boards/torrent-viewer/scripts/build-webtorrent.mjs | Reproducible esbuild invocation with D3 banner/externals. |
| persephone-boards | boards/torrent-viewer/lib/webtorrent.bundle.mjs | Committed 1.74 MB-class vendored runtime artifact. |
| persephone-boards | boards/torrent-viewer/lib/LICENSE*, VERSION.txt | Third-party attribution/version notices required by board conventions. |
| persephone-boards | boards/torrent-viewer/scripts/service.mjs | Parent-port service, WebTorrent metadata resolver, status/cancel/remove/shutdown protocol. |
| persephone-boards | boards/torrent-viewer/index.html, app.js | Minimal magnet/path proof page and file-list rendering. |
| persephone-boards | boards/torrent-viewer/README.md, CLAUDE.md | Immediate board-specific developer documentation; release docs are deferred. |
| persephone-boards | doc/tasks/BT-025-torrent-viewer-skeleton/README.md, doc/active-work.md | Board-repository task record and planned dashboard entry linked to EPIC-114. |

Files that need no changes for US-1523: C:/projects/persephone/src/main/module-service-supervisor.ts,
C:/projects/persephone/assets/module-service-host.mjs, C:/projects/persephone/src/main/board-protocol-service.ts,
C:/projects/persephone/src/ipc/module-service-channels.ts, all C:/projects/av-player sources,
C:/projects/persephone/doc/epics/EPIC-114.md, C:/projects/persephone/doc/active-work.md, and
C:/projects/persephone-boards/boards-manifest.json. They are evidence or platform/catalog owners,
not implementation targets for this board task.

## Related

- [EPIC-114](../../epics/EPIC-114.md)
- US-1524: the torrent content provider and self-contained links
- US-1525: the production torrent list/file-list page
- US-1526: lifecycle, restore, and uninstall behavior
- US-1478: downloaded .torrent routing
