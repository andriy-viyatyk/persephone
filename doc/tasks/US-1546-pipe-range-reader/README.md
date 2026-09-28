# US-1546: One `__pipe` range reader in main; one MIME table

## Goal

Consolidate the duplicated board-pipe byte-range reader, video file-range response logic, and extension-to-MIME mapping while preserving range and stream behavior. Correct `.ogg` to `audio/ogg` and let board static files use the shared MIME values for extensions that previously fell back to `application/octet-stream`. Ensure video responses blocked on backpressure stop waiting if the client closes or the response errors.

## Background

US-1546 is Phase 3 (structure) in [EPIC-115](../../epics/EPIC-115.md). Its evidence points to duplicated pull loops in `src/main/board-protocol-service.ts` and `src/main/video-stream-server.ts`, hand-built file `Content-Range` headers, and three broad MIME tables. I verified the main paths in the current source; details below supersede the epic's old line references.

The protocol path currently reads its first reply before returning a `Response`, derives the requested range, handles 416 and empty resources, validates the first reply, and streams continuation reads from a `ReadableStream`. The video pipe path repeats those steps and writes chunks to `ServerResponse`. Both enforce the `MAX_BOARD_PIPE_CHUNK_BYTES` ceiling; continuation reads may return a shorter valid chunk, after which the next read begins at the returned end plus one. The paths differ today: protocol empty responses use `first.contentType` without fallback while video uses `first.contentType || "application/octet-stream"`; only video validates a safe nonnegative total size; their invalid-first-reply messages differ; and thrown 404s versus explicit `ok: false` replies produce different protocol bodies. The implementation plan records a unified policy for each difference.

`src/shared/range-utils.ts` already owns single-range parsing and `Content-Length` / `Content-Range` formatting. The ordinary file path and virtual faststart path both duplicate range resolution and response header construction instead of using the formatting helpers consistently.

### Verified MIME tables and disagreements

These are the extension-to-content-type tables found in `src/`:

| Current table | Purpose | Notable values / overlaps |
|---|---|---|
| `src/renderer/content/board-pipe-utils.ts` (`contentTypeForPipe`) | MIME for a logical content pipe, including archive entry/display name | Broad table: media, images, documents, text and archives. `.ogg` is `audio/ogg`; `.oga` `audio/ogg`; `.ogv` `video/ogg`. |
| `src/main/board-protocol-service.ts` (`boardMimeType`) | MIME for `board://` static files | Broad table, overlaps the pipe table for common web/media types; `.ogg` is `audio/ogg`, `.oga` `audio/ogg`, `.ogv` `video/ogg`. It also has a separate `UTF8_MIME_TYPES` policy that appends `charset=utf-8` for selected text types; that policy is not an extension table and must remain local to board document delivery. |
| `src/main/video-stream-server.ts` (`getContentTypeFromPath`) | MIME for local video and faststart file responses | Narrow table: `.ogg` is currently `video/ogg`; `.ogv` and `.oga` are absent and therefore octet-stream. `.mp4`, `.webm`, `.mkv`, `.m3u8`, `.ts` overlap other mappings. |
| `src/renderer/editors/image/ImageEditor.ts` (`extToMime`) | MIME for image editor data URLs | Image-only map for png/jpeg/gif/webp/bmp/ico/svg; defaults to `image/png`. |
| `src/renderer/editors/link-editor/pipe-image-src.ts` (`MIME_BY_EXT`) | MIME for archive image blob URLs | Same image-only values as `ImageEditor`; defaults to `image/png`. |
| `src/renderer/editors/board/board-file-icons.ts` (`BOARD_ICON_MIME`) | MIME for board icon data URLs | Narrow svg/png/ico map, used only for accepted board icons. |

`src/renderer/editors/browser/network-log-links.ts` and `src/board-context-menu.ts` map MIME values back to file extensions (the reverse direction), so they are not extension-to-content-type tables. `src/renderer/editors/rest-client/RestClientEditor.ts` maps body-language choices to request content types, not file extensions. These remain specialized mappings unless implementation discovery shows that they duplicate an actual extension lookup.

