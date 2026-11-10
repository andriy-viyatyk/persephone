> Part of the [refactoring roadmap](../../refactoring-roadmap.md). Reviewed at commit `c798129d` (2026-11-10); line numbers drift, so search by symbol when they no longer match.

# 02-boundary (process boundaries and contracts) — refactoring review

## Summary

The older parts of the boundary are in good shape. The module-service wire unions, `shared/execute-handle.ts`, `bindEndpoint`, and the pure helpers in `shared/` are small, typed, and owned in one place. The platform-era code (boards, services, capabilities, voice and audio) has grown a different way. Every feature added its own message names, its own request/reply correlator, and often its own copy of a protocol. Contract types exist, but the code at each end often re-declares them inline or skips them, so the compiler can't catch drift. Several drifts have already happened (details below). The wire protocols between the shim, the service host, the renderer and main are private: the app always ships both ends together. So all of the protocol work below can be done without bridge-version bumps. Only the `window.persephone.*` surface is public.

The three biggest problems:
1. **`src/board-shim.ts` is a 2.8k-line god module.** It does about 20 separate jobs, keeps 38 module-level `let`s, registers 18 independent `message` listeners, and makes 36 hand-written `postMessage` calls. The board-to-host-renderer protocol it speaks is about 40 ad-hoc message types whose request/result names are paired by hand (BND-1, BND-2, BND-3).
2. **The same protocol is implemented again in each process.** The windowed-ack service channel exists 6 times with different size checks, ack policies and error codes. The capability error-code list exists 7 times, in two different sets that share one type name. Request/reply correlation has at least 10 independent implementations (BND-4, BND-9, BND-10).
3. **Contract rules are re-derived at call sites instead of owned by a type.** The "what does this board grant allow" rule over `NormalizedBoardPermissions` appears at about 15 sites, and the renderer copy already disagrees with main (BND-5). Adding one main↔renderer endpoint takes edits in 5 places, and event payload types are declared 2–3 times (BND-7).

## Findings

### BND-1: `board-shim.ts` is one module doing ~20 jobs on shared module-global state
- **Priority:** P1
- **Effort:** L
- **Where:** `src/board-shim.ts:107-127` (sync-XHR `alert/confirm/prompt`), `:129-202` (themes JSON clone and RPC), `:224-279` (i18n and host text), `:307-328` (palette), `:330-438` (busy / filePath / sourceUrl handshake state), `:440-498` (host content and shared-state replicas), `:500-602` (port plumbing and AiVision element registry), `:609-800` (host-request correlator), `:655-734` and `:1591-1644` (streaming `fetch`), `:750-764` and `:2353-2382` (page state), `:819-902` (file icons cache), `:969-1108` (intent and capability invoke), `:1110-1156` (capability proxy), `:1158-1258` (service channels), `:1268-1374` (`call` and AiVision expose), `:1392-1478` (port dispatch), `:1496-1536` (save/discard protocol), `:1884-1966` (keyboard forwarding, link routing, overlay dismissal), `:2001-2822` (the ~820-line `window.persephone` object literal)
- **Problem:** The overview still calls this "a small in-board shim" (`doc/architecture/overview.md:533`). In fact it is one flat script whose features all share module-global state: `port`, `hostPostTarget`, `boot`, several id counters, and 21 module-level callback/resolver collections (`themeCbs`, `busyResolvers`, `filePathResolvers`, `hostChangeCbs`, `sharedStateCbs`, `toolbarActionCbs`, `muteToggleCbs`, …). Three generic mechanisms are hand-copied per feature:
  - **"Settle once, await any time" is written out 5 times** (busy `:336-343`, filePath `:350-393`, sourceUrl `:395-400`, host content `:446-468`, shared state `:476-498`). `whenHandshake()` (`:435-438`) piggybacks on `filePathResolvers`, so the handshake gate is coupled to the file-path feature.
  - **"Callback set + try/catch + console.error fan-out" is written out about 14 times.** Some use a `Set`, some an `Array` with `indexOf`/`splice` (`:328`, `:451`, `:480`, `:911`, `:990` vs `:358`, `:360`, `:917-919`).
  - **`try { window.parent.postMessage(…, hostPostTarget) } catch { /* parent gone */ }` appears about 20 times.** The policy is inconsistent: toolbar, status-bar, host requests and fetch wait for document `load` (`postAfterDocumentLoad`, `:745`). `setModified`/`setMuted` (`:2042`, `:2047`), `onSaveRequest` (`:2090`) and the save replies (`:1509`, `:1519`) post immediately and without a try/catch.

  Feature-specific protocol also leaks into generic code. The generic capability proxy special-cases one capability's release handshake: `if (id !== "audio" || method !== "muteApp") return channel;` followed by a `release`/`released` mini-protocol (`:1139-1152`). The two pieces that were extracted (`board-context-menu.ts`, `board-console-mirror.ts`) show the right shape, but the context menu re-implements `requestOpenRawLink` (`board-context-menu.ts:13-17` vs `board-shim.ts:1380-1384`), and the console mirror posts untyped `{ __persephone: "board:error" }` literals (`board-console-mirror.ts:7`, `:35`).
- **Refactor:** Make `src/board-shim/` a folder of browser-only modules, with `board-shim.ts` as a thin composition root that builds `window.persephone`:
  1. `primitives.ts`:
     - `SettledValue<T>` with `settle(v)`, `get(): Promise<T>`, `peek()`, `isSettled`.
     - `Listeners<T>` with `add(cb): () => void`, `emit(v, label)` (try/catch + logging in one place), and an option for "replay current value on add" (used by `onThemeChange`, `onVisibilityChange` and `onAutoStopSilenceChange`).
  2. `host-frame-channel.ts`, class `HostFrameChannel` (see BND-2). It owns `hostPostTarget`, the single `message` listener with the source/origin gate, the post-after-load policy, `request()` / `notify()`, and handler registration by message type.
  3. `main-port-channel.ts`, class `MainPortChannel`. It owns queue-then-flush, `rpc()` (typed per BND-3), `call()`, `fire()`, the routing tables for runner, watch and theme pushes, and `replace()` (the current `attachPort` teardown, `:1449-1478`).
  4. One feature module per public namespace, each exporting `createXApi(deps)` in the `installBoardContextMenu({ fire, rpc, hostText })` style: `page-api` (visibility, mute, modified, save/discard), `source-api` (initial source + `onOpen` queue), `host-content-api`, `shared-state-api`, `toolbar-api`, `status-bar-api`, `files-api` (read/write/list/watch/remember/trash/ts-project), `service-api` (service, services, channels via the shared channel from BND-4), `capability-api` (intent, invoke, `getCapability`; the audio `muteApp` release wrapper moves into a per-capability client adapter table), `fetch-api`, `ai-vision-api`, `themes-api`, `i18n` (BND-12), `dialogs` (sync XHR), `frame-behaviours` (Ctrl+S, theme keys, link routing, overlay ping).
  5. Do this after or alongside BND-2 and BND-3. Those two channels are what the feature modules depend on.
