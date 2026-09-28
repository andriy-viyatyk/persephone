# US-1542: Host-frame request/reply channel — one table on each side, typed message union

## Goal

Replace the duplicated board-shim request bookkeeping and renderer message dispatch with one request table in the shim and one typed handler table in `BoardWebview`, while preserving every host-frame wire message and board-visible behavior. Centralize the renderer's frame-current check and posting error handling so a reply can only target the still-current frame.

## Background

This is [EPIC-115](../../epics/EPIC-115.md#us-1542) Phase 2, a structural fix for roadmap item 12. The epic describes ten shim maps/counters: eight for this host-frame channel, plus `pendingRpc`/`rpcId` and `pendingCalls`/`callId` on the separate board↔main MessagePort. Its current source details must be refreshed because US-1534–1541, US-1544, and US-1547 have landed. Capability transport ownership changed in US-1539/1540: `BoardWebview.pendingCapability` now correlates only wire replies; capability settlement policy belongs to the transport. The task scope intentionally excludes `doc/active-work.md`; the user will update the dashboard.

`src/ipc/board-bridge-channels.ts` (header lines 1–20, imports lines 22–67) is dependency-light and explicitly documents that the injected `src/board-shim.ts` can import its types. `src/board-shim.ts:31-66` already uses type-only imports from it. The shim is built as an IIFE (`scripts/build-prod.mjs:127-132`; `scripts/dev.mjs:106-111`) and the board protocol service reads the built `board-shim.js` and inlines it into served HTML (`src/main/board-protocol-service.ts:129-141`). It currently defines `BoardToHostMsg` as one optional-field interface (`board-bridge-channels.ts:375-447`), while renderer dispatch widens it with a local `legacy` cast (`BoardWebview.ts:507-525`). Its `BoardHostFrameMsg` union already gathers most host-frame message types (`board-bridge-channels.ts:626-652`) but omits three defined variants; the board-to-host branch needs message-specific payload typing and must include toolbar `controls` and file-icon `names` payloads.

## Implementation plan

- [x] **Verify the injection/bundle boundary** in `src/board-shim.ts`, `src/renderer/editors/board/custom-editor-registry.ts`, and the Vite/build configuration. The shim is a built standalone browser IIFE, inlined into board HTML; type-only channel imports are erased and the shim already imports the shared channel module's types.
- [x] **Inventory the complete `window.postMessage` protocol** by tracing both directions in `src/board-shim.ts`, `src/renderer/editors/board/BoardWebview.ts`, and all consumers of types/message strings. The verified inventory below is the implementation checklist.
- [x] In `src/ipc/board-bridge-channels.ts`, replace the flat `BoardToHostMsg` optional-property shape with a discriminated union of exact `__persephone` literals and per-message payloads. Make it cover **all** board→host messages, including `BoardContentOpenRequestMsg`, `BoardToolbarSetMsg`/`BoardToolbarUpdateMsg` (`controls`), the shim-local `BoardToolbarTextMsg`, and `board:fileIcons` (`names`); add named typed message shapes for remaining fire-and-forget variants and type host→board replies/pushes in the complete ingress union. Complete the aggregate `BoardHostFrameMsg` too: it currently omits `BoardContentOpenRequestMsg`, `BoardFileIconsResultMsg`, and `BoardOpenContentResultMsg`.
- [x] In `src/board-shim.ts`, implement one `hostRequest(type, payload)` correlation path with one pending map, one counter, and one reply listener. Each pending entry stores expected reply type plus its decoder; a mismatched type is ignored without settling. Use the decoder and post-failure mapping above. Convert each request API into a thin typed call without changing message names or payload fields.
- [x] In `src/board-shim.ts`, queue every `hostRequest` post until the current document's `load` event (or `document.readyState === "complete"`) using the established toolbar queue ordering; leave fire-and-forget pushes at current timing except toolbar's existing queue. This ensures host receipt captures the post-load generation.
- [x] In `src/renderer/editors/board/BoardWebview.ts`, dispatch host-frame messages through a `Record<messageType, handler>` table from `handleMessage`; represent the exact main-frame gates/logging above as metadata. Use `replyToFrame(frame, generation, msg): boolean` for replies; it returns true only after a successful post and owns `live && generation === this.generation && this.iframe === frame && model.frames.get(tabId) === frame && contentWindow`, plus the post try/catch.
- [x] Keep `resolveContentOpen` cleanup conditional on `replyToFrame`'s boolean: if delivery fails after a pipe resource was registered, release that resource, matching today's post-catch behavior. Navigation claims are created before posting; today a failed post does not roll back the claim, so preserve its current expiry/frame-reset lifecycle without adding rollback.
- [x] Preserve existing pending lifecycles across [`BoardWebview.pendingCapability`](../../../src/renderer/editors/board/BoardWebview.ts) and renderer content-open work. On reload, capability correlations reject, `pendingContentOpen` controllers abort/clear and model pipe resources are released; old-document shim maps disappear with that document. Keep AiVision lifecycle and the existing `setAiVisionTransport` calls unchanged; include `ai:request`/`board:aiResult`, `board:aiVision`, and `board:aiNotify` in the typed union and handler table without behavior change.
- [x] Check [`src/main/board-bridge.ts`](../../../src/main/board-bridge.ts) and its method table behind shim `rpc()` as the structural precedent; do not fold the independent board↔main MessagePort protocol into this host-frame channel.
- [x] Search for raw host-frame protocol consumers outside this repo (sibling `persephone-boards`, `assets/`, and `boards-assets/`). No direct `__persephone` protocol consumers were found; sibling torrent-viewer uses public `persephone.*` APIs. Preserve current wire strings and fields.

### Current host-frame wire inventory

“Shim” here is the injected board document. “Renderer” is `BoardWebview` in the Persephone host. All host-frame messages are sent with `window.parent.postMessage` / `iframe.contentWindow.postMessage`; they are distinct from the board-to-main `MessagePort` protocol (`kind: "rpc"` and `kind: "call"`). The shim's `onHostMessage` gate requires `event.source === window.parent` and, for strict HTTP(S) hosts, `event.origin === boot.hostOrigin`. The renderer's `handleMessage` gate requires the expected `board://${host}` origin and `event.source === frame.contentWindow`.

| Type string(s) | Direction | Request/reply pairing | Current shim pending map + id | Current renderer handler and checks | Fire-and-forget / details |
|---|---|---|---|---|---|
| `board:var` → `var:result` | Board → host → board | `persephone.vars.get/set/list/show(...)` → `var:result` | `pendingVar`; independent `varReqId`; listener deletes before resolve/reject. | `handleMessage` → `resolveVariable`; catches namespace/request errors into reply; captures generation and checks `live`, generation, iframe identity, contentWindow before post; **no `frames.get` and no post try/catch**. | Request post has try/catch and deletes/rejects on synchronous failure. `persephone.vars.*` all share the same type pair. |
| `board:settings` → `settings:result` | Board → host → board | `persephone.settings.get(id)` → `settings:result` | `pendingSettings`; independent `settingsReqId`; listener validates scalar value and settles. | `handleMessage` → `resolveSettings`; catches errors; checks `live`, generation, iframe and `model.frames.get(tabId) === frame`; catches `postMessage`. | `settings:changed` is a separate host → board push, not a reply. |
| `board:filePath` → `filePath:result` | Board → host → board | `persephone.getFilePath()` when the source must be materialized → `filePath:result` | `pendingFilePath`; independent `filePathReqId`; listener deletes then resolves/rejects. | `handleMessage` → `resolveFilePath`; catches materialization errors; checks `live`, generation and iframe identity; **no `frames.get` and no post try/catch**. | Handshake `BoardPortInitMsg.filePath` settles ordinary local/plain paths without this round trip. |
| `board:fileIcons` → `fileIcons:result` | Board → host → board | `persephone.icons.forFiles(names)` → `fileIcons:result` | `pendingFileIcons`; independent `fileIconsReqId`; listener validates correlation and settles with urls/icons or error. | `handleMessage` → `resolveFileIcons`; catches resolver errors; checks `live`, generation and iframe identity; **no `frames.get` and no post try/catch**. | Shim batches uncached names at 500 per request and uses a theme-generation cache; repeated calls may be cache hits and not send a message. |
| `board:contentOpen` → `contentOpen:result` | Board → host → board | `persephone.content.open(link, options)` → `contentOpen:result` | `pendingContentOpen`; independent `contentOpenReqId`; listener validates URL/size/contentType or rejects. | `handleMessage` → `resolveContentOpen`; owns an AbortController and optional timeout; checks generation, iframe and `model.frames.get(tabId) === frame` before/after async work; catches `postMessage`, releasing a created resource if posting fails. | Reload aborts controllers and releases resources. This is the only host request that owns a registered board pipe resource. |
| `board:openContent` → `openContent:result` | Board → host → board | `persephone.openContent(request)` → `openContent:result` | `pendingOpenContent`; independent `openContentReqId`; listener resolves pageId or rejects. | `handleMessage` → `resolveOpenContent`; trust check and sync resolver; checks `live`, generation and iframe identity; **no `frames.get` and no post try/catch**. | Create-only page handoff; do not merge with `content.open`. |
| `navigation:createReturnUrl` → `navigation:returnUrl` | Board → host → board | `persephone.navigation.createReturnUrl()` → `navigation:returnUrl` | `pendingNavigationReturnUrls`; independent `navigationReturnReqId`; listener resolves URL/rejects error. | `handleMessage` → `resolveNavigationReturnUrl`; trust and current `model.frames.get(tabId)` checked before claim; claim is generation-bound; final check is `live` + iframe/contentWindow but **does not re-check generation or model map**; post is caught. | Separate host → board `navigation:return` delivery below. |
| `board:capabilities:list` → `capabilities:list:result` | Board → host → board | `persephone.capabilities.list()` → list result | Shared `pendingCapabilityCalls`; shared `capabilityReqId` with invoke; typed `reqId`; listener settles. | `handleMessage` → `resolveCapabilityList`; trust checked; final gate checks `live`, iframe identity and contentWindow, but **no generation or `frames.get`**; post caught. | List is not the intent request lifecycle; do not fold this wire correlation into `BoardWebview.pendingCapability`. |
| `board:capabilities:invoke` → `capabilities:invoke:result` | Board → host → board | `persephone.capabilities.invoke(id, payload, options)` → invoke result | Same `pendingCapabilityCalls` and `capabilityReqId` as list; listener settles. | `handleMessage` → async `resolveCapabilityInvoke`; trust checked, errors serialized; final gate checks `live`, iframe identity and contentWindow, but **no generation or `frames.get`**; post caught. | Public API response preserves pageId/result behavior. |
| `ai:request` → `board:aiResult` | Host → board → host | Renderer AiVision `requestAiVision(...)` → board AiVision remote → `board:aiResult` | **No shim map/id counter**: host `BoardWebview.pendingAiVision`, id `aiVisionRequestId`, timeout, generation, iframe/contentWindow identity; shim's `aiVisionGeneration` suppresses old-remote replies. | Incoming board result goes to `handleAiVisionResult`; matches host pending id, generation, iframe and contentWindow. `requestAiVision` catches send failure. | Pair is initiated by host automation/AiVision call, not a public board `persephone.*` call. It is request/reply and remains separate from shim hostRequest. |
| `capabilities:intent` → `capabilities:intent:result` | Host → board → host | Host capability transport dispatches to an already-open handler frame → board `persephone.intent.onRequest` callback → intent result. | **No shim numeric map**: request keyed by string `requestId`; shim owns `activeIntent` state. Host `BoardWebview.pendingCapability` is a string-keyed wire correlation map only (US-1540). | `handleMessage` → `handleCapabilityResult`; matches requestId, generation, iframe and contentWindow. Dispatch send failure settles error. | First request to a new handler page is carried in `BoardPortInitMsg.intent`; later dispatch uses this pair. Cancellation is separate below. Demo `demo.greet` is reusable; Excalidraw `image.edit` is `alwaysOpensNewPage` and exercises the init-intent path instead. |
| `board:aiVision` | Board → host | No reply; registration or refresh of remote shape. | No shim pending map/counter. | `handleAiVisionRegistration`; only main frame, current `model.frames.get(BOARD_CDP_TAB)`, trusted board, valid schema/shape. New registration rejects old host AiVision requests; refresh preserves them. | Registration may be followed by host `ai:request`; registration itself is fire-and-forget. |
| `board:aiNotify` | Board → host | No reply; remote notification. | No shim pending map/counter. | `handleAiVisionNotify`; main frame + current CDP frame + trust + text validation/rate limit. | Uses host logging/notification path. |
| `capabilities:intent:cancel` | Host → board | Best-effort cancellation for a prior `capabilities:intent` request; no reply. | Shim marks matching `activeIntent.cancelled`; no numeric id. | Sent by `cancelCapabilityIntent`; targets the captured pending contentWindow; post caught; deletes host pending entry. | Keep its string `requestId` namespace. |
| `host:content` | Host → board | No reply; content-host snapshot/change. | No shim pending map/counter. | Sent on content subscription and after iframe load; shim `settleHostContent(content, language)`. | Echo guarded and initial snapshot pushed. |
| `source:opened` | Host → board | No reply; runtime source identity event. | No shim pending map/counter; callback-less deliveries queue in `pendingSourceOpenUrls`. | `BoardWebview.flushPendingSourceUrls` pushes; shim listener queues until `source.onOpen` subscription or delivers callbacks. | Handshake also provides initial `sourceUrl`. |
| `state:sync` | Host → board | No reply; shared-state snapshot/update. | No shim pending map/counter; shim applies monotonic `seq`. | Host state subscription and load snapshot push; shim `applyStateSync`. | State `init/set/merge` in reverse direction use three fire-and-forget messages below. |
| `settings:changed` | Host → board | No reply; effective declared setting value push. | No shim pending map/counter; shim validates and calls `settings.onChange` callbacks. | `installSettingsSubscription`; checks `live`, captured generation, iframe, `model.frames.get(tabId)`, contentWindow; catches post failure. | Distinct from settings get/reply. |
| `toolbar:control` | Host → board | No reply; host toolbar action event. | No shim pending map/counter; shim validates id/type/value and invokes `toolbar.onAction` callbacks. | `sendToolbarControl`; main-frame/trust/current-frame gate; catches post failure. | The reverse messages `board:setToolbarControls` / `board:updateToolbarControls` configure controls. |
| `navigation:return` | Host → board | No reply; delivers claimed return URL plus query/hash. | No shim pending map/counter; shim validates and invokes `navigation.onReturn`. | Claimed return is sent to exact owner by navigation-return service; `BoardWebview` does not dispatch it through `handleMessage`. | Distinct from `navigation:createReturnUrl` pair. |
| `__persephoneInit: true` (`BoardPortInitMsg`) | Host → board | No reply; handshake plus MessagePort transfer. Can carry the initial capability `intent`, `filePath`, `sourceUrl`, busy/content-host flags and other boot context. | Not a hostRequest; creates the board document's port and settles initial shim state. | `BoardWebview.transferPort`; posts into current iframe with transferred port. Shim's first `onHostMessage` listener validates the init envelope, settles boot values/intent, and attaches port (`BoardWebview.ts:366-403`, `board-shim.ts:1029-1074`). | This is still a `window.postMessage` type and is inventoried here; `connected` and subsequent `rpc`/`call` travel on its transferred MessagePort. |
| `board:interact` | Board → host | No reply; pointer interaction dismisses overlays. | No shim pending map/counter. | `handleMessage` directly calls `dismissOverlays`; source/origin gate only. | Sent on capture-phase pointerdown. |
| `board:error`, `board:log` | Board → host | No reply; error/log breadcrumb. | No shim pending map/counter; `board-console-mirror.ts` posts error/warn/error. | `handleMessage` calls `appendLog`; source/origin gate only. | Preserve warn vs error mapping. |
| `board:busy` | Board → host | No reply; busy flag update. | No shim pending map/counter. | `handleMessage` calls `model.setBusy`; source/origin gate only. | Initial busy value also comes in port init. |
| `board:setContent`, `board:save` | Board → host | No reply; content-host change and save request. | No shim pending map/counter. | `handleMessage` updates `lastBoardContent`/`hostChangeContent` or calls `hostSave`; source/origin gate only. | Content writes are echo guarded by host. |
| `board:setState`, `board:mergeState`, `board:stateInit` | Board → host | No reply; shared-state replacement, merge, or initialization. | No shim pending map/counter. | `handleMessage` calls `setSharedState`, `mergeSharedState`, `initSharedState`; source/origin gate only. | Carry `state`, `partial`, or `defaults` + `restorableKeys` respectively. |
| `board:setSecondaryViews` | Board → host | No reply; secondary-view replacement. | No shim pending map/counter. | `handleMessage` calls `model.setSecondaryViews`; source/origin gate only. | `views` needs a typed payload in the union. |
| `board:setStatusText` | Board → host | No reply; footer text. | No shim pending map/counter. | `handleMessage` applies only when `isMain`; no `model.frames` or trust check beyond source/origin. | Main-only behavior belongs in handler-table metadata. |
| `board:setToolbarText` | Board → host | No reply; transient page-toolbar label. | Queued in `pendingToolbarMessages` before shim document `load`; flushed after load; no request ID. | `handleMessage`; main + current CDP-frame + trust checks are copied in branch; captures current generation. | Explicitly main-only table metadata; preserve load-order queue. |
| `board:setToolbarControls`, `board:updateToolbarControls` | Board → host | No reply; set/patch toolbar descriptors. | Queued in the same toolbar queue before load; no request ID. | `handleMessage`; each branch repeats main + `model.frames.get(BOARD_CDP_TAB) === frame` + trust gate; normalization errors log warnings. | `controls` are currently outside `BoardToHostMsg`; type each shape. Main-only table metadata. |
| `board:cycleTheme` | Board → host | No reply; cycle app theme direction. | No shim pending map/counter. | `handleMessage` calls `cycleAppTheme`; source/origin gate only. | Payload `direction` is `1 | -1`. |
| `board:aiResult` | Board → host | Reply to host `ai:request`; included with that pair above. | No shim pending map; correlated by host `pendingAiVision` + `aiVisionRequestId`. | `handleMessage` → `handleAiVisionResult`; checks pending request generation, exact iframe and contentWindow; stale/missing requests ignored. | Error results use `response: { ok: false, error }`. |

The aggregate `BoardHostFrameMsg` currently omits the already-defined `BoardContentOpenRequestMsg`, `BoardFileIconsResultMsg`, and `BoardOpenContentResultMsg` (`board-bridge-channels.ts:626-652` vs definitions at lines 105, 115, and 485); add all three when completing the shared host-frame union. The frame-message type definitions also cover the following reply/push names, which must remain part of the typed dispatch union even though they are not requests from the board: `settings:result`, `filePath:result`, `fileIcons:result`, `contentOpen:result`, `openContent:result`, `var:result`, `navigation:returnUrl`, `capabilities:list:result`, and `capabilities:invoke:result` are host → board replies; `board:aiResult` and `capabilities:intent:result` are board → host; `settings:changed`, `host:content`, `source:opened`, and `state:sync` are host → board pushes. `BoardPortInitMsg` is a boot handshake with a transferred port; subsequent `connected`, `rpc-result`, `call-result`, runner messages, and theme travel on the port (`board-bridge-channels.ts:190-280`).

#### Source anchors verified against current source

- Shim runtime/type boundary and IIFE build: [`src/board-shim.ts:4`](../../../src/board-shim.ts:4), [`src/board-shim.ts:31`](../../../src/board-shim.ts:31), [`scripts/build-prod.mjs:129`](../../../scripts/build-prod.mjs:129), [`scripts/dev.mjs:108`](../../../scripts/dev.mjs:108), [`src/main/board-protocol-service.ts:129`](../../../src/main/board-protocol-service.ts:129).
- Shim request maps/counters, local toolbar message and request helpers: [`src/board-shim.ts:298`](../../../src/board-shim.ts:298), [`src/board-shim.ts:402`](../../../src/board-shim.ts:402), [`src/board-shim.ts:428`](../../../src/board-shim.ts:428), [`src/board-shim.ts:448`](../../../src/board-shim.ts:448), [`src/board-shim.ts:496`](../../../src/board-shim.ts:496), [`src/board-shim.ts:515`](../../../src/board-shim.ts:515), [`src/board-shim.ts:553`](../../../src/board-shim.ts:553), [`src/board-shim.ts:605`](../../../src/board-shim.ts:605), [`src/board-shim.ts:731`](../../../src/board-shim.ts:731), [`src/board-shim.ts:794`](../../../src/board-shim.ts:794), [`src/board-shim.ts:1022`](../../../src/board-shim.ts:1022).
- Renderer origin/source gate and dispatch: [`BoardWebview.ts:503`](../../../src/renderer/editors/board/BoardWebview.ts:503), [`BoardWebview.ts:507`](../../../src/renderer/editors/board/BoardWebview.ts:507), [`BoardWebview.ts:515`](../../../src/renderer/editors/board/BoardWebview.ts:515), [`BoardWebview.ts:561`](../../../src/renderer/editors/board/BoardWebview.ts:561), [`BoardWebview.ts:616`](../../../src/renderer/editors/board/BoardWebview.ts:616), [`BoardWebview.ts:649`](../../../src/renderer/editors/board/BoardWebview.ts:649).
- Reply paths and current liveness/post behavior: [`BoardWebview.ts:910`](../../../src/renderer/editors/board/BoardWebview.ts:910), [`BoardWebview.ts:935`](../../../src/renderer/editors/board/BoardWebview.ts:935), [`BoardWebview.ts:992`](../../../src/renderer/editors/board/BoardWebview.ts:992), [`BoardWebview.ts:1014`](../../../src/renderer/editors/board/BoardWebview.ts:1014), [`BoardWebview.ts:1033`](../../../src/renderer/editors/board/BoardWebview.ts:1033), [`BoardWebview.ts:1112`](../../../src/renderer/editors/board/BoardWebview.ts:1112), [`BoardWebview.ts:1159`](../../../src/renderer/editors/board/BoardWebview.ts:1159), [`BoardWebview.ts:1176`](../../../src/renderer/editors/board/BoardWebview.ts:1176), [`BoardWebview.ts:1199`](../../../src/renderer/editors/board/BoardWebview.ts:1199).
- Shared types and main-side pattern: [`src/ipc/board-bridge-channels.ts:375`](../../../src/ipc/board-bridge-channels.ts:375), [`src/ipc/board-bridge-channels.ts:626`](../../../src/ipc/board-bridge-channels.ts:626), [`src/main/board-bridge.ts:235`](../../../src/main/board-bridge.ts:235), [`src/main/board-bridge.ts:296`](../../../src/main/board-bridge.ts:296).
- Ownership consumers: `BoardEditorModel.frames` and content-resource lifecycle (`src/renderer/editors/board/BoardEditorModel.ts:222,284,658,709-722`); capability frame registry (`src/renderer/api/board-capability-transport.ts:26`); navigation claim ownership (`src/renderer/api/board-navigation-return.ts`, imported at `BoardWebview.ts:75`); toolbar control normalization/model (`src/renderer/editors/board/BoardWebview.ts:77-78,564-579`, `BoardToolbarControls.ts:102,161,185`). Keep these as consumers of the typed contract; they do not own the message dispatch table.
- Live fixture call sites: Demo registers intent handling at `assets/demo-board/app.js:30-48`, invokes `demo.greet` at `app.js:104-106`, creates navigation claims at `app.js:112-115`, and calls `content.open` at `app.js:324-327`. Excalidraw declares `image.edit` as `alwaysOpensNewPage` at `assets/boards/excalidraw/board-manifest.json:18`, exposes AiVision at `index.html:534`, reads settings at `index.html:166`, calls `getFilePath` at `index.html:581`, and wires toolbar controls at `index.html:694-718`. The sibling torrent viewer calls `content.open` (`app.js:341`), `icons.forFiles` (`app.js:587-588`), and toolbar setup/actions (`app.js:1592-1601`).
- Consumer search: all `BoardToHostMsg`/reply type declarations and host-frame literal consumers in `src/` were searched; `BoardWebview.ts` and `board-shim.ts` are the runtime endpoints. No raw host-frame protocol posts/listeners were found in `assets/`, `boards-assets/`, or the sibling `C:/projects/persephone-boards` source search. Published boards use the public `persephone.*` API; sibling torrent-viewer call sites include `app.js:341,587,1202,1592-1601`.

#### Exact shim reply decoding and post-failure mapping

Each pending entry in the proposed shared map stores its expected reply discriminator and its own `settle(data)` decoder. The sole reply listener looks up `reqId`; if no entry exists or `data.__persephone` differs from `expectedReplyType`, it ignores the message and leaves the entry pending. A matching reply deletes the entry once, then calls its decoder. Preserve these current per-pair semantics:

| Request → reply | Decoder / validation to preserve | Synchronous post failure |
|---|---|---|
| `board:var` → `var:result` | Reject on reply `error`; otherwise resolve raw `result` (no added shape validation). | `new Error("Persephone host is unavailable.")` |
| `board:settings` → `settings:result` | Reject on reply `error`; accept `value` only when `isBoardSettingValue(value)`; otherwise preserve the malformed-settings rejection. | `new Error("Persephone host is unavailable.")` |
| `board:filePath` → `filePath:result` | Reject on reply `error`; otherwise resolve `path` as today (no added shape validation). | `new Error("Persephone host is unavailable.")` |
| `board:fileIcons` → `fileIcons:result` | Reject on reply `error`; otherwise resolve `urls ?? []` and `icons ?? {}` as today; do not add structural validation. | `new Error("Persephone host is unavailable.")` |
| `board:contentOpen` → `contentOpen:result` | Reject on reply `error`; require string `url`, finite non-negative `size`, and string `contentType`; preserve malformed-reply rejection. | `new Error("Persephone host is unavailable.")` |
| `board:openContent` → `openContent:result` | Reject on reply `error`; require string `pageId`; preserve malformed-reply rejection. | `new Error("Persephone host is unavailable.")` |
| `navigation:createReturnUrl` → `navigation:returnUrl` | Reject on reply `error`; resolve string `url`; otherwise preserve malformed-reply rejection. | `new Error("Persephone host is unavailable.")` |
| `board:capabilities:list` → `capabilities:list:result` | Convert reply errors with existing `capabilityErrorFromReply`; otherwise resolve raw list result. | `BoardCapabilityError("rejected", errMessage(error, "Persephone host is unavailable."))` |
| `board:capabilities:invoke` → `capabilities:invoke:result` | Convert reply errors with `capabilityErrorFromReply`; if `pageId` is a string resolve `{ pageId, result }`, otherwise `{ result }`, preserving the current projection. | `BoardCapabilityError("rejected", errMessage(error, "Persephone host is unavailable."))` |

The per-type post-failure rejection is existing API behavior: do not normalize capability rows to plain `Error`, or other rows to `BoardCapabilityError`.

#### Main-frame gate metadata to preserve

The handler table metadata must reproduce these current checks and logging exactly:

| Board→host message | Gate kind | Rejection log |
|---|---|---|
| `board:setToolbarControls` | `isMain` AND `model.frames.get(BOARD_CDP_TAB) === frame` AND `isBoardPermitted(boardRoot)` | warn: `Ignored board toolbar controls from a non-main or unavailable frame.` |
| `board:updateToolbarControls` | Same three checks | warn: `Ignored board toolbar update from a non-main or unavailable frame.` |
| `board:setToolbarText` | Same three checks | warn: `Ignored board toolbar text from a non-main or unavailable frame.` |
| `board:setStatusText` | `isMain` only; no current-frame lookup or trust check | none; silently ignored when not main |
| `board:aiVision` registration | Main frame AND current `BOARD_CDP_TAB` frame AND trusted board, folded into existing shape/schema validation | warn: `Ignored invalid or untrusted AiVision registration.` for any failed gate or validation |
| `board:aiNotify` | Main frame AND current `BOARD_CDP_TAB` frame AND trusted board AND string text, followed by existing normalization/rate limit | none for gate failure; silently ignored |

`toolbar:control` is the reverse host→board action and remains guarded in `sendToolbarControl` by live/main/host/frame/contentWindow, current `BOARD_CDP_TAB` identity, and trust; post failure remains caught without a log. Do not move this outgoing guard into incoming handler metadata.

### Before → after design sketch

**Shim**

```ts
// Before: each API repeats its own pending map, id counter and post/catch logic.
pendingVar.set(reqId, { resolve, reject });
window.parent.postMessage({ __persephone: "board:var", reqId, varMethod, varArgs }, hostPostTarget);

// After: one helper owns correlation and wire posting; APIs provide their message payload.
hostRequest("board:var", { varMethod, varArgs });
```

**Renderer**

```ts
// Before: handleMessage switches on strings and casts an untyped envelope to `legacy`.
const legacy = data as BoardToHostMsg & { controls?: unknown; names?: string[]; ... };

// After: discriminated ingress union + one typed handler table; replyToFrame owns liveness.
const handlers: Record<BoardToHostMsg["__persephone"], HostMessageHandler> = { ... };
replyToFrame(frame, generation, reply);
```

`BoardToHostMsg` should be the incoming board→host discriminator so the renderer can narrow the
message directly in each handler. `BoardHostFrameMsg` can remain the all-directions export for the
shim and type consumers, but it must be complete; `handleMessage` must not recast to a parallel
legacy envelope.

**Id namespace decision:** use one shim counter for all host-frame request/reply pairs, seeded cheaply from a random 31-bit offset and incremented thereafter. This reduces the chance that a delayed stale reply from an old document could match the same `reqId` in its replacement; the pending entry also checks expected reply type. Every reply retains its existing `reqId` field. The public board API does not expose IDs, and no shipped raw-protocol consumer was found. A deliberate raw window-message observer can see different numeric values; accept this internal correlation detail as outside the supported API. Keep the separate board↔main `rpc` and `call` ids on the MessagePort.

## Decisions

- **Pre-load request ordering: queue every `hostRequest` until document load.** `BoardWebview.handleLoad` runs on the iframe `load` event after scripts have started and increments generation then. Without the shim gate, a startup request could arrive at generation N and have its reply dropped after load advances to N+1. Reuse the existing toolbar `document.readyState`/`load` queue. Board-visible effect is timing only: a pre-load request resolves after load instead of racing; API and wire contract do not change, so there is no bridge version bump.
- **Bridge version: do not bump `BOARD_BRIDGE_VERSION` (currently `1.21.0`, [`src/shared/board-bridge-version.ts:2`](../../../src/shared/board-bridge-version.ts:2)).** EPIC-115 says a bump is required when a story changes what a board sees, such as a result shape, a new public `persephone.*` member, or the service protocol (`doc/epics/EPIC-115.md:35-38`). This plan retains every host-frame type string, payload/reply field, result shape, and public API; load gating changes timing only. The new request ID sequence is opaque correlation metadata; a board's public API cannot observe its numeric value. The shim is injected by the host and ships with its renderer. Searches of repo assets and sibling `C:/projects/persephone-boards` found no raw message consumers; boards use public `persephone.*` APIs. If implementation changes any payload or public result, revisit this decision and apply the epic bump rule.
- **Use one numeric ID counter for shim host-frame requests.** These IDs correlate unchanged replies by type plus `reqId` and have no cross-request ordering guarantee in the public board API. Keep string `requestId` for capability intent, and keep board↔main port `rpcId`/`callId` separate.
- **Keep `board:capabilities:intent` and host-initiated `ai:request` correlation lifecycles explicit.** They are opposite-direction callback/request flows, use a string intent ID or host-owned renderer pending state, and are not shim-initiated `hostRequest` calls.
- **Recommend implementing both ends in one change, while allowing a two-commit split if needed.** A shim-only commit using one `hostRequest` can retain the existing wire contract, and a renderer-only commit using a handler table plus `replyToFrame` can also retain it; both intermediate states are independently wire-compatible. Keeping both together is simpler to review against one end-to-end inventory, not a compatibility requirement.

## Concerns / Open questions

- Frame replacement already rejects renderer `pendingCapability`, aborts content-open controllers, releases content resources, resets navigation claims and retires the generation (`BoardWebview.ts:406-423`). Old shim pending entries disappear with the old document; random-seeded IDs further reduce stale-reply collisions. A pre-load `content.open` currently starts before `load`, then `handleLoad` aborts its controller; after request gating it begins after load and can complete normally.
- AiVision reload cleanup was considered and left out of scope; `pendingAiVision` entries settle via their existing timeout, a new registration rejects old entries, and `onDispose` rejects them.
- Pre-load request deadlock is not expected: the browser's document `load` event is not blocked by an async module's top-level await. The shim queues its host request until that event, then posts it; the request's awaiting module continuation does not gate dispatch of the load event. Excalidraw's startup `loadExistingLibrary(api)` calls `loadLibrary()`, which calls `resolveLibraryPath()` and awaits `persephone.settings.get("library-path")` (`assets/boards/excalidraw/index.html:165-180,228,733`); this is the concrete startup case the gate must cover.
- The shared pending map needs a unique key namespace and the single reply listener must dispatch by reply type plus `reqId`; request IDs for intent, AiVision, and the main MessagePort remain separate.
- Host-frame window messages have differing trust and frame requirements: some requests are main-frame-only, some requests originate in child frames, and state/content updates may have different policy. The table metadata must encode the existing policy exactly.
- A reply arriving after frame replacement must not settle the replacement document's first same-type request. Preserve the reply-type check, random-seeded request counter, generation/current-frame guard and request gating, and verify with an intentionally delayed old reply.

## Acceptance criteria

- [x] Every current host-frame message type in both directions is accounted for in the inventory, including fire-and-forget and unsolicited host→board messages.
- [x] Shim request/reply APIs use one host-frame pending map, one random-seeded request id counter and one reply listener; each entry validates expected reply type and uses its per-type decoder and post-failure rejection. Every request waits for document load; fire-and-forget timing remains unchanged except for the existing toolbar queue. The public board API, wire strings, payload fields and reply fields remain unchanged.
- [x] `BoardToHostMsg` is a discriminated union over every board→host message with exact per-type payloads, including toolbar `controls` and file-icon `names`; `BoardWebview.handleMessage` needs no `legacy` cast.
- [x] Renderer host-frame dispatch is table-driven; main-frame policy and exact logging are declared once as metadata; all replies use one boolean-returning helper that checks live state, generation, iframe identity, `model.frames.get(tabId)`, and `contentWindow`, and catches `postMessage` failure. Content-open releases a registered pipe resource when the helper returns false; failed navigation-return delivery retains the current claim lifecycle without rollback.
- [x] A frame reload during an in-flight request cleans renderer-side pending state, allows old-document work to expire harmlessly, and the new document can successfully make the same request.
- [x] No bridge version bump is made if the board-visible API and wire protocol remain unchanged. Any proposed observable change is called out against the EPIC-115 bump rule before implementation.
- [ ] Live verification invokes every request/reply pair at least twice on real boards and includes a module-top-level pre-load request plus a delayed old reply after reload while the replacement's first same-type request is pending, as detailed below.

## Live verification plan

Use a trusted scratch copy of `assets/demo-board` (preserve the existing scratch copy outside the repo) and the real bundled Excalidraw board at `assets/boards/excalidraw`; use `C:/projects/persephone-boards/boards/torrent-viewer` for its public APIs when the sibling checkout is installed as a trusted board. For each paired row below, cause two wire requests and confirm both settle with the same result shape. Keep the same loaded frame for repeatable calls; where the public API caches a result for the document lifetime (notably `getFilePath()`), reload the iframe without closing the board page before the second call. IDs may differ; type strings, fields, and behavior must not.

| Pair/path | Real-board trigger (repeat twice) | Expected check |
|---|---|---|
| `board:var` / `var:result` | Demo board devtools: `await persephone.vars.list()` twice; also exercise `get` against an existing namespace key if configured. | Both promises settle; one `var:result` per `reqId`. |
| `board:settings` / `settings:result` | Excalidraw: `await persephone.settings.get("library-path")` twice. | Scalar/default result both times; no stale correlation. |
| `board:filePath` / `filePath:result` | Open Excalidraw as a custom editor for a real archive-backed/materialized file to force this request (plain local paths use the handshake). Call `await persephone.getFilePath()` once, reload the iframe without closing the board page, then call it again. | Both requests return readable local paths. The per-document materialized-path cache is expected. |
| `board:fileIcons` / `fileIcons:result` | Trusted torrent viewer: call `await persephone.icons.forFiles(["readme.md", "image.png"])`, change theme to invalidate its icon cache, and call it again in the same frame. | URLs/icons maps resolve; both batches reach host and cache policy remains intact. |
| `board:contentOpen` / `contentOpen:result` | Demo board's **content.open mem://demo** control (`P.content.open("mem://demo")`) twice; torrent viewer's file content open (`P.content.open(...)`) twice. | URL, size, and contentType settle; resource releases on cancellation/reload. |
| `board:openContent` / `openContent:result` | Demo board console: `await persephone.openContent({ editor: "md-view", language: "markdown", title: "Channel check", content: "ok" })` twice. | Each call returns a new pageId or the same documented rejection; no hung promise. |
| `navigation:createReturnUrl` / `navigation:returnUrl` | Demo board **navigation.createReturnUrl** control twice; Excalidraw library return flow twice. Complete each return navigation so `navigation:return` is exercised too. | Each claim is unique and bound to the live frame; return callbacks receive url/query/hash. |
| `board:capabilities:list` / `capabilities:list:result` | Demo board console: `await persephone.capabilities.list()` twice. | Both results settle with the same list shape. |
| `board:capabilities:invoke` / `capabilities:invoke:result` | Demo board **capabilities.invoke → demo.greet** control twice. | Both calls resolve the expected result envelope. |
| `capabilities:intent` / `capabilities:intent:result` | Host invokes Demo's reusable handler once with `app.capabilities.invoke("demo.greet", { name: "warmup" })` to open it, then invokes twice more while that page remains open. Also invoke Excalidraw's `image.edit` twice through the host with real images. | The two Demo reuses exercise the window-message pair; Excalidraw's `alwaysOpensNewPage` path verifies initial intent delivery through `BoardPortInitMsg` and its result. |
| `ai:request` / `board:aiResult` | Excalidraw calls `persephone.aiVision.expose(model)`; invoke a real member through the host board AiVision proxy (`pages[i].editor.app.<member>`) twice. Include a rejected/unsupported remote operation. | Each host pending request settles once; replacing the AiVision registration rejects old pending requests, while a frame reload leaves existing pending work to its timeout and a fresh registration can serve new requests. |
| `capabilities:intent:cancel` | Start a delayed Demo intent request or an Excalidraw `image.edit` while `editorReady` is pending, cancel it from the host, then start another; perform cancel/retry twice. | Cancellation remains best-effort and does not block the next intent. |

Exercise every fire-and-forget row twice as applicable: Demo pointer interaction, console warn/error, busy set/clear, shared-state init/set/merge, and secondary-view changes; Excalidraw toolbar set/update plus two toolbar action clicks, status/toolbar text, theme-cycle shortcut, and a content-host edit/save; AiVision registration/refresh and notification; host content/state/settings/source pushes and navigation return delivery. Confirm main-frame-only toolbar and AiVision registration/notify behavior still rejects secondary frames. Exercise `source:opened` twice by opening a board source twice and `settings:changed` twice by changing a subscribed setting twice.

**Reload mid-request:** start a deliberately slow torrent `content.open(...)` (or another provider-backed open) and reload that board frame before it settles. Confirm the old request is aborted/released, its shim document and pending map are gone, renderer pending work is cleaned, and a second `content.open(...)` in the replacement document resolves twice. Repeat with an outstanding host-frame request/reply pair and confirm no old reply is delivered into the replacement frame.

**Pre-load request:** in the trusted Demo scratch copy, temporarily call `persephone.capabilities.list()` at module top level before the document `load` event; confirm the shim queues the request, it resolves after load, and it does not hang or get dropped by the generation change. Also exercise Excalidraw's startup `loadExistingLibrary()` → `loadLibrary()` → `resolveLibraryPath()` call to `persephone.settings.get("library-path")`. A top-level awaited promise does not block the document's `load` event, so the queue can flush and then resume the awaiting startup code.

**Old reply after reload:** hold a `content.open` on a slow provider or a `capabilities.invoke` whose handler has not answered, reload the frame, and issue the same request type as the replacement document's first request. Let the old operation's reply attempt arrive after reload; verify it cannot settle the new pending promise, while the new request settles from its own matching reply. Repeat the scenario at least twice.

EPIC-115 standing rule: every changed path must be invoked twice live because typecheck, lint, and production build previously passed despite shipped request-reuse defects (`doc/epics/EPIC-115.md:33-40`).

## Live verification results (2026-09-28)

Run against the dev build after a cold restart, on the trusted Demo scratch board (main frame and the
`shared-state` secondary frame) and the bundled Excalidraw board. Every pair below was invoked at least twice.

- **Board → host requests, main frame:** `capabilities.list`, `capabilities.invoke("demo.greet")`,
  `settings.get` (error reply on Demo, no author; success reply `""` on Excalidraw `library-path`),
  `icons.forFiles`, `content.open("mem://demo")`, `navigation.createReturnUrl`, `openContent`, `var.get`.
  All replied with the same shapes as before. `getFilePath()` resolved from the handshake.
- **Secondary frame:** `capabilities.list`, `icons.forFiles`, `content.open`, `navigation.createReturnUrl`
  all replied. The `model.frames.get(tabId)` check holds for non-main frames.
- **Pre-load requests:** an inline script in the board `<head>` (`readyState === "loading"`) issued
  `capabilities.list`, `icons.forFiles`, `content.open` and `navigation.createReturnUrl`. All four resolved
  about 15 ms later, after load (run twice). Before this change the pre-load `content.open` would have been
  aborted by `handleLoad`.
- **Reload mid-request:** the board invoked a hanging `demo.greet` handler, then reloaded itself. The new
  document's `invoke` and `content.open` both resolved twice. On the host side, a hanging
  `app.capabilities.invoke` was rejected with `crashed` ("The board frame was reloaded.") when the frame
  reloaded, and a fresh invoke succeeded afterwards (run twice).
- **Host → board pairs:** `capabilities:intent` reused the open Demo page (success, `rejected`, and
  `timeout` + `capabilities:intent:cancel`, followed by a successful call). Excalidraw `image.edit`
  opened a new page twice (init-intent path). `ai:request`/`board:aiResult`: `exportAsSvg()` twice, plus an
  unknown-member error. `navigation:return`: two claims were delivered through `window.open` from a browser tab.
- **Fire-and-forget:** busy, status text, toolbar text, shared-state set/merge (broadcast reached the
  secondary frame), `console.warn` → `board:log` → `ui.log`, `board:cycleTheme` (both directions),
  `board:setSecondaryViews`, `board:setToolbarControls` (Excalidraw controls rendered), and `toolbar:control`
  (two clicks reached the board's `onAction`).
- **Gates:** from the secondary frame, `setToolbarText` logged `Ignored board toolbar text from a non-main or
  unavailable frame.` and `setStatusText` was dropped silently. Neither changed host state.
- **Pre-existing, not a regression:** Excalidraw's `toolbar.update` title patch does not change the host
  button's `aria-label`. HEAD shows the same result (checked by stashing this change and restarting). It was
  not investigated further, because it is outside this story.

### Not verified

- The `board:filePath` wire request. It fires only for a non-local source (for example http or an archive).
  Neither test board had one, so `getFilePath()` resolved from the handshake.
- `board:aiNotify`, `board:interact` (overlay dismissal), `board:stateInit`, `board:setContent`/`board:save`,
  `host:content`, `source:opened` and `settings:changed` were not exercised explicitly. They moved into
  the handler table with no change to their logic.
- The torrent viewer (persephone-boards) was not opened. Its `icons.forFiles`/`content.open`/toolbar paths
  were exercised on the Demo and Excalidraw boards instead.
- A board-side reply that arrives after a reload was covered with `capabilities.invoke`, not with a slow
  `content.open` provider.

## Files Changed summary

| File | Planned change |
|---|---|
| `src/ipc/board-bridge-channels.ts` | Typed-per-message `BoardToHostMsg`; complete `BoardHostFrameMsg`; include its missing content-open request and file-icons/open-content replies. |
| `src/board-shim.ts` | One host-frame request map/id counter/reply listener; thin request API wrappers. Leave port RPC/call maps unchanged. |
| `src/renderer/editors/board/BoardWebview.ts` | Typed handler table, one metadata-based main-frame gate, and centralized current-frame reply helper; preserve the current AiVision lifecycle. |
| `doc/tasks/US-1542-host-frame-channel/README.md` | This investigation and implementation plan only. |
| `doc/epics/EPIC-115.md` | Link the US-1542 row to this task document. |

### Files verified as no-change / verification-only

| File or area | Reason |
|---|---|
| `doc/active-work.md` | User explicitly owns dashboard edits for this task. |
| `src/main/board-bridge.ts` | Read-only precedent for one method table behind shim `rpc()`; separate MessagePort protocol. |
| `src/renderer/editors/board/BoardEditorModel.ts` | Existing frame registry/resource ownership remains the source checked by `replyToFrame`; no message-dispatch refactor planned. |
| `src/renderer/api/board-capability-transport.ts` | US-1539/1540 capability lifecycle owner remains unchanged; `pendingCapability` continues to correlate the frame reply. |
| `src/shared/board-bridge-version.ts` | Keep `BOARD_BRIDGE_VERSION` at `1.21.0` because the board API and wire contract remain unchanged. |
| `assets/`, `boards-assets/`, sibling `persephone-boards` | No raw protocol consumers found; board-side public API and service implementations need no edits. |
