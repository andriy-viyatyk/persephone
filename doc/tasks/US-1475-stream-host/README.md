# US-1475 — `editorKind: "stream-host"` and `board://<host>/__pipe/<pageId>` Range serving

Linked epic: [EPIC-107 — Open providers, ranged streaming and the stream-host](../../epics/EPIC-107.md)  
Status: Planned

`doc/active-work.md` and `doc/epics/EPIC-107.md` are intentionally unchanged. The user explicitly
forbids editing either file; EPIC-107 already contains the US-1475 row.

## Goal

Let a board whose page owns an `IContentPipe` obtain an origin-local
`board://<host>/__pipe/<pageId>` URL through `persephone.host.streamUrl()`. The `board://` protocol
will serve `Range` requests through the owning renderer, including seeking for audio/video/image
elements, without materializing the pipe or writing any file under `userData`.

This task consumes the `"stream-host"` value that US-1471 adds to `BoardEditorAssociation`; it does
not modify `src/renderer/editors/board/board-manifest.ts` or duplicate US-1471's manifest mirrors.

## Background

### Binding decisions from EPIC-107

This task implements the stream-host side of D4, D5, and D6:

- **D4:** main asks the owning renderer for pipe bytes over IPC. It does not pull directly from a
  service port. The direct main→service path is deferred to Phase E only if Phase E measures the
  renderer hop adding more than approximately 20 ms at the 95th percentile to a seek or stalling
  playback at the torrent board's achieved bitrate.
- **D5:** `stream-host` is a no-copy host. It has no text host, no `persephone.host.content`, no
  `CacheFileProvider` autosave pipe, and no `ensureContentPath()` materialization. Both non-local
  editor gates are lifted alongside `content-host`.
- **D6:** `persephone.host.streamUrl()` is available to both `stream-host` and `content-host` pages.
  `editorKind` controls the gate and caching behavior, not whether a platform-owned pipe can be
  addressed by URL.

The `__pipe` lifetime rule follows EPIC-106 D4's existing in-flight request reasoning: page close,
renderer destruction, and renderer shutdown must reject/settle pending pipe requests. This task adds
no second timeout or restart policy.

### Verified source findings

The following findings were checked against this checkout on 2026-09-20.

