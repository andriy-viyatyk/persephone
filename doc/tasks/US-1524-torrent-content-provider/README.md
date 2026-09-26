# US-1524: The torrent content provider

**Status:** Planned

**Epic:** [EPIC-114: The torrent board — a module contributes below the UI](../../epics/EPIC-114.md)

**Scope:** Investigation and implementation plan only. No implementation is included in this document.

## Goal

Extend `C:/projects/persephone-boards/boards/torrent-viewer/scripts/service.mjs` with the
`torrent/viewer` provider promised by the existing manifest. A self-contained `torrent://` link
must resolve its torrent on demand and serve metadata, bounded byte ranges, and whole-file bytes
to Persephone's own editors and media players without turning the board into a downloader.

The provider must preserve EPIC-114 D1 and D5: metadata may establish the torrent, but payload
bytes are selected only for an active read; the persisted link itself must contain enough
information to restore a cold page without the torrent board being open.

## Background

### Binding decisions and shipped starting point

EPIC-114 D1–D11 are binding. This plan does not reopen them. The load-bearing decisions for this
task are:

- D1: the service adds torrents with `deselect: true`; metadata resolution alone must not download
  payload bytes. The epic Notes record why `file.deselect()` after metadata is insufficient: WebTorrent
  creates a torrent-level whole-range selection unless `deselect: true` is passed at add time
  ([`EPIC-114.md:358-373`](../../epics/EPIC-114.md:358)).
- D2/D3: use the already-vendored WebTorrent 3.0.21 and `MemoryChunkStore` class from
  `lib/webtorrent.bundle.mjs`; do not add a second dependency or disk store.
- D4: port the `file.createReadStream({ start, end })` idea, not av-player's HTTP server or protocol
  handler. The provider returns a buffered `Uint8Array` for one bounded operation.
- D5: persist the magnet in every new link, because a bare infohash cannot re-add a torrent on a
  cold start ([`EPIC-114.md:152-170`](../../epics/EPIC-114.md:152)).
- D6: accept the unbounded-memory risk of `memory-chunk-store`; measure it at epic acceptance and
  do not design an eviction store in this task ([`EPIC-114.md:172-180`](../../epics/EPIC-114.md:172)).
- D8/D9: metadata resolution has its existing 30-second bound; provider `stat`, `readRange`, and
  `readBinary` have no platform deadline and are released by cancellation; reads own piece
  prioritisation.

The shipped board is not a placeholder to replace. Its manifest already declares the stable,
persisted provider type and scheme:

```json
// C:/projects/persephone-boards/boards/torrent-viewer/board-manifest.json:10-13
"permissions": ["service", "contentProviders"],
"service": "scripts/service.mjs",
"contentProviders": [{ "type": "torrent/viewer", "schemes": ["torrent"] }]
```

The service already has the parent-port handshake, lazy WebTorrent import, `MemoryChunkStore`,
case-insensitive `findTorrentByInfoHash`, canonical forward-slash metadata paths, bounded
resolution jobs, no-poll cancellation, remove, and shutdown. In particular,
`startResolver()` uses the existing torrent when its infohash is known, otherwise calls
`client.add(..., { store: MemoryChunkStore, deselect: true })`
([`service.mjs:1-4`](../../../persephone-boards/boards/torrent-viewer/scripts/service.mjs:1),
[`service.mjs:205-239`](../../../persephone-boards/boards/torrent-viewer/scripts/service.mjs:205)).
The provider should be added to this service (or a service-local module it imports), not implemented
as a second client or as a renderer-side torrent connection.

US-1523's task document is [`US-1523-torrent-board-skeleton/README.md`](../US-1523-torrent-board-skeleton/README.md).
The board-repository implementation record is named `BT-025-torrent-viewer-skeleton`; it confirms
that the provider was intentionally left absent and that the manifest declaration is the forward
contract ([`US-1523:76-90`](../US-1523-torrent-board-skeleton/README.md:76)).

### Provider contract and the full URL in `config.url`

