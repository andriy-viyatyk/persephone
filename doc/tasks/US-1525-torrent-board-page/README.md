# US-1525: The torrent board page

## Status

Status: Planned  
Priority: High  
Epic: [EPIC-114: The torrent board — a module contributes below the UI](../../epics/EPIC-114.md)

This document is an investigation and implementation plan only. No implementation is included
and no commit is requested.

## Goal

Replace the `torrent-viewer` proof harness with the EPIC-114 two-pane torrent page, and land the
narrow D11 routing fix in Persephone at the same time. A magnet must not be claimed by the board
until an opaque URI is routed to the board's own editor; a named but unrecognised file must still
fall through to Monaco.

The finished page will resolve a magnet or `.torrent` source to metadata only, show session
torrents and their files, open a selected file with a self-contained `torrent://` link, and offer
an explicit save-to-disk action without adding a download queue, disk store, or second WebTorrent
client.

## Background

### Binding epic decisions

EPIC-114 D1–D11 and its UI design are binding. D1 requires metadata-only startup with
`deselect: true`; listing files must not select or download payload bytes. An explicit “Download
this file” action is the one exception. The Notes section records why `file.deselect()` after
metadata is insufficient ([EPIC-114.md:349-368](../../epics/EPIC-114.md:349)). D2/D3/D6/D7 keep
WebTorrent 3.0.21, the existing vendored bundle, memory chunk storage, and TCP-only operation.
D5 requires every `torrent://` link to carry the encoded magnet so a provider can restore it
without the board page ([EPIC-114.md:152-167](../../epics/EPIC-114.md:152)). D8 makes metadata
resolution bounded but content reads unbounded, and D9 leaves piece prioritisation to the
provider read. D10 gives the board `.torrent` and magnet entry points. D11 is owned by this task
([EPIC-114.md:222-263](../../epics/EPIC-114.md:222)).

The three relevant epic Notes are accounted for: metadata resolution is transiently swarm-
dependent rather than a reason to change the service; `deselect: true` must remain at add time;
and the service job must follow the resolver promise because `startResolver` itself returns
`undefined` ([EPIC-114.md:349-436](../../epics/EPIC-114.md:349)).

### Existing board and service

US-1523's proof page in
`C:/projects/persephone-boards/boards/torrent-viewer/index.html:24-38` has one input, three
buttons, one status line, and one unsorted file list. Its `app.js:1-150` resolves one source,
polls a request every 750 ms, and calls `getFilePath()` for an opened torrent. That last call
cannot be used for a magnet in the production page: `getFilePath()` can materialize a non-local
source (`src/board-shim.ts:1648-1670`).

US-1524's service already registers the stable provider type `torrent/viewer` and exposes
`stat`, `readRange`, and `readBinary`; the provider receives the full link in `config.url`. The
board manifest currently has `permissions: ["service", "contentProviders"]` and declares only
`schemes: ["torrent"]`
(`C:/projects/persephone-boards/boards/torrent-viewer/board-manifest.json:10-18`). The provider
type must not be renamed because it is persisted in pipe state.

The existing service already returns the page's live fields. At
`C:/projects/persephone-boards/boards/torrent-viewer/scripts/service.mjs:679-689`,
`torrentStatus()` reports `name`, `peers`, `downloadSpeed`, `downloaded`, and `activeReaders`.
`getServiceSnapshot()` returns those statuses plus active and completed resolution jobs
(`service.mjs:694-723`). The dispatcher supports `resolve`, request-specific `status`, non-
consuming `snapshot`, `cancel`, and `remove` (`service.mjs:778-799`). No new control operation is
needed for the two panes; metadata must additionally carry the canonical magnet URI so a
`.torrent` source can produce D5 links.

### D11 source investigation

`boardEditorId(boardRoot)` creates the stable dynamic id `board-editor:<boardRoot>`
(`src/renderer/editors/board/custom-editor-registry.ts:58-72`). During board refresh,
`getBoardEditorAssociation(manifest)` reads the manifest's `editorName`/`editorKind`, and custom
editor entries are registered with `editorId: boardEditorId(root)` and the association kind
(`custom-editor-registry.ts:291-376`). The torrent manifest already has `editorName: "Torrent
Viewer"` and `editorKind: "simple"` (`board-manifest.json:16-17`).

The registration loop knows the owning `boardRoot` while registering each provider and scheme
(`custom-editor-registry.ts:426-462`), but `createBoardSchemeHooks` currently receives only
`providerType` (`custom-editor-registry.ts:187-215`). The implementation must pass `boardRoot`
or the derived editor id into that factory. The hook will then have both the existing
`providerType` and the claiming board's editor id in scope.

