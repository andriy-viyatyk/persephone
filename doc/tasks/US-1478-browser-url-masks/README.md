# US-1478: Browser URL masks route downloads into `openRawLink`

**Status:** Planned  
**Epic:** [EPIC-114: The torrent board — a module contributes below the UI](../../epics/EPIC-114.md)  
**Decision:** EPIC-114 D12 is binding. This document specifies its implementation; it does not reopen
the declaration, scope, or behaviour.

## Goal

Add the manifest field `browserUrlMasks`, a board-owned set of whole-URL globs separate from
`fileMasks`. When a download from a registered Browser guest matches a trusted or bundled board's winning
mask, cancel it before the save dialog, hand the original source URL to `openRawLink` targeted at
that board, write nothing to disk, and notify the user with the board name.

## Background

### D12 is the product contract

EPIC-114 D12 (2026-09-27) settles all product choices for this task:

- The declaration is a new `browserUrlMasks` manifest field. It is not an alias for `fileMasks`.
- Each value is a glob matched against the whole URL. It is normalized like the file-mask axis:
  trimmed, lowercased, de-duplicated, and bounded in count and length.
- The field affects downloads only. It must not capture ordinary Browser navigations; non-HTTP
  protocols already use the settled `contentProviders[].schemes` / `eOpenPipelineCandidate` path.
- A match is cancelled before the save dialog. The source URL, not a saved path or materialized
  file, goes through `openRawLink`. Nothing is written to disk.
- The user receives a notification naming the claiming board.
- Only trusted and bundled boards participate. Registration order is first-wins, and a refused
  claim is retained as a `CustomEditorRegistrationIssue`.

The torrent-viewer board is in the separate repository `C:/projects/persephone-boards` and is not
part of this task. When that repository adopts this feature, its eventual declaration is
`"browserUrlMasks": ["*://*/*.torrent", "*://*/*.torrent?*"]` — both forms, because a mask is
anchored at both ends and a query string would otherwise defeat the first one. See the Concerns
entry and EPIC-114 D12.

### Verified download path and the save-dialog constraint

`src/main/download-service.ts` is the interception point:

- `DownloadService.init()` subscribes to `session-created` and passes every session to
  `hookSession()` (`:20-34`).
- `hookSession()` subscribes to `will-download` and calls `handleWillDownload(item, webContents)`
  (`:27-32`).
- `handleWillDownload()` currently creates the download id, resolves a parent window, calls the
  synchronous `dialog.showSaveDialogSync()` through `withNativeDialogSync` (`:86-104`), cancels
  only when the user dismisses the dialog (`:106-110`), then calls `item.setSavePath()` and creates
  a `DownloadEntry` (`:112-127`).
- `item.getURL()` is already the URL persisted in the entry (`:117`); it is therefore the source
  URL needed by D12. `shell.openPath()` is only used by `openDownload()` for a completed entry
  (`:49-53`), not by `will-download`.

The match must happen at the very beginning of `handleWillDownload()`, before id generation is
observable, parent-window dialog lookup, `showSaveDialogSync`, `setSavePath`, or download tracking.
On a match the implementation will call `item.cancel()` and return immediately after sending the
targeted renderer events. No save path and no `DownloadEntry` are created for the rerouted download.

### Existing navigation machinery and the path correction

US-1476 is already implemented in the current source. The requested path
`src/renderer/api/events/RendererEventsService.ts` does not exist. The actual file is
`src/renderer/api/internal/RendererEventsService.ts`:

- `src/main/browser-service.ts:287-309` handles page-initiated `will-navigate`. It leaves
  `http:`, `https:`, `about:`, `blob:`, `mailto:`, and `tel:` in Chromium, prevents other
  protocols, and sends `EventEndpoint.eOpenPipelineCandidate` to the owning host renderer.
- The same file documents the load distinction: `will-navigate` covers links, forms, and
  `window.location`, but not programmatic `loadURL()`.
- `src/renderer/api/internal/RendererEventsService.ts:30-31` subscribes to both `eOpenUrl` and
  `eOpenPipelineCandidate`. Its `handlePipelineCandidate` at `:84-91` extracts the scheme,
  checks `isSchemeRegistered()`, and calls
  `app.events.openRawLink.sendAsync(createLinkData(url))` under `guard()`.
- `src/ipc/api-types.ts:325-381` and `src/ipc/renderer/renderer-events.ts:86-92` are the typed
  event declaration and renderer subscription used by that navigation half.