The reference implementation registers from the module service with
`globalThis.persephone.providers.register(type, implementation)` and parses the full link from
`config.url` ([`range-provider-test/scripts/service.mjs:97-107`](../../../persephone-boards/_test/range-provider-test/scripts/service.mjs:97),
[`range-provider-test/scripts/service.mjs:154-181`](../../../persephone-boards/_test/range-provider-test/scripts/service.mjs:154)).
The board scheme resolver constructs the descriptor as
`{ provider: { type: providerType, config: { url: data.url } }, transformers: [] }`
([`custom-editor-registry.ts:187-202`](../../src/renderer/editors/board/custom-editor-registry.ts:187)).
Therefore `config.url` is the complete `torrent://...?...` href, not merely the path or magnet.

The registration must implement all three read methods:

```js
globalThis.persephone.providers.register("torrent/viewer", {
    readBinary(config, { signal } = {}) { /* whole file, <= buffered ceiling */ },
    readRange(config, range, { signal } = {}) { /* inclusive bounded bytes */ },
    stat(config, { signal } = {}) { /* { exists, size } after metadata */ },
});
```

The authoring contract requires `readBinary()` and `readRange()` to return `Uint8Array`, makes
`stat()` optional for ordinary providers, and requires `stat().size` when ranging is implemented
([`assets/guides/boards.md:164-206`](../../assets/guides/boards.md:164)). For a torrent provider,
`stat` is mandatory in practice: `resolveTotalSize()` rejects a ranged pipe unless `exists` and a
safe non-negative `size` are present ([`board-pipe-handler.ts:71-103`](../../src/renderer/editors/board/board-pipe-handler.ts:71)).

`stat`, `readBinary`, and `readRange` are all in `UNBOUNDED_OPERATIONS`; they have no deadline and
receive an `AbortSignal`. Only `readBinary` and `readRange` are in `CONTENT_READ_OPERATIONS`, so
they do not consume the 32-slot control cap; `stat` is deliberately excluded from that second set
and therefore still competes for the capped control budget while waiting without a deadline
([`module-service-host.mjs:225-237`](../../assets/module-service-host.mjs:225),
[`module-service-host.mjs:392-420`](../../assets/module-service-host.mjs:392)). This matters for a cold
`stat`: it may wait for metadata indefinitely from the platform's perspective, but it is still one
of the 32 control requests. The provider must not create a board control RPC to wait for itself.

The host validates incoming ranges as integer, non-negative, inclusive ranges no larger than
`MAX_BOARD_PIPE_CHUNK_BYTES`, and validates the provider's returned type and maximum length
([`module-service-host.mjs:180-205`](../../assets/module-service-host.mjs:180)). The provider should
repeat file-specific validation because it must also reject a range outside the selected file.

### Bounded-pull size and continuation

The actual constants are:

```ts
// src/shared/board-pipe-constants.ts:1-5
MAX_BOARD_PIPE_CHUNK_BYTES = 1024 * 1024;       // 1 MiB per provider/pipe chunk
MAX_BUFFERED_PIPE_BYTES = 256 * 1024 * 1024;    // 256 MiB whole-buffer ceiling
```

The service host duplicates the 1 MiB value because it is dependency-free
([`assets/module-service-host.mjs:14-19`](../../assets/module-service-host.mjs:14)). A large HTTP
range is pulled as a sequence: `board-pipe-handler.ts` clamps each provider call to one MiB, and
`board-protocol-service.ts` requests the next continuation only after the previous reply has been
consumed ([`board-pipe-handler.ts:169-204`](../../src/renderer/editors/board/board-pipe-handler.ts:169),
[`board-protocol-service.ts:356-392`](../../src/main/board-protocol-service.ts:356)). Thus one
`readRange` reply is at most 1,048,576 bytes, not a WebTorrent stream and not an entire media file.

The EPIC-113/US-1474 fixture measured a 300 MiB resource by fetching bytes `0-63` and then the
last 64 bytes; its service counter recorded `readRange` while `readBinary` remained zero
([`EPIC-113.md:589-599`](../../doc/epics/EPIC-113.md:589)). The fixture's own UI makes these
requests with explicit `Range` headers and logs `Content-Range`
([`range-provider-test/app.js:107-149`](../../../persephone-boards/_test/range-provider-test/app.js:107)).
The same counter plus the provider's requested `{ start, end }` log is the observation method for
the torrent implementation.