| Finding | Consequence |
|---|---|
| `src/main/board-protocol-service.ts:247` accepts only `url: string`; `initBoardProtocol()` at `:300-303` registers `ses.protocol.handle("board", (request) => serveBoardFile(request.url))`. | Change the handler and `serveBoardFile` signature to retain the `Request`, otherwise `request.headers.get("Range")` is unavailable. |
| `serveBoardFile()` builds ordinary file headers at `:271-273`, injects HTML at `:274-287`, and returns the existing non-HTML streaming `Response` body at `:289-293`. | The pipe branch can return a `Response` with a byte body using the same handler shape; HTML injection must remain untouched. |
| `BOARD_CSP` at `src/main/board-protocol-service.ts:65-83` already contains `media-src 'self' blob:` and `img-src 'self' data: blob:`. | No CSP change is needed: `board://<host>/__pipe/<pageId>` is same-origin `'self'`. |
| `src/main/video-stream-server.ts:605-630` has the complete `parseRangeHeader()` arithmetic; its file responses at `:187-221` implement 206/416/200, `Content-Range`, `Content-Length`, and `Accept-Ranges`. | Extract the range arithmetic into one shared helper and make both main consumers use it. Do not re-derive suffix, open-ended, clamp, or unsatisfiable behavior. |
| `IProvider.createReadStream?(range)` and `stat?()` are already declared at `src/renderer/api/types/io.provider.d.ts:41-52`; `FileProvider.ts:29-31` and `HttpProvider.ts:80-115` implement streaming, but `rg` finds no caller in `src/`. | Make the pipe the first consumer of the existing provider stream seam. Keep the provider declaration compatible; add the pipe-level contract needed by the protocol. |
| `IContentPipe` at `src/renderer/api/types/io.pipe.d.ts:24-60` has no stream or stat member. `ContentPipe.ts:62-69` currently reads through transformers as buffers. | Add a pipe-level ranged stream/stat contract and implement a safe transformer fallback. |
| `PipePair.setPrimary()` at `src/renderer/content/PipePair.ts:30-35` clones every primary into a `CacheFileProvider`; `TextFileIOModel` constructs that pair at `:25-27`, restores/creates it at `:205-230`, and writes it in `:335-361`. | A stream-host must never construct `TextFileModel`/`TextFileIOModel`; the base `BoardEditorModel` owns only the primary pipe and therefore cannot create the autosave cache. |
| `PagesLifecycleModel.buildEditorById()` checks only `match.editorKind === "content-host"` at `src/renderer/api/pages/PagesLifecycleModel.ts:144-163`; the other branch creates the base board model. | Keep `stream-host` on the base branch, with an explicit comment/guard documenting that this is intentional and no text host is adopted. |
| `BoardEditorModel.ensureContentPath()` at `src/renderer/editors/board/BoardEditorModel.ts:511-549` reconstructs a pipe when absent and writes the materialized cache at `:537-548`; its teardown removes `contentCached` at `:786-799`. | The stream-host handshake must not expose the `getFilePath()` materialization path, and the model must have a defensive stream-host guard so an accidental path request cannot write the cache. |
| `editor-switch-options.ts:84-86` filters non-local matches to `content-host`, and `:93` does the same for catalog matches. `custom-editor-registry.ts:260-266` independently skips non-local boards unless `content-host` or `editorSources: "any"`. | Add `stream-host` to all three conditions. Lifting only the switch filter would offer but never choose the board. |
| `BoardWebview.transferPort()` at `src/renderer/editors/board/BoardWebview.ts:260-286` sends `contentHost` and `materialize`, but no page id or stream capability. `model.page?.id` is already used in the same class at `:437-460`. | Extend the existing handshake with the page id and a pipe-URL capability flag; do not invent a second board↔main bridge. |
| `src/board-shim.ts:629-651` consumes the handshake and gates `host.*` after `whenHandshake()`. The existing `host` namespace begins at `:1074`; `providers` is a separate namespace and is owned by US-1473. | Add `streamUrl()` inside `host`, gate it on the new handshake flag, and leave the entire `providers` namespace untouched. |
| `assets/editor-types/io.pipe.d.ts` is the flat copy of the source declaration, and `_imports.txt:28-29` already lists both `io.pipe.d.ts` and `io.provider.d.ts`. | Keep the two `io.pipe.d.ts` files byte-identical after the change; verify the existing import lines and do not add duplicates or cross-folder imports. |

### Range and transformer decision

The pipe will gain `createReadStream(range?)` and `stat()` using the existing inclusive
`{ start, end }` range convention. The implementation is deliberately asymmetric:

1. With no transformers, `ContentPipe.createReadStream(range)` delegates to
   `provider.createReadStream(range)` when available. `stat()` delegates to `provider.stat()`;
   providers without `stat()` fall back to a buffer solely to discover the total size.
2. With one or more transformers, the pipe never streams raw provider bytes past the transformer
   chain. It reads the fully transformed buffer, obtains the logical post-transform size from that
   buffer, and slices the requested inclusive range into the returned stream/response. This is
   slower and may use more memory, but it is correct for archive entries, decryption, and any other
   buffer-in/buffer-out transformer.

The renderer pipe-read handler will use the transformed-buffer path as one request-scoped operation
so it does not report the raw provider size in `Content-Range`. The response sent to main always
includes the logical `totalSize` and the selected byte range. No transformed stream is ever treated
as if its source bytes were the final bytes.

## Implementation Plan

### 1. Extract and reuse the existing Range arithmetic

- Add `src/shared/range-utils.ts` with a dependency-free `ByteRange` type, the existing
  `parseRangeHeader(rangeHeader, totalSize)` body moved from
  `src/main/video-stream-server.ts:605-630`, and small shared header helpers for the inclusive
  `Content-Range`/`Content-Length` values and unsatisfiable `bytes */<total>` form.
- Preserve the current parser's behavior exactly: single `bytes=` ranges only, suffix ranges,
  open-ended ranges, end clamping, and `null` for malformed/empty/out-of-bounds ranges. The helper
  must not accept multipart ranges.