The download half cannot use `eOpenPipelineCandidate`: a matching download is an ordinary
`http(s)` URL and the pipeline-candidate handler is deliberately a registered-scheme gate. The
download route needs a separate typed renderer event carrying the source URL and the winning board
root. The renderer will turn that into `createLinkData(url, { target: boardEditorId(boardRoot) })`
and call the existing `openRawLink` event. The URL remains the source; the target is routing
metadata so a board with only `browserUrlMasks` can receive the URL without pretending that its
`fileMasks` claim is the same declaration.

### Load-bearing design answer: renderer snapshot, main matching

Main cannot consult `customEditorRegistry` synchronously from `will-download`. The registry is
renderer-owned, and `handleWillDownload()` must make its decision before returning from the
synchronous save-dialog path. Cancelling every download while awaiting the renderer would break
ordinary downloads.

The implementation will use this split:

1. The renderer resolves trust, bridge compatibility, normalization, and first-wins collisions in
   `CustomEditorRegistry.refresh()`. It pushes an immutable, already-resolved snapshot of accepted
   browser URL claims to main over a new typed `Endpoint`/IPC method. The snapshot contains the
   board root, display name, and normalized masks in registration order.
2. Main stores the latest generation of that snapshot in `download-service.ts` and performs the
   bounded whole-URL glob match synchronously inside `handleWillDownload()`. Main does not read
   manifests, decide trust, or independently resolve collisions. This is the right split because
   the decision is main-process work at an Electron synchronous event boundary, while ownership is
   renderer-registry work.
3. A URL matching several distinct masks uses the first accepted claim in snapshot order. An exact
   normalized duplicate mask is refused during registry rebuild, recorded as a
   `CustomEditorRegistrationIssue`, and omitted from the pushed snapshot. This mirrors exact-name
   scheme collisions while keeping overlapping globs deterministic.

The existing renderer-to-main `initBoardTrustSync()` in
`src/renderer/api/board-trust-sync.ts` is the precedent: it derives a trusted/bundled snapshot,
pushes it through a typed `Endpoint.syncTrustedBoardSnapshot`, and uses a generation to reject
stale updates in main. `src/main/published-boards-service.ts` is not a registry channel: it fetches
and caches the remote catalog, then broadcasts `ePublishedBoardsUpdated`. It contains no live
trusted-board mask ownership and must not be used for this route. US-1478 should add a dedicated
browser-URL snapshot endpoint, following the trusted-snapshot pattern without coupling download
routing to the module-service supervisor.

#### Refresh timing

`CustomEditorRegistry` already subscribes in its constructor to:

- `boardTrust.subscribePaths()` for trust and untrust;
- `bundledBoardRegistry.subscribe()` for bundled-source changes; and
- `settings.onChanged` for `disabled-bundled-boards`.

Each callback invokes `refresh()`. `ensureInitialized()` also loads trust and install state,
initializes bundled boards, and calls `refresh()` before exposing the registry. Catalog installation
alone remains untrusted and therefore cannot publish a claim; the existing register flow trusts the
board and explicitly awaits `customEditorRegistry.refresh()` in
`src/renderer/editors/board-info/BoardInfoEditorModel.ts:655-659`. Catalog uninstall calls
`boardTrust.untrust()` in `src/renderer/api/board-install.ts`, which triggers the same refresh
subscription before the install record is removed.

The new snapshot must be rebuilt at the settled rebuild site: `CustomEditorRegistry.refresh()`,
after its `sources` have been filtered through the bridge-compatibility gate and after browser-mask
collisions have been resolved, alongside the final `this.state.update()` at `:489-494`. Publishing
from this site means a newly trusted, untrusted, installed-and-trusted, disabled, or removed board
takes effect without a restart and the pushed claims are exactly the claims the renderer registry
accepts.

On a cold start, `downloadService.init()` is installed in main from `src/main/main-setup.ts:73-79`
before the renderer has completed `app.init()` and before the renderer's board registry can push
its first snapshot. Therefore the honest first-download behaviour is: if no snapshot has arrived
yet, main has no claims and the download proceeds through the existing save dialog normally. This
is a bounded startup race, not a reason to cancel every download. Later downloads use the pushed
snapshot; a stale or absent snapshot never silently captures an ordinary download.

### WebContents scope