- **Risk / notes:** The public `window.persephone` surface must stay byte-identical. Diff `Object.keys` recursively before and after. The build already bundles imports into the IIFE (`scripts/build-prod.mjs:121-140`), so splitting files costs nothing at runtime. The ordering guarantees matter: listeners must be installed before author code runs, and early `source:opened` events must be buffered. Encode them in the composition root rather than in file order.

### BND-2: The board↔host-renderer frame protocol is ~40 hand-paired message types with no direction typing
- **Priority:** P1
- **Effort:** M
- **Where:** `src/ipc/board-bridge-channels.ts:494-869`, `src/board-shim.ts:609-643`, `:766-800`, `:810-1108`, `:1496-1882`, `src/renderer/editors/board/BoardWebview.ts:116-140`, `:234+`, `:988-1055`
- **Problem:** Each feature invented its own request and result message names, and the pairing rule is not consistent:
  - `board:filePath`→`filePath:result`, `board:var`→`var:result`, `board:settings`→`settings:result`
  - `board:pageState:get`→`pageState:get:result`, `board:source:navigate`→`source:navigate:result`
  - `navigation:createReturnUrl`→`navigation:returnUrl`, `board:capabilities:invoke`→`capabilities:invoke:result`
  - Host-initiated: `ai:request`→`board:aiResult`, `board:saveRequest`→`board:saveResult`. The `board:` prefix normally means board→host, but `board:saveRequest` and `board:saveHandlerSync` go host→board.

  Some messages carry a nested mini-RPC: `varMethod` + `varArgs: unknown[]` (`:542-547`) and `settingsMethod: "get"` + `settingsArgs` (`:548-553`). Others are one message type per verb (`pageState:get|set|remove`, `:596-603`). There is no host→board union. `BoardHostFrameMsg` (`:830-869`) mixes both directions and lists `BoardToolbarSetMsg`/`BoardToolbarUpdateMsg` twice (`:832-833`, already inside `BoardToHostMsg`).

  The consequences show up on both ends:
  - **Consumers bypass the declared types.** The shim casts `event.data as X | undefined` in each of its 18 listeners. The handshake listener re-declares the `BoardPortInitMsg` shape inline (`board-shim.ts:1539-1550` vs `board-bridge-channels.ts:335-373`). The `service:channelPort`, `page:visibility` and voice-typing listeners use inline shapes instead of their declared types (`:1261`, `:1746`, `:1647`).
  - **Every request needs hand-written code on both sides.** The shim needs `expectedReplyType` plus a `decode` cast (`:812-817`, `:850-856`, …). The renderer needs a `resolveX` try/catch that builds the right result discriminator (`BoardWebview.ts:1009-1055`).
  - **Comments in the contract file are wrong or misplaced.** `BoardAiVisionNotifyMsg` is documented as "Host renderer → board iframe" (`:750`), but the shim sends it board→host (`board-shim.ts:1333-1336`). A stray doc comment for `BoardToHostMsg` sits above `BoardToolbarTextMsg` (`:502-503`).
  - **The file holds four unrelated contracts:** boot context, port RPC, frame protocol, and the toolbar and status-bar descriptor catalogs. Its header still describes only the port protocol (`:1-19`).
- **Refactor:**
  1. Split `board-bridge-channels.ts` into `src/ipc/board-bridge/`:
     - `boot.ts`: `BoardBootContext`, palette, i18n context and host text.
     - `port-protocol.ts`: `BoardToMain`/`MainToBoard` plus the BND-3 method map.
     - `frame-protocol.ts`: the new envelopes and method maps.
     - `ui-catalog.ts`: toolbar and status-bar descriptors and patches.
     - `origin-routes.ts`: builders and parsers for the reserved board-origin paths `/__persephone/dialog`, `/__pipe/<pageId>` and `/__pipe/resource/<id>`. These are currently string literals in `board-shim.ts:113`, `:2604`, `main/board-protocol-service.ts:264`, `:294-306` and `BoardWebview.ts:1564`. The dialog XHR payload is also typed nowhere today.
  2. Replace the ad-hoc pairs with three envelopes:
     - `{ __persephone: "req", id, method, params }`
     - `{ __persephone: "res", id, ok: true, value } | { …, ok: false, error: { code?, message } }`
     - `{ __persephone: "evt", name, payload }`

     Add two method maps: `BoardToHostRequests` (`filePath`, `fileIcons`, `contentOpen`, `openContent`, `var.get`/`set`/`list`/`show`, `settings.get`, `pageState.get`/`set`/`remove`, `source.navigate`, `navigation.createReturnUrl`, `capabilities.invoke`) and `HostToBoardRequests` (`save`, `aiVision`, `capabilities.intent`). Add two event maps, one per direction, for fire-and-forget messages.
  3. `HostFrameChannel` (shim side) and a matching `BoardFrameEndpoint` (renderer side) implement `request<M>(method, params): Promise<Result<M>>`, `handle<M>(method, fn)` and `on<E>(name, fn)` once. Gates such as `mainTrusted` stay declarative in the renderer handler table, which already exists (`BoardWebview.ts:131-140`, `:234+`).
  4. Delete the per-request result interfaces and the `resolveX` methods.