- Update `src/main/video-stream-server.ts` to import the helper and remove its private parser. Its
  existing file and virtual-layout responses must keep their current status/header behavior.

Before → after:

```ts
// Before: src/main/video-stream-server.ts
function parseRangeHeader(rangeHeader: string, totalSize: number): ByteRange | null {
    // private implementation at lines 605-630
}
```

```ts
// After: both main consumers use the same implementation
import { parseRangeHeader, type ByteRange } from "../shared/range-utils";

const range = parseRangeHeader(rangeHeader, totalSize);
```

### 2. Add a page-owner registry and one dedicated main↔renderer pipe request

- Add `src/ipc/board-pipe-channels.ts` for the narrow request/reply wire contract. The request
  carries a generated request id, `pageId`, the raw optional `Range` header for the first read, and
  an explicit bounded `{ start, end }` continuation range for later reads. The renderer reply carries
  either an error or `{ totalSize, range, data, contentType }`, where `data` is a structured-clone
  `Uint8Array` no larger than `MAX_BOARD_PIPE_CHUNK_BYTES`; it is one bounded pipe read response,
  not a general data channel.
- Add `src/shared/board-pipe-constants.ts` with the named `MAX_BOARD_PIPE_CHUNK_BYTES` cap (1 MiB)
  shared by the main broker and renderer handler. A single IPC reply must never exceed this cap.
  `boardPipeService` performs the first bounded read, then issues successive bounded continuation
  reads and writes those chunks progressively into the protocol `ReadableStream`, including for a
  no-`Range` request; it must not allocate or clone the complete resource in one message.
- Add `registerBoardPipePage` and `unregisterBoardPipePage` endpoint values and typed API methods in
  `src/ipc/api-types.ts` and `src/ipc/renderer/api.ts`. Register the main handlers from a dedicated
  `src/ipc/main/board-pipe-handlers.ts`, composed by `src/ipc/main/controller.ts`.
- Add `src/main/board-pipe-service.ts` as the main owner map and request broker:
  - map each live `pageId` to the registering renderer `WebContents` and its owning `board://` host;
  - on a read request, require the URL host to match the page's registered board host, then find
    that owner and send the dedicated channel to it;
  - match exactly one reply by request id;
  - reject immediately with a non-disclosing 404 when no owner exists or the host does not match;
    reject with a settled provider error when `unregisterBoardPipePage(pageId)` runs or the owner
    `WebContents` is destroyed;
  - remove all mappings for a destroyed renderer and reject all its pending requests.
- The renderer-side page registration is split across lifecycle and board-frame knowledge:
  `PagesModel.attachPage()` registers the renderer owner, while `BoardWebview` binds the page id to
  the stable host during `transferPort()`/frame setup. `PagesModel.detachPage()` clears both. This
  keeps the check at host level: the main board frame and secondary-view frames use the same host,
  as established by `board-protocol-service.ts:44-49`.
- Do not use the board frame's MessagePort or the module-service port for this request. The board
  frame only asks its host renderer for the URL; main routes the protocol request to the renderer
  that owns the page model.
- Register ownership in `src/renderer/api/pages/PagesModel.ts` from `attachPage()` and unregister
  from `detachPage()`. This covers startup restore, normal close, cross-window move-out/move-in,
  and duplicate-page transfer. A renderer teardown is still handled by the main `WebContents`
  cleanup because a closing window may not run renderer page disposal.
- Add `src/renderer/editors/board/board-pipe-handler.ts` and initialize it from
  `src/renderer/api/app.ts` during `initEvents()`. The handler resolves the page by id, then chooses
  the platform-owned pipe in this order: the page's text host pipe (for `content-host`), otherwise
  the main board editor's existing direct pipe (for `stream-host`). On first open that direct pipe
  is already live and is used as-is; only a restored stream-host model with no direct pipe uses the
  dedicated lazy pipe resolver from `BoardEditorModel`. Never call `ensureContentPath()`.
- Settle renderer-side pending reads when the page closes or the renderer is shutting down. A page
  close must not leave the main protocol response waiting for a pipe that can no longer answer.

