# US-1551: Single-instance board routing in one place; a typed open-context hook

Epic: [EPIC-115 — Board service, scheme and provider structure](../../epics/EPIC-115.md), Phase 3 — structure.

## Goal

Route every single-instance board open through one lifecycle path, using the normalized manifest model, and replace board-specific duck-typed casts with one typed editor open-context hook. Preserve source identity and private-session context for both opening a new board page and delivering a source to an existing singleton.

## Background

### Verified current paths

`src/renderer/content/open-handler.ts:39-124` handles `openContent`. It reconstructs `filePath` from `data.pipe.provider.sourceUrl`, appending an archive entry when present, calls `cleanForStorage(data)`, then sets `sourceLink.url = filePath`. For the `pageId` case, lines 55-74 independently resolve a board root, read its raw manifest, look up an existing singleton, show the page, and duck-type `enqueueSourceUrl`. Otherwise it calls `PagesLifecycleModel.navigatePageTo`.

`src/renderer/api/pages/PagesLifecycleModel.ts:108-154` has the copied `resolveBoardRootForOpen`, a raw-manifest `isSingleInstanceBoard`, and the existing `openSingleInstanceBoard` route. `openFile` uses that route at lines 547-564. `addBundledBoardPage` has an existing-singleton check at lines 299-319; changing `isSingleInstanceBoard` to use normalized manifest data updates this check automatically. Leave its creation path otherwise untouched because US-1554 owns bundled-board creation. `openSingleInstanceBoard` currently picks `sourceLink.url ?? pipe.provider.sourceUrl ?? filePath`, shows the existing page, queues the source, disposes the incoming pipe, and returns the page.

`navigatePageTo` is a lifecycle delegate at `PagesLifecycleModel.ts:762-766`; its implementation is in `src/renderer/api/pages/PageNavigator.ts:212-282`. Its options include `sourceLink` and `pipe`, but no `sessionHandle`. A page-id open therefore reaches navigation without the session handle needed by the board model if navigation is left to build another editor.

`src/renderer/api/pages/PagesLifecycleModel.ts:615-621` registers a session handle on a newly created page by casting the adapter to an optional board-only method. `src/renderer/editors/board/BoardEditorModel.ts:244-268` implements `registerSourceSessionHandle` and `enqueueSourceUrl`; queueing also registers the handle. `src/renderer/editors/base/EditorModel.ts:326-338` has the nearby optional `onReopen` and `revealFragment` hooks.

`src/renderer/editors/board/board-manifest.ts:452-454` provides `readNormalizedBoardManifest(root)`, and `NormalizedBoardManifest.singleInstance` is the normalized value to consult. The route currently calls `isBoardSingleInstance` with raw `readBoardManifest` in `PagesLifecycleModel`; `open-handler.ts` has a second raw read and raw check. `addBundledBoardPage` reaches the same raw check through `isSingleInstanceBoard`.

`src/shared/link-data.ts:55-90` removes ephemeral fields, including `sessionHandle`, from persisted source links. `src/main/download-service.ts:116-128` sends a claimed browser download as its original URL plus an optional session handle. `src/renderer/content/link-utils.ts:170-182` carries that handle into the HTTP pipe descriptor. `HttpProvider.sourceUrl` remains the original URL (`src/renderer/content/providers/HttpProvider.ts:32-40`). `BoardEditorModel` stores the transient handle against the source URL and later uses it to rebuild a source pipe (`BoardEditorModel.ts:244-258, 658-685`).

The renderer receives the claim in `src/renderer/api/internal/RendererEventsService.ts:119-131`; `handleClaimedBrowserDownload` calls `openRawLink` with the board editor target and session handle. Layer 3 then reaches `openFile` without a page id, so the claim exercises the lifecycle's ordinary open path and singleton reuse when a page already exists.

### Source identity decision

Use `sourceLink?.url` as the preferred open identity; fall back to `pipe?.provider.sourceUrl`, then `filePath` only when no source link exists. The Layer 3 handler has already normalized this identity into `sourceLink.url`: for normal files, magnets, and HTTP claims it is the resolved source URL; for archive entries it is the reconstructed archive-entry path. The provider URL alone loses the archive entry, while `filePath` is only a fallback for direct lifecycle callers that do not supply a source link.

