> Part of the [refactoring roadmap](../../refactoring-roadmap.md). Reviewed at commit `c798129d` (2026-11-10); line numbers drift, so search by symbol when they no longer match.

# 05 Board editor (renderer side of boards): refactoring review

## Summary

The board editor works and is heavily commented, but it grew by accretion. Each epic added a bridge message, a handler in `BoardWebview`, a field or slot on `BoardEditorModel`, and one more line in each of several hand-kept teardown lists. That last part is drifting. The `BoardWebview` / `BoardEditorModel` split follows no responsibility. Anything that needs the `<iframe>` or `postMessage` went into the *view*; anything that must outlive a frame reload went into the *model*. So one feature routinely spans both: the save handler, AiVision, toolbar controls, status items and content resources. The model-view standard says the view renders and the model holds the logic (`doc/standards/model-view-pattern.md:8-11`). The code contradicts it.

Inbound dispatch has one typed handler table, which is a good start. Around it, though, are 13 hand-written request/reply methods, gating split between the table and the handler bodies, 17 ad-hoc `postMessage` sites and five separate pending-request maps.

Ownership is also scattered. Manifest parsing and the custom-editor, bundled and permission registries live under `editors/board/` but are consumed by `api/`, `content/` and `ui/`. Permission policy is interpreted in at least six places. Board editors are constructed by `api/pages/*` and `editors/base/editor-switch.ts` rather than by the board module.

**The three biggest problems:**
1. **`BoardWebview` (1,749 lines) is a god class.** It is a view, a per-frame session, a 41-message protocol server and five RPC correlation tables in one class (BRD-1).
2. **`BoardEditorModel` (1,522 lines) is a grab-bag of about 12 runtime subsystems.** Frame-generation-owned state is scattered across state fields, private fields and views (BRD-2, BRD-4).
3. **Board-editor construction, kind resolution and the board domain registries are not owned by the board module.** They are rebuilt in `api/pages/*` and `editors/base/*`, and the dependency direction is `api` → `editors` (BRD-3, BRD-8).

## Findings

### BRD-1: `BoardWebview` is a view, a frame session and a protocol server in one class
- **Priority:** P1
- **Effort:** L
- **Where:** `src/renderer/editors/board/BoardWebview.ts:185-1688` (whole class)
  - Handler table and gate: `:138-158`, `:234-427`, `:429-465`
  - Teardown lists: `:501-511`, `:521-574`, `:639-669`, `:846-936`, `:1329-1346`
  - `resolve*` methods: `:1009-1055`, `:1407-1674`
  - Pending maps: `:208-232`
  - Push sites: `:715`, `:731`, `:760`, `:784`, `:828`, `:899`, `:905`, `:932`, `:975`, `:1066`, `:1077`, `:1097`, `:1115`, `:1200`, `:1255`, `:1274`
  - Ownership docs: `doc/architecture/key-files.md` names `BoardWebview` as owner in 13 rows (352, 509, 521, 534, 536-539, 563-564, 569-571)
- **Problem:** One `VanillaView` subclass does four jobs.
  1. **DOM shell.** Creates the iframe and handles focus.
  2. **Per-frame session.**
     - Registers the board host with main (`registerBoard`, `:576-612`).
     - Registers the CDP frame and runs the port handshake (`transferPort`, `:791-844`).
     - Handles grant-driven iframe replacement (`:639-669`).
     - Keeps generation bookkeeping and 14 distinct `api.*` IPC calls.
  3. **Bridge server.** 41 inbound message types, 13 hand-written `resolve*` methods and 17 direct `postMessage` sites.
  4. **Feature logic.**
     - Capability frame adapter and outcome reshaping: `:874-892`, `:1226-1327`, `:1407-1457`. This is the inverse of `projectCapabilityOutcome` in `api/capabilities.ts:180-187`.
     - AiVision shape validation (`:1690-1725`).
     - Content-resource opening policy (`:1502-1583`).
     - The global rate limiter `acceptedBoardNotifyTimes` (`:160-172`, module-level mutable state shared by all boards).
     - Hard-wired push of one app setting, voice typing (`:767-789`, `:812`, `:827`).
     - Iframe `allow` derivation from the grant (`:1737-1749`).

  Concrete symptoms:
  - **Five hand-maintained teardown lists with different subsets.**
    - `onDispose` (`:521-574`) and `handleLoad` (`:846-936`) both clear toolbar controls, status items, toolbar text and the mute button.
    - `refreshIframeGrant` (`:639-669`) retires a generation without any of those.
    - `handleFrameError` (`:1329-1346`) clears status items but not toolbar controls.
    - `handleLoad` does not reject pending AiVision requests; `onDispose` and `refreshIframeGrant` do.
    - Nothing records whether these differences are intentional, which is the problem.
  - **`!this.live` liveness guards appear 31 times**, most re-spelling some subset of `generation !== this.generation || this.iframe !== frame || model.frames.get(tabId) !== frame`: `:751-753`, `:776-778`, `:962-963`, `:1063-1064`, `:1074-1075`, `:1105-1107`, `:1185-1187`, `:1357-1358`, `:1371-1372`, `:1469-1473`, `:1545-1557`, …
  - **Every request handler repeats the same pattern:** capture generation, try/catch, build reply, `replyToFrame` (`:1009-1055`, `:1459-1500`, `:1634-1674`).
  - **The gate-failure reply is a hard-coded ternary over four types** (`:450-458`). Every other request type gets no reply on rejection, so the board's promise waits for its own timeout.
  - **Gating is split.** Some types are gated in the table; others re-check `isBoardPermitted` inside the handler (`:1415`, `:1517`, `:1594`, `:1625`).
  - **Source-read grant computation is copy-pasted**, including the magic `5000` (`:822-824` and `:964-966`).
  - **Main-process context-menu strings are built in the view** (`BoardHostText`, `:581-598`).
