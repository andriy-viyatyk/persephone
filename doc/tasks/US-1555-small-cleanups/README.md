# US-1555: Small dead code, stale comments and a torrent-specific notice in core

## Goal

Re-audit every US-1555 candidate against the current post-US-1556 source, remove only findings that remain, and record already-landed findings with their fixing story or commit. Recommend the smallest safe approach for the torrent notice and decide whether the board bridge version changes.

## Background

US-1555 is the final structure story in EPIC-115. US-1534–US-1554 and US-1556 landed after the original inventory, so the epic's line references are historical. The audit below records the current source evidence, including the three follow-up findings discovered during earlier story work. The epic's standing rules require a `BOARD_BRIDGE_VERSION` bump whenever a board-visible contract changes; only changed message paths require twice-live invocation. Cross-repo board changes are documented as plans because `../persephone-boards` is read-only for this task.

### Per-item audit

| # | Candidate | Audit result | Current source finding |
|---|---|---|---|
| 1 | Torrent wording / private-session status | **Still present → fix** | src/main/download-service.ts sends a torrent-specific eBoardNotify whenever a claimed download has a sessionHandle; delete only that notice and keep the generic “board claimed this download” notice. sessionHandle is created only for a Tor partition or non-persistent session and already reaches BoardEditorModel. For runtime opens, make pendingSourceUrls hold { sourceUrl, privateSession: Boolean(sessionHandle) }; BoardWebview sends optional privateSession on BoardSourceOpenedMsg only when true; board-shim buffers it with the URL and delivers source.onOpen({ url, sourceUrl, privateSession? }). Do not add the boolean to eOpenClaimedBrowserDownload, RendererEventsService, ILinkData, cleanForStorage, EditorOpenContext, PageNavigator, or PagesLifecycleModel. The register-session path does not need to enqueue a runtime event, but it DOES need to preserve initial privacy status: it registers the session handle for a fresh board whose initial URL arrives through getSourceUrl()/BoardPortInitMsg. BoardEditorModel should retain whether that initial source is private and include the status in the init handshake; expose it as an initialSourcePrivateSession property on the board source API. This lets Torrent Viewer warn for fresh and reused pages. Grep found the board-facing shape in board-api.d.ts and board-shim.ts. doc/architecture/overview.md mentions source.onOpen() but not its payload shape; add a bridge 1.24.0 note there. No shipped board-authoring guide duplicates the event shape. BOARD_BRIDGE_VERSION: bump 1.23.0 → 1.24.0 for the source event and initial-source property. |
| 2a | `resolveTotalSize()` duplicate `stat()` branches | **Still present → fix** | `src/renderer/editors/board/board-pipe-handler.ts:71-101` has a pre-stat `hasDirectStream()` branch and a direct-stream branch that both call `pipe.stat()`. Keep the post-stat capability recheck: `createReadStream` is a getter whose value can change after provider capabilities arrive. Consolidate validation and memoization around one stat result without reusing the stale pre-await getter value. |
| 2b | `PendingRead.cancelled` | **Still present → fix** | `PendingRead` has both `cancelled` and `controller`; handlers test `!pending.cancelled`, while every cancellation path also aborts the controller. Check `pending.controller.signal.aborted` and map identity instead, then remove the duplicate flag. |
| 2c | Three copies of pending-read cancellation | **Still present → fix** | `handleCancel()`, `invalidateBoardPipePage()`, and `invalidateBoardPipeResource()` each mark the read canceled, abort it, and delete it from `pendingReads`. Factor that sequence into one helper and call it from all three paths. |
| 3a | `PagesModel.resubscribeEditor` | **Still present → fix** | `src/renderer/api/pages/PagesModel.ts:108` remains a no-op with a broken historical comment; `rg` finds no callers. Delete the method and its comment. |
| 3b | Empty src/renderer/editors/draw/ folder | **Still present → fix** | Rechecked now: Test-Path is true and Get-ChildItem -Force reports no children; git ls-files reports no tracked files. Remove the empty local directory; it cannot itself appear in a Git diff. |
| 3c | Hand-rolled case folding in `bundled-board-registry.ts` | **Still present → fix** | `resolvePersistedRoot()` still manually lowercases `parentName`, `candidateId`, and `record.id` on Windows despite importing `fpNormalizeForCompare`. Replace component comparisons with that existing helper while preserving the platform-sensitive path behavior. |
| 3d | `author/name` identity assembled twice | **Still present → fix** | `src/renderer/editors/board/custom-editor-registry.ts` builds `settingsNamespace` from trimmed manifest identity; `src/renderer/api/board-namespace.ts` repeats the same trim/build in `resolveBoardNamespace()`. Share one helper for the stable identity value and consume it from both places. |
| 3e | Repeated `initialize: undefined as undefined` | **Still present → fix** | `src/renderer/api/app-service-registry.ts` currently contains 11 such entries (the historical count of 12 is stale) and no `defineService()` helper. Introduce a typed helper that omits `initialize` when absent; retain the real initializer for `downloads` and `capabilities`. |
| 4a | `board-shim.ts` storage comment sits on `service` | **Still present → fix** | The “Main-owned per-board JSON storage” comment is still immediately above `service:` at lines 1550–1551; a correct copy is also above `storage:` at 1575–1576. Replace the misplaced comment with a service description. `git blame` attributes the misplaced copy to commit `b79c8cf` (US-1468); it was not corrected by US-1543. |
| 4b | `board-storage.ts` future-adapter comment | **Still present → fix** | `src/main/board-storage.ts:33` still calls its operation contract a “future service adapter (US-1468)” although the service adapter exists. Describe its current service/bridge role. |
| 4c | `app.ts` CLI comment | **Still present → fix** | `src/renderer/api/app.ts:initPages()` still says it “handles CLI arguments”; remove that stale responsibility from the comment. |
| 5 | Platform roadmap listed as an unscheduled proposal | **Still present → fix** | `doc/tasks/backlog.md` still labels the platform roadmap a proposal under “Recorded Epics (not currently planned).” The roadmap document and completed epic index exist; EPIC-114 records the roadmap's last phase as completed. Change the backlog text to a completed historical pointer to `doc/platform-roadmap.md` and `doc/epics/completed.md`. |
| 6 | Toolbar update leaves a stale button aria-label | **Still present → fix (small)** | BoardToolbarControls.updateCatalog() → ToolbarControlRecord.updateDescriptor() → IconButtonView.update() calls this.view.update(this.buttonProps()); buttonProps() derives aria-label from labelOf(descriptor), so the updated title/label is supplied. IconButtonView.applyProps() ignores _rest, leaving the construction-time accessible name. Audited 8 dynamic rest-prop paths: BoardToolbarControls, Toolbar story, PageTab close button, PageTab sound button, Select chevron, MultiSelect chevron, Input story slot button, and DialogContent close button. All re-supply their aria-label, data-part, or tabIndex on update; no risky caller omits a construction-time rest prop. onClick is handled separately and reads the latest props. Therefore apply rest props on every update and remove the duplicate construction-only application. |
| 7 | Late MissingProvider delegate watch | **Still present → fix (small)** | registry.ts subscribes to registry availability and this.delegate?.watch() only at watch() time. Attach watchers registered before delegate resolution when resolveOnce() installs the delegate. MissingProvider.dispose() must dispose and clear retained delegate watchers as well as the delegate. A watcher registered after the delegate already resolved must attach directly at watch() time, preserving current behavior. |
| 8 | Same HLS URL submitted twice leaves player state loading | **Still present → fix (small)** | submitUrl() resets playerState to loading but the HLS path keeps the same streamUrl; VPlayer.syncHlsSource() returns when URL and headers match, so it emits no new load state. A no-op is wrong because same-URL resubmit is the retry action after an error. Add a monotonically increasing transient reload key to VideoEditorState, bump it in submitUrl(), pass it to VPlayer, and rebuild HLS when the key changes even if source and headers match. For native media on ordinary HTTP/local/pipe sources, startSource() clears streamUrl and creates a fresh session URL (video-stream-server.ts uses randomUUID), so the native src changes and retries; an HLS URL falling back to native when Hls.js is unsupported still needs video.load() when the reload key changes. Do not persist the key: omit it from getRestoreData() and do not restore it in applyRestoreData(). |