`schemeEffectivePath` catches malformed URLs and decodes the last URL pathname segment
(`custom-editor-registry.ts:175-185`). An opaque `magnet:` URI has an empty pathname. Monaco's
matcher is an unconditional catch-all, `acceptFile: () => 0`
(`src/renderer/editors/base/editor-matchers.ts:47-49`), and `editorRegistry.resolve` starts at
priority `-1`, so Monaco wins for every non-empty match (`src/renderer/editors/base/editorRegistry.ts:201-220`).
The literal helper call with both arguments empty returns `undefined` at its early guard, but the
hook never makes that call: `resolveEditorIdForFile` computes `const match = matchPath || filePath`
(`custom-editor-registry.ts:574-605`). For a magnet, the empty effective path therefore falls
back to the non-empty raw magnet URI and the helper returns `"monaco"`; for `archive.zzz`, it also
returns `"monaco"` via the catch-all matcher. The `|| "monaco"` arm in the hook is consequently
dead for every non-empty `data.url`. The empty-name check must happen before the helper call.

Before:

```ts
data.target = data.target
    || resolveEditorIdForFile(data.url, schemeEffectivePath(data.url))
    || "monaco";
```

Planned shape:

```ts
const effectivePath = schemeEffectivePath(data.url);
data.target = data.target
    || (effectivePath ? resolveEditorIdForFile(data.url, effectivePath) : boardEditorId(boardRoot))
    || "monaco";
```

The empty-name branch must be evaluated before the resolver. A named unknown extension must still
use the resolver and end at Monaco; a named recognised extension must retain its current editor.

The only other board scheme declaration in the checked board sources is the demo board's `mem`
declaration (`assets/demo-board/board-manifest.json:10-16`). Its `mem://demo` use is not a page
open: `assets/demo-board/app.js:326` passes it to `P.content.open`, which reaches
`resolveRegisteredSourcePath` with `phase: "source-path"`
(`src/renderer/content/scheme-registry.ts:232-247`), and the board hook returns at
`custom-editor-registry.ts:204` before its target assignment. The page-opening fixtures carrying
paths, such as `mem://demo/final.txt` and `mem://qa/test.txt`, have non-empty names and are
unaffected. `createBoardSchemeHooks` is called only by the board registration path
(`custom-editor-registry.ts:459-462`); non-board handlers are separate in
`src/renderer/content/builtin-schemes.ts` and generic dispatch invokes whichever registered hook
owns a scheme (`src/renderer/content/scheme-registry.ts:144-225`).

### How a magnet reaches the board page

The route is verifiable:

1. `createBoardSchemeHooks.parse` copies raw `href` into `data.url`
   (`custom-editor-registry.ts:187-196`), and resolve creates a provider config `{ url: data.url }`
   (`custom-editor-registry.ts:197-200`). The provider therefore sees the raw magnet as
   `config.url`, not a decoded pathname.
2. The open handler takes the provider's `sourceUrl`, stores it as `sourceLink.url`, and opens
   the selected board (`src/renderer/content/open-handler.ts:16-30,54-64`). For this route,
   `sourceLink.url` is the original `magnet:` URI.
3. The current board handshake does not expose that source safely. `BoardEditorModel.currentFilePath`
   reads only `state.filePath` or `sourceLink.filePath`
   (`src/renderer/editors/board/BoardEditorModel.ts:544-549`), while the open handler stores the
   raw provider URL in `sourceLink.url`. `BoardWebview.transferPort` sends only `filePath` and
   derives `materialize` from it (`src/renderer/editors/board/BoardWebview.ts:364-382`). For the
   actual magnet-open route, `currentFilePath()` is absent because the source is in `url`, not
   `filePath`, so `getFilePath()` resolves harmlessly to `undefined`; that still leaves the page
   with no source to resolve. The materialization warning applies to other non-local routes that
   do populate the file-path axis, not to this absent-file-path magnet case.

The D11 implementation must include the minimal source handoff needed to make the new page usable
without violating D1: add `sourceUrl?: string` to `BoardPortInitMsg`, populate it from persisted
`sourceLink.url` (falling back to an ordinary file path for switch-style opens), and expose it as
a read-only asynchronous board method such as `persephone.getSourceUrl()`. Add the field to the
handshake type (`src/ipc/board-bridge-channels.ts:249-282`), send it from `BoardWebview`, retain
it in the shim handshake state (`src/board-shim.ts:161-195,923-947`), and document the method in
`src/renderer/editors/board/board-api.d.ts` beside `getFilePath()`.