- **Refactor:** Three units with one job each:
  1. **`BoardFrameSession`** (new, `editors/board/frame/BoardFrameSession.ts`, not a view). Owns one frame's lifetime: `boardId`, `host`, `iframe`, `tabId`, `isMain`, `generation`, pending port. Public API:
     - `post(msg, transfer?)`, which runs the single liveness check.
     - `isCurrent(generation, frame)`
     - `onRetire(cb)`
     - `retire(reason: "reload" | "grant-change" | "load-error" | "permission-lost" | "dispose")`

     `retire` runs **one** ordered teardown. Each feature module registers its own cleanup through `onRetire`, so the `clear*ForFrame` lists disappear from the class. Registration, handshake and grant refresh move here.
  2. **`BoardHostRouter`** (new, `editors/board/frame/board-host-router.ts`). It is a declarative table built from the existing `BoardMessageHandlers` mapped type. It has two entry kinds:
     - `event(type, gate, handler)` for fire-and-forget messages.
     - `request(type, gate, async (msg, ctx) => result)` for request/reply.

     The router does the try/catch, reply typing via a shared request→reply map (see BRD-11), generation checks, and a uniform "not permitted" reply for *every* gated request. Handlers live in small feature modules, each of which receives the session and model:
     - `content-host-bridge.ts`
     - `shared-state-bridge.ts`
     - `chrome-bridge.ts` (see BRD-4)
     - `capability-frame-adapter.ts` (move into `api/board-capability-transport.ts`)
     - `ai-vision-bridge.ts` (see BRD-5)
     - `content-open-bridge.ts`
     - `page-state-bridge.ts`
     - `source-bridge.ts`
     - `settings-and-vars-bridge.ts`
     - the existing `BoardFetchBridge`

     Replace the voice-typing push with a generic "host settings push" list: `{ key, message }[]`.
  3. **`BoardWebview`** (remains) builds the DOM, creates the session on mount and calls `session.retire("dispose")` on dispose. Target: under 200 lines.

  Steps:
  1. Introduce `BoardFrameSession.post`/`isCurrent` and replace the 31 checks. This is mechanical.
  2. Introduce `retire` and fold the five teardown lists into it, making the reason-specific differences explicit.
  3. Introduce the router `request()` helper and convert the 13 `resolve*` methods.
  4. Move feature handlers out one by one.
- **Risk / notes:**
  - The generation and teardown semantics are subtle, especially the shim's `postAfterDocumentLoad` and the `board:saveHandlerSync` re-announce (`:901-906`). Convert the teardown lists first, under a written table of which reason clears what.
  - Do this together with BRD-4 (chrome) and BRD-11 (contract map). BRD-2's `BoardFrameRegistry` should exist first or alongside.

### BRD-2: `BoardEditorModel` is a grab-bag of runtime subsystems
- **Priority:** P1
- **Effort:** L
- **Where:** `src/renderer/editors/board/BoardEditorModel.ts`
  - Private fields: `:242-273`
  - Frames: `:279`, `:305-310`, `:409-430`, `:528-569`
  - AiVision: `:432-526`
  - Source inbox: `:312-407`
  - Save/mute: `:684-778`
  - Page state: `:181-195`, `:802-846`
  - Content resources: `:962-1060`
  - Content path: `:1078-1118`
  - Transient-field lists: `:1172-1186`, `:1256-1280`, `:1479-1495`
  - Reload copies: `:1424-1433` vs `:1440-1458`
- **Problem:** Besides being the editor (identity, trust validation, title, restore, switch options), the model hosts at least these independent subsystems, each with its own maps, timers and invariants:
  - **(a) frame registry:** `frames`, `loadedTabs`, `activeTabId`, `frameLoadWaiters`. `BoardTargetModel` mutates `model.activeTabId` directly (`BoardTargetModel.ts:136`, `:142`).
  - **(b) AiVision registration and per-tab transports** (BRD-5).
  - **(c) source inbox:** pending source URLs, session handles with 5-minute timers, `sessionBoundSources`, two private-session flags.
  - **(d) page-state key/value store** with per-key promise queues and a storage-key cache.
  - **(e) content resources** opened for `content.open()` (BRD-6 owns their permission checks).
  - **(f) content-path materialization and stream pipe.**
  - **(g) save-handler registration and `confirmRelease`.**
  - **(h) mute button.**
  - **(i) toolbar and status-bar declarations and toolbar text** (BRD-4).
  - **(j) theme-preview generations** (`:281-291`).
  - **(k) shared state**
  - **(l) busy retention**

  Symptoms of the mixing:
  - **Transient fields are listed three times by hand.** `getRestoreData` strips `statusText`/`toolbarText`/`pageMuted`/… (`:1172-1186`). `restore()` clears them one by one (`:1256-1280`). `dispose()` clears a different subset (`:1490-1495`).
  - **`aiVisionDisposed` is reused as a generic "disposed" flag** for title updates (`:1224`).
  - **`reloadBoard` and `runReloadAndWait` duplicate the same five steps** (`:1427-1432` vs `:1450-1456`).
  - **`isBoardPermitted` is re-checked defensively nine times** (`:297`, `:439`, `:446`, `:460`, `:485`, `:515`, `:887`, `:904`, `:918`). The view already tears frames down on permission loss.
  - **Content resources are tracked in three places:** `this.contentResources` (`:1016`), the module-level map in `board-pipe-handler.ts:44` (registered at `:1019-1020`), and main via `BoardWebview` (`:1551`). The two dynamic `import("./board-pipe-handler")` calls (`:1019`, `:1052`) exist only to dodge a dependency problem (BRD-8).
