# US-1519: Media player pipe source

Part of [EPIC-113: A board provider can feed Persephone's own editors](../../epics/EPIC-113.md).

## Goal

Add a third VideoStreamSessionConfig source, a page-owned content pipe, so a video opened from a
board provider is served by video-stream-server at
http://127.0.0.1:<port>/video-stream/<sessionId>. The same HTTP session URL must feed both the
in-page video element and Open in VLC, with no materialized cache file.

The session must use the existing bounded main-to-renderer pipe pull and page lifecycle. This task
does not reopen D10's protocol decision and does not implement a second pipe channel.

## Background

### Binding decisions and non-goals

EPIC-113 D10 rejects board://<host>/__pipe/... for this feature: VLC is an external process and
cannot fetch Electron's custom board:// protocol. The required external surface is the loopback
HTTP endpoint already returned by video-stream-server (EPIC-113.md:327-370). The existing
30-minute expiry and page-owned session cleanup are part of that server's current model
(src/main/video-stream-server.ts:9-10,51-80,94-114).

D6 makes page close the cancellation signal for a content read; it does not permit a platform
deadline on a provider read. The page-close path already unregisters the page pipe owner and
invalidates renderer pending reads (src/renderer/api/pages/PagesModel.ts:114-125). The new HTTP
pipe branch must preserve that cancellation path and must not turn SESSION_EXPIRY_MS into a
provider-read timeout (EPIC-113.md:235-326).

D9 keeps editor selection and pipe resolution independent. US-1521 shipped pipeFromLink() as the
canonical link-to-pipe resolver, while pipeFromSourcePath() remains the legacy restored/path
fallback (src/renderer/content/rebuild-pipe.ts:9-53). D11 prohibits permission gates, path
allow-lists, and scheme restrictions for trusted boards; only malformed input and ownership or
correctness checks remain (EPIC-113.md:372-400). The epic's non-goals exclude replacing
video-stream-server.ts, migrating published boards, credit-based push frames, and tests
(EPIC-113.md:86-116).

### What a video page receives today

The current session config has only filePath and url as mutually exclusive sources, plus an
optional page owner (src/ipc/api-param-types.ts:166-180). createSession() stores the config and
returns the loopback URL, and handleRequest() branches only to local-file or HTTP handling; there
is no pipe branch (src/main/video-stream-server.ts:51-69,119-173).

For a first-open board-scheme link, the content open handler reconstructs a source path from the
pipe provider, stores link metadata, and passes the live pipe into page creation
(src/renderer/content/open-handler.ts:16-30,32-48,55-65). The page lifecycle assigns that pipe
to a no-host editor's editor.pipe before restore()
(src/renderer/api/pages/PagesLifecycleModel.ts:199-234). Thus the video editor already owns the
live IContentPipe, but its stream resolver ignores it: non-M3U8 input is always converted to
{ url } for HTTP sources or { filePath } for everything else
(src/renderer/editors/video/VideoEditor.ts:100-125). A board-provider URL therefore falls
through to a file-path session and cannot play.

The restored path is also broken for a board provider. Video state persists url, inputText, format,
playerState, and parsedRequest, but deliberately strips transient streamUrl
(src/renderer/editors/video/VideoEditor.ts:436-472). Restored no-host editors are reconstructed
by copying persisted state and calling restore() without a live pipe
(src/renderer/api/pages/PagesPersistenceModel.ts:288-306). VideoEditor.restore() then recreates
only the current file/HTTP session (src/renderer/editors/video/VideoEditor.ts:155-167).
For a board scheme, the persisted source is recoverable: open-handler.ts stores the provider's
source URL, and a board scheme's provider descriptor uses the original link as config.url
(src/renderer/content/open-handler.ts:20-30;
src/renderer/editors/board/custom-editor-registry.ts:187-204). Restore must rebuild this link
with pipeFromLink(), not use the permissive unknown-path fallback.

### The VLC claim, verified against the code

The existing view and launcher need no feature work. The view wires Open in VLC to
VideoEditor.openInVlc() (src/renderer/editors/video/VideoView.ts:88-105), and shows the button for
a decode/error state while hiding it during loading, playing, and stopped
(src/renderer/editors/video/VideoView.ts:197-207). The launcher accepts an HTTP URL and starts VLC
with it (src/main/vlc-launcher.ts:9-20).

However, D10's statement that the VLC flow itself needs no work is only true for that
UI/launcher surface. The current openInVlc() creates a second video session from the raw source
(src/renderer/editors/video/VideoEditor.ts:401-425); it does not reuse the in-page streamUrl.
That would make a pipe source technically reachable by VLC, but would violate this task's hard
requirement that both consumers use one session. openInVlc() must use the already resolved
streamUrl, or the direct M3U8 URL; VideoView.ts and vlc-launcher.ts remain unchanged.

### Existing bounded pipe channel and its board assumption

US-1521 generalized the wire request to an explicit pipeKind: "page" | "resource" plus pipeId
(src/ipc/board-pipe-channels.ts:15-25). Main routes both kinds through one owner map keyed by
kind:id, validates the board host when one is present, and sends cancellation for resource
teardown (src/main/board-pipe-service.ts:35-78,80-145,189-213). Every Persephone page is already
registered as a page owner, even when its editor is not a board
(src/renderer/api/pages/PagesModel.ts:67-70).

The remaining board-shaped assumption is in the renderer resolver: a page request finds the
page's main editor, requires BoardEditorModel.pipeUrlEnabled, and calls board-only
resolveStreamPipe() (src/renderer/editors/board/board-pipe-handler.ts:134-147). A video page is
not a board, but its main editor's inherited EditorModel.pipe is the page-owned pipe assigned by
the page lifecycle. Generalize only this resolver: retain the board-specific resolver for board
pages, and otherwise read the main editor's live pipe. Existing page invalidation then covers
video reads (src/renderer/editors/board/board-pipe-handler.ts:247-271).

The 1 MiB reply is not a complete media response by itself. board-protocol-service.ts validates
the first bounded chunk, then requests continuation ranges until the HTTP body reaches the
requested end (src/main/board-protocol-service.ts:290-405). The video-stream-server pipe branch
must use the same continuation behavior, range validation, and MAX_BOARD_PIPE_CHUNK_BYTES; a
response that ends after one chunk would advertise a larger Content-Length while delivering an
incomplete film range.

### Resource-registry decision

US-1519 will not reuse US-1521's content-resource registry as its pipe source. That registry is
owned by BoardEditorModel, keyed by board-frame tab/generation, published through the renderer
resource map, and registered in main for a board://<host>/__pipe/resource/<id> URL
(src/renderer/editors/board/BoardEditorModel.ts:43-53,613-666;
src/renderer/editors/board/BoardWebview.ts:989-1065). Its lifetime is the calling board frame,
not the video page, and its URL is deliberately in-frame only.

The video path already has the correct owner: the video editor's live pipe belongs to its page,
and all pages have a page owner in BoardPipeService. Reusing the board resource registry would
create a second pipe/resource lifetime, require a board host for a non-board page, and still leave
the external VLC consumer needing a separate HTTP session. US-1519 reuses US-1521's pipeFromLink()
resolver for restored board links, but uses a transient video-session id and the existing
page-kind pipe route for the HTTP server.

### Session ownership and expiry decision

VideoEditor owns the active session URL and the page pipe it feeds. The main session stores the
owning pageId; page close is the authoritative release signal. PagesModel.detachPage() will delete
sessions by that page id alongside page-pipe unregister/invalidation, and the video editor will
retain the page id/session id needed to clean up even after PageModel.detach() clears editor.page
(src/renderer/api/pages/PageModel.ts:322-352,819-845). Cleanup is idempotent because both the
page backstop and editor teardown may run.

SESSION_EXPIRY_MS remains 30 minutes of inactivity. Active playback refreshes lastAccessed on each
HTTP request (src/main/video-stream-server.ts:101-109,139-150), so an actively playing film does
not expire merely because its duration exceeds 30 minutes. A paused VLC session that receives no
request for 30 minutes remains intentionally stale and returns the existing 404 response on
resume. To preserve D6 for a pipe read actively waiting longer than 30 minutes, expiry cleanup
must not remove a session with an active pipe request; page-close/session deletion still aborts it.
No global expiry increase is justified, and local-file/HTTP session behavior stays unchanged.

## Implementation Plan

1. Extend the video session contract and HTTP server in src/ipc/api-param-types.ts and
   src/main/video-stream-server.ts.

   - Add pipe?: true as a mutually exclusive source beside filePath and url. The pipe source is a
     discriminator that deliberately reuses the existing pageId field; it is not a serializable
     IContentPipe. Main reads config.pageId for the page-kind READ and stores that same value as
     SessionData.pageId for session ownership and deleteSessionsByPage().
   - Validate that exactly one source is present, and require pageId when pipe is true. The IPC
     handler must verify that the requested pipe page is owned by the calling renderer before
     creating the session; this is a correctness/ownership check, not a board permission gate.
   - Add the pipe branch to handleRequest(). Parse the incoming Range against the total size
     reported by the first renderer reply, emit the same 200/206/416 headers as existing sources,
     and use boardPipeService.read(undefined, "page", config.pageId, ...) for first and
     continuation reads. Widen the read parameter type to string | undefined, but retain strict
     owner.host !== host equality: undefined is a real owner-host value, not a wildcard. A
     non-board page is registered with owner.host undefined (src/renderer/api/pages/PagesModel.ts:69),
     while BoardWebview.transferPort re-registers board pages with their host
     (src/renderer/editors/board/BoardWebview.ts:367), so undefined must not match a board page.
     This strict equality is load-bearing: treating undefined as a wildcard would expose a board
     page pipe through loopback HTTP and bypass pipeUrlEnabled. Board protocol requests continue
     to pass and validate their board:// host.
   - Pull continuation ranges until the requested end, matching board-protocol-service.ts:356-404:
     validate totalSize, contiguous start/end, exact data length, and the 1 MiB maximum before
     writing each chunk. This is required for seeking and VLC requests larger than one IPC reply.
   - Track active pipe HTTP requests so the 30-minute cleanup does not remove a session while a
     D6-unbounded provider read is outstanding. Tie request/response abort/close to the same
     AbortController; deleteSession() and deleteSessionsByPage() abort active pipe requests before
     removing the map entry. Preserve existing expiry behavior for idle sessions.

   Before:

       export interface VideoStreamSessionConfig {
           filePath?: string;
           url?: string;
           headers?: Record<string, string>;
           method?: string;
           pageId?: string;
       }

   After:

       export interface VideoStreamSessionConfig {
           filePath?: string;
           url?: string;
           pipe?: true;
           headers?: Record<string, string>;
           method?: string;
           pageId?: string;
       }

2. Generalize the existing page-pipe route in src/renderer/editors/board/board-pipe-handler.ts
   and the ownership check in src/main/board-pipe-service.ts.

   - Keep BoardPipeKind as "page" | "resource"; its page branch becomes a generic page-owned
     current pipe, while resource remains the US-1521 board-frame resource branch. Do not add a
     video kind or a second IPC channel.
   - Replace the unconditional BoardEditorModel.pipeUrlEnabled requirement for the page branch
     with a capability check, not instanceof or a runtime BoardEditorModel import. Treat the
     editor as a board stream host only when it exposes pipeUrlEnabled === true and a callable
     resolveStreamPipe(); otherwise read the main editor's pipe for non-board page editors such as
     VideoEditor. Keep the existing memo, bounded range, content-type, provider-overrun, and
     AbortSignal behavior. This avoids pulling the board editor graph into the handler chunk while
     preserving the board-only resolver semantics.
   - Preserve invalidateBoardPipePage(pageId) as renderer-side cancellation for both board and
     video page pipes. Page close must remove the page memo and abort matching pending provider
     reads before the editor is disposed.
   - Widen BoardPipeService.read()'s host parameter to string | undefined, but retain the existing
     strict owner.host !== host comparison for every request. Undefined is the registered host
     value for a non-board page, not a special skip-host rule; a board page's registered host
     therefore still fails a video-stream-server read with undefined. Add an explicit page-owner
     check usable by the video-session IPC handler so a session cannot name a page belonging to
     another renderer window.

   Before:

       const page = pages.findPage(request.pipeId);
       const board = page?.mainEditorInstance as BoardEditorModel | null;
       if (!board || !board.pipeUrlEnabled) throw new Error("The board pipe page is unavailable.");
       pipe = await board.resolveStreamPipe();

   After:

       const page = pages.findPage(request.pipeId);
       const editor = page?.mainEditorInstance as {
           pipeUrlEnabled?: boolean;
           resolveStreamPipe?: () => Promise<IContentPipe>;
           pipe?: IContentPipe | null;
       } | null;
       if (editor?.pipeUrlEnabled === true && editor.resolveStreamPipe) {
           pipe = await editor.resolveStreamPipe();
       } else {
           pipe = editor?.pipe ?? undefined;
       }
       if (!pipe) throw new Error("The page content pipe is unavailable.");

3. Integrate the page pipe into src/renderer/editors/video/VideoEditor.ts.

   - Select the session source by what handleFileRequest() can open: M3U8 stays a direct URL; a
     plain http(s) URL keeps the existing { url } session; a plain local file keeps { filePath };
     anything else with a live pipe uses { pipe: true, pageId }. This includes archive entries
     such as C:/films/pack.zip!movie.mkv, which resolveStreamUrl() currently routes to the
     filePath branch even though handleFileRequest() calls fs.promises.stat(filePath)
     (src/main/video-stream-server.ts:182; src/renderer/editors/video/VideoEditor.ts:112-114).
     ContentPipe already buffers and slices transformed pipes for this route
     (src/renderer/content/ContentPipe.ts:77-95). A pipe source never passes a board:// URL to
     Chromium or VLC. The existing resolveStreamUrl() catch fallback at
     src/renderer/editors/video/VideoEditor.ts:122-124 must remain limited to local/HTTP sources;
     a failed pipe session must surface an error rather than return an unusable board:// URL.
   - Add a restore-only ensurePipeForSource() path. If no live pipe exists and the restored URL is
     not local/HTTP, call pipeFromLink(sourceLink?.href ?? url) and assign the result to this.pipe;
     do not call pipeFromSourcePath() for a registered board scheme because its "file" fallback
     would disguise a missing scheme registration as a filesystem path.
   - Have resolveStreamUrl() return/store both session id and streaming URL. When a new source
     replaces an old one, delete the old session before publishing the new URL so the editor has
     exactly one active non-M3U8 session.
   - Change openInVlc() to pass the existing state.streamUrl to api.openInVlc() for non-M3U8 media,
     and the existing raw URL for M3U8. It must not call createVideoStreamSession() again. This is
     the only required change in the VLC flow; VideoView.ts and vlc-launcher.ts remain unchanged.
   - Capture page id/session id when the session is created, because PageModel.detach() can clear
     editor.page before deferred editor disposal. On dispose, delete sessions, dispose the owned
     pipe, clear transient session state, and then call super.dispose().

   Before:

       const { streamingUrl } = await api.createVideoStreamSession(sessionConfig, port);
       return streamingUrl;

   After:

       const session = await api.createVideoStreamSession(
           { pipe: true, pageId },
           settings.get("video-stream.port"),
       );
       this.activeSessionId = session.sessionId;
       return session.streamingUrl;

   The VLC call changes from constructing another config/session to:

       const vlcUrl = format === "m3u8" ? url : streamUrl;
       if (!vlcUrl) return;
       await api.openInVlc(vlcUrl, settings.get("vlc-path"));

4. Connect session deletion to page ownership in src/renderer/api/pages/PagesModel.ts and the
   video-session IPC path in src/ipc/main/core-handlers.ts.

   - In detachPage(page), call api.deleteVideoStreamSessionsByPage(page.id) together with the
     existing page-pipe unregister/invalidation. This covers close paths where PageModel clears
     editor.page before VideoEditor.dispose() and is safe to repeat from editor teardown.
   - Pass IpcMainEvent.sender into video-session ownership validation. A pipe session may only name
     a page registered by that same renderer WebContents; invalid/stale page ids fail before a
     session is published.
   - Keep existing endpoint names and renderer wrapper in src/ipc/api-types.ts and
     src/ipc/renderer/api.ts; the changed config type flows through them without a new endpoint.

5. Preserve the existing US-1521 resource registry and board protocol unchanged.

   - Do not route a video page through BoardEditorModel.openContentResource(),
     registerBoardPipeResource(), or board://<host>/__pipe/resource/<id>. Those remain
     board-frame/generation-owned and are unrelated to the video page's page-kind pipe.
   - Do not change pipeFromLink() or the registered scheme ownership registries. The video restore
     path consumes the resolver shipped by US-1521; provider ownership remains enforced by existing
     board registration (src/renderer/editors/board/custom-editor-registry.ts:426-473).
   - Leave the existing board:// continuation implementation in src/main/board-protocol-service.ts
     behaviorally unchanged. The video HTTP branch matches its bounded-pull semantics, but writes
     to Node's ServerResponse rather than inventing another renderer transport.

6. Do not add unit tests. Verify through existing build/lint/type checks and the running
   fixture-board workflow already used by EPIC-113, including the behavioral checks below.

## Concerns

### One session for two consumers

The old code created one session for the in-page player and a second one for VLC
(src/renderer/editors/video/VideoEditor.ts:106-124,401-419). The implementation must make the
session URL transient editor state and have both consumers read it. Verification must compare the
URL handed to the player with the URL handed to api.openInVlc(); merely serving two sessions from
the same pipe is insufficient.

### Page close versus editor/page detach

PageModel.detach() clears editor.page before disposal (src/renderer/api/pages/PageModel.ts:322-332),
so looking up this.page?.id only inside VideoEditor.dispose() is not reliable. Page-model deletion
plus a captured owner id/session id gives page close the D6 cancellation meaning without depending
on teardown order. Pipe invalidation must happen before or alongside session deletion so pending
renderer reads receive AbortSignals and no late reply is emitted
(src/renderer/editors/board/board-pipe-handler.ts:199-227,247-271).

### Expiry and slow providers

Keep 30 minutes as the idle capability lifetime. Active HTTP requests must be exempt from cleanup
so a D6-unbounded provider read is not silently cut off by the idle timer. A paused session with
no request for 30 minutes still expires and returns 404, matching current behavior; changing the
global constant would alter local-file and HTTP playback unnecessarily.

### Range continuation and response cancellation

The renderer reply is bounded at 1 MiB (src/shared/board-pipe-constants.ts:1-5), so the HTTP server
must loop over continuation reads for large media and seeking. Every continuation uses the same page
id and request abort signal. If VLC or Chromium abandons a request, the server must stop asking the
provider for subsequent chunks and the main service must send the existing cancel message
(src/main/board-pipe-service.ts:104-145,189-208).

### Buffered provider ceiling

The page branch reaches readBuffered() when hasDirectStream() is false, so a provider without
readRange/createReadStream buffers the whole logical resource in the renderer and is bounded by
MAX_BUFFERED_PIPE_BYTES, 256 MiB (src/renderer/editors/board/board-pipe-handler.ts:66-110,134-182;
src/shared/board-pipe-constants.ts:1-5). A 2 GiB resource therefore fails on its first request
rather than degrading to a slower mode. This is correct and consistent with US-1474; larger media
requires a direct ranged provider. The per-page memo retains that full Buffer for the page's
lifetime until page invalidation releases it (src/renderer/editors/board/board-pipe-handler.ts:38-63,149-154).

### First request on a slow source

The first HTTP request cannot write bytes until the first renderer read completes, and
resolveTotalSize() runs before any response data is written. A slow or stalled provider can
therefore make Chromium or VLC appear to fail or wait indefinitely; their client-side timeouts
are outside Persephone's control. This is the same no-page-on-stall shape recorded in the epic
(EPIC-113.md:681-724). It is a concern, not a new deadline: D6 forbids adding a provider-read
timeout, and page close remains the cancellation signal.

### Security boundary

No board permission or path policy is added. The loopback URL remains a local-process capability,
as D10 records; session UUIDs and page/WebContents ownership checks provide routing correctness,
while range and payload bounds protect against malformed providers (EPIC-113.md:327-400,430-487).

## Acceptance Criteria

- Opening a board-scheme .mp4, .mkv, or other media link resolves to the video editor with the
  live provider pipe retained; the in-page video requests the loopback video-stream URL and
  plays/seeks without a cache file.
- Archive-hosted media such as a media entry in C:/films/pack.zip!movie.mkv uses the pipe session
  and plays/seeks without first being treated as a filesystem path or materialized cache file.
- The same page's Open in VLC action passes the exact existing stream URL, not a second session
  URL, and VLC plays/seeks through 127.0.0.1 even when Chromium cannot decode the format.
- A restored video page rebuilds a registered board-scheme pipe from its persisted source link and
  plays/seeks; local-file and HTTP restore/playback remain unchanged.
- A pipe-backed HTTP range larger than 1 MiB is delivered through continuation pulls with correct
  206, Content-Range, Content-Length, Accept-Ranges, and Content-Type behavior. A malformed or
  oversized renderer reply fails as a bounded correctness error.
- A non-ranged provider is whole-buffered only up to MAX_BUFFERED_PIPE_BYTES (256 MiB); a larger
  resource fails with the existing bounded correctness error rather than silently degrading.
- The pipe session is page-owned. Closing the page deletes its HTTP session, unregisters the page
  pipe owner, aborts pending provider reads, and makes the old URL unavailable; repeated cleanup
  does not throw or leak a pipe.
- An actively outstanding pipe request is not expired solely because it has waited longer than 30
  minutes. An idle session with no request for 30 minutes expires according to existing policy.
- A pipe session cannot name a page owned by another renderer WebContents. No permission prompt,
  path allow-list, or scheme restriction is added for trusted boards.
- Existing board:// page/resource routes and US-1521's board-frame resource registry retain their
  current behavior. No unit tests are added, and no dashboard or epic tracking file is changed by
  this task document.

## Files Changed

| File | Planned change | Status |
|---|---|---|
| src/ipc/api-param-types.ts | Add pipe?: true as the mutually exclusive page-pipe source, reusing pageId for READ and ownership. | Planned |
| src/main/video-stream-server.ts | Serve page pipes over loopback HTTP with bounded continuation reads, cancellation, ownership, and active-request-aware expiry. | Planned |
| src/main/board-pipe-service.ts | Widen the host type to string or undefined while retaining strict equality and expose the page/WebContents ownership check. | Planned |
| src/renderer/editors/board/board-pipe-handler.ts | Resolve a page-owned current pipe for video editors while preserving board and resource paths. | Planned |
| src/renderer/editors/video/VideoEditor.ts | Restore board-scheme pipes, create one pipe-backed session, reuse its URL for VLC, and dispose the session/pipe. | Planned |
| src/renderer/api/pages/PagesModel.ts | Delete page-owned video sessions during page detach/close. | Planned |
| src/ipc/main/core-handlers.ts | Validate the calling WebContents owns a requested pipe page before session creation. | Planned |
| src/ipc/board-pipe-channels.ts | No wire-shape expansion; retain the explicit page/resource discriminator used by the generalized route. | No functional change |
| src/main/board-protocol-service.ts | No behavioral change; its continuation loop is the reference behavior for the video HTTP branch. | No change |
| src/renderer/content/rebuild-pipe.ts | No change; reuse US-1521's pipeFromLink() for restored registered links. | No change |
| src/renderer/editors/board/BoardEditorModel.ts | No change; US-1521's board-frame resource registry is deliberately not reused. | No change |
| src/renderer/editors/board/BoardWebview.ts | No change; board-frame resource lifetime remains US-1521-owned. | No change |
| src/renderer/editors/video/VideoView.ts | No change; existing button and player-state gate are sufficient. | No change |
| src/main/vlc-launcher.ts | No change; it already launches the supplied HTTP URL. | No change |
| src/ipc/api-types.ts and src/ipc/renderer/api.ts | No new endpoint; the existing typed session endpoint carries the expanded config. | No change |
| assets/guides/agents/boards.md | No board API or board-frame URL contract changes in this task. | No change |
| doc/active-work.md and doc/epics/EPIC-113.md | Dashboard/epic tracking remains user-owned as requested. | No change |