One MiB is a platform bound, not a promise that a request equals one WebTorrent piece. WebTorrent
3's `FileIterator` computes the first and last piece intersecting the requested file-relative range,
selects that exact stream range, and marks readahead pieces critical
([`webtorrent.bundle.mjs:44186-44223`](../../../persephone-boards/boards/torrent-viewer/lib/webtorrent.bundle.mjs:44186)).
Specifically, `_criticalLength` is
`Math.min(1024 * 1024 / pieceLength | 0, 2)` (`:44194`), and the pump calls
`torrent.critical(index, index + _criticalLength)` (`:44222`). A request therefore returns only its
requested bytes, but swarm transfer may be the requested range plus up to `_criticalLength` pieces
of deliberate readahead. Acceptance must log `torrent.pieceLength`, the computed `_criticalLength`,
the requested range, and transferred bytes together; a one-MiB request normally spans multiple
pieces and is not piece-aligned.

### Link format, parsing, and path identity (D5)

New links must have this exact shape:

```text
torrent://<40-lowercase-hex-infohash>/<encodeURIComponent(normalized-file-path)>?magnet=<encodeURIComponent(magnet-uri)>
```

The board should normalize `file.path` exactly as US-1523 does before link construction: replace
backslashes with forward slashes, without basename matching or case folding. The path is encoded as
one URL path value, so `/` inside a torrent path is `%2F`; this prevents URL hierarchy parsing from
changing the file identity. `URLSearchParams.set("magnet", magnet)` (or equivalent one-pass URL
encoding) must encode the magnet's `&`, `?`, and `=` characters.

The provider parser must:

1. Parse `config.url` with `new URL(String(config.url))`. Require protocol `torrent:` and a
   40-hex `url.hostname`; normalize that authority hash to lowercase.
2. Read `url.pathname`, remove exactly its leading `/`, and decode it once with
   `decodeURIComponent`. Reject an empty path, malformed percent encoding, or a path that does
   not exactly equal a torrent file's `file.path.replaceAll("\\\\", "/")`.
3. Read `url.searchParams.get("magnet")`. `URLSearchParams` has already decoded the query value;
   do not decode it a second time. If present, require a valid magnet with a BTIH hash and require
   that hash to equal the authority hash case-insensitively. A missing/malformed/mismatching hash
   is a link error before any torrent lookup or add. This prevents a link from naming one torrent
   in its authority and silently resolving another through its query.
4. If `magnet` is absent, support the old or hand-written link only when
   `findTorrentByInfoHash(authorityHash)` already returns a live torrent in this service. Every
   link created by this task carries the magnet; this branch exists only for links persisted before
   D5 or hand-written by a user. If it is not already known, fail loudly with a dedicated
   `torrent-magnet-required`/equivalent message such as “This link predates the self-contained
   torrent format and its torrent is no longer loaded.” Do not let invisible service state turn the
   same legacy link into a generic file-not-found result, and do not invent a registry lookup or
   persist a second source of truth.

The authority and magnet comparison should reuse one canonical infohash parser, but the provider
must reject conflicting BTIH values rather than trust whichever occurrence happens to be parsed
first. The existing service helper accepts a 40-hex magnet BTIH and lowercases it
([`service.mjs:26-48`](../../../persephone-boards/boards/torrent-viewer/scripts/service.mjs:26));
the implementation should make its all-occurrences/invalid-value behavior explicit when it is
shared with the link parser.

### Torrent lookup, metadata, and concurrent resolution

`stat` must resolve metadata when the torrent is not in `torrentsByInfoHash`, then locate the exact
canonical path. It returns `{ exists: true, size: file.length }` for a match and `{ exists: false }`
for a valid link whose path is absent. A malformed link, hash mismatch, unavailable magnet, or
destroyed torrent is an operation failure rather than a false nonexistence result. `readRange` and
`readBinary` use the same parser and file lookup, so all three operations have one identity rule.

`resolveTorrent()` returns metadata rather than the torrent object, but the provider can reuse the
existing path without a second resolver: `startResolver()` calls `rememberTorrent()` synchronously
immediately after `client.add()` and before awaiting metadata
([`service.mjs:205-239`](../../../persephone-boards/boards/torrent-viewer/scripts/service.mjs:205)).
The provider should call `await resolveTorrent(magnet)` and then
`findTorrentByInfoHash(authorityHash)`. If another board job or provider request is already
resolving that hash, the second `startResolver()` observes the remembered torrent and waits for its
metadata instead of calling `client.add()` again. If the first operation fails, the existing
failure/destroy path removes the map entry and both callers receive failure.

