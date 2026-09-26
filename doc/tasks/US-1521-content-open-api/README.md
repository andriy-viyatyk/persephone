# US-1521: Add persephone.content.open(link)

Part of [EPIC-113: A board provider can feed Persephone's own editors](../../epics/EPIC-113.md).

## Goal

Expose persephone.content.open(link) to board frames. It resolves the named link through
Persephone's existing content pipeline, owns a ranged pipe for that link, and returns
{ url, size, contentType }, where url is an origin-local board://<host>/__pipe/<id> URL usable
by in-frame consumers such as fetch, img, video, and pdf.js. This is the board-facing migration
path away from getFilePath() and must work for simple boards as well as content-host and
stream-host boards.

The API returns a URL rather than an IContentPipe: a pipe's methods live in the renderer and
structured-clone RPC cannot carry them across the board-frame boundary (EPIC-113 D9,
[board-api.d.ts:285-304](../../../src/renderer/editors/board/board-api.d.ts#L285-L304)).

## Background

### Decisions and scope

EPIC-113 D9 separates link resolution into two independent results: editor selection and the
pipe that supplies bytes. The existing editor resolver is resolveEditorIdForFile() in
custom-editor-registry.ts; built-in link-to-pipe resolution is resolveUrlToPipeDescriptor(), and
registered-scheme source-path resolution is resolveRegisteredSourcePath()
([EPIC-113.md:144-189](../../epics/EPIC-113.md#L144-L189)). US-1521 implements the missing
public board-facing pipe result; it does not change editor selection or open a Persephone page.

D12 fixes the public name and return shape: persephone.content.open(link) returns
{ url, size, contentType }. host.streamUrl() remains unchanged because it is gated by
pipeUrlEnabled, which is true only for content-host and stream-host boards; the current board
shim rejects plain boards before it constructs a URL
([BoardEditorModel.ts:570-576](../../../src/renderer/editors/board/BoardEditorModel.ts#L570-L576),
[board-shim.ts:1624-1636](../../../src/board-shim.ts#L1624-L1636)). D12 also records that
published boards are simple boards, which is why widening host would miss the migration target
([EPIC-113.md:405-425](../../epics/EPIC-113.md#L405-L425)).

D11 is binding: a trusted board is a user application. Do not add a permission prompt, path
allow-list, or scheme restriction. Retain only correctness and ownership checks: malformed
links/ranges must fail cleanly, provider registrations must remain owned by their declaring
board, and a board scheme must not resolve through another board's provider
([EPIC-113.md:372-400](../../epics/EPIC-113.md#L372-L400)).

The epic explicitly makes the external HTTP form an open question for this task. D10 settles
that US-1519 needs video-stream-server's http://127.0.0.1:<port>/video-stream/<sessionId>
surface for VLC, because VLC cannot fetch a board:// URL; it leaves whether US-1521 itself
hands out an HTTP URL to this task document
([EPIC-113.md:327-370](../../epics/EPIC-113.md#L327-L370)). Recommendation: US-1521 should
ship only the origin-local board:// URL. Leave HTTP session creation, external-process
capability lifetime, and the media-specific video-stream-server source to US-1519. The
existing HTTP server has page-owned sessions, explicit deletion, and 30-minute idle expiry
([video-stream-server.ts:44-89](../../../src/main/video-stream-server.ts#L44-L89)); putting
that policy into a general board content API would create a second lifetime model before the
external consumer is known.

### Existing board API and materialization behavior

The actual board bridge implementation is src/board-shim.ts; the supplied
src/renderer/editors/board/board-shim.ts path does not exist. The bridge currently exposes
readFile() and writeFile() as MessagePort RPC methods
([board-shim.ts:1548-1563](../../../src/board-shim.ts#L1548-L1563)); those methods accept
arbitrary absolute paths in the main-process bridge
([board-bridge.ts:238-255](../../../src/main/board-bridge.ts#L238-L255)). getFilePath() waits
for the handshake and returns a local path, materializing non-local/transformed sources through
filePathRpc() ([board-shim.ts:1587-1617](../../../src/board-shim.ts#L1587-L1617)).

BoardEditorModel.ensureContentPath() confirms the cost US-1521 is intended to avoid: it reuses
the persisted pipe descriptor when available, but for a non-file pipe reads the complete binary
content and writes a cache file under the editor cache directory
([BoardEditorModel.ts:615-655](../../../src/renderer/editors/board/BoardEditorModel.ts#L615-L655)).
dispose() removes that cache directory and disposes the model's current pipe
([BoardEditorModel.ts:927-950](../../../src/renderer/editors/board/BoardEditorModel.ts#L927-L950)).
The new API must not call ensureContentPath() or create a cache file.

The maintained author documentation is assets/guides/agents/boards.md, not
assets/board-api.d.ts. The actual legacy board declaration is
src/renderer/editors/board/board-api.d.ts, whose header says it is not the maintained author
reference ([board-api.d.ts:1-13](../../../src/renderer/editors/board/board-api.d.ts#L1-L13)).
The guide currently documents openRawLink(), openContent(), readFile()/writeFile(), getFilePath(),
and the host.streamUrl() restriction
([boards.md:519-580](../../../assets/guides/agents/boards.md#L519-L580),
[boards.md:677-706](../../../assets/guides/agents/boards.md#L677-L706)). It also documents
that provider implementations are service-only, provider types/schemes are one-owner
registrations, and the current provider path is whole-resource buffered
([boards.md:371-386](../../../assets/guides/agents/boards.md#L371-L386)); the guide must be
updated to describe content.open() and its URL lifetime after implementation.

### Existing link-to-pipe resolution

resolveUrlToPipeDescriptor(url, data?) handles data URLs, HTTP/HTTPS URLs, local/file URLs,
and archive paths; tree-category URLs return no pipe
([link-utils.ts:83-137](../../../src/renderer/content/link-utils.ts#L83-L137)). HTTP
descriptors preserve method, headers, and body only when an ILinkData is supplied
([link-utils.ts:128-137](../../../src/renderer/content/link-utils.ts#L128-L137)); the board
API is intentionally specified as open(link), so its first implementation accepts a link string
and uses the normal URL defaults.

Registered board schemes already resolve through resolveRegisteredSourcePath(), which
constructs a source-path ILinkData, executes the scheme parse/resolve hooks, and returns the
hook's pipe or descriptor ([scheme-registry.ts:228-255](../../../src/renderer/content/scheme-registry.ts#L228-L255)).
createBoardSchemeHooks() creates a provider descriptor for the declaring provider type and
returns early in the source-path phase
([custom-editor-registry.ts:183-202](../../../src/renderer/editors/board/custom-editor-registry.ts#L183-L202)).
The registry only registers a board scheme after that board's provider registration succeeds,
and passes the board root as provider and scheme owner
([custom-editor-registry.ts:414-464](../../../src/renderer/editors/board/custom-editor-registry.ts#L414-L464)).
This is the ownership invariant the new link resolver must preserve.

pipeFromSourcePath() is currently a fallback for restored editors and path-only construction.
It first asks the registered-scheme registry, then falls back to HTTP, archive, or file providers
([rebuild-pipe.ts:7-45](../../../src/renderer/content/rebuild-pipe.ts#L7-L45)). US-1521 should
extract/reuse a canonical link resolver rather than make BoardWebview duplicate these branches.
The canonical resolver must prefer a registered scheme, otherwise use
resolveUrlToPipeDescriptor() and createPipeFromDescriptor(); an unresolvable link should
reject as a content-resolution error.

### Existing pipe and range machinery

ContentPipe delegates stat() to the provider for an untransformed pipe and otherwise reads the
transformed bytes to determine the logical size; createReadStream(range) delegates directly
only when there are no transformers and the provider supplies a stream, otherwise it buffers
and slices ([ContentPipe.ts:57-103](../../../src/renderer/content/ContentPipe.ts#L57-L103)).
Its dispose() delegates to the provider ([ContentPipe.ts:207-211](../../../src/renderer/content/ContentPipe.ts#L207-L211)).

The current board pipe handler is page-bound. readChunk() finds pages[pageId], requires
board.pipeUrlEnabled, resolves that page's existing stream pipe, determines total size, clamps
each request to MAX_BOARD_PIPE_CHUNK_BYTES, and reports contentTypeForPipe()
([board-pipe-handler.ts:39-68](../../../src/renderer/editors/board/board-pipe-handler.ts#L39-L68),
[board-pipe-handler.ts:160-207](../../../src/renderer/editors/board/board-pipe-handler.ts#L160-L207)).
It already protects the renderer side against a provider returning a chunk larger than the 1 MiB
IPC bound ([board-pipe-handler.ts:139-151](../../../src/renderer/editors/board/board-pipe-handler.ts#L139-L151)).
The current content-type table covers audio, video, and image extensions only; all other
extensions, including pdf, markdown, text, JSON, HTML, CSV, XML, and ZIP, currently fall
through to application/octet-stream ([board-pipe-handler.ts:39-68](../../../src/renderer/editors/board/board-pipe-handler.ts#L39-L68)).
US-1521 must extend that shared function with at least application/pdf, text/markdown,
text/plain, application/json, text/html, text/csv, application/xml, and application/zip,
plus the common document/archive types selected in the implementation. The existing __pipe
route benefits from the same change because it calls the same function.

The main board:// protocol maps /__pipe/<id> to serveBoardPipe(), which performs the first
bounded read, emits Range/Content-Range/Content-Length, pulls continuation chunks, and validates
every returned range ([board-protocol-service.ts:286-402](../../../src/main/board-protocol-service.ts#L286-L402)).
The main pipe service currently registers a pageId to a host WebContents, sends reads to that
renderer, and rejects pending reads when the owner disappears
([board-pipe-service.ts:11-61](../../../src/main/board-pipe-service.ts#L11-L61),
[board-pipe-service.ts:119-158](../../../src/main/board-pipe-service.ts#L119-L158)).
Page registration is currently performed for every page and board frames also pass pipeUrlEnabled
and pageId in their handshake
([PagesModel.ts:61-70](../../../src/renderer/api/pages/PagesModel.ts#L61-L70),
[BoardWebview.ts:364-376](../../../src/renderer/editors/board/BoardWebview.ts#L364-L376)).

The cleanup precedent is explicit: page detach unregisters the main-side pipe owner and calls
invalidateBoardPipePage(pageId), which clears memoized pipes and aborts every pending read for
that page ([PagesModel.ts:112-121](../../../src/renderer/api/pages/PagesModel.ts#L112-L121),
[board-pipe-handler.ts:239-262](../../../src/renderer/editors/board/board-pipe-handler.ts#L239-L262)).
The main service's removeOwner() and removeWebContents() paths reject pending requests but do
not themselves send BOARD_PIPE_CANCEL_CHANNEL; only read()'s onAbort path sends that message
([board-pipe-service.ts:86-98](../../../src/main/board-pipe-service.ts#L86-L98),
[board-pipe-service.ts:155-180](../../../src/main/board-pipe-service.ts#L155-L180)). This is
not a live gap for ordinary pages because PagesModel.detachPage() performs the renderer-side
invalidation. It is coverage the new resource path must add when a resource is released directly.

BoardPipeService has one string-keyed owners namespace. A page is registered once by
PagesModel.attachPage() without a host, then registered again by BoardWebview.transferPort()
with the host, relying on same-WebContents overwrite
([PagesModel.ts:61-70](../../../src/renderer/api/pages/PagesModel.ts#L61-L70),
[BoardWebview.ts:364-376](../../../src/renderer/editors/board/BoardWebview.ts#L364-L376),
[board-pipe-service.ts:34-55](../../../src/main/board-pipe-service.ts#L34-L55)). Resource
registration must not use that page re-registration path: it must register a distinct resource
key with its host already set.

### Proposed ownership and lifecycle

Each successful content.open(link) creates one opaque resource ID and one IContentPipe owned by
the calling board frame generation. The host-side BoardEditorModel/BoardWebview owns the resource
record because the board frame is the caller, while the main board-pipe-service owns only the
URL-to-WebContents routing. The record must include the pipe, resource ID, board host, owning
page/model identity, frame tab/generation, and disposal state.

The resource is disposed when its calling board frame is replaced/reloaded, when that board
page/model is closed, or when the board loses the live frame/host. Disposal must be idempotent,
remove the resource from the renderer registry, call pipe.dispose(), unregister the resource ID
from BoardPipeService, and abort all outstanding reads for that resource. A pending read must
reject/cancel and must not send a late reply after disposal; a request already in the main HTTP
stream must stop pulling continuation chunks and the renderer provider read must receive the
existing AbortSignal where supported. The existing handler already creates an AbortController
per read and aborts it on explicit cancellation/page invalidation
([board-pipe-handler.ts:23-32](../../../src/renderer/editors/board/board-pipe-handler.ts#L23-L32),
[board-pipe-handler.ts:215-262](../../../src/renderer/editors/board/board-pipe-handler.ts#L215-L262)).

Do not reuse the page's current pipe memo for a link resource. A board may call content.open()
for a link unrelated to the file that opened the board, and a simple board has no
pipeUrlEnabled page pipe at all. The resource route must identify the resource directly and
must not gate access on editorKind or pipeUrlEnabled.

## Implementation Plan

1. Add a canonical link-to-pipe helper in src/renderer/content/rebuild-pipe.ts and make the
   existing source-path fallback delegate to it.

   - Add pipeFromLink(link, options?) that first asks resolveRegisteredSourcePath(link), then
     resolves built-in shapes through resolveUrlToPipeDescriptor(link) and
     createPipeFromDescriptor(). Its default unknown-scheme policy is reject, which is the
     policy content.open() uses.
   - Change pipeFromSourcePath() to delegate to pipeFromLink(path, { unknownScheme: "file" }).
     This preserves the existing restored-editor/path-only fallback of constructing a
     FileProvider for an unknown shape while keeping the registered-scheme, HTTP, archive, file,
     and data URL branches in one implementation. Do not alter the US-1517 open/source-path
     distinction in custom-editor-registry.ts.
   - A failed/unsupported link must reject under the content.open() policy; it must not silently
     construct a FileProvider for an unknown scheme.

   Before:

       // rebuild-pipe.ts currently resolves only a source path.
       export async function pipeFromSourcePath(path: string): Promise<IContentPipe> { ... }

   After:

       export async function pipeFromLink(
           link: string,
           options: { unknownScheme: "reject" | "file" } = { unknownScheme: "reject" },
       ): Promise<IContentPipe> {
           const registered = await resolveRegisteredSourcePath(link);
           if (registered) return registered;
           const descriptor = resolveUrlToPipeDescriptor(link);
           if (descriptor) return createPipeFromDescriptor(descriptor);
           if (options.unknownScheme === "file") return new ContentPipe(new FileProvider(link));
           throw new Error("The link cannot be resolved to content.");
       }

   The exact error type/message may follow existing provider-resolution conventions, but the
   implementation must preserve provider ownership and must not introduce a permission check.

2. Extract/reuse content-type detection and add resource ownership to
   src/renderer/editors/board/BoardEditorModel.ts.

   - Move or export the existing extension-based contentTypeForPipe() logic from
     board-pipe-handler.ts to a reusable content/board-pipe utility so both the existing page
     pipe and link resources report the same MIME mapping.
   - Extend the table beyond the current audio/video/image cases with at least pdf, md/markdown,
     txt, json, html/htm, csv, xml, yaml/yml, zip, 7z, tar, gz, and the common office document
     extensions: doc/docx, xls/xlsx, and ppt/pptx. Use application/pdf, text/markdown,
     text/plain, application/json, text/html, text/csv, application/xml, application/yaml,
     application/zip, application/x-7z-compressed, application/x-tar, application/gzip,
     application/msword, the Office Open XML wordprocessing MIME, application/vnd.ms-excel,
     the Office Open XML spreadsheet MIME, application/vnd.ms-powerpoint, and the Office Open
     XML presentation MIME respectively. Retain application/octet-stream only as the
     unknown-extension fallback. Because the existing __pipe route calls this function, the
     same improvement applies to host.streamUrl() consumers.
   - Add a transient resource registry to BoardEditorModel, keyed by an opaque ID. The registry
     owns { pipe, tabId, generation } (and any main-service registration handle), not persisted
     state. It must expose methods for openContentResource(link, tabId, generation), lookup/read by
     resource ID for the renderer handler, and release by frame/page.
   - openContentResource() must call pipeFromLink(link), obtain the logical size, derive
     contentType, register the resource route, and only then return the resource ID and metadata.
     Do not call ensureContentPath() and do not write contentCached or a cache file.
   - The initial implementation deliberately keeps size eager: content.open() does not resolve
     until size is known, because D12 names size as part of the result and pdf.js needs the
     resource length up front ([EPIC-113.md:405-425](../../epics/EPIC-113.md#L405-L425)).
     This means ContentPipe.stat() can buffer a transformed/non-stat-capable source, and a slow
     or stalled source can keep content.open() pending. Add an optional timeoutMs to
     content.open(link, options?) and thread an AbortSignal through the metadata/read path;
     when it expires, abort the operation, dispose any partially created pipe/resource, and
     reject the board request. With no timeout, the read follows D6 and may wait until the board
     releases it. Extend IContentPipe.stat() and IProvider.stat() options as needed so the
     signal reaches transformed reads and service-backed stat requests; do not hide the eager
     behavior behind an undocumented Promise race.
   - Reject invalid stat results (missing/non-finite/negative size) as correctness failures. The
     existing resolveTotalSize() checks usable provider sizes for direct streams
     ([board-pipe-handler.ts:98-137](../../../src/renderer/editors/board/board-pipe-handler.ts#L98-L137));
     follow that validation rather than trusting provider metadata.
   - Dispose every resource in dispose(), alongside current pipe and cache cleanup. Frame
     generation cleanup must happen before a replacement frame can use the same board host.

   Before:

       get pipeUrlEnabled(): boolean {
           return this.editorKind === "content-host" || this.editorKind === "stream-host";
       }

       async resolveStreamPipe(): Promise<IContentPipe> { ... }

   After:

       async openContentResource(
           link: string,
           tabId: string,
           generation: number,
           signal?: AbortSignal,
       ): Promise<ContentResourceInfo> { ... }
       getContentResource(resourceId: string): ContentResource | undefined { ... }
       releaseContentResources(tabId?: string, generation?: number): void { ... }

3. Generalize src/renderer/editors/board/board-pipe-handler.ts from page pipes to resource
   pipes without regressing page pipes.

   - Choose an explicit discriminator in the wire request: pipeKind: "page" | "resource", plus
     pipeId. Every continuation repeats the same kind and id; the renderer must never try a
     page lookup and then a resource lookup. Keep the existing page path for host.streamUrl()
     so content-host/stream-host behavior remains unchanged.
   - Generate every link-resource id as resource- plus crypto.randomUUID(). Resource URLs use the
     typed path board://<host>/__pipe/resource/<resourceId>; existing page URLs remain
     board://<host>/__pipe/<pageId>. Board page ids remain page-owned ids, and BoardPipeService
     keys the single owners map by the composite pipeKind + ":" + pipeId. The discriminator,
     typed URL path, and namespace key make a resource/page collision unable to select the wrong
     pipe; the prefixed UUID makes resource tokens opaque by construction.
   - For a link resource, look up the owning BoardEditorModel resource and use its pipe directly.
     Do not require board.pipeUrlEnabled for this path.
   - Keep the existing first-read/continuation range validation, 1 MiB clamp, provider-overrun
     check, content type, and AbortSignal flow. A link resource must have the same wire behavior
     as the existing __pipe route.
   - Add resource-specific invalidation that aborts matching PendingRead controllers and removes
     resource memos. It must be callable from BoardEditorModel/BoardWebview teardown.

   Before:

       const page = pages.findPage(request.pageId);
       const board = page?.mainEditorInstance as BoardEditorModel | null;
       if (!board || !board.pipeUrlEnabled) throw new Error("The board pipe page is unavailable.");
       const pipe = await board.resolveStreamPipe();

   After:

       const pipe = request.pipeKind === "resource"
           ? resolveBoardContentResource(request.pipeId)
           : await resolvePageStreamPipe(request.pipeId);
       if (!pipe) throw new Error("The board pipe resource is unavailable.");

4. Extend src/ipc/board-pipe-channels.ts, src/main/board-pipe-service.ts, and
   src/main/board-protocol-service.ts for resource IDs.

   - Change the read/continuation protocol to carry explicit pipeKind: "page" | "resource" and
     pipeId; do not retain a compatibility branch that guesses the namespace.
   - Keep BoardPipeService's single owners map, but key it by pipeKind + ":" + pipeId. Add a
     direct registerResource(resourceId, webContents, host) path that sets host immediately;
     never route resource registration through PagesModel.attachPage() or the page's second
     transferPort() registration.
   - When a resource is unregistered, reject its pending HTTP reads and send the existing cancel
     message to the renderer for each matching request that may still be executing. This is
     newly required resource teardown coverage; ordinary page teardown already calls
     invalidateBoardPipePage() on the renderer
     ([board-pipe-service.ts:86-98](../../../src/main/board-pipe-service.ts#L86-L98),
     [board-pipe-service.ts:155-180](../../../src/main/board-pipe-service.ts#L155-L180),
     [PagesModel.ts:112-121](../../../src/renderer/api/pages/PagesModel.ts#L112-L121)).
   - Update serveBoardPipe() to forward the neutral resource ID, retain all Range response headers
     and continuation validation, and keep malformed/oversized provider output as a 503 correctness
     error ([board-protocol-service.ts:286-402](../../../src/main/board-protocol-service.ts#L286-L402)).
   - Keep the URL route origin-local: board://<host>/__pipe/resource/<opaque-resource-id>. The
     protocol handler identifies the resource path and issues resource-kind reads; the existing
     board://<host>/__pipe/<pageId> token issues page-kind reads. Do not add an HTTP URL to this
     API in this task.

5. Add the board-frame request/reply surface in src/board-shim.ts,
   src/renderer/editors/board/BoardWebview.ts, and src/ipc/board-bridge-channels.ts.

   - Add content.open(link: string, options?: { timeoutMs?: number }): Promise<{ url: string;
     size: number; contentType: string }> namespace to the board shim and declaration file. It
     must queue/reject through the same
     handshake-safe host-frame request pattern used by filePathRpc() and openContentRpc()
     ([board-shim.ts:370-438](../../../src/board-shim.ts#L370-L438),
     [board-shim.ts:650-685](../../../src/board-shim.ts#L650-L685)).
   - Add a request discriminator and typed result message to board-bridge-channels.ts; validate
     that the link is a string before resolving it. The host-side request must carry the calling
     frame's identity through the existing onHostMessage source/origin gate and the current
     BoardWebview frame/generation checks.
   - Validate timeoutMs as an optional positive integer, create an AbortController for the
     metadata operation, and settle the board request with a readable timeout error when it
     expires. The controller must also release the resource if the pipe was created before
     stat/read metadata completed; a caller that omits timeoutMs gets the no-deadline behavior
     described in Concerns.
   - In BoardWebview, add a resolveContentOpen() handler beside resolveFilePath(). Re-check trust
     using the existing board trust helper, reject stale/non-current frames, call the model's
     resource-opening method, register the resource with BoardPipeService, and post
     { url, size, contentType } back to the same frame. The returned URL must use that board's
     host, not the host renderer's origin.
   - On frame reload/unmount, release resources owned by the old frame generation and unregister
     their main-side IDs. On board page close, rely on model final disposal as a second idempotent
     cleanup path. The resource registration must pass the host immediately, unlike the page
     registration sequence documented above.

   Before:

       interface PersephoneHostApi {
           streamUrl(): Promise<string>;
       }

   After:

       interface PersephoneContentOpenResult {
           readonly url: string;
           readonly size: number;
           readonly contentType: string;
       }

       interface PersephoneContentApi {
           open(link: string, options?: { timeoutMs?: number }): Promise<PersephoneContentOpenResult>;
       }

6. Keep provider/scheme ownership checks intact in src/renderer/content/registry.ts,
   src/renderer/content/scheme-registry.ts, and
   src/renderer/editors/board/custom-editor-registry.ts.

   - Do not add a new permission or allow-list branch to the content API.
   - Ensure that a provider descriptor used by content.open() reaches the provider registration
     owned by the board that declared the scheme. Existing registration records carry owner,
     refuse duplicate provider types, and clear all board-owned registrations during refresh
     ([registry.ts:229-265](../../../src/renderer/content/registry.ts#L229-L265)). Existing
     scheme registration rejects hard-reserved schemes and duplicate ownership
     ([scheme-registry.ts:140-176](../../../src/renderer/content/scheme-registry.ts#L140-L176)).
   - If the helper needs a new public resolver, have it call these existing registries rather
     than expose a board provider factory to the frame.

7. Update the public contracts in src/renderer/editors/board/board-api.d.ts and
   assets/guides/agents/boards.md.

   - Document that content.open(link) returns bytes through a URL and does not open a page.
   - Document supported link resolution as the built-in file/file-URL/archive/HTTP/HTTPS/data
     forms plus registered board schemes; document rejection for unsupported/unresolvable links.
   - State that the URL is origin-local, supports byte ranges, is intended for in-frame
     consumers, and is revoked when the calling board frame/page is torn down. State that an
     outstanding request is cancelled and may reject when that happens.
   - Document that size is eager: without timeoutMs, open may wait indefinitely for stat or a
     transformed read; callers that need an escape hatch pass timeoutMs, which aborts and
     disposes the pending resource.
   - Explain that content.open() is available to simple boards and is the migration path from
     getFilePath() for non-local sources; do not imply that host.streamUrl() changes.
   - State that this release does not return a 127.0.0.1 HTTP URL. US-1519 owns that
     external-player form.

8. Do not add unit tests. This repository has no unit-test suite for this subsystem. Verify
   through the existing build/lint/type checks and the running app/fixture workflow already used
   by EPIC-113; the acceptance criteria below are behavioral and lifecycle checks.

## Concerns

### HTTP URL recommendation

Ship only the board:// URL in US-1521. The requested API is a board-frame API and the
origin-local route already supplies Range, same-origin access, content length, and MIME metadata.
A 127.0.0.1 URL is a separate capability for processes outside Electron; it needs an HTTP session
owner, expiry/deletion semantics, page-close behavior, and the pipe source added to
video-stream-server.ts. Those are already the explicit concerns of US-1519 and D10. US-1519
should call a shared internal pipe/session seam, if needed, and return the HTTP URL only for the
media-player/VLC flow.

### Resource lifetime and outstanding reads

The resource owner is the calling board frame generation, nested under the board page/model.
Frame reload/unmount revokes that generation's resources; page close/model disposal revokes all
remaining resources. pipe.dispose() is called exactly once per resource. Unregistering a resource
must cancel main-side HTTP reads and renderer-side provider reads; late renderer replies must be
ignored by request identity and cancellation state. A resource must never be discoverable from a
different board host, even if a caller guesses its opaque ID.

### Range and metadata correctness

size must describe the logical post-transform resource, not a provider's raw source size. Direct
ranged providers can report size through stat() and read bounded ranges; transformed/non-ranged
pipes may buffer and remain subject to MAX_BUFFERED_PIPE_BYTES. Eager metadata means content.open()
can therefore buffer an archive/transformed resource or wait on a slow provider before returning;
timeoutMs is the documented escape hatch. Both renderer and main sides must retain range/length
checks. These are correctness/OOM protections, not permission gates, as required by D11.

### Scope boundaries

US-1521 does not migrate the published boards in persephone-boards, replace video-stream-server.ts,
implement US-1519's media session, add a torrent board, add permission gates, or add tests.
EPIC-113 explicitly lists published-board migration and replacement of the video server as
non-goals ([EPIC-113.md:86-104](../../epics/EPIC-113.md#L86-L104)).

## Acceptance Criteria

- A trusted simple board can call await persephone.content.open(link) for a local file, file URL,
  archive entry, HTTP/HTTPS URL, data URL, and registered board-scheme link. The result has a
  board://<host>/__pipe/resource/<opaque-id> URL, a finite non-negative size, and the same
  extension-derived contentType mapping used by the existing board pipe, expanded to cover at
  least PDF, Markdown, plain text, JSON, HTML, CSV, XML, YAML, ZIP, and common office/archive
  formats. The existing __pipe route returns the same expanded MIME values.
- The same API works when the link is unrelated to the file, if any, that opened the board. It
  does not require pipeUrlEnabled, editorKind, getFilePath(), or a materialized cache file.
- A registered provider is invoked through the provider type owned by the board that declared
  the scheme; duplicate or refused provider/scheme registrations cannot redirect one board's link
  to another board's provider.
- fetch(result.url, { headers: { Range: "bytes=..." } }) returns correct 206/416 behavior,
  Content-Range, Content-Length, Accept-Ranges, and Content-Type. A direct ranged provider
  receives only requested bounded chunks; a non-ranged provider follows the existing bounded
  buffered path.
- Renderer and main processes reject malformed ranges and provider replies that exceed the 1 MiB
  IPC chunk bound or the 256 MiB buffered bound. No permission prompt, path allow-list, or scheme
  restriction is introduced for trusted boards.
- Reloading/replacing the calling board frame revokes its resources. Closing the board page revokes
  all remaining resources and disposes each pipe. A URL from the disposed resource returns
  unavailable/not found, pending provider reads are aborted/cancelled, and no late read reply is
  delivered.
- A resource URL cannot be fetched through another board's board://<host> origin. A guessed or
  stale resource ID does not resolve after its owner is released.
- The request protocol carries an explicit page/resource discriminator and pipeId. Resource URLs
  use the typed /__pipe/resource/ path, resource ids use a resource- prefix plus
  crypto.randomUUID(), and main-side owner keys include the discriminator, so a resource id
  cannot select a page pipe.
- content.open() waits for eager size metadata; a supplied timeoutMs aborts a slow/stalled open,
  disposes its partial pipe/resource, and rejects the board request. With no timeout, the
  documented D6 behavior is to wait rather than apply an implicit platform deadline.
- The guide distinguishes content.open() (returns a URL for bytes) from openRawLink() (opens a
  page), explains lifetime/cancellation, and states that HTTP URLs for external consumers are
  deferred to US-1519.
- No unit tests are added, and no dashboard or epic tracking file is changed by this task document.

## Files Changed

| File | Planned change | Status |
|---|---|---|
| src/renderer/content/rebuild-pipe.ts | Canonical link-to-pipe resolution for built-in and registered schemes; source-path fallback delegates with its legacy unknown-scheme policy | Planned |
| src/renderer/editors/board/BoardEditorModel.ts | Transient per-frame content-resource ownership, metadata, registration, and cleanup | Planned |
| src/renderer/editors/board/BoardWebview.ts | content.open request/reply handling, trust/frame checks, URL construction, and teardown | Planned |
| src/renderer/editors/board/board-pipe-handler.ts | Read link resources by opaque ID; preserve page-pipe path; abort resource reads | Planned |
| src/renderer/content/ContentPipe.ts | Thread an optional abort signal through eager stat/read metadata resolution | Planned |
| src/renderer/api/types/io.pipe.d.ts | Type the optional signal accepted by IContentPipe.stat() | Planned |
| src/renderer/api/types/io.provider.d.ts | Type the optional signal accepted by provider stat() | Planned |
| src/renderer/content/providers/ProxyProvider.ts | Forward metadata cancellation to service-backed provider stat() | Planned |
| src/ipc/board-pipe-channels.ts | Neutral resource ID in read/cancel protocol | Planned |
| src/main/board-pipe-service.ts | Resource registration, host ownership, pending-read cancellation | Planned |
| src/main/board-protocol-service.ts | Route opaque resource IDs through the existing ranged __pipe response | Planned |
| src/board-shim.ts | Runtime persephone.content.open(link) method and request/reply plumbing | Planned |
| src/ipc/board-bridge-channels.ts | Typed board-frame content-open messages | Planned |
| src/renderer/editors/board/board-api.d.ts | Board-facing declaration for content.open() | Planned |
| assets/guides/agents/boards.md | User-facing API, supported links, lifetime, and HTTP deferral | Planned |
| src/renderer/content/registry.ts | No functional change; preserve provider owner checks | No change |
| src/renderer/content/scheme-registry.ts | No functional change; reuse scheme ownership and source-path resolution | No change |
| src/renderer/editors/board/custom-editor-registry.ts | No functional change; preserve scheme/provider registration and US-1517 phase behavior | No change |
| src/renderer/editors/board/board-manifest.ts | No new permission, provider, or scheme manifest field | No change |
| src/main/video-stream-server.ts | HTTP external-consumer form remains US-1519-owned | No change |
| src/renderer/editors/video/VideoEditor.ts and VideoView.ts | Media-player/VLC integration remains US-1519-owned | No change |
| persephone-boards/* | Published-board migration is an EPIC-113 non-goal | No change |
| doc/active-work.md and doc/epics/EPIC-113.md | Dashboard/epic tracking is explicitly user-owned for this task | No change |