| Open source | Context delivered to the board | Reason |
|---|---|---|
| Magnet link | The magnet URL in `sourceLink.url`; optional handle if one was supplied | The scheme pipe's `sourceUrl` and the resolved link identity refer to the source magnet, not the page URL. |
| `.torrent` file | The local `.torrent` file path | The resolved file source is the identity the board must enqueue. |
| Claimed browser download | The original claimed HTTP(S) URL and its optional `sessionHandle` | Download service sends both; the handle must remain live-only and accompany the source delivery. |
| Private-session claim | The claimed URL plus its `sessionHandle` | `cleanForStorage` strips the handle, so pass it directly in the typed hook before/without persistence. |
| Non-single-instance board | No singleton enqueue; normal `openFile` creates a new page, and `navigatePageTo` keeps its normal navigation behavior | Single-instance routing is gated by normalized manifest state. |

### Typed hook shape

Use one optional `EditorModel.acceptOpenContext` hook with a discriminated context:

```ts
acceptOpenContext?(context:
    | { mode: "register-session"; sourceUrl: string; sessionHandle: string }
    | { mode: "enqueue-source"; sourceUrl: string; sessionHandle?: string }
): void;
```

This makes the two existing operations explicit: a newly opened page only registers a private-session handle when one exists, while an already-open singleton enqueues every new source and may also register its handle. It avoids exposing `BoardEditorModel` methods through generic page lifecycle code and makes the required handle non-optional in registration mode.

Before:

```ts
(adapter as unknown as { registerSourceSessionHandle?: (url: string, handle: string) => void })
    .registerSourceSessionHandle?.(sourceUrl, options.sessionHandle);
```

After:

```ts
adapter.acceptOpenContext?.({
    mode: "register-session",
    sourceUrl,
    sessionHandle: options.sessionHandle,
});
```

Singleton detection changes from the raw manifest check to the already available normalized field:

Before:

```ts
return isBoardSingleInstance(await readBoardManifest(boardRoot));
```

After:

```ts
return (await readNormalizedBoardManifest(boardRoot))?.singleInstance === true;
```

## Implementation plan

- [x] **Centralize board root resolution and singleton decision.** In `src/renderer/api/pages/PagesLifecycleModel.ts`, make `resolveBoardRootForOpen(target?: string, filePath?: string)` public so the open handler can use it for the still-present legacy intent path. `open-handler.ts` will call `pagesModel.lifecycle.resolveBoardRootForOpen(data.target, filePath)` when invoking the legacy intent; it will not retain its own resolver. Replace `isSingleInstanceBoard`'s raw read and `isBoardSingleInstance` call with `readNormalizedBoardManifest(boardRoot)?.singleInstance === true`.
- [x] **Keep one existing-page route for singleton boards.** Have `openFile` and `navigatePageTo` use the existing `openSingleInstanceBoard` route. `navigatePageTo` must perform this check before `PageNavigator.navigatePageTo` prompts or replaces the page selected by `pageId`; on a match, it shows the singleton page, delivers context, disposes the incoming pipe, and reports success. Leave `addBundledBoardPage` unchanged apart from its existing check consuming the normalized result through `isSingleInstanceBoard`; US-1554 owns bundled-board creation.
- [x] **Remove duplicate open-handler routing.** In `src/renderer/content/open-handler.ts`, remove the `pageId` branch's board-root resolution, raw manifest read, page lookup, enqueue cast, and singleton-only early return. Always delegate page-id opens to `pagesModel.lifecycle.navigatePageTo(...)`; that method now owns singleton routing. Preserve the existing disposal condition `if (!navigated || data.folderPath !== undefined) data.pipe.dispose();`: on a singleton match, `PagesLifecycleModel.navigatePageTo` disposes the pipe and returns `true`, so the handler does not dispose it again. Ensure the common tail (`data.handled = true; invokeLegacyIntent(...)`) runs exactly once after a singleton match. Preserve `invokeLegacyIntent` for `data.intent`, resolving its root through the public lifecycle resolver.
- [x] **Carry the full open context through navigation.** Add `sessionHandle?: string` to `NavigatePageToOptions` in `src/renderer/api/pages/PageNavigator.ts` and pass `data.sessionHandle` from `open-handler.ts`. Add the `acceptOpenContext` optional hook and its context type in `src/renderer/editors/base/EditorModel.ts`, beside `onReopen` / `revealFragment`. Implement the hook in `src/renderer/editors/board/BoardEditorModel.ts`: `register-session` calls `registerSourceSessionHandle`; `enqueue-source` calls `enqueueSourceUrl`.
- [x] **Replace both lifecycle casts.** In `src/renderer/api/pages/PagesLifecycleModel.ts`, replace `enqueueBoardSource`'s board-model cast with `acceptOpenContext({ mode: "enqueue-source", ... })`. Replace the new-page `registerSourceSessionHandle` cast after `addPage` with `acceptOpenContext({ mode: "register-session", ... })`, using `options.sourceLink?.url ?? filePath` and only calling the hook when both a URL and session handle exist. Keep generic `applyDiffRevisions` behavior out of scope.
- [x] **Preserve the canonical source URL and pipe ownership.** `openSingleInstanceBoard` should use the `sourceLink.url` / provider URL / file path priority above, skip board-root `persephone-board:` links, enqueue the source once, dispose the supplied pipe once, and return the existing `PageModel`. Verify direct `openFile` callers still fall back to provider URL or file path when no `sourceLink` is supplied.
- [x] **Keep the board bridge version stable.** Do not change `src/shared/board-bridge-version.ts` (`BOARD_BRIDGE_VERSION` is currently `1.23.0`): this work changes renderer lifecycle internals and does not add or alter anything visible to board frames or the board service protocol.
- [x] **Live verification through Persephone MCP; invoke every case twice.** Use the torrent viewer singleton board and inspect page identity/count plus the viewer's received source URL. Repeat each scenario twice so the second request proves reuse:
  1. Open the torrent viewer, then deliver a second magnet and a second `.torrent` through `PagesLifecycleModel.openFile`; both must arrive in the existing board page.
  2. Open the torrent viewer, then deliver a magnet and a `.torrent` through `openRawLink` with `pageId`, which reaches `open-handler` and `navigatePageTo`; each must route into the existing singleton page rather than replacing the selected page.
  3. Trigger a browser URL claim for a source the torrent viewer claims twice. The existing `RendererEventsService.handleClaimedBrowserDownload` path sends it through `openRawLink` into `open-handler` and `openFile`; verify both claims reach the existing singleton page.
  4. Open two distinct sources with a board whose normalized manifest has `singleInstance: false` through the ordinary new-page `openFile` path; repeat the two opens, confirming each creates its own page and does not converge through singleton routing.
  5. Trigger two private-session browser claims through the claimed-download `openRawLink` path. Inspect `BoardEditorModel` on the singleton page's main editor through the `app` global in `execute_script`, and verify `sourceSessionHandles.get(url) === handle` for both claims: first claim via new-page `register-session`, second via existing-page `enqueue-source`. Synthetic URLs and handles are acceptable; this verifies routing and context propagation without requiring a real download.