This is the answer to the concurrent re-add question: reuse `resolveTorrent()` and
`findTorrentByInfoHash()`; do not create a provider-specific resolution job, WebTorrent client, or
promise registry. The existing resolution jobs remain the control API's start/status/cancel wrapper
around the same resolver, while the provider waits directly on `resolveTorrent()`.

### `stat`, `readRange`, and `readBinary`

`stat(config, { signal })` first parses and validates the link, then awaits the existing
`resolveTorrent()` path if metadata is needed. It must check `signal.aborted` while waiting and
before returning. Once metadata exists, it does not read a piece: it returns the file length only.

`readRange(config, { start, end }, { signal })` validates an inclusive range within the file and
buffers exactly the requested bytes from `file.createReadStream({ start, end })` into a
`Uint8Array`. The fifteen-line shape comes from av-player's old handler
([`torrent-proxy.ts:184-267`](../../../av-player/src/main/torrent-proxy.ts:184)): create a bounded
file stream, collect it, report stream errors, and return bytes. Persephone's provider must not
copy its HTTP status/header/protocol code; the platform owns those.

The result must be no longer than `end - start + 1`, and for an in-bounds non-empty request it
should be exactly that length. The implementation must enforce the 1 MiB bound locally as well as
relying on the host. It must not return a stream object; the host requires `Uint8Array`
([`module-service-host.mjs:280-297`](../../assets/module-service-host.mjs:280)).

`readBinary(config, { signal })` implements the required provider method by reading the entire file
through the same stream-to-buffer helper. It is valid for the 129,241,752-byte Sintel MP4 from the
epic because that is below the 256 MiB buffered ceiling, although it is intentionally the expensive
path. It should reject a file larger than `MAX_BUFFERED_PIPE_BYTES` before allocating the whole
result, with the same operational meaning as the platform's `provider-payload-too-large` guard.
Ranged-capable built-in media and pipe paths should use `readRange`; `readBinary` remains necessary
for callers such as editors that request a whole buffer and for provider-contract completeness.
The host independently rejects an oversized returned whole buffer and `ProxyProvider` checks it
again ([`module-service-host.mjs:268-277`](../../assets/module-service-host.mjs:268),
[`ProxyProvider.ts:138-151`](../../src/renderer/content/providers/ProxyProvider.ts:138)).

### Piece prioritisation and D1 resting state

The plan must distinguish *selection state* from *payload downloading*. `deselect: true` is what
prevents the torrent-level whole-range selection at metadata time; the epic measured the ordinary
add path downloading 82 MB despite every `file.deselect()` report looking correct
([`EPIC-114.md:358-386`](../../doc/epics/EPIC-114.md:358)). Acceptance must inspect transferred
bytes/download speed, not just `file` selection flags.

For each `readRange`/`readBinary` operation on a torrent:

1. Increment a per-torrent active-reader count after metadata/file validation and before creating
   the stream. Do not acquire a lock: each `FileIterator` owns an independent stream selection
   tagged `isStreamSelection = true`, so overlapping media-player ranges and a whole-file read can
   proceed concurrently. A cancelled or failed read still decrements the count in `finally`.
2. Verify the signal and select only the stream's requested pieces by creating
   `file.createReadStream({ start, end })`. WebTorrent 3's iterator computes
   `floor((file.offset + start) / torrent.pieceLength)` through
   `floor((file.offset + end) / torrent.pieceLength)`, calls its internal stream selection, and
   uses `critical()` as pieces are missing ([`webtorrent.bundle.mjs:44186-44239`](../../../persephone-boards/boards/torrent-viewer/lib/webtorrent.bundle.mjs:44186)).
   Do **not** call public `file.select()` for the whole file: that selects all pieces belonging to
   the file and would allow a seek/read to fetch unrelated bytes. The stream's own selection is the
   precise D9 prioritisation.
3. Collect the stream to a bounded buffer. A seek to a new offset cancels the old pipe request when
   Chromium abandons it; the old iterator destroys its stream selection, then the new
   `createReadStream` selects the new piece interval directly. There is no provider scan from byte
   zero and no selection of the bytes between the two offsets.