- **Refactor:** Keep `BoardEditorModel` as the editor façade and compose collaborators, each in `editors/board/model/`:
  - **`BoardFrameRegistry`:** frames, loaded tabs, active tab, `waitForFrameLoad`. It is owned by the model and handed to `BoardTargetModel`, which becomes its only writer of `activeTabId`.
  - **`BoardSourceInbox`:** queue, session handles, timers, private-session rules, and the source-read grant helper currently duplicated in `BoardWebview`.
  - **`BoardPageStateStore`:** validation, queues, storage key. It shares validation with the shim (BRD-11).
  - **`BoardContentResources`:**
    - `open(link, tabId, generation, signal, policy)`, which also registers with `board-pipe-handler` and with main.
    - `release(id)`
    - `releaseForFrame(tabId, generation)`

    It is the single owner of all three registrations.
  - **`BoardFrameChrome`** (BRD-4): save handler, mute, toolbar and status declarations, toolbar text and theme preview. It is held **outside** `BoardEditorState`, so `getRestoreData`/`restore`/`dispose` stop enumerating transient fields.
  - **`BoardAiVisionChannel`** (BRD-5).

  Merge `reloadBoard` into `runReloadAndWait` (`reloadBoard = () => void this.reloadAndWait()`). Replace `aiVisionDisposed` with the base class's disposed flag, adding one if missing.
- **Risk / notes:**
  - Facades and `BoardTargetModel` read `loadedTabs`, `activeTabId` and `getFrame` directly (`BoardEditorFacade.ts:368`, `:372`, `:445-446`). Keep forwarding getters during the move.
  - Extract one collaborator per task. The frame registry comes first, because BRD-1 and BRD-5 depend on it.

### BRD-3: Board editor construction and "editor kind" have no owner in the board module
- **Priority:** P1
- **Effort:** M
- **Where:**
  - `src/renderer/editors/board/index.ts:11-34`
  - `src/renderer/api/pages/PagesLifecycleModel.ts:225-271`, `:356-389`, `:397-402`, `:960`
  - `src/renderer/api/pages/PagesPersistenceModel.ts:79-100`, `:255-300`
  - `src/renderer/editors/base/editor-switch.ts:31`, `:190-230`
  - `src/renderer/editors/board/BoardEditorModel.ts:926-941`, `:1194-1196`, `:1283-1288`
  - `src/renderer/editors/board-info/BoardInfoEditorModel.ts:740-745`
- **Problem:**
  - **Plain, folder, content-host and stream-host boards are built in five places**, each re-deriving the kind from the registry:
    - `PagesLifecycleModel.buildEditorById`: three branches plus `addBundledBoardPage`.
    - `PagesPersistenceModel.restorePage`: content-host restore and the `draw-view` migration.
    - `editor-switch.ts`: content-host construction.
    - `boardModule.newEditorModel` and `createBoardEditorForFolder`.
  - **The persistence code knows a private model rule.** The `draw-view` migration seeds `selectedBoard`/`iconKey` itself because "`restore()` does NOT re-derive the selection" (`PagesPersistenceModel.ts:89-99`).
  - **`customEditorRegistry.entries.find/some` linear scans appear 15 times across 7 files**, most comparing normalized roots: `PagesLifecycleModel.ts:233`, `:238`, `:363`, `:398`, `:960`; `PagesPersistenceModel.ts:264`; `editor-switch.ts:31`, `:198`; `custom-editor-registry.ts:181`; `BoardEditorModel.ts:928`, `:1194`, `:1283`; `BoardInfoEditorModel.ts:740`; `PageWrapper.ts:262`.
  - **The kind is decided inconsistently.**
    - "content-host" is fixed at construction by class choice.
    - "stream-host" is re-read from the live registry on every `editorKind` access (`BoardEditorModel.ts:926-941`, used by `pipeUrlEnabled`, `isStreamHost`, `ensureContentPath`, `resolveStreamPipe`).
    - So a registry refresh after a manifest edit can flip a live model between simple and stream-host semantics while its class stays fixed.
  - **The kind union is spelled out literally in about 10 places** instead of using `BoardEditorKind` (`board-manifest.ts:284`): `editor-switch.ts:195`, `BoardInfoEditorModel.ts:100`, `board-manifest.ts:218`, `BoardEditorModel.ts:926`, `BoardInfoEditorFacade.ts:290`, `api/types/*.d.ts`.
- **Refactor:**
  1. **Add `customEditorRegistry.findByRoot(root)` and `canonicalRoot(root)`** (normalized-key `Map` built in `refresh()`). Replace the 15 scans.
  2. **Add one factory in `editors/board/index.ts`**: `createBoardEditor(spec)`. Its spec is a discriminated union:
     - `{ kind: "plain", boardRoot }`
     - `{ kind: "file", boardRoot, filePath, host? }`
     - `{ kind: "folder", boardRoot, folderPath }`
     - `{ kind: "restore", descriptor }`

     The factory resolves the association once, picks the class and passes the resolved `editorKind` into the model, stored in the model and never re-read. `PagesLifecycleModel`, `PagesPersistenceModel` and `editor-switch.ts` call only this factory and no longer import `BoardContentEditorModel` or `getDefaultBoardEditorState`.
  3. **Give stream-host its own subclass** (`BoardStreamEditorModel`) next to `BoardContentEditorModel`. Move `resolveStreamPipe`/`pipeUrlEnabled` there. The base then only knows "simple".
  4. **Move the `draw-view` → Excalidraw migration into the factory's restore path**, so it calls `model.selectBoard()` instead of writing state fields.
- **Risk / notes:**
  - Restore ordering is delicate (comments at `PagesPersistenceModel.ts:274-279` about branch order). Keep the factory's restore branch semantics identical and convert one call site at a time.
  - Registry readiness: the factory must `await customEditorRegistry.ensureInitialized()`.

### BRD-4: Board-authored chrome takes three different routes and is owned partly by views
- **Priority:** P2
- **Effort:** M
- **Where:**
  - `BoardWebview.ts:108-113`, `:285-323`, `:1058-1119`
  - `BoardEditorView.ts:90-108`
  - `BoardToolbar.ts:83-100`
  - `BoardToolbarControls.ts:38-364` (protocol), `:717-902` (view)
  - `BoardStatusBarItems.ts:11-124` (protocol), `:128-230` (view)
  - `BoardEditorModel.ts:264-270`, `:684-736`, `:883-923`, `:1371-1392`