### 3. Add the pipe-level ranged read and logical size contract

- Extend `src/renderer/api/types/io.pipe.d.ts` with `createReadStream(range?)` and `stat()`, using
  the existing provider range shape and `IProviderStat`. Keep the public `IProvider` declaration in
  `src/renderer/api/types/io.provider.d.ts` unchanged unless implementation discovers that the
  shared range type must be named there; if it changes, mirror it byte-for-byte as required below.
- Implement both members in `src/renderer/content/ContentPipe.ts` according to the transformer
  decision above. A missing provider stream must degrade to a buffer-backed stream; it must not
  throw merely because a provider is read-only or has no optional stream implementation.
- In `src/renderer/editors/board/board-pipe-handler.ts`, use `parseRangeHeader` from the shared
  helper after obtaining the logical size. For a transformer-free pipe, use the provider-backed
  ranged stream and collect at most `MAX_BOARD_PIPE_CHUNK_BYTES` for each IPC reply. For a
  transformed pipe, memoize the fully transformed logical buffer and its `totalSize` per page pipe
  for that pipe's lifetime, then return only the requested bounded slice. The memo is in memory,
  not a disk copy. Invalidate it when the page closes and whenever the resolved pipe identity is
  replaced; a new pipe gets a new memo. For an invalid range, return the total size and no data so
  main can produce 416 without reading bytes.
- Add `MAX_BUFFERED_PIPE_BYTES` (256 MiB) beside the IPC chunk cap in
  `src/shared/board-pipe-constants.ts`. If a transformed logical resource exceeds that cap, do not
  attempt an unbounded allocation or raw-byte stream; fail the pipe request with a settled 503
  provider error. Transformer-free pipes with a working `stat()` remain streamable in bounded
  chunks regardless of total size. A provider without `stat()` performs one buffered logical read
  within this cap, memoizes both its bytes and resolved `totalSize` per page pipe, and uses that memo
  for every later range request; it must not re-read solely for size discovery.
- Make the `src/renderer/api/types/io.pipe.d.ts` change byte-identically in
  `assets/editor-types/io.pipe.d.ts`. Verify that `assets/editor-types/_imports.txt` still has its
  existing single `io.pipe.d.ts` and `io.provider.d.ts` entries; do not import source paths into the
  flat IntelliSense directory.

Before → after:

```ts
// Before: IContentPipe has readBinary/readText but no ranged or metadata member.
readBinary(): Promise<Buffer>;
```

```ts
// After: source and flat editor declarations match exactly.
readBinary(): Promise<Buffer>;
createReadStream(range?: { start: number; end: number }): NodeJS.ReadableStream;
stat(): Promise<IProviderStat>;
```

### 4. Serve `__pipe` from the `board://` protocol

- Change `serveBoardFile(url: string)` to accept the Electron `Request`, and change
  `initBoardProtocol()` from `serveBoardFile(request.url)` to `serveBoardFile(request)`.
- Parse the URL before the normal board-file path branch. A path matching `/__pipe/<pageId>` is
  decoded as a page id and routed to
  `boardPipeService.read(request.url.host, pageId, request.headers.get("Range"))`; the service
  checks the host-level ownership binding before contacting a renderer.
  It must not resolve that path under the board root and must not call `net.fetch()`.
- For a valid range, return 206 with the shared helper's `Content-Range`, the exact inclusive
  `Content-Length`, `Accept-Ranges: bytes`, and the renderer-provided/inferred content type.
- For an unsatisfiable or malformed range, return 416 with `Content-Range: bytes */<totalSize>` and
  `Accept-Ranges: bytes`, with no body. For no `Range` header, return 200 with the complete body,
  `Content-Length`, and `Accept-Ranges: bytes`, but obtain and write that body as successive
  `MAX_BOARD_PIPE_CHUNK_BYTES` chunks through the existing streaming `Response` body; never make
  the complete body one IPC reply or one eagerly cloned allocation.
- Convert missing page ownership/page closure/provider failure into a settled error response (404
  for a page that is gone, 503 for a live page whose provider is unavailable). Do not let a rejected
  renderer promise escape as an indefinitely pending protocol response. Use `errMessage` if a
  caught value is surfaced in a message.