4. In `finally`, **always** destroy the stream/iterator, whether it finished naturally, failed, or
   was cancelled. `FileIterator.destroy()` is idempotent and is the code that removes the
   `isStreamSelection = true` selection ([`webtorrent.bundle.mjs:44244-44264`](../../../persephone-boards/boards/torrent-viewer/lib/webtorrent.bundle.mjs:44244)).
   Do not rely on natural drain: normal completion reaches `destroy()` only when the consumer asks
   for one more `next()` after the final chunk (`:44203-44207`).
5. In the same `finally`, decrement the active-reader count. Only when the count reaches zero run
   the blanket all-files deselection sweep. An individual reader must never sweep while another
   reader is active, because that would remove the other reader's selection. After the zero-reader
   sweep and any already in-flight piece messages drain, measured torrent payload transfer must go
   to zero and stay there. The torrent object and in-memory store may remain alive for metadata and
   later warm reads; explicit remove and service shutdown still destroy them.

### Cancellation and cold-start restore

`ProxyProvider` sends `Infinity` for all three unbounded provider operations and threads the signal
through the renderer request ([`ProxyProvider.ts:138-151`](../../src/renderer/content/providers/ProxyProvider.ts:138),
[`ProxyProvider.ts:210-230`](../../src/renderer/content/providers/ProxyProvider.ts:210)). The host
creates an `AbortController` for unbounded operations and aborts it when the renderer sends
`{ kind: "cancel", requestId }`; it removes the pending request and releases the read count even
if the implementation ignores the signal ([`module-service-host.mjs:405-428`](../../assets/module-service-host.mjs:405),
[`module-service-host.mjs:465-473`](../../assets/module-service-host.mjs:465)).

The provider must honor the signal cooperatively:

- reject immediately if it is already aborted;
- while waiting for shared metadata, stop waiting on abort;
- after creating a WebTorrent stream, attach an abort listener that destroys that stream and lets
  the collection promise settle; remove the listener in `finally`;
- always destroy the stream/iterator in `finally`, including natural completion, stream error, and
  cancellation paths; then decrement the active-reader count and sweep all files only for the
  zero-reader transition.

Closing a page or superseding a media request therefore releases the platform lease and causes the
provider to stop waiting for bytes. The torrent is not destroyed for each cancelled read; the final
cleanup returns it to the D1 non-downloading state. `shutdownService()` and `removeTorrent()` remain
the destruction paths.

Cold restore is already supported by the platform path: a provider request calls the renderer
client's first-use acquisition, `module-service-supervisor.ts:358-362` calls `start(boardRoot,
"request")`, and the provider lease then attaches to the service. The US-1523 investigation traced
the first-use path through `module-service-supervisor.ts:321-350` and `:358-362`, with
`src/renderer/api/module-service.ts:272-296,305-379` acquiring the port. The provider must therefore
work when its first call is `stat` or `readRange`: parse the self-contained magnet, lazily create
the client, add with `deselect: true`, wait for metadata, and only then select the requested pieces.
No board page registry or board-frame `service.request()` call may be required.

### MIME/content type

The provider does not return a MIME field. `contentTypeForPipe()` derives the response type from the
pipe's logical display/source name, strips `?`/`#`, lowercases the extension, and maps `.pdf` to
`application/pdf`, `.mp4` to `video/mp4`, text extensions, common image/audio/video formats, and
unknown extensions to `application/octet-stream` ([`board-pipe-utils.ts:1-58`](../../src/renderer/content/board-pipe-utils.ts:1)).
`ProxyProvider.displayName` and `sourceUrl` use `config.url`, so the encoded torrent path still
provides the file extension while the `?magnet=...` suffix is ignored
([`ProxyProvider.ts:71-86`](../../src/renderer/content/providers/ProxyProvider.ts:71)). This is the
same D12 mechanism used by `persephone.content.open()`; the provider must not invent a content-type
field or special-case PDF/MP4 in the service.

### Memory boundary