- **Risk / notes:** Both ends ship together, so there is no compatibility concern. Keep the `event.source` / origin gates exactly as they are (`board-shim.ts:1488-1494`, `BoardWebview.ts:991-992`). Streaming `fetch` (head, chunk pull, abort) fits as one request plus `evt` pushes keyed by request id. Do this before BND-1, which builds on it.

### BND-3: Board↔main port RPC is positional `args: unknown[]`, and permission policy is keyed on method-name strings
- **Priority:** P2
- **Effort:** M
- **Where:** `src/ipc/board-bridge-channels.ts:204-242`, `:316-330`; `src/board-shim.ts:1115-1127`, `:2296-2485`; `src/main/board-bridge.ts:531`, `:675-1028`
- **Problem:** `BoardRpcMethod` is a string union and every message is `{ kind: "rpc", id, method, args: unknown[] }`. The shim casts each result (`rpc("storageGet", [key]) as Promise<BoardJsonValue | undefined>`, `:2339`, repeated for about 30 methods). Main's table is `Record<BoardRpcMethod, (entry, args: unknown[]) => unknown>` (`board-bridge.ts:531`, `:675`), and each handler indexes `args[0]`/`args[1]` positionally. A typed contract was started and abandoned: `BoardCapabilityRpc` (`board-bridge-channels.ts:236-242`) is referenced nowhere.

  Authorization is spread across `runRpc` string tests: `method === "servicesList" || …`, `method.startsWith("capability")` (`board-bridge.ts:1018-1028`). Inside individual handlers there are repeated `getGrantedPermissions` + `requireDialogPermission` preludes (`:751-753`, `:759-761`, `:767-769`, `:893-894`, …). Whether a method is gated, and by which flag, can't be seen in the table.

  The port also carries two parallel correlators: `rpc`/`rpc-result` and `call`/`call-result`, with separate id counters (`board-shim.ts:506-512`).
- **Refactor:**
  1. Declare `BoardPortMethods = { storageGet: { params: [key: string]; result: BoardJsonValue | undefined }; … }` in `port-protocol.ts` (generalizing the dead `BoardCapabilityRpc`).
  2. On the shim side: `rpc<M extends keyof BoardPortMethods>(m: M, ...p: Params<M>): Promise<Result<M>>`.
  3. On the main side: `boardRpcHandlers` becomes `{ [M in keyof BoardPortMethods]: { permission?: BoardPermissionRequirement; liveFrameOnly?: true; handle(entry, ...p: Params<M>): Result<M> | Promise<Result<M>> } }`, and `runRpc` enforces `permission` / `liveFrameOnly` generically. Handlers still validate `params` at runtime (the board is untrusted), but the types now document the contract on both sides.
  4. Fold `call` into the same correlator as method `call`.
- **Risk / notes:** This is internal wire only. `main/board-bridge.ts` belongs to the src/main reviewer; coordinate.

### BND-4: The windowed-ack service-channel protocol is implemented 6 times, with drift
- **Priority:** P1
- **Effort:** M
- **Where:** `src/board-shim.ts:1158-1243`, `assets/module-service-host.mjs:853-922`, `src/main/capability-channel.ts:7-63`, `src/renderer/api/renderer-capability-channel.ts:5-55`, `src/renderer/ui/speech/SpeechServiceChannel.ts:17-85`, `src/renderer/ui/translation/TranslationServiceChannel.ts`
- **Problem:** The same `{kind:"data",sequence,value}` / `{kind:"ack",sequence}` / `{kind:"close",reason}` protocol, plus the in-flight window, `whenWritable` and close fan-out, is written out six times. The port-level message shape is declared in no contract file. `module-service-channels.ts` only covers `channel-open`/`channel-close` between main and the host. The copies have diverged:
  - **Size check:** none (shim); `v8.serialize` against 1 MiB with code `channel-message-too-large` (host `:882-884`); `v8.serialize` with code `payload-too-large` (`renderer-capability-channel.ts:38-39`, `main/capability-channel.ts:46-47`); only `message.data instanceof ArrayBuffer` (speech); `JSON.stringify` + `TextEncoder` (translation).
  - **Ack policy:** batched with a 10 ms tail (shim, host, speech, translation) vs an ack per message (`renderer-capability-channel.ts:27`, `main/capability-channel.ts:35`).
  - **Non-cloneable error code:** `service-error` (shim, host) vs `rejected` (renderer and main capability channels).
  - **Early messages:** only the translation copy buffers messages that arrive before `onMessage` is registered.
  - **The interface is declared 4 times:** `BoardServiceChannel` (`board-shim.ts:1158`), `SpeechServiceChannel`, `CapabilityChannel` (`renderer/api/types/capabilities`), and the translation copy.
- **Refactor:** Add `src/shared/service-channel.ts`, modeled on `shared/execute-handle.ts`. Make it transport-agnostic and dependency-free so the IIFE shim can bundle it:
  - `ServiceChannelWire` (the three message kinds) and `ServiceChannel` (the public interface).
  - `createServiceChannel(port: ChannelPortAdapter, options: { ackPolicy: "batched" | "each"; measureBytes?: (v) => number; maxMessageBytes?; bufferUntilListener?: boolean; disconnectReason; onEnd? })`.
  - Adapters `domPort(MessagePort)` and `electronPort(MessagePortMain)`. Node callers inject `v8.serialize` as `measureBytes`. The browser shim either passes none or a `structuredClone`-based estimate.
  - Replace all six copies. Pick one canonical error code per failure and document it in the capabilities guide.
- **Risk / notes:** Behavior changes are deliberate (one size rule, one ack policy). Live-test voice typing, translation, and a board `services.connect` round trip. The host copy can't import the shared module until BND-6 lands. Until then, keep it but mark it "mirror of shared/service-channel.ts".

