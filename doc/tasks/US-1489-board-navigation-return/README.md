# US-1489 - Board navigation return URLs

**Status:** Planned | **Epic:** [EPIC-109: Bundled boards and the Excalidraw board](../../epics/EPIC-109.md) | **Depends on:** [US-1487: The Excalidraw board](../US-1487-excalidraw-board/README.md)

This is an investigation and implementation plan only. It contains no implementation, tests, harnesses,
app interaction, runtime-state changes, or commit.

## Goal

Add a general board-platform navigation-return service. A board asks Persephone for one opaque return
URL, gives that URL to a third-party site, and receives the resulting URL plus parsed query and hash
parameters back in the same board frame. The service must be safe for arbitrary trusted boards, not
shaped around Excalidraw, while keeping the built-in migration deliberately small.

The service must consume the return navigation in Persephone's browser, restore focus to the owning host
page, and prevent a claimed return from leaving a stranded invalid-URL tab.

## Background

### Binding decisions and scope

EPIC-109 D10 is binding: Persephone mints `https://<nonce>.board-return.persephone.invalid/`; a board
supplies no match pattern. The reserved `.invalid` suffix cannot resolve to a real site, and the
per-instance nonce prevents one board from claiming another board's return. The decision and security
rationale are at [EPIC-109.md:212-238](../../epics/EPIC-109.md#L212-L238).

This task must not revisit that design or add an Excalidraw-specific URL. It must make nonce, claim
lifetime, frame ownership, stale-claim behavior, and browser-tab behavior implementable.

EPIC-109 D11 makes behavioral parity a prerequisite for EPIC-110. This task closes the navigation part
of that parity gap; US-1490 owns the remaining library-path and canvas-action audit. D11 is at
[EPIC-109.md:249-279](../../epics/EPIC-109.md#L249-L279).

The EPIC-109 Linked Tasks table already links US-1489 to this document, and the dashboard already
contains the task. Neither tracking file is part of this task.

### Current built-in flow

The built-in editor invents a global sentinel in
[src/renderer/editors/draw/ExcalidrawIsland.tsx:21-28](../../../src/renderer/editors/draw/ExcalidrawIsland.tsx#L21-L28)
and passes it as Excalidraw's `libraryReturnUrl` at line 72. DrawBodyView subscribes to the global
browser URL event at line 225 and claims any URL beginning with that sentinel at
[src/renderer/editors/draw/DrawBodyView.ts:256-283](../../../src/renderer/editors/draw/DrawBodyView.ts#L256-L283).
It parses only the hash, calls `pagesModel.showPage(hostId)`, then fetches and installs the library.

That handler does not close or rewind the browser page. `showPage()` changes Persephone's selected
page; it does not change the browser webview's internal tab. Therefore the current flow leaves the
browser tab sitting on the return URL after focus moves back to the drawing page. This is the
stranded-tab behavior US-1489 must resolve.

The draw migration is intentionally narrow because `editors/draw` is removed in EPIC-110. It should
only replace the private URL and subscription with the general service; it must not refactor the draw
editor or move library persistence into this task.

### Verified browser event coverage

`BrowserUrlEvent` is a mutable cooperative-claim event with only `url` and optional `handled` in
[src/renderer/core/state/events.ts:39-46](../../../src/renderer/core/state/events.ts#L39-L46).
`Subscription.send()` dispatches synchronously to every subscriber in registration order through
`Emitter.fire()`; it does not stop dispatch when `handled` becomes true
([events.ts:5-29](../../../src/renderer/core/state/events.ts#L5-L29)). `handled` therefore marks a
claim for cooperating code; it is not a Chromium navigation cancellation mechanism.

The main-process browser service attaches both relevant Electron events:

- [src/main/browser-service.ts:206-212](../../../src/main/browser-service.ts#L206-L212) relays
  `did-navigate`, which covers a completed main-frame navigation. The source does not attach a
  redirect-specific event, so a redirect chain is observed at the completed navigation URL, not at
  every intermediate redirect target.
- [src/main/browser-service.ts:214-223](../../../src/main/browser-service.ts#L214-L223) relays
  `did-navigate-in-page` only for the main frame. The installed Electron declarations explicitly say
  that `did-navigate` excludes in-page navigation and that the in-page event covers anchor/hash changes
  ([electron.d.ts:16762-16766](../../../node_modules/electron/electron.d.ts#L16762-L16766),
  [electron.d.ts:16820-16828](../../../node_modules/electron/electron.d.ts#L16820-L16828)). A
  hash-only return therefore does produce the event needed by the library flow.

`BrowserWebviewModel.applyNavigation()` publishes the URL after updating browser tab state at
[src/renderer/editors/browser/BrowserWebviewModel.ts:202-223](../../../src/renderer/editors/browser/BrowserWebviewModel.ts#L202-L223),
for both full and in-page cases at lines 234-249. A separate publish at lines 278-287 reports a URL
when a browser page opens a new internal tab. The service must not assume this is a pre-navigation
hook: the return URL has already reached the webview when the event is claimed.

`DrawBodyView` is the only current subscriber; the repository search found no other
`browserUrlChanged.subscribe` call. After migration, the platform service must be the sole subscriber
and draw must not remain a second claimant. This avoids relying on subscriber order, because
`handled` does not short-circuit dispatch.

### Verified board-frame delivery and lifecycle

The renderer already has the required addressing primitive. `BoardEditorModel.frames` maps the main
frame and secondary-view frame ids to live `HTMLIFrameElement` instances at
[src/renderer/editors/board/BoardEditorModel.ts:179-183](../../../src/renderer/editors/board/BoardEditorModel.ts#L179-L183);
`setIframe()` and `clearIframe()` replace and remove those entries at
[BoardEditorModel.ts:228-248](../../../src/renderer/editors/board/BoardEditorModel.ts#L228-L248).
`BoardWebview` already posts typed messages to the exact frame with the board origin and validates
incoming messages by both origin and `event.source` at
[src/renderer/editors/board/BoardWebview.ts:390-398](../../../src/renderer/editors/board/BoardWebview.ts#L390-L398).

The return service should use that existing host-frame channel, not add a main-process port RPC. The
renderer owns `browserUrlChanged`, the live iframe, focus/page selection, and frame reload lifecycle;
moving return-URL creation into `src/main/board-bridge.ts` would split ownership and require a new
main-to-renderer registration channel for every nonce.

`BoardWebview` marks a frame live on mount and disposes port/frame resources on teardown at
[BoardWebview.ts:136-180](../../../src/renderer/editors/board/BoardWebview.ts#L136-L180). Its
`handleLoad()` runs again when the same iframe reloads at
[BoardWebview.ts:334-388](../../../src/renderer/editors/board/BoardWebview.ts#L334-L388). A return
claim must be invalidated on both disposal and every load, not only when the iframe element is
removed. A board reload is a new board-frame instance for D10 purposes.

### Trust and provenance

Board rendering is already gated by `isBoardPermitted()` in
[src/renderer/editors/board/BoardEditorView.ts:183-192](../../../src/renderer/editors/board/BoardEditorView.ts#L183-L192).
That predicate accepts either a persisted trusted board or a bundled board through
[src/renderer/editors/board/board-access.ts:4-24](../../../src/renderer/editors/board/board-access.ts#L4-L24).
EPIC-042 makes trusted-board file associations hard-gated and reactive; its trust decision is at
[EPIC-042.md:127-136](../../epics/EPIC-042.md#L127-L136). EPIC-109 D2 gives bundled boards app-owned
provenance without writing `trustedBoards.txt` ([EPIC-109.md:56-76](../../epics/EPIC-109.md#L56-L76)).

Recommendation: an untrusted board must not mint a return URL. The renderer-side create request must
re-check `isBoardPermitted(boardRoot)` at request time, just as existing board capability and AiVision
delivery paths re-check trust. Bundled boards are allowed because D2 deliberately makes them
permitted by provenance. Do not gate this API on the manifest's `service` permission: that permission
is specifically for starting a board module service in
[src/renderer/editors/board/board-service-permission.ts:7-14](../../../src/renderer/editors/board/board-service-permission.ts#L7-L14),
whereas a return URL is a renderer-owned routing primitive and introduces no network capability.

## Implementation Plan

### 1. Define the board-facing contract in the existing bridge style

Add a `navigation` namespace to `window.persephone`, following the existing promise-returning request
and unsubscribe-returning callback conventions in `src/board-shim.ts`:

    // Before: PersephoneBoardApi has no navigation member.
    interface PersephoneBoardApi {
        readonly version: string;
        readonly host: PersephoneHostApi;
    }

    // After: additive, board-facing contract.
    interface PersephoneNavigationReturnEvent {
        readonly url: string;
        readonly query: Readonly<Record<string, readonly string[]>>;
        readonly hash: Readonly<Record<string, readonly string[]>>;
    }

    interface PersephoneNavigationApi {
        createReturnUrl(): Promise<string>;
        onReturn(handler: (event: PersephoneNavigationReturnEvent) => void): () => void;
    }

    interface PersephoneBoardApi {
        readonly version: string;
        readonly navigation: PersephoneNavigationApi;
        readonly host: PersephoneHostApi;
    }

The query map comes from the URL's `search` component; the hash map comes from the fragment with
the leading `#` removed. Parse both with `URLSearchParams`, percent-decode once, preserve duplicate
keys as arrays, and use an empty string for a key with no value. Keep `url` as the complete original
URL. Plain records are deliberate: they are stable structured-clone payloads and do not expose a
live mutable `URLSearchParams` object across the frame boundary.

Implement request/reply and event delivery in `src/board-shim.ts` using the existing
`onHostMessage()` source/origin gate and the same pending-request pattern used by `filePathRpc()` and
`openContentRpc()`. The port-level `rpc()`/`fire()` helpers remain unchanged because this service is
renderer-owned. `createReturnUrl()` must reject when the host is unavailable or refuses the request.
`onReturn()` must return an idempotent unsubscribe and catch/log handler exceptions with the same
callback-isolation behavior as `onThemeChange()` and `onContentChange()`.

Add request/reply and return-event wire shapes to
`src/ipc/board-bridge-channels.ts`, including them in the host-frame message union. The expected
direction is:

    board frame -- navigation:createReturnUrl(reqId) --> BoardWebview / renderer service
    board frame <-- navigation:returnUrl(reqId, url) -- BoardWebview / renderer service
    board frame <-- navigation:return(url, query, hash) -- BoardWebview / renderer service

The host frame must validate the request against the exact live iframe before calling the service, and
must post replies back to that same iframe with the existing `board://<host>` target origin (or the
existing wildcard fallback for opaque file-host origins). No board-provided pattern or callback URL
is accepted on any wire message.

Update the maintained prose references, `assets/guides/agents/boards.md` and
`assets/board-template/CLAUDE.md`, with the author-facing API, including the bridge-version guard.
`src/renderer/editors/board/board-api.d.ts` is a legacy IntelliSense snapshot: its header says it is
not the maintained author reference, and EPIC-097 decision 12 records that it was deliberately
demoted. It may be mirrored optionally, but it is not a required contract change or acceptance gate.
Bump `src/shared/board-bridge-version.ts` additively for the new surface and update version references
in both guides. The existing shim build inputs in `scripts/dev.mjs`,
`scripts/build-prod.mjs`, and `src/main/board-protocol-service.ts` already build and inline
`src/board-shim.ts`; they do not need new build plumbing.

### 2. Add the renderer-side return service and frame ownership

Create `src/renderer/api/board-navigation-return.ts` as the process-lifetime renderer service. It
must expose a small internal registration surface for native renderers and `BoardWebview`, plus one
initializer called from `App.initEvents()` after pages exist and before the renderer mounts browser or
board views. The initializer subscribes once to `browserUrlChanged` and owns the claim map.

Mint each URL with a cryptographically random, URL-host-safe nonce (use renderer
`crypto.randomUUID()` and encode only if required by hostname syntax), producing exactly:

    https://<nonce>.board-return.persephone.invalid/

Store the nonce only in renderer memory. Each active claim records owning `pageId`, owning
`BoardEditorModel`/frame identity when applicable, the frame's current load generation, and a
delivery callback. The board request supplies the live frame; the service does not infer ownership
from a URL and does not accept a board match pattern.

Use a frame-scoped lifecycle:

1. A claim is active from successful minting until that exact native owner is released, the board frame
   is disposed, or the frame fires a new `load`.
2. A board reload invalidates all claims from the old frame generation, even if the iframe element is
   reused. The reloaded board must call `createReturnUrl()` again.
3. Disposal moves the nonce to a short-lived retired/tombstone set rather than silently forgetting
   that Persephone minted it. A later navigation to that exact retired nonce is claimed and restored
   according to its source-tab path—rewind/restore for an existing tab, or close the exact
   return-created internal tab—but is not delivered to any board. This prevents a stale return from
   surfacing an invalid page after its owner disappeared. Retired entries expire after a bounded
   retention period and are also cleared with the renderer process; claims never survive an app
   restart. Use a concrete 10-minute tombstone TTL so the registry cannot grow from abandoned browser
   flows.
4. If the owner is gone and an existing browser tab has no recoverable previous URL, consume the event
   and leave that tab in its current safe page; if the return itself created an internal tab, close that
   exact tab. Never route either case to another board or invoke a new handler.

Matching must parse the candidate URL and require HTTPS, the exact minted hostname, and the minted
origin/path prefix. It must not use a board-supplied `startsWith` pattern. The service sets
`event.handled = true` synchronously before focusing or delivering anything. It then calls
`pagesModel.showPage(ownerPageId)` if the page still exists and invokes the native callback or posts
the structured return event to the exact owning frame. A missing/reloaded frame results in retired-claim
behavior above.

For board claims, extend `src/renderer/editors/board/BoardWebview.ts` so its existing validated
`handleMessage()` path handles the create request, re-checks `isBoardPermitted()`, calls the service
with current `BoardEditorModel`, iframe, view/tab id, and load generation, and returns the minted URL.
Call the service's frame-release hook from `onDispose()` and its load-reset hook at the start of
`handleLoad()`. This uses the existing `BoardEditorModel.frames` map and `contentWindow.postMessage`
delivery; no new CDP route, MessagePort method, main-process registry, or `src/main/board-bridge.ts`
change is needed.

The service's native registration shape should be callback-based so `DrawBodyView` can use it
without pretending to be a board frame:

    // Before: DrawBodyView owns a global browserUrlChanged subscription and sentinel comparison.
    this.own(browserUrlChanged.subscribe(this.handleBrowserUrl));

    // After: the shared service owns the URL claim; DrawBodyView owns only the library callback.
    const returnClaim = boardNavigationReturnService.createNativeClaim({
        pageId: this.model.host?.state.get().id,
        onReturn: this.handleLibraryReturn,
    });
    this.own(returnClaim.dispose);

The exact internal type may differ, but it must carry the host page and a release callback rather
than expose a public pattern-registration API.

### 3. Make the browser publisher restore the claimed tab

Because the event fires after `did-navigate`/`did-navigate-in-page`, the service cannot cancel the
already-committed navigation. Update
`src/renderer/editors/browser/BrowserWebviewModel.ts` at both URL publication sites so the publisher
performs post-claim restoration synchronously after `browserUrlChanged.send(event)`. At the very top
of `applyNavigation`, before the existing `this.model.tabs.currentUrls.set(internalTabId, url)` at
line 209, capture the source tab's previous URL in a local and thread it to the restore helper. By
the time subscribers see the event, `currentUrls` already contains the minted URL; reading it at
claim time would restore the URL being claimed rather than the URL being left.

    // Before: the URL event is sent, with no action based on handled.
    if (data.url) browserUrlChanged.send({ url: data.url });

    // After: the service claims synchronously; the browser publisher rewinds the source tab.
    const previousUrl = this.model.tabs.currentUrls.get(internalTabId);
    // ... existing navigation state updates, including currentUrls.set(...) at line 209 ...
    if (data.url) {
        const event = { url: data.url } satisfies BrowserUrlEvent;
        browserUrlChanged.send(event); // claim decision must precede addNavHistory at line 220
        if (event.handled) {
            this.restoreClaimedNavigation(internalTabId, previousUrl, event);
            // Do not call addNavHistory for the claimed .invalid URL.
        } else {
            this.model.addNavHistory(internalTabId, data.url); // existing line 220
        }
    }

Add the helper in `BrowserWebviewModel` rather than making the general return service import the
browser editor. It must prefer the webview's `goBack()` for the exact internal tab. If the source tab
reports no back history, use the `previousUrl` local captured at the top of `applyNavigation`, before
line 209 overwrote `tabs.currentUrls`; never read `tabs.currentUrls` as the fallback after the event
has been published. If neither a previous URL nor a recoverable webview exists, load `about:blank` in
that exact existing tab. The helper must be safe when the tab or webview was already disposed.

Apply the same handled check to the `new-window` publish path using the internal tab id returned by
`addTab()` at `BrowserWebviewModel.ts:285` (`BrowserTabsModel.addTab()` returns that id at
`BrowserTabsModel.ts:115`). That path is different: the internal tab was created by the return itself,
so it has no back history or previous URL. When the event is handled, close that exact internal tab
with `BrowserTabsModel.closeTab()` instead of restoring it to `about:blank`; its `:136-170` behavior
splices a non-last tab and reactivates the prior tab from `activeTabHistory`, while a last tab is
replaced by a fresh blank tab. Neither behavior closes the user's browser page. For an existing tab
that was navigated to the return URL, rewind or restore the captured previous URL and keep the tab;
do not close that browser page. In both paths, suppress `addNavHistory` for the claimed URL: the
claim decision must happen before the existing call at line 220, while publication is at line 222.
The service remains the only claimant; the publisher is merely the component that can undo a
committed webview navigation.

This chooses **go back/restore the previous URL and keep an existing browser tab**, not close or stay
on the return URL. `openUrlInBrowserTab()` may reuse the active normal browser page or an existing
browser page ([browser-pages.ts:121-180](../../../src/renderer/editors/browser/browser-pages.ts#L121-L180)).
For the distinct `new-window` path, close only the internal tab created by the return; the
`BrowserTabsModel.closeTab()` behavior above ensures this does not close the browser page
([BrowserTabsModel.ts:136-170](../../../src/renderer/editors/browser/BrowserTabsModel.ts#L136-L170)).
The service then selects the board host page, so the library site remains in its original tab and no
tab is stranded on the invalid return URL.

### 4. Migrate `editors/draw` without a refactor

Change only the return-URL seam in these two files:

- `src/renderer/editors/draw/ExcalidrawIsland.tsx`: remove `LIBRARY_RETURN_URL` and its export;
  accept `libraryReturnUrl` as a prop supplied by the parent and continue passing it to Excalidraw.
- `src/renderer/editors/draw/DrawBodyView.ts`: remove the `browserUrlChanged` import, subscription,
  `BrowserUrlEvent` handler, and sentinel parsing. Mint one native claim during mount, pass its URL
  through `DrawReadyViewProps` into `createExcalidrawIslandElement()`, and move existing hash
  extraction/fetch/updateLibrary logic into the native claim callback. Keep
  `pagesModel.showPage(hostId)` out of the draw callback because focus/page selection is now the
  service's responsibility. Keep `fetch()`, `ui.notify()`, `api.updateLibrary()`, and all existing
  draw lifecycle/debounce behavior otherwise unchanged.

The before/after API shape is:

    // Before
    const LIBRARY_RETURN_URL = "https://jsnotepad.excalidraw-library/";
    <Excalidraw libraryReturnUrl={LIBRARY_RETURN_URL} ... />

    // After
    <Excalidraw libraryReturnUrl={props.libraryReturnUrl} ... />

The built-in editor must exercise the same minted URL and claim service as a board. If the built-in
needs a special-case URL parser or a second global URL subscriber, the abstraction has failed D10's
generality test.

### 5. Document the author-facing behavior and verify without app interaction

Update the runtime shim contract and both maintained board authoring references with:

- no pattern argument and no ability to claim arbitrary real origins;
- `createReturnUrl()` as an async call;
- `onReturn()`'s unsubscribe behavior and handler payload;
- query/hash parsing and duplicate-key semantics;
- frame/reload lifetime and stale-return behavior;
- the requirement to use the minted URL as the third-party site's return target.

The legacy `src/renderer/editors/board/board-api.d.ts` snapshot may be updated for convenience, but
it is not a maintained authoring contract and is not required for this task's documentation gate.

The implementation task must verify source-level behavior and the existing build/type/lint gates in
the normal project workflow, but this investigation task adds no unit test or harness and does not
start or interact with the running Persephone instance.

## Concerns

- **Post-navigation timing is load-bearing.** The current event is published from completed browser
  navigation events. `handled` prevents cooperative consumers from treating the URL as an ordinary
  event, but cannot prevent Chromium from first changing the webview URL. The publisher-side rewind
  is required; omitting it recreates the stranded-tab defect.
- **A URL event needs no board pattern but does need a source tab for restoration.** The service can
  route the return to the owning board from its claim record, while `BrowserWebviewModel` restores
  the browser source tab it already owns. An existing tab must rewind/restore its captured previous URL;
  a return-created `new-window` tab must be closed by its exact internal id. Neither case closes the
  user's browser page, and neither should leave a `.invalid` entry in navigation history. Do not solve
  this by searching pages by URL: browser tabs can share URLs and a return URL can be delivered by
  redirects or a new internal tab.
- **Frame reload invalidates claims.** `BoardWebview` reuses the iframe element across loads, so
  identity by DOM element alone is insufficient. The service must receive a load generation/reset
  signal and must never deliver an old claim to the newly loaded document.
- **Board loss is not reassignment.** A retired nonce may consume a stale return and rewind the
  browser, but it must never be attached to another board, even if that board asks for a new claim.
  Renderer restart clears the in-memory registry; the reserved HTTPS URL then cannot be delivered,
  which is preferable to routing it to an unrelated board.
- **Trust is a capability gate, not a manifest permission.** Existing board rendering and runtime
  transports use `isBoardPermitted()`/provenance. Bundled boards must work without a trust-file row;
  untrusted boards must not get a create reply. The API does not grant network access and must not
  introduce a new `permissions` value.
- **Bridge version and guide drift.** `src/board-shim.ts` is runtime authority and the two shipped
  prose guides are the maintained authoring references. The legacy
  `src/renderer/editors/board/board-api.d.ts` snapshot is optional and must not become a required
  contract gate; the bridge version must still be bumped additively.
- **Draw is deliberately not generalized beyond the URL seam.** US-1490 owns library fetch,
  persistence, and parity audit; this task only gives native draw and boards the same mechanism.

## Acceptance Criteria

1. A trusted or bundled board can call `persephone.navigation.createReturnUrl()` without supplying a
   pattern and receives only a URL of the exact minted `.invalid` form. An untrusted board receives no
   successful mint.
2. `persephone.navigation.onReturn(handler)` returns an unsubscribe function. A claimed return
   delivers the complete URL plus parsed query and hash maps, including percent-decoding and duplicate
   keys, to the frame that minted that URL only.
3. The renderer has one process-lifetime `browserUrlChanged` subscriber for return claims. It matches
   only active or retired Persephone-minted nonces, sets `handled` synchronously, selects the owning
   host page when it still exists, and posts to the exact live owning frame.
4. Claims are invalidated on frame disposal and on every board-frame reload. A return for a retired
   claim is consumed/rewound when possible and is never delivered to a replacement board or frame.
5. Full navigations, redirect completions, and main-frame hash-only/in-page navigations reach the claim
   service according to the verified Electron event split. A claimed navigation in an existing tab is
   restored to its captured previous URL without an invalid `addNavHistory` entry; a claimed
   return-created `new-window` tab is closed by its exact internal id. Neither path closes the user's
   browser page or leaves the user on the minted invalid URL.
6. `editors/draw` no longer defines or exports `LIBRARY_RETURN_URL`, no longer subscribes directly to
   `browserUrlChanged`, and passes a service-minted URL to Excalidraw through existing island props
   with no unrelated draw-editor refactor.
7. The runtime shim contract, additive bridge version, `assets/guides/agents/boards.md`, and
   `assets/board-template/CLAUDE.md` agree on the new API and lifecycle. The legacy
   `board-api.d.ts` snapshot is not an acceptance dependency. No main-process board-port RPC,
   network-fetch capability, test harness, or task-dashboard/epic-tracking edit is added by this task.

## Files Changed Summary

| File | Change |
|---|---|
| `src/renderer/api/board-navigation-return.ts` | New renderer-owned service: nonce minting, active/retired claim registry, one browser URL subscriber, focus/routing, and native/board owner registration. |
| `src/renderer/api/app.ts` | Initialize the process-lifetime return service from `initEvents()`. |
| `src/renderer/core/state/events.ts` | Keep `BrowserUrlEvent` as the cooperative claim event; extend only if final publisher-side restoration needs verified source metadata. |
| `src/renderer/editors/browser/BrowserWebviewModel.ts` | Restore a claimed source tab after synchronous service handling at both URL publication sites. |
| `src/ipc/board-bridge-channels.ts` | Add typed host-frame create/reply/return message shapes. |
| `src/renderer/editors/board/BoardWebview.ts` | Validate navigation requests, bind claims to the live frame/generation, deliver return events, and release/reset claims. |
| `src/board-shim.ts` | Add `persephone.navigation.createReturnUrl()` and `.onReturn()` using existing host-message/pending-request/subscription idioms. |
| `src/renderer/editors/board/board-api.d.ts` | No required change; this legacy IntelliSense snapshot may be optionally mirrored, but the maintained contract is the shim plus the two prose guides. |
| `src/shared/board-bridge-version.ts` | Bump the additive bridge contract version. |
| `assets/guides/agents/boards.md` | Document public return-URL API, parsing, trust, and lifecycle. |
| `assets/board-template/CLAUDE.md` | Keep board-template authoring reference aligned with shipped API and version. |
| `src/renderer/editors/draw/ExcalidrawIsland.tsx` | Delete `LIBRARY_RETURN_URL`; accept parent-provided minted URL. |
| `src/renderer/editors/draw/DrawBodyView.ts` | Replace private URL subscriber with a minimal native claim and preserve existing library callback. |
| `src/main/board-bridge.ts` | No change; return ownership is renderer/frame-local and must not become a second main-process registry. |
| `src/main/browser-service.ts` | No change; existing full/in-page event relays cover required navigation cases. |
| `scripts/dev.mjs`, `scripts/build-prod.mjs`, `src/main/board-protocol-service.ts` | No change; existing board-shim build and inline path already picks up the source change. |
| `doc/active-work.md` | No change; dashboard entry already exists. |
| `doc/epics/EPIC-109.md` | No change; US-1489 Linked Tasks row already links this document. |
| `assets/boards/excalidraw/**` | No change; US-1490 consumes the API, while this task only migrates the built-in draw editor. |
| Unit tests/test harnesses | No change; explicitly out of scope for this investigation task. |