The store is `MemoryChunkStore` with no eviction, so every verified WebTorrent piece remains resident.
The 129 MB Sintel file can therefore leave roughly its downloaded payload resident, plus the active
1 MiB provider buffer and copies across the service host/renderer structured-clone boundary. The
service must keep one selected file/range at a time and never add a disk cache or eviction policy.
The epic's acceptance item 8 must record peak service RSS while streaming at least 200 MB; that
measurement, not this plan, decides whether a follow-up eviction store is needed.

### Seek observation answer

EPIC-113 already measured the fixture path: after a 300 MB resource's first read, the fixture's
explicit last-64-byte request produced `bytes=<size-64>-<size-1>` and the provider log showed that
range, not a scan from zero ([`EPIC-113.md:593-595`](../../doc/epics/EPIC-113.md:593)). The built-in
player acceptance also recorded five `readRange` calls and zero `readBinary` after playing a 4.48 MB
file ([`EPIC-113.md:591-598`](../../doc/epics/EPIC-113.md:591)). Thus the platform observation method
is reusable: instrument the torrent provider's range log and compare it with the media player's
seek position. The fixture proves the pipe mechanics, not the torrent-specific swarm behavior;
US-1524 acceptance must still run the player against Sintel and verify a seek starts a new range near
the target while no intermediate range is logged.

## Implementation Plan

### 1. Extend the board service in `C:/projects/persephone-boards/boards/torrent-viewer/scripts/service.mjs`

- Add link parsing helpers that accept only `torrent:` links, validate the 40-hex authority hash,
  decode the encoded path once, normalize WebTorrent paths with `\\` → `/`, and compare exact
  canonical paths.
- Decode the `magnet` query with `URL.searchParams`; require its BTIH to match the authority when
  present. For no-magnet links, use only an already-known torrent; otherwise fail with the dedicated
  legacy-link message described in the D5 parsing rules above.
- Reuse `resolveTorrent()` followed by `findTorrentByInfoHash()` for cold provider calls; preserve
  the existing synchronous `rememberTorrent()` insertion, metadata timeout, four-job limit,
  no-poll cancellation, result expiry, `deselect: true`, and destroy paths. Do not add a second
  resolver or client. Add a narrowly scoped helper only if the provider needs to avoid duplicating
  the parse/lookup sequence.
- Register `"torrent/viewer"` from this module with `readBinary`, `readRange`, and `stat` after the
  existing bundle import. Keep the parent-port handshake and unknown control-operation behavior.
- Add a single stream collector that enforces the 1 MiB range bound, uses `Uint8Array` results, and
  attaches/removes the supplied abort listener. A whole-file collector must reject above 256 MiB
  before allocating the result.
- Add a per-torrent active-reader count, incremented before stream creation and decremented in every
  `finally` path. Do not serialize reads. Always destroy each stream/iterator in `finally`; only the
  zero-reader transition may run the blanket all-files deselection sweep.
- Keep `getServiceSnapshot()`'s `downloaded`/speed fields useful for acceptance: verify a read can
  increase them while the request is active and that the idle post-read state stops increasing.

Before → after for the service's currently missing contract:

```js
// Current service: provider declaration is present only in the manifest; service.mjs has no
// globalThis.persephone.providers.register call and no read methods.

// Planned service shape (illustrative; exact helpers stay local to service.mjs or its import):
globalThis.persephone.providers.register("torrent/viewer", {
    stat(config, options) {
        return statTorrentFile(parseTorrentLink(config), options?.signal);
    },
    readRange(config, range, options) {
        return readTorrentRange(parseTorrentLink(config), range, options?.signal);
    },
    readBinary(config, options) {
        return readTorrentWholeFile(parseTorrentLink(config), options?.signal);
    },
});
```

### 2. Preserve the existing platform seam; do not modify it

Use the shipped provider path as-is. `ProxyProvider` exposes `createReadStream` only after the
service announces `rangeReadable`, calls `readRange` with `Infinity`, and checks returned sizes
([`ProxyProvider.ts:173-223`](../../src/renderer/content/providers/ProxyProvider.ts:173)). The pipe
handler obtains size with `stat`, clamps each request to 1 MiB, and rechecks capability after the
stat round trip for cold start ([`board-pipe-handler.ts:71-109`](../../src/renderer/editors/board/board-pipe-handler.ts:71)).
The main protocol handles continuation ranges and cancellation ([`board-protocol-service.ts:297-405`](../../src/main/board-protocol-service.ts:297)). No renderer, IPC, supervisor, guide, manifest, or
provider adapter changes are required for US-1524.