- **Problem:**
  - **Status text and toolbar text** go message → model state → view binding.
  - **Toolbar controls and status-bar items** go message → `BoardWebview` normalizes → `props.onToolbarSet` → `BoardHostView` → `BoardToolbarView` → `BoardToolbarControls`.
    - The *catalog* (records, generation) lives in the view; the model keeps only a shadow of element declarations for the facade (`setLiveToolbarElementDeclarations`).
    - Status-bar clearing is done both by `BoardWebview` (`:504`, `:530`, `:858`, `:1336`) and by `BoardStatusBarItems.clear` (`:174`).
  - **The mute button and save handler** are model fields with closures created in the view (`:255`, `:263`).
  - **Each slot carries its own "frame generation owner" field.** There are five: `toolbarFrameGeneration`, `statusBarFrameGeneration`, `toolbarTextFrameGeneration`, `muteButtonFrameGeneration`, `saveRequestGeneration`. Each has its own `clear…ForFrame`, and BRD-1's teardown lists must remember each.
  - **Status text is not generation-owned while toolbar text is**, with no stated reason.
  - **Pure protocol validation (about 290 + 120 lines) lives inside view files** and is imported by `BoardWebview` from a view module.
  - **Duplicated helpers:**
    - `isRecord`: `BoardToolbarControls.ts:56` = `BoardStatusBarItems.ts:17`
    - `SAFE_ID`: `:39` = `:12`
    - Icon normalization: `BoardToolbarControls.ts:72-85` vs `BoardStatusBarItems.ts:55-70`
- **Refactor:**
  1. **Move the normalizers** (`normalizeToolbarControl*`, `mergePatch`, `normalizeBoardStatusBar*`, a shared `normalizeBoardIcon`, `SAFE_ID`, `isRecord`) into `editors/board/chrome/board-chrome-protocol.ts`, a pure module with no DOM.
  2. **Add `BoardFrameChrome`** (owned by the model; see BRD-2), a small reactive model holding:
     - toolbar catalog
     - status catalog
     - toolbar text
     - status text
     - mute state and toggle callback
     - save handler
     - `ownerGeneration`

     It has one `retireFrame(generation)` and one `set*/update*` per message.
  3. **Make `BoardToolbarControls` and `BoardStatusBarItems` pure views** that bind to `BoardFrameChrome` and emit actions through it. Delete the `onToolbarSet/Update/Clear` and `onStatusBarSet/Update/Clear` prop chain.
  4. **Derive element declarations for the facade from the chrome model**, not pushed back from the views.
- **Risk / notes:** Focus/scroll preservation in `BoardToolbarControls.set` (`:743-769`) must stay view-side. Do this with or right after BRD-1.

### BRD-5: AiVision remote routing is smeared across view, model and facade
- **Priority:** P2
- **Effort:** M
- **Where:**
  - `BoardWebview.ts:208-216`, `:325-333`, `:1121-1224`, `:1690-1729`
  - `BoardEditorModel.ts:53-92`, `:242-247`, `:432-526`
  - `src/renderer/scripting/api-wrapper/BoardEditorFacade.ts:481-673`
  - `BoardTargetModel.ts:139-141`
- **Problem:**
  - **About 480 lines in three classes implement one remote channel:**
    - the view keeps the pending-request map and shape validation;
    - the model keeps registration, the token/incarnation counters, per-tab transports and view routing;
    - the facade keeps element-route resolution, path walking, the cross-view `elements` aggregation and deadline handling.
  - **"Is this a declared secondary view?" is answered in four places:** `BoardWebview.ts:1702-1725`, `BoardEditorModel.ts:508-510`, `BoardEditorFacade.ts:579-583`, `BoardTargetModel.ts:139-141`.
  - **The facade (a scripting adapter) holds routing business logic** that the MCP path cannot reuse without going through the facade.
- **Refactor:** Create `editors/board/model/BoardAiVisionChannel.ts`, owned by the model. It has:
  - `register(shape, frame, generation, reason)`, which takes over validation from the view.
  - `attachTransport(tabId, transport)` and `detach(tabId)`
  - `request(req, { timeoutMs, timeoutError })`, which includes route resolution, `ai:elements` aggregation across mounted views and secondary-view readiness through `BoardFrameRegistry`.
  - `registration` (token, incarnation)

  The frame-side pending map moves to the `ai-vision-bridge` handler module (BRD-1). Add `model.hasSecondaryView(id)` and use it in all four places. The facade keeps only proxy caching (`getAiVisionProxy`) and timeout-level resolution.
- **Risk / notes:** Keep the token/incarnation semantics documented in `doc/architecture/editors.md:73-80` intact. Depends on BRD-2's frame registry.

### BRD-6: Permission and trust policy is re-interpreted in many places
- **Priority:** P2
- **Effort:** M
- **Where:**
  - Network/appScripting derivation, identical in two files: `BoardWebview.ts:1518-1521` and `board-fetch.ts:45-48`
  - Iframe features: `BoardWebview.ts:1737-1749`
  - Hand-written denial strings: `BoardEditorModel.ts:980-1008`; `board-fetch.ts:48`; `api/node-fetch.ts:162-184`
  - `src/renderer/api/board-trust.ts:138-147` vs `src/shared/board-manifest-utils.ts:138-146`
  - `src/renderer/api/boards.ts:98`
  - `board-access.ts:7-25`; `bundled-board-registry.ts:73-95`; `custom-editor-registry.ts:437-439`
  - Defensive re-checks: 11 in `BoardWebview`, 9 in `BoardEditorModel`