### BND-5: Board grant semantics are re-derived at ~15 call sites, and the renderer copy already disagrees with main
- **Priority:** P1
- **Effort:** M
- **Where:** `src/shared/board-manifest-utils.ts:111-141` (the shared rule); `src/main/board-trust-service.ts:338`, `:481`; `src/renderer/api/board-trust.ts:144`; `src/ipc/main/board-handlers.ts:142`, `:203`; `src/main/board-file-access.ts:90`; `src/main/board-bridge.ts:455`; `src/main/session-src-protocol.ts:228`, `:244`; `src/main/permission-policy-service.ts:356`; `src/renderer/editors/board/board-fetch.ts:46-47`; `src/renderer/editors/board/BoardWebview.ts:1519-1520`, `:1739`; plus about 15 UI and facade sites (`grep 'kind === "legacy"'` finds 36)
- **Problem:** `NormalizedBoardPermissions` is a bare union (`{kind:"flags"; flags} | {kind:"legacy"; service}`), so every consumer re-implements the legacy-vs-flags mapping:
  - `boardPermissionAllows()` exists (`board-manifest-utils.ts:138-141`), but `main/board-trust-service.ts:338` copies it inline, and `renderer/api/board-trust.ts:144` copies it without the `computerAudio` exclusion. Today the renderer's `boardTrust.allows(root, "computerAudio")` returns `true` for a legacy board while main returns `false`.
  - "Effective file-system mode" is derived identically in `board-file-access.ts:90` and `board-handlers.ts:203`.
  - "Effective network / appScripting" is copied verbatim in `board-fetch.ts:46-47` and `BoardWebview.ts:1519-1520` (and `session-src-protocol.ts:228`, `:244`).
  - `canStartService` is copied in `board-handlers.ts:142` and `board-trust-service.ts:481`.
- **Refactor:** Put a small value API in `shared/board-permissions.ts`, moved out of `board-manifest-utils.ts`, which also holds service-interface and URL-mask normalization:
  - `class BoardGrant` (or pure functions over the union): `allows(flag)`, `fileSystemMode(): false | "board" | "full"`, `networkMode()`, `canRunService()`, `isUnrestricted()`, `diff(proposed)` (the latter currently in `renderer/api/board-trust.ts:60` and `board-permission-copy.ts`).
  - Replace every inline `kind === "legacy"` branch with these.
  - Keep the snapshot wire type as-is, and have the IPC mapping in `board-handlers.ts:135-148` call the shared helpers (better: let `boardTrustService` return the wire snapshot itself).