`will-download` is hooked at the session level, so it can observe downloads from the app window,
Browser guest webviews, and other content using a hooked session. D12 applies only to downloads
originating from Browser-editor webviews:

- `src/renderer/editors/browser/BrowserView.ts:113-124` sends each guest webContents id to
  `BrowserChannel.register` on `dom-ready`.
- `src/main/browser-service.ts:184-194` stores those guests in the private `registrations` map,
  keyed by `${tabId}/${internalTabId}`, and keeps the owning host renderer in
  `senderWebContents`.
- The download service must use an exported browser-service predicate for that registration map.
  A download from the app's own main-window webContents, a board frame, or an unrelated session is
  left on the ordinary download path. The `hostWebContents` already used defensively by
  `getParentWindow()` is the host to which the targeted open and notification events should be
  sent; do not broadcast through `openWindows`.

US-1476's navigation distinction is not needed here. `BrowserView.ts:470` calls
`BrowserWebviewModel.navigateWebview()` whenever the active tab URL state changes, including when
the user types a URL into the Browser URL bar; `navigateWebview()` (`:175-186`) cannot distinguish
that from another caller because it sees only the changed URL. The recovery calls at `:251` and
`:254` navigate to `previousUrl` or `DEFAULT_URL` on the blocked-protocol recovery path
(`:240-256`) and cannot produce a download. More importantly, a URL that produces a download never
becomes the tab URL because Chromium replaces the navigation with the download, so a restored
Browser tab does not hold an attachment URL in `currentUrls`.

Keep `isRegisteredBrowserWebContents(webContents)` as the complete scope check. The registered
guest object is held directly in `browser-service.ts:67-72`, so the predicate is a cheap identity
check over `registrations`; app-window and unrelated-session downloads remain ordinary. An
MCP-driven Browser navigation to a claimed URL therefore **will** route to the board. That is
deliberate: it is a download from a registered Browser guest, and routing it is the desired D12
behaviour rather than a programmatic-navigation hijack.

### Trust, collisions, and manifest compatibility

`CustomEditorRegistry.refresh()` already enumerates trusted roots first and enabled bundled boards
second (`:313-329`), skips incompatible boards using `getBoardCompatibility()` and
`BOARD_BRIDGE_VERSION` (`:330-341`), and excludes untrusted catalog-installed boards from active
registrations (`:376-397`). Browser claims must be collected in that same trusted-then-bundled
order and after the same compatibility check.

The provider and scheme paths establish the collision precedent:

- `registerProvider()` / `registerScheme()` retain the existing registration when a board claim
  collides and return `{ accepted: false, reason, owner }`.
- `custom-editor-registry.ts:449-482` turns rejected provider, scheme, and capability results
  into `CustomEditorRegistrationIssue` records through `addRegistrationIssue()`.
- `CustomEditorRegistrationIssue` is currently the union at `:125-129`; add a distinct
  `"browser-url-mask"` kind and make the Board Info warning label render it as **Browser URL mask**
  rather than falling through to the existing Capability label.

`BOARD_BRIDGE_VERSION` in `src/shared/board-bridge-version.ts` must not move. This is an
application-consumed manifest field, not a new board-facing bridge method, channel, or shim API.
Older Persephone builds ignore the unknown optional field; the current bridge compatibility gate
continues to govern boards that require a newer bridge for actual board APIs. Likewise,
`BOARD_MANIFEST_SCHEMA_VERSION` remains `1`: adding an optional, backward-compatible field is not a
breaking manifest-shape change.

## Implementation Plan

### 1. Add and normalize the independent manifest axis

- Edit `src/renderer/editors/board/board-manifest.ts`.
- Add `browserUrlMasks?: string[]` to `BoardManifest` with a comment that masks are whole-URL
  download claims and are independent of `fileMasks`.
- Add `normalizeBrowserUrlMasks(raw: unknown): string[]`. It should accept only string entries,
  trim and lowercase them, discard empty entries, discard entries longer than an explicit bound
  (`MAX_BROWSER_URL_MASK_CHARS = 512`), stop after an explicit count bound
  (`MAX_BROWSER_URL_MASKS = 64`), and de-duplicate while preserving order. Unlike
  `normalizeFileMasks`, it must not turn a bare word into an extension mask: URL claims must be
  authored as URL globs or exact URL strings.