## Concerns / Open questions

- **Source identity:** `sourceLink.url` is the correct preferred key because `open-handler.ts` sets it from the resolved provider URL and reconstructs archive entry paths before dispatch. Keep the provider URL as fallback for callers that bypass the content handler.
- **Private-session handle lifetime:** the handle must be passed in live open context; `cleanForStorage` deliberately removes it from persisted links and provider descriptors. Do not persist it as a workaround.
- **Page-id success and ownership:** the current open handler disposes the pipe when `navigatePageTo` returns false or a folder path is supplied; on a singleton match, `PagesLifecycleModel.navigatePageTo` consumes/disposes it and returns `true`, so the current handler condition avoids a second disposal.
- **Script API navigation:** `navigatePageTo` is also reached through `PageCollectionWrapper.navigatePageTo` (`src/renderer/scripting/api-wrapper/PageCollectionWrapper.ts:242-252`) → `PagesModel.navigatePageTo` (`src/renderer/api/pages/PagesModel.ts:270-274`) → `PagesLifecycleModel.navigatePageTo`. The singleton check applies there too. It is a no-op unless `options.target` resolves a board root (script callers pass no target); when it does apply, it matches `openFile` behavior. This is accepted.
- **Internal navigation option:** keep `sessionHandle` only on internal `NavigatePageToOptions` in `src/renderer/api/pages/PageNavigator.ts`. Do not add it to `src/renderer/api/types/pages.d.ts` or the script wrapper/types.
- **Legacy intent:** `open-handler.ts` still has `invokeLegacyIntent` and both call sites because `ILinkData.intent` remains in the current code. Keep this behavior while sharing the root resolver; do not reintroduce the duplicate resolver merely to dispatch the intent.
- **Board bridge:** no version bump is warranted unless implementation adds or changes a board-visible `persephone.*` member or service protocol, which this plan does not.

## Acceptance criteria