- **Problem:**
  - **The network policy object is built twice from the grant, line for line.** `board-fetch.ts:56` re-declares the `BoardNetworkPolicy` type inline instead of importing it.
  - **`permission-denied: "<flag>" is not enabled in board-manifest.json` is typed out by hand** in the renderer despite `boardPermissionError(flag)` in shared.
  - **`boardTrust.allows` re-implements `boardPermissionAllows` and has already drifted.** The shared helper denies `computerAudio` to legacy grants (`board-manifest-utils.ts:139`); the renderer copy allows it (`board-trust.ts:144`).
  - **"Trusted or bundled" is re-implemented** in `api/boards.ts:98` instead of calling `isBoardPermitted`.
  - **"Disabled bundled board" gets three different answers.**
    - `isBoardPermitted` ignores the disabled setting, because `isBundled` checks all records (`bundled-board-registry.ts:92-95`).
    - `customEditorRegistry` subscribes to the setting itself (`:437-439`).
    - `subscribeBoardPermission` claims to cover "bundled enable/disable changes" (`board-access.ts:17`), but `bundledBoardRegistry.subscribe` only fires on refresh, not on `setDisabled`.
  - **The frame `allow` feature mapping is policy written inside the view.**
- **Refactor:** Introduce a `BoardGrant` value object in `api/board-trust` (or `boards/permissions.ts` per BRD-8) wrapping `NormalizedBoardPermissions`, with:
  - `allows(flag)`, delegating to the shared `boardPermissionAllows`
  - `networkPolicy({ mcpUrl, boardRoot })`
  - `iframeFeatures()`
  - `deny(flag)`, returning `boardPermissionError`

  Then:
  - `boardTrust.getGrant(root)` returns it.
  - Replace the two policy blocks, the iframe mapping and the hand-written strings.
  - Make one `boardAccess` module the only answer to "may this board run", with an explicit, documented rule for disabled bundled boards, and one subscription that really covers trust, bundled refresh and the disabled setting.
  - Once BRD-1's session tears down on permission loss, delete the defensive per-call re-checks.
- **Risk / notes:** US-1609 (removing the legacy permission fallback, scheduled 2027-01-03, `doc/active-work.md:22`) removes most `kind === "legacy"` branches. Do this right after it so the value object never carries the legacy shape. Fixing the `computerAudio` drift on its own is a one-line change that can go first.

### BRD-7: The manifest has two shapes, no single reader and a 1,044-line module doing five jobs
- **Priority:** P2
- **Effort:** M
- **Where:**
  - `src/renderer/editors/board/board-manifest.ts`
    - Raw type: `:89-256`
    - Settings validation: `:348-517`
    - Masks/globs: `:596-784`
    - Raw reader returning an unvalidated cast: `:554-565`
    - Re-normalizing raw helpers: `:817-831`, `:995-1024`
    - `parseBoardManifest`: `:871-947`
  - `BoardEditorModel.ts:1222`, `:1343-1344`
  - `custom-editor-registry.ts:476-477`
  - Main-side re-readers: `src/main/board-bridge.ts:127`, `src/main/board-protocol-service.ts:389`, `src/main/board-storage.ts:214`, `src/main/board-trust-service.ts:173`, `src/main/mcp/ai-vision/board-guide-mounts.ts:25,64` (own copy of the file-name constant)
- **Problem:**
  - **`readBoardManifest` returns `JSON.parse(...) as BoardManifest`.** The type claims a validated shape the data never had.
  - **Consumers mix the raw and normalized shapes.**
    - `BoardEditorModel.applyManifestTitle` calls `readBoardManifest(...)?.name?.trim()` (`:1222`). A manifest with `"name": 5` would throw inside an un-awaited promise.
    - `getBoardEditorAssociation`, `isBoardStandalone`, `boardUsageGroup` and `readBoardSecondaryViews` take the raw shape and re-normalize. `parseBoardManifest` already computes `association` and `secondaryViews`.
  - **One board open reads the same file several times:** `isBoardFolder`, `seedSecondaryViews`, `applyManifestTitle`, `BoardWebview.registerBoard` and `restore`.
  - **The module mixes five jobs:**
    1. schema types
    2. settings-declaration validation
    3. two glob engines (file and folder)
    4. disk IO and default-manifest creation (reads `settings`)
    5. trust disclosure and usage grouping
- **Refactor:**
  1. **Make `readBoardManifest` return `NormalizedBoardManifest | null`.** Keep a private raw reader only for `board-scaffold.ts` (which writes) and `board-install.ts` (staging check). Migrate the raw-shape helpers to take the normalized shape (`association`, `secondaryViews` and `standalone` are already there).
  2. **Split the module:**
     - `manifest/board-manifest-schema.ts`: types plus `parseBoardManifest`
     - `manifest/board-settings-declarations.ts`
     - `manifest/board-masks.ts`: file, folder, content and `untitledFileNameForMasks`
     - `manifest/board-manifest-io.ts`: read, write, ensure, default
  3. **Optionally add a per-root parsed cache**, invalidated by `reloadBoard`, `customEditorRegistry.refresh` and trust changes, so a board open parses once.
- **Risk / notes:** 33 importing files (`board-manifest` is the most imported board module). Do the split as a pure move with a temporary re-export barrel, then remove the barrel (direct imports are the project rule). Main-side readers are a cross-area note.