- Keep the current HTML branch and the existing non-HTML streaming response unchanged. Keep
  `BOARD_CSP` unchanged and record the reason in the implementation comment: `media-src 'self'
  blob:` and `img-src 'self' data: blob:` already admit the same-origin `__pipe` URL.
- Infer a useful content type from the pipe display/source name for common audio/video/image
  extensions by extending the existing `boardMimeType()` mapping as needed; default to
  `application/octet-stream`. This does not add a disk copy or a service metadata dependency.

Before → after:

```ts
// Before: request headers are discarded.
ses.protocol.handle("board", (request) => serveBoardFile(request.url));
```

```ts
// After: the handler can see Range and route the virtual pipe path.
ses.protocol.handle("board", (request) => serveBoardFile(request));
```

### 5. Expose `persephone.host.streamUrl()` and preserve restore ordering

- Extend `BoardPortInitMsg` in `src/ipc/board-bridge-channels.ts` with `pageId` and a
  `pipeUrlEnabled` flag. `BoardWebview.transferPort()` sends the current page id and sets the flag
  for `content-host` or `stream-host`; plain/simple boards receive `false`. Keep `contentHost` as
  the separate content API gate.
- Add `streamUrl(): Promise<string>` to the `host` namespace in `src/board-shim.ts` and the
  corresponding `PersephoneBoardApi.host` declaration in
  `src/renderer/editors/board/board-api.d.ts`.
- `streamUrl()` awaits `whenHandshake()`, rejects on a plain/simple board, rejects if the page id is
  absent, and otherwise returns `new URL(`/__pipe/${encodeURIComponent(pageId)}`, location.origin)
  .toString()`. It must be valid for both stream-host and content-host boards and must not call
  `getFilePath()`, `filePathRpc()`, or any cache path.
- Leave the shim's `providers` namespace byte-for-byte untouched; US-1473 owns it.
- Pick the lazy answerability option for the restore race. The URL is answerable immediately, while
  the renderer read handler waits for `BoardEditorModel`'s live pipe/provider to resolve. A restored
  descriptor is reconstructed from its persisted `sourceLink.pipeDescriptor` (or the existing path
  fallback for a switch-created model) by the stream-only lazy resolver. If the page closes during
  that await, the page-owner registry rejects the main request and the renderer drops its pending
  read. No readiness event is required in the board API, and no new timeout policy is introduced.

### 6. Make `stream-host` a no-text-host, no-copy editor kind

- In `src/renderer/api/pages/PagesLifecycleModel.ts`, leave the `content-host` construction branch
  at the verified `:147-158` seam and explicitly keep `stream-host` in the base
  `BoardEditorModel` branch. Do not call `newTextFileModel()` or `adoptHost()` for it.
- In `src/renderer/editors/board/BoardEditorModel.ts`, add a small association-backed
  `editorKind`/stream-pipe capability accessor and a lazy stream-pipe resolver. It may reconstruct
  the persisted pipe descriptor, but it must never invoke `ensureContentPath()` or write
  `contentPath`/`contentCached`. Add a defensive rejection at the start of `ensureContentPath()` for
  `stream-host` so a future caller cannot silently reintroduce materialization.
- Do not modify `PipePair.ts`, `TextFileIOModel.ts`, or `CacheFileProvider.ts` to create a special
  cache exception. Their current dual-pipe behavior remains correct for ordinary text hosts; the
  stream-host path avoids those classes entirely.
- Update the non-local offer gates in `src/renderer/editors/base/editor-switch-options.ts`:
  - `:84-86`: include `stream-host` in `boardMatches` for non-local sources;
  - `:93`: include `stream-host` in `catalogMatches` for non-local sources.
- Update the independent open/resolve gate in `src/renderer/editors/board/custom-editor-registry.ts:266`
  to continue only when the board is `content-host`, `stream-host`, or declares
  `editorSources: "any"`.

Before → after:

```ts
// Before: offered/opened only for content-host (or copy-based editorSources:any).
const boardMatches = local
    ? boardMatchesAll
    : boardMatchesAll.filter((board) => board.editorKind === "content-host");

if (!local && b.editorKind !== "content-host" && b.editorSources !== "any") continue;
```