This is a source-identity accessor, not a readable-path accessor: it must never materialize the
source and must return the raw magnet persisted by the open handler. The page will await it and
issue `service.request({ op: "resolve", magnetOrTorrentId: sourceUrl })`. A plain board has no
source and remains idle. Without this handoff D11 can route the magnet to the board, but the page
has no source value from which to resolve it.

### Board API and download capability

The public board API documents `persephone.openRawLink(href, options?)` as opening a file or URL in
a new Persephone page, with an optional explicit editor
(`src/renderer/editors/board/board-api.d.ts:424-427`). The shim fires it with the href and
optional editor (`src/board-shim.ts:1463-1465`), and the main bridge forwards it to the renderer
(`src/main/board-bridge.ts:333-340`). There is no board API option for navigating the current page;
`openContent` is create-only and requires an explicit content-host editor
(`board-api.d.ts:428-445`). Consequently double-click and the single file-menu action, Open, use
`openRawLink(link)` with no target. There is no separate “Open in new tab” item because it would
be identical to Open.

“Download this file” is reachable without a platform change, but only with a hard size guard.
`persephone.content.open(link)` is board-exposed (`board-api.d.ts:327-344`; `src/board-shim.ts:1486-1499`)
and returns a board-local ranged URL. The host registers and serves that resource
(`src/renderer/editors/board/BoardWebview.ts:989-1053`; `src/main/board-protocol-service.ts:407-418`).
The torrent provider has a bounded `createReadStream`, so the content resource is not limited by
`MAX_BUFFERED_PIPE_BYTES` (`src/renderer/editors/board/board-pipe-handler.ts:67-88`;
`src/renderer/content/providers/ProxyProvider.ts:185-219`). However, the bridge's `writeFile`
accepts one structured-clone byte buffer and calls `fs.promises.writeFile`; it has no append mode
or flags (`src/main/board-bridge.ts:220-255`). The board renderer therefore holds the whole
file, and main receives another clone. Use 256 MiB as the explicit guard, following the shared
buffering precedent (`src/shared/board-pipe-constants.ts:1-5`). The action must refuse above that
size with: “This file is too large to save through the board bridge, which has no streaming write.”

The order is always: check the size, show the save dialog, then call `content.open`, fetch the
resource, and binary `writeFile`. Normal page load and file listing never call this path; there is
no queue or per-file progress bar. A chosen absolute save path is written unchanged because
`resolveBoardFilePath` returns absolute paths as-is (`src/main/board-bridge.ts:197-204`).

### Service control budget and sampling

The main supervisor allows at most 32 outstanding requests and applies the default 10,000 ms
control deadline (`src/ipc/module-service-channels.ts:8-14`); the board bridge submits requests
through it (`src/main/board-bridge.ts:261-266`). The page will use `resolve` once per add, poll
that request with `status` only while resolving, and sample all session torrents with one
non-overlapping `snapshot` request at about one-second intervals. The next timer starts only after
the previous request settles; timers stop on teardown. This stays below the cap and does not hold
slots between samples.

`activeReaders === 0` means metadata-only. With an active reader, advancing `downloadSpeed` or
`downloaded` means streaming; an active reader with zero rate/progress for consecutive samples is
the UI's stalled heuristic. The service already supplies these values; it does not need to own a
new stalled state.

### `.torrent` sources and D5

The current `metadataFor()` payload contains only `infoHash`, `name`, and file records
(`service.mjs:121-134`). A `.torrent` source has no magnet string for the page to reuse. The
vendored WebTorrent object sets its canonical `magnetURI` (`lib/webtorrent.bundle.mjs:44982`), so
extend `metadataFor()` and its completed `status` result with that value. The page uses
`torrent.magnet`, not an assumption that the original input was a magnet. This preserves D5 for
both D10 entry points without changing `torrent/viewer`.

## Implementation Plan

### 1. Land D11 routing in Persephone

1. Change `createBoardSchemeHooks` and its registration call in
   `src/renderer/editors/board/custom-editor-registry.ts:187-215,426-462` so the hook closes over
   the claiming board id. Compute `effectivePath` once; use the board id only when it is empty;
   otherwise call `resolveEditorIdForFile` and retain `|| "monaco"`. Preserve explicit
   `data.target` first.
2. Add a `BoardEditorModel` source-URL accessor reading `state.sourceLink.url` and falling back to
   the switch-path file path. Do not change `currentFilePath()` or `getFilePath()` materialization.