- `openFile` and `navigatePageTo` route a declared single-instance board through one lifecycle method; the page-id path no longer contains its own manifest read or board cast.
- All existing-singleton checks, including `addBundledBoardPage`, consume `readNormalizedBoardManifest(root).singleInstance`; there is no remaining raw `isBoardSingleInstance(readBoardManifest(...))` route check.
- `open-handler.ts` no longer defines a board-root resolver copy. Legacy intent dispatch calls `PagesLifecycleModel.resolveBoardRootForOpen`.
- `EditorModel` exposes one typed optional open-context hook with distinct registration and enqueue modes; `BoardEditorModel` implements both modes; page lifecycle contains no casts to `enqueueSourceUrl` or `registerSourceSessionHandle`.
- Magnet, `.torrent`, claimed-download, and private-session source context preserves the canonical source URL, and a private session handle is passed to the board without persistence.
- A non-single-instance board does not converge through singleton routing.
- `BOARD_BRIDGE_VERSION` remains unchanged because no board-visible contract changes.
- The live Persephone MCP scenarios in the implementation plan pass twice each.

## Live verification (2026-09-28)

Run in the dev app over MCP (`script.execute`) with synthetic sources only (fake 40-char info hashes, stub `.torrent` files, unreachable `http://127.0.0.1:9/...` claim URLs). `typecheck`, `lint` and `build-prod` passed. Each observed call was recorded by wrapping the page's `acceptOpenContext`.

- **openFile path, singleton:** two magnets through `openRawLink` (no `pageId`), two `.torrent` files through `app.pages.openFile`, one `.torrent` through `openRawLink` — all five reached the one torrent-viewer page as `enqueue-source`; no new page.
- **pageId / `navigatePageTo` path, singleton:** two magnets and two `.torrent` files sent with `pageId` of a synthetic text page — all four enqueued into the torrent-viewer page, the torrent page was activated, and the text page kept its Monaco editor (not replaced).
- **Claimed browser download (renderer side):** two claims shaped exactly as `RendererEventsService.handleClaimedBrowserDownload` builds them (`target: board-editor:<root>`, `sessionHandle`) enqueued into the existing page with their handles; `sourceSessionHandles` held both.
- **Private-session claim opening a new page:** twice (close the page, claim again): the new page's `sourceSessionHandles.get(url)` was the claim's handle (`register-session`), and a second claim into it enqueued with its own handle.
- **Non-single-instance board (US1534Demo):** four `.stream-demo` opens created four pages; two `pageId` opens into a synthetic page navigated that page normally (no page-count change).

- **`/review` fix — `pageId` open that builds a new board editor:** twice, a claim-shaped open with `pageId` of a synthetic text page (no torrent page open) turned that page into the torrent viewer and registered the handle (`sourceSessionHandles.get(url)`); a second claim into it enqueued with its own handle. Re-verified after a clean restart and `build-prod`.

## Not verified

- The main-process half of a browser download claim (`download-service.ts` -> IPC) was not driven; the renderer event it produces was reproduced directly.
- What the torrent viewer frame does with the fake sources (they cannot resolve) — only routing and context delivery were checked.
- `addBundledBoardPage`'s singleton reuse and the script-API `pages.navigatePageTo` path were not exercised live (unchanged except for the normalized manifest read).

## Files Changed

| File | Planned change |
|---|---|
| `src/renderer/content/open-handler.ts` | Remove copied singleton routing/root resolution; forward session context and preserve legacy intent dispatch. |
| `src/renderer/api/pages/PagesLifecycleModel.ts` | Own root resolution and singleton routing; use normalized manifest; route file opens and page navigation; replace board-method casts. `addBundledBoardPage` changes only through the shared normalized singleton check. |
| `src/renderer/api/pages/PageNavigator.ts` | Add session handle to navigation options for typed lifecycle handoff. |
| `src/renderer/editors/base/EditorModel.ts` | Define the typed optional `acceptOpenContext` hook and context union. |
| `src/renderer/editors/board/BoardEditorModel.ts` | Implement registration and enqueue modes using existing source-session methods. |
| `src/renderer/editors/board/board-manifest.ts` | No change planned; consume existing `readNormalizedBoardManifest` and normalized `singleInstance`. |
| `src/shared/board-bridge-version.ts` | No change planned; board-visible API and service protocol stay the same. |
| `src/renderer/content/providers/HttpProvider.ts` | No change planned; verified provider source identity and private-session behavior are already present. |
| `src/renderer/api/internal/RendererEventsService.ts` | No change planned; claimed-download IPC already forwards URL and session handle through `openRawLink`. |
| `src/main/download-service.ts` | No change planned; claimed download already carries URL and optional session handle into the renderer. |
| `src/shared/link-data.ts` | No change planned; persisted-link cleanup intentionally strips the ephemeral session handle. |