```ts
// After: stream-host is the no-copy non-local alternative.
const boardMatches = local
    ? boardMatchesAll
    : boardMatchesAll.filter(
        (board) => board.editorKind === "content-host" || board.editorKind === "stream-host",
    );

if (
    !local
    && b.editorKind !== "content-host"
    && b.editorKind !== "stream-host"
    && b.editorSources !== "any"
) continue;
```

### 7. Verify without unit tests or a test harness

This project does not use unit tests or test harnesses, and none will be added. Verification is
manual/live, matching EPIC-107 D10:

- Open a trusted stream-host board on a local `.mp3`/`.mp4`/image and confirm
  `persephone.host.streamUrl()` returns `board://<host>/__pipe/<pageId>`.
- Observe a no-Range request as 200 with `Accept-Ranges: bytes`, a middle/suffix/open-ended
  request as 206 with exact `Content-Range` and `Content-Length`, seeking as a new range, and an
  unsatisfiable request as 416 with `bytes */<totalSize>`.
- Verify a no-Range multi-megabyte resource is delivered as multiple bounded IPC/protocol chunks,
  and that repeated seeks on a transformed pipe reuse its per-pipe in-memory memo rather than
  re-reading the provider.
- Restore the page and arrange for the first media request to arrive before the provider resolves;
  confirm the same URL succeeds once the pipe is live. Close the page during a pending read and
  confirm the protocol request settles instead of hanging.
- Watch `<userData>` during playback and confirm neither `cache/<pageId>.txt` nor
  `<cache>/<editorId>/<basename>` is created. Confirm no `CacheFileProvider` is present on the
  stream-host path and that `ensureContentPath()` was not invoked.
- Confirm `content-host` can call `host.streamUrl()` while retaining `host.getContent()` behavior;
  confirm a plain/simple board rejects `host.streamUrl()`.
- Confirm a non-local stream-host appears in the switch list and wins the open resolution, while a
  simple board with neither `editorSources: "any"` nor `stream-host` remains excluded.
- Run `npm run typecheck`, `npm run lint`, and `npm run build-prod`. Do not add or run unit tests.

## Concerns / Open questions

All task-level questions are resolved below; these are implementation hazards to preserve in review.

### Resolved decisions

- **Shared Range helper:** `src/shared/range-utils.ts`, consumed by
  `src/main/video-stream-server.ts`, `src/main/board-protocol-service.ts`, and the renderer pipe
  handler. This keeps the existing parser and inclusive arithmetic in one dependency-free module.
- **Main→renderer ownership:** `PagesModel.attachPage()` registers `pageId → WebContents` through
  typed IPC; `detachPage()` unregisters it. `src/main/board-pipe-service.ts` owns the map and the
  pending-reply settlement. Registration also binds the page id to its stable `board://` host, and
  the protocol passes its request host into `read()`. A host mismatch is refused as a non-disclosing
  404, so `__pipe` is not a general cross-board page-id oracle. This is lifecycle hygiene, not a
  new trust boundary: EPIC-106 D1 already records that trusted board code has arbitrary bridge
  access through `persephone.execute()`/`persephone.call`, so this task does not claim to establish
  isolation against a trusted board; it preserves host scoping if that trust model tightens later.
- **Streaming vs transformers:** transformer-free pipes delegate the existing provider range stream
  in bounded chunks; any transformer uses one memoized fully transformed buffer per page pipe and
  slices it. The memo is in memory only, is invalidated on close or pipe replacement, and is capped
  by `MAX_BUFFERED_PIPE_BYTES`; above the cap the request settles with 503. Raw
  archive/encrypted bytes are never sent as final media bytes. Logical size, not provider/source
  size, is used in `Content-Range`.
- **Restore ordering:** lazy URL answerability. Main/renderer wait for the live pipe on the first
  request; page/renderer close rejects it. There is no separate board “ready” event and no second
  timeout policy.
- **Direct service pull:** explicitly deferred under EPIC-107 D4. The renderer path is the only
  implementation in this task.