### BRD-8: Board domain modules live under `editors/board` and are consumed bottom-up; `customEditorRegistry` is really the board contribution registry
- **Priority:** P2
- **Effort:** M
- **Where:**
  - `src/renderer/editors/board/custom-editor-registry.ts:415-556`
  - Imports from `api/` into `editors/board`:
    - `api/board-namespace.ts` → `board-manifest`, `bundled-board-registry`
    - `api/board-updates.ts:18-19` → `busy-boards`, `BoardEditorModel`
    - `api/board-navigation-return.ts:5` → `BoardEditorModel`
    - `api/capability-bus.ts` → `board-access`
    - `api/mcp/board-call-command.ts` → `BoardEditorModel`, `board-access`
    - `api/internal/RendererEventsService.ts` → `custom-editor-registry`
    - `api/pages/*` → `custom-editor-registry`, `board-manifest`, `bundled-board-registry`
    - `api/boards.ts:345` → `request-board-trust`, via dynamic import
    - `api/app.ts:264` → `board-pipe-handler`
  - `content/resolvers.ts`, `content/open-with-editor.ts`, `content/folder-editor-link.ts`, `content/open-in-persephone.ts`, `content/tree-providers/FileTreeProvider.ts` → `custom-editor-registry`
  - `editors/video/VideoEditor.ts:191`, `:199` → `board-pipe-handler`
- **Problem:**
  - **Ownership map today:**

    | Concern | Owner(s) |
    |---|---|
    | Manifest parse/validate | `editors/board/board-manifest.ts`, plus main re-readers |
    | Permission decision ("may run") | `editors/board/board-access.ts`, plus `api/board-trust.ts`, plus `bundled-board-registry` (BRD-6) |
    | Trust consent flow | `editors/board/request-board-trust.ts`, called from `api/boards.ts`, both facades, `BoardInfo` and `BoardEditorView` |
    | Secondary views | `BoardEditorModel`, `board-secondary.ts`, `BoardSecondaryView`, `BoardTargetModel` (fine) |
    | Toolbar controls | Split across view and model (BRD-4) |
    | File-association resolution, settings boards, content providers, schemes, capability issues, browser-URL masks | All in `customEditorRegistry.refresh()` |
    | Board pipe server | `editors/board/board-pipe-handler.ts`, an app-level service also used by `VideoEditor` |
    | Capability transport | `api/board-capability-transport.ts`, plus the `BoardWebview` frame adapter |

  - **`customEditorRegistry.refresh()` rebuilds five axes and mutates other registries as a side effect** (`unregisterBoardProviders`, `registerScheme`, `replaceProviderDeclarations`, `:543-548`). The name says "custom editor".
  - **There are no static import cycles today.** I checked the whole `src/` graph; it found no strongly-connected component containing a board-editor file. But the `api` → `editors` direction is wrong.
  - **Dynamic `import()` is used to avoid dependency problems:** `BoardEditorModel.ts:1019`, `:1052`; `api/pages/PagesModel.ts:113`.
  - **`request-board-trust.ts` holds domain policy** (the "requires prompt" rule, `:36-42`) and detects errors by message substring (`:73`, `:93`).
- **Refactor:**
  - **Create a board domain folder** (`src/renderer/boards/`, or `api/boards/` if the team prefers `api` as the domain layer) and move these into it:
    - `board-manifest*` (after BRD-7)
    - `bundled-board-registry`
    - `board-access` (plus the BRD-6 grant)
    - `request-board-trust` (as `trust-consent.ts`)
    - `busy-boards`
    - `board-display-text`, `board-i18n`
    - `board-pipe-handler`, to `content/board-pipe-server.ts`
    - `custom-editor-registry`
  - **Rename `customEditorRegistry` to `boardContributionRegistry`** and split `refresh()` into per-axis contributors behind one rebuild: `editorAssociations`, `settingsBoards`, `contentProviders`/`schemes`, `capabilityIssues`, `browserUrlMasks`. Keep `resolveEditorIdForFile`/`resolveEditorIdForFolder` as the editor-axis API.
  - **Make the trust-changed error typed** with a `code`, not a message substring.
  - `editors/board/` then keeps only the editor model, views, frame session and bridge handlers.
- **Risk / notes:** Mostly a mechanical move, but it touches about 100 importing files (board-manifest 33, custom-editor-registry 23, board-display-text 22, bundled-board-registry 11, board-access 8, plus smaller modules; there is overlap). Do it as one pure-move commit (no logic) before or after the logic refactors, not interleaved. Keep the "boards never nest" assumption in the registry doc comment.