3. Add `sourceUrl` to `BoardPortInitMsg`, send it from `BoardWebview.transferPort`, carry it through
   the shim, and add `persephone.getSourceUrl(): Promise<string | undefined>` to `board-api.d.ts`.
4. Once routing is fixed, add `"magnet"` beside `"torrent"` in the board manifest. No direct
   `registerScheme("magnet")` is needed: the manifest declaration is registered by the existing
   custom-editor loop (`custom-editor-registry.ts:426-462`), and the existing
   `contentProviders` permission is sufficient.

### 2. Add the D11 source handoff (second platform change)

This is a separate platform change, accepted because D11 is unusable without it: routing the
magnet to the board is not enough if the board cannot identify which magnet to resolve. Add
`sourceUrl?: string` to `BoardPortInitMsg`, populate it from persisted `sourceLink.url` (falling
back to an ordinary file path for switch-style opens), and expose it as
`persephone.getSourceUrl(): Promise<string | undefined>`. It must never call materialization.
Add the field to the handshake type (`src/ipc/board-bridge-channels.ts:249-282`), send it from
`BoardWebview`, retain it in the shim handshake state (`src/board-shim.ts:161-195,923-947`), and
document the method in `src/renderer/editors/board/board-api.d.ts` beside `getFilePath()`.
The settle-once path must set `undefined` for a plain board, just as the existing file-path
handshake does (`src/board-shim.ts:935-942`), so `getSourceUrl()` cannot hang.

### 3. Replace the proof page

In `C:/projects/persephone-boards/boards/torrent-viewer/index.html`, retain `board-base.css` and
use its variables plus bridge theme tokens. Build a toolbar for adding a magnet or choosing a
`.torrent`, a left session-torrent pane, and a right selected-file pane. Left rows show name,
peers, current rate, and an accessible metadata-only/streaming/stalled state dot. Right rows show
a filename-derived icon, name, and size, sorted by size descending with a stable tie-breaker.
Do not render file progress bars.

Install row/file custom context menus in the page. The board's built-in menu explicitly permits a
board menu by handling `contextmenu` with `preventDefault()` (`src/board-context-menu.ts:11-19`).
Torrent rows expose Remove. File rows expose Open, Copy link, and Download this file.

### 4. Implement `app.js`

Keep a session map keyed by infohash, retaining source, canonical magnet, metadata/files,
selection, request id, previous downloaded bytes, and stalled-sample count. On startup, await
`getSourceUrl()` and automatically resolve a raw magnet or `.torrent` path; manual adds use the
same path.

Build every file link as:

```js
const link = `torrent://${infoHash}/${encodeURIComponent(file.path)}`
    + `?magnet=${encodeURIComponent(torrent.magnet)}`;
```

Double-click and Open call `P.openRawLink(link)` with no options. Copy uses the board clipboard
API. Download checks the 256 MiB ceiling, shows the save dialog, then uses `content.open` →
`fetch` → binary `writeFile`, only after explicit user action.

Use `resolve` → request-specific `status` for metadata, `snapshot` for all-row peer/rate samples,
`cancel` for an abandoned resolution, and `remove` for a row removal. Keep one snapshot in flight;
stop timers on teardown. Do not destroy the shared client; US-1526 owns broader lifecycle policy.

### 5. Extend metadata, not the service operation model

In `C:/projects/persephone-boards/boards/torrent-viewer/scripts/service.mjs`, preserve the current
WebTorrent construction, `MemoryChunkStore`, `deselect: true`, provider methods, and operation
names. Add `torrent.magnetURI` to `metadataFor()` so `resolve` completion and `status` give the
page the D5 source. No new polling endpoint is needed because `snapshot` already has every
peer/rate field.

### 6. Dashboard

Link US-1525 from the EPIC-114 Active section in `doc/active-work.md:45-57`. It is already under
the active EPIC, so no status move is needed.

## Concerns

- **D11 acceptance risk:** the empty-name branch must precede the resolver. `archive.zzz` must
  still open Monaco, while recognised named extensions and existing `torrent://` paths retain
  their current editors. Any later simplification that folds the empty-name check back into the
  `||` chain silently restores the bug: for every non-empty `data.url`, the resolver's Monaco
  catch-all wins and every arm after it is unreachable.
- **Board residual:** if `mem://demo` is ever opened as a PAGE rather than through `content.open`,
  it will now target the Demo Board's own editor. That is arguably correct under D11, but it is a
  behaviour change in a bundled board, so acceptance must check it. A bare
  `torrent://<infohash>` with no path is the benign counterpart and should now target Torrent
  Viewer.