## Implementation Plan

Implementation is complete: steps 1 and 3–8 here, step 2 in `../persephone-boards` (develop, 016a67e), step 9 per the Verification section. None requires US-1558, so `doc/tasks/backlog.md` needs only the platform-roadmap status correction below; no follow-up entry was created.

1. [x] **Make private-session context board-owned.** Delete only the torrent-specific eBoardNotify from src/main/download-service.ts. Change BoardEditorModel.pendingSourceUrls to records and compute privateSession from the existing sessionHandle in enqueueSourceUrl(); have BoardWebview.ts send optional privateSession only when true in BoardSourceOpenedMsg (src/ipc/board-bridge-channels.ts), and have src/board-shim.ts buffer and deliver the field through source.onOpen(). For fresh pages, retain the initial private-session fact in BoardEditorModel.registerSourceSessionHandle(), put optional initialSourcePrivateSession on BoardPortInitMsg, and expose it as PersephoneSourceApi.initialSourcePrivateSession so the board can warn alongside getSourceUrl(). Update the matching board-facing shape in src/renderer/editors/board/board-api.d.ts and local shim interface; add the 1.24.0 payload note to doc/architecture/overview.md. No boolean plumbing is needed in claimed-download IPC, RendererEventsService, ILinkData/cleanForStorage, EditorOpenContext, PageNavigator, or PagesLifecycleModel: their existing sessionHandle is sufficient to derive it at BoardEditorModel. Do not queue register-session as a runtime source-open; it describes the initial source. Bump src/shared/board-bridge-version.ts 1.23.0 → 1.24.0. Do not send the secret sessionHandle to board code or persist the derived Boolean.