### 3. Verify the cold, warm, cancellation, and seek paths

- Cold: restore a persisted `torrent://` page with no torrent board page open; confirm the service
  starts lazily, the first provider operation resolves metadata from the embedded magnet, and the
  first payload operation is `readRange`.
- Warm: resolve from the board, open a file, and confirm path matching, `stat().size`, and the
  editor-specific MIME/content-type result.
- Cancellation: hold a slow/stalled range, close the page and separately supersede it with a seek;
  confirm the provider signal destroys the stream, the service read lease disappears, the active
  reader count decrements, and the zero-reader transition deselects all files before transfer stops.
- Seek: log `{ infoHash, canonicalPath, start, end, pieceLength, criticalLength }` for every
  provider call; compare the media player's post-seek range with the fixture method and prove no
  range scans from zero.
- Size: exercise the 129 MB Sintel MP4 through ranging and whole-buffer calls, then measure the
  larger-than-256 MiB behavior through the existing host ceiling.
- RSS: run the epic's 200+ MB measurement and record it as an acceptance result; do not alter the
  store policy based on an unmeasured assumption.

## Concerns / Open questions

The source investigation resolves the contract questions, but these items still require runtime
acceptance evidence:

- **Live WebTorrent piece-size measurement:** the platform's request is exactly 1 MiB maximum, but
  the Sintel magnet's runtime `torrent.pieceLength` was not stored in the shipped US-1523 metadata
  result. Acceptance must log it and the selected piece interval; the source proves the range is
  piece-intersecting, not piece-aligned.
- **Media-player seek on the torrent:** EPIC-113 proves the same pipe produces a direct new range
  for the fixture, but US-1524 still needs the real Sintel player run to verify the torrent provider
  log shows the same behavior under swarm latency and cancellation.
- **Cold `stat` control-slot pressure:** `stat` is cancellation-only but remains in the capped
  control pool. `MAX_OUTSTANDING_REQUESTS_PER_SERVICE` is 32
  ([`module-service-channels.ts:9-13`](../../src/ipc/module-service-channels.ts:9)); each cold
  `stat` can wait for the D8 metadata timeout of 30 seconds, so 32 restored torrent pages can hold
  those slots long enough for the board's own status/remove RPCs to fail `service-busy`. Acceptance
  must open enough cold restores to observe whether control calls remain available and record the
  result. This task does not design a fix.
- **Exact WebTorrent error on stream abort:** the platform cancellation route is verified and the
  provider can destroy the stream, but the implementation should normalize only the resulting
  abort/premature-close error into cancellation. Genuine stream/torrent errors must still reject
  and remain visible; cancellation normalization must not turn a broken torrent into a silent empty
  read. This is a runtime check, not a design alternative.
- **Memory measurement:** D6 explicitly accepts the no-eviction store for this pilot. Peak RSS is
  an acceptance measurement and any eviction design is a follow-up, not an open design choice in
  US-1524.

No evidence contradicts D1–D11. No platform change is identified by this investigation.

## Acceptance Criteria

1. `globalThis.persephone.providers.register("torrent/viewer", ...)` is executed by the declared
   module service and the existing manifest type/scheme remains unchanged.
2. A new link uses `torrent://<40-hex-infohash>/<encoded-canonical-path>?magnet=<encoded-magnet>`;
   authority and magnet BTIH must match. Every link created by this task includes the magnet. A
   missing magnet is accepted only for pre-D5/hand-written links whose torrent is already loaded;
   a cold legacy link fails with a dedicated message explaining that its torrent is no longer loaded.
3. Windows `file.path` backslashes and service metadata forward slashes resolve to the same exact
   canonical path; wrong case, basename-only, missing, malformed, and traversal-like identities do
   not select another file.
4. `stat()` resolves cold metadata and returns `{ exists: true, size: file.length }`, or
   `{ exists: false }` for a valid absent file, without selecting payload pieces. A metadata wait has
   no platform deadline but still uses the capped `stat` control slot.