- **First open versus restore:** the first-open handler already hands `BoardEditorModel` a live
  `this.pipe`; the handler uses that pipe as-is and retains it until teardown. It must not rebuild
  from a descriptor while a live pipe exists, because that would discard transient provider state,
  including a future US-1473 `ProxyProvider` binding. Descriptor reconstruction is only for a
  restored stream-host page whose `this.pipe` is absent; that is the lazy resolver used during the
  restore race.

### Remaining hazards

- A provider can disappear or change size between `stat()` and a ranged read. The renderer response
  must report the logical size used for its selected bytes, and main must build headers from that
  response rather than from a stale board-file path.
- Electron structured clone transfers bytes but not Node streams. The dedicated pipe request sends
  only bounded chunks; this is an in-memory transport choice, not a disk cache and not the general
  Phase-D data channel. If Phase E's measured seek latency triggers
  D4's threshold, direct main→service transport becomes a later task.
- A board can manually construct another page's `__pipe` URL after learning a page id. This does
  not create a new trust boundary—trusted board code already has arbitrary bridge access—but the
  handler must still require a live registered page owner and pipe, and must never interpret the id
  as a filesystem path.
- The lifecycle check also compares the request's `board://` host with the page owner's registered
  host and refuses a mismatch without revealing whether the other page exists; secondary frames
  remain valid because they resolve to the same host as their board's main frame.
- The `stream-host` type is supplied by US-1471. If that dependency is not landed, stop rather than
  widening `board-manifest.ts` or its mirrors in this task.
- If a caught IPC/provider value is surfaced, use `errMessage`; use `guard` only for handlers whose
  entire behavior is “toast and carry on”. Renderer editor imports remain dynamic where they are
  editor construction code, and all renderer path operations continue through `file-path`.

## Acceptance Criteria

- [ ] `board://` protocol registration retains the `Request` and routes exactly
      `/__pipe/<pageId>` to the pipe service without `net.fetch()` or filesystem materialization.
- [ ] Valid ranges return 206 with correct inclusive `Content-Range`, exact `Content-Length`, and
      `Accept-Ranges: bytes`; malformed/out-of-bounds ranges return 416 with
      `Content-Range: bytes */<totalSize>`; no Range returns 200 with `Accept-Ranges: bytes` and
      `Content-Length`.
- [ ] The extracted helper is used by `video-stream-server.ts` and the board protocol; suffix,
      open-ended, clamped, malformed, and unsatisfiable cases retain existing semantics.
- [ ] Main reaches the renderer that owns `pageId`, and page close, renderer destruction, and
      shutdown settle all pending pipe responses.
- [ ] Every mainâ†”renderer reply is bounded by `MAX_BOARD_PIPE_CHUNK_BYTES`; no-Range responses
      are progressively streamed through the protocol body, including for arbitrarily large
      transformer-free resources.
- [ ] A transformer-free pipe uses the existing provider ranged stream; a transformed pipe uses a
      memoized, capped in-memory logical-buffer fallback and never streams raw bytes past a
      transformer; close and pipe replacement invalidate the memo.
- [ ] Total size in `Content-Range` is obtained from provider `stat()` for the direct path or from
      the transformed logical buffer for the fallback, never from a raw source size when it differs.
- [ ] `persephone.host.streamUrl()` is typed and available on both stream-host and content-host
      pages, rejects on simple/plain boards, and does not touch the `providers` namespace.
- [ ] Restored stream-host pages can answer their first media request lazily while the pipe resolves;
      a close during that wait settles the request.
- [ ] A `__pipe` request must match the registered page owner to the requesting `board://` host;
      a mismatch is refused without revealing another page's existence. First-open pages use their
      already-live `this.pipe`; only restored pages without one reconstruct from a descriptor.
- [ ] Stream-host construction creates no `TextFileModel`, `TextFileIOModel`, `PipePair`, or
      `CacheFileProvider`; `ensureContentPath()` is not used and no cache path is written.
- [ ] Both offer gates (`editor-switch-options.ts:84-86` and `:93`) and the independent open gate
      (`custom-editor-registry.ts:266`) admit `stream-host` for non-local sources.