- **Risk / notes:** The `computerAudio` divergence changes renderer behavior for legacy boards. Check the intended rule with the owner (main's rule is presumably the intended one). This is a cross-area finding (src/main and the renderer board editors) whose root is in `src/shared`.

### BND-6: The module-service host is a 1.25k-line untyped `.mjs` that copies the TS contract by hand
- **Priority:** P2
- **Effort:** M
- **Where:** `assets/module-service-host.mjs` (whole file); `src/ipc/module-service-channels.ts:13-23`, `:67-77`, `:195-200`; `src/shared/capability-client.ts:6-13`; `src/main/module-service-supervisor.ts:1146`
- **Problem:** The contract file says the host "cannot import TypeScript" (`module-service-channels.ts:196`). As a result:
  - **Constants are partly copied and partly passed in.** Some arrive in the `init` `ServiceHostConfig` (`:67-77`); `SERVICE_CHANNEL_ACK_DELAY_MS` is hand-mirrored (`host:13`).
  - **The capability error-code list is copied** (`host:815`).
  - **The capability proxy builder is copied with a "keep in parity" note and has already drifted.** The shared version skips `then` and `provider` (`capability-client.ts:9`); the host skips only `then` (`host:311`).
  - **Three request clients are copy-pasted** (`storageRequest`, `mcpEndpointRequest`, `boardSettingsRequest`, `host:91-153`), and they reject differently. Storage timeouts are `new Error("service-timeout")` with no `code` (`:100`); the others use `{ code: "service-timeout" }` (`:122`, `:143`). Exit errors also have no code only in storage (`:108` vs `:129`, `:150`).
  - **The response branches are copy-pasted** too (`host:1092-1147`).

  The file also combines six jobs: lifecycle handshake, the raw-protocol compatibility layer that monkey-patches `parentPort.on/once/off` (`:975-1062`), main request clients, renderer leases with the provider protocol and status throttling (`:208-750`), capability handler dispatch and capability client (`:307-348`, `:792-824`), and the service channel (`:853-933`). The node-script host has a similar small duplication: `--persephone-node-script` and `{kind:"stdin"|"end-stdin"}` are literals in both `assets/node-script-host.mjs:9`, `:27-28` and `src/main/command-runner.ts:298`, `:310-322`.
- **Refactor:**
  1. Move the source to `src/module-service-host/*.ts` and build it with the existing pipeline, the same way as `board-shim` and `site-extension-runtime` (`scripts/build-prod.mjs:121-160`, `scripts/dev.mjs:96-110`), but as ESM output to `.vite/build/module-service-host.mjs`. Point `module-service-supervisor.ts:1146` at the built file.
  2. Split it into: `lifecycle.ts` (init/probe/ready/shutdown), `raw-protocol-compat.ts` (isolated, with a removal date; no bundled board uses the raw protocol), `main-requests.ts` (one `PendingRequests` client typed by `ServiceMainMessage`/`ServiceParentMessage`, replacing the three copies), `renderer-lease.ts` plus `provider-dispatch.ts`, `capabilities.ts` (import `createCapabilityProxy` and the error codes from shared), and the channel from BND-4.
  3. Import every constant directly and drop the redundant config fields, keeping only true runtime values.
  4. Apply the same treatment to `node-script-host.mjs`, with a tiny shared `node-script-host-protocol.ts`.
- **Risk / notes:** Packaging: the host must be resolvable as a utility-process entry. Check `getAssetPath` vs the build output path in the packaged layout. Do this before or together with BND-4 so the host can use the shared channel.

### BND-7: Main↔renderer IPC takes 5 hand edits per endpoint; event payloads are unchecked on send and declared 2–3 times
- **Priority:** P2
- **Effort:** M
- **Where:** `src/ipc/api-types.ts:51-225` (`Endpoint` enum, values equal to keys), `:303-508` (`Api`), `:519-635` (`EventEndpoint`/`EventApi`); `src/ipc/renderer/api.ts:55-763`; `src/ipc/main/core-handlers.ts:92`; `src/ipc/main/board-handlers.ts:15-55`; `src/ipc/main/git-handlers.ts:5-25`; `src/ipc/renderer/renderer-events.ts:51-195`; `src/main/open-windows.ts:65`; `src/main/open-window.ts:360`; `src/preload.ts:16-36`; `src/renderer/types/window.d.ts:16`
- **Problem:**
  - **Adding one endpoint takes 5 edits.** Each needs the `Endpoint` enum member, the `Api` signature, the `ApiCalls` method (about 700 lines of `x = async (a) => executeOnce<T>(Endpoint.x, a)`), the main handler, and its domain's `XEndpoint` exclusion union. Completeness is checked only for the core `Controller` (`implements Omit<MainApi, BoardEndpoint | GitEndpoint | …>`). An endpoint listed in `BoardEndpoint` but never bound compiles fine, and the renderer call then hangs forever because `executeOnce` has no timeout (`api.ts:55-79`).
  - **Event payloads are unchecked on send and declared up to three times.** Main sends events as `send(eventName: EventEndpoint, data: unknown)` (`open-windows.ts:65`). The renderer re-declares every payload in `renderer-events.ts`, which has already drifted: the `eBoardNotify` payload there lacks `persistent` (`renderer-events.ts:161-164` vs `api-types.ts:617-622`). The handler declares it a third time (`renderer/api/internal/RendererEventsService.ts:167`). `eBoardPort`, `eModuleServicePort`, `eBoardServiceChannel` and `eCapabilityOpen*` live in `EventEndpoint` but not in `EventApi`, because they carry ports or are request/reply.
  - **The preload facade's channel union is effectively `any`.** It is declared twice (`preload.ts:16-36`, `window.d.ts:15-31`). The `.d.ts` copy references `PreloadEvent`, which was renamed to `RendererEvent` in January 2026. Because `skipLibCheck: true` (`tsconfig.json:6`), the dangling name silently becomes `any`, so the whole union is `any`.
  - **There are at least six different channel-definition styles:** the `Endpoint`/`EventEndpoint` enums; string `enum`s (`RunnerChannel`, `WorkerChannel`); `as const` objects with arguments documented only in comments (`BrowserChannel`, `TorChannel`, `SearchChannel`, `BrowserNetworkChannel`, `BoardServiceSettingsChannel`, `BoardDialogChannel`); loose `const` strings (`board-pipe-channels.ts`, `audio-channels.ts`, `global-mute-channels.ts`); `MCP_EXECUTE`/`MCP_RESULT` in `shared/constants.ts`; and private literals duplicated between processes (BND-13).
- **Refactor:**
  1. Split `Api`/`EventApi` into domain contract modules: `ipc/contracts/{window,files,downloads,capabilities,boards,module-services,voice-typing,clipboard,git,site-extensions,path-watch,…}.ts`, each exporting `XApi` and `XEvents`. `Api = WindowApi & BoardApi & …`. Drop the `Endpoint` enum; the channel name is the key.
  2. Main side: `bindDomain<XApi>(handlers: MainHandlers<XApi>)` takes an object literal, so the compiler enforces per-domain completeness. Delete the `XEndpoint` unions and the `Omit<>`.
  3. Renderer side: generate the client, e.g. `export const api = createApiClient<Api>()` (a `Proxy` over `executeOnce`), replacing the 700-line `ApiCalls`. Add a default timeout.
  4. Make event sending typed: `send<K extends keyof EventApi>(k: K, data: EventPayload<K>)` in `open-window(s).ts`. Generate `renderer-events.ts` from the same map.
  5. Define the preload facade's channel union once (export a type from `preload.ts` and use it in `window.d.ts`). Remove `PreloadEvent`.
  6. Later, convert the remaining `as const` families to the same "contract map + generic binder" shape (their `ipcRenderer.invoke`/`guardedIpcHandle` transport is fine).
- **Risk / notes:** This is mechanical but touches every `api.x` caller only if names change, so keep the names. Steps 1–5 can land domain by domain.

### BND-8: `ipc/main/core-handlers.ts` holds real business logic, and `ipc/main` hosts services that `src/main` imports
- **Priority:** P2
- **Effort:** M
- **Where:**
  - `core-handlers.ts`: `:75-90`, `:92-791` (the `Controller` class), `:196-252` (`createBoardShortcut`), `:288-372` (`moveToDisplay`), `:93-156`, `:479-521`
  - `src/ipc/main/board-handlers.ts:11`, `:135-148`, `:148-175`, `:176-183`
  - `src/main/board-bridge.ts:60`, `:92`, `:950-972`; `src/main/main-setup.ts:8`
  - `src/ipc/main/window-handlers.ts:6-35`; `src/ipc/main/dialog-handlers.ts`; `src/ipc/main/registry-handler.ts`
- **Problem:** The composition root says "service registrars own their endpoint implementations" (`controller.ts:9`), and git, board and site-extension handlers are indeed thin. `core-handlers.ts` is not:
  - **Real logic lives in the controller:**
    - About 60 lines of board-shortcut validation, write and read-back verification (`:196-252`). `main/board-window-identity.ts` already owns the other shortcut helpers.
    - About 85 lines of multi-display move and DPI logic (`:288-372`).
    - Full capability-invoke orchestration (`:110-141`).
  - **Sender checks are duplicated by hand**, even though `bindEndpoint` already applies `guardIpcSender` (`endpoint-registry.ts:20-24`, `main/ipc-sender-guard.ts:11-16`). The extra checks come in three variants: `checkCapabilitySender` (`:78-82`), an inline copy with a different message (`:148`, `:153`), and `senderFrame !== mainFrame` (`:480`, `:489`, `:498`, …).
  - **Capability requests are handled three times.** Validation (`requestId` length, method and args) appears in `core-handlers.ts:112`, `board-handlers.ts:155` and `main/board-bridge.ts:950`. The active-request map is an exported mutable `WeakMap` (`core-handlers.ts:76`) that `board-handlers.ts:156-158` mutates.
  - **`connectHostServiceChannel` is overloaded.** It returns either a channel id or `JSON.stringify(CapabilityClientResult)` depending on the request variant (`board-handlers.ts:148-173`), so the renderer has to `JSON.parse` the result (`renderer/api/capabilities.ts:204`).
  - **Domains are split arbitrarily.** Voice-typing endpoints are split between core and board handlers (`core-handlers.ts:479-521` vs `board-handlers.ts:176-183`).
  - **The layering is inverted.** `src/main/board-bridge.ts` imports `capabilityResult` from `ipc/main/core-handlers` (`:92`) and dialogs from `ipc/main/dialog-handlers` (`:60`). `main-setup.ts:8` imports startup-input state that `window-handlers.ts` parses from `process.argv` at module load.
  - **There is dead code.** `src/ipc/main/registry-handler.ts` (120 lines, a Windows `.reg` writer) is imported nowhere.
- **Refactor:**
  1. Move the logic into services:
     - `main/window-display-service.ts`: `getDisplays`, `moveToDisplay`, `setFullScreen`.
     - `main/board-window-identity.ts`: gains `createBoardShortcut`.
     - `main/capability-ipc.ts`: one `validateClientInvoke(request)`, one `ActiveCapabilityRequests` class keyed by `WebContents`, and `capabilityResult`. Used by core, board-handler and board-bridge callers.
     - `main/launch-inputs.ts`: the startup-input state.
     - `main/dialog-service.ts`: the three dialog functions.
  2. Split the `Controller` into domain registrars (`window-`, `capability-`, `voice-typing-`, `clipboard-`, `downloads-`, `mcp-mneme-`, `recording-` handlers), each a thin `bindDomain` call (BND-7).
  3. Split `connectHostServiceChannel` into `connectHostServiceChannel(selector): string` and `connectCapabilityChannel(request): CapabilityClientResult<string>`.
  4. Replace the ad-hoc sender checks with one optional `requireOpenWindow` guard option on the binder.
  5. Delete `registry-handler.ts`.
- **Risk / notes:** Keep the lazy `import()`s that keep startup light. `src/main` belongs to another reviewer, but the inversion starts here.

### BND-9: Request/reply correlation is re-implemented per channel family, with 7 different error envelopes
- **Priority:** P2
- **Effort:** L (incremental)
- **Where:**
  - `src/ipc/renderer/api.ts:55-79`
  - `src/main/mcp/renderer-bridge.ts:35-80` with `src/renderer/api/mcp/command-registry.ts:13-37`
  - `src/main/board-bridge.ts:718`, `:744`, `:906`, `:916`, `:1042`
  - `src/ipc/board-service-settings-channels.ts`; `src/ipc/board-pipe-channels.ts`; `src/ipc/audio-channels.ts:1-2`
  - `src/main/capability-router.ts:82`, `:418`
  - `src/board-shim.ts:506-512`, `:637-644`, `:668`
  - `assets/module-service-host.mjs:15-17`, `:215-217`
- **Problem:** At least 10 independent "pending map + id + timeout + settle" implementations exist:
  - Endpoint `${cmd}_${id}` replies
  - the MCP command channel
  - board-settings get/getReply
  - board-pipe read/reply
  - audio devices request/reply
  - capability open/openResult
  - the shim's `rpc`, `call` and `hostRequest`
  - the host's storage, MCP and settings clients

  Their error envelopes differ: an `Error` instance; `{ error: { code: -32603, message } }` (JSON-RPC numbers); `{ ok, error: { code, message } }`; `{ ok: false, status: 503, error: string }`; `{ error: string }`; `{ error?: string; code?: string }`; and a JSON string (BND-8).

  Separately, the MCP command transport (`MCP_EXECUTE`/`MCP_RESULT`, JSON-RPC error codes, an `mcp_`-prefixed request id) has been repurposed as the generic main→renderer RPC for the board bridge (`board_openRawLink`, `board_openBoard`, `board_*TsProject`, `board_call`). Main calls it with free-form `method: string` (`renderer-bridge.ts:35`). The method union exists only in the renderer (`command-registry.ts:13-21`). A comment at `renderer-bridge.ts:36-38` records a bug that came from this coupling: board replies were dropped when the MCP server had not started.
- **Refactor:**
  1. Add `shared/pending-requests.ts`: a `PendingRequests<TResult>` class with `create(timeoutMs?, signal?) → { id, promise }`, `settle(id, result)`, `fail(id, error)` and `failAll(error)`.
  2. Add one canonical error shape, `{ code: string; message: string }`, with `toWireError` / `fromWireError` helpers. `shared/utils` is the natural home next to `errMessage`.
  3. Add `ipc/renderer-requests.ts`, a typed main→renderer RPC (`RendererRequestMethods` map, `requestRenderer<M>(webContents, method, params)`), separate from MCP. Move `board_*` there and make MCP `call` one client of it.
  4. Migrate board-settings, board-pipe and audio-device requests onto it as they are touched.
- **Risk / notes:** BND-2, BND-3 and BND-6 each consume `PendingRequests`. Do it first as a small enabling change.

### BND-10: Capability contract constants are duplicated; one type name covers two different error-code sets
- **Priority:** P2
- **Effort:** S
- **Where:** `src/shared/capability-contract.ts:6`, `:15-23`, `:72-75`; `src/ipc/capability-bus-channels.ts:6-17`, `:72-76`; `src/ipc/main/core-handlers.ts:75`; `src/main/capability-router.ts:46`; `src/main/module-service-supervisor.ts:742`; `src/renderer/audio/audio-window.ts:481`; `assets/module-service-host.mjs:815`; `src/shared/board-manifest-utils.ts:6`, `:16`; `src/board-shim.ts:1057-1065`, `:1139`
- **Problem:**
  - **Two error-code sets share one type name.** `CapabilityErrorCode` in `shared/capability-contract.ts:6` has 13 codes. `CapabilityErrorCode` in `ipc/capability-bus-channels.ts:6-11` has 10 codes and lacks `permission-denied`, `channel-backpressure` and `channel-closed`. The 13-code list is re-typed as a literal array in six places. The board shim validates frame-route replies with the 10-code `isCapabilityErrorCode` (`board-shim.ts:1058`). Any of the three extra codes arriving on that route is therefore collapsed to `rejected`, while the port route (`board-shim.ts:1123-1126`) passes codes through unfiltered. The same board API reports errors differently depending on the transport.
  - **The reserved platform ids are listed twice.** `PLATFORM_SERVICE_INTERFACE_IDS` is in `board-manifest-utils.ts:6`, and the `reservedIds` and `legacyOpenTypes` keys are in `capability-contract.ts:15-23`. `"audio"` is special-cased separately in `board-manifest-utils.ts:16`, `capability-contract.ts:72` and the shim's `muteApp` wrapper (`board-shim.ts:1139`).
  - **There are dead contract types.** `IntentSettlement` (`capability-bus-channels.ts:72-76`) has no users. `CapabilityTransport` (`:78-86`) is a renderer-internal interface (used only by `renderer/api/capability-bus.ts` and `board-capability-transport.ts`) placed in the IPC contract.
- **Refactor:**
  1. In `shared/capability-contract.ts`, export `CAPABILITY_ERROR_CODES` (all 13) as the single `as const` array, plus `isCapabilityErrorCode` and `toCapabilityError(error)` (the "recognized code or `rejected`" rule now written 4 times).
  2. If the legacy open-intent path really needs the 10-code subset, define it as a named subset (`LEGACY_INTENT_ERROR_CODES`) with a comment explaining why.
  3. Export `PLATFORM_CAPABILITY_IDS` once (including `audio`) and derive `PLATFORM_SERVICE_INTERFACE_IDS` and `reservedIds` from it.
  4. Delete `IntentSettlement` and move `CapabilityTransport` to `renderer/api/`.
- **Risk / notes:** Unifying the shim mapping can change the `code` a board sees on the frame route, which is a correctness improvement. Note it in the bridge history (BND-11).

### BND-11: Bridge version history is prose in 6+ places and has drifted; the published contract exists in two copies
- **Priority:** P2
- **Effort:** S
- **Where:** `src/shared/board-bridge-version.ts:2` (`"1.54.0"`); `src/board-shim.ts:2002-2029`; `assets/guides/agents/boards.md:14`; `doc/architecture/overview.md:535-538`; `doc/architecture/key-files.md:637`; `assets/board-template/CLAUDE.md` vs `assets/guides/agents/boards.md`; `src/shared/version-utils.ts:14`, `:55`
- **Problem:**
  - **Stated versions disagree.** The constant is 1.54.0. The published agent guide says "The board bridge is version **1.49.0** in this build" (`boards.md:14`). The overview describes "board bridge **1.49.0**" (`overview.md:535`), and key-files stops at 1.53.0 (`:637`).
  - **The shim's changelog comment is out of date and out of order.** It is out of order (1.18 → 1.26 → 1.27 → 1.39 → 1.28 → 1.37 → 1.36 → 1.35 → 1.34) and stops at 1.39 (`board-shim.ts:2002-2029`).
  - **Feature gates are inconsistent.** One milestone is a constant (`OBJECT_PERMISSION_BRIDGE_VERSION`, `version-utils.ts:55`); the rest exist only in prose.
  - **The published contract exists in two copies that have diverged.** `assets/board-template/CLAUDE.md` (1886 lines, copied into every new board) and `assets/guides/agents/boards.md` (1925 lines) are near-copies, and the template already lags (it tops out at 1.48.0).
  - **`compareVersions(current, latest)` returns 1 when the *second* argument is larger** (`version-utils.ts:14`). Call sites read inverted (`compareVersions(appVersion, minAppVersion) > 0` means "incompatible").
  - **The bump is routinely missed.** The owner has noted this for delegated plans.
- **Refactor:**
  1. Turn `board-bridge-version.ts` into a data table, `BOARD_BRIDGE_HISTORY: readonly { version: string; adds: string; ref?: string }[]`, and set `BOARD_BRIDGE_VERSION = BOARD_BRIDGE_HISTORY.at(-1).version`. Move `OBJECT_PERMISSION_BRIDGE_VERSION` into it as a named feature.
  2. Delete the shim's comment changelog.
  3. Docs and guides should say "check `persephone.version`" and link to a generated "Bridge history" section. A small script that renders the table into the guides is fine; it is not a test. Remove "this build is X" sentences.
  4. Make the board template's `CLAUDE.md` a short stub that points at `guides/agents/boards.md` (readable in-app and via MCP), or generate it from the guide at build time.
  5. Rename `compareVersions` to `compareVersions(a, b)` returning `sign(a - b)`, or add `isAtLeast(version, minimum)`, and update the 3–4 callers.
- **Risk / notes:** The template change affects agents that read a board folder offline. Decide whether a stub is enough. `boards.md:1094-1095` recommends `persephone.version >= "1.46.0"`, a lexicographic comparison that will misorder at 1.100 or 2.x vs 10.x. Fix the guidance while touching it.

### BND-12: The shim duplicates the i18n formatter and the English host-text catalog
- **Priority:** P3
- **Effort:** S
- **Where:** `src/board-shim.ts:224-279`; `src/shared/i18n/t.ts:15-31`; `src/shared/i18n/en/board.ts`; `src/ipc/board-bridge-channels.ts:70-88`; `src/renderer/editors/board/BoardWebview.ts:581-599`
- **Problem:**
  - **The formatter is copied.** `translateBoardMessage` re-implements plural selection and `{name}` substitution with the same regex as `formatMessage` in `shared/i18n/t.ts`.
  - **The host-text keys are kept in four places that must agree by hand.** `ENGLISH_BOARD_HOST_TEXT` hard-codes the 16 English strings that already live in `shared/i18n/en/board.ts`. `BoardHostTextId` re-lists the same keys as a union, and `BoardWebview` builds the object field by field.
- **Refactor:**
  - Export a pure `formatPackMessage(message, fallback, params, pluralRules)` from `shared/i18n/` and use it in both `t()` and the shim.
  - Derive `BoardHostTextId` from `keyof typeof englishCatalog.board` (or a dedicated `boardHost` sub-catalog). Have the shim import that catalog as its fallback; it is plain data and safe to bundle. Have `BoardWebview` map over the keys.
- **Risk / notes:** None. This fits naturally as the `i18n.ts` module in BND-1.

### BND-13: Smaller contract leaks and misplaced modules
- **Priority:** P3
- **Effort:** S
- **Where / Problem:**
  - **Audio channel names are duplicated as literals in both processes.** `persephone:audio-control`, `-arm-capture`, `-clear-capture`, `-open-channel` and `-close-channel` appear in `src/main/audio-service.ts:18-22` and `src/renderer/audio/audio-window.ts:13-17`, even though `src/ipc/audio-channels.ts` exists for this purpose. The control payload (`{type:"ready"|"channel-ready"|"channel-closed"|"capture-count"}`) is untyped (`audio-service.ts:134-157`).
  - **The site-extension runtime signals are untyped JSON strings.** `{type:"actions-published"|"fetch-request"|"fetch-cancel"}` (`src/site-extension-runtime.ts:32`, `:57`, `:100`) are re-parsed with casts in `renderer/editors/browser/BrowserWebviewModel.ts:1045-1059`. The runtime also hand-rolls error stringification (`site-extension-runtime.ts:74`) instead of using `errMessage`.
  - **Runtime logic sits in the contract folder.** `src/ipc/popup-rate-limiter.ts` is a class plus a process-wide singleton, not a contract; it belongs in `shared/`.
  - **A general path helper lives in the wrong module.** `normalizeBoardRelativePath` lives in `shared/guides/mounted-source.ts`, but board-manifest and board-pack validation import it (`board-manifest-utils.ts:1`, `i18n/board-pack.ts:1`). Move it to `shared/board-paths.ts`.
  - **The contract derives types from implementations.** `api-types.ts:375`, `:631` and `renderer-events.ts:181` derive a wire type from `typeof import("../main/capability-registry").capabilityRegistry.snapshot`, and `api-types.ts:34` imports renderer API types. Declare `CapabilityIndexSnapshot` in the contract and have the registry return it.
  - **Stale comments:**
    - `runner-channels.ts:12-14` still cites "a sandboxed board preload (US-724)". That preload was removed in EPIC-037.
    - `key-files.md:554` still mentions the "React `showAppPopupMenu`". React has been removed.
- **Refactor:** Each item is a one-file change as described. Do them opportunistically when touching the file.
- **Risk / notes:** None.

### BND-14: `renderer.ts` bootstrap has picked up board-specific orchestration and drifted from the documented sequence
- **Priority:** P3
- **Effort:** S
- **Where:** `src/renderer.ts:6-41`; `doc/architecture/overview.md:176-187`
- **Problem:** The entry point now sequences `settings.wait()`, `initBoardTrustSync()`, `customEditorRegistry.ensureInitialized()`, board-window launch (encode link → `openRawLink` → `markLockedBoardPage`), `openStartupInputs()`, and a `setTimeout(api.windowReady, 0)`. None of these appear in the documented 8-step bootstrap, and the board-window steps are feature logic in a process entry point.
- **Refactor:** Move the steps into `app` as named phases (for example `app.initBoardInfrastructure()` and `app.openLaunchBoard()`, or a small ordered `startupPhases` list in `renderer/api/app-startup.ts`). `renderer.ts` then reads as "load NLS → bootstrap app → mount". Update the overview.
- **Risk / notes:** The ordering is load-bearing: trust sync must happen before page restore. Preserve it exactly.

## Cross-area notes
- **src/main:**
  - `src/main/board-bridge.ts` (1341 lines) is the main side of BND-3 and BND-8: a positional-args handler table, permission gating by method-name strings, and imports from `ipc/main`.
  - `src/main/board-dialog-service.ts:69-70` registers raw `ipcMain.handle`, which breaks the documented rule that every registration goes through the sender guard (`overview.md:68-72`).
  - `src/main/audio-service.ts` writes its own sender checks inline on raw `ipcMain` (`:125-167`). That is defensible because the target is the specific audio window, but it is not centralized.
- **Renderer, board editor:** `src/renderer/editors/board/BoardWebview.ts` (1749 lines) is a view that also acts as the server for the whole host-frame protocol: the dispatch table plus the `resolveX` reply builders. With BND-2, move that into a `BoardFrameEndpoint` model so the view only owns the iframe.
- **Renderer API:** there are two capability layers. `renderer/api/capability-bus.ts` handles legacy open intents through the frame protocol (`board:capabilities:invoke`), and the main `capability-router` handles everything else through the port. A board frame therefore reaches capabilities over two transports (`persephone.capabilities.invoke` vs `persephone.getCapability`). Worth a decision on retiring the legacy bus.
- **Renderer, whole tree:** about 20 renderer files import `ipcRenderer` from `"electron"` directly (for example `renderer/api/global-mute.ts:1`, `renderer/automation/operations.ts`, `ui/dialogs/board-dialog-controller.ts`), bypassing `window.electron`. That makes the preload facade's typing moot. Pick one access path.
- **Docs:**
  - `overview.md:533` calls the shim "small", and the bootstrap sequence (`:176-187`) is outdated.
  - The two ~1.9k-line copies of the board contract (BND-11) are the largest drift risk in the published surface.

## Keep
- **`src/shared/execute-handle.ts`:** one transport-agnostic state machine shared by `renderer/api/proc.ts` and the shim, with only `send` and `subscribe` injected. This is the exact template for BND-4 (service channel) and BND-9 (`PendingRequests`).
- **`src/ipc/module-service-channels.ts`:** exhaustive discriminated unions for both directions (`ServiceParentMessage`/`ServiceMainMessage`), and a single policy table (`PROVIDER_OPERATION_POLICY`) delivered to the host in `init` instead of copied.
- **`src/ipc/main/endpoint-registry.ts`:** one binder applies the guard and error wiring, and `MainApi` is derived from the renderer `Api` contract. Extend it per domain (BND-7) rather than replacing it.
- **`BoardWebview` `boardMessageHandlers`:** a typed per-message handler table with declarative gates (`mainTrusted`). The right server shape once the wire envelope is generic.
- **`src/board-context-menu.ts` / `src/board-console-mirror.ts`:** extracted with an injected bridge interface (`BoardContextMenuBridge`). This is the pattern for splitting the rest of the shim.
- **`src/shared/guides/*`, `ownership-registry.ts`, `board-network-guard.ts`, `range-utils.ts`:** small, pure, IO-free modules with injected dependencies (for example `isIP`), consumed by both main and renderer.
- **`src/ipc/main/controller.ts`:** a clear composition root that delegates to domain registrars. Keep it as the place where domains are listed.
