# US-1531: A claimed download is fetched on the originating page's session

**Status:** Planned

**Epic:** [EPIC-114](../../epics/EPIC-114.md)

## Goal

When a board claims a Browser download (D12, US-1478) from a Tor or incognito page,
the board's re-fetch of that URL runs on the originating page's Electron session —
not Persephone's default one — and the board tells the user once that the swarm
connection is not anonymous. The platform must carry the session for the metadata
request without making the board choose the network identity.

## Why

The decision recorded on 2026-09-27 — “let allow opening torrent links from tor and
incognito mode” — is recorded as D13. D13 makes this a propagation requirement: the
platform carries the originating session through the claimed-download path; it does
not refuse the download and it does not add a permission gate.

The current defect is observable for a `.torrent` claimed from a Tor page: the
Browser download is cancelled and the board opens the URL, but the content pipeline
refetches it with the default Node HTTP client. A host that is reachable only through
Tor therefore fails, while a reachable host can learn the user's non-Tor address.

## Constraints already decided

- The board does not choose the network identity. Session propagation is a platform
  responsibility, generic to any claimed download; core must not learn which board
  claims a torrent.
- Do not add a consent dialog or a permission prompt; a trusted board is a user
  application. Show one plain sentence:
  **“The metadata was fetched privately, but the swarm connection is not
  anonymous.”** This is an informational warning, not a gate.
- BitTorrent over Tor is out of scope. The metadata request may use Tor, but tracker,
  peer, and swarm traffic remains a direct clearnet connection and must be described
  as such.

## Background

### Verified claimed-download flow