- [ ] `BOARD_CSP` remains unchanged and same-origin `media-src 'self'`/`img-src 'self'` permits the
      URL.
- [ ] Source and flat editor declarations remain byte-identical, `_imports.txt` contains one entry
      for each changed declaration, and no forbidden file is edited.
- [ ] `npm run typecheck`, `npm run lint`, and `npm run build-prod` pass; no unit tests or harnesses
      are added.

## Files Changed Summary

| File | Planned change |
|---|---|
| `src/shared/range-utils.ts` | New shared byte-range parser/header arithmetic. |
| `src/shared/board-pipe-constants.ts` | Shared IPC chunk cap and buffered-fallback cap. |
| `src/main/video-stream-server.ts` | Consume the shared Range helper. |
| `src/main/board-protocol-service.ts` | Retain `Request`; add the `__pipe` 200/206/416 branch and MIME handling. |
| `src/main/board-pipe-service.ts` | New page-owner map, renderer request broker, and in-flight settlement. |
| `src/ipc/board-pipe-channels.ts` | New narrow pipe request/reply wire types/channels. |
| `src/ipc/api-types.ts` | Typed page-owner registration endpoints. |
| `src/ipc/main/board-pipe-handlers.ts` | Register the page-owner IPC endpoints. |
| `src/ipc/main/controller.ts` | Compose the new main IPC registrar. |
| `src/ipc/renderer/api.ts` | Expose page-owner registration calls. |
| `src/renderer/api/app.ts` | Initialize the renderer-side pipe request handler. |
| `src/renderer/api/pages/PagesModel.ts` | Register/unregister live page ownership. |
| `src/renderer/editors/board/board-pipe-handler.ts` | New renderer-side pipe resolution/read handler. |
| `src/renderer/content/ContentPipe.ts` | Implement pipe stream/stat behavior and transformer fallback. |
| `src/renderer/api/types/io.pipe.d.ts` | Add pipe ranged stream/stat declarations. |
| `assets/editor-types/io.pipe.d.ts` | Byte-identical IntelliSense mirror. |
| `src/ipc/board-bridge-channels.ts` | Add page id and stream capability to the board handshake. |
| `src/renderer/editors/board/BoardWebview.ts` | Send the page id/capability and suppress file-path materialization for stream-host. |
| `src/renderer/editors/board/BoardEditorModel.ts` | Stream-host kind accessor, lazy pipe resolver, and materialization defense. |
| `src/renderer/api/pages/PagesLifecycleModel.ts` | Keep stream-host on the no-text-host construction path. |
| `src/renderer/editors/base/editor-switch-options.ts` | Admit stream-host in both non-local offer filters. |
| `src/renderer/editors/board/custom-editor-registry.ts` | Admit stream-host in the independent open gate. |
| `src/board-shim.ts` | Add `persephone.host.streamUrl()`; do not touch `providers`. |
| `src/renderer/editors/board/board-api.d.ts` | Type `host.streamUrl()`. |
| `assets/editor-types/_imports.txt` | No content change expected; verify existing `io.pipe.d.ts`/`io.provider.d.ts` entries. |

### Files explicitly requiring no changes

| File/area | Reason |
|---|---|
| `src/renderer/editors/board/board-manifest.ts` and its ~12 US-1471 mirrors | Owned by US-1471; the task assumes `stream-host` is already parsed and propagated. |
| `src/renderer/api/types/io.provider.d.ts` and `assets/editor-types/io.provider.d.ts` | Existing optional `createReadStream(range)` and `stat()` contracts are sufficient; change only if the final shared type requires it, then mirror byte-identically. |
| `src/renderer/content/PipePair.ts`, `TextFileIOModel.ts`, and `CacheFileProvider.ts` | Their dual-pipe autosave behavior remains for text hosts; stream-host avoids the text-host construction path. |
| `src/board-shim.ts` `providers` namespace | Owned by US-1473; only the `host` namespace may change here. |
| `doc/active-work.md` and `doc/epics/EPIC-107.md` | Explicitly forbidden by the user; the epic already links this task. |
| Unit tests and test harnesses | Explicitly forbidden; verification is live plus project build checks. |