- Import `matchesBrowserUrlMask(url, mask)` from a new shared helper in
  `src/shared/browser-url-masks.ts`, whose escaped glob compiler copies the shape of
  `maskToRegExp()` / `matchesFileMask()` (`:516-533`). The helper is imported by both
  `board-manifest.ts` and `download-service.ts`, so the two processes cannot silently implement
  different `*`/`?` semantics or escaping. It is anchored at both ends and never accepts a regex
  supplied by a board.

Before:

```ts
export interface BoardManifest {
    // ...
    fileMasks?: string[];
    folderMasks?: string[];
}
```

After:

```ts
export interface BoardManifest {
    // ...
    fileMasks?: string[];
    /** Whole-URL globs for Browser downloads; independent of fileMasks. */
    browserUrlMasks?: string[];
    folderMasks?: string[];
}

export function normalizeBrowserUrlMasks(raw: unknown): string[] { /* bounded, normalized */ }
```

`src/shared/browser-url-masks.ts` owns the compiler and `matchesBrowserUrlMask()`. Its copied
`maskToRegExp()` shape uses the existing `"i"` flag, so matching is already case-insensitive on
both sides; lowercasing the mask is normalization and does not require a separate
`url.toLowerCase()` step.

Do not add this field to `BoardEditorAssociation`: a board with only browser URL claims must still
register, and the file-editor association is a separate axis.

### 2. Resolve claims and refusals in `CustomEditorRegistry.refresh()`

- Edit `src/renderer/editors/board/custom-editor-registry.ts`.
- Extend `CustomEditorRegistrationIssueKind` with `"browser-url-mask"`.
- Add a `BrowserUrlMaskClaim` state shape containing `boardRoot`, display `name`, and normalized
  masks, plus a `browserUrlMaskClaims` array in `CustomEditorRegistryState` and `defaultState`.
- Add a synchronous getter for the accepted claims so the renderer can inspect the same data that
  is pushed to main.
- During the existing `for (const source of sources)` loop, after compatibility acceptance and
  before the `if (!assoc) continue` file-editor shortcut, normalize `manifest?.browserUrlMasks`.
  Use the already-established board name expression (manifest `name`, then `fpBasename(root)`).
  For each normalized mask, keep the first claim in a `Map<string, ...>` / ordered list. For an
  exact duplicate, call `addRegistrationIssue()` with kind `browser-url-mask`, the normalized mask
  as `name`, the same owner-aware refusal reason shape as `registerScheme()`, and the winning root
  as `owner`; do not add the refused mask to the accepted claim list.
- Preserve order as trusted roots followed by bundled boards. Keep distinct overlapping masks in
  that order; main's first matching claim wins. Do not inspect untrusted `boardInstallRegistry`
  entries as browser claims.
- After the existing generation check and just before/alongside the final state commit, publish a
  new generation-tagged snapshot to main. Use a clock-seeded monotonic generation (`Date.now()` as
  the initial seed, then increments), following `board-trust-sync.ts:16-21`; main keeps the highest
  generation it has seen and ignores lower generations. Do not send a partially rebuilt state.

Before:

```ts
interface CustomEditorRegistryState {
    entries: CustomEditorMatch[];
    settingsBoards: BoardSettingsRegistration[];
    incompatibilities: CustomEditorIncompatibility[];
    registrationIssues: CustomEditorRegistrationIssue[];
}
```

After:

```ts
interface CustomEditorRegistryState {
    entries: CustomEditorMatch[];
    browserUrlMaskClaims: BrowserUrlMaskClaim[];
    settingsBoards: BoardSettingsRegistration[];
    incompatibilities: CustomEditorIncompatibility[];
    registrationIssues: CustomEditorRegistrationIssue[];
}
```

The snapshot publication belongs at `CustomEditorRegistry.refresh()`, not only in a trust-dialog
caller: the constructor subscriptions are what make untrust and bundled-source changes live, and
the explicit `BoardInfoEditorModel.register()` refresh is only one caller.

### 3. Add the renderer-to-main snapshot contract

- In `src/ipc/api-param-types.ts`, add the structured payload types, for example:

  ```ts
  export interface BrowserUrlMaskClaim {
      boardRoot: string;
      boardName: string;
      masks: string[];
  }

  export interface BrowserUrlMaskSnapshot {
      generation: number;
      claims: BrowserUrlMaskClaim[];
  }
  ```