2. [x] **Torrent Viewer cross-repo change (done in persephone-boards develop 016a67e; ../persephone-boards).** In ../persephone-boards/boards/torrent-viewer/app.js, show its existing swarm-privacy notice when event.privateSession === true in the source.onOpen handler and check initialSourcePrivateSession for the initial getSourceUrl() flow. Plan board-manifest.json version 1.7.2 and a WHATS-NEW.md line under ## 1.7.2 noting that the board-owned notice uses bridge 1.24.0. Keep minBridgeVersion at 1.22.0: an older 1.23 host still shows the existing core notice, and retaining 1.22 compatibility avoids locking users out. Follow the sibling repo develop → main publishing convention; leave its generated manifests untouched.

3. [x] **Simplify board pipe bookkeeping.** In src/renderer/editors/board/board-pipe-handler.ts, unify the stat-result validation/memoization in resolveTotalSize() while re-reading createReadStream after the await; remove PendingRead.cancelled and gate replies on !controller.signal.aborted plus current map identity; add one abort/delete helper used by handleCancel(), invalidateBoardPipePage(), and invalidateBoardPipeResource().

4. [x] **Remove verified dead code and repeats.** Delete the unused no-op PagesModel.resubscribeEditor in src/renderer/api/pages/PagesModel.ts. Remove the empty local src/renderer/editors/draw/ directory if present (there are no tracked children). In src/renderer/editors/board/bundled-board-registry.ts, use fpNormalizeForCompare for Windows path-component comparisons. Extract the stable trimmed author/name helper for custom-editor-registry.ts and src/renderer/api/board-namespace.ts. In src/renderer/api/app-service-registry.ts, introduce a typed defineService() helper so services without initialization omit the property; retain the two real initializers.

5. [x] **Correct stale comments and backlog status.** In src/board-shim.ts, replace the duplicate storage comment above service: with service-protocol wording. In src/main/board-storage.ts, describe its current adapter role instead of a future US-1468 adapter. In src/renderer/api/app.ts:initPages(), remove the CLI-argument claim. In doc/tasks/backlog.md, replace the “Proposal, unscheduled” platform-roadmap entry with a completed pointer to doc/platform-roadmap.md and doc/epics/completed.md.

6. [x] **Fix toolbar accessible-name updates.** In src/renderer/uikit/IconButton/IconButtonView.ts, call applyRestProps() from applyProps() so current aria-*, data-*, and tabIndex props stay synchronized, and remove applyConstructionRestProps() plus its mount call. The audited 8 dynamic rest-prop paths all re-supply their fields and have no prop-loss risk. BoardToolbarControls.updateDescriptor() calls this.view.update(this.buttonProps()); buttonProps() gets aria-label from labelOf(updatedDescriptor), confirming the updated label reaches IconButtonView.

7. [x] **Subscribe late provider delegates.** In src/renderer/content/registry.ts, retain active MissingProvider.watch() callbacks until disposal; when resolveOnce() installs a delegate attach all active callbacks to delegate.watch(). A watcher registered after resolution must attach directly in watch(). MissingProvider.dispose() must dispose and clear every retained delegate watcher, then dispose the delegate; each returned watch disposer must remove both its registry and delegate subscription. Preserve the existing "available" registry callback.