### BRD-9: The content-host holder is copy-pasted because single inheritance blocks `TextHostEditorModel`
- **Priority:** P2
- **Effort:** S–M
- **Where:**
  - `src/renderer/editors/board/BoardContentEditorModel.ts:31-51`, `:105-165`, `:191-201`, `:236-244`
  - `src/renderer/editors/board-info/BoardInfoEditorModel.ts:212-286`, `:363-376`, `:816-826`, `:870-880`
  - `src/renderer/editors/base/TextHostEditorModel.ts:15-82` (its header says it exists so editors don't "copy-paste" this)
  - `BoardWebview.ts:196`, `:271-278`, `:705-718`
- **Problem:**
  - **Both board models copy the host-holder logic.** `TextHostEditorModel` already centralises trait registration, `adoptHost`, the `setPage` forward, `_pendingHost` restore, modified/save/`confirmRelease` delegation and host-first dispose. `BoardContentEditorModel` (must extend `BoardEditorModel`) and `BoardInfoEditorModel` re-implement it.
  - **The echo guard is re-implemented too.** `BoardWebview` keeps its own (`lastBoardContent`, `:196`, `:274`, `:707`) instead of the bounded `createEchoGuard` used by `TextHostEditorModel`.
  - **The router downcasts with an optional call:** `(current.model as BoardContentEditorModel).hostChangeContent?.(content)` (`:275`, `:278`).
- **Refactor:**
  - **Extract a `ContentHostSlot` composition class** from `TextHostEditorModel`. It holds the host, the subscription registry, trait registration, adopt/extract, pending descriptor, restore, release/save/modified delegation and the echo guard.
  - `TextHostEditorModel` uses it internally; `BoardContentEditorModel` and `BoardInfoEditorModel` compose it.
  - Give `BoardEditorModel` virtual `applyBoardContent(content)` and `saveBoardContent()` methods (no-ops on the base). The router then calls them without a cast, and the content-host bridge uses the slot's echo guard.
- **Risk / notes:** Host transfer on switch is user-visible (no reload, no data loss). Verify the Text ↔ board ↔ `+` round trip manually after the change.

### BRD-10: Board Info combines two editors, repeats manifest projection, and its view bypasses the model
- **Priority:** P2
- **Effort:** M
- **Where:**
  - `src/renderer/editors/board-info/BoardInfoEditorModel.ts:186-196`, `:229-249`, `:395-498`, `:530-588`
  - `src/renderer/editors/board-info/BoardInfoEditorView.ts:114-117`, `:344-597`, `:367`, `:444`, `:546-570`, `:700-713`
  - `src/renderer/scripting/api-wrapper/BoardInfoEditorFacade.ts:146-200`
  - `src/renderer/scripting/api-wrapper/board-manifest-projection.ts:12-40`
  - `src/renderer/editors/board/request-board-trust.ts:101-117`
  - `src/renderer/api/boards.ts:546-563`, `:578-590`
  - `src/renderer/editors/board-info/open-board-info.ts:59-69`
- **Problem:**
  - **Install mode and properties mode share one model through a `mode` getter**, with disjoint state fields: `matches`/`installUi`/`installDir` vs `props`/`versions`/`versionsState`.
  - **Manifest data is projected three times:**
    1. `loadProperties` flattens about 30 manifest fields into `BoardPropsInfo` (`:443-491`).
    2. The facade re-copies each one into `IBoardInfoProperties` (`:146-200`).
    3. `projectBoardManifest` does the same job for `BoardEditorFacade.getManifest`.
  - **Flows are duplicated with different guards:**
    - **"Remove board"** (catalog → uninstall, else untrust + unpin) exists in `request-board-trust.ts:101-117` *and* in `BoardInfoEditorModel.uninstall`/`unregister` (`:555-588`). Only the latter calls `ensureBoardIdle`.
    - **"Install a specific version"** (compatibility check, `runBoardVersionInstall`) exists in `BoardInfoEditorModel.installBoardVersion` (`:530-549`) and in `api/boards.installPublished` (`:546-563`).
    - **Constructing and opening a Board Info page** appears in `openBoardInfoPage` and in `installPublished` (`:578-590`).
  - **The view reads services directly instead of model state.**
    - It subscribes to install registry, trust paths, trust grants and catalog (`:114-117`).
    - It calls `boardTrust.isTrusted` at `:367` and `:707` while `props.trusted` exists.
    - It reloads properties on grant change while the model already reloads on `eBoardTrustChanged` (`Model:229-232`), so one change triggers two reloads.
  - **`renderProperties` is one 250-line method.** It renders two rows both labelled "Service" (`:546-548`, `:555-570`).
- **Refactor:**
  - `BoardPropsInfo` becomes `{ manifest: NormalizedBoardManifest; status: { trusted, isBundled, permissions snapshot, serviceStatus, registrationIssues, fileAccessGrants, catalog info } }`. The facade reuses `projectBoardManifest(manifest)` plus a status projection.
  - Move the "remove board" and "install version" flows into `api/board-install.ts` (`removeBoard(root, { confirm })`, `installBoardVersion(...)`). Board Info, trust consent and `api.boards` all call them.
  - `api.boards.installPublished` calls `openBoardInfoPage({ catalogId, installDir })` and awaits a returned handle instead of constructing the model.
  - Split the model internally into `BoardInstallSession` (install-mode state and actions) and `BoardPropertiesLoader` (properties state). The view binds only to model state; tile status comes from the model.
  - Split `renderProperties` into section renderers:
    - identity
    - editor association
    - permissions
    - remembered paths
    - contributions
    - service
    - versions
    - actions
- **Risk / notes:** The persisted editor id `board-info` and the "+" holder semantics must stay unchanged. Keep one editor id and split only internally.

### BRD-11: The bridge message contract is direction-less, and request→reply pairing is hand-coded on both sides
- **Priority:** P2
- **Effort:** S
- **Where:**
  - `src/ipc/board-bridge-channels.ts:606-647`, `:830-869`
  - `src/board-shim.ts:609-635`, `:769-800`, `:750-761`
  - `BoardWebview.ts:450-458`, `:1353-1365`
  - `BoardEditorModel.ts:181-195`
- **Problem:**
  - **`BoardHostFrameMsg` mixes both directions.** It is the union of all board→host messages *and* host→board messages, so `replyToFrame` (`:1353`) type-checks sending a `board:setContent` *to* the board.
  - **Request→reply pairing is written twice.**
    - The shim passes `expectedReplyType` at each `hostRequest` call.
    - The host hard-codes the reply type in each of 13 `resolve*` methods and in the gate-failure ternary.
  - **Naming is inconsistent.** Most board→host messages use `board:*`, but `capabilities:intent:result` and `navigation:createReturnUrl` don't. Replies drop the prefix (`pageState:get:result`).
  - **Page-state key/value validation is duplicated verbatim** (pattern, 10 MiB limit, messages) in the shim (`:750-761`) and the model (`:181-195`).
- **Refactor:** In `board-bridge-channels.ts`:
  - Export a `HostToBoardMsg` union and make `BoardHostFrameMsg` an alias of `BoardToHostMsg | HostToBoardMsg` used only by the listener.
  - Export `BOARD_HOST_REQUESTS = { "board:pageState:get": "pageState:get:result", … } as const`, with derived `BoardHostRequestType` and `ReplyFor<T>`.
  - The shim's `hostRequest` and BRD-1's router both read the map.
  - Move page-state validation to `src/shared/board-page-state.ts`, imported by shim and renderer.
  - Leave existing wire names unchanged (they are a published contract). Only stop adding inconsistent ones.
- **Risk / notes:** Type-only plus one shared constant, so low risk. Do it first; BRD-1 builds on it.

### BRD-12: Dead code, leftovers and misleading names
- **Priority:** P3
- **Effort:** S
- **Where:**
  - `src/renderer/editors/board/board-usage-cache.ts` (whole file)
  - `src/renderer/editors/board/board-service-permission.ts` (whole file)
  - `src/renderer/editors/board/board-api.d.ts:1-13`, `:734-735`
  - `BoardEditorModel.ts:110-113`, `:1314`, `:1407-1418`, `:1224`
  - `BoardWebview.ts:108`, `:111`
  - `BoardToolbar.ts:84`, `:92`
  - `BoardEditorModel.ts:967`
  - `board-fetch.ts:56`
- **Problem:**
  - **`board-usage-cache.ts` has zero importers.** Its doc still describes the React-era `useBoardStandalone` hook.
  - **`board-service-permission.ts` (`canStartBoardService`) has zero importers.**
  - **`board-api.d.ts` (736 lines) is referenced nowhere.**
    - Its own header calls it a "legacy IntelliSense snapshot … not copied into a board folder or loaded as a Monaco extra-lib".
    - It still changed in 47 commits since March.
    - Because `tsconfig.json` includes `src/**/*`, it adds `persephone: PersephoneBoardApi` to the global `Window` interface, plus 60 top-level global interfaces and types, for the whole renderer compile.
  - **Naming left over from project mode:**
    - `selectedBoard` is really "board folder resolved" (`selectBoard(name)`: "Single board, so `name` is always this board's own name").
    - `refreshBoards()` handles one board.
    - `aiVisionDisposed` is used as a general disposed flag (`:1224`).
  - **Inline `import("…")` type expressions are used where a normal import already exists.**
- **Refactor:**
  - Delete the two dead modules.
  - Delete `board-api.d.ts`. The prose guides are the contract, per the owner's direction. At minimum, move it out of the compiled tree.
  - Rename:
    - `selectedBoard` → `boardFolderName` (or a boolean `boardFound`, keeping the persisted key through `applyRestoreData`)
    - `selectBoard` → `markBoardFound`
    - `refreshBoards` → `revalidateBoard`
  - Use the base disposed flag.
  - Replace inline type imports.
- **Risk / notes:** The rename touches persistence. Keep the persisted field name, or add a one-line migration in `applyRestoreData`. The facade exposes `boardName` from `selectedBoard` (`BoardEditorFacade.ts:397-399`), so keep that public name.

## Cross-area notes

- **Main-side frame identity is spread over about 14 IPC endpoints, each keyed differently:**
  - `registerBoard`/`unregisterBoard`: host
  - `registerBoardFrame`/`unregisterBoardFrame`: model id + tab + boardId
  - `requestBoardPort`/`disposeBoardPort`/`onBoardPort`/`updateBoardHostedPath`: boardId
  - `registerBoardPipePage`: pageId
  - `registerBoardPipeResource`: resourceId
  - `grantBoardSourceReads`: root

  A main-side "frame session" (`openBoardFrameSession(...)` → `sessionId`, one `close`) would let BRD-1's `BoardFrameSession` map 1:1 onto it. (`src/main/board-bridge.ts`, `src/ipc/renderer/api.ts`)
- **`onBoardPort` is a global broadcast that every mounted frame filters by `boardId`.** See the long warning at `BoardWebview.ts:676-683`. A per-boardId subscription in `ipc/renderer/api.ts` would remove that trap.
- **The main process reads `board-manifest.json` independently in at least 5 files**, one of them with its own copy of the file-name constant (`src/main/mcp/ai-vision/board-guide-mounts.ts:25`). `board-trust-service.ts` should be the single main-side reader.
- **`src/renderer/api/board-trust.ts:138-147` has drifted from `boardPermissionAllows`** (legacy `computerAudio`). Unify with the shared function (BRD-6).
- **`src/renderer/api/boards.ts` imports board-editor internals:** `request-board-trust`, `BoardInfoEditorModel`, `board-manifest`. It also duplicates Board Info install and version logic (BRD-10).
- **`BoardEditorFacade.ts:243-381` is a near-copy of the automation members of `BrowserEditorFacade`** (19 vs 23 `ensureTargetReady` delegations). A shared `TargetAutomationMembers` helper parameterised by the target, with a browser-only "tip URL" hook, would serve both. This belongs to the scripting reviewer.
- **The capability outcome projection is split.** The script direction lives in `api/capabilities.ts:180-187`; the board direction lives in `BoardWebview.ts:1424-1448`. Both should sit together in `api/capabilities.ts` (BRD-1).
- **`src/renderer/api/board-navigation-return.ts` and `api/board-capability-transport.ts` each keep their own module-level per-frame registries** keyed by different identities (hostname, pageId). These are separate from the model's frame map and `board-pipe-handler`'s resource map. After BRD-1 they should key on the `BoardFrameSession` object.

## Keep

- **The typed inbound handler table** (`BoardMessageHandlers`, a mapped type keyed by discriminator, with a declarative `gate`; `BoardWebview.ts:116-158`). It gives exhaustiveness at compile time. Move it into the router; don't replace it.
- **`BoardTargetModel`**: a small, honest `IBrowserTarget` adapter that maps frames to tabs with clear error messages. It is a model for the other adapters.
- **`BoardFetchBridge`** (`board-fetch.ts`): a self-contained helper with its own pending map and lifecycle. Extract the other pending tables in the same shape.
- **`board-open-content.ts`**: a pure validate-then-act function that returns `{ error }` and never throws, with its scope documented. Use it as the template for router handlers.
- **`board-secondary.ts` and `boardEditorId`/`parseBoardEditorId`**: id encoding and parsing kept in exactly one place each, parsed by prefix.
- **`board-theme.ts`**: the single owner of the `--p-*` contract.
- **`request-board-trust.ts`'s in-flight de-duplication per root.**
- **Generation-stamped frame identity** to drop stale replies. The concept is right; it only needs one implementation.
- **The shim's generic `hostRequest`** (`board-shim.ts:769-800`). The host side should mirror it.