- In `src/ipc/api-types.ts`, add `Endpoint.syncBrowserUrlMaskSnapshot` to the renderer-to-main
  endpoint enum and its `Api` function signature.
- In `src/ipc/renderer/api.ts`, add the typed `syncBrowserUrlMaskSnapshot()` wrapper using
  `executeOnce()`.
- In `src/ipc/main/board-handlers.ts`, include the endpoint in `BoardEndpoint` and bind it to a
  new `downloadService.syncBrowserUrlMaskSnapshot(snapshot)` method. Validate the generation and
  wire shape defensively at this boundary; the renderer is trusted application code, but IPC data
  still needs a safe default.
- Keep `syncTrustedBoardSnapshot` and `moduleServiceSupervisor` unchanged. The existing channel is
  the design precedent, not the ownership target for browser downloads.

### 4. Make main's download decision synchronous and Browser-scoped

- In `src/main/browser-service.ts`, export a narrow predicate such as
  `isRegisteredBrowserWebContents(webContents)`. The predicate must check the actual guest object
  in `registrations`; it must not infer Browser ownership from the session or parent window.
- In `src/main/download-service.ts`, hold the latest accepted snapshot and its generation. Add a
  synchronous `findBrowserUrlClaim(url)` that scans claims in order and uses the same whole-URL
  glob semantics as the renderer normalizer. A missing snapshot means no claim.
- At the first lines of `handleWillDownload(item, webContents)`, return to the existing path when
  `isRegisteredBrowserWebContents(webContents)` is false. For a registered guest, match the source
  URL synchronously before entering the existing save-dialog body.
- For an eligible match, capture `item.getURL()`, call `item.cancel()`, and send two targeted
  events to the Browser host renderer obtained from `hostWebContents`:
  1. a new typed `eOpenClaimedBrowserDownload` payload containing the source URL and `boardRoot`;
  2. the existing `eBoardNotify` payload with an informational message naming `boardName`.
  Do not call `dialog.showSaveDialogSync()`, `item.setSavePath()`, `openWindows.send()`, or any
  download tracking method on this branch.

Before:

```ts
private handleWillDownload(item: DownloadItem, webContents: WebContents): void {
    const id = this.generateId();
    // parent lookup → showSaveDialogSync → setSavePath → DownloadEntry
}
```

After:

```ts
private handleWillDownload(item: DownloadItem, webContents: WebContents): void {
    if (!isRegisteredBrowserWebContents(webContents)) {
        return this.handleOrdinaryDownload(item, webContents);
    }
    const claim = this.findBrowserUrlClaim(item.getURL());
    if (claim) {
        item.cancel();
        sendToBrowserHost(webContents, EventEndpoint.eOpenClaimedBrowserDownload, {
            url: item.getURL(),
            boardRoot: claim.boardRoot,
        });
        sendToBrowserHost(webContents, EventEndpoint.eBoardNotify, {
            message: `${claim.boardName} claimed this download and opened its source URL.`,
            type: "info",
        });
        return;
    }
    return this.handleOrdinaryDownload(item, webContents);
}
```

`handleOrdinaryDownload()` is a mechanical extraction of the current id/dialog/tracking body; it
must preserve the current save-folder memory, progress events, persistence, and cancellation
semantics. The new route is the only path that bypasses that body.

### 5. Route the source URL through the existing renderer open pipeline

- In `src/ipc/api-types.ts`, add an `EventEndpoint.eOpenClaimedBrowserDownload` payload type, plus
  the existing `eBoardNotify` type remains unchanged.
- In `src/ipc/renderer/renderer-events.ts`, expose the matching typed event.
- In the actual `src/renderer/api/internal/RendererEventsService.ts`, subscribe to the new event.
  Its handler must call:

  ```ts
  await guard("Failed to open URL", () =>
      app.events.openRawLink.sendAsync(
          createLinkData(data.url, { target: boardEditorId(data.boardRoot) }),
      ),
  );
  ```

  This is the same `createLinkData()` → `openRawLink` machinery used by `handlePipelineCandidate`
  at `:84-91`, but it carries an explicit board target because `browserUrlMasks` is deliberately
  independent of `fileMasks`. The payload's `url` is exactly `DownloadItem.getURL()`.