8. [x] **Retry same-source video URLs.** Add a monotonically increasing reload key to VideoEditorState, bump it on every submitUrl(), pass it to VPlayer, and handle a changed key in VPlayer.syncHlsSource() as a forced HLS rebuild even for identical URL and headers. In native mode, on a changed key call video.load() when src is unchanged; this is needed for HLS URLs that fall back to native playback when Hls.js is unsupported. For ordinary HTTP/local/pipe native media, startSource() already clears streamUrl and obtains a new UUID streaming URL, so src changes. Keep the key transient: omit from getRestoreData() and ignore it in applyRestoreData().

9. [x] Perform the epic-required twice-live invocation for any changed message path and verify the board-owned warning, including a repeated claimed open in an already-open board. This live check remains for the user; no tests are added as part of this task.

### Before → after examples

Torrent notice ownership:

```ts
// Before: core emits torrent-specific copy.
sendToBrowserHost(webContents, EventEndpoint.eBoardNotify, {
    message: "The metadata was fetched privately, but the swarm connection is not anonymous.",
    type: "info",
});

// After: derive the privacy fact from the existing capability at the board model.
this.pendingSourceUrls.push({ sourceUrl, privateSession: Boolean(sessionHandle) });
```

Dynamic toolbar accessible name:

```ts
// Before: applyProps() ignores _rest.
const { ..., ..._rest } = props;

// After: applyProps() keeps every current rest prop in sync.
applyRestProps(this.root, _rest as Record<string, unknown>, this.restPropsState);
```


Same HLS URL retry:

```ts
// Before: identical URL and headers skip HLS source setup after state becomes loading.
if (this.hls && this.hlsSource === source && this.hlsHeadersKey === headersKey) return;

// After: a changed reload key forces the same HLS setup to run again.
if (this.reloadKey === this.props.reloadKey && this.hls && this.hlsSource === source
    && this.hlsHeadersKey === headersKey) return;
```

### Files that need no changes

- No other board bridge methods or service protocol need changes; only the explicitly listed version and source-open/initial-source privacy fields change.
- No changes are planned to src/main/board-pipe-range-reader.ts, src/ipc/board-pipe-channels.ts, or the US-1543 service lifecycle protocol.
- No changes to doc/active-work.md, doc/epics/EPIC-115.md, tests, or any US-1557 file/folder.
- No files in ../persephone-boards are changed in this app task; the exact Torrent Viewer update is recorded above for its owner.

## Concerns

- **Compatibility decision resolved:** the optional privateSession field on source.onOpen() and initialSourcePrivateSession property change a board-visible contract, so the EPIC-115 standing rule requires the 1.23.0 → 1.24.0 bridge bump. No boolean needs to be added to download IPC because the existing sessionHandle reaches BoardEditorModel.
- **Torrent wording decision resolved:** keep privacy policy wording inside Torrent Viewer. A generic core warning would still make core responsible for peer-to-peer semantics and could mislead unrelated claimants.
- Torrent Viewer keeps minBridgeVersion at 1.22.0: app bridge 1.23.0 still emits the current core notice, while bridge 1.24.0 lets the board own that notice. The board changelog should identify the bridge needed for the board-owned behavior without excluding older hosts.
- MissingProvider subscriptions must dispose cleanly if a pipe is released before its delegate resolves; store/unsubscribe callbacks per watch registration.
- HLS retries must force a new HLS instance when the reload key changes even if URL and headers match; header equality remains relevant to ordinary source updates.
- src/renderer/editors/draw/ has no tracked files; removing it is local cleanup and will not create a Git diff by itself.

## Acceptance Criteria

- [x] Every original US-1555 candidate and extra findings 6–8 has a current-source audit result.
- [x] Every row says either **still present → fix** or **already gone (by US-xxxx / commit) → drop**, with the audit explanation naming the current path/method.
- [x] `BOARD_BRIDGE_VERSION` decision is explicit and justified against the actual board-facing types and `src/shared/board-bridge-version.ts`.
- [x] The torrent-viewer cross-repo change, version convention, and `WHATS-NEW.md` entry are described if still needed.
- [x] Remaining implementation steps name exact files and methods and include before → after snippets.
- [x] Concerns are resolved for implementation; no open question remains.
- [x] A `Not verified` placeholder records live checks that remain outside this audit.
- [x] No tests added; no US-1557 material touched.

