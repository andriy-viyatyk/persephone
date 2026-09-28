# US-1547: Remove the unreachable board-provider acquire path; a recovered pipe regains ranged reads

Epic: [EPIC-115](../../epics/EPIC-115.md#us-1547-remove-the-unreachable-board-provider-acquire-path-a-recovered-pipe-regains-ranged-reads)

## Goal

Remove the obsolete board-provider installation/acquisition wait machinery while preserving the one declaration-readiness wait that guards provider restoration. A `MissingProvider` already held by a pipe must resolve and cache the registered delegate after trust refresh, exposing its current optional capabilities so board pipe reads can use ranges after recovery.

## Background

### Verified bootstrap and trust ordering

- Main's `BoardTrustService.init()` reads the trust file, builds the board-service snapshot, and applies it to `moduleServiceSupervisor` before initialization completes (`src/main/board-trust-service.ts:80-98`). `ready()` awaits that initialization (`:100-102`); path reads and trust mutations also await `ready()` (`:104-111`). The supervisor rejects `requireRecord()` before its authoritative trust snapshot exists (`src/main/module-service-supervisor.ts:419-420`). Thus the old US-1536 `trust-not-ready` service failure is addressed by US-1538's main-owned load barrier.
- Renderer bootstrap awaits `initBoardTrustSync()` and then `customEditorRegistry.ensureInitialized()` before `app.initPages()` restores pages (`src/renderer.ts:14-20`). `initBoardTrustSync()` subscribes for main trust broadcasts and awaits `boardTrust.load()` (`src/renderer/api/board-trust-sync.ts:11-29`). `ensureInitialized()` awaits trust, installed-board and bundled-board data and then awaits `refresh()` (`src/renderer/editors/board/custom-editor-registry.ts:286-300`). Therefore, at normal startup page restore does not precede the trusted declaration registry's initial commit.
- Restore has an additional board-folder guard: persisted board folder claims await `customEditorRegistry.ensureInitialized()` before looking up the board entry (`src/renderer/api/pages/PagesPersistenceModel.ts:191-218`).
- `refresh()` reads the trusted roots, constructs provider declarations, then atomically replaces declarations and synchronously registers board provider factories during its commit (`src/renderer/editors/board/custom-editor-registry.ts:303-327, 368-387, 444-480`). A *later* trust mutation triggers `void this.refresh()` from the trust-path subscription (`:271-277`), so a pipe retained from an untrusted restore can still encounter the pre-commit missing state while that refresh is pending. The pipe must recover on a later operation once registration commits.

### Provider and ranged-pipe flow

- `src/renderer/content/board-provider-factory.ts:4-50` starts with a throwing “not installed” factory, but installs the real `ProxyProvider` constructor at module evaluation (`:49-51`). `createBoardProvider()` is only called by the custom editor registry (`src/renderer/editors/board/custom-editor-registry.ts:473-478`). The install/subscribe/error indirection has no remaining installation lifecycle. Grep found no other consumers of `installBoardProviderFactory`, `subscribeBoardProviderAvailability`, or `BoardProviderUnavailableError` beyond `registry.ts` and this factory.
- `src/renderer/content/registry.ts:405-478` has `withDeadline`, `waitForProviderAvailability`, and `acquireBoardProvider`; `boardProviderAttempts` is declared at `:55` and only used by this acquire path. The factory's unavailable error is caught only by `tryCreateRegisteredProvider()` (`:293-305`) and `MissingProvider.readOnce()` (`:532-537`). Since a registered board factory now always constructs `ProxyProvider`, that acquisition loop duplicates lazy service startup. `ProxyProvider.request()` reaches `moduleService.request()` (`src/renderer/content/providers/ProxyProvider.ts:112-135`), and `module-service.request()` itself calls `acquire(boardRoot)` before posting the request (`src/renderer/api/module-service.ts:367-382`). Main independently waits for trust readiness in `start()`, `request()`, and renderer-port transfer (`src/main/module-service-supervisor.ts:224-226, 272-279, 310-314, 414-425`). Keep that service lifecycle and its main-side trust barrier.
- The declaration-readiness gate is distinct and should stay: `replaceProviderDeclarations()` marks readiness and resolves the one-shot promise (`src/renderer/content/registry.ts:378-394`); `MissingProvider.readOnce()` currently waits on it before examining the declaration (`:512-526`). Removing the deadline/acquisition loop does not remove this guard. After readiness, a missing declaration or untrusted declaration should produce `MissingProviderError`; a trusted declaration without a registered provider should produce `ProviderUnavailableError`. Once a factory is registered, cache its delegate and let `ProxyProvider` lazily start the service on operation.
- `MissingProvider` currently has only `readBinary()` and `watch()` beyond required members, creates a fresh delegate per read, and writes `state` without reading it (`src/renderer/content/registry.ts:480-553`). It does not expose the resolved delegate's `stat`, `createReadStream`, `writable`, `writeBinary`, `watch`, or `dispose` capabilities. Grep found `MissingProvider` itself only in `createProviderFromDescriptor()` (`:555-560`); callers consume it through `IProvider`/`IContentPipe`. Relevant consumers include `ContentPipe` (`src/renderer/content/ContentPipe.ts:33-40, 62-103, 168-183`), `TextFileIOModel` (`src/renderer/editors/text/TextFileIOModel.ts:88-98, 243-324`), `ImageEditor` (`src/renderer/editors/image/ImageEditor.ts:127-130`), and the board pipe handler below.
- `IProvider` requires `writable`, `readBinary()`, and `toDescriptor()`; `createReadStream`, `writeBinary`, `stat`, `watch`, and `dispose` are optional (`src/renderer/api/types/io.provider.d.ts:27-65`). Because callers test optional members with `typeof` or truthiness at use time, a recovered instance needs dynamic member visibility. In particular, `MissingProvider.stat` must remain callable even before resolution: `hasDirectStream()` initially sees no `createReadStream`, then `resolveTotalSize()` calls `stat`; after that round trip it deliberately rechecks stream availability (`src/renderer/editors/board/board-pipe-handler.ts:65-96`). If the cached delegate has no `stat`, `MissingProvider.stat()` must mirror `ContentPipe.stat()`'s fallback: read through the cached delegate and return `{ exists: true, size: buffer.length }` (`src/renderer/content/ContentPipe.ts:97-103`). That lets the board handler choose its existing buffered path correctly instead of calling a stub that throws. The `ProxyProvider.createReadStream` getter is absent until the service announces `rangeReadable` (`src/renderer/content/providers/ProxyProvider.ts:173-191`); the service host sends that announcement from `typeof implementation.readRange === "function"` (`assets/module-service-host.mjs:101-111`). Therefore expose `MissingProvider.createReadStream` dynamically from the cached delegate after `stat` has caused capability discovery; for a no-range delegate, leave it undefined so the existing buffered path remains selected.
- `ContentPipe.writeBinary()` checks `this.writable` and throws before it calls `provider.writeBinary()` when false (`src/renderer/content/ContentPipe.ts:107-112, 122-127`). Make `MissingProvider.writable` a getter returning `this.delegate?.writable ?? false`, and provide `writeBinary()` for the path callers can reach after that gate. It must resolve/use the cached delegate and throw the existing typed `MissingProviderError`/`ProviderUnavailableError` if no delegate can be resolved or the delegate has no `writeBinary` method. `ProxyProvider` itself implements `writeBinary()` and checks its live writable capability (`src/renderer/content/providers/ProxyProvider.ts:89-92, 154-171`).
- `MissingProvider.watch()` keeps its current availability contract: subscribe to registry availability and invoke each caller's callback with `"available"`, so `TextFileIOModel` and `BoardWebview` can retry (`src/renderer/content/registry.ts:542-548`; resolution-error consumers at `src/renderer/editors/text/TextFileIOModel.ts:41-48` and `src/renderer/editors/board/BoardWebview.ts:1012`). Also, if a delegate is already cached at the moment `watch()` is called and it has `watch`, forward that subscription and combine its disposer with the registry-listener disposer. Do not retroactively attach delegate watches for callers that subscribed while the provider was missing; registry availability is their retry signal. This keeps retry behavior for already-open watchers without adding asynchronous resubscription state or changing service-watch ownership. `ProxyProvider.watch()` creates a service `watchSubscribe` intent and returns its disposer (`src/renderer/content/providers/ProxyProvider.ts:239-250`).
- A cached delegate is retained for the `MissingProvider` instance's lifetime and is never cleared or replaced on trust changes or registry refresh. If trust is later revoked, the cached `ProxyProvider` remains but its service requests are rejected by the main trust gate; its normal unavailable-error conversion returns the existing typed provider error (`src/renderer/content/providers/ProxyProvider.ts:112-135`; `src/main/module-service-supervisor.ts:272-285, 414-425`). Updating provider config or replacing a delegate after manifest changes is out of scope. `MissingProvider.dispose()` forwards to the cached delegate if present.
- Main's `BoardPipeService.read()` resolves the owning renderer and sends `BOARD_PIPE_READ_CHANNEL` with the requested range to it (`src/main/board-pipe-service.ts:85-150`). The renderer handler selects a direct ranged read only when there are no transformers and both `provider.createReadStream` and `provider.stat` are functions (`src/renderer/editors/board/board-pipe-handler.ts:65-69`). Otherwise it uses `readBuffered()` and slices the whole buffer (`:44-63, 169-195`); `MAX_BUFFERED_PIPE_BYTES` is 256 MiB (`src/shared/board-pipe-constants.ts`). After the handler returns a bounded first chunk, main's `serveBoardPipe()` streams continuation ranges one at a time (`src/main/board-protocol-service.ts:284-399`); the video route follows the same range/chunk pattern (`src/main/video-stream-server.ts:671-737`). The whole-resource-versus-range decision lives in the renderer handler; main brokers the request and streams its bounded replies.
- `BOARD_BRIDGE_VERSION` is `1.18.0` (`src/shared/board-bridge-version.ts:1-2`). **No bump is needed.** This changes which already-supported provider operations an existing pipe uses internally after recovery; the board's provider API, `persephone.*` shape, request/result protocol, HTTP status, and range headers do not change. Existing board services already implement `readRange` (`assets/module-service-host.mjs:281-299`); the range fixture already exercises it (`../persephone-boards/_test/range-provider-test/board-manifest.json:8-17`, `scripts/service.mjs:168-182`).

- Restore evidence for a retained board pipe: `BoardEditorModel.getRestoreData()` stores its `sourceLink` through `cleanForStorage()` (`src/renderer/editors/board/BoardEditorModel.ts:839-875`), and `cleanForStorage()` deliberately retains `pipeDescriptor` while stripping only transient pipe/session fields (`src/shared/link-data.ts:55-89`). For a restored stream-host page, `resolveStreamPipe()` reconstructs directly from that stored descriptor (`src/renderer/editors/board/BoardEditorModel.ts:663-681`), so it can create `MissingProvider` even while the board's URL scheme is not currently registered. `PagesPersistenceModel` only drops a board restore for a missing custom editor when a persisted `folderPath` claim exists (`src/renderer/api/pages/PagesPersistenceModel.ts:201-218`); the fixture's `*.rangefix` file-mask scenario persists a file path and no folder claim (`src/renderer/api/pages/PagesLifecycleModel.ts:228-233`). This supports the requested restore-while-untrusted repro without depending on a video page rebuilding an untrusted custom scheme.

### Live verification recipe

1. Start with the existing Range Provider Test board at `../persephone-boards/_test/range-provider-test`, open its console, then open a provider-backed `*.rangefix` scenario (for example its 4096-byte `rangetest:` cold-start scenario). Keep that pipe page in the persisted page set. The fixture's manifest declares `test/range`/`rangetest` and `test/norange`/`norangetest`; `test/range` implements `readRange`, `stat`, and counters (`board-manifest.json:8-17`, `scripts/service.mjs:33-45, 168-182`).
2. Revoke trust for Range Provider Test while keeping the page open, then restart Persephone with that page still saved. After restore, re-trust the same board from Tools & Editors → Search boards. Keep the restored pipe page open and wait for registry refresh to finish before issuing the recovery reads. The restored stream-host's stored `pipeDescriptor` is reconstructed directly by `resolveStreamPipe()` (`src/renderer/editors/board/BoardEditorModel.ts:663-681`), so this probes the same restored pipe instance instead of resolving the scheme again.
3. Use the fixture's counters controls to reset counters after its frame is active; fetch the first 64 bytes and then a second byte range (or repeat the first request) from that same open page. Verify both HTTP responses have correct `206` / `Content-Range`, `test/range.readRange` records each requested range, and `test/range.readBinary` stays at zero. Confirm in `src/renderer/editors/board/board-pipe-handler.ts` that each recovery request uses `resolveTotalSize()`'s `stat` round trip and post-stat `createReadStream` recheck, with bounded reads; a result from `readBuffered()` or its 256 MiB ceiling does not pass. Sending the second request to that already-open page follows EPIC-115's standing rule.
4. Repeat the untrusted restore/re-trust sequence for the existing trusted scratch board's `mem://` provider if checking that provider type's recovery too; the fixture above remains the ranged-read oracle because its service exposes explicit `readRange` counters.

## Implementation plan

- [x] In `src/renderer/content/registry.ts`, remove `boardProviderAttempts`, `remainingDeadline()`, `withDeadline()`, `waitForProviderAvailability()`, and `acquireBoardProvider()`; remove `SERVICE_REQUEST_DEADLINE_MS` and `moduleService` imports that become unused. Simplify `tryCreateRegisteredProvider()` to return `undefined` only when no factory is registered; it no longer catches `BoardProviderUnavailableError`.
- [x] Refactor `MissingProvider` in `src/renderer/content/registry.ts` around one cached delegate and one retryable resolution promise. Keep `whenProviderDeclarationsReady()` as the initial declaration barrier, then synchronously try the registered factory. Throw typed `MissingProviderError` for absent/untrusted declarations and `ProviderUnavailableError` for a trusted declaration with no available factory. Remove the unread `state` field and the per-read new-delegate path.
- [x] Forward `readBinary`, dynamic `writable`, `stat`, `writeBinary`, `dispose`, and `watch` behavior from the cached delegate in `src/renderer/content/registry.ts`. For delegates without `stat`, implement the same fallback as `ContentPipe.stat()` (`readBinary()` then `{ exists: true, size }`). Keep `stat` callable before resolution so the board handler enters its stat-first path. Make stream support dynamically reflect the resolved delegate's current `createReadStream` member after stat has acquired the service and received capabilities; an unsupported delegate must still have no stream member. `watch()` always emits registry `"available"` events; if a delegate is already cached on subscription, also forward its `watch()` and combine the disposers, with no retroactive delegate watch. `writable` is false until a delegate is cached. `writeBinary()` forwards only after the pipe's writable gate and throws the typed resolution error if its delegate or write method is unavailable. `dispose()` forwards only to the cached delegate. Keep availability notifications so `TextFileIOModel` and other watching consumers can retry after registry changes.
- [x] Leave `displayName` and `sourceUrl` computed when `MissingProvider` is constructed (`src/renderer/content/registry.ts:489-498`); do not add dynamic name/path updates to this recovery change.
- [x] Retain a cached delegate for the `MissingProvider` lifetime. Trust revocation is enforced by main when the `ProxyProvider` makes its next service request; do not clear or replace the delegate on trust/registry refresh. Provider config changes on refresh remain out of scope.
- [x] In `src/renderer/content/board-provider-factory.ts`, collapse the implementation to one `createBoardProvider(boardRoot, providerType, config)` function that returns `new ProxyProvider(...)`; delete the throwing default, error class, mutable install hook, listeners and subscription hook. Keep `custom-editor-registry.ts`'s existing call site as the sole consumer unless direct import proves simpler without introducing a cycle.
- [x] Inspect changed call sites with `rg` for every removed symbol. In particular retain `isProviderResolutionError()` and the typed error classes: `TextFileIOModel.ts:16,42` and `BoardWebview.ts:58,1012` use the type guard to present missing/unavailable states.
- [x] Run the live trust/restore recipe above for both first and second range request on the same open page. Record the selected range, response headers, and fixture counters; the direct path must report `readRange > 0` and `readBinary === 0`.

## Concerns / Open questions

- **Registry refresh timing:** resolved by code review. Normal cold-start restore waits for both main's trust snapshot and the registry's first committed refresh. A page or pipe can still retain a `MissingProvider` after being restored while untrusted; a later trust-path refresh is asynchronous, so a read made before its commit may correctly fail with a typed missing error and a subsequent read must resolve after registration.
- **Optional member discovery:** `ProxyProvider.createReadStream` stays `undefined` until its service capability announcement. The MissingProvider wrapper must not permanently advertise range support, or no-range providers would be forced into an invalid direct-stream path. Keep the handler's deliberate post-stat recheck intact.
- **No-stat delegates:** `MissingProvider.stat()` has to be callable for the handler's stat-first recovery path, but it must preserve the existing `ContentPipe.stat()` read-and-size fallback when the resolved provider has no stat operation.
- **Watch lifecycle:** always preserve the `"available"` registry event used to retry reads; only attach to a delegate's service watch when that delegate is already cached at subscription time. Existing watchers do not gain a later service watch.
- **Delegate lifetime:** trust revocation leaves the cached delegate in place; the main trust gate rejects later operations and `ProxyProvider` maps the failure to the typed unavailable error. Replacing configuration/delegate after refresh is outside this task.
- **Provider identity fields:** `displayName` and `sourceUrl` remain construction-time values, as they are now.
- **Bridge version:** resolved; do not bump `src/shared/board-bridge-version.ts`. No board-visible surface or service protocol changes, only internal recovery/capability routing.
- **Cross-repository fixture:** no fixture changes are planned. EPIC-115's cross-repo standing rule is scoped to US-1543's service protocol changes; US-1547 reuses the existing `test/range` and `test/norange` fixture.
- **No deadline on the declaration wait:** the removed `withDeadline()` also bounded `whenProviderDeclarationsReady()`. Renderer bootstrap awaits `customEditorRegistry.ensureInitialized()` (whose first `refresh()` commits the declarations) before `app.initPages()`, and a failed initialization fails bootstrap itself, so no pipe can be created against a registry that will never become ready. The unbounded wait is therefore not a new hang path.

## Acceptance criteria

- [x] A provider descriptor restored while its board is untrusted reports the existing typed missing/unavailable error; after trust refresh, the next operation caches and reuses the registered delegate, whose own service acquisition remains lazy in `ProxyProvider`.
- [x] A pipe created before trust refresh exposes `stat` so the handler performs capability discovery; after stat, ranged delegates expose `createReadStream`, and no-range delegates keep it absent.
- [x] With the restored page still open after re-trust, the fixture's first and second ranged requests both return correct `206` / `Content-Range`; `readRange` increases and `readBinary` remains zero. The handler uses bounded reads and never whole-resource buffering for `test/range`.
- [x] The declaration-readiness wait remains; the deadline/acquire/attempt-map and factory installation/subscription machinery is removed.
- [x] `MissingProvider.stat()` falls back to the cached delegate's `readBinary()` and returns `{ exists: true, size }` when the delegate lacks `stat`; `ContentPipe.writeBinary()` remains protected by its `writable` gate.
- [x] `watch()` always notifies on registry availability, and forwards a delegate watch only when the delegate is cached at subscription time; its disposer closes both subscriptions.
- [x] Cached delegate lifetime, typed errors after trust revocation, disposal forwarding, and construction-time `displayName`/`sourceUrl` behavior match this document.
- [x] Net deletion is approximately 150 lines, as estimated by the epic. (Actual: 114 net lines across the two source files.)
- [x] `BOARD_BRIDGE_VERSION` remains `1.18.0`; no board-facing contract changed.
- [x] No unit tests are added.

## Live verification (2026-09-28)

Run against the dev build via the Persephone MCP, on the Range Provider Test fixture with a
300 MB resource (`rangetest://fixture/big.rangefix?size=314572800`). That is larger than
`MAX_BUFFERED_PIPE_BYTES`, so a buffered fallback would fail with `503` instead of answering.

1. Opened the page while trusted. Baseline probe: three ranges, all `206`; `readRange` 3, `readBinary` 0.
2. Untrusted the board (`boards.unregisterBoard`), then restarted the app fully. The page restored in
   the restricted state. A pipe was built from the persisted `pipeDescriptor` through
   `createProviderFromDescriptor()` (the app's own `ContentPipe.clone()`) and installed as the
   page's pipe: provider `MissingProvider`, `stat` present, `createReadStream` absent, and `stat()`
   rejected with `MissingProviderError`.
3. Re-trusted the board (main `setBoardTrust`). `stat()` then returned
   `{ exists: true, size: 314572800 }`, the cached delegate was a `ProxyProvider`, and
   `createReadStream` appeared.
4. From the board frame on that same page, ran two probe rounds of three ranges each (`bytes 0-63`,
   the last 64 bytes, `bytes 1000-1063`). Every response was `206` with the exact `Content-Range`
   (`bytes 314572736-314572799/314572800` for the tail). Counters after each round: `readRange` 3,
   `readBinary` 0. The page's provider stayed the same `MissingProvider` instance, with its cached
   `ProxyProvider` delegate, throughout.

`npm run typecheck`, `npm run lint` and `node scripts/build-prod.mjs` pass.

## Not verified

- A **torrent** video page (the epic's literal acceptance example) was not exercised. The range
  fixture is the ranged-read oracle for the same `MissingProvider` → `ProxyProvider` →
  `board-pipe-handler` path.
- A **no-range** delegate (`test/norange`) reached through `MissingProvider` was not exercised live;
  it was exercised only through the direct `ProxyProvider` path that already existed. The stat
  fallback and the absent `createReadStream` for such a delegate were checked by reading the code.
- The page's own board frame did not pick up the recovered pipe unaided (see the finding below), so
  step 4 ran after correcting the page's `boardRoot` and reloading the board frame. That reload did
  not recreate the pipe object.

## Finding outside this story's scope

After the restart with the board untrusted, the restored page's `state.boardRoot` came back in
backslash form (`C:\projects\persephone-boards\_test\range-provider-test`). The
`customEditorRegistry.entries` list and main's trust list use the forward-slash form. Because
`BoardEditorModel.editorKind` compares roots with `===` (`BoardEditorModel.ts:650`), the page stayed
`simple` after re-trust: `pipeUrlEnabled` was false and the board's `persephone.host.streamUrl()`
threw "unavailable on this board". Other exact `boardRoot ===` comparisons exist at
`PagesLifecycleModel.ts:201, 316, 353` and `custom-editor-registry.ts:199`. Recorded on US-1553
(provider recovery) in EPIC-115.

## Implemented shape

`MissingProvider.resolveOnce()` waits for declaration readiness, verifies the current declaration,
then caches the provider returned by the registered factory. Later operations reuse that delegate;
its optional capabilities remain dynamic through the wrapper.

```ts
await whenProviderDeclarationsReady();
const declaration = providerDeclarationFor(this.descriptor.type);
if (!declaration || !declaration.trusted || !declaration.boardRoot) {
    throw new MissingProviderError(this.descriptor.type, declaration);
}
const delegate = tryCreateRegisteredProvider(this.descriptor);
if (!delegate) throw new ProviderUnavailableError(this.descriptor.type, declaration);
this.delegate = delegate;
return delegate;
```

The board provider factory directly constructs the proxy:

```ts
export function createBoardProvider(root: string, type: string, config: Record<string, unknown>): IProvider {
    return new ProxyProvider(root, type, config);
}
```

## Files that need no changes

- `src/renderer.ts`, `src/renderer/api/board-trust-sync.ts`, `src/renderer/api/board-trust.ts`, and `src/main/board-trust-service.ts`: trust-load ordering is already correct after US-1538.
- `src/main/module-service-supervisor.ts` and `src/renderer/api/module-service.ts`: main trust readiness and `ProxyProvider`'s lazy service acquisition are the intended service lifecycle.
- `src/renderer/api/types/io.provider.d.ts` and `src/renderer/content/ContentPipe.ts`: the existing optional-member contract and dynamic call sites are sufficient; no public type changes are required.
- `src/renderer/editors/board/board-pipe-handler.ts`, `src/main/board-pipe-service.ts`, `src/main/board-protocol-service.ts`, and `src/main/video-stream-server.ts`: preserve the stat/recheck and bounded range algorithms; the change is in the provider adapter's runtime capability exposure.
- `src/shared/board-bridge-version.ts`, `assets/module-service-host.mjs`, and `../persephone-boards/_test/range-provider-test/**`: the board protocol, host capability announcement, and range fixture already support the required behavior.
- `doc/active-work.md` and the US-1547 row in `doc/epics/EPIC-115.md`: the dashboard entry and epic link already exist in the working tree; do not duplicate them.

## Files Changed

| File | Change |
|---|---|
| `doc/architecture/content-pipeline.md` | Describe on-demand delegate recovery and capability forwarding from `MissingProvider`. |
| `doc/architecture/key-files.md`, `doc/architecture/folder-structure.md` | Update the board provider factory description. |
| `doc/tasks/US-1547-board-provider-acquire/README.md` | Record the implemented recovery shape and actual documentation changes. |
| `src/renderer/content/registry.ts` | Remove unreachable acquire machinery; make `MissingProvider` cache and forward a recovered delegate while preserving declaration readiness and typed errors. |
| `src/renderer/content/board-provider-factory.ts` | Reduce the factory to the direct `ProxyProvider` constructor function. |