- Subscribe the existing `eBoardNotify` path unchanged. `RendererEventsService.handleBoardNotify`
  already calls `ui.notify(data.message, data.type ?? "info")` (`:116-118`); this is the existing
  notification mechanism and the message must name the board. Although the event is named
  `eBoardNotify`, its handler carries no provenance and is only a bare `ui.notify(message, type)`;
  reusing it is therefore consistent for this Browser-originated notification.
- Do not use `eBoardOpenRawLink`: its existing handler stamps `sourceId: "board"`, which would
  misrepresent a Browser-originated download. Do not use `eOpenPipelineCandidate`: it is the
  scheme-registration path and would not carry the winning URL-mask board target.

### 6. Surface refused browser-mask claims in Board Info

- In `src/renderer/editors/board-info/BoardInfoEditorView.ts:432-445`, extend the existing
  issue-kind label selection so `browser-url-mask` renders as **Browser URL mask**. The model
  already obtains `CustomEditorRegistrationIssue[]` from `customEditorRegistry`, so no new data
  loading path is needed.
- Keep the existing issue reason and owner display. A duplicate should tell the user which board
  owns the first registration, matching scheme/provider refusal diagnostics.

### 7. Verify manually; do not add tests or implement the board-repo change

- No unit tests or test harnesses: this repository does not use them. Verification is source
  inspection, the project checks used by implementation, and live app/MCP observation.
- Verify a trusted fixture board with `browserUrlMasks: ["*://*/*.torrent", "*://*/*.torrent?*"]` and a disposable
  Browser page whose response becomes a download:
  - the matching download is cancelled before any native save dialog appears;
  - the source URL reaches the board editor through `openRawLink`, with no saved file and no
    download-manager entry;
  - the notification names the board;
  - an ordinary non-matching download still opens the existing save dialog and tracks normally.
- Verify a download from the app renderer or a non-Browser webContents is never rerouted.
- Verify an MCP-driven Browser navigation to a claimed URL is deliberately intercepted.
- Verify trust, untrust, catalog install→trust, catalog uninstall, bundled-board refresh, and
  disabled-bundled-board changes update the main snapshot without restarting. Verify the first
  cold-start download before the initial snapshot arrives downloads normally.
- Verify two trusted/bundled boards with the same normalized mask: the earlier source wins, the
  later claim is absent from the main snapshot, and Board Info records a `browser-url-mask`
  `CustomEditorRegistrationIssue` with the winning owner.
- Verify an incompatible board and an untrusted installed board never publish claims.
- Run `npm run typecheck`, `npm run lint`, and `npm run build-prod` after implementation is
  authorized. Do not modify `C:/projects/persephone-boards` in this task.

## Concerns

- **Cold-start race is explicit:** before the renderer pushes its first snapshot, a matching URL
  downloads normally. This is the honest result of preserving ordinary downloads at a synchronous
  main-process boundary.
- **MCP routing is deliberate:** a Browser guest navigated by MCP to a claimed URL is routed to the
  board, just like a user-entered claimed URL. Browser guest identity is the intended D12 scope;
  there is no programmatic-load marker because download interception cannot and need not distinguish
  those initiators.
- **Snapshot staleness:** main must ignore older generations, and a renderer refresh must publish
  the empty snapshot after untrust/removal so a stale board cannot keep claiming URLs.
- **Overlapping but non-identical globs:** exact duplicate masks are refused and recorded; distinct
  masks remain ordered and the first matching claim wins. This gives deterministic behaviour
  without pretending arbitrary glob-overlap analysis is the same as exact scheme collision.
- **Board target validity:** the renderer must construct the target from the accepted board root,
  not trust a board-supplied editor id. `boardEditorId()` preserves the root format required by
  `BoardEditorModel`.
- **Existing Board Info display is exhaustive today:** adding a new issue kind without its label
  would misreport the refusal as a Capability warning; that UI change is part of this task.
- **Masks are anchored, so a query string defeats the obvious mask.** Measured against the shipped
  `matchesBrowserUrlMask` on 2026-09-27: `*://*/*.torrent` matches `https://x.org/a.torrent` and
  does NOT match `https://x.org/a.torrent?dl=1`. This is correct glob behaviour and matches
  `fileMasks`, but it is a trap for a board author copying the worked example, so the example in
  D12 and in this document now declares the `?*` form alongside. Matching is case-insensitive
  (verified: `https://X.ORG/A.TORRENT` matches), so lowercasing the mask is normalization only.
- **No bridge/API version bump:** `browserUrlMasks` is a host-consumed optional manifest field,
  not a board-facing bridge contract.