`DownloadService.handleWillDownload` in
[`src/main/download-service.ts:115`](../../src/main/download-service.ts#L115) receives
the `DownloadItem` and originating `WebContents`. It cancels a matching claimed
download at lines 120–127 and sends
`eOpenClaimedBrowserDownload` with only `{ url, boardRoot }`; the available
`webContents.session` is consequently dropped. The ordinary-download branch at line
135 must remain unchanged.

The event is typed identically in
[`src/ipc/api-types.ts:386`](../../src/ipc/api-types.ts#L386) and
[`src/ipc/renderer/renderer-events.ts:94`](../../src/ipc/renderer/renderer-events.ts#L94).
`RendererEventsService.handleClaimedBrowserDownload` at
[`src/renderer/api/internal/RendererEventsService.ts:95`](../../src/renderer/api/internal/RendererEventsService.ts#L95)
calls `openRawLink` with `createLinkData(data.url, { target: boardEditorId(data.boardRoot) })`.
That is the correct generic hand-off point: `boardRoot` routes the open, while the
new session context must remain platform-owned and must not become board policy.

### Browser partitions and lifetime

`getPartitionString` in
[`src/renderer/editors/browser/BrowserEditorModel.ts:328`](../../src/renderer/editors/browser/BrowserEditorModel.ts#L328)
names the relevant sessions as:

- `browser-tor-<uuid>` for Tor;
- `browser-incognito-<uuid>` for incognito;
- `persist:browser-<profile>` for the ordinary profile session.

`DownloadService.init` already hooks every Session through
[`src/main/download-service.ts:36`](../../src/main/download-service.ts#L36), and
`handleWillDownload` already receives the actual `webContents.session`. Electron's
`Session.isPersistent()` is available in the installed Electron API
(`node_modules/electron/electron.d.ts:13188`), so an incognito handle can be mapped
directly from that Session without widening Browser registration IPC. For Tor,
`TorService` currently stores active partition names but not a reverse map; add a
main-side `findActivePartitionForSession(session)` helper that compares
`session.fromPartition(partition)` with the originating Session while iterating the
existing active set. Thus only Tor liveness needs the partition name, and it can be
recovered in main without changing `BrowserRegisterRequest`, `BrowserView`, or
`browser-service.ts`.

Tor disposal is real, not page-local bookkeeping: `BrowserTorModel.dispose` and its
window-closing path call `TorChannel.stop` (see
[`src/renderer/editors/browser/BrowserTorModel.ts:105`](../../src/renderer/editors/browser/BrowserTorModel.ts#L105)
and line 157), and `TorService.stopForPartition` clears the proxy and removes the
partition from its active set at
[`src/main/tor-service.ts:147`](../../src/main/tor-service.ts#L147).
`isActiveTorPartition` at line 166 is true only while the daemon and that partition
are live. Incognito cleanup does not call `Session.destroy`; retaining the Session
object in a bounded main-process hand-off registry is therefore possible, but any
session that cannot fetch must fail closed rather than use the default session.

### Verified content request path

The existing claimed URL path is:

1. `RendererEventsService` creates link data and emits `openRawLink`.
2. The HTTP resolver in `src/renderer/content/resolvers.ts` passes that link data to
   `resolveUrlToPipeDescriptor`; the resolver then creates the pipe and assigns the
   descriptor to the link data.
3. `resolveUrlToPipeDescriptor` at
   [`src/renderer/content/link-utils.ts:83`](../../src/renderer/content/link-utils.ts#L83)
   currently places URL, method, headers, and body into an HTTP descriptor at lines
   125–136.
4. The HTTP provider registered at
   [`src/renderer/content/registry.ts:581`](../../src/renderer/content/registry.ts#L581)
   constructs `HttpProvider`. Its `readBinary` at
   [`src/renderer/content/providers/HttpProvider.ts:62`](../../src/renderer/content/providers/HttpProvider.ts#L62)
   and `createReadStream` at line 81 use `nodeFetch` from
   `src/renderer/api/node-fetch.ts`, which is a direct Node `http`/`https` client and
   has no Electron session.
5. A board content request reaches
   `BoardEditorModel.openContentResource` at
   [`src/renderer/editors/board/BoardEditorModel.ts:656`](../../src/renderer/editors/board/BoardEditorModel.ts#L656),
   which currently calls `pipeFromLink(link)` at line 663. The board iframe then
   fetches only the platform-owned local pipe URL; it does not perform the original
   network request itself.

The existing `tor-src` protocol in
[`src/main/tor-src-protocol.ts:35`](../../src/main/tor-src-protocol.ts#L35) proves the
needed Electron primitive: a privileged custom scheme can validate the request and
call `session.fromPartition(partition).fetch(...)`, and it rejects requests when
`torService.isActiveTorPartition` is false at lines 57–60. The new implementation
should follow that session-aware pattern, but use an opaque main-issued handle so the
renderer and board never receive a raw partition name and so the mechanism is generic
to Tor, incognito, and future private sessions.

### Persistence and cold-start restore

`cleanForStorage` in
[`src/shared/link-data.ts:55`](../../src/shared/link-data.ts#L55) removes ephemeral
link fields before the source link is stored. The new session handle must be added to
that ephemeral set. The HTTP provider's `toDescriptor` at
[`src/renderer/content/providers/HttpProvider.ts:119`](../../src/renderer/content/providers/HttpProvider.ts#L119)
must also omit it, and storage sanitisation must remove any defensive copy from a
nested HTTP descriptor. No session handle, Session object, or private partition may
enter the persisted D5 link or the editor restore data.

The current page restore path is not safe by itself. `BoardEditorModel.getRestoreData`
at [`src/renderer/editors/board/BoardEditorModel.ts:799`](../../src/renderer/editors/board/BoardEditorModel.ts#L799)
inherits the page state's `sourceLink.pipeDescriptor`; it only strips transient
`contentPath` at lines 818–831. A fresh claimed page therefore persists the HTTP
provider descriptor, and the provider is rebuilt without the transient handle after
restart. The board shim's `getSourceUrl()` then hands the board the HTTP source again
through the host source handshake.

The platform plan is to persist a `sourceRestoreBlocked` marker in the board editor
state, not a session handle. When a page has a live source opened with a private
handle, `getRestoreData` writes the marker into the returned restored state. On
restore, `BoardEditorModel.currentSourceUrl` at
[`src/renderer/editors/board/BoardEditorModel.ts:587`](../../src/renderer/editors/board/BoardEditorModel.ts#L587)
returns `undefined` while that marker is set, so the board's `getSourceUrl()` cannot
receive the private HTTP URL. The persisted source link may remain for page identity,
but it is deliberately not handed to the board; runtime source opens can still use
the existing URL-only event. A fresh page starts without the marker. This is safer
than merely omitting `pipeDescriptor`, because the current source handshake is based
on the page's source identity as well as the live pipe.

The torrent viewer also needs to make its own accepted-source state self-contained.
Its current `rememberAcceptedSource` at
`C:/projects/persephone-boards/boards/torrent-viewer/app.js:220` persists an HTTP
`.torrent` URL before resolution, `resolveSourceInternal` reads that URL through
`P.content.open` at lines 578–586, and `loadOpenedSources` restores every accepted
source at lines 1053–1068. Therefore cold start must not rely on the page marker
alone: after a successful HTTP resolve, the board must replace that accepted URL
with the canonical magnet from the authoritative service snapshot. An HTTP source
must not be persisted while unresolved or after a failed resolve.

The existing `buildFileLink` at
`C:/projects/persephone-boards/boards/torrent-viewer/app.js:322-344` embeds the
canonical magnet in file links. After the board-side accepted-source change, a
successful claimed `.torrent` is likewise restored from its magnet; the current
implementation does not yet provide that guarantee for accepted HTTP sources.

### User-facing warning and bridge boundary

The torrent viewer reads claimed source bytes through the existing
`P.content.open(source)` path (its `readHttpTorrentSource` is around lines 300–319 of
the board reference). No board API is required: the platform can send the existing
`eBoardNotify` event from `download-service.ts`, which
`RendererEventsService` already displays through `ui.notify`. The warning is emitted
once for a claimed Tor/incognito download, using the exact sentence in Constraints;
ordinary-session claims receive no new warning.

Because no board-facing channel, handshake field, or `P.content` API changes, do not
change `BOARD_BRIDGE_VERSION` in
`src/shared/board-bridge-version.ts`, and do not change the torrent viewer's
`minBridgeVersion`.

## Implementation plan

1. **Identify the originating private Session in main.** Use the Session already
   supplied to `DownloadService.handleWillDownload`: `Session.isPersistent() === false`
   identifies incognito, while a new
   `torService.findActivePartitionForSession(webContents.session)` compares the
   Session object against the active partition names held by
   [`src/main/tor-service.ts:147`](../../src/main/tor-service.ts#L147). The returned
   Tor partition is retained in the opaque handle so the protocol can apply
   `isActiveTorPartition` at fetch time. Do not widen `BrowserRegisterRequest`,
   `BrowserView`, or `browser-service.ts`; the existing `session-created` hook and
   Electron Session object are sufficient. This keeps session identity platform-owned
   and avoids duplicating partition metadata over Browser IPC.

2. **Create a generic, opaque session hand-off in the main process.** Add
   `src/main/session-src-protocol.ts`, modelled on `tor-src-protocol.ts`. The new
   scheme is fetched by `HttpProvider` in the host renderer, so register its handler
   on the host renderer's app-partition Session by following
   [`src/main/board-protocol-service.ts:482`](../../src/main/board-protocol-service.ts#L482):
   call `session.fromPartition(appPartition).protocol.handle("session-src", ...)`
   from `main-setup.ts` alongside `initBoardProtocol(appPartition)` at lines 118–121.
   Also add `session-src` to the privileged scheme list at
   [`src/main/main-setup.ts:35`](../../src/main/main-setup.ts#L35) with
   `standard`, `secure`, and `supportFetchAPI: true`. Do not register it on each Tor
   webview partition; that is where `tor-src` is handled, but it is the wrong Session
   for this host-renderer request.

   The module should expose a main-only registration function that:
   module should expose a main-only registration function that:

   - creates a cryptographically unpredictable handle for a private claimed
     download;
   - maps it to the already-known Electron `Session`, its partition classification,
     and an expiry five minutes after registration;
   - serves only an encoded `http` or `https` target through that mapped Session;
   - rejects unknown, expired, malformed, or otherwise unavailable handles; and
   - for Tor handles, calls `torService.isActiveTorPartition(partition)` immediately
     before fetching and rejects when the page/partition has been stopped.

   The protocol must never accept a caller-supplied partition and must never retry on
   the default session. The handle is a transient capability for one claimed-open
   hand-off; remove it after expiry and when the request is complete where practical.

3. **Add the handle to the claimed-download event only for private partitions.** In
   `download-service.ts`, use `webContents.session.isPersistent()` for incognito and
   the Tor service's Session-to-active-partition lookup for Tor to register a handle
   for `browser-tor-*` and `browser-incognito-*` claims. Extend the existing
   `eOpenClaimedBrowserDownload` payload in `src/ipc/api-types.ts` and
   `src/ipc/renderer/renderer-events.ts` with optional `sessionHandle`.

   Current send:

   ```ts
   { url, boardRoot: claim.boardRoot }
   ```

   After the change:

   ```ts
   {
       url,
       boardRoot: claim.boardRoot,
       ...(sessionHandle ? { sessionHandle } : {}),
   }
   ```

   Leave the default `persist:browser-*` path without a handle so its HTTP fetch,
   notification, and all other behavior remain exactly today's behavior. Emit the
   existing platform notification with the exact privacy sentence once when a
   private handle is created; do not add a board bridge message or a gate.

4. **Preserve the handle as ephemeral link context.** In
   `RendererEventsService.handleClaimedBrowserDownload`, pass `sessionHandle` through
   `createLinkData` while retaining `boardRoot` solely for the existing editor target.
   Add `sessionHandle?: string` to the ephemeral portion of
   `src/renderer/api/types/io.link-data.d.ts`. Extend
   `resolveUrlToPipeDescriptor` and the HTTP descriptor construction so the live
   provider can receive the handle, and extend `pipeFromLink` with an optional
   `sessionHandle` option for host-side board content opens.

   The renderer payload changes from:

   ```ts
   createLinkData(data.url, { target: boardEditorId(data.boardRoot) })
   ```

   to the same call with `sessionHandle: data.sessionHandle` added as transient
   context. Do not put the handle into the board's URL or into `boardRoot`.

5. **Make only the HTTP provider's private path session-aware.** Extend
   `HttpProvider` with an ephemeral handle and factor its request operation so both
   `readBinary` and ranged `createReadStream` use the session-source scheme when a
   handle exists. The protocol response must preserve status, body, content type,
   cache-control, and range behavior needed by the current provider. With no handle,
   retain the current `nodeFetch` calls byte-for-byte in behavior.

   `HttpProvider.toDescriptor()` must emit only the existing restorable URL/method/
   headers/body fields. Add the handle to the live provider construction in
   `src/renderer/content/registry.ts`, but never to its persisted descriptor.

6. **Carry the transient context through page and board lifetime boundaries.** Update
   `src/renderer/content/open-handler.ts` and
   `src/renderer/api/pages/PagesLifecycleModel.ts` so a private session handle is
   passed alongside the live pipe for both a new board and an already-open
   single-instance board. In `BoardEditorModel`:

   - keep a private, non-state `Map<string, string>` from each source URL to its
     session handle; there is no single active source under US-1530;
   - fill that map when a source is opened fresh and when `{ sourceUrl, sessionHandle? }`
     is queued for a single-instance board, while keeping `BoardWebview`'s existing
     URL-only bridge message unchanged;
   - in `openContentResource`, pass the handle whose key exactly matches the
     requested link to `pipeFromLink`; do not consult a global/current handle;
   - drop the map entry after its handle expires or after the corresponding resource
     has been opened (the constructed provider retains the capability it needs for
     its reads); and
   - set the restore-block marker for a page whose live source was opened with a
     private handle.

   The current board queue is at
   [`src/renderer/editors/board/BoardEditorModel.ts:261`](../../src/renderer/editors/board/BoardEditorModel.ts#L261),
   and `BoardWebview.flushPendingSourceUrls` consumes it at
   [`src/renderer/editors/board/BoardWebview.ts:470`](../../src/renderer/editors/board/BoardWebview.ts#L470).
   Do not expose the handle to the board frame; the frame continues to receive only
   the existing source URL.

7. **Enforce the persistence boundary.** Update `cleanForStorage` to destructure the
   new ephemeral field and defensively strip any `sessionHandle` from a provider
   descriptor before returning `StoredLinkData`. Keep `getRestoreData` and the board
   bridge payload unchanged. In `BoardEditorModel.getRestoreData`, persist the
   `sourceRestoreBlocked` marker for a session-bound live source; on restore,
   `currentSourceUrl()` must return no source while that marker is set. Verify that a
   cold-start torrent rebuild uses an accepted magnet and not the transient claimed
   URL.

### Board-side implementation (`C:/projects/persephone-boards`)

8. **Update the Torrent Viewer board's accepted-source persistence.** This is a
   separate boards-repository half of US-1531; it requires no bridge API change.
   In `C:/projects/persephone-boards/boards/torrent-viewer/app.js`:

   - change the `resolveSource`/`rememberAcceptedSource` flow at lines 559–572 so an
     HTTP `.torrent` URL is only a transient in-memory input until resolution
     succeeds; it must not be written to `acceptedSources` or `P.state` before that;
   - after `resolveSourceInternal` successfully refreshes the authoritative service
     snapshot at lines 600–604, find the ready row's canonical `magnet` from the
     snapshot model populated by `reconcileSnapshot` at lines 765–783;
   - replace the resolved HTTP entry in `acceptedSources` with that canonical magnet,
     update `sourceInfoHashes`, and persist only the magnet; and
   - leave failed/unresolved HTTP sources out of persisted state, so US-1530's
     non-pruning of failed sources cannot preserve a private URL forever.

   Bump `boards/torrent-viewer/board-manifest.json` from the verified `1.4.1` to
   `1.5.0`, add the matching one-line release note to
   `boards/torrent-viewer/WHATS-NEW.md`, and update the user-facing persistence
   statement in `boards/torrent-viewer/README.md`. The board remains on bridge
   `1.17.0`; this is a Torrent Viewer release bump, not a bridge-version bump.

9. **Keep the bridge and ordinary path unchanged.** Do not modify
   `src/ipc/board-bridge-channels.ts`, board bridge handlers, or
   `src/shared/board-bridge-version.ts`. Do not alter the ordinary download dialog,
   non-claimed download tracking, or default-session claimed-download path.

10. **Manual verification after implementation.** Exercise a claimed `.torrent` from
   an active Tor page and an active incognito page, confirm the origin session is used,
   close/stop the private page before the board request and confirm the request fails
   without a default-session retry, and confirm the exact informational sentence is
   shown once. Repeat from an ordinary page and confirm today's behavior. Verify
   single-instance board routing, fresh board opens, persistence/cold-start restore,
   and range reads. Use the repository's existing typecheck/lint/build workflow.

## Concerns

- **Fail-closed lifetime:** A private page can disappear between download claim and
  board fetch. The five-minute handle lifetime provides a bounded incognito hand-off,
  while Tor shutdown makes a Tor handle unusable immediately. Every lookup, expiry,
  or fetch failure must surface as an open/content error; never fall back to the
  default session.
- **Protocol safety:** The session-source scheme must not become an open proxy. Keep
  the handle opaque and unguessable, accept only `http`/`https` targets, validate
  expiry and ownership in main, and do not expose partition names to renderer or
  board code.
- **Persistence leakage:** The handle exists in link data and possibly an in-memory
  HTTP descriptor only long enough for the live open. Both top-level storage cleanup
  and provider-descriptor serialization need coverage. The page restore marker must
  suppress the source handshake, and the Torrent Viewer must replace resolved HTTP
  sources with canonical magnets, so D5 links remain self-contained and restorable.
- **Single-instance ordering:** The claimed source can be queued while an existing
  board frame is loading, and several sources can be queued before either is read.
  A source-URL-to-handle map must keep each capability paired with its own URL even
  though the board-facing `source:opened` message remains URL-only.
- **Scope boundary:** This fixes the metadata request only. It does not anonymize
  tracker, peer, or swarm traffic, and it must not make core aware of which board
  claimed the download.
- **Compatibility:** The default-session branch must not gain a handle, change its
  request client, or gain a warning. No board-facing API changes means no bridge
  version bump.

## Acceptance criteria

- A claimed download from an active `browser-tor-*` or
  `browser-incognito-*` page carries an opaque, main-issued session handle from
  `handleWillDownload` through IPC, link data, the live pipe, and the eventual HTTP
  provider request.
- The `.torrent` bytes for that claim are fetched by the originating Electron
  Session. The board remains unaware of the session and continues using the existing
  `content.open`/platform-pipe contract.
- If the handle is unknown, expired, unusable, or its Tor partition is no longer
  active, the request fails closed and never retries with the default session.
- The session handle and private partition are absent from persisted source links,
  provider descriptors, board bridge messages, and cold-start torrent links. A page
  restored after a private claimed source persists only a restore-block marker and
  does not hand that HTTP URL to `getSourceUrl()`.
- A successful HTTP `.torrent` resolve replaces the corresponding accepted source
  with the canonical magnet from the Torrent Viewer service snapshot; an unresolved
  or failed HTTP source is never persisted.
- Claim a `.torrent` from a Tor page, let it resolve, restart Persephone, and verify
  that the torrent is listed from its persisted magnet and that no request is made to
  the original `.torrent` host after restart.
- The user sees exactly one platform notification reading “The metadata was fetched
  privately, but the swarm connection is not anonymous.” for a private claimed
  download. There is no consent prompt and no new board bridge call.
- A claimed download from an ordinary default-session page behaves exactly as it
  does today, including its existing routing and notification behavior.
- Non-claimed downloads, ordinary download dialogs, and non-Browser download paths
  are unchanged.
- `BOARD_BRIDGE_VERSION` and the torrent viewer's `minBridgeVersion` remain
  unchanged; the Torrent Viewer itself is bumped from `1.4.1` to `1.5.0` with
  matching README and WHATS-NEW updates.

## Implementation checklist

- [x] Implement the opaque main-process session handle, five-minute expiry, Tor liveness check, and `session-src` protocol.
- [x] Carry the transient handle through claimed-download IPC, link resolution, live HTTP providers, and board singleton routing.
- [x] Keep the handle out of storage, provider descriptors, board messages, and restored board source handshakes.
- [x] Keep the default-session claimed-download and non-claimed download paths unchanged.
- [x] Preserve the bridge contract and `BOARD_BRIDGE_VERSION`.
- [ ] Torrent Viewer changes in `C:/projects/persephone-boards` — separate repository run by instruction.
- [ ] Manual Tor/incognito/cold-start/range verification — not available in this run.
- [x] Run `npm run typecheck`, `npm run lint`, and `npm run build-prod`.

## Files changed

| File | Planned change |
| --- | --- |
| `src/main/session-src-protocol.ts` | Add opaque session-handle registry and generic session-backed protocol. |
| `src/main/main-setup.ts` | Register the privileged session-source scheme. |
| `src/main/download-service.ts` | Register private originating sessions, include the transient handle, and notify the user. |
| `src/main/tor-service.ts` | Resolve an active Tor partition from the originating Electron Session. |
| `src/ipc/api-types.ts` | Add optional `sessionHandle` to the claimed-download event payload. |
| `src/ipc/renderer/renderer-events.ts` | Mirror the claimed-download payload type. |
| `src/renderer/api/internal/RendererEventsService.ts` | Put the transient handle into link data. |
| `src/renderer/api/types/io.link-data.d.ts` | Declare the ephemeral session-handle field. |
| `src/renderer/content/link-utils.ts` | Carry session context into live HTTP descriptors. |
| `src/renderer/content/rebuild-pipe.ts` | Accept transient session context for host-side rebuilds. |
| `src/renderer/content/registry.ts` | Construct `HttpProvider` with the live handle. |
| `src/renderer/content/providers/HttpProvider.ts` | Fetch private claims through the session-source protocol and omit the handle from descriptors. |
| `src/shared/link-data.ts` | Strip the handle from persisted link data and nested descriptors. |
| `src/renderer/content/open-handler.ts` | Forward the handle through board opens and singleton queues. |
| `src/renderer/api/pages/PagesLifecycleModel.ts` | Preserve the handle through fresh and existing board-page opens. |
| `src/renderer/editors/board/BoardEditorModel.ts` | Track the source-URL-to-session map, persist the restore-block marker, and use matching context for claimed resources. |
| `doc/active-work.md` | Remove the US-1531 placeholder marker. |
| `src/main/tor-src-protocol.ts` | No change; use it as the session-aware protocol pattern. |
| `src/renderer/content/resolvers.ts` | No change; its existing link-data forwarding is sufficient. |
| `src/renderer/editors/board/BoardWebview.ts` | No change; its URL-only source bridge remains sufficient. |
| `src/ipc/board-bridge-channels.ts` | No change. |
| `src/shared/board-bridge-version.ts` | No change; no bridge version bump is needed. |
| `C:/projects/persephone-boards/boards/torrent-viewer/app.js` | Replace resolved HTTP accepted sources with canonical service magnets and avoid persisting unresolved HTTP sources. |
| `C:/projects/persephone-boards/boards/torrent-viewer/board-manifest.json` | Bump the Torrent Viewer release from `1.4.1` to `1.5.0`. |
| `C:/projects/persephone-boards/boards/torrent-viewer/WHATS-NEW.md` | Add the `1.5.0` persistence/privacy fix note. |
| `C:/projects/persephone-boards/boards/torrent-viewer/README.md` | Document that accepted HTTP sources become restorable canonical magnets. |