The broad tables disagree for `.ogg`: the video server labels it `video/ogg`, while the board protocol and pipe table label it `audio/ogg`. Choose `audio/ogg` by extension semantics: [RFC 5334](https://www.rfc-editor.org/rfc/rfc5334.html) registers `.oga`, `.ogg`, and `.spx` with `audio/ogg`, and `.ogv` with `video/ogg`. The shared table should add `.ogv` and `.oga` with those values; `.ogg` then corrects video-server file responses. This may affect a video editor opening a local file whose extension is `.ogg`: its response will identify as audio and Chromium may select audio playback behavior. A real content-based reason to override that extension mapping has not been identified; retain a call-site override only if source review during implementation establishes one.

The broad board-protocol table is also narrower than the pipe table. Pipe-only suffix mappings currently include `.pdf`, `.md`/`.markdown`, `.csv`, `.xml`, `.yaml`/`.yml`, `.zip`, `.7z`, `.tar`, `.gz`/`.gzip`, and legacy Office `.doc`/`.docx`/`.xls`/`.xlsx`/`.ppt`/`.pptx`; the board protocol currently returns `application/octet-stream` for these. The shared union will make board static-file responses use their declared MIME types. `boardContentType` currently adds `charset=utf-8` only for its `UTF8_MIME_TYPES`; add `.md`/`.markdown`, `.csv`, `.xml`, and `.yaml`/`.yml` MIME values to that set so newly typed text responses do not fall back to windows-1252. These are board-observable `Content-Type` changes and may affect how a board browser renders or handles these files. The image table adds `.bmp` (`image/bmp`), also currently octet-stream in the board protocol. The video server's current table defaults to octet-stream for the pipe table's audio suffixes (`.aac`, `.flac`, `.m4a`, `.mp3`, `.oga`, `.opus`, `.wav`), image suffixes (`.avif`, `.gif`, `.ico`, `.jpeg`, `.jpg`, `.png`, `.svg`, `.webp`, plus `.bmp` from the image map), text/document/archive/office suffixes listed above, and `.avi`/`.mov`; the shared table will type these paths. `contentTypeForPipe` also gains `.js`, `.mjs`, `.css`, `.map`, `.woff`, `.woff2`, `.ttf`, `.otf`, `.wasm`, and `.bmp` values, changing board-observable `__pipe` `Content-Type` from octet-stream for those names. The aligned overlap is: `.ogg` and `.oga` are `audio/ogg`, `.ogv` is `video/ogg`, with image MIME assignments matching where both tables define them. No other conflicting MIME values were found among the extension tables; the remaining differences are missing entries/default-to-octet-stream behavior.

## Implementation plan

1. **Add `src/shared/mime-types.ts`.** Export `mimeTypeForPath(name: string): string`. Strip query/hash suffixes, then use the extension after the final `.` in the final path segment; dotfiles follow `path.extname` semantics, so `.env` has no extension and returns `application/octet-stream`. Populate the union of the broad board-pipe and board-protocol tables plus video-specific and image-only entries, resolving `.ogg`/`.oga`/`.ogv` as described above. Migrate `contentTypeForPipe` while preserving archive-entry precedence (`archive` transformer's `entryPath`, then `displayName`, then provider `sourceUrl`).
2. **Add `src/main/board-pipe-range-reader.ts`.** Implement `readPipeRange(kind, id, host, rangeHeader, signal)` around `boardPipeService.read`. Return a discriminated response result with status, headers, and an async iterable of validated `Uint8Array` chunks for successful ranges; represent 416 and empty responses with an empty iterable. Validate `Number.isSafeInteger(totalSize) && totalSize >= 0` in the shared reader; invalid size throws typed status-503 `BoardPipeError` with message `The board pipe returned an invalid byte range.` Use that same typed error and exact message for malformed first replies and malformed continuation replies; each caller maps it through its own response path. On `ok: false`, throw `BoardPipeError(status, error)` for first and continuation replies, tagged with source `reply`; tag a rejection from `boardPipeService.read` with source `read`. Preserve the distinction between a thrown read 404 (protocol response body `Not found`) and an explicit `ok: false` 404 reply (protocol response body is the error text). Video maps either to status and message as today. Unified choices: empty non-range responses always use `first.contentType || "application/octet-stream"`; no Range yields 200; a valid explicit range yields 206 and exact `Content-Range`; invalid/unresolvable explicit ranges yield 416 with `bytes */<total>`; empty explicit ranges yield 416 with `bytes */0`. Validate first and continuation replies once, including total-size stability and contiguous returned ranges. The async iterator checks `signal.aborted` before every continuation read and ends silently on abort. Do not defer the initial read: status/headers must be known before returning the response.
3. **Adapt `src/main/board-protocol-service.ts`.** Replace its `serveBoardPipe` read/resolve/validate loop with the shared reader. Catch errors from the initial `readPipeRange` call and return a response using the typed error status/message. For a typed `BoardPipeError` from a rejected read with source `read` and status 404, use body `Not found`; for a typed error with source `reply`, use its message, preserving current behavior for an explicit failure reply. Adapt the chunk iterable with a pull-based `ReadableStream`: `pull()` calls `iterator.next()`, enqueues one chunk or closes on completion; on non-abort iterator errors, call `controller.error`; `cancel()` aborts the `AbortController` and calls `iterator.return()`. This adds actual stream backpressure; the current `start()` loop enqueues all chunks without waiting for demand. If the signal aborts, stop without `controller.error`. Preserve the unified empty-response MIME fallback.
4. **Adapt `src/main/video-stream-server.ts` pipe handling.** Replace `servePipeRequest`'s duplicated range resolution, reply validation, and continuation loop with `readPipeRange("page", pageId, undefined, rangeHeader, signal)`. Write the returned status and headers, then consume its chunk iterable through a backpressure-aware writer; always stop reads and settle cleanly when the client closes. Keep active request tracking and map typed `BoardPipeError`/invalid-range failures through the existing status/message error path. Remove now-unused pipe-specific range imports/constants and `validatePipeReply` if unused. Verify it uses the unified empty-response MIME fallback.
5. **Add the local `serveRange` helper in `src/main/video-stream-server.ts`.** Use this exact signature: `serveRange(res, rangeHeader, totalSize, contentType, writeRange: (range: ByteRange) => Promise<void>)`. Resolve an optional non-empty Range through `parseRangeHeader`; invalid ranges respond 416 with `Content-Range` only (the current file-path shape, no `Accept-Ranges`) and do not call `writeRange`. Valid ranges respond 206 with `Content-Type`, `Content-Range`, `Accept-Ranges`, and `Content-Length` from `contentRangeHeader` / `contentLength`, then await `writeRange(range)`. No Range responds 200 with full-file headers and, for a non-empty file, calls `writeRange({ start: 0, end: totalSize - 1 })`; when `totalSize === 0`, end with `Content-Length: 0` without calling `writeRange`. This empty-file/no-Range case has no bytes to stream; a non-empty no-Range request must write the full file. Refactor `handleFileRequest` and `handleFaststartRequest` through it: the first writes a ranged file stream, the second calls `streamVirtualRange`. Keep the helper local because it has only these two callers.
6. **Fix every response write lifetime in `src/main/video-stream-server.ts`.** Use `pipeline` from `node:stream/promises` for the ordinary `handleFileRequest` stream and in `pipeFileRange`, passing `{ end: false }` in the latter. This destroys the source stream (closing its file descriptor) and settles the promise on destination close/error. Treat `ERR_STREAM_PREMATURE_CLOSE` as a normal client disconnect; do not turn it into a 500 or destroy an already-closed response with an error. In `pipeFileRange`, resolve quietly when that premature-close error coincides with a closed/destroyed destination; reject other pipeline errors. Replace `streamVirtualRange`'s drain-only wait with a shared write helper that settles exactly once on `drain`, `close`, or `error`, removes its listeners, and stops the segment loop if the response closes. Apply the same close/error settlement to the board-pipe response writer. Do not call `res.end()` on a closed/destroyed response.
7. **Migrate the overlapping MIME lookups.** Replace `boardMimeType`, `getContentTypeFromPath`, and `contentTypeForPipe`'s switch with `mimeTypeForPath`. Migrate the image-only maps in `ImageEditor.ts`, `pipe-image-src.ts`, and `board-file-icons.ts` to the shared table; preserve unknown/non-image fallback as `image/png` in the first two (`sharedMime.startsWith("image/") ? sharedMime : "image/png"`) and retain the board icon svg/png/ico allowlist. `.ico` is already `image/x-icon` in ImageEditor, pipe image, board protocol, and board icon mappings; preserve that value everywhere. Keep board charset policy separate and add `text/markdown`, `text/csv`, `application/xml`, and `application/yaml` to `UTF8_MIME_TYPES`.
8. **Board contract/version decision.** Shared MIME changes are board-observable in both `board://` static-file responses and `__pipe` responses: previously octet-stream names now receive specific MIME values. Preserve range status/headers/body semantics as enumerated above. Bump `BOARD_BRIDGE_VERSION` in `src/shared/board-bridge-version.ts` from `1.22.0` to `1.23.0` for both sets of MIME changes. The local video `.ogg` correction also changes VideoEditor response MIME from `video/ogg` to `audio/ogg`.

Before → after shape:

```ts
// Before: each server owns its own read/validate/continue loop.
const first = await boardPipeService.read(host, kind, id, rangeHeader, undefined, signal);
// resolve range, validate, then repeat boardPipeService.read(...) for continuations

// After: one main-process owner returns headers and a validated chunk iterator.
const result = await readPipeRange(kind, id, host, rangeHeader, signal);
for await (const chunk of result.chunks) { /* Response stream or ServerResponse writer */ }
```

```ts
// Before: file handlers independently build Content-Range strings.
res.writeHead(206, { "Content-Range": `bytes ${start}-${end}/${totalSize}` });

// After: one range responder uses shared range-utils formatting.
await serveRange(res, rangeHeader, totalSize, contentType, (range) => writeRange(range));
```

## Concerns / Open questions

- **Version bump:** Required: bump `BOARD_BRIDGE_VERSION` from `1.22.0` to `1.23.0` because expanding the MIME union changes both `board://` static-file and `__pipe` `Content-Type` headers for suffixes that currently fall back to `application/octet-stream`. Board pipe `.ogg` is already `audio/ogg`; other new shared mappings still change pipe headers. Preserve range statuses and range headers.
- **RFC-backed `.ogg` choice:** Use `audio/ogg`; reserve `video/ogg` for `.ogv`. The user-visible effect may be audio handling for local `.ogg` files opened in VideoEditor. Keep an override only for an evidenced call site that knows the payload is video despite its extension.
- **Empty files:** `handleFileRequest` currently takes its whole-file path when no Range is present and can return `200`, `Content-Length: 0`; the shared helper must preserve it. An explicit Range on size zero is `416` with `bytes */0`. Faststart layout is normally only built for non-empty valid MP4 atom layouts, but helper behavior should still be safe for zero-size totals.
- **Backpressure errors:** `close` and `error` must settle a blocked write exactly once and remove listeners. If the destination closes during a faststart segment or file-range pipe, stop the segment walk and avoid attempting another write.
- **Scope of one MIME table:** The three broad tables are definite consolidation targets. Migrate the three image-only tables too to remove extension-value drift, while preserving their narrower behavior: ImageEditor and archive image pipe default to `image/png`; board icons accept only svg/png/ico. Reverse MIME-to-extension and request-body-language tables are not candidates for this lookup. Board static files and `__pipe` gain explicit MIME for several currently generic binary types, which is observable and is covered by the bridge bump.
- **Dashboard / epic tracking:** EPIC-115 is the applicable epic. The orchestrating agent is updating `doc/active-work.md` and the US-1546 row in `doc/epics/EPIC-115.md` alongside this task document.

## Acceptance criteria

- `readPipeRange(...)` in `src/main/` is the only owner of first-read/range resolution, 416/empty branches, pipe-reply validation, and bounded continuation reads for both board protocol `__pipe` requests and video-server board-pipe requests.
- `board-protocol-service.ts` wraps the common async iterable as a `ReadableStream`; `video-stream-server.ts` writes the same iterable with correct backpressure and cancellation behavior.
- `handleFileRequest` and `handleFaststartRequest` share `serveRange(...)` and use `src/shared/range-utils.ts` formatting helpers; their successful/416 response semantics remain correct.
- Every backpressure wait in `video-stream-server.ts` settles on drain, close, or error; closing a page mid-stream does not leave a pending drain promise or continued pipe reads.
- There is one general extension-to-MIME table in `src/shared/`; all previous extension mappings are accounted for, `.ogg` resolves to `audio/ogg`, `.oga` to `audio/ogg`, and `.ogv` to `video/ogg`. Any specialized exceptions and their reasons are recorded.
- Board-observable MIME header changes in `board://` and `__pipe` are documented and `BOARD_BRIDGE_VERSION` is bumped to `1.23.0`; the charset set includes newly typed markdown, CSV, XML, and YAML responses. Explicitly verify `__pipe` 206 exact `Content-Range`, 416, and empty-resource behavior.
- Live verification is recorded in the dedicated checklist below and every scenario is exercised twice.
- No implementation is included in this planning task; no unit-test work is part of this plan.

## Live verification

Run by Claude on 2026-09-28 against the dev build (full app restart after the main-process change),
driving Persephone over its MCP endpoint. Fixtures were synthetic or public only: small video/audio
samples from `node_modules/@videojs/vhs-utils/test/fixtures`, generated 200 MB zero-filled files,
an empty file, the repo's `assets/demo-board/stream-fixture.stream-demo`, and the Range Provider
Test board's generated `rangetest:` resources. Each item ran twice.

- [x] **Board `__pipe`, page route** (`rangetest://fixture/a.rangefix?size=3000000`): `bytes=0-63`,
  the last 64 bytes and `bytes=100-2500099` all returned 206 with the exact `Content-Range` and
  `Content-Length`. The 2.5 MB range spans three 1 MB continuation reads, and every byte matched the
  fixture formula. An out-of-range request returned 416 `bytes */3000000`, and the no-Range request
  returned 200 with all 3,000,000 bytes verified.
- [x] **Board `__pipe`, resource route** (`persephone.content.open`): the same results as the page route.
- [x] **Empty resource** (`size=0`, both routes): the no-Range request returned 200 with
  `Content-Length: 0` and `application/octet-stream`. `bytes=0-10` returned 416 `bytes */0`.
- [x] **Board-protocol cancellation:** reading 3 MB of a 300 MB resource and then aborting the fetch
  stopped the provider's `readRange` count at 4 (3 consumed plus 1 pulled ahead), and it stayed
  there. The next request returned 206.
- [x] **Stream-host demo** (`.stream-demo`, 140 bytes): `bytes=0-9`, `bytes=100-139` and
  `bytes=-5` returned 206 with exact ranges. `bytes=140-` returned 416, and the full fetch returned
  200 with 140 bytes.
- [x] **VideoEditor, local plain file** (`vp8.webm`): it played (readyState 4). Over curl, the
  no-Range request returned 200. `0-99`, `100-` and `-50` returned 206 with exact `Content-Range`
  values, and `999999-` returned 416 `bytes */1076`.
- [x] **Faststart path** (MP4 with moov at the end): it played (readyState 4). The virtual file
  starts `ftyp free moov`. A `bytes=30-1500` range is byte-identical to the same slice of the full
  virtual response, and an out-of-range request returned 416.
- [x] **Empty local file:** returned 200 with `Content-Length: 0`, and `bytes=0-` returned 416 `bytes */0`.
- [x] **`.ogg` is now `audio/ogg`:** a Theora+Vorbis `.ogg` still plays in VideoEditor (readyState 4).
- [x] **Video-server pipe path** (a VideoEditor page on `rangetest://fixture/v.mp4?size=300000000`,
  the same `servePipeRequest` route that torrent MP4s use): the first 64 bytes, the last 64 bytes
  and a 2.5 MB range returned 206 with exact `Content-Range` values and byte-verified data.
  `300000000-` returned 416.
- [x] **Closing the page mid-stream** (a rate-limited full download of the pipe session): the
  download ended as a partial transfer about 7 s after `closePage`, instead of running to curl's
  60 s timeout. The session then returned 404, and another session still returned 206.
- [x] **Aborted file streams:** 40 rate-limited downloads on the faststart and plain-file paths were
  aborted part-way. The main process handle count stayed flat (1205, then 1211, then 1209), so no
  file-stream handles leaked. A later 1 MB range request returned 206.
- [x] **Board static files:** `README.md` now returns `text/markdown; charset=utf-8`. `.js`, `.html`
  and `.json` keep their earlier types with `charset=utf-8`.

**Not verified:**
- A real `torrent://` MP4. The corporate proxy blocks the download of a public test torrent, and
  user files were off-limits. The route it uses (video-server pipe session to `readPipeRange("page")`)
  was tested with the synthetic provider above.
- A real song `.mp3` in a stream-host board. Only the `.stream-demo` fixture was tested.
- A backpressure `drain` wait on the faststart buffer segment that ends because the client closed.
  The moov buffer in the fixtures is too small to fill the socket, so this code ran but never had
  to wait.

## Implementation progress

- [x] Added the shared extension-to-MIME table and migrated the broad and image-only lookups.
- [x] Added the main-process board-pipe range reader and adapted both callers.
- [x] Shared local file range response handling and made stream writes close/error aware.
- [x] Bumped the bridge version to 1.23.0 and updated board version guides.
- [x] `npm run typecheck`, `npm run lint` and `node scripts/build-prod.mjs` pass (the build was re-run outside the Codex sandbox, where it had stopped with `spawn EPERM`).
- [x] Live verification: see above.

## Files that need no changes

- `src/shared/range-utils.ts`: its `parseRangeHeader`, `contentLength`, `contentRangeHeader`, and `unsatisfiableContentRangeHeader` functions already supply the needed behavior.
- `src/main/board-pipe-service.ts` and `src/ipc/board-pipe-channels.ts`: the read service and reply contract already support first reads, continuation ranges, cancellation, and both page/resource kinds.
- `src/renderer/editors/browser/network-log-links.ts` and `src/board-context-menu.ts`: these map MIME types back to extensions, not file extensions to content types.
- `src/renderer/editors/rest-client/RestClientEditor.ts`: `LANGUAGE_CONTENT_TYPES` maps request body language to request MIME and is not file-extension detection.

Tracking update: `doc/active-work.md` and `doc/epics/EPIC-115.md` are updated by the orchestrating agent.

## Files Changed

| File | Planned change |
|---|---|
| `doc/tasks/US-1546-pipe-range-reader/README.md` | This verified implementation plan. |
| `src/main/board-pipe-range-reader.ts` | New shared board-pipe range reader. |
| `src/main/board-protocol-service.ts` | Adapt `__pipe` responses to the reader and shared MIME lookup. |
| `src/main/video-stream-server.ts` | Adapt pipe reads, shared file-range responder, close/error-safe writes, shared MIME lookup. |
| `src/shared/mime-types.ts` | New shared extension-to-MIME mapping. |
| `src/shared/board-bridge-version.ts` | Bump from `1.22.0` to `1.23.0` for board-visible `board://` and `__pipe` MIME changes. |
| `src/renderer/content/board-pipe-utils.ts` | Use shared MIME lookup while preserving pipe name selection. |
| `src/renderer/editors/image/ImageEditor.ts` | Use shared image MIME lookup or document a concrete reason to retain a local mapping. |
| `src/renderer/editors/link-editor/pipe-image-src.ts` | Use shared image MIME lookup or document a concrete reason to retain a local mapping. |
| `src/renderer/editors/board/board-file-icons.ts` | Use shared MIME values while preserving its svg/png/ico allowlist. |
| `assets/guides/whats-new.md` | Record the 1.23.0 bridge MIME change in release history. |
| `assets/guides/boards.md` | Update current bridge version and document MIME/charset change. |
| `assets/guides/agents/boards.md` | Update current bridge version and document MIME/charset change. |
| `assets/board-template/CLAUDE.md` | Update current bridge version and document MIME/charset change. |