## Acceptance Criteria

- [ ] `BoardManifest` accepts `browserUrlMasks` without changing `fileMasks` semantics; masks are
  trimmed, lowercased, de-duplicated, bounded, and matched against the entire URL with anchored
  glob semantics.
- [ ] Only trusted and enabled bundled boards publish accepted browser URL claims; incompatible,
  untrusted, or refused claims are absent from the main snapshot.
- [ ] Exact normalized mask collisions are first-registration-wins and produce a
  `CustomEditorRegistrationIssue` shown as **Browser URL mask**, with the winning owner retained.
- [ ] The snapshot is rebuilt from `CustomEditorRegistry.refresh()` after trust/bundled/disabled
  source changes, and main rejects stale generations; no restart is required for trust or removal
  changes.
- [ ] A matching download from a registered Browser guest is cancelled before
  `showSaveDialogSync`, `setSavePath`, or download tracking; no file is written and no download
  entry is created.
- [ ] The exact source URL from `DownloadItem.getURL()` reaches `openRawLink`, targeted at the
  claiming board, and the user receives an existing `ui.notify`-backed notification naming that
  board.
- [ ] Non-Browser downloads, non-matching Browser downloads, and the first cold-start download
  before a snapshot arrives retain the ordinary save-dialog path.
- [ ] An MCP-driven Browser navigation to a claimed URL is routed to the board deliberately; app
  window and non-Browser downloads remain on the ordinary path.
- [ ] The torrent-viewer board repository is not changed; its future declaration is only
  documented as `*://*/*.torrent`.
- [ ] No unit tests or test harnesses are added, no implementation is performed in this task, and
  no commit is created.

## Files Changed

| File | Planned action | Reason |
|---|---|---|
| `doc/tasks/US-1478-browser-url-masks/README.md` | Add | This implementation-ready task document. |
| `doc/active-work.md` | Change | Fix the existing US-1478 row to link here; do not add a second row. |
| `src/renderer/editors/board/board-manifest.ts` | Change | Declare and normalize `browserUrlMasks` as a separate whole-URL axis; import the shared matcher. |
| `src/renderer/editors/board/custom-editor-registry.ts` | Change | Resolve trusted/bundled claims, first-wins collisions, issues, and the pushed snapshot at `refresh()`. |
| `src/renderer/editors/board-info/BoardInfoEditorView.ts` | Change | Display the new registration-issue kind correctly. |
| `src/ipc/api-param-types.ts` | Change | Define the browser URL-mask snapshot/claim payloads. |
| `src/ipc/api-types.ts` | Change | Add the renderer-to-main snapshot endpoint and targeted download-open event. |
| `src/ipc/renderer/api.ts` | Change | Expose the typed snapshot push wrapper. |
| `src/ipc/main/board-handlers.ts` | Change | Bind the snapshot endpoint to the download service. |
| `src/ipc/renderer/renderer-events.ts` | Change | Expose the targeted Browser-download event to the renderer service. |
| `src/renderer/api/internal/RendererEventsService.ts` | Change | Hand the source URL to `openRawLink` with the accepted board target; reuse existing `ui.notify` handling. |
| `src/main/download-service.ts` | Change | Store/match the snapshot and cancel eligible downloads before the synchronous save dialog. |
| `src/main/browser-service.ts` | Change | Expose Browser-webview ownership for the identity-based scope check. |
| `src/shared/browser-url-masks.ts` | Add | Share the case-insensitive whole-URL glob compiler and matcher between renderer and main. |
| `src/shared/board-bridge-version.ts` | No change | This is not a board-facing bridge API. |
| `src/main/published-boards-service.ts` | No change | It serves the remote catalog, not the live trusted-board registry. |
| `src/renderer/api/board-trust-sync.ts` | No change | Its service snapshot is the IPC precedent; browser claims are resolved by `customEditorRegistry.refresh()`. |
| `src/renderer/api/events/RendererEventsService.ts` | No change / nonexistent | The requested path is absent; the actual service is `src/renderer/api/internal/RendererEventsService.ts`. |
| `src/renderer/editors/board/board-install-registry.ts` | No change | Existing trust/untrust/install lifecycle remains the source of refresh triggers. |
| `C:/projects/persephone-boards/boards/torrent-viewer/board-manifest.json` | No change | Different repository and explicitly out of scope. |