- **D11/source handoff:** the magnet-open route's current file path is absent, so
  `getFilePath()` returns `undefined`; the planned second platform change supplies the raw source
  identity without materialization. Other non-local routes may still materialize through
  `getFilePath()`, which is why the new method must remain separate.
- **Download ceiling:** the resource path can stream ranges, but the board bridge write cannot
  append. The 256 MiB guard is therefore mandatory and must run before the save dialog/fetch path.
- **Sampling:** stalled is a UI heuristic based on consecutive `snapshot` samples, not a service
  guarantee. Chaining timers after settlement prevents overlap and stays below the 32-request
  cap and 10-second control deadline.
- **Download memory:** the explicit whole-file fetch is D1's exception. It must begin only after a
  save path is chosen and must not become a normal queue.
- No source question remains unresolved: the raw magnet is persisted as `sourceLink.url`, passed
  to the provider as `config.url`, and exposed to the page without materialization; `.torrent`
  sources use the service's canonical `magnetURI`.

Files needing **no changes**: `C:/projects/persephone-boards/boards/torrent-viewer/board-base.css`,
the vendored WebTorrent bundle, package/dependency manifests, the `torrent/viewer` provider type,
and the provider's existing `stat`/`readRange`/`readBinary` implementation. No unit tests or test
harnesses are planned; verification is through the running app and the epic's real-magnet flow.

## Acceptance Criteria

1. `magnet` is not declared until D11 is landed. Afterwards a magnet opens Torrent Viewer, while
   `archive.zzz` still opens Monaco and named recognised extensions still select their editors.
2. The manifest declares `torrent` and `magnet`, retains `torrent/viewer`, and raw magnet input
   arrives at the provider as `config.url` unchanged.
3. Magnet and `.torrent` entry points resolve metadata with `deselect: true`; opening/listing
   transfers metadata only and creates no cache or disk file.
4. The two-pane page lists only session-added torrents with name, peers, rate, and state dot;
   torrent Remove is in its context menu. The selected file list shows filename-derived icons,
   name, size, descending size order, and no per-file progress bars.
5. Double-click calls `openRawLink` with the exact D5 link and no editor target. The file menu has
   Open, Copy link, and Download this file; there is no duplicate Open-in-new-tab item. Download
   checks the 256 MiB ceiling and opens the save dialog before `content.open`, fetching, or writing.
6. A plain board with no scheme source gets `getSourceUrl()` resolving to `undefined` rather than
   hanging, while a magnet-opened page receives the raw source without materialization. A bare
   `torrent://<infohash>` opens Torrent Viewer, and the `mem://demo` page-open residual is checked.
7. Polling uses one serialized `snapshot` at about one-second cadence, stops on teardown, and does
   not accumulate outstanding control requests.
8. The page uses `board-base.css` and theme tokens and adds no dependency, second client, disk
   store, queue, or platform change outside the D11 routing and separately documented source
   handoff.

## Files Changed

| Repository | File | Planned change |
|---|---|---|
| `C:/projects/persephone` | `src/renderer/editors/board/custom-editor-registry.ts` | Pass the claiming board editor id into scheme hooks and route only an absent effective name to it; preserve resolver/Monaco behavior for named paths. |
| `C:/projects/persephone` | `src/renderer/editors/board/BoardEditorModel.ts` | Provide the persisted raw source URL for the handshake without changing materialization. |
| `C:/projects/persephone` | `src/renderer/editors/board/BoardWebview.ts` | Include the source URL in `BoardPortInitMsg`. |
| `C:/projects/persephone` | `src/board-shim.ts` | Receive the source URL and expose the non-materializing accessor. |
| `C:/projects/persephone` | `src/ipc/board-bridge-channels.ts` | Extend the board handshake with `sourceUrl`. |
| `C:/projects/persephone` | `src/renderer/editors/board/board-api.d.ts` | Document `getSourceUrl()`. |
| `C:/projects/persephone` | `doc/active-work.md` | Link US-1525 from EPIC-114's Active dashboard. |
| `C:/projects/persephone-boards` | `boards/torrent-viewer/index.html` | Replace the proof harness with the themed two-pane layout and custom menus. |
| `C:/projects/persephone-boards` | `boards/torrent-viewer/app.js` | Implement session state, source auto-add, polling, sorting, links, context actions, and download. |
| `C:/projects/persephone-boards` | `boards/torrent-viewer/board-manifest.json` | Add `magnet` beside `torrent` without renaming the provider. |
| `C:/projects/persephone-boards` | `boards/torrent-viewer/scripts/service.mjs` | Add canonical `magnetURI` to metadata while retaining existing operations/provider methods. |