5. `readRange()` accepts only an inclusive in-file range no larger than 1 MiB, selects only the
   intersecting WebTorrent stream pieces, returns exactly the requested bytes as `Uint8Array`, and
   does not call `readBinary()`.
6. A large pipe request is served through 1 MiB bounded pulls and continuations; a seek near EOF
   requests the new offset directly. The provider log and `Content-Range` prove no scan through the
   intervening bytes. Swarm transfer may exceed each requested range only by the logged
   `_criticalLength`-piece readahead; that expected over-fetch is not treated as an intervening
   provider range.
7. `readBinary()` works for the 129,241,752-byte Sintel MP4 while remaining whole-buffer bounded;
   files above 256 MiB are rejected before an unsafe whole-file allocation, while ranged reads remain
   the supported path.
8. A signal already aborted or aborted during metadata wait or stream read releases the
   request. The stream/iterator is unconditionally destroyed, cleanup runs, the active-reader
   count decrements, and the service lease is released even if the provider's promise would
   otherwise remain pending. Genuine non-cancellation errors remain failures.
9. Concurrent range/whole-file reads on one torrent are not serialized. Each owns its stream
   selection; only the active-reader count's zero transition runs blanket deselection. After any
   in-flight pieces drain, transfer returns to zero and stays there. A subsequent seek/read
   reselects only its new stream range; the torrent is not destroyed until explicit remove or
   service shutdown.
10. A restored page with no board page open starts the service lazily and serves its first bytes from
    the self-contained link. Concurrent board resolution and provider traffic share one in-flight
    metadata operation and never add a duplicate torrent.
11. The platform derives `.mp4` as `video/mp4`, `.pdf` as `application/pdf`, and unknown extensions
    as `application/octet-stream` from the logical torrent URL; the service does not add a second
    MIME contract.
12. Acceptance records runtime `pieceLength`, `_criticalLength` (the bundle's
    `Math.min(1024 * 1024 / pieceLength | 0, 2)`), requested ranges, transferred bytes, cancellation
    behavior, and peak RSS while streaming at least 200 MB. The expected transfer is documented as
    requested range plus up to `_criticalLength` pieces of readahead; the D1 assertion is that
    transfer reaches and stays at zero after the active-reader count reaches zero. No disk file is
    created and no eviction store is introduced.

## Files needing NO changes

- `C:/projects/persephone-boards/boards/torrent-viewer/board-manifest.json` — its
  `torrent/viewer` declaration is the forward contract and must retain its persisted type.
- `C:/projects/persephone-boards/boards/torrent-viewer/lib/webtorrent.bundle.mjs` and the board
  package files — US-1523 already pinned and bundled the required runtime.
- `src/ipc/module-service-channels.ts`, `assets/module-service-host.mjs`,
  `src/renderer/api/module-service.ts`, and `src/main/module-service-supervisor.ts` — the ranged,
  unbounded, cancellation, lease, and lazy-start seams are shipped by EPIC-113/US-1518. The
  supervisor's `start(..., "request")` behavior is evidence for this task, not a requested change.
- `src/renderer/content/providers/ProxyProvider.ts`, `src/renderer/editors/board/board-pipe-handler.ts`,
  `src/main/board-protocol-service.ts`, and `src/renderer/content/board-pipe-utils.ts` — they already
  adapt capability-gated ranged reads, enforce the bounds, continue ranges, propagate cancellation,
  and derive MIME from the logical URL.
- `assets/guides/boards.md` and `doc/active-work.md` — the provider contract is already documented,
  and the EPIC-114 dashboard already lists US-1524. Per task direction, do not update the dashboard.
- Any board UI, `US-1525` platform routing, `US-1526` lifecycle work, or `US-1527` documentation —
  those are separate linked tasks and are not needed to implement the provider contract.

## Files Changed

| File | Planned change |
|---|---|
| `C:/projects/persephone-boards/boards/torrent-viewer/scripts/service.mjs` | Add the self-contained link parser, existing-resolver reuse, provider registration, stat/range/whole-file reads, cancellation-aware active-reader accounting, exact piece selection, unconditional stream destruction, and D1 cleanup. |
| `doc/tasks/US-1524-torrent-content-provider/README.md` | This investigation and implementation plan. |
| `doc/active-work.md` | **No change** — explicitly excluded by the task request; EPIC-114 already lists US-1524. |