## Verification

- `npm run typecheck`, `npm run lint` and `node scripts/build-prod.mjs` pass (app stopped during the build; restarted cold afterwards).
- Live, bridge reports `1.24.0`; a fresh non-private board handshake gives `source.initialSourcePrivateSession === false`.
- Live, runtime source-open path invoked four times on one already-open trusted scratch board (`BoardEditorModel.enqueueSourceUrl`): the two opens with a session handle arrived as `{ url, sourceUrl, privateSession: true }`, the two without arrived with no `privateSession` field.
- Live, board `toolbar.set` then `toolbar.update([{ id, title }])` twice: the host button's `aria-label` followed each update ("First" -> "Second" -> "Third").
- Torrent Viewer 1.7.2 (`persephone-boards` `develop`, commit `016a67e`): shows the notice from `privateSession` / `initialSourcePrivateSession`; `minBridgeVersion` stays 1.22.0 because older hosts still show the core notice.

## Not verified

- A real claimed download from a Tor/Incognito Browser page end to end (download-service -> Torrent Viewer notice), and the fresh-page `initialSourcePrivateSession === true` handshake path; only the runtime path was driven live.
- `MissingProvider.watch` re-subscription after a late provider arrival (needs a provider that registers after a page restores).
- Same-URL HLS resubmit reload (no HLS test stream available); only the build and code path were checked.
- Board pipe cleanup (`board-pipe-handler.ts`) beyond typecheck/build: no ranged-read board was exercised in this story.

## Files Changed

| File | Change |
|------|--------|
| `src/main/download-service.ts` | Removed the torrent-specific notice; kept the generic claimed-download notice. |
| `src/ipc/board-bridge-channels.ts` | Added optional runtime and initial private-session bridge fields. |
| `src/renderer/editors/board/BoardEditorModel.ts` | Retained initial privacy state and buffered runtime source records with derived privacy flags. |
| `src/renderer/editors/board/BoardWebview.ts` | Sent optional privacy flags in initial and runtime handshakes. |
| `src/board-shim.ts` | Buffered and delivered runtime privacy metadata; exposed initial-source status; corrected the service comment. |
| `src/renderer/editors/board/board-api.d.ts` | Documented the new source event and initial-source fields. |
| `src/shared/board-bridge-version.ts` | Bumped the board bridge to 1.24.0. |
| `doc/architecture/overview.md` | Documented the 1.24.0 board-facing source fields. |
| `doc/tasks/US-1542-host-frame-channel/README.md` | Updated the source-open and init message inventory for the new optional privacy fields. |
| `src/renderer/editors/board/board-pipe-handler.ts` | Unified stat handling and cancellation cleanup. |
| `src/renderer/api/pages/PagesModel.ts` | Removed the unused no-op `resubscribeEditor`. |
| `src/renderer/editors/board/bundled-board-registry.ts` | Replaced manual case folding with `fpNormalizeForCompare`. |
| `src/renderer/editors/board/board-manifest.ts` | Added the shared stable board identity helper. |
| `src/renderer/editors/board/custom-editor-registry.ts` | Used the shared stable board identity helper. |
| `src/renderer/api/board-namespace.ts` | Used the shared stable board identity helper. |
| `src/renderer/api/app-service-registry.ts` | Added typed `defineService()` and omitted absent initializers. |
| `src/main/board-storage.ts` | Updated the operation-contract comment to describe its current role. |
| `src/renderer/api/app.ts` | Removed the stale CLI-argument responsibility from the `initPages()` comment. |
| `doc/tasks/backlog.md` | Marked the platform roadmap entry as completed historical context. |
| `src/renderer/uikit/IconButton/IconButtonView.ts` | Applied current rest props on every update. |
| `src/renderer/content/registry.ts` | Attached late delegate watchers and disposed each registration cleanly. |
| `src/renderer/editors/video/VideoEditor.ts` | Added a transient reload key and excluded it from persistence. |
| `src/renderer/editors/video/VideoView.ts` | Passed the reload key through to the player. |
| `src/renderer/editors/video/VPlayer.ts` | Rebuilt HLS or reloaded unchanged native sources when the key changes. |
| `src/renderer/editors/draw/` | Removed the empty local directory (untracked, so no Git diff entry). |
| `doc/tasks/US-1555-small-cleanups/README.md` | Updated implementation progress and changed-file records. |
